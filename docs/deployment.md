# Deployment Guide

This guide covers deploying FireISP 5.0 in production environments. Choose the deployment method that best fits your infrastructure.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Bare-Metal / VM Deployment](#bare-metal--vm-deployment)
4. [Docker Deployment](#docker-deployment)
5. [Docker Swarm](#docker-swarm)
6. [MySQL Tuning](#mysql-tuning)
7. [Reverse Proxy (Nginx)](#reverse-proxy-nginx)
8. [TLS / HTTPS](#tls--https)
9. [Monitoring](#monitoring)
10. [Production Checklist](#production-checklist)

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **MySQL** 8.0+ or MariaDB 10.6+ with Event Scheduler enabled
- **RAM**: 2 GB minimum (4 GB recommended for >5,000 clients)
- **Disk**: 20 GB minimum (SSD recommended for SNMP metrics tables)

---

## Environment Configuration

Copy `.env.example` to `.env` and configure all values:

```bash
cp .env.example .env
```

### Critical Production Settings

```env
NODE_ENV=production
PORT=3000
APP_URL=https://isp.example.com

# IMPORTANT: Generate a strong random secret (64+ chars)
JWT_SECRET=$(openssl rand -base64 48)
JWT_EXPIRES_IN=8h

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=fireisp
DB_PASSWORD=<strong-password>
DB_NAME=fireisp

# SMTP (required for notifications)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@example.com
SMTP_PASS=<smtp-password>
SMTP_FROM=noreply@example.com

# Logging
LOG_LEVEL=info
```

---

## Bare-Metal / VM Deployment

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Install MySQL 8.0

```bash
sudo apt-get install -y mysql-server
sudo mysql_secure_installation
```

Enable Event Scheduler:

```sql
SET GLOBAL event_scheduler = ON;
```

Add to `/etc/mysql/mysql.conf.d/mysqld.cnf`:

```ini
[mysqld]
event_scheduler = ON
```

### 3. Create Database and User

```sql
CREATE DATABASE fireisp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'fireisp'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON fireisp.* TO 'fireisp'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Deploy Application

```bash
# Clone or copy the application
cd /opt/fireisp

# Install production dependencies
npm ci --production

# Run migrations
npm run migrate

# Seed default data (roles, permissions, settings, tax rates)
# Only needed on first install
npm run seed

# Start the server
npm start
```

### 5. Run as a System Service (systemd)

Create `/etc/systemd/system/fireisp.service`:

```ini
[Unit]
Description=FireISP 5.0
After=network.target mysql.service

[Service]
Type=simple
User=fireisp
WorkingDirectory=/opt/fireisp
EnvironmentFile=/opt/fireisp/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/fireisp/storage

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable fireisp
sudo systemctl start fireisp
sudo journalctl -u fireisp -f  # View logs
```

---

## Docker Deployment

### Single-Node Docker Compose

```bash
# Configure environment
cp .env.example .env
# Edit .env with production values

# Start services
docker compose up -d

# Run migrations (first time only)
docker compose exec app npm run migrate

# Seed defaults (first time only)
docker compose exec app npm run seed

# View logs
docker compose logs -f app
```

### Custom Dockerfile (production optimized)

The included `Dockerfile` is production-ready:
- Alpine base (minimal attack surface)
- Non-root user (`fireisp`)
- Health check built-in
- Production dependencies only

---

## Docker Swarm

For multi-node deployments:

```yaml
# docker-stack.yml
version: '3.8'

services:
  app:
    image: fireisp:5.0
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 30s
      restart_policy:
        condition: on-failure
    ports:
      - target: 3000
        published: 3000
        mode: host
    env_file:
      - .env
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: mysql:8.0
    deploy:
      placement:
        constraints:
          - node.role == manager
    volumes:
      - db_data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/db_password
      MYSQL_DATABASE: fireisp
    secrets:
      - db_password
    command: >
      --event-scheduler=ON
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci

secrets:
  db_password:
    external: true

volumes:
  db_data:
```

Deploy:

```bash
docker stack deploy -c docker-stack.yml fireisp
```

---

## MySQL Tuning

FireISP's SNMP metrics tables can grow to 155M+ rows. Recommended MySQL tuning for production:

```ini
[mysqld]
# InnoDB Buffer Pool — set to 50-70% of available RAM
innodb_buffer_pool_size = 2G

# Event Scheduler (REQUIRED for SNMP rollup + connection_logs)
event_scheduler = ON

# Transaction log
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2  # 1 for max safety, 2 for performance

# Connection limits
max_connections = 200

# Query performance
innodb_io_capacity = 2000
innodb_io_capacity_max = 4000

# Partition maintenance (for snmp_metrics monthly partitions)
open_files_limit = 65535

# Binary logging for point-in-time recovery
log-bin = mysql-bin
binlog_expire_logs_seconds = 604800  # 7 days
server-id = 1

# Character set
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
```

### SNMP Metrics Scale Reference

| Metric | Value |
|--------|-------|
| Devices polled | 6,000 |
| Poll interval | 5 minutes |
| Raw rows/day | ~1.73 million |
| Raw retention | 90 days (~155M rows) |
| Monthly partition size | ~52M rows |

---

## Reverse Proxy (Nginx)

### `/etc/nginx/sites-available/fireisp`

```nginx
upstream fireisp {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name isp.example.com;

    ssl_certificate     /etc/letsencrypt/live/isp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/isp.example.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # SSE support — disable buffering for event streams
    location /api/events/ {
        proxy_pass http://fireisp;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # API and application
    location / {
        proxy_pass http://fireisp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # File uploads (10MB max)
        client_max_body_size 10m;
    }

    # Metrics endpoint — restrict to internal networks
    location /metrics {
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
        proxy_pass http://fireisp;
    }
}

server {
    listen 80;
    server_name isp.example.com;
    return 301 https://$host$request_uri;
}
```

---

## TLS / HTTPS

### Let's Encrypt (Certbot)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d isp.example.com
```

Auto-renewal is configured by default via systemd timer.

---

## Monitoring

### Health Check

```bash
curl https://isp.example.com/health
# {"status":"ok","version":"5.0.0","uptime":3600,"relay":"standalone","timestamp":"..."}

curl https://isp.example.com/health?detail=true
# Adds memory usage and DB latency
```

### Prometheus Metrics

FireISP exposes metrics at `/metrics` in Prometheus exposition format:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: fireisp
    static_configs:
      - targets: ['isp.example.com:3000']
    metrics_path: /metrics
    scrape_interval: 15s
```

Available metrics:
- `process_uptime_seconds` — Process uptime
- `process_resident_memory_bytes` — RSS memory
- `http_requests_total` — Total HTTP requests
- `http_request_errors_total` — HTTP 4xx/5xx errors
- `http_request_duration_seconds` — Request latency histogram

---

## Production Checklist

- [ ] `NODE_ENV=production` is set
- [ ] `JWT_SECRET` is a strong random value (64+ chars)
- [ ] MySQL Event Scheduler is `ON` (`CALL preflight_check_event_scheduler();`)
- [ ] All migrations applied (`npm run migrate`)
- [ ] Default roles, permissions, and settings seeded (`npm run seed`)
- [ ] SMTP configured and tested
- [ ] TLS/HTTPS enabled
- [ ] Reverse proxy configured with security headers
- [ ] Firewall rules: Only 80/443 (web), 1812-1813/UDP (RADIUS), 3799/UDP (CoA) open
- [ ] Backup cron job configured
- [ ] Log rotation configured (Pino outputs JSON to stdout)
- [ ] Monitoring/alerting set up (health endpoint + Prometheus)
- [ ] Database user has minimal required privileges
- [ ] File upload directory permissions correct (`storage/`)
- [ ] Rate limiting verified

---

## Kubernetes Deployment

Kubernetes provides automatic scaling, self-healing, and declarative configuration for FireISP 5.0.

### ConfigMap

Store non-secret configuration in a ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fireisp-config
  namespace: fireisp
data:
  NODE_ENV: "production"
  PORT: "3000"
  APP_URL: "https://isp.example.com"
  DB_HOST: "mysql-primary.fireisp.svc.cluster.local"
  DB_PORT: "3306"
  DB_NAME: "fireisp"
  DB_USER: "fireisp"
  DB_POOL_SIZE: "10"
  SMTP_HOST: "smtp.example.com"
  SMTP_PORT: "587"
  SMTP_SECURE: "false"
  SMTP_FROM: "noreply@example.com"
  LOG_LEVEL: "info"
  REDIS_URL: "redis://redis.fireisp.svc.cluster.local:6379"
```

### Secret

Store sensitive values in a Kubernetes Secret (base64-encoded):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: fireisp-secret
  namespace: fireisp
type: Opaque
data:
  JWT_SECRET: <base64-encoded-value>
  DB_PASSWORD: <base64-encoded-value>
  ENCRYPTION_KEY: <base64-encoded-value>
  SMTP_USER: <base64-encoded-value>
  SMTP_PASS: <base64-encoded-value>
```

Generate base64 values:

```bash
echo -n 'my-secret-value' | base64
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fireisp
  namespace: fireisp
  labels:
    app: fireisp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: fireisp
  template:
    metadata:
      labels:
        app: fireisp
    spec:
      containers:
        - name: fireisp
          image: fireisp/fireisp:5.0
          ports:
            - containerPort: 3000
              name: http
          envFrom:
            - configMapRef:
                name: fireisp-config
            - secretRef:
                name: fireisp-secret
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          volumeMounts:
            - name: storage
              mountPath: /opt/fireisp/storage
      volumes:
        - name: storage
          persistentVolumeClaim:
            claimName: fireisp-storage
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: fireisp
  namespace: fireisp
spec:
  type: ClusterIP
  selector:
    app: fireisp
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
```

### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fireisp
  namespace: fireisp
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - isp.example.com
      secretName: fireisp-tls
  rules:
    - host: isp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: fireisp
                port:
                  name: http
```

### PersistentVolumeClaim

The `storage/` directory holds uploaded files and must persist across pod restarts:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: fireisp-storage
  namespace: fireisp
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: nfs
  resources:
    requests:
      storage: 20Gi
```

> **Note:** Use a `ReadWriteMany` access mode (e.g., NFS or a cloud file share) when running multiple replicas so all pods can access the same storage volume.

### Horizontal Pod Autoscaler (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: fireisp
  namespace: fireisp
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: fireisp
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

> **Tip:** Start with CPU-based scaling and add memory metrics if your workload is memory-intensive. Monitor actual utilization for a few days before tuning thresholds.

---

## Database Replication

For high availability and read scaling, configure MySQL replication.

### Primary-Replica Setup

1. **Primary** handles all writes (INSERT, UPDATE, DELETE) and schema migrations.
2. **Replicas** handle read traffic (SELECT queries for dashboards, reports, SNMP metrics).

On the primary, enable binary logging in `/etc/mysql/mysql.conf.d/mysqld.cnf`:

```ini
[mysqld]
server-id = 1
log_bin = /var/log/mysql/mysql-bin.log
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON
```

On each replica:

```ini
[mysqld]
server-id = 2
relay_log = /var/log/mysql/mysql-relay-bin.log
read_only = ON
gtid_mode = ON
enforce_gtid_consistency = ON
```

Start replication on the replica:

```sql
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='primary.db.example.com',
  SOURCE_USER='repl_user',
  SOURCE_PASSWORD='<replication-password>',
  SOURCE_AUTO_POSITION=1;
START REPLICA;
```

### MySQL Group Replication / InnoDB Cluster

For automatic failover, consider MySQL InnoDB Cluster:

- **MySQL Shell** for cluster administration
- **MySQL Router** for transparent connection routing
- Minimum 3 nodes for fault tolerance

```bash
# Bootstrap MySQL Router to auto-discover the cluster
mysqlrouter --bootstrap root@primary:3306 --directory /etc/mysqlrouter
```

### Connection String Configuration

Configure read replicas in your environment:

```env
# Primary (read-write)
DB_HOST=primary.db.example.com
DB_PORT=3306

# Read replica (optional — used for reporting and dashboards)
DB_READ_HOST=replica.db.example.com
DB_READ_PORT=3306
```

When using MySQL Router:

```env
# MySQL Router ports (read-write and read-only)
DB_HOST=127.0.0.1
DB_PORT=6446
DB_READ_HOST=127.0.0.1
DB_READ_PORT=6447
```

### Event Scheduler

> **Important:** The MySQL Event Scheduler must run on the **primary** node only. Replicas replicate scheduled event results via binlog — do not enable `event_scheduler = ON` on replicas.

```ini
# Primary only
[mysqld]
event_scheduler = ON
```

### Backup Strategy with Replica

Take backups from a replica to avoid impacting production traffic:

```bash
# Full backup from replica using mysqldump
mysqldump -h replica.db.example.com -u backup_user -p \
  --single-transaction --routines --events --triggers \
  fireisp > fireisp_backup_$(date +%Y%m%d).sql

# Or use Percona XtraBackup for large databases
xtrabackup --backup --target-dir=/backups/full \
  --host=replica.db.example.com --user=backup_user --password=<password>
```

Schedule daily backups via cron:

```bash
0 2 * * * /opt/fireisp/scripts/backup.sh >> /var/log/fireisp-backup.log 2>&1
```

---

## Redis High Availability

Redis is used for session caching, rate limiting, and BullMQ job queues. In production, deploy Redis with high availability.

### Redis Sentinel

Redis Sentinel provides automatic failover with a primary and multiple replicas:

1. Run at least **3 Sentinel instances** for quorum.
2. Sentinels monitor the primary and promote a replica on failure.

Example Sentinel configuration (`sentinel.conf`):

```conf
sentinel monitor fireisp-redis primary.redis.example.com 6379 2
sentinel down-after-milliseconds fireisp-redis 5000
sentinel failover-timeout fireisp-redis 10000
sentinel parallel-syncs fireisp-redis 1
sentinel auth-pass fireisp-redis <redis-password>
```

Configure the application to use Sentinel:

```env
REDIS_URL=redis+sentinel://sentinel1:26379,sentinel2:26379,sentinel3:26379/fireisp-redis/0
```

### Redis Cluster

For horizontal scaling beyond a single node's memory capacity:

- Data is automatically sharded across multiple masters.
- Each master has one or more replicas for failover.
- Minimum 6 nodes (3 masters + 3 replicas).

```bash
redis-cli --cluster create \
  redis1:6379 redis2:6379 redis3:6379 \
  redis4:6379 redis5:6379 redis6:6379 \
  --cluster-replicas 1
```

### Session and Cache Invalidation

When scaling Redis:

- **Sessions (JWT):** FireISP uses stateless JWTs — no server-side session store is required. Token revocation lists (if enabled) are stored in Redis and must be accessible from all app instances.
- **Cache:** Cached data (plan lookups, permission sets) is stored per-key in Redis. All app nodes share the same cache, so invalidation is automatic.
- **BullMQ:** Job queues require a single Redis instance or Sentinel — Redis Cluster is not natively supported by BullMQ. Use a dedicated Redis Sentinel deployment for job queues if you use Redis Cluster for caching.

---

## Load Balancing

Distribute traffic across multiple FireISP instances for high availability and throughput.

### Nginx Upstream Configuration

```nginx
upstream fireisp_backend {
    least_conn;
    server 10.0.1.10:3000;
    server 10.0.1.11:3000;
    server 10.0.1.12:3000;
}

server {
    listen 443 ssl http2;
    server_name isp.example.com;

    ssl_certificate     /etc/ssl/certs/fireisp.crt;
    ssl_certificate_key /etc/ssl/private/fireisp.key;

    location / {
        proxy_pass http://fireisp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE endpoints need long-lived connections
    location /api/events {
        proxy_pass http://fireisp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Sticky Sessions

Sticky sessions (session affinity) are **not required**. FireISP uses stateless JWT authentication — any backend instance can handle any request. Use `least_conn` or `round_robin` balancing for even distribution.

### WebSocket / SSE Considerations

FireISP uses **Server-Sent Events (SSE)** for real-time updates:

- SSE connections are long-lived HTTP connections (minutes to hours).
- Configure `proxy_read_timeout` to a high value (e.g., `3600s`) for SSE endpoints.
- Ensure the load balancer does not prematurely close idle connections.
- Set `proxy_buffering off` so events are delivered immediately.

### Health Check Configuration

Configure active health checks in Nginx (requires `nginx-plus` or the open-source `nginx_upstream_check_module`):

```nginx
upstream fireisp_backend {
    least_conn;
    server 10.0.1.10:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:3000 max_fails=3 fail_timeout=30s;
}
```

With Nginx open-source, passive health checks are used by default — failed requests trigger `max_fails` and temporarily remove the upstream. For active checks, use the `/health/ready` endpoint in your load balancer or orchestrator.

---

## Blue-Green Deployment Strategy

Blue-green deployments minimize downtime and risk by running two identical environments.

### Overview

1. **Blue** — the current live environment serving production traffic.
2. **Green** — the new version deployed alongside Blue, not yet receiving traffic.

### Database Migration Compatibility

Migrations must be **forward-only and additive**:

- Add new columns with default values — never remove or rename columns in the same release.
- Add new tables freely.
- Defer destructive changes (column drops, renames) to a follow-up release after the old version is fully retired.

This ensures both Blue and Green can operate against the same database simultaneously.

Run migrations before switching traffic:

```bash
# Deploy Green and run migrations
cd /opt/fireisp-green
npm run migrate
```

### Traffic Switching with Nginx

```nginx
upstream fireisp_blue {
    server 10.0.1.10:3000;
    server 10.0.1.11:3000;
}

upstream fireisp_green {
    server 10.0.2.10:3000;
    server 10.0.2.11:3000;
}

server {
    listen 443 ssl http2;
    server_name isp.example.com;

    # Switch traffic by changing this line
    set $backend fireisp_green;

    location / {
        proxy_pass http://$backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload Nginx to apply:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Traffic Switching with Kubernetes

Update the Service selector to point to the green Deployment:

```bash
kubectl set selector service/fireisp -n fireisp app=fireisp,version=green
```

### Rollback Procedure

1. Switch traffic back to Blue (change `$backend` to `fireisp_blue` in Nginx, or update the Kubernetes service selector).
2. Reload the load balancer or apply the selector change.
3. Investigate the issue in the Green environment.
4. If a database migration was applied, deploy a compensating migration — never roll back migrations manually.

### Smoke Test Checklist

Run these checks against the Green environment before switching traffic:

- [ ] `/health/ready` returns `200 OK`
- [ ] Login and JWT issuance works
- [ ] Dashboard loads with correct data
- [ ] Client creation and editing works
- [ ] RADIUS authentication succeeds (test with `radtest`)
- [ ] SNMP polling returns metrics
- [ ] Email notifications send successfully
- [ ] Background jobs (BullMQ) are processing
- [ ] No errors in application logs (`kubectl logs` or `journalctl`)

---

## Scaling Considerations

### Horizontal Scaling

FireISP 5.0 is designed as a **stateless application** — any instance can serve any request. Scale horizontally by adding more app server instances behind a load balancer.

Requirements for horizontal scaling:

- **Shared database:** All instances connect to the same MySQL primary.
- **Shared Redis:** All instances connect to the same Redis for cache, rate limiting, and job queues.
- **Shared storage:** The `storage/` directory must be accessible from all instances (use NFS, cloud file storage, or S3-compatible object storage).

### FireRelay Mode

For multi-node deployments, enable **FireRelay** to synchronize real-time events across instances:

```env
FIRERELAY_ENABLED=true
FIRERELAY_TRANSPORT=redis
REDIS_URL=redis://redis.example.com:6379
```

FireRelay uses Redis Pub/Sub to broadcast events (e.g., client disconnections, CoA pushes) to all connected instances, ensuring SSE clients on any node receive updates.

### Database Connection Pool Sizing

Each FireISP instance maintains a connection pool to MySQL. Size it based on your instance count and MySQL `max_connections`:

```env
DB_POOL_SIZE=10
```

**Rule of thumb:** `DB_POOL_SIZE × number_of_instances` should not exceed 80% of MySQL's `max_connections`.

```sql
-- Check current MySQL max connections
SHOW VARIABLES LIKE 'max_connections';

-- Example: 3 instances × 10 pool size = 30 connections
-- MySQL max_connections should be at least 40 (30 + headroom)
SET GLOBAL max_connections = 150;
```

### Redis for Session and Cache

When running multiple instances, Redis is required for:

- **Rate limiting:** Shared counters across instances.
- **Cache:** Avoid stale data when one instance invalidates a cache entry.
- **Token revocation:** Revoked JWTs must be checked across all instances.

```env
REDIS_URL=redis://redis.example.com:6379
CACHE_DRIVER=redis
RATE_LIMIT_STORE=redis
```

### Job Queue (BullMQ)

Background tasks (email sending, SNMP polling, invoice generation) are distributed via BullMQ:

- BullMQ uses Redis as its backing store.
- Jobs are automatically distributed — only one instance processes each job.
- Scale workers independently by running dedicated worker processes:

```bash
# Run a dedicated worker process (does not serve HTTP)
node src/workers/index.js
```

Configure concurrency per worker:

```env
BULLMQ_CONCURRENCY=5
```

> **Tip:** For large deployments (10,000+ clients), run separate worker processes dedicated to SNMP polling and invoice generation to avoid blocking lighter tasks like email delivery.
