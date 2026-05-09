const {
    deviceManager,
    connectionService,
    windowManager,
    errorCentralService
} = require('../services');

class DeviceInteractionController {
    constructor() {
        this.pairingServices = new Map();
        this.pairingScannerStarted = false;
    }

    async handleDeviceInteraction(deviceId, options = {}) {
        const report = {
            success: false,
            deviceId,
            status: 'connecting',
            message: '',
            attempt: 1
        };
        const emitState = typeof options.onState === 'function' ? options.onState : () => {};

        try {
            const device = this._resolveDevice(deviceId);
            if (!device) {
                return {
                    ...report,
                    status: 'not_found',
                    message: 'الجهاز غير موجود.'
                };
            }

            this._applyLatestNetworkEndpoint(device);
            if (!device.ip || !device.port) {
                return {
                    ...report,
                    status: 'needs_pairing',
                    message: 'لم يتم العثور على عنوان الجهاز الحالي. تأكد من ظهور الجهاز في Wireless Debugging.',
                    action: 'show_pairing_modal'
                };
            }

            const connectResult = await this._connectWithRetry(device, report, emitState);
            if (connectResult.success) {
                device.adbTarget = `${device.ip}:${device.port}`;
                await deviceManager.saveDevice(device);
                this._syncUI();
                return {
                    ...report,
                    success: true,
                    status: 'connected',
                    message: 'تم الاتصال بالجهاز بنجاح.',
                    endpoint: { ip: device.ip, port: device.port }
                };
            }

            if (connectResult.reason === 'network_timeout') {
                return {
                    ...report,
                    status: 'failed_network',
                    message: 'تعذر الوصول للجهاز، تأكد أنه على نفس الشبكة'
                };
            }

            emitState({ deviceId, state: 'loading', phase: 'pairing-search' });
            const pairingService = await this._findPairingService(device);
            emitState({ deviceId, state: 'idle', phase: 'pairing-search' });
            if (pairingService) {
                return {
                    ...report,
                    status: 'needs_pairing',
                    message: 'الجهاز يحتاج إقران. يرجى إدخال كود الإقران.',
                    action: 'show_pairing_modal',
                    pairing: pairingService
                };
            }

            return {
                ...report,
                status: 'needs_wireless_debugging',
                message: 'الهاتف يرفض الاتصال. فعّل Wireless Debugging من إعدادات المطور ثم أعد المحاولة.'
            };
        } catch (error) {
            errorCentralService.report({
                type: 'ADB',
                severity: 'HIGH',
                message: `[DeviceInteractionController] Interaction failed for ${deviceId}: ${error.message}`,
                id: deviceId
            });

            return {
                ...report,
                status: 'error',
                message: error.message
            };
        }
    }

    async handleWirelessDiscovery(rawService) {
        const id = rawService?.id;
        if (!id) return { success: false, status: 'invalid_service' };

        const isRegistered = deviceManager.isRegistered(id);
        if (!isRegistered) {
            deviceManager.mapDiscoveredDevice({
                ...rawService,
                serial: id,
                connectionType: 'wireless',
                status: 'available'
            });
            this._syncUI();
            return { success: true, status: 'discovered_unregistered' };
        }

        try {
            const device = this._resolveDevice(id);
            if (!device) {
                return { success: false, status: 'not_found' };
            }

            device.ip = rawService.ip || device.ip;
            device.port = rawService.port || device.port;
            device.connectionType = 'wireless';

            const connect = await connectionService.smartConnect(device.ip, device.port, id);
            if (connect.success) {
                device.adbTarget = `${device.ip}:${device.port}`;
                deviceManager.updateDeviceStatus(id, 'connected', {
                    ip: device.ip,
                    port: device.port,
                    connectionType: 'wireless'
                });
                await deviceManager.saveDevice(device);
                this._syncUI();
                return { success: true, status: 'connected' };
            }

            deviceManager.setDeviceOffline(id);
            this._syncUI();
            return { success: false, status: connect.status || 'offline' };
        } catch (error) {
            errorCentralService.report({
                type: 'ADB',
                severity: 'HIGH',
                message: `[DeviceInteractionController] Wireless discovery handling failed for ${id}: ${error.message}`,
                id
            });
            return { success: false, status: 'error', message: error.message };
        }
    }

