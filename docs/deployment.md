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
