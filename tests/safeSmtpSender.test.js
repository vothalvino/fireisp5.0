const net = require('net');
const { EventEmitter } = require('events');
const {
  createSafeSmtpSender,
  sendTrustedSmtp,
} = require('../src/utils/safeSmtpSender');

class FakeSocket extends EventEmitter {
  constructor(remoteAddress) {
    super();
    this.remoteAddress = remoteAddress;
    this.destroyed = false;
    this.setKeepAlive = jest.fn();
  }

  destroy(error) {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (error) process.nextTick(() => this.emit('error', error));
    process.nextTick(() => this.emit('close'));
    return this;
  }
}

function fakeTransportFactory(observed, sendImplementation = null) {
  return jest.fn(options => ({
    close: jest.fn(),
    sendMail: sendImplementation || (async message => {
      observed.message = message;
      observed.socketOptions = await new Promise((resolve, reject) => {
        options.getSocket(options, (error, value) => (error ? reject(error) : resolve(value)));
      });
      return { messageId: '<safe-smtp@test>' };
    }),
  }));
}

function emitConnected(socket, event = 'connect') {
  process.nextTick(() => socket.emit(event));
  return socket;
}

describe('safe SMTP sender — pinned one-shot transport', () => {
  test('tenant STARTTLS dials the validated IP and retains the hostname for SNI', async () => {
    const observed = {};
    const socket = new FakeSocket('8.8.8.8');
    const connect = jest.fn(() => emitConnected(socket));
    const resolveSafeHost = jest.fn().mockResolvedValue({
      hostname: 'smtp.example.com',
      addresses: [{ address: '8.8.8.8', family: 4 }],
    });
    const createTransport = fakeTransportFactory(observed);
    const sender = createSafeSmtpSender({ createTransport, connect, resolveSafeHost });

    const result = await sender.sendTenantSmtp({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'tenant', pass: 'secret' },
      message: { from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'hello' },
      absoluteTimeoutMs: 1000,
    });

    expect(result).toEqual({ messageId: '<safe-smtp@test>' });
    expect(connect).toHaveBeenCalledWith({ host: '8.8.8.8', port: 587, family: 4 });
    expect(observed.socketOptions).toMatchObject({
      connection: socket,
      secured: false,
      host: 'smtp.example.com',
      servername: 'smtp.example.com',
    });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      requireTLS: true,
      ignoreTLS: false,
      tls: { rejectUnauthorized: true },
    }));
    expect(socket.destroyed).toBe(true);
  });

  test('implicit TLS verifies certificates with the original DNS hostname', async () => {
    const observed = {};
    const socket = new FakeSocket('2606:4700::1111');
    const tlsConnect = jest.fn(() => emitConnected(socket, 'secureConnect'));
    const createTransport = fakeTransportFactory(observed);
    const sender = createSafeSmtpSender({
      createTransport,
      tlsConnect,
      resolveSafeHost: jest.fn().mockResolvedValue({
        hostname: 'smtp.example.com',
        addresses: [{ address: '2606:4700::1111', family: 6 }],
      }),
    });

    await sender.sendTenantSmtp({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      message: { from: 'a@example.com', to: 'b@example.com', text: 'hello' },
      absoluteTimeoutMs: 1000,
    });

    expect(tlsConnect).toHaveBeenCalledWith({
      host: '2606:4700::1111',
      port: 465,
      family: 6,
      rejectUnauthorized: true,
      servername: 'smtp.example.com',
    });
    expect(observed.socketOptions).toMatchObject({ connection: socket, secured: true });
  });

  test('tenant delivery rechecks and rejects a private connected peer', async () => {
    const socket = new FakeSocket('10.0.0.9');
    const sender = createSafeSmtpSender({
      connect: jest.fn(() => emitConnected(socket)),
      resolveSafeHost: jest.fn().mockResolvedValue({
        hostname: 'smtp.example.com',
        addresses: [{ address: '8.8.8.8', family: 4 }],
      }),
      createTransport: fakeTransportFactory({}),
    });

    await expect(sender.sendTenantSmtp({
      host: 'smtp.example.com',
      port: 587,
      message: { from: 'a@example.com', to: 'b@example.com', text: 'hello' },
      absoluteTimeoutMs: 1000,
    })).rejects.toMatchObject({ code: 'UNSAFE_HOST', statusCode: 422 });
    expect(socket.destroyed).toBe(true);
  });

  test('trusted install relay is separate and may explicitly use local plaintext SMTP', async () => {
    const observed = {};
    const socket = new FakeSocket('127.0.0.1');
    const createTransport = fakeTransportFactory(observed);
    const resolveTrustedHost = jest.fn().mockResolvedValue({
      hostname: 'localhost',
      addresses: [{ address: '127.0.0.1', family: 4 }],
    });
    const resolveSafeHost = jest.fn();
    const sender = createSafeSmtpSender({
      createTransport,
      connect: jest.fn(() => emitConnected(socket)),
      resolveSafeHost,
      resolveTrustedHost,
    });

    await sender.sendTrustedSmtp({
      host: 'localhost',
      port: 25,
      secure: false,
      requireTls: false,
      message: { from: 'a@example.com', to: 'b@example.com', text: 'hello' },
      absoluteTimeoutMs: 1000,
    });

    expect(resolveTrustedHost).toHaveBeenCalledTimes(1);
    expect(resolveSafeHost).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: false }));
  });

  test('absolute timeout destroys the exact in-flight socket', async () => {
    let socketOptions;
    const socket = new FakeSocket('8.8.8.8');
    const createTransport = jest.fn(options => ({
      close: jest.fn(),
      sendMail: async () => {
        socketOptions = await new Promise((resolve, reject) => {
          options.getSocket(options, (error, value) => (error ? reject(error) : resolve(value)));
        });
        return new Promise(() => {});
      },
    }));
    const sender = createSafeSmtpSender({
      createTransport,
      connect: jest.fn(() => emitConnected(socket)),
      resolveSafeHost: jest.fn().mockResolvedValue({
        hostname: 'smtp.example.com',
        addresses: [{ address: '8.8.8.8', family: 4 }],
      }),
    });

    await expect(sender.sendTenantSmtp({
      host: 'smtp.example.com',
      message: { from: 'a@example.com', to: 'b@example.com', text: 'hello' },
      absoluteTimeoutMs: 60,
    })).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_TIMEOUT' });

    expect(socketOptions.connection).toBe(socket);
    expect(socket.destroyed).toBe(true);
  });
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise(resolve => server.close(resolve));
}

