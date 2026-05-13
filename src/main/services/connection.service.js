const { Bonjour } = require('bonjour-service');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

// استيراد مدير العمليات لتنفيذ أوامر ADB
const processManager = require('./process.manager.service');
const errorService = require('./error.central.service');

class ConnectionService extends EventEmitter {
    constructor() {
        super();

        // Auto-detect development mode using Electron's app.isPackaged (consistent with ScrcpyService)
        let electronApp;
        try { 
            electronApp = require('electron').app; 
        } catch {}
        this.isDev = electronApp ? !electronApp.isPackaged : true; 

        this.baseBinPath = this.isDev
            ? path.join(__dirname, '../../../resources/bin')
            : path.join(process.resourcesPath, 'bin');

        this.bonjour = new Bonjour();
        this.adbPath = this.getAdbPath();
        this._adbWatcherTimer = null;
        this._adbScanInProgress = false;
        this._bonjourBrowsers = []; // Track Bonjour browsers for cleanup
    }

    /**
     * Fix: Input sanitization to prevent command injection attacks
     * Removes dangerous characters and patterns from device serial numbers
     */
    _sanitizeSerialNumber(serial) {
        if (!serial || typeof serial !== 'string') return '';
        
        // Remove dangerous characters that could enable command injection
        // Remove: ; & | ` $ ( ) { } [ ] < > " ' and whitespace
        return serial.replace(/[;&|`$(){}[<>"'\s]/g, '').trim();
    }

    /**
     * تحديد مسار ADB بناءً على نظام التشغيل
     */
    resolveAdbPath(platform = process.platform) {
        const adbFileName = (platform === 'win32') ? 'adb.exe' : 'adb';
        const platformFolder = (platform === 'win32') ? 'win' : 'linux';
        return path.join(this.baseBinPath, platformFolder, adbFileName);
    }

    getAdbPath() {
        const platform = process.platform;
        const fullPath = this.resolveAdbPath(platform);

        if (!fs.existsSync(fullPath)) {
            errorService.report({
                type: 'CONNECTION',
                severity: 'CRITICAL',
                message: `ADB binary not found at ${fullPath}`,
                id: 'system'
            });
            return null;
        }

        if (platform === 'linux') {
            try {
                fs.chmodSync(fullPath, 0o755);
            } catch (e) {
                errorService.report({
                    type: 'CONNECTION',
                    severity: 'LOW',
                    message: `Permission fix failed: ${e.message}`,
                    id: 'system'
                });
            }
        }

        return fullPath;
    }

    /**
     * جلب معلومات الهوية للجهاز
     */
    async getDeviceInfo(serial) {
        // Return null if ADB path is not available (ADB cannot be executed)
        if (!this.adbPath) return null;

        // Fix: Sanitize serial number to prevent command injection
        const sanitizedSerial = this._sanitizeSerialNumber(serial);
        if (!sanitizedSerial) {
            errorService.report({
                type: 'CONNECTION',
                severity: 'HIGH',
                message: `Invalid or dangerous serial number: ${serial}`,
                id: serial || 'unknown'
            });
            return null;
        }

        try {
            // Use unified ADB command to fetch all properties in one call
            // This allows proper distinction between total failure and partial data
            const output = await processManager.executeQuickTaskArray(
                this.adbPath,
                ['-s', sanitizedSerial, 'shell', 'getprop', 'ro.product.model', 'ro.build.version.release', 'ro.product.cpu.abi'],
                { timeout: 2000 }
            );

            // Check for null return from ProcessManager
            if (output === null) {
                errorService.report({
                    type: 'CONNECTION',
                    severity: 'HIGH',
                    message: 'ProcessManager returned null for device info query',
                    id: sanitizedSerial
                });
                return null;
            }

            // Check for total failure: completely empty output means shell command failed
            if (!output || output.trim().length === 0) {
                errorService.report({
                    type: 'CONNECTION',
                    severity: 'HIGH',
                    message: `ADB shell returned completely empty output for ${sanitizedSerial}`,
                    id: sanitizedSerial
                });
                return null;
            }

            // Parse the unified output - each property appears on its own line
            const lines = output.trim().split('\n');
            const properties = {};
            
            // Extract property values from the unified command output
            // Expected format: [ro.product.model]: [value]
            lines.forEach(line => {
                const match = line.match(/^\[([^\]]+)\]:\s*(.*)$/);
                if (match) {
                    const propName = match[1];
                    const propValue = match[2].trim();
                    properties[propName] = propValue || "Unknown";
                }
            });

            // Build device info object, using "Unknown" for missing properties
            const deviceInfo = {
                id: sanitizedSerial,
                model: properties['ro.product.model'] || "Unknown",
                version: properties['ro.build.version.release'] || "Unknown", 
                arch: properties['ro.product.cpu.abi'] || "Unknown"
            };

            // Return device info object whenever the unified command succeeded (returned any output)
            // Missing properties are already handled with "Unknown" values
            return deviceInfo;

        } catch (e) {
            // Return null for total connection failure: exception, timeout, or complete shell failure
            errorService.report({
                type: 'CONNECTION',
                severity: 'HIGH',
                message: `Total ADB shell failure for ${sanitizedSerial}: ${e.message}`,
                id: sanitizedSerial
            });
            return null;
        }
    }

    /**
     * فحص أجهزة USB
     */
    async getConnectedDevices(options = {}) {
        if (!this.adbPath) return { success: false, devices: [] };
        const timeoutMs = Number(options.timeoutMs || 8000);
        const suppressTimeoutLog = options.suppressTimeoutLog !== false;

        try {
            // Fix: Use array arguments instead of string concatenation to prevent command injection
            const stdout = await processManager.executeQuickTaskArray(
                this.adbPath,
                ['devices'],
                { timeout: timeoutMs }
            );

            // Check for null return from ProcessManager
            if (stdout === null) {
                errorService.report({
                    type: 'CONNECTION',
                    severity: 'HIGH',
                    message: 'ProcessManager returned null for devices list query',
                    id: 'system'
                });
                return { success: false, devices: [] };
            }
            const lines = stdout.split('\n');
            
            // Extract all valid device serials first
            const deviceSerials = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line || line.includes('List of devices')) continue;

                const [serial, state] = line.split(/\s+/);
                if (serial && state === 'device') {
                    deviceSerials.push(serial);
                }
            }

            // Fix: Execute all device info requests in parallel using Promise.all()
            // This eliminates the sequential bottleneck and reduces total execution time
            const deviceInfoPromises = deviceSerials.map(async (serial) => {
                const info = await this.getDeviceInfo(serial);
                if (info) {
                    return {
                        ...info,
                        status: 'connected',
                        connectionType: 'usb'
                    };
                }
                return null;
            });

            const deviceInfos = await Promise.all(deviceInfoPromises);
            const rawDevicesData = deviceInfos.filter(info => info !== null);

            return { success: true, devices: rawDevicesData };
        } catch (error) {
            const isKilledByTimeout =
                error?.error?.signal === 'SIGTERM' ||
                error?.error?.code === null ||
                String(error?.stderr || '').toLowerCase().includes('killed');
            if (!(suppressTimeoutLog && isKilledByTimeout)) {
                errorService.report({
                    type: 'CONNECTION',
                    severity: 'MEDIUM',
                    message: `ADB Error: ${error.message || error}`,
                    id: 'system'
                });
            }
            return { success: false, devices: [] };
        }
    }

    async smartConnect(ip, port, deviceId) {
        const result = await this.connectDevice(ip, port, deviceId);
        
        // Use only result.raw for pattern matching (not combined with message)
        const raw = String(result.raw || '').toLowerCase();
        
        let status;
        let message;
        
        // Priority 1 - Success Patterns
        if (result.success || raw.includes('connected to') || raw.includes('already connected')) {
            status = 'connected';
            message = 'Connected successfully';
        }
        // Priority 2 - Authorization Patterns (check before network patterns)
        else if (raw.includes('unauthorized') || raw.includes('authorizing')) {
            status = 'unauthorized';
            message = 'Device is unauthorized. Please allow USB debugging on the device screen.';
        }
        // Priority 3 - Device Offline Pattern
        else if (raw.includes('offline')) {
            status = 'failed_offline';
            message = 'Device is offline. Check the device screen and ensure ADB debugging is enabled and the device is awake.';
        }
        // Priority 4 - Network-Specific Patterns
        else if (raw.includes('timed out') || raw.includes('timeout')) {
            status = 'failed_timeout';
            message = 'Connection timed out';
        }
        else if (raw.includes('refused')) {
            status = 'failed_refused';
            message = 'Connection was actively refused by the target device';
        }
        else if (raw.includes('no route to host') || 
                 raw.includes('network is unreachable') || 
                 raw.includes('host is unreachable') ||
                 (raw.includes('cannot connect to') && !raw.includes('refused'))) {
            status = 'failed_unreachable';
            message = 'Network is unreachable - no route to host';
        }
        // Priority 5 - Generic Failure
        else if (raw.includes('failed') || raw.includes('error')) {
            status = 'needs_pairing';
            message = 'Direct connect failed; pairing required';
        }
        // Priority 6 - Unknown (fallback case)
        else {
            status = 'failed_unknown';
            message = 'Unrecognized error occurred during connection attempt';
        }
        
        return {
            success: status === 'connected',
            status: status,
            message: message,
            target: `${ip}:${port}`,
            raw: result.raw
        };
    }

    /**
     * مراقب منافذ الـ USB (Watcher)
     */
    startAdbWatcher(interval = 2000) {
        if (this._adbWatcherTimer) return;
        let lastDeviceIds = new Set();
        this._adbWatcherTimer = setInterval(async () => {
            // منع التداخل: لا نبدأ scan جديد إذا السابق لم ينته بعد.
            if (this._adbScanInProgress) {
                return;
            }
            try {
                this._adbScanInProgress = true;
                const result = await this.getConnectedDevices({ timeoutMs: 5000, suppressTimeoutLog: true });
                if (!result.success) {
                    return;
                }

                const currentDevices = result.devices;
                const currentIds = new Set(currentDevices.map(d => d.id));

                currentDevices.forEach(device => {
                    if (!lastDeviceIds.has(device.id)) {
                        this.emit('usb-device-connected', device);
                    }
                });

                lastDeviceIds.forEach(id => {
                    if (!currentIds.has(id)) {
                        this.emit('usb-device-disconnected', { id });
                        this.emit('device-disconnected', { id, source: 'usb' });
                    }
                });

                lastDeviceIds = currentIds;
            } finally {
                this._adbScanInProgress = false;
            }
        }, interval);
    }

    /**
     * رادار البحث اللاسلكي (Bonjour)
     */
    startWirelessScanner() {
        errorService.report({
            type: 'CONNECTION',
            severity: 'INFO',
            message: 'Starting wireless ADB Connect scanner',
            id: 'system'
        });
        const browser = this.bonjour.find({ type: 'adb-tls-connect' });
        
        // Fix: Track browser for cleanup to prevent resource leaks
        this._bonjourBrowsers.push(browser);

        browser.on('up', (service) => {
            const serial = this._extractSerial(service.name);
            const ipv4 = service.addresses.find(addr => addr.includes('.') && !addr.includes(':'));

            this.emit('wireless-service-up', {
                id: serial,
                model: service.txt?.model || "Android Device",
                ip: ipv4 || service.addresses[0],
                port: service.port,
                status: 'available',
                connectionType: 'wireless'
            });
        });

        browser.on('down', (service) => {
            this.emit('wireless-service-down', { id: this._extractSerial(service.name) });
        });
    }

    /**
     * رادار طلبات الإقران (Pairing)
     */
    startPairingScanner() {
        errorService.report({
            type: 'CONNECTION',
            severity: 'INFO',
            message: 'Starting wireless ADB Pairing scanner',
            id: 'system'
        });
        const pairingBrowser = this.bonjour.find({ type: 'adb-tls-pairing' });
        
        // Fix: Track browser for cleanup to prevent resource leaks
        this._bonjourBrowsers.push(pairingBrowser);

        pairingBrowser.on('up', (service) => {
            const serial = this._extractSerial(service.name);
            const ipv4 = service.addresses.find(addr => addr.includes('.') && !addr.includes(':'));

            this.emit('wireless-pairing-request', {
                id: serial,
                model: service.txt?.model || "Unknown Device",
                ip: ipv4 || service.addresses[0],
                port: service.port,
                status: 'pairing_request',
                connectionType: 'wireless'
            });
        });

        return pairingBrowser;
    }

    /**
     * تنفيذ الإقران اللاسلكي
     */
    async pairDevice(ip, port, code, deviceId) {
        errorService.report({
            type: 'CONNECTION',
            severity: 'INFO',
            message: `Sending pair command to ${ip}:${port}...`,
            id: deviceId
        });
        
        const result = await processManager.executeAndWatch(
            `connection-pair-${deviceId}`,
            this.adbPath,
            ['pair', `${ip}:${port}`, code],
            'Successfully paired',
            30000
        );

        return {
            success: result.success,
            message: result.success ? "Successfully paired" : "Pairing failed",
            raw: result.output // التعديل المضاف هنا
        };
    }

    /**
     * تنفيذ الاتصال اللاسلكي
     */
    async connectDevice(ip, port, deviceId) {
        errorService.report({
            type: 'CONNECTION',
            severity: 'INFO',
            message: `Connecting to ${ip}:${port}...`,
            id: deviceId
        });

        const result = await processManager.executeAndWatch(
            `connection-connect-${deviceId}`,
            this.adbPath,
            ['connect', `${ip}:${port}`],
            'connected to',
            30000
        );

        return {
            success: result.success,
            message: result.success ? "Connected successfully" : "Connection failed",
            target: `${ip}:${port}`,
            raw: result.output // أضفتها هنا أيضاً لتوحيد المعايير
        };
    }

    _extractSerial(serviceName) {
        const match = serviceName.match(/^adb-([^.]+)/);
        return match ? match[1] : serviceName;
    }

    /**
     * Fix: Proper cleanup mechanism to prevent resource leaks
     * Clears all active intervals, destroys Bonjour instances, and removes event listeners
     * Ensures the service leaves zero footprint when stopped
     */
    destroy() {
        errorService.report({
            type: 'CONNECTION',
            severity: 'INFO',
            message: 'Cleaning up ConnectionService resources...',
            id: 'system'
        });
        
        // Clear all active intervals to prevent CPU usage
        if (this._adbWatcherTimer) {
            clearInterval(this._adbWatcherTimer);
            this._adbWatcherTimer = null;
        }
        
        // Destroy all Bonjour browsers to release network sockets and memory
        this._bonjourBrowsers.forEach(browser => {
            try {
                if (browser && typeof browser.stop === 'function') {
                    browser.stop();
                }
            } catch (e) {
                console.error('[ConnectionService] Error stopping Bonjour browser:', e.message);
            }
        });
        this._bonjourBrowsers = [];
        
        // Destroy the main Bonjour instance to close all network connections
        try {
            if (this.bonjour && typeof this.bonjour.destroy === 'function') {
                this.bonjour.destroy();
            }
        } catch (e) {
            console.error('[ConnectionService] Error destroying Bonjour instance:', e.message);
        }
        
        // Remove all event listeners to eliminate dangling object references
        this.removeAllListeners();
        
        // Reset state variables
        this._adbScanInProgress = false;
        
        errorService.report({
            type: 'CONNECTION',
            severity: 'LOW',
            message: 'ConnectionService cleanup completed successfully',
            id: 'system'
        });
    }
}

module.exports = new ConnectionService();