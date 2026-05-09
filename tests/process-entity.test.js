const test = require('node:test');
const assert = require('node:assert/strict');
const ProcessEntity = require('../src/main/models/ProcessEntity');

test('ProcessEntity addLog splits lines and tags stdout/stderr with timestamps', () => {
    const e = new ProcessEntity({ maxBufferSize: 100 });
    e.addLog('a\nb\n', 'stdout');
    assert.equal(e.logs.length, 2);
    assert.equal(e.logs[0].text, 'a');
    assert.equal(e.logs[0].type, 'stdout');
    assert.equal(e.logs[1].text, 'b');
    assert.ok(Number.isFinite(e.logs[0].timestamp));
});

test('ProcessEntity carries incomplete line across chunks', () => {
    const e = new ProcessEntity({});
    e.addLog('hel', 'stdout');
    e.addLog('lo\nx\n', 'stdout');
    assert.deepEqual(
        e.logs.map((l) => l.text),
        ['hello', 'x']
    );
});

test('ProcessEntity FIFO drops oldest when over maxBufferSize', () => {
    const e = new ProcessEntity({ maxBufferSize: 3 });
    for (const n of ['1', '2', '3', '4']) {
        e.addLog(`${n}\n`, 'stdout');
    }
    assert.deepEqual(
        e.logs.map((l) => l.text),
        ['2', '3', '4']
    );
});

test('ProcessManager buffers stdout/stderr on active child', async () => {
    const processManager = require('../src/main/services/process.manager.service');
    const id = `pm-test-${Date.now()}`;
    const child = processManager.execute(
        id,
        process.execPath,
        [
            '-e',
            'for (let i = 0; i < 5; i++) console.log("L" + i); console.error("E"); setInterval(() => {}, 60000);'
        ],
        'test',
        null,
        20
    );
    assert.ok(child);

    await new Promise((r) => setTimeout(r, 100));

    const logs = processManager.getLogs(id);
    assert.ok(Array.isArray(logs));
    assert.ok(logs.some((l) => l.type === 'stdout'));
    assert.ok(logs.some((l) => l.type === 'stderr'));

    const formatted = processManager.getFormattedLogs(id);
    assert.ok(formatted.includes('[ERR]'));
    assert.ok(formatted.includes('L'));

    processManager.terminate(id);
});
