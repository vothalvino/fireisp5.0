# TLS Setup Guide

FireISP 5.0 ships with a production-ready Nginx reverse proxy that enforces
HTTPS.  This guide covers four ways to provision TLS certificates:

| Method | Use case |
|---|---|
| [Let's Encrypt (HTTP-01)](#lets-encrypt-http-01-challenge) | Single-domain cert, server reachable on port 80 |
| [Manual / commercial certificate](#manual--commercial-certificate) | Bring-your-own cert (DigiCert, ZeroSSL, self-signed) |
| [Host Nginx (port-80 conflict)](#host-nginx-mode-port-80-conflict) | Docker already binds port 80; system nginx acts as TLS front-door |

---

## Architecture

```
Internet → Nginx :80/:443 → app:3000 (Node.js + React SPA)
              │
              ├── ./nginx/certs/fullchain.pem  (TLS certificate chain)
              └── ./nginx/certs/privkey.pem    (private key)

Certbot service → ./nginx/letsencrypt/ (/etc/letsencrypt bind-mount)
              └── deploy hook → ./nginx/certs/  (renews certs in-place)
              └── /var/www/certbot/ (certbot_www volume, HTTP-01 challenge)
```

nginx reads certificates from `./nginx/certs/`.  The Certbot service runs in a
separate container and copies renewed certs there via a deploy hook.  nginx
reloads its configuration every 6 hours, so new certificates take effect within
6 hours of renewal — well within Let's Encrypt's 30-day renewal window.

---

## Let's Encrypt (HTTP-01 challenge)

**Requirements:** Port 80 must be publicly reachable and your DNS A/AAAA record
must point to this server.

### 1. Configure environment

```bash
cp .env.example .env.prod
# Edit .env.prod and fill in all required values, then also set:
export DOMAIN=isp.example.com
export EMAIL=admin@example.com
```

### 2. Bootstrap the first certificate

The `init-letsencrypt.sh` script solves the chicken-and-egg problem: nginx
needs a certificate to start, but Certbot needs nginx running to answer the
ACME challenge.

```bash
chmod +x nginx/init-letsencrypt.sh
DOMAIN=isp.example.com EMAIL=admin@example.com ./nginx/init-letsencrypt.sh
```

What it does:
1. Creates a temporary self-signed certificate in `./nginx/certs/` (so the
   production nginx config can later start without missing-file errors).
2. Temporarily swaps `nginx/nginx.conf` for `nginx/nginx.bootstrap.conf` —
   a stripped-down config that only listens on port 80 and serves the ACME
   challenge. This avoids the
   `[emerg] host not found in upstream "app:3000"` failure that the full
   config would hit when started with `--no-deps`.
3. Starts the nginx container with the bootstrap config.
4. Runs Certbot (`certonly --webroot`) to issue the real certificate.
5. Copies `fullchain.pem` + `privkey.pem` into `./nginx/certs/`.
6. Restores `nginx/nginx.conf`, stops the bootstrap nginx container, and
   leaves the stack ready for the next step. The full nginx config — with
   the `app` upstream and TLS server — comes up in step 3 below alongside
   the rest of the stack.

### 3. Start the full stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

The `certbot` service starts alongside nginx and checks for renewal every
12 hours.

### 4. Verify

```bash
# Check the certificate
openssl s_client -connect isp.example.com:443 -servername isp.example.com \
  </dev/null 2>/dev/null | openssl x509 -noout -dates

# Check nginx is using the live cert
docker compose -f docker-compose.prod.yml --env-file .env.prod exec nginx \
  openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -subject -dates
```

---

## Manual / Commercial Certificate

Use this method if you have a certificate from a commercial CA (DigiCert,
Sectigo, ZeroSSL, etc.) or if you manage certificate issuance outside of this
stack.

### 1. Place certificate files

```bash
mkdir -p nginx/certs
# Certificate chain (PEM format: end-entity cert + intermediates)
cp /path/to/your/fullchain.pem nginx/certs/fullchain.pem
# Private key (PEM format, unencrypted)
cp /path/to/your/privkey.pem   nginx/certs/privkey.pem
chmod 644 nginx/certs/fullchain.pem
chmod 640 nginx/certs/privkey.pem
```

### 2. Start the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 3. Renew manually

When your certificate is renewed, replace the files in `nginx/certs/` and
reload nginx:

```bash
cp /path/to/new/fullchain.pem nginx/certs/fullchain.pem
cp /path/to/new/privkey.pem   nginx/certs/privkey.pem
docker compose -f docker-compose.prod.yml --env-file .env.prod exec nginx nginx -s reload
```

---

## Host Nginx Mode (Port-80 Conflict)

Use this mode when a Docker container (or another service) already binds
port 80 on the host, preventing the bundled Docker nginx service from starting.
A common symptom is:

```
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
```

### How it works

Instead of running nginx inside Docker, the **system-level nginx** (installed
as an OS service) acts as the TLS front-door.  It handles port 80/443 and
proxies traffic to the FireISP app container exposed on `127.0.0.1:8080`:

```
Internet → Host Nginx :80/:443 → 127.0.0.1:8080 (Docker app container)
```

The `docker-compose.host-nginx.yml` overlay:
- Disables the Docker nginx service (moves it to an opt-in profile).
- Publishes the app on `127.0.0.1:8080` (loopback only).
- Swaps the certbot webroot volume to a bind-mount so the host nginx can
  serve ACME HTTP-01 challenges.

### Automatic setup (installer)

If the installer (`install.sh`) detects port 80 is occupied by a non-Docker
process it enables host-nginx mode automatically.  You can also force it:

```bash
USE_HOST_NGINX=1 DOMAIN=isp.example.com EMAIL=admin@example.com \
  curl -fsSL https://raw.githubusercontent.com/vothalvino/fireisp5.0/main/install.sh | bash
```

### Manual setup

**1. Install nginx on the host**

```bash
sudo apt install nginx
```

**2. Configure nginx**

```bash
# Replace __INSTALL_DIR__ with your actual install path (e.g. /opt/fireisp)
# The file is placed in conf.d/ (not sites-available/) because it contains
# http-level directives (upstream, server{}) that nginx includes inside http{}.
sed 's|__INSTALL_DIR__|/opt/fireisp|g' /opt/fireisp/nginx/host-nginx.conf \
  > /etc/nginx/conf.d/fireisp.conf
# Disable the default nginx site to prevent port conflicts
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

**3. Create the certbot webroot directory**

```bash
mkdir -p /opt/fireisp/nginx/certbot-www/.well-known/acme-challenge
```

**4. Bootstrap TLS**

```bash
cd /opt/fireisp
DOMAIN=isp.example.com EMAIL=admin@example.com \
  ./nginx/init-letsencrypt.sh --host-nginx
```

**5. Start the FireISP stack**

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.host-nginx.yml \
  --env-file .env.prod up -d
```

**6. Schedule nginx reloads for certificate renewals**

```bash
# Reload nginx every 6 hours so it picks up renewed certificates
(crontab -l 2>/dev/null; echo "0 */6 * * * /usr/sbin/nginx -s reload 2>/dev/null || true") \
  | crontab -
```

### Management commands (host-nginx mode)

```bash
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.host-nginx.yml --env-file .env.prod"

$COMPOSE logs -f          # tail all service logs
$COMPOSE down             # stop all containers
$COMPOSE pull && $COMPOSE up -d   # fetch the published image and restart

# nginx is managed by systemd, not Docker:
sudo systemctl status nginx
sudo systemctl reload nginx
sudo nginx -t             # test config before reload
```

---

## Certificate Renewal

### Automatic (Let's Encrypt)

The `certbot` service handles renewal automatically:

- Checks every **12 hours** (`certbot renew`).
- Let's Encrypt renews certificates that are **≤ 30 days from expiry** (certificates expire after 90 days).
- On successful renewal, `certbot-deploy-hook.sh` copies the new certs into
  `./nginx/certs/`.
- nginx reloads every **6 hours**, picking up the new certificate within
  6 hours of renewal.

### Verify renewal works (dry-run)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm certbot \
  certbot renew --dry-run
```

### Force an immediate reload of nginx

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec nginx nginx -s reload
```

---

## TLS Configuration Details

The nginx configuration (`nginx/nginx.conf`) is pre-hardened:

| Setting | Value | Note |
|---|---|---|
| Protocols | TLSv1.2, TLSv1.3 | TLS 1.2 retained for MikroTik CPE compatibility |
| Ciphers | ECDHE+AESGCM, CHACHA20 | AEAD only; 3DES and RC4 excluded |
| OCSP stapling | On | Reduces TLS handshake latency |
| Session tickets | Off | Improved forward secrecy |
| Session cache | 10 MB shared | ~40,000 sessions |

**HSTS is set by the application, not by nginx** — `max-age=31536000; includeSubDomains`,
deliberately without `preload`. See the security-header block in `src/app.js`. nginx
`add_header` appends to the upstream's headers rather than replacing them, so setting
them in both places put two values on every response.

To score A+ on [SSL Labs](https://www.ssllabs.com/ssltest/), verify:
- CAA DNS records are set (e.g., `0 issue "letsencrypt.org"`).
- HSTS `max-age` is at least one year (it is).

**HSTS preload is optional and is a one-way door.** Submitting your domain to the
browser preload list is slow to reverse and pins *every* subdomain to HTTPS — enough
to strand a legacy HTTP-only equipment portal on a subdomain of the same host. It is
not required for an A+ score. If you want it, and only after confirming every
subdomain serves HTTPS: add `preload: true` to the `hsts` options in `src/app.js`,
raise `maxAge` to at least `31536000`, redeploy, then submit at
[hstspreload.org](https://hstspreload.org).

---

## Troubleshooting

### nginx fails to start — certificate not found

```
nginx: [emerg] cannot load certificate "/etc/nginx/certs/fullchain.pem"
```

Run `nginx/init-letsencrypt.sh` to bootstrap the certificate before starting
the full stack.

### `init-letsencrypt.sh` exits with `[ERROR] nginx is not running`

The script now prints the actual `nginx -t` output and the last 50 lines of
the nginx container logs before exiting. The most common causes are:

- **`[emerg] host not found in upstream "app:3000"`** — you are running an
  older version of the script that mounted the production `nginx.conf`
  during bootstrap. Pull the latest `nginx/init-letsencrypt.sh` and
  `nginx/nginx.bootstrap.conf` from the repo and re-run.
- **Port 80 already in use** — another service (Apache, system nginx,
  Caddy, or another Docker container) is bound to port 80. See the
  [Host Nginx Mode](#host-nginx-mode-port-80-conflict) section, or stop
  the conflicting service before re-running.
- **Bad edit to `nginx/nginx.conf`** — the printed `nginx -t` output points
  at the offending file/line.

### Port 80 already in use — Docker nginx cannot start

```
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
```

A Docker container or host service already holds port 80.  To identify it:

```bash
sudo ss -tlnp | grep ':80 '
# or
sudo netstat -tlnp | grep ':80 '
```

**Option A — Stop the conflicting service**, then re-run
`nginx/init-letsencrypt.sh` as normal.

**Option B — Use host-nginx mode** (recommended when you have a system nginx
you want to keep running):

```bash
# Switch to host-nginx mode — system nginx becomes the TLS front-door
# and the Docker nginx container is disabled.
USE_HOST_NGINX=1 DOMAIN=isp.example.com EMAIL=admin@example.com \
  ./nginx/init-letsencrypt.sh --host-nginx

docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.host-nginx.yml \
  --env-file .env.prod up -d
```

See [Host Nginx Mode](#host-nginx-mode-port-80-conflict) for the full setup
instructions.

### Certbot ACME challenge fails (HTTP-01)

- Verify port 80 is open in your firewall/security group.
- Confirm DNS A record points to the correct server IP.
- Check nginx logs: `docker compose -f docker-compose.prod.yml --env-file .env.prod logs nginx`
  (Docker nginx mode) or `sudo journalctl -u nginx -n 50` (host-nginx mode).

### Let's Encrypt rate limits

If you hit rate limits during testing, use the staging CA:

```bash
STAGING=1 DOMAIN=isp.example.com EMAIL=admin@example.com \
  ./nginx/init-letsencrypt.sh
```

Staging certificates are not trusted by browsers but do not consume production
rate-limit quota.

### Certificate expires soon (manual cert)

```bash
# Show expiry date
openssl x509 -in nginx/certs/fullchain.pem -noout -enddate

# Days remaining
openssl x509 -in nginx/certs/fullchain.pem -noout -checkend $((30*86400)) \
  && echo "Certificate is valid for more than 30 days." \
  || echo "⚠️  Certificate expires within 30 days — renew now!"
```
