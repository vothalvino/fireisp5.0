# Video Walkthrough — FireRelay Agent Install

**Companion guide:** [`docs/firerelay.md`](../firerelay.md)  
**Video asset:** [`firerelay-agent-install.svg`](firerelay-agent-install.svg)

## Audience

Operators adding a FireRelay worker node to a FireISP 5.0 deployment after the primary node approaches capacity.

## Key message

FireRelay uses the same FireISP codebase on every node. Promote the first node to `master`, configure the new server as `worker`, assign a unique node ID and auto-increment offset, then verify health and routing from the master.

## Storyboard and narration

### 1. Confirm the scaling trigger

Narration:

> Start from a healthy standalone FireISP node. Add FireRelay only when capacity requires it, typically around the 30,000-client threshold or when the primary node is close to its client or device limits.

On-screen checklist:

- Current node healthy
- Backups current
- TLS and DNS ready for both nodes
- Capacity threshold reached

### 2. Promote Node 1 to master

Narration:

> Update the first node's environment so it becomes the FireRelay master. It continues to serve its own clients while maintaining the worker registry and client routing table.

On-screen environment:

```env
FIRERELAY_MODE=master
FIRERELAY_NODES=["https://node2.fireisp.com"]
FIRERELAY_HEALTH_INTERVAL=30000
FIRERELAY_REQUEST_TIMEOUT=5000
FIRERELAY_MAX_RETRIES=3
```

### 3. Install the worker using the same codebase

Narration:

> Provision the second server exactly like a normal FireISP installation. Use the same repository, run the database migrations, and point the worker back to the master.

On-screen command sequence:

```bash
pnpm install --frozen-lockfile
pnpm run migrate
pnpm start
```

### 4. Configure Node 2 as a worker

Narration:

> Give the worker a unique `FIRERELAY_NODE_ID` and an auto-increment offset that prevents ID collisions across independent MySQL databases.

On-screen environment:

```env
FIRERELAY_MODE=worker
FIRERELAY_MASTER_URL=https://node1.fireisp.com
FIRERELAY_NODE_ID=node2
FIRERELAY_AUTO_INCREMENT_OFFSET=10000001
FIRERELAY_MAX_CLIENTS=10000
FIRERELAY_MAX_DEVICES=3000
```

### 5. Verify health and routing

Narration:

> Check the worker health endpoint and confirm the master sees the node as active. New clients should be assigned to the least-loaded active node while existing clients stay on their original node.

On-screen checks:

```bash
curl https://node2.fireisp.com/api/firerelay/health
curl https://node1.fireisp.com/api/firerelay/nodes
```

### 6. Operate the cluster safely

Narration:

> Monitor worker health, keep each node backed up, and use lifecycle states intentionally. Mark a worker as draining before maintenance so it keeps serving existing clients but stops receiving new assignments.

On-screen states:

- `active` — accepts new clients
- `draining` — existing clients only
- `maintenance` — skipped for new assignments
- `offline` — unreachable until recovered

