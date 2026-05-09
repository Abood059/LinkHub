const { Bonjour } = require('bonjour-service');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

// استيراد مدير العمليات لتنفيذ أوامر ADB
const processManager = require('./process.manager.service');

class ConnectionService extends EventEmitter {
    constructor() {
        super();

        // تحديد بيئة العمل لجلب المسارات الصحيحة للـ Binaries
        this.isDev = true; 

        this.baseBinPath = this.isDev
            ? path.join(__dirname, '../../../resources/bin')
            : path.join(process.resourcesPath, 'bin');

        this.bonjour = new Bonjour();
        this.adbPath = this.getAdbPath();
        this._adbWatcherTimer = null;
        this._adbScanInProgress = false;
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
            console.error(`[ConnectionService] CRITICAL: ADB binary not found at ${fullPath}`);
            return null;
        }

        if (platform === 'linux') {
            try {
                fs.chmodSync(fullPath, 0o755);
            } catch (e) {
                console.warn("[ConnectionService] Permission fix failed:", e.message);
            }
        }

        return fullPath;
    }

    /**
     * جلب معلومات الهوية للجهاز
     */
    async getDeviceInfo(serial) {
        if (!this.adbPath) return null;

        const getProp = async (prop) => {
            try {
                const output = await processManager.executeQuickTask(`"${this.adbPath}" -s ${serial} shell getprop ${prop}`, { timeout: 2000 });
                return output ? output.trim() : "Unknown";
            } catch (e) {
                return "Unknown";
            }
        };

        try {
            const [model, version, arch] = await Promise.all([
                getProp('ro.product.model'),
                getProp('ro.build.version.release'),
                getProp('ro.product.cpu.abi')
            ]);

            return { id: serial, model, version, arch };
        } catch (e) {
            console.error(`[ConnectionService] Failed to get device info for ${serial}`);
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
            const stdout = await processManager.executeQuickTask(`"${this.adbPath}" devices`, { timeout: timeoutMs });
            const lines = stdout.split('\n');
            const rawDevicesData = [];

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line || line.includes('List of devices')) continue;

                const [serial, state] = line.split(/\s+/);

                if (serial && state === 'device') {
                    const info = await this.getDeviceInfo(serial);
                    if (info) {
                        rawDevicesData.push({
                            ...info,
                            status: 'connected',
                            connectionType: 'usb'
                        });
                    }
                }
            }
            return { success: true, devices: rawDevicesData };
        } catch (error) {
            const isKilledByTimeout =
                error?.error?.signal === 'SIGTERM' ||
                error?.error?.code === null ||
                String(error?.stderr || '').toLowerCase().includes('killed');
            if (!(suppressTimeoutLog && isKilledByTimeout)) {
                console.error("[ConnectionService] ADB Error:", error);
            }
            return { success: false, devices: [] };
        }
    }

    async smartConnect(ip, port, deviceId) {
        const result = await this.connectDevice(ip, port, deviceId);
        const raw = String(result.raw || '').toLowerCase();
        const msg = String(result.message || '').toLowerCase();
        const text = `${raw}\n${msg}`;

        const connected =
            result.success ||
            text.includes('already connected') ||
            text.includes('connected to');

        if (connected) {
            return {
                success: true,
                status: 'connected',
                message: 'Connected successfully',
                target: `${ip}:${port}`,
                raw: result.raw
            };
        }

        const networkFailure =
            text.includes('timed out') ||
            text.includes('timeout') ||
            text.includes('no route to host') ||
            text.includes('network is unreachable');

        if (networkFailure) {
            return {
                success: false,
                status: 'failed_network',
                message: 'Connection timed out',
                target: `${ip}:${port}`,
                raw: result.raw
            };
        }

        return {
            success: false,
            status: 'needs_pairing',
            message: 'Direct connect failed; pairing required',
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
        console.log("[ConnectionService] البحث عن خدمات ADB Connect...");
        const browser = this.bonjour.find({ type: 'adb-tls-connect' });

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
        console.log("[ConnectionService] البحث عن طلبات Pairing...");
        const pairingBrowser = this.bonjour.find({ type: 'adb-tls-pairing' });

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
        console.log(`[Pairing] Sending pair command to ${ip}:${port}...`);
        
        const result = await processManager.executeAndWatch(
            `pair-${deviceId}`,
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
        console.log(`[Connect] Connecting to ${ip}:${port}...`);

        const result = await processManager.executeAndWatch(
            `connect-${deviceId}`,
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
}

module.exports = new ConnectionService();