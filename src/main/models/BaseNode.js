/*
ORIGINAL CODE (reference - do not delete)

class BaseNode {
    constructor({ id, deviceFriendlyName, type }) {
        this._id = id;
        this._deviceFriendlyName = deviceFriendlyName;
        this._type = type;

        this.ip = null;
        this.status = 'disconnected';
        this.lastSeen = null;
    }

    get id() { return this._id; }
    get friendlyName() { return this._deviceFriendlyName; }
    get type() { return this._type; }

    setOnline(ip) {
        this.ip = ip;
        this.status = 'online';
        this.lastSeen = new Date();
    }

    setDisconnected() {
        this.status = 'disconnected';
    }

    toJSON() {
        return {
            id: this._id,
            deviceFriendlyName: this._deviceFriendlyName,
            type: this._type
        };
    }
}

module.exports = BaseNode;
*/

/**
 * الكلاس الأساسي (Base Class) لجميع العقد والأجهزة في النظام.
 * يحتوي على البيانات المشتركة للهوية والاتصال.
 */
class BaseNode {
    constructor({ id, deviceFriendlyName, type }) {
        this._id = id; // معرف فريد (UUID أو Serial)
        this._deviceFriendlyName = deviceFriendlyName; // الاسم الودي (مثلاً: هاتف أحمد)
        this._type = type; // نوع العقدة (MOBILE, MEDIA_NODE, etc.)

        // --- حالة الشبكة (Runtime State) ---
        this.ip = null;
        this.status = 'disconnected';
        this.lastSeen = null;
    }

    // --- Getters/Setters ---
    get id() { return this._id; }
    get type() { return this._type; }

    // Support both naming styles used across the codebase.
    get friendlyName() { return this._deviceFriendlyName; }
    get deviceFriendlyName() { return this._deviceFriendlyName; }
    set deviceFriendlyName(value) { this._deviceFriendlyName = value; }

    setOnline(ip) {
        this.ip = ip;
        this.status = 'online';
        this.lastSeen = new Date();
    }

    setDisconnected() {
        this.status = 'disconnected';
    }

    toJSON() {
        return {
            id: this._id,
            deviceFriendlyName: this._deviceFriendlyName,
            type: this._type
        };
    }
}

module.exports = BaseNode;