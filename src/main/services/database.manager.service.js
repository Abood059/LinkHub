/*
ORIGINAL CODE (reference - do not delete)

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const errorService = require('./error.central.service');

class DatabaseManager {
    constructor() {
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
                    this._initSchema();
                }
            });
        } catch (err) {
            this._reportError('CRITICAL', `Initial Database Setup Error: ${err.message}`);
        }
    }

    async _initSchema() {
        try {
            const nodesTable = `
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    friendly_name TEXT,
                    model TEXT,
                    version TEXT,
                    arch TEXT,
                    ip TEXT,
                    port INTEGER,
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
            console.log('[DatabaseManager] Schema initialized successfully.');
        } catch (err) {
            this._reportError('HIGH', `Schema Initialization Error: ${err.message}`);
        }
    }

    async initDb() {
        return new Promise((resolve) => {
            if (this.db) resolve();
            else {
                const checkInterval = setInterval(() => {
                    if (this.db) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            }
        });
    }
}

module.exports = new DatabaseManager();
*/

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const errorService = require('./error.central.service');

class DatabaseManager {
    constructor() {
        this.db = null;
        this._schemaReady = null;

        try {
            const dbFolder = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dbFolder)) {
                fs.mkdirSync(dbFolder, { recursive: true });
            }

            const dbPath = path.join(dbFolder, 'linkhub.sqlite');

            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    this._reportError('CRITICAL', `Database Connection Failed: ${err.message}`);
                    return;
                }

                console.log('[DatabaseManager] Connected to SQLite.');
                // Track readiness so callers can await schema/migrations.
                this._schemaReady = this._initSchema();
            });
        } catch (err) {
            this._reportError('CRITICAL', `Initial Database Setup Error: ${err.message}`);
        }
    }

    async _getTableColumns(tableName) {
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

            console.log('[DatabaseManager] Schema initialized successfully.');
        } catch (err) {
            this._reportError('HIGH', `Schema Initialization Error: ${err.message}`);
            throw err;
        }
    }

    /**
     * التأكد من جاهزية الاتصال + اكتمال schema/migrations قبل الاستخدام
     */
    async initDb() {
        // Wait for connection to be established
        await new Promise((resolve) => {
            if (this.db) resolve();
            else {
                const checkInterval = setInterval(() => {
                    if (this.db) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 50);
            }
        });

        // Wait until schema init has been scheduled (connection callback)
        await new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const checkInterval = setInterval(() => {
                if (this._schemaReady) {
                    clearInterval(checkInterval);
                    resolve();
                    return;
                }
                if (Date.now() - startedAt > 5000) {
                    clearInterval(checkInterval);
                    reject(new Error('Database schema initialization did not start in time.'));
                }
            }, 25);
        });

        // Wait for schema init/migrations completion
        await this._schemaReady;
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
            console.error(`[DB Execute Error]: ${err.message}`);
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
            console.error(`[DB QueryOne Error]: ${err.message}`);
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
            console.error(`[DB QueryAll Error]: ${err.message}`);
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
            console.error(`[DB Close Error]: ${err.message}`);
        }
    }
}

module.exports = new DatabaseManager();