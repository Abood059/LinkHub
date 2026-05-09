/*
ORIGINAL CODE (reference - do not delete)

const BaseNode = require('./BaseNode');

class Device extends BaseNode {
    constructor({ id, deviceFriendlyName, model, version, arch, isNew, connectionType }) {
        super({ id, deviceFriendlyName, type: 'MOBILE' });
        this._model = model;
        this._version = version;
        this._arch = arch;
        this._isNew = isNew;
        this.ip = null;
        this.port = null;
        this.status = 'offline';
    }

    get model() { return this._model; }
    get arch() { return this._arch; }
    get version() { return this._version; }
    get isNew() { return this._isNew; }
    set isNew(value) { this._isNew = value; }

    toJSON() {
        return {
            id: this.id,
            model: this.model || 'Unknown',
            deviceFriendlyName: this.deviceFriendlyName || this.model || 'Android Device',
            status: this.status || 'offline',
            isNew: this.isNew
        };
    }

    static fromJSON(data) {
        return new Device({
            id: data.id,
            deviceFriendlyName: data.deviceFriendlyName,
            model: data.model,
            version: data.version,
            arch: data.arch,
            isNew: data.isNew
        });
    }

    getSummary() {
        const connectionState = this.status === 'connected' ? '🟢' : '⚪';
        return `${connectionState} [MOBILE] ${this.friendlyName} (${this._model}) - ${this.status.toUpperCase()}`;
    }
}

module.exports = Device;
*/

const BaseNode = require('./BaseNode');

/**
 * كلاس يمثل الجهاز (الهاتف/التابلت) - النسخة المطورة للربط اللاسلكي
 */
class Device extends BaseNode {
    constructor({ id, deviceFriendlyName, model, version, arch, isNew, connectionType, adbTarget }) {
        super({ id, deviceFriendlyName, type: 'MOBILE' });

        // خصائص تُحفظ في قاعدة البيانات
        this._model = model;
        this._version = version;
        this._arch = arch;
        this._isNew = isNew; // 1 = يحتاج إقران، 0 = مقترن وجاهز

        // خصائص runtime (قد تُحفظ أيضاً كـ "آخر قيمة" مثل ip/port)
        this.ip = null;
        this.port = null;
        this.connectionType = connectionType || null;
        this.adbTarget = adbTarget || null;
        this.status = 'offline';
    }

    get model() { return this._model; }
    get arch() { return this._arch; }
    get version() { return this._version; }
    get isNew() { return this._isNew; }

    set isNew(value) { this._isNew = value; }

    toJSON() {
        return {
            id: this.id,
            type: this.type || 'MOBILE',
            model: this.model || 'Unknown',
            version: this.version || 'Unknown',
            arch: this.arch || 'Unknown',
            deviceFriendlyName: this.deviceFriendlyName || this.model || 'Android Device',
            ip: this.ip || null,
            port: this.port || null,
            connectionType: this.connectionType || null,
            adbTarget: this.adbTarget || null,
            status: this.status || 'offline',
            isNew: this.isNew
        };
    }

    static fromJSON(data) {
        // قاعدة البيانات تستخدم friendly_name بينما الكود يستخدم deviceFriendlyName
        const name = data.deviceFriendlyName || data.friendly_name;
        const device = new Device({
            id: data.id,
            deviceFriendlyName: name,
            model: data.model,
            version: data.version,
            arch: data.arch,
            isNew: data.isNew,
            connectionType: data.connectionType,
            adbTarget: data.adbTarget
        });

        // runtime fields from DB (if present)
        if (data.ip) device.ip = data.ip;
        if (data.port) device.port = data.port;
        if (data.connectionType) device.connectionType = data.connectionType;
        if (data.adbTarget) device.adbTarget = data.adbTarget;

        return device;
    }

    getSummary() {
        const connectionState = this.status === 'connected' ? '🟢' : '⚪';
        return `${connectionState} [MOBILE] ${this.friendlyName} (${this.model}) - ${String(this.status).toUpperCase()}`;
    }
}

module.exports = Device;