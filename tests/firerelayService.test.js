// =============================================================================
// FireISP 5.0 — FireRelay Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/config/firerelay', () => ({
  mode: 'master',
  nodes: [],
  healthInterval: 30000,
  requestTimeout: 5000,
  maxRetries: 2,
  masterUrl: '',
  nodeId: '',
  autoIncrementOffset: 1,
  maxClients: 10000,
  maxDevices: 3000,
}));

const db = require('../src/config/database');
const firerelayService = require('../src/services/firerelayService');

describe('firerelayService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    firerelayService.nodeBreakers.clear();
  });

  afterEach(() => {
    firerelayService.stopHealthLoop();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Node Registry
  // ─────────────────────────────────────────────────────────────────────────
  describe('listNodes()', () => {
    test('returns all registered nodes', async () => {
      const nodes = [
        { id: 'node2', name: 'Worker 2', api_url: 'https://node2.fireisp.com', status: 'active' },
      ];
      db.query.mockResolvedValueOnce([nodes]);

      const result = await firerelayService.listNodes();
      expect(result).toEqual(nodes);
      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM firerelay_nodes ORDER BY created_at ASC',
      );
    });
  });

  describe('getNode()', () => {
    test('returns a single node by id', async () => {
      const node = { id: 'node2', name: 'Worker 2', api_url: 'https://node2.fireisp.com' };
      db.query.mockResolvedValueOnce([[node]]);

      const result = await firerelayService.getNode('node2');
      expect(result).toEqual(node);
    });

    test('throws NotFoundError for unknown node', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(firerelayService.getNode('unknown'))
        .rejects.toThrow('not found');
    });
  });

  describe('registerNode()', () => {
    test('inserts a new node and returns it', async () => {
      const node = { id: 'node3', name: 'Worker 3', api_url: 'https://node3.fireisp.com', status: 'active' };
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])  // INSERT
        .mockResolvedValueOnce([[node]]);            // SELECT (getNode)

      const result = await firerelayService.registerNode({
        id: 'node3',
        name: 'Worker 3',
        api_url: 'https://node3.fireisp.com',
      });
      expect(result).toEqual(node);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO firerelay_nodes'),
        ['node3', 'Worker 3', 'https://node3.fireisp.com'],
      );
    });

    test('defaults name to empty string when not provided', async () => {
      const node = { id: 'node4', name: '', api_url: 'https://node4.fireisp.com', status: 'active' };
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[node]]);

      await firerelayService.registerNode({ id: 'node4', api_url: 'https://node4.fireisp.com' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT'),
        ['node4', '', 'https://node4.fireisp.com'],
      );
    });
  });

  describe('updateNode()', () => {
    test('updates specified fields', async () => {
      const updated = { id: 'node2', status: 'draining', client_count: 500 };
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE
        .mockResolvedValueOnce([[updated]]);              // SELECT (getNode)

      const result = await firerelayService.updateNode('node2', { status: 'draining', client_count: 500 });
      expect(result).toEqual(updated);
    });

    test('returns node unchanged when no fields provided', async () => {
      const node = { id: 'node2', status: 'active' };
      db.query.mockResolvedValueOnce([[node]]);

      const result = await firerelayService.updateNode('node2', {});
      expect(result).toEqual(node);
    });

    test('throws NotFoundError when node does not exist', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      await expect(firerelayService.updateNode('unknown', { status: 'draining' }))
        .rejects.toThrow('not found');
    });
  });

  describe('deregisterNode()', () => {
    test('deletes routing entries then the node', async () => {
      db.query
        .mockResolvedValueOnce([{ affectedRows: 5 }])   // DELETE routing
        .mockResolvedValueOnce([{ affectedRows: 1 }]);   // DELETE node

      const result = await firerelayService.deregisterNode('node2');
      expect(result).toEqual({ deleted: true, id: 'node2' });
      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM firerelay_client_routing WHERE node_id = ?',
        ['node2'],
      );
      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM firerelay_nodes WHERE id = ?',
        ['node2'],
      );
    });

    test('throws NotFoundError when node does not exist', async () => {
      db.query
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([{ affectedRows: 0 }]);

      await expect(firerelayService.deregisterNode('unknown'))
        .rejects.toThrow('not found');
    });

    test('cleans up circuit breaker for the node', async () => {
      // Pre-populate a breaker
      firerelayService.getNodeBreaker('node5');
      expect(firerelayService.nodeBreakers.has('node5')).toBe(true);

      db.query
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await firerelayService.deregisterNode('node5');
      expect(firerelayService.nodeBreakers.has('node5')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Routing Table
  // ─────────────────────────────────────────────────────────────────────────
  describe('lookupClientNode()', () => {
    test('returns node_id for a known client', async () => {
      db.query.mockResolvedValueOnce([[{ node_id: 'node2' }]]);

      const result = await firerelayService.lookupClientNode(12345);
      expect(result).toBe('node2');
    });

    test('returns null for an unknown client', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await firerelayService.lookupClientNode(99999);
      expect(result).toBeNull();
    });
  });

  describe('assignClient()', () => {
    test('inserts or updates client routing', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await firerelayService.assignClient(12345, 'node2');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO firerelay_client_routing'),
        [12345, 'node2'],
      );
    });
  });

  describe('unassignClient()', () => {
    test('removes client from routing table', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await firerelayService.unassignClient(12345);
      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM firerelay_client_routing WHERE client_id = ?',
        [12345],
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Least-Loaded Node Selection
  // ─────────────────────────────────────────────────────────────────────────
  describe('selectLeastLoadedNode()', () => {
    test('returns the active node with lowest client_count', async () => {
      const node = { id: 'node3', client_count: 100, status: 'active' };
      db.query.mockResolvedValueOnce([[node]]);

      const result = await firerelayService.selectLeastLoadedNode();
      expect(result).toEqual(node);
    });

    test('returns null when no active nodes exist', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await firerelayService.selectLeastLoadedNode();
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Circuit Breaker Per Node
  // ─────────────────────────────────────────────────────────────────────────
  describe('getNodeBreaker()', () => {
    test('creates a new breaker if one does not exist', () => {
      const breaker = firerelayService.getNodeBreaker('node2');
      expect(breaker).toBeDefined();
      expect(breaker.getState().name).toBe('firerelay:node2');
    });

    test('returns the same breaker on subsequent calls', () => {
      const b1 = firerelayService.getNodeBreaker('node2');
      const b2 = firerelayService.getNodeBreaker('node2');
      expect(b1).toBe(b2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Health-Check Polling
  // ─────────────────────────────────────────────────────────────────────────
  describe('pollNodeHealth()', () => {
    test('updates node metrics on successful health check', async () => {
      // Mock global fetch
      const healthData = {
        client_count: 500,
        device_count: 100,
        cpu_percent: 45.2,
        memory_percent: 62.1,
        disk_percent: 40,
        db_size_mb: 1024,
        uptime_seconds: 86400,
      };

      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve(healthData),
      });

      const node = { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'active', client_count: 0 };

      // updateNode calls: UPDATE then SELECT
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...node, client_count: 500 }]]);

      await firerelayService.pollNodeHealth(node);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://node2.fireisp.com/api/firerelay/health',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE firerelay_nodes SET'),
        expect.arrayContaining([500, 100]),
      );

      delete global.fetch;
    });

    test('handles health check failure gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const node = { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'active' };

      // Should not throw
      await firerelayService.pollNodeHealth(node);

      delete global.fetch;
    });
  });

  describe('startHealthLoop() / stopHealthLoop()', () => {
    test('starts and stops without error', () => {
      firerelayService.startHealthLoop();
      // Should be idempotent
      firerelayService.startHealthLoop();
      firerelayService.stopHealthLoop();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fan-Out
  // ─────────────────────────────────────────────────────────────────────────
  describe('fanOut()', () => {
    test('merges results from all healthy nodes', async () => {
      const nodes = [
        { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'active' },
        { id: 'node3', api_url: 'https://node3.fireisp.com', status: 'active' },
      ];
      db.query.mockResolvedValueOnce([nodes]);

      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 1, name: 'Alice' }], total: 1 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 2, name: 'Bob' }], total: 1 }),
        });

      const { results, warnings } = await firerelayService.fanOut({
        method: 'GET',
        path: '/api/clients',
      });

      expect(results).toHaveLength(2);
      expect(results[0].nodeId).toBe('node2');
      expect(results[1].nodeId).toBe('node3');
      expect(warnings).toHaveLength(0);

      delete global.fetch;
    });

    test('adds warnings for offline nodes', async () => {
      const nodes = [
        { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'active' },
        { id: 'node3', api_url: 'https://node3.fireisp.com', status: 'offline' },
      ];
      db.query.mockResolvedValueOnce([nodes]);

      global.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ data: [{ id: 1 }] }),
      });

      const { results, warnings } = await firerelayService.fanOut({
        method: 'GET',
        path: '/api/clients',
      });

      expect(results).toHaveLength(1);
      expect(warnings).toContain('Node node3 is offline — results may be incomplete.');

      delete global.fetch;
    });

    test('adds warnings for unreachable nodes', async () => {
      const nodes = [
        { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'active' },
      ];
      db.query.mockResolvedValueOnce([nodes]);

      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const { results, warnings } = await firerelayService.fanOut({
        method: 'GET',
        path: '/api/clients',
      });

      expect(results).toHaveLength(0);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('node2');

      delete global.fetch;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Proxy
  // ─────────────────────────────────────────────────────────────────────────
  describe('proxyToNode()', () => {
    test('proxies a request to the target node', async () => {
      const node = { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'active' };
      db.query.mockResolvedValueOnce([[node]]);

      global.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ data: { id: 123 } }),
      });

      const { status, data } = await firerelayService.proxyToNode('node2', {
        method: 'GET',
        path: '/api/clients/123',
      });

      expect(status).toBe(200);
      expect(data).toEqual({ data: { id: 123 } });

      delete global.fetch;
    });

    test('throws for offline nodes', async () => {
      const node = { id: 'node2', api_url: 'https://node2.fireisp.com', status: 'offline' };
      db.query.mockResolvedValueOnce([[node]]);

      await expect(
        firerelayService.proxyToNode('node2', { method: 'GET', path: '/api/clients/123' }),
      ).rejects.toThrow('offline');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // HTTP helpers
  // ─────────────────────────────────────────────────────────────────────────
  describe('httpRequest()', () => {
    test('makes a GET request', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

      const { status, data } = await firerelayService.httpRequest('https://node2.fireisp.com', {
        method: 'GET',
        path: '/api/firerelay/health',
      });

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://node2.fireisp.com/api/firerelay/health',
        expect.objectContaining({ method: 'GET' }),
      );

      delete global.fetch;
    });

    test('sends JSON body for POST requests', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        status: 201,
        json: () => Promise.resolve({ id: 1 }),
      });

      await firerelayService.httpRequest('https://node2.fireisp.com', {
        method: 'POST',
        path: '/api/clients',
        body: { name: 'Test Client' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://node2.fireisp.com/api/clients',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test Client' }),
        }),
      );

      delete global.fetch;
    });
  });

  describe('httpWithRetry()', () => {
    test('retries on failure', async () => {
      global.fetch = jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        });

      const { status } = await firerelayService.httpWithRetry(
        'https://node2.fireisp.com',
        { path: '/api/firerelay/health' },
        1,
      );

      expect(status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      delete global.fetch;
    });

    test('throws after exhausting retries', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(
        firerelayService.httpWithRetry(
          'https://node2.fireisp.com',
          { path: '/api/firerelay/health' },
          0,
        ),
      ).rejects.toThrow('Connection refused');

      delete global.fetch;
    });
  });
});
