const crypto = require('crypto');

/**
 * HttpFile Model
 * نموذج بيانات الملفات المحملة عبر HTTP
 */
class HttpFile {
    constructor(data = {}) {
        // الخصائص الأساسية
        this.id = data.id || crypto.randomUUID();
        this.url = data.url || '';
        this.fileName = data.fileName || '';
        this.storagePath = data.storagePath || '';
        this.sizeBytes = data.sizeBytes || 0;
        this.mimeType = data.mimeType || '';

        // خصائص حالة التحميل
        this.status = data.status || 'pending'; // 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
        this.progress = data.progress || 0; // النسبة المئوية (0-100)
        this.downloadedBytes = data.downloadedBytes || 0;
        this.speed = data.speed || ''; // سرعة التحميل كنص (مثال: "2.5 MB/s")
        this.eta = data.eta || ''; // الوقت المتبقي كنص (مثال: "00:32")
    }

    /**
     * تحويل الكائن إلى JSON عادي
     */
    toJSON() {
        return {
            id: this.id,
            url: this.url,
            fileName: this.fileName,
            storagePath: this.storagePath,
            sizeBytes: this.sizeBytes,
            mimeType: this.mimeType,
            status: this.status,
            progress: this.progress,
            downloadedBytes: this.downloadedBytes,
            speed: this.speed,
            eta: this.eta
        };
    }

    /**
     * تحديث حالة التقدم
     */
    updateProgress(progressData) {
        if (progressData.progress !== undefined) this.progress = progressData.progress;
        if (progressData.downloadedBytes !== undefined) this.downloadedBytes = progressData.downloadedBytes;
        if (progressData.speed !== undefined) this.speed = progressData.speed;
        if (progressData.eta !== undefined) this.eta = progressData.eta;
        if (progressData.totalBytes !== undefined) this.sizeBytes = progressData.totalBytes;
    }

    /**
     * تحديث الحالة
     */
    setStatus(status) {
        this.status = status;
    }

    /**
     * التحقق من اكتمال التحميل
     */
    isCompleted() {
        return this.status === 'completed';
    }

    /**
     * التحقق من فشل التحميل
     */
    isFailed() {
        return this.status === 'failed';
    }

    /**
     * التحقق من إلغاء التحميل
     */
    isCancelled() {
        return this.status === 'cancelled';
    }

    /**
     * التحقق من أن التحميل نشط
     */
    isActive() {
        return this.status === 'downloading' || this.status === 'pending';
    }
}

module.exports = HttpFile;
