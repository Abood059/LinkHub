const processManager = require('./process.manager.service');
const errorCentralService = require('./error.central.service');
const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

/**
 * DownloadService
 * خدمة التحميل المتكاملة مع ProcessManager وتتبع الأخطاء
 */
class DownloadService {
    constructor() {
        this.activeDownloads = new Map();
    }

    /**
     * فحص الرابط واستخراج معلومات الملف
     * @param {string} url - رابط التحميل
     * @returns {Promise<{fileName: string, sizeBytes: number, mimeType: string}>}
     */
    async inspectLink(url) {
        try {
            const response = await axios.head(url.trim(), {
                timeout: 10000,
                headers: {
                    'User-Agent': 'LinkHub-Downloader/1.0'
                }
            });

            const headers = response.headers;
            let fileName = 'downloaded_file';

            // استخراج اسم الملف من Content-Disposition
            if (headers['content-disposition']) {
                const nameMatch = headers['content-disposition'].match(/filename="?([^";\n]+)"?/i);
                if (nameMatch) {
                    fileName = nameMatch[1].trim();
                }
            }

            // استخراج اسم الملف من الرابط
            if (fileName === 'downloaded_file') {
                try {
                    const urlPath = new URL(url).pathname;
                    fileName = path.basename(urlPath) || 'downloaded_file';
                } catch (e) {
                    fileName = 'downloaded_file';
                }
            }

            return {
                fileName: fileName,
                sizeBytes: parseInt(headers['content-length'] || 0),
                mimeType: headers['content-type'] || 'application/octet-stream'
            };

        } catch (error) {
            throw new Error(`Failed to inspect link: ${error.message}`);
        }
    }

    /**
     * بدء التحميل
     * @param {HttpFile} file - كائن الملف المراد تحميله
     */
    startDownload(file) {
        try {
            // تخزين المرجع في الخريطة
            this.activeDownloads.set(file.id, file);

            // تحديث الحالة
            file.setStatus('downloading');

            // حساب مسار العامل
            const workerPath = path.join(__dirname, '../workers/download-worker.js');

            // بناء معاملات سطر الأوامر
            const args = [
                workerPath,
                '--url', file.url,
                '--storagePath', file.storagePath
            ];

            if (file.id) {
                args.push('--id', file.id);
            }

            // استدعاء ProcessManager
            processManager.execute(
                file.id,
                process.execPath,
                args,
                'http-download',
                (data, streamType) => this._handleWorkerOutput(data, streamType, file),
                200
            );

        } catch (error) {
            errorCentralService.report({
                type: 'HTTP_DOWNLOAD',
                severity: 'HIGH',
                message: `Failed to start download: ${error.message}`,
                id: file.id
            });

            file.setStatus('failed');
            this.activeDownloads.delete(file.id);
        }
    }

    /**
     * معالجة مخرجات العامل
     * @private
     */
    _handleWorkerOutput(line, streamType, file) {
        try {
            // تجاهل أسطر stderr إلا إذا كانت تحتوي على "error"
            if (streamType === 'stderr' && !line.toLowerCase().includes('error')) {
                return;
            }

            // محاولة تحليل السطر كـ JSON
            const data = JSON.parse(line.trim());

            if (data.type === 'progress') {
                // تحديث بيانات التقدم
                file.updateProgress({
                    progress: data.progress,
                    downloadedBytes: data.downloadedBytes,
                    speed: data.speed,
                    eta: data.eta,
                    totalBytes: data.totalBytes
                });

            } else if (data.type === 'complete') {
                // اكتمال التحميل
                file.setStatus('completed');
                this.activeDownloads.delete(file.id);

            } else if (data.type === 'error') {
                // خطأ في التحميل
                file.setStatus('failed');
                errorCentralService.report({
                    type: 'HTTP_DOWNLOAD',
                    severity: 'HIGH',
                    message: data.message,
                    id: file.id
                });
                this.activeDownloads.delete(file.id);
            }

        } catch (error) {
            // تجاهل الأسطر التي ليست JSON صالح
            if (streamType === 'stderr' && line.toLowerCase().includes('error')) {
                errorCentralService.report({
                    type: 'HTTP_DOWNLOAD',
                    severity: 'MEDIUM',
                    message: `Worker output error: ${line.trim()}`,
                    id: file.id
                });
            }
        }
    }

    /**
     * إيقاف التحميل
     * @param {string} fileId - معرف الملف
     * @returns {boolean} - هل تم الإيقاف بنجاح
     */
    stopDownload(fileId) {
        try {
            // إيقاف العملية عبر ProcessManager
            const stopped = processManager.terminate(fileId);

            // تحديث حالة الملف إذا كان موجوداً
            const file = this.activeDownloads.get(fileId);
            if (file) {
                file.setStatus('cancelled');
                this.activeDownloads.delete(fileId);
            }

            return stopped;

        } catch (error) {
            errorCentralService.report({
                type: 'HTTP_DOWNLOAD',
                severity: 'MEDIUM',
                message: `Failed to stop download: ${error.message}`,
                id: fileId
            });
            return false;
        }
    }

    /**
     * الحصول على التحميل النشط
     * @param {string} fileId - معرف الملف
     * @returns {HttpFile|null}
     */
    getActiveDownload(fileId) {
        return this.activeDownloads.get(fileId) || null;
    }

    /**
     * الحصول على جميع التحميلات النشطة
     * @returns {HttpFile[]}
     */
    getAllActiveDownloads() {
        return Array.from(this.activeDownloads.values());
    }

    /**
     * التحقق من وجود تحميل نشط
     * @param {string} fileId - معرف الملف
     * @returns {boolean}
     */
    hasActiveDownload(fileId) {
        return this.activeDownloads.has(fileId);
    }

    /**
     * إيقاف جميع التحميلات النشطة
     */
    stopAllDownloads() {
        for (const fileId of this.activeDownloads.keys()) {
            this.stopDownload(fileId);
        }
    }
}

// تصدير النمط Singleton
module.exports = new DownloadService();
