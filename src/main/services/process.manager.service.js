const { exec, spawn } = require('child_process');
const ProcessEntity = require('../models/ProcessEntity');
const errorService = require('./error.central.service');

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

        let child;
        // Fix: Handle synchronous spawn errors to prevent application crash
        try {
            child = spawn(binPath, args);
        } catch (spawnError) {
            errorService.report({
                type: 'PROCESS',
                severity: 'HIGH',
                message: `Failed to spawn process [${id}]: ${spawnError.message}`,
                id: id
            });
            throw spawnError; // Preserve original behavior but with better diagnostics
        }

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
                    // Fix: Log consumer errors instead of silently ignoring them
                    errorService.report({
                        type: 'PROCESS',
                        severity: 'LOW',
                        message: `Consumer error in process [${id}]: ${e.message}`,
                        id: id
                    });
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
            errorService.report({
                type: 'PROCESS',
                severity: 'HIGH',
                message: `Process error [${id}]: ${err.message}`,
                id: id
            });
            entity.status = 'ERROR';
            entity.addLog(err.message, 'stderr');
            // Fix: Pass child instance to prevent race condition
            this._removeDeferred(id, child);
        });

        child.on('exit', (code) => {
            errorService.report({
                type: 'PROCESS',
                severity: 'INFO',
                message: `Process [${id}] exited with code: ${code}`,
                id: id
            });
            entity.markAsExited(code);
            // Fix: Pass child instance to prevent race condition
            this._removeDeferred(id, child);
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
     * Fix: Added childInstance parameter to prevent race condition
     */
    _removeDeferred(id, childInstance) {
        setImmediate(() => {
            // Fix: Guard to prevent deleting wrong process if ID is reused
            const entry = this.activeProcesses.get(id);
            if (entry && entry.instance === childInstance) {
                this.activeProcesses.delete(id);
            }
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
        return new Promise((resolve, reject) => {
            let output = '';
            let isResolved = false;
            let child;

            // Fix: Handle synchronous spawn errors to prevent application crash
            try {
                child = spawn(binPath, args);
            } catch (spawnError) {
                reject(spawnError);
                return;
            }

            const timeout = setTimeout(() => {
                if (!isResolved) {
                    // Fix: Wrap kill() in try/catch to prevent exceptions
                    try {
                        child.kill();
                    } catch (killError) {
                        errorService.report({
                            type: 'PROCESS',
                            severity: 'LOW',
                            message: `Error killing process in timeout [${id}]: ${killError.message}`,
                            id: id
                        });
                    }
                    resolve({ success: false, output: output + '\n[Timeout]' });
                }
            }, timeoutMs);

            const handleData = (data) => {
                const text = data.toString();
                output += text;

                if (text.includes(successSentinel)) {
                    isResolved = true;
                    clearTimeout(timeout);
                    // Fix: Kill process after success to prevent zombie processes
                    try {
                        child.kill();
                    } catch (killError) {
                        errorService.report({
                            type: 'PROCESS',
                            severity: 'LOW',
                            message: `Error killing process after success [${id}]: ${killError.message}`,
                            id: id
                        });
                    }
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

            child.on('error', (error) => {
                if (!isResolved) {
                    clearTimeout(timeout);
                    reject(error);
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

    /**
     * Fix: Secure version of executeQuickTask that uses array arguments instead of string concatenation
     * This prevents command injection attacks by properly escaping arguments
     */
    executeQuickTaskArray(binPath, args, options = { timeout: 5000 }) {
        return new Promise((resolve, reject) => {
            let child;
            
            // Fix: Handle synchronous spawn errors to prevent application crash
            try {
                // Fix: Use spawn with array arguments to prevent command injection
                child = spawn(binPath, args);
            } catch (spawnError) {
                reject(spawnError);
                return;
            }
            
            let stdout = '';
            let stderr = '';

            const timeout = setTimeout(() => {
                // Fix: Wrap kill() in try/catch to prevent exceptions
                try {
                    child.kill();
                } catch (killError) {
                    errorService.report({
                        type: 'PROCESS',
                        severity: 'LOW',
                        message: 'Error killing process in timeout',
                        id: id
                    });
                }
                reject({ error: new Error('Command timeout'), stderr: 'Timeout' });
            }, options.timeout || 5000);

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error) => {
                clearTimeout(timeout);
                reject({ error, stderr });
            });

            child.on('exit', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve(stdout ? stdout.trim() : '');
                } else if (stdout) {
                    // Some ADB commands return non-zero but still have valid output
                    resolve(stdout.trim());
                } else {
                    reject({ error: new Error(`Process exited with code ${code}`), stderr });
                }
            });
        });
    }

    terminate(id) {
        const procEntry = this.activeProcesses.get(id);
        if (procEntry && procEntry.instance) {
            errorService.report({
                type: 'PROCESS',
                severity: 'INFO',
                message: `Terminating process: ${id}`,
                id: id
            });
            if (procEntry.data) {
                procEntry.data.markAsExited(-1);
            }
            
            // Fix: Implement proper two-stage termination
            // Keep map entry to allow clean exit logging
            const targetProcess = procEntry.instance;
            
            // First, try graceful termination
            try {
                targetProcess.kill('SIGTERM');
            } catch (killError) {
                errorService.report({
                    type: 'PROCESS',
                    severity: 'LOW',
                    message: `Error sending SIGTERM to process [${id}]: ${killError.message}`,
                    id: id
                });
                // Process might already be dead, clean up immediately
                this._removeDeferred(id, targetProcess);
                return true;
            }
            
            // Fix: Capture direct reference to prevent killing wrong process if ID reused
            // Schedule SIGKILL if process doesn't exit gracefully
            setTimeout(() => {
                // Fix: Check the captured process reference directly, not the map
                if (targetProcess.exitCode === null && !targetProcess.killed) {
                    errorService.report({
                        type: 'PROCESS',
                        severity: 'INFO',
                        message: `Process [${id}] didn't exit gracefully, sending SIGKILL`,
                        id: id
                    });
                    try {
                        targetProcess.kill('SIGKILL');
                    } catch (killError) {
                        errorService.report({
                            type: 'PROCESS',
                            severity: 'LOW',
                            message: `Error sending SIGKILL to process [${id}]: ${killError.message}`,
                            id: id
                        });
                    }
                }
                // Clean up regardless of whether SIGKILL was needed
                this._removeDeferred(id, targetProcess);
            }, 500);
            
            return true;
        }
        return false;
    }

    /**
     * Fix: Implement proper two-stage termination with grace period
     */
    async terminateAll() {
        if (this.activeProcesses.size === 0) return;
        errorService.report({
            type: 'PROCESS',
            severity: 'INFO',
            message: `Cleaning up ${this.activeProcesses.size} active processes...`,
            id: 'system'
        });

        const processes = Array.from(this.activeProcesses.entries());
        
        // Stage 1: Send SIGTERM to all processes
        for (const [id, procEntry] of processes) {
            try {
                if (procEntry.data) procEntry.data.markAsExited(-1);
                procEntry.instance.kill('SIGTERM');
            } catch (e) {
                errorService.report({
                    type: 'PROCESS',
                    severity: 'LOW',
                    message: `Error sending SIGTERM to process [${id}]: ${e.message}`,
                    id: id
                });
            }
        }
        
        // Wait for graceful termination
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Stage 2: Send SIGKILL to surviving processes
        for (const [id, procEntry] of processes) {
            const process = procEntry.instance;
            // Check if process is still alive
            if (process.exitCode === null && !process.killed) {
                errorService.report({
                    type: 'PROCESS',
                    severity: 'INFO',
                    message: `Process [${id}] didn't exit gracefully, sending SIGKILL`,
                    id: id
                });
                try {
                    process.kill('SIGKILL');
                } catch (e) {
                    errorService.report({
                        type: 'PROCESS',
                        severity: 'LOW',
                        message: `Error sending SIGKILL to process [${id}]: ${e.message}`,
                        id: id
                    });
                }
            }
        }
        
        // Wait for SIGKILL to take effect
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Clean up all entries
        this.activeProcesses.clear();
    }

    getProcessStatus(id) {
        return this.activeProcesses.get(id);
    }
}

module.exports = new ProcessManager();
