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
                connectionType: data.connectionType || null,
                adbTarget: data.adbTarget || null
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
            INSERT INTO nodes (id, type, friendly_name, model, version, arch, ip, port, connection_type, adb_target)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                friendly_name = excluded.friendly_name,
                model = excluded.model,
                version = excluded.version,
                arch = excluded.arch,
                ip = excluded.ip,
                port = excluded.port,
                connection_type = excluded.connection_type,
                adb_target = excluded.adb_target,
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
                data.port || null,
                data.connectionType || null,
                data.adbTarget || null
            ];

            await db.execute(sql, params);

            // Fix: Don't change device state after saving - registration/update, not actual connection
            device.isNew = false;
            
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

        // Security: Only registered devices may transition to connected state
        // This prevents unregistered discovered devices from reaching connected state
        if (newStatus === 'connected' && !this.devices.has(id)) {
            this._reportError('HIGH', `Security violation: Unregistered device ${id} attempted to transition to connected state`);
            return null;
        }

        // Fix: Validate state transitions according to four-state matrix
        // Added available→offline transition for when devices disappear
        const validTransitions = {
            'offline': ['available', 'connected'],
            'available': ['connected', 'offline'],  // Added offline transition
            'connected': ['offline', 'available']
        };

        const currentStatus = device.status;  // Use getter to access current status
        if (!validTransitions[currentStatus]?.includes(newStatus)) {
            this._reportError('HIGH', `Invalid state transition: ${currentStatus} → ${newStatus}`);
            return null;
        }

        // Apply state change using setter to ensure Device model protections
        device.status = newStatus;

        // Apply extra data (ip, port, connectionType, adbTarget)
        if (extraData.ip) device.ip = extraData.ip;
        if (extraData.port) device.port = extraData.port;
        if (extraData.connectionType) device.connectionType = extraData.connectionType;
        if (extraData.adbTarget) device.adbTarget = extraData.adbTarget;

        return device;
    }

    /**
     * تنظيف الحالة عند فصل الجهاز
     */
    cleanupDevice(id) {
        const device = this.getAnyDevice(id);
        if (!device) return null;

        // Fix: Log unexpected disconnection for connected devices
        if (device.status === 'connected') {
            this._reportError('LOW', `Device ${id} unexpectedly disconnected`);
        }

        // الحالة دائماً تصبح offline عند الفصل - use setter to ensure Device model protections
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
     * Helper method to set device status to connected
     */
    setDeviceConnected(id) {
        return this.updateDeviceStatus(id, 'connected', {});
    }

    /**
     * Helper method to set device status to available
     */
    setDeviceAvailable(id) {
        return this.updateDeviceStatus(id, 'available', {});
    }

    /**
     * إضافة جهاز مكتشف بواسطة الرادار (ADB Scanner)
     * 
     * Return Behavior:
     * - Returns true if the device was successfully added to discoveredDevices
     * - Returns false if the device is already registered in this.devices or if the device object is invalid
     * - This prevents duplicate registration and maintains the integrity of the discovered vs. registered device separation
     * - Consuming code should handle the false return to prevent silent failures
     */
    addDiscoveredDevice(device) {
        if (device && device.id) {
            // Prevent adding devices that are already registered
            if (this.devices.has(device.id)) {
                this._reportError('LOW', `Attempted to add already registered device as discovered: ${device.id}`);
                return false;
            }
            
            // Set proper state for discovered devices
            device.isNew = true;
            device.status = 'available';
            
            this.discoveredDevices.set(device.id, device);
            return true;
        }
        return false;
    }

    /**
     * ربط جهاز مكتشف بجهاز مسجل إذا تطابق السيريال.
     * في حال كان الجهاز مسجلاً مسبقاً يتم تحديثه فقط ولا يضاف للرادار.
     */
    mapDiscoveredDevice(discoveredData) {
        // Extract id from scanner data - may contain serial instead of id
        const id = discoveredData.serial || discoveredData.id;

        // If device is already registered, update network data with proper state transitions
        if (this.devices.has(id)) {
            const device = this.devices.get(id);
            
            // Handle different current states appropriately
            if (device.status === 'offline') {
                // Change to available (ready for connection, not actually connected yet)
                device.status = 'available';
                
                // Update network properties
                if (discoveredData.ip) device.ip = discoveredData.ip;
                if (discoveredData.port) device.port = discoveredData.port;
                if (discoveredData.connectionType) device.connectionType = discoveredData.connectionType;
                if (discoveredData.adbTarget) device.adbTarget = discoveredData.adbTarget;
                
                // Remove from discovered devices if present
                this.discoveredDevices.delete(id);
                return { mapped: true, device };
            }
            else if (['available', 'connected'].includes(device.status)) {
                // Update only network data without changing state
                if (discoveredData.ip) device.ip = discoveredData.ip;
                if (discoveredData.port) device.port = discoveredData.port;
                if (discoveredData.connectionType) device.connectionType = discoveredData.connectionType;
                if (discoveredData.adbTarget) device.adbTarget = discoveredData.adbTarget;
                
                // Remove from discovered devices if present
                this.discoveredDevices.delete(id);
                return { mapped: true, device };
            }
            
            // No change needed for other states
            return { mapped: true, device };
        }
        
        // If device is not registered, create via createDevice with proper state
        const device = this.createDevice({
            id,
            ...discoveredData,
            isNew: true,
            status: 'available'  // Ready for connection, not connected
        });
        
        if (!device) {
            this._reportError('LOW', `Failed to create device for discovered data: ${id}`);
            return { mapped: false, device: null };
        }
        
        // Add to discovered devices
        const added = this.addDiscoveredDevice(device);
        if (!added) {
            // Warning: This should not happen since we already validated the device is not registered
            // but logging helps with future debugging if logic changes
            this._reportError('LOW', `Failed to add discovered device to radar: ${id} - may indicate logic error`);
        }
        return { mapped: false, device };
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