const {
    deviceManager,
    scrcpyService,
    processManager,
    windowManager,
    errorCentralService
} = require('../services');

class StreamingController {
    async startStream(deviceId) {
        const report = {
            success: false,
            deviceId,
            status: 'idle',
            message: ''
        };

        try {
            const device = deviceManager.getDevice(deviceId);
            if (!device) {
                return {
                    ...report,
                    status: 'not_found',
                    message: 'الجهاز غير موجود.'
                };
            }

            if (device.status !== 'connected' && device.status !== 'streaming') {
                return {
                    ...report,
                    status: 'not_connected',
                    message: 'الجهاز يجب أن يكون بحالة connected قبل بدء البث.'
                };
            }

            const processId = `scrcpy-${device.id}`;
            const existingProcess = processManager.getProcessStatus(processId);
            if (existingProcess) {
                return {
                    ...report,
                    status: 'already_streaming',
                    message: 'توجد جلسة بث نشطة لهذا الجهاز بالفعل.'
                };
            }

            const quality = this._resolveQualityProfile(device);
            if (String(device.connectionType || '').toLowerCase() === 'wireless' && !device.adbTarget && device.ip && device.port) {
                device.adbTarget = `${device.ip}:${device.port}`;
            }
            const result = scrcpyService.startMirroring(device, {
                videoBitRate: quality.videoBitRate,
                maxFps: quality.maxFps,
                onProcessError: (stderrData) => this._handleStreamError(device.id, stderrData),
                onProcessExit: (exitCode) => this._handleStreamExit(device.id, exitCode),
                onSpawnError: (error) => this._handleSpawnError(device.id, error)
            });

            if (!result) {
                return {
                    ...report,
                    status: 'failed_start',
                    message: 'تعذر بدء عملية البث.'
                };
            }

            deviceManager.updateDeviceStatus(device.id, 'streaming', {
                connectionType: device.connectionType || 'wireless'
            });
            this._syncUI();

            return {
                ...report,
                success: true,
                status: 'streaming',
                message: 'تم بدء جلسة البث.',
                quality
            };
        } catch (error) {
            errorCentralService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: `[StreamingController] startStream failed for ${deviceId}: ${error.message}`,
                id: deviceId
            });
            return {
                ...report,
                status: 'error',
                message: error.message
            };
        }
    }

    async stopStream(deviceId) {
        try {
            const stopped = scrcpyService.stopMirroring(deviceId);
            const device = deviceManager.getDevice(deviceId);

            if (device) {
                deviceManager.updateDeviceStatus(deviceId, 'connected', {
                    connectionType: device.connectionType || 'wireless'
                });
            }

            this._syncUI();
            return {
                success: stopped,
                status: stopped ? 'stopped' : 'not_running',
                message: stopped ? 'تم إيقاف جلسة البث.' : 'لا توجد جلسة بث نشطة لإيقافها.'
            };
        } catch (error) {
            errorCentralService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: `[StreamingController] stopStream failed for ${deviceId}: ${error.message}`,
                id: deviceId
            });
            return {
                success: false,
                status: 'error',
                message: error.message
            };
        }
    }

    _resolveQualityProfile(device) {
        const connectionType = String(device.connectionType || '').toLowerCase();
        if (connectionType === 'usb') {
            return { videoBitRate: '8M', maxFps: 60, profile: 'high-usb' };
        }
        return { videoBitRate: '4M', maxFps: 30, profile: 'stable-wireless' };
    }

    _handleStreamExit(deviceId, exitCode) {
        const device = deviceManager.getDevice(deviceId);
        if (device) {
            deviceManager.updateDeviceStatus(deviceId, 'connected', {
                connectionType: device.connectionType || 'wireless'
            });
            this._syncUI();
        }

        if (exitCode && exitCode !== 0) {
            const processId = `scrcpy-${deviceId}`;
            const recentLogs = processManager.getFormattedLogs(processId);
            const logHint = recentLogs
                ? `\nRecent process output (buffered):\n${recentLogs.slice(-4000)}`
                : '';
            errorCentralService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: `[StreamingController] Stream process exited with code ${exitCode}.${logHint}`,
                id: deviceId
            });
            windowManager.broadcast('devices:stream-log', {
                deviceId,
                level: 'error',
                message: 'توقفت جلسة البث بشكل غير متوقع.',
                recentLogs: recentLogs || undefined
            });
        }
    }

    _handleStreamError(deviceId, stderrData) {
        const text = String(stderrData || '').trim();
        if (!text) return;

        const isCritical =
            text.toLowerCase().includes('error') ||
            text.toLowerCase().includes('failed') ||
            text.toLowerCase().includes('disconnected') ||
            text.toLowerCase().includes('closed');

        if (!isCritical) {
            return;
        }

        const processId = `scrcpy-${deviceId}`;
        const buffered = processManager.getFormattedLogs(processId);
        const logHint = buffered ? `\nBuffered output:\n${buffered.slice(-2000)}` : '';

        errorCentralService.report({
            type: 'SCRCPY',
            severity: 'HIGH',
            message: `[StreamingController] Runtime stream error: ${text}${logHint}`,
            id: deviceId
        });

        windowManager.broadcast('devices:stream-log', {
            deviceId,
            level: 'error',
            message: 'انقطع البث أو حدث خطأ أثناء الجلسة.',
            recentLogs: buffered || undefined
        });
    }

    _handleSpawnError(deviceId, error) {
        errorCentralService.report({
            type: 'SCRCPY',
            severity: 'CRITICAL',
            message: `[StreamingController] Failed to spawn scrcpy process: ${error.message}`,
            id: deviceId
        });
        windowManager.broadcast('devices:stream-log', {
            deviceId,
            level: 'error',
            message: 'تعذر تشغيل جلسة البث.'
        });
    }

    _syncUI() {
        const registered = deviceManager.getRegisteredDevices().map((d) => d.toJSON());
        const registeredIds = new Set(registered.map((d) => d.id));
        const discovered = deviceManager
            .getDiscoveredDevices()
            .map((d) => d.toJSON())
            .filter((d) => !registeredIds.has(d.id));

        windowManager.broadcast('devices:update-list', { registered, discovered });
    }
}

module.exports = new StreamingController();
