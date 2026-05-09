const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshRequire(modulePath) {
  // Ensure module singletons are re-created per test.
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

async function tableInfo(db, tableName) {
  const rows = await db.queryAll(`PRAGMA table_info(${tableName})`);
  return rows.map((r) => r.name);
}

test('Database schema: existing nodes table missing ip/port gets migrated', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linkhub-test-'));
  const oldCwd = process.cwd();
  process.chdir(tmp);

  try {
    // Create an "old" schema with no ip/port columns.
    const sqlite3 = require('sqlite3').verbose();
    const dbFolder = path.join(process.cwd(), 'data');
    fs.mkdirSync(dbFolder, { recursive: true });
    const dbPath = path.join(dbFolder, 'linkhub.sqlite');
    const rawDb = new sqlite3.Database(dbPath);

    await new Promise((resolve, reject) => {
      rawDb.run(
        `
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          friendly_name TEXT,
          model TEXT,
          version TEXT,
          arch TEXT,
          last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
        (err) => (err ? reject(err) : resolve()),
      );
    });

    await new Promise((resolve, reject) => rawDb.close((err) => (err ? reject(err) : resolve())));

    // Now load the app DatabaseManager which should migrate.
    const dbManager = freshRequire('../src/main/services/database.manager.service');
    await dbManager.initDb();

    const cols = await tableInfo(dbManager, 'nodes');
    assert.ok(cols.includes('ip'));
    assert.ok(cols.includes('port'));

    await dbManager.close();
  } finally {
    process.chdir(oldCwd);
  }
});

