const { ipcMain } = require('electron');
const {
    deviceManager,
    connectionService,
    windowManager,
    errorCentralService,
    processManager
} = require('../services');
const startupController = require('../controllers/StartupController');
const deviceInteractionController = require('../controllers/device.interaction.controller');
const streamingController = require('../controllers/streaming.controller');

class DeviceHandler {
    constructor() {
        this.startupReport = null;
        this.startupReady = this.initializeData();
        this.setupEventListeners();
        this.setupIpcHandlers();
    }

    async initializeData() {
        try {
            this.startupReport = await startupController.init();
            if (!this.startupReport.success) {
                console.error('[DeviceHandler] Startup failed:', this.startupReport);
            }
        } catch (err) {
            console.error("[DeviceHandler] خطأ في تحميل البيانات:", err);
            this.startupReport = {
                success: false,
                step: 'startup-controller',
                error: err.message
            };
            errorCentralService.report({
                type: 'SYSTEM',
                severity: 'CRITICAL',
                message: `[DeviceHandler] Startup failed: ${err.message}`
            });
        }
    }

    async ensureStartupReady() {
        await this.startupReady;
        if (!this.startupReport || !this.startupReport.success) {
            const error = new Error(this.startupReport?.error || 'Application startup did not complete successfully.');
            error.step = this.startupReport?.step || 'unknown';
            throw error;
        }
    }

    setupEventListeners() {
        // 1. اكتشاف جهاز عبر USB (يعتبر متصلاً فوراً)
        connectionService.on('usb-device-connected', async (rawDevice) => {
            console.log(`[Handler] تم اكتشاف اتصال USB للجهاز: ${rawDevice.id}`);
        
            let device = deviceManager.getDevice(rawDevice.id);
        
            if (!device) {
                // إذا كان أول مرة، ننشئه ونعطيه موديل الجهاز كاسم افتراضي بدلاً من undefined
                device = deviceManager.createDevice({ 
                    ...rawDevice, 
                    deviceFriendlyName: rawDevice.model, // نستخدم الموديل كاسم مبدئي
                    isNew: false 
                });
                await deviceManager.saveDevice(device);
            }
        
            // القفزة الأهم: تحديث الحالة في الذاكرة فوراً ليكون متاحاً للبث
            deviceManager.updateDeviceStatus(rawDevice.id, 'connected', {
                connectionType: 'usb'
            });
        
            this.syncUI();
        });

        // 2. فصل جهاز USB
        connectionService.on('usb-device-disconnected', (data) => {
            deviceManager.setDeviceOffline(data.id);
            this.syncUI();
        });

        // حدث موحد عند اختفاء الجهاز من heartbeat المراقب.
        connectionService.on('device-disconnected', (data) => {
            if (!data?.id) return;
            deviceManager.setDeviceOffline(data.id);
            this.syncUI();
        });

        // 3. ظهور جهاز في الشبكة (متاح للاقتران أو الاتصال)
        connectionService.on('wireless-service-up', async (rawService) => {
            await deviceInteractionController.handleWirelessDiscovery(rawService);
        });

        // 4. اختفاء جهاز من الشبكة
        connectionService.on('wireless-service-down', (data) => {
            deviceManager.setDeviceOffline(data.id);
            this.syncUI();
        });

    }

    setupIpcHandlers() {
        // جلب الأجهزة للواجهة (تنسيق البيانات لتكون خفيفة ومناسبة للعرض)
        ipcMain.handle('devices:get-all', async () => {
            try {
                await this.ensureStartupReady();
                return {
                    registered: deviceManager.getRegisteredDevices().map(d => d.toJSON()),
                    discovered: this._getUniqueDiscoveredDevices()
                };
            } catch (error) {
                return { registered: [], discovered: [], startupError: error.message, step: error.step };
            }
        });

        // معالجة طلب الإقران (Pairing)
        ipcMain.handle('devices:pair', async (event, { id, ip, port, code }) => {
            try {
                await this.ensureStartupReady();
                this._broadcastInteractionState({ deviceId: id, state: 'loading', phase: 'pairing' });
                return await deviceInteractionController.handlePairing({ id, ip, port, code });
            } catch (error) {
                return { success: false, message: error.message };
            } finally {
                this._broadcastInteractionState({ deviceId: id, state: 'idle', phase: 'pairing' });
            }
        });

        ipcMain.handle('devices:interact', async (event, deviceId) => {
            try {
                await this.ensureStartupReady();
                this._broadcastInteractionState({ deviceId, state: 'loading', phase: 'connecting' });
                const result = await deviceInteractionController.handleDeviceInteraction(deviceId, {
                    onState: (payload) => this._broadcastInteractionState(payload)
                });
                if (result.status === 'needs_pairing') {
                    this.syncUI();
                }
                return result;
            } catch (error) {
                return { success: false, status: 'error', message: error.message };
            } finally {
                this._broadcastInteractionState({ deviceId, state: 'idle', phase: 'done' });
            }
        });

        // معالجة طلب البث (Mirroring)
        ipcMain.handle('devices:stream', async (event, deviceId) => {
            try {
                await this.ensureStartupReady();
                return await streamingController.startStream(deviceId);
            } catch (error) {
                return { success: false, message: error.message || "فشل تشغيل البث" };
            }
        });

        // إيقاف البث
        ipcMain.handle('devices:stop-stream', async (event, deviceId) => {
            try {
                await this.ensureStartupReady();
                return await streamingController.stopStream(deviceId);
            } catch (error) {
                return { success: false, message: error.message };
            }
        });

        /** سجل مخرجات عملية البث النشطة (scrcpy) من الـ buffer داخل ProcessEntity */
        ipcMain.handle('devices:get-stream-logs', async (event, deviceId) => {
            try {
                await this.ensureStartupReady();
                const processId = `scrcpy-${deviceId}`;
                const logs = processManager.getLogs(processId);
                const formatted = processManager.getFormattedLogs(processId);
                return { logs, formatted };
            } catch (error) {
                return { logs: null, formatted: null, error: error.message };
            }
        });
    }

    /**
     * إرسال البيانات المحدثة للواجهة
     * نقوم بتحويل الكائنات إلى JSON بسيط لإرساله عبر الـ IPC
     */
    syncUI() {
        const data = {
            registered: deviceManager.getRegisteredDevices().map(d => d.toJSON()),
            discovered: this._getUniqueDiscoveredDevices()
        };

        windowManager.broadcast('devices:update-list', data);
    }

    _broadcastInteractionState(payload) {
        windowManager.broadcast('devices:interaction-state', payload);
    }

    _getUniqueDiscoveredDevices() {
        const registeredIds = new Set(deviceManager.getRegisteredDevices().map(d => d.id));
        return deviceManager
            .getDiscoveredDevices()
            .map(d => d.toJSON())
            .filter(d => !registeredIds.has(d.id));
    }
}

module.exports = new DeviceHandler();