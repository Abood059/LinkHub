const db = require('./database.manager.service');
const Device = require('../models/Device');
const errorService = require('./error.central.service');

class DeviceManager {
    constructor() {
        this.devices = new Map(); // الأجهزة المسجلة (الموجودة في القاعدة)
        this.discoveredDevices = new Map(); // الأجهزة المكتشفة حالياً (الرادار)
    }

    /**
     * تحميل كافة الأجهزة من القاعدة إلى الذاكرة
     */
    async loadAllDevices() {
        try {
            const rows = await db.queryAll("SELECT * FROM nodes");

            this.devices.clear();
            rows.forEach(row => {
                const deviceObj = Device.fromJSON(row);
                
                // المنطق: أي جهاز في القاعدة هو مسجل (isNew = false)
                // وحالته المبدئية عند تشغيل التطبيق هي 'offline'
                deviceObj.isNew = false;
                deviceObj.status = 'offline';

                this.devices.set(deviceObj.id, deviceObj);
            });

            console.log(`[DeviceManager] تم تحميل ${this.devices.size} جهاز مسجل من القاعدة.`);
            return this.getRegisteredDevices();
        } catch (err) {
            this._reportError('HIGH', `فشل تحميل الأجهزة من القاعدة: ${err.message}`);
            throw err;
        }
    }

    /**
     * Factory Method: إنشاء كائن Device جديد
     */
    createDevice(data) {
        try {
            return new Device({
                id: data.serial || data.id,
                deviceFriendlyName: data.friendlyName || data.model || "New Android Device",
                model: data.model || "Unknown",
                version: data.version || "Unknown",
                arch: data.arch || "Unknown",
                isNew: data.isNew !== undefined ? data.isNew : true,
                status: data.status || 'offline',
                connectionType: data.connectionType || null
            });
        } catch (err) {
            this._reportError('LOW', `خطأ في إنشاء كائن الجهاز: ${err.message}`);
            return null;
        }
    }

    /**
     * حفظ جهاز (عملية التسجيل/الاقتران)
     */
    async saveDevice(device) {
        const sql = `
            INSERT INTO nodes (id, type, friendly_name, model, version, arch, ip, port)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                friendly_name = excluded.friendly_name,
                model = excluded.model,
                version = excluded.version,
                arch = excluded.arch,
                ip = excluded.ip,
                port = excluded.port,
                last_seen = CURRENT_TIMESTAMP
        `;

        try {
            const data = device.toJSON();
            const params = [
                data.id,
                data.type || 'MOBILE',
                data.deviceFriendlyName,
                data.model,
                data.version,
                data.arch,
                data.ip || null,
                data.port || null
            ];

            await db.execute(sql, params);

            // بعد الحفظ: نحدث الحالة البرمجية
            device.isNew = false;
            
            // إذا تم الحفظ والجهاز كان 'available'، نحوله فوراً لـ 'connected'
            if (device.status === 'available') {
                device.status = 'connected';
            }

            this.devices.set(device.id, device);
            this.discoveredDevices.delete(device.id);

            return true;
        } catch (err) {
            this._reportError('HIGH', `فشل حفظ الجهاز ${device.id}: ${err.message}`);
            return false;
        }
    }

    /**
     * تحديث حالة الاتصال اللحظية (status) ودمج البيانات الشبكية
     */
    updateDeviceStatus(id, newStatus, extraData = {}) {
        const device = this.getAnyDevice(id);

        if (!device) {
            console.warn(`[DeviceManager] محاولة تحديث حالة جهاز غير موجود: ${id}`);
            return null;
        }

        // تحديث الحالة الفيزيائية (offline, available, connected)
        device.status = newStatus;

        // تحديث البيانات الإضافية إن وجدت
        if (extraData.ip) device.ip = extraData.ip;
        if (extraData.port) device.port = extraData.port;
        if (extraData.connectionType) device.connectionType = extraData.connectionType;

        return device;
    }

    /**
     * تنظيف الحالة عند فصل الجهاز
     */
    cleanupDevice(id) {
        const device = this.getAnyDevice(id);
        if (!device) return null;

        // الحالة دائماً تصبح offline عند الفصل
        device.status = 'offline';

        // إذا كان الجهاز غير مسجل (مكتشف فقط) وفُصل، نحذفه تماماً من الرادار
        if (device.isNew && this.discoveredDevices.has(id)) {
            this.discoveredDevices.delete(id);
            return { id, action: 'removed' };
        }

        // إذا كان مسجلاً، يبقى في القائمة ولكن بحالة offline
        return { id, action: 'set_offline' };
    }

    setDeviceOffline(id) {
        return this.cleanupDevice(id);
    }

    /**
     * إضافة جهاز مكتشف بواسطة الرادار (ADB Scanner)
     */
    addDiscoveredDevice(device) {
        if (device && device.id) {
            // الجهاز المكتشف حديثاً يكون 'available' للربط وليس 'connected' مباشرة
            device.status = 'available';
            device.isNew = true;
            this.discoveredDevices.set(device.id, device);
        }
    }

    /**
     * ربط جهاز مكتشف بجهاز مسجل إذا تطابق السيريال.
     * في حال كان الجهاز مسجلاً مسبقاً يتم تحديثه فقط ولا يضاف للرادار.
     */
    mapDiscoveredDevice(discoveredData) {
        if (!discoveredData) return { mapped: false, device: null };

        const id = discoveredData.serial || discoveredData.id;
        if (!id) return { mapped: false, device: null };

        const registered = this.devices.get(id);
        if (registered) {
            this.updateDeviceStatus(id, 'connected', {
                ip: discoveredData.ip,
                port: discoveredData.port,
                connectionType: discoveredData.connectionType || 'wireless'
            });
            this.discoveredDevices.delete(id);
            return { mapped: true, device: registered };
        }

        const discoveredDevice = this.createDevice({
            ...discoveredData,
            id,
            status: discoveredData.status || 'available',
            isNew: true
        });
        this.addDiscoveredDevice(discoveredDevice);
        return { mapped: false, device: discoveredDevice };
    }

    // --- دوال المساعدة للوصول للبيانات ---

    getDevice(id) {
        return this.getAnyDevice(id);
    }

    getAnyDevice(id) {
        return this.devices.get(id) || this.discoveredDevices.get(id);
    }

    getRegisteredDevices() {
        return Array.from(this.devices.values());
    }

    isRegistered(id) {
        return this.devices.has(id);
    }

    getDiscoveredDevices() {
        return Array.from(this.discoveredDevices.values());
    }

    _reportError(severity, message) {
        errorService.report({
            type: 'SYSTEM',
            severity: severity,
            message: `[DeviceManager] ${message}`
        });
    }
}

module.exports = new DeviceManager();