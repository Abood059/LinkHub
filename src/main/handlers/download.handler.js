const { ipcMain } = require('electron');
const path = require('path');
const { getFileInfo, downloadFile } = require('../services');
const { sniffDirectLink } = require('./linkSniffer.handler');
const db = require('../data/database');

// متغير عام لمنع تداخل عمليات القنص (حماية الذاكرة في Linux)
let isSniffing = false;

/**
 * تسجيل الهاندلرز الخاصة بعمليات التحميل
 */
const registerDownloadHandlers = () => {

    // 1. هاندلر فحص الرابط (Inspection)
    ipcMain.handle('download:inspect', async (eventdevice, url) => {
        try {
            // فحص أولي للرابط
            let fileInfo = await getFileInfo(url);

            // الشرط المطور: (الحجم 0) وَ (لم يتم قنصه مسبقاً) وَ (لا توجد عملية قنص جارية الآن)
            if ((!fileInfo.sizeBytes || fileInfo.sizeBytes === 0) && !fileInfo.isSniffed) {

                if (isSniffing) {
                    return { success: false, message: 'هناك عملية فحص جارية بالفعل، انتظر لحظة.' };
                }

                console.log('⚠️ الرابط غير مباشر، جاري تفعيل قناص الروابط...');
                isSniffing = true;

                try {
                    // استخراج الرابط المباشر عبر النافذة
                    const directUrl = await sniffDirectLink(url);

                    // إعادة الفحص للرابط الجديد للحصول على الحجم والاسم الحقيقيين
                    const newFileInfo = await getFileInfo(directUrl);

                    // دمج البيانات الجديدة مع الحفاظ على علامة القنص لمنع التكرار
                    fileInfo = {
                        ...newFileInfo,
                        directUrl: directUrl,
                        isSniffed: true
                    };

                } catch (sniffError) {
                    console.error('Sniffing Error:', sniffError.message);
                    return { success: false, message: 'فشل استخراج الرابط: ' + sniffError.message };
                } finally {
                    isSniffing = false; // تحرير القفل دائماً
                }
            }

            return { success: true, data: fileInfo };
        } catch (error) {
            isSniffing = false;
            console.error('Inspection Error:', error);
            return { success: false, message: 'فشل فحص الرابط' };
        }
    });

    // 2. هاندلر بدء التحميل (Execution)
    ipcMain.handle('download:start', async (event, { url, fileInfo }) => {
        let downloadId = null;
        try {
            // اختيار الرابط النهائي (المقتنص أو الأصلي)
            const targetUrl = fileInfo.directUrl || url;

            // تسجيل العملية في قاعدة البيانات
            const insertResult = db.insertDownload({
                source: fileInfo.isSniffed ? 'sniffed_stream' : 'direct_stream',
                name: fileInfo.suggestedName,
                path: '',
                url: url
            });
            downloadId = insertResult.lastInsertRowid;

            // استدعاء خدمة التحميل الفعلية
            const downloadResult = await downloadFile(targetUrl, event, fileInfo.suggestedName);

            // تحديث قاعدة البيانات عند النجاح
            db.updateDownloadStatus(downloadId, {
                status: 'completed',
                file_path: path.normalize(downloadResult.finalPath),
                file_name: downloadResult.fileName
            });
            event.sender.send('download:finished', { url });

            return { success: true, id: downloadId };

        } catch (error) {
            console.error('Download Handler Error:', error);
            if (downloadId) db.updateDownloadStatus(downloadId, { status: 'failed' });
            return { success: false, message: 'حدث خطأ أثناء التحميل: ' + error.message };
        }

    });
};

module.exports = { registerDownloadHandlers };