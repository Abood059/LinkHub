/**
 * تمثيل عملية طويلة الأمد مع سجل مخرجات محدود الحجم (FIFO).
 */
class ProcessEntity {
    /**
     * @param {object} opts
     * @param {number} [opts.pid]
     * @param {string} [opts.type]
     * @param {string} [opts.serial]
     * @param {number} [opts.maxBufferSize=100]
     */
    constructor(opts = {}) {
        this.pid = opts.pid;
        this.type = opts.type;
        this.serial = opts.serial;
        this.status = 'RUNNING';
        this.exitCode = null;

        this.logs = [];
        this.maxBufferSize = Number.isFinite(opts.maxBufferSize) && opts.maxBufferSize > 0
            ? Math.floor(opts.maxBufferSize)
            : 100;

        /** بقايا سطر غير مكتمل من آخر chunk (منفصل لكل قناة) */
        this._pendingStdout = '';
        this._pendingStderr = '';
    }

    /**
     * @param {string} text
     * @param {'stdout' | 'stderr'} streamType
     */
    addLog(text, streamType) {
        const pendingKey = streamType === 'stderr' ? '_pendingStderr' : '_pendingStdout';
        const chunk = String(text);
        const combined = this[pendingKey] + chunk;
        const chunkEndsWithNewline = chunk.endsWith('\n');
        const parts = combined.split('\n');

        if (!chunkEndsWithNewline) {
            this[pendingKey] = parts.pop() ?? '';
        } else {
            this[pendingKey] = '';
            if (parts.length > 0 && parts[parts.length - 1] === '') {
                parts.pop();
            }
        }

        for (const line of parts) {
            this._pushEntry(line, streamType);
        }
    }

    /**
     * إغلاق أي سطر معلق عند انتهاء العملية
     */
    flushPendingLogs() {
        if (this._pendingStdout) {
            this._pushEntry(this._pendingStdout, 'stdout');
            this._pendingStdout = '';
        }
        if (this._pendingStderr) {
            this._pushEntry(this._pendingStderr, 'stderr');
            this._pendingStderr = '';
        }
    }

    /**
     * @param {string} text
     * @param {'stdout' | 'stderr'} streamType
     */
    _pushEntry(text, streamType) {
        this.logs.push({
            text,
            type: streamType,
            timestamp: Date.now()
        });
        while (this.logs.length > this.maxBufferSize) {
            this.logs.shift();
        }
    }

    markAsExited(code) {
        this.flushPendingLogs();
        this.status = 'EXITED';
        this.exitCode = code;
    }
}

module.exports = ProcessEntity;
