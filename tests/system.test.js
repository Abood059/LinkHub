const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const connectionService = require('../src/main/services/connection.service');
const deviceManager = require('../src/main/services/device.manager.service');
const scrcpyService = require('../src/main/services/scrcpy.service');
const processManager = require('../src/main/services/process.manager.service');

test('services are singletons across imports', () => {
    assert.strictEqual(connectionService, require('../src/main/services/connection.service'));
    assert.strictEqual(deviceManager, require('../src/main/services/device.manager.service'));
    assert.strictEqual(scrcpyService, require('../src/main/services/scrcpy.service'));
    assert.strictEqual(processManager, require('../src/main/services/process.manager.service'));
});

test('DeviceManager maps discovered device to registered by serial', () => {
    const originalDevices = new Map(deviceManager.devices);
    const originalDiscovered = new Map(deviceManager.discoveredDevices);

    try {
        deviceManager.devices.clear();
        deviceManager.discoveredDevices.clear();

        const registered = {
            id: 'SERIAL-001',
            model: 'Pixel',
            status: 'offline',
            isNew: false
        };
        deviceManager.devices.set(registered.id, registered);

        const result = deviceManager.mapDiscoveredDevice({
            serial: 'SERIAL-001',
            ip: '192.168.1.10',
            port: 5555,
            connectionType: 'wireless'
        });

        assert.equal(result.mapped, true);
        assert.equal(deviceManager.discoveredDevices.size, 0);
        assert.equal(deviceManager.devices.get('SERIAL-001').status, 'connected');
        assert.equal(deviceManager.devices.get('SERIAL-001').ip, '192.168.1.10');
    } finally {
        deviceManager.devices = originalDevices;
        deviceManager.discoveredDevices = originalDiscovered;
    }
});

test('ConnectionService and ScrcpyService resolve binary paths per OS', () => {
    const currentPlatform = process.platform;
    const adbPath = connectionService.resolveAdbPath(currentPlatform);
    const scrcpyPath = scrcpyService.resolveBinaryPath(currentPlatform);

    const adbFile = currentPlatform === 'win32' ? 'adb.exe' : 'adb';
    const scrcpyFile = currentPlatform === 'win32' ? 'scrcpy.exe' : 'scrcpy';
    const adbFolder = currentPlatform === 'win32' ? 'win' : 'linux';
    const scrcpyFolder = currentPlatform === 'win32' ? 'win64' : 'linux';

    assert.equal(path.basename(adbPath), adbFile);
    assert.equal(path.basename(scrcpyPath), scrcpyFile);
    assert.ok(adbPath.includes(path.join('resources', 'bin', adbFolder)));
    assert.ok(scrcpyPath.includes(path.join('resources', 'bin', scrcpyFolder)));
});

test('smartConnect resolves success on already connected output', async () => {
    const originalConnect = connectionService.connectDevice;
    try {
        connectionService.connectDevice = async () => ({
            success: false,
            message: 'Connection failed',
            raw: 'already connected to 192.168.1.50:5555'
        });
        const result = await connectionService.smartConnect('192.168.1.50', 5555, 'SERIAL-X');
        assert.equal(result.success, true);
        assert.equal(result.status, 'connected');
    } finally {
        connectionService.connectDevice = originalConnect;
    }
});

test('smartConnect classifies network timeout failure', async () => {
    const originalConnect = connectionService.connectDevice;
    try {
        connectionService.connectDevice = async () => ({
            success: false,
            message: 'Connection failed',
            raw: 'failed to connect to 192.168.1.50:5555: Connection timed out'
        });
        const result = await connectionService.smartConnect('192.168.1.50', 5555, 'SERIAL-X');
        assert.equal(result.success, false);
        assert.equal(result.status, 'failed_network');
    } finally {
        connectionService.connectDevice = originalConnect;
    }
});
