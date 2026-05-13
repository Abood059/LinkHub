const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const errorService = require('./error.central.service');

class DatabaseManager {
    constructor() {
        // Fix: Add connection status tracking to prevent initDb freezing on connection failure
        this._connectionOk = false;
        
        try {
            // 1. تأمين مسار المجلد (Data Persistence)
            const dbFolder = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dbFolder)) {
                fs.mkdirSync(dbFolder, { recursive: true });
            }

            const dbPath = path.join(dbFolder, 'linkhub.sqlite');

            // 2. الاتصال بالقاعدة
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    this._reportError('CRITICAL', `Database Connection Failed: ${err.message}`);
                } else {
                    console.log('[DatabaseManager] Connected to SQLite.');
                    // Fix: Mark connection as successful before schema init
                    this._connectionOk = true;
                    // Fix: Assign Promise with error handling to prevent race condition
                    this._schemaReady = this._initSchema().catch(err => {
                        this._reportError('CRITICAL', `Schema initialization failed: ${err.message}`);
                        // Fix: Remove throw err to prevent unhandled Promise rejection
                    });
                }
            });
        } catch (err) {
            this._reportError('CRITICAL', `Initial Database Setup Error: ${err.message}`);
        }
    }


    async _getTableColumns(tableName) {
        // Fix: Prevent SQL injection by validating table name format
        if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
            // Fix: Log table name validation errors via ErrorCentralService
            this._reportError('LOW', `Invalid table name attempted: ${tableName}`);
            throw new Error(`Invalid table name: ${tableName}`);
        }
        const rows = await this.queryAll(`PRAGMA table_info(${tableName})`);
        return rows.map((r) => r.name);
    }

    async _ensureColumn(tableName, columnName, columnTypeSql) {
        const cols = await this._getTableColumns(tableName);
        if (cols.includes(columnName)) return;
        await this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnTypeSql}`);
    }

    /**
     * تهيئة الجداول + تطبيق migrations على قواعد قديمة
     */
    async _initSchema() {
        try {
            const nodesTable = `
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,           -- السيريال نمبر (ID الفريد)
                    type TEXT NOT NULL,            -- نوع الجهاز (MOBILE, TV, الخ)
                    friendly_name TEXT,            -- الاسم الذي يختاره المستخدم
                    model TEXT,                    -- موديل الجهاز (e.g. SM-G991B)
                    version TEXT,                  -- إصدار الأندرويد
                    arch TEXT,                     -- المعمارية (arm64, الخ)
                    ip TEXT,                       -- آخر IP تم الاتصال به
                    port INTEGER,                  -- المنفذ المستخدم
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;

            const processLogsTable = `
                CREATE TABLE IF NOT EXISTS process_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT,
                    process_type TEXT,
                    exit_code INTEGER,
                    duration INTEGER,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;

            await this.execute(nodesTable);
            await this.execute(processLogsTable);

            // Migrations for existing installations created قبل إضافة ip/port.
            await this._ensureColumn('nodes', 'ip', 'TEXT');
            await this._ensureColumn('nodes', 'port', 'INTEGER');
            await this._ensureColumn('nodes', 'version', 'TEXT');
            await this._ensureColumn('nodes', 'arch', 'TEXT');
            await this._ensureColumn('nodes', 'model', 'TEXT');
            await this._ensureColumn('nodes', 'friendly_name', 'TEXT');
            // Add wireless connection properties for persistence across restarts
            await this._ensureColumn('nodes', 'connection_type', 'TEXT');
            await this._ensureColumn('nodes', 'adb_target', 'TEXT');

            console.log('[DatabaseManager] Schema initialized successfully.');
        } catch (err) {
            this._reportError('HIGH', `Schema Initialization Error: ${err.message}`);
            // Fix: Remove throw err to eliminate duplicate error logging
            return;
        }
    }

    async initDb() {
        // Fix: Wait until connection is confirmed with timeout to prevent freezing
        if (!this._connectionOk) {
            await new Promise((resolve, reject) => {
                const start = Date.now();
                const check = () => {
                    if (this._connectionOk) return resolve();
                    if (Date.now() - start > 5000) {
                        const msg = 'Database connection timed out';
                        this._reportError('CRITICAL', msg);
                        return reject(new Error(msg));
                    }
                    setTimeout(check, 20);
                };
                check();
            });
        }
        
        // Wait for schema initialization to complete
        if (this._schemaReady) {
            await this._schemaReady;
        }
    }

    /**
     * تنفيذ استعلامات تعديل البيانات (INSERT, UPDATE, DELETE)
     */
    async execute(sql, params = []) {
        try {
            return await new Promise((resolve, reject) => {
                this.db.run(sql, params, function (err) {
                    if (err) reject(err);
                    else resolve({ lastID: this.lastID, changes: this.changes });
                });
            });
        } catch (err) {
            this._reportError('HIGH', `[DB] Query failed: ${err.message}`);
            throw err;
        }
    }

    /**
     * جلب سجل واحد فقط
     */
    async queryOne(sql, params = []) {
        try {
            return await new Promise((resolve, reject) => {
                this.db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        } catch (err) {
            this._reportError('HIGH', `[DB] Query failed: ${err.message}`);
            throw err;
        }
    }

    /**
     * جلب مجموعة سجلات
     */
    async queryAll(sql, params = []) {
        try {
            return await new Promise((resolve, reject) => {
                this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
        } catch (err) {
            this._reportError('HIGH', `[DB] Query failed: ${err.message}`);
            throw err;
        }
    }

    _reportError(severity, message) {
        errorService.report({
            type: 'SYSTEM',
            severity: severity,
            message: `[DatabaseManager] ${message}`
        });
    }

    async close() {
        try {
            return await new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) reject(err);
                    else {
                        console.log('[DatabaseManager] Connection closed.');
                        resolve();
                    }
                });
            });
        } catch (err) {
            this._reportError('HIGH', `[DB] Close failed: ${err.message}`);
        }
    }
}

module.exports = new DatabaseManager();