    async handlePairing(payload = {}) {
        const { id, ip, port, code } = payload;
        if (!id || !ip || !port || !code) {
            errorCentralService.report({
                type: 'ADB',
                severity: 'LOW',
                message: '[DeviceInteractionController] Incomplete pairing payload.',
                id: id || 'N/A'
            });
            return { success: false, message: 'بيانات الإقران غير مكتملة.' };
        }

        try {
            const pairResult = await connectionService.pairDevice(ip, port, code, id);
            if (!pairResult.success) {
                return { success: false, message: 'فشل الإقران، تحقق من الكود.' };
            }

            const device = this._resolveDevice(id);
            if (device) {
                device.ip = ip;
                device.port = port;
            }

            const connectResult = await connectionService.smartConnect(ip, port, id);
            if (!connectResult.success) {
                return {
                    success: false,
                    status: connectResult.status || 'failed_network',
                    message: connectResult.status === 'needs_pairing'
                        ? 'تم الإقران لكن الجهاز لا يزال يطلب إقراناً.'
                        : 'تم الإقران لكن تعذر الاتصال بالشبكة.'
                };
            }

            deviceManager.updateDeviceStatus(id, 'connected', {
                ip,
                port,
                connectionType: 'wireless'
            });
            if (device) {
                device.adbTarget = `${ip}:${port}`;
                await deviceManager.saveDevice(device);
            }
            this._syncUI();
            return { success: true, status: 'connected' };
        } catch (error) {
            errorCentralService.report({
                type: 'ADB',
                severity: 'HIGH',
                message: `[DeviceInteractionController] Pairing failed for ${id}: ${error.message}`,
                id
            });
            return { success: false, message: error.message };
        }
    }

    _resolveDevice(deviceId) {
        return deviceManager.getAnyDevice(deviceId);
    }

    _applyLatestNetworkEndpoint(device) {
        if (device.ip && device.port) return;
        const discovered = deviceManager.getDiscoveredDevices().find((d) => d.id === device.id);
        if (!discovered) return;
        if (discovered.ip) device.ip = discovered.ip;
        if (discovered.port) device.port = discovered.port;
    }

    async _connectWithRetry(device, report, emitState) {
        const maxAttempts = 2;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            report.attempt = attempt;
            report.status = attempt === 1 ? 'connecting' : 'retrying';
            emitState({
                deviceId: device.id,
                state: 'loading',
                phase: report.status,
                attempt
            });

            const result = await connectionService.smartConnect(device.ip, device.port, device.id);
            const combinedText = `${result.message || ''}\n${result.raw || ''}`.toLowerCase();

            if (result.success) {
                emitState({ deviceId: device.id, state: 'idle', phase: 'connect-success', attempt });
                deviceManager.updateDeviceStatus(device.id, 'connected', {
                    ip: device.ip,
                    port: device.port,
                    connectionType: 'wireless'
                });
                device.adbTarget = `${device.ip}:${device.port}`;
                return { success: true };
            }

            if (result.status === 'needs_pairing') {
                emitState({ deviceId: device.id, state: 'idle', phase: 'needs-pairing', attempt });
                return { success: false, reason: 'needs_pairing' };
            }

            const isTimeout =
                combinedText.includes('timed out') ||
                combinedText.includes('[timeout]') ||
                combinedText.includes('timeout');

            if (isTimeout && attempt < maxAttempts) {
                await this._sleep(1000);
                continue;
            }

            if (isTimeout) {
                emitState({ deviceId: device.id, state: 'idle', phase: 'network-timeout', attempt });
                return { success: false, reason: 'network_timeout' };
            }

            emitState({ deviceId: device.id, state: 'idle', phase: 'rejected', attempt });
            return { success: false, reason: 'rejected' };
        }

        return { success: false, reason: 'rejected' };
    }

    _ensurePairingScanner() {
        if (this.pairingScannerStarted) return;
        this.pairingScannerStarted = true;
        connectionService.startPairingScanner();

        connectionService.on('wireless-pairing-request', (service) => {
            this.pairingServices.set(service.id, {
                ...service,
                seenAt: Date.now()
            });
        });
    }

    _isMatchingPairingService(device, service) {
        if (!service || !device) return false;
        if (service.id && service.id === device.id) return true;
        if (service.model && device.model && service.model === device.model) return true;
        if (service.ip && device.ip && service.ip === device.ip) return true;
        return false;
    }

    async _findPairingService(device) {
        this._ensurePairingScanner();
        const immediate = Array.from(this.pairingServices.values()).find(
            (service) =>
                Date.now() - service.seenAt < 30000 &&
                this._isMatchingPairingService(device, service)
        );
        if (immediate) return immediate;

        const timeoutMs = 2500;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const service = Array.from(this.pairingServices.values()).find(
                (item) =>
                    Date.now() - item.seenAt < 30000 &&
                    this._isMatchingPairingService(device, item)
            );
            if (service) return service;
            await this._sleep(250);
        }

        return null;
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

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = new DeviceInteractionController();
