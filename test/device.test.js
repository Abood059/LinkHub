const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../src/main/models/Device');

test('Device.toJSON includes stable + runtime fields expected by persistence layer', () => {
  const d = new Device({
    id: 'ABC123',
    deviceFriendlyName: 'My Phone',
    model: 'Pixel',
    version: '14',
    arch: 'arm64',
    isNew: 1,
  });

  d.ip = '192.168.1.10';
  d.port = 5555;
  d.status = 'connected';

  const json = d.toJSON();

  assert.equal(json.id, 'ABC123');
  assert.equal(json.type, 'MOBILE');
  assert.equal(json.deviceFriendlyName, 'My Phone');
  assert.equal(json.model, 'Pixel');
  assert.equal(json.version, '14');
  assert.equal(json.arch, 'arm64');
  assert.equal(json.ip, '192.168.1.10');
  assert.equal(json.port, 5555);
  assert.equal(json.status, 'connected');
  assert.equal(json.isNew, 1);
});

test('Device.fromJSON rebuilds instance with same core fields', () => {
  const d = Device.fromJSON({
    id: 'XYZ',
    deviceFriendlyName: 'Phone',
    model: 'Samsung',
    version: '13',
    arch: 'arm64',
    isNew: 0,
  });

  assert.equal(d.id, 'XYZ');
  assert.ok(d.deviceFriendlyName || d.friendlyName);
  assert.equal(d.model, 'Samsung');
  assert.equal(d.version, '13');
  assert.equal(d.arch, 'arm64');
  assert.equal(d.isNew, 0);
});

