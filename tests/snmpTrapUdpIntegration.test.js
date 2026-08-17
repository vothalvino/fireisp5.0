'use strict';

const dgram = require('node:dgram');
const { once } = require('node:events');

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/utils/logger', () => {
  const logger = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    child: jest.fn(() => logger),
  };
  return logger;
});
jest.mock('../src/services/eventBus', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../src/services/trapForwardingService', () => ({
  forwardTrap: jest.fn().mockResolvedValue({
    matched_rules: 1,
    queued_deliveries: 1,
    delivery_ids: [91],
    selected_webhook_ids: [],
    errors: 0,
  }),
}));

const snmp = require('net-snmp');
const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const trapForwardingService = require('../src/services/trapForwardingService');
const { handleTrap } = require('../src/services/snmpTrapReceiver');

async function unusedUdpPort() {
  const socket = dgram.createSocket('udp4');
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  socket.close();
  await once(socket, 'close');
  return port;
}

async function waitForReceiver(receiver) {
  const socket = Object.values(receiver.listener.sockets)[0];
  try {
    socket.address();
  } catch (_) {
    await once(socket, 'listening');
  }
}

function closeReceiver(receiver) {
  return new Promise(resolve => receiver.close(() => resolve()));
}

describe('SNMP trap UDP receiver contract', () => {
  test('a real net-snmp v2c datagram attributes rinfo.address and reaches explicit forwarding', async () => {
    const port = await unusedUdpPort();
    db.query
      .mockResolvedValueOnce([[
        { id: 9, organization_id: 4, name: 'Loopback integration router' },
      ]])
      .mockResolvedValueOnce([{ insertId: 88 }]);

    let settleReceived;
    let rejectReceived;
    const received = new Promise((resolve, reject) => {
      settleReceived = resolve;
      rejectReceived = reject;
    });
    const receiver = snmp.createReceiver({
      port,
      address: '127.0.0.1',
      transport: 'udp4',
      disableAuthorization: true,
    }, (error, notification) => {
      Promise.resolve(handleTrap(error, notification))
        .then(() => settleReceived(notification))
        .catch(rejectReceived);
    });
    const session = snmp.createSession('127.0.0.1', 'integration-community', {
      version: snmp.Version2c,
      trapPort: port,
      sourceAddress: '127.0.0.1',
      retries: 0,
      timeout: 1000,
    });

    try {
      await waitForReceiver(receiver);
      await new Promise((resolve, reject) => {
        session.trap('1.3.6.1.6.3.1.1.5.3', error => (error ? reject(error) : resolve()));
      });
      const notification = await received;

      expect(notification.rinfo).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
      expect(notification).not.toHaveProperty('sender');
      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FROM devices'),
        ['127.0.0.1'],
      );
      expect(trapForwardingService.forwardTrap).toHaveBeenCalledWith(
        expect.objectContaining({
          trapId: 88,
          organizationId: 4,
          sourceIp: '127.0.0.1',
          trapType: 'linkDown',
          trapOid: '1.3.6.1.6.3.1.1.5.3',
        }),
        expect.objectContaining({ id: 9, organization_id: 4 }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.trap',
        expect.objectContaining({ organizationId: 4, trapId: 88 }),
      );
      expect(JSON.stringify(trapForwardingService.forwardTrap.mock.calls[0]))
        .not.toMatch(/integration-community|community|varbinds/i);
    } finally {
      session.close();
      await closeReceiver(receiver);
    }
  });
});
