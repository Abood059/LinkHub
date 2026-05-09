const {
    databaseManager,
    deviceManager,
    connectionService,
    windowManager,
    errorCentralService
} = require('../services');

class StartupController {
    constructor() {
        this._initPromise = null;
    }

    async init() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._runInit().catch((error) => {
            this._initPromise = null;
            throw error;
        });

        return this._initPromise;
    }

    async _runInit() {
        const report = {
            success: false,
            step: 'unknown',
            devices: null,
            error: null
        };

        try {
            report.step = 'environment-check';
            const adbPath = connectionService.adbPath || connectionService.getAdbPath();
            connectionService.adbPath = adbPath;

            if (!adbPath) {
                throw new Error('ADB binaries are missing or not executable.');
            }

            report.step = 'database-init';
            await databaseManager.initDb();

            report.step = 'load-devices';
            await deviceManager.loadAllDevices();
            await this._refreshRegisteredDevicesStatus();

            report.step = 'start-background-services';
            connectionService.startAdbWatcher(2000);
            connectionService.startWirelessScanner();

            report.step = 'sync-ui';
            const devicesPayload = this._buildDevicesPayload();
            windowManager.broadcast('devices:update-list', devicesPayload);

            report.success = true;
            report.devices = devicesPayload;
            return report;
        } catch (error) {
            report.error = error.message;
            errorCentralService.report({
                type: 'SYSTEM',
                severity: 'CRITICAL',
                message: `[StartupController] Startup initialization failed at step "${report.step}": ${error.message}`
            });
            return report;
        }
    }

    async _refreshRegisteredDevicesStatus() {
        const result = await connectionService.getConnectedDevices();
        const connectedDevices = result.success ? result.devices : [];
        const connectedIds = new Set(connectedDevices.map((device) => device.id));

        deviceManager.getRegisteredDevices().forEach((device) => {
            if (!connectedIds.has(device.id)) {
                deviceManager.updateDeviceStatus(device.id, 'offline');
            }
        });

        for (const rawDevice of connectedDevices) {
            const existingDevice = deviceManager.getAnyDevice(rawDevice.id);

            if (existingDevice) {
                deviceManager.updateDeviceStatus(rawDevice.id, 'connected', {
                    ip: rawDevice.ip,
                    port: rawDevice.port,
                    connectionType: 'usb'
                });
                continue;
            }

            const newDevice = deviceManager.createDevice({
                ...rawDevice,
                deviceFriendlyName: rawDevice.model,
                isNew: false,
                status: 'connected'
            });

            if (newDevice) {
                await deviceManager.saveDevice(newDevice);
                deviceManager.updateDeviceStatus(newDevice.id, 'connected', {
                    connectionType: 'usb'
                });
            }
        }
    }

    _buildDevicesPayload() {
        const registered = deviceManager.getRegisteredDevices().map((device) => device.toJSON());
        const registeredIds = new Set(registered.map((device) => device.id));

        const discovered = deviceManager
            .getDiscoveredDevices()
            .map((device) => device.toJSON())
            .filter((device) => !registeredIds.has(device.id));

        return { registered, discovered };
    }
}

module.exports = new StartupController();
