

const BaseNode = require('./BaseNode');
const errorService = require('../services/error.central.service');

/**
 * كلاس يمثل الجهاز (الهاتف/التابلت) - النسخة المطورة للربط اللاسلكي
 */
class Device extends BaseNode {
    constructor({ id, deviceFriendlyName, model, version, arch, isNew, connectionType, adbTarget }) {
        super({ id, deviceFriendlyName, type: 'MOBILE' });

        // Protected properties with validation
        this._model = model;
        this._version = version;
        this._arch = arch;
        this._isNew = isNew; // 1 = يحتاج إقران، 0 = مقترن وجاهز

        // Runtime properties (may be saved as "last values" like ip/port)
        this._status = 'offline';
        this._ip = null;
        this._port = null;
        this._connectionType = connectionType || null;
        this._adbTarget = adbTarget || null;
    }

    // Getters for protected properties
    get model() { return this._model; }
    get arch() { return this._arch; }
    get version() { return this._version; }
    get isNew() { return this._isNew; }
    get status() { return this._status; }
    get ip() { return this._ip; }
    get port() { return this._port; }
    get connectionType() { return this._connectionType; }
    get adbTarget() { return this._adbTarget; }

    // Setters with validation
    set status(value) {
        // Device state matrix: offline → available → connected → offline
        // States represent: offline (disconnected), available (discovered/ready), connected (active session)
        if (!['offline', 'available', 'connected'].includes(value)) {
            errorService.report({
                type: 'DEVICE',
                severity: 'LOW',
                message: `Invalid device status: ${value}`,
                id: this.id
            });
            return;
        }
        this._status = value;
    }

    set ip(value) {
        if (value !== null && typeof value !== 'string') {
            errorService.report({
                type: 'DEVICE',
                severity: 'LOW',
                message: `Invalid IP address: ${value}`,
                id: this.id
            });
            return;
        }
        this._ip = value;
    }

    set port(value) {
        if (value !== null && (typeof value !== 'number' || value < 1 || value > 65535)) {
            errorService.report({
                type: 'DEVICE',
                severity: 'LOW',
                message: `Invalid port: ${value}`,
                id: this.id
            });
            return;
        }
        this._port = value;
    }

    set connectionType(value) {
        if (!['usb', 'wireless', null].includes(value)) {
            errorService.report({
                type: 'DEVICE',
                severity: 'LOW',
                message: `Invalid connection type: ${value}`,
                id: this.id
            });
            return;
        }
        this._connectionType = value;
    }

    set adbTarget(value) {
        if (value !== null && (typeof value !== 'string' || value.length > 100)) {
            errorService.report({
                type: 'DEVICE',
                severity: 'LOW',
                message: `Invalid ADB target: ${value}`,
                id: this.id
            });
            return;
        }
        this._adbTarget = value;
    }

    static fromJSON(data) {
        // Database uses snake_case while application uses camelCase
        // This compatibility layer handles both naming conventions temporarily
        // Some services use SELECT * and pass rows directly without name conversion
        const name = data.deviceFriendlyName || data.friendly_name;
        const device = new Device({
            id: data.id,
            deviceFriendlyName: name,
            model: data.model,
            version: data.version,
            arch: data.arch,
            isNew: data.isNew,
            connectionType: data.connectionType || data.connection_type,
            adbTarget: data.adbTarget || data.adb_target
        });

        // Runtime fields from DB (if present) - handle both naming conventions
        if (data.ip) device.ip = data.ip;
        if (data.port) device.port = data.port;
        if (data.connectionType || data.connection_type) {
            device.connectionType = data.connectionType || data.connection_type;
        }
        if (data.adbTarget || data.adb_target) {
            device.adbTarget = data.adbTarget || data.adb_target;
        }

        return device;
    }

    getSummary() {
        const connectionState = this.status === 'connected' ? '🟢' : '⚪';
        return `${connectionState} [MOBILE] ${this.friendlyName} (${this.model}) - ${String(this.status).toUpperCase()}`;
    }
}

module.exports = Device;