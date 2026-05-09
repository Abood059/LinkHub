const { exec, spawn } = require('child_process');
const ProcessEntity = require('../models/ProcessEntity');

class ProcessManager {
    constructor() {
        /**
         * Key: معرف فريد (مثل serial الجهاز أو نوع المهمة)
         * Value: { instance: ChildProcess, data: ProcessEntity, type: string, timestamp: Date }
         */
        this.activeProcesses = new Map();
    }

    /**
     * تشغيل عملية طويلة (مثل Scrcpy أو Watcher)
     * @param {number} [maxBufferSize=100] أقصى عدد أسطر في السجل
     */
    execute(id, binPath, args, type = 'generic', onData = null, maxBufferSize = 100) {
        if (this.activeProcesses.has(id)) {
            this.terminate(id);
        }

        const child = spawn(binPath, args);

        const entity = new ProcessEntity({
            pid: child.pid,
            type,
            serial: id,
            maxBufferSize
        });

        const feed = (data, streamType) => {
            const str = data.toString();
            entity.addLog(str, streamType);
            if (onData) {
                try {
                    onData(str, streamType);
                } catch (e) {
                    /* تجاهل أخطاء المستهلك */
                }
            }
        };

        if (child.stdout) {
            child.stdout.on('data', (data) => feed(data, 'stdout'));
        }
        if (child.stderr) {
            child.stderr.on('data', (data) => feed(data, 'stderr'));
        }

        child.on('error', (err) => {
            console.error(`[ProcessManager] خطأ في العملية [${id}]:`, err.message);
            entity.status = 'ERROR';
            entity.addLog(err.message, 'stderr');
            this._removeDeferred(id);
        });

        child.on('exit', (code) => {
            console.log(`[ProcessManager] العملية [${id}] انتهت بالكود: ${code}`);
            entity.markAsExited(code);
            this._removeDeferred(id);
        });

        this.activeProcesses.set(id, {
            instance: child,
            data: entity,
            type,
            timestamp: new Date()
        });

        return child;
    }

    /**
     * تأجيل الحذف حتى تنتهي معالجات exit الأخرى (مثل scrcpy) ويمكنها قراءة السجلات
     */
    _removeDeferred(id) {
        setImmediate(() => {
            this.activeProcesses.delete(id);
        });
    }

    /**
     * @returns {Array<{ text: string, type: 'stdout'|'stderr', timestamp: number }>|null}
     */
    getLogs(id) {
        const entry = this.activeProcesses.get(id);
        return entry?.data?.logs ?? null;
    }

    /**
     * @returns {string|null}
     */
    getFormattedLogs(id) {
        const logs = this.getLogs(id);
        if (!logs) return null;
        return logs
            .map((e) => (e.type === 'stderr' ? `[ERR] ${e.text}` : e.text))
            .join('\n');
    }

    getProcessInfo(id) {
        const entry = this.activeProcesses.get(id);
        return entry ? entry.data : null;
    }

    /**
     * تنفيذ أمر ومراقبة مخرجاته للبحث عن نص معين (للإقران والاتصال)
     */
    executeAndWatch(id, binPath, args, successSentinel, timeoutMs = 15000) {
        return new Promise((resolve) => {
            let output = '';
            let isResolved = false;

            const child = spawn(binPath, args);

            const timeout = setTimeout(() => {
                if (!isResolved) {
                    child.kill();
                    resolve({ success: false, output: output + '\n[Timeout]' });
                }
            }, timeoutMs);

            const handleData = (data) => {
                const text = data.toString();
                output += text;

                if (text.includes(successSentinel)) {
                    isResolved = true;
                    clearTimeout(timeout);
                    resolve({ success: true, output });
                }
            };

            if (child.stdout) child.stdout.on('data', handleData);
            if (child.stderr) child.stderr.on('data', handleData);

            child.on('exit', (code) => {
                if (!isResolved) {
                    clearTimeout(timeout);
                    resolve({ success: code === 0, output });
                }
            });
        });
    }

    executeQuickTask(command, options = { timeout: 5000 }) {
        return new Promise((resolve, reject) => {
            exec(command, options, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject({ error, stderr });
                } else {
                    resolve(stdout ? stdout.trim() : '');
                }
            });
        });
    }

    terminate(id) {
        const procEntry = this.activeProcesses.get(id);
        if (procEntry && procEntry.instance) {
            console.log(`[ProcessManager] جاري إيقاف العملية: ${id}`);
            if (procEntry.data) {
                procEntry.data.markAsExited(-1);
            }
            procEntry.instance.kill('SIGTERM');
            this.activeProcesses.delete(id);
            return true;
        }
        return false;
    }

    terminateAll() {
        if (this.activeProcesses.size === 0) return;
        console.log(`[ProcessManager] جاري تنظيف ${this.activeProcesses.size} عملية نشطة...`);

        for (const [, procEntry] of this.activeProcesses) {
            try {
                if (procEntry.data) procEntry.data.markAsExited(-1);
                procEntry.instance.kill('SIGKILL');
            } catch (e) {
                console.error('Error killing process:', e.message);
            }
        }
        this.activeProcesses.clear();
    }

    getProcessStatus(id) {
        return this.activeProcesses.get(id);
    }
}

module.exports = new ProcessManager();
