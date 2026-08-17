'use strict';

const mockBullAdd = jest.fn();
const mockBullClose = jest.fn().mockResolvedValue(undefined);
const mockBullWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockBullWorkerOn = jest.fn();
const mockBullQueue = jest.fn(() => ({
  add: mockBullAdd,
  close: mockBullClose,
  getJobCounts: jest.fn().mockResolvedValue({}),
}));
const mockBullWorker = jest.fn(() => ({
  on: mockBullWorkerOn,
  close: mockBullWorkerClose,
}));

jest.mock('bullmq', () => ({
  Queue: mockBullQueue,
  Worker: mockBullWorker,
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('durable BullMQ producer deadline', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    mockBullAdd.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  test('100 idempotent durable adds settle within one shared outage window', async () => {
    const queue = require('../src/services/jobQueueService');
    const pending = Promise.allSettled(Array.from({ length: 100 }, (_, index) => (
      queue.add(
        'trap-forwarding-delivery',
        { deliveryId: index + 1, organizationId: 42 },
        { jobId: `trap-forwarding-42-${index + 1}` },
      )
    )));

    await Promise.resolve();
    expect(mockBullAdd).toHaveBeenCalledTimes(100);

    await jest.advanceTimersByTimeAsync(queue.JOB_QUEUE_ADD_TIMEOUT_MS - 1);
    let settled = false;
    pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const outcomes = await pending;
    expect(outcomes).toHaveLength(100);
    expect(outcomes.every(outcome => (
      outcome.status === 'rejected' && outcome.reason?.code === 'JOB_QUEUE_ADD_TIMEOUT'
    ))).toBe(true);
    expect(jest.getTimerCount()).toBe(0);

    await queue.close();
  });

  test('saved-webhook durable adds use the same bounded producer deadline', async () => {
    const queue = require('../src/services/jobQueueService');
    const pending = Promise.allSettled(Array.from({ length: 50 }, (_, index) => (
      queue.add(
        'webhook-delivery',
        { deliveryId: index + 1, organizationId: 42 },
        { jobId: `webhook-delivery-42-${index + 1}` },
      )
    )));

    await Promise.resolve();
    expect(mockBullAdd).toHaveBeenCalledTimes(50);
    await jest.advanceTimersByTimeAsync(queue.JOB_QUEUE_ADD_TIMEOUT_MS);

    const outcomes = await pending;
    expect(outcomes.every(outcome => (
      outcome.status === 'rejected' && outcome.reason?.code === 'JOB_QUEUE_ADD_TIMEOUT'
    ))).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await queue.close();
  });

  test('nondefault rediss auth, database, port, and TLS reach producers and workers', async () => {
    process.env.REDIS_URL = 'rediss://queue-user:p%40ssword@redis.internal.example:6381/7';
    mockBullAdd.mockResolvedValueOnce({ id: 'secure-job' });
    const queue = require('../src/services/jobQueueService');

    await queue.add('webhook-delivery', { deliveryId: 9, organizationId: 42 }, {
      jobId: 'webhook-delivery-42-9',
    });
    queue.process('webhook-delivery', jest.fn());

    const producer = mockBullQueue.mock.calls[0][1].connection;
    expect(producer).toMatchObject({
      host: 'redis.internal.example',
      port: 6381,
      db: 7,
      username: 'queue-user',
      password: 'p@ssword',
      tls: { servername: 'redis.internal.example' },
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    expect(producer.retryStrategy).toEqual(expect.any(Function));

    const worker = mockBullWorker.mock.calls[0][2].connection;
    expect(worker).toEqual({
      host: 'redis.internal.example',
      port: 6381,
      db: 7,
      username: 'queue-user',
      password: 'p@ssword',
      tls: { servername: 'redis.internal.example' },
      maxRetriesPerRequest: null,
    });

    await queue.close();
  });
});