describe('safe SMTP sender — real Nodemailer socket behavior', () => {
  test('deadline closes a stalled SMTP exchange before MAIL FROM or DATA', async () => {
    let commands = '';
    let resolveClientClosed;
    const clientClosed = new Promise(resolve => { resolveClientClosed = resolve; });
    const server = net.createServer(socket => {
      socket.setEncoding('utf8');
      socket.write('220 local.test ESMTP\r\n');
      socket.on('data', chunk => { commands += chunk; });
      socket.once('close', resolveClientClosed);
    });
    const port = await listen(server);

    try {
      await expect(sendTrustedSmtp({
        host: '127.0.0.1',
        port,
        secure: false,
        requireTls: false,
        message: { from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'hello' },
        absoluteTimeoutMs: 100,
      })).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_TIMEOUT' });
      await clientClosed;
      expect(commands).toMatch(/EHLO/i);
      expect(commands).not.toMatch(/MAIL FROM|DATA/i);
    } finally {
      await closeServer(server);
    }
  });

  test('mandatory STARTTLS never sends AUTH when the server omits STARTTLS', async () => {
    const commands = [];
    const server = net.createServer(socket => {
      socket.setEncoding('utf8');
      socket.write('220 local.test ESMTP\r\n');
      let pending = '';
      socket.on('data', chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines.filter(Boolean)) {
          commands.push(line);
          if (/^EHLO /i.test(line)) {
            socket.write('250-local.test\r\n250 AUTH PLAIN LOGIN\r\n');
          } else if (/^STARTTLS$/i.test(line)) {
            socket.write('454 4.7.0 TLS unavailable\r\n');
          } else {
            socket.write('500 5.5.1 Command rejected\r\n');
          }
        }
      });
    });
    const port = await listen(server);

    try {
      await expect(sendTrustedSmtp({
        host: '127.0.0.1',
        port,
        secure: false,
        requireTls: true,
        auth: { user: 'smtp-user', pass: 'smtp-password' },
        message: { from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'hello' },
        absoluteTimeoutMs: 1000,
      })).rejects.toBeDefined();
      expect(commands.some(line => /^STARTTLS$/i.test(line))).toBe(true);
      expect(commands.some(line => /^AUTH\b/i.test(line))).toBe(false);
    } finally {
      await closeServer(server);
    }
  });
});
