const { createWindow } = require('../window');

const sniffDirectLink = (initialUrl) => {
    return new Promise((resolve, reject) => {
        let isDone = false;
        let downloadTimer;

        const snifferWin = createWindow({
            width: 950,
            height: 700,
            title: "LinkHub Sniffer",
            show: true, 
            autoHideMenuBar: true,
            // إضافة خيارات أمان إضافية لمنع الانهيار في لينكس
            webPreferences: {
                offscreen: false, // تأكد أنها false حالياً
                partition: 'persist:sniffer' // عزل الجلسة
            }
        }, false);

        const handleWillDownload = (event, item) => {
            if (isDone) {
                item.cancel();
                return;
            }

            const directUrl = String(item.getURL());
            const mimeType = String(item.getMimeType());

            // تجاهل صفحات الويب
            if (mimeType.includes('text/html') || mimeType.includes('application/xhtml')) return;

            isDone = true;
            if (downloadTimer) clearTimeout(downloadTimer);

            item.cancel();
            resolve(directUrl);

            // الحل الجذري للـ SIGSEGV في Linux:
            // 1. إخفاء النافذة فوراً لتبدو للمستخدم أنها أغلقت
            if (!snifferWin.isDestroyed()) snifferWin.hide();
            
            // 2. استخدام destroy بدلاً من close بعد مهلة بسيطة
            setTimeout(() => {
                if (!snifferWin.isDestroyed()) {
                    snifferWin.destroy(); // destroy أقوى وأسرع في تفريغ الذاكرة
                }
            }, 1000);
        };

        snifferWin.webContents.session.on('will-download', handleWillDownload);

        snifferWin.on('closed', () => {
            if (downloadTimer) clearTimeout(downloadTimer);
            if (!isDone) reject(new Error('User closed sniffer'));
        });

        // تجاهل أخطاء التحميل التي لا تؤثر على القنص (مثل الشهادات)
        snifferWin.loadURL(initialUrl).catch(() => {
            // لا نفعل شيئاً هنا، نترك التايمر أو حدث التحميل هو من يقرر
        });

        downloadTimer = setTimeout(() => {
            if (!isDone && !snifferWin.isDestroyed()) {
                snifferWin.destroy();
                reject(new Error('Timeout'));
            }
        }, 60000);
    });
};

module.exports = { sniffDirectLink };