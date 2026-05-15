# TLS Setup Guide

FireISP 5.0 ships with a production-ready Nginx reverse proxy that enforces
HTTPS.  This guide covers four ways to provision TLS certificates:

| Method | Use case |
|---|---|
| [Let's Encrypt (HTTP-01)](#lets-encrypt-http-01-challenge) | Single-domain cert, server reachable on port 80 |
| [Let's Encrypt (DNS-01 / Cloudflare)](#lets-encrypt-dns-01-cloudflare) | Wildcard cert (`*.isp.example.com`), or server not on port 80 |
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
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -subject -dates
```

---

## Let's Encrypt (DNS-01 / Cloudflare)

Use this method when:
- You need a **wildcard certificate** (`*.isp.example.com`).
- Your server is behind a NAT/firewall and port 80 is not reachable from the
  internet.
- You use Cloudflare as your DNS provider.

**Requirements:** A Cloudflare API Token with `Zone:Read` + `DNS:Edit` scopes
for the zone containing your domain.  Create one at
<https://dash.cloudflare.com/profile/api-tokens>.

### 1. Create the Cloudflare credentials file

```bash
cp nginx/cloudflare.ini.example nginx/cloudflare.ini
# Edit nginx/cloudflare.ini and paste your API token:
#   dns_cloudflare_api_token = <your-token>
chmod 600 nginx/cloudflare.ini
```

> **Security:** `nginx/cloudflare.ini` is listed in `.gitignore` and must never
> be committed to source control.

### 2. Bootstrap the first certificate

```bash
chmod +x nginx/init-letsencrypt.sh
CF_API_TOKEN=<your-token> DOMAIN=isp.example.com EMAIL=admin@example.com \
  ./nginx/init-letsencrypt.sh --cloudflare
```

This issues certificates for both `isp.example.com` **and** `*.isp.example.com`
using the DNS-01 challenge.  A 60-second propagation delay is built in to allow
Cloudflare to publish the `_acme-challenge` TXT record.

### 3. Configure the certbot service for DNS-01 renewal

The default `certbot/certbot` image does not include the Cloudflare plugin.
Switch the image to `certbot/dns-cloudflare` in `docker-compose.prod.yml` for
DNS-01 renewal:

```yaml
certbot:
  image: certbot/dns-cloudflare:latest
  environment:
    - CF_API_TOKEN=${CF_API_TOKEN}
  entrypoint: >
    /bin/sh -c
    'trap exit TERM;
     while :; do
       certbot renew --quiet \
         --dns-cloudflare \
         --dns-cloudflare-credentials /cloudflare.ini \
         --dns-cloudflare-propagation-seconds 60;
       sleep 12h & wait $${!};
     done'
  volumes:
    - certbot_conf:/etc/letsencrypt
    - certbot_www:/var/www/certbot
    - ./nginx/certs:/certs
    - ./nginx/certbot-deploy-hook.sh:/etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh:ro
    - ./nginx/cloudflare.ini:/cloudflare.ini:ro
```

Then add `CF_API_TOKEN` to `.env.prod`:

```env
CF_API_TOKEN=your-cloudflare-api-token
```

### 4. Start the stack and verify

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
openssl s_client -connect isp.example.com:443 -servername isp.example.com \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -dates
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
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
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

For Cloudflare DNS-01 (wildcard certs), combine both flags:

```bash
CF_API_TOKEN=<token> DOMAIN=isp.example.com EMAIL=admin@example.com \
  ./nginx/init-letsencrypt.sh --cloudflare --host-nginx
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
$COMPOSE up -d --build    # rebuild and restart

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
docker compose -f docker-compose.prod.yml run --rm certbot \
  certbot renew --dry-run
```

### Force an immediate reload of nginx

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## TLS Configuration Details

The nginx configuration (`nginx/nginx.conf`) is pre-hardened:

| Setting | Value | Note |
|---|---|---|
| Protocols | TLSv1.2, TLSv1.3 | TLS 1.2 retained for MikroTik CPE compatibility |
| Ciphers | ECDHE+AESGCM, CHACHA20 | AEAD only; 3DES and RC4 excluded |
| HSTS | `max-age=63072000; includeSubDomains; preload` | 2-year HSTS with preload |
| OCSP stapling | On | Reduces TLS handshake latency |
| Session tickets | Off | Improved forward secrecy |
| Session cache | 10 MB shared | ~40,000 sessions |

To score A+ on [SSL Labs](https://www.ssllabs.com/ssltest/), verify:
- HSTS preload is submitted after your first deployment.
- CAA DNS records are set (e.g., `0 issue "letsencrypt.org"`).

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
- Check nginx logs: `docker compose -f docker-compose.prod.yml logs nginx`
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

---

## Reinstalling Without Rotating Certificates

When reinstalling or updating FireISP, preserve your existing TLS certificate and ACME state. Certificates are stored in persistent Docker volumes that survive container recreation.

### Backup Before Reinstall

```bash
cd /opt/fireisp

# Archive certificate, ACME state, and environment
sudo tar -czf /root/fireisp-ssl-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  nginx/certs \
  nginx/letsencrypt \
  .env.prod

# Verify
ls -lh /root/fireisp-ssl-backup-*.tar.gz
```

### Reinstall Flow

1. **Stop the stack** (preserve volumes):
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod down
   # ⚠️  Never use: docker compose down -v  (destroys cert volumes)
   ```

2. **Update FireISP code**:
   ```bash
   git pull origin main
   # or re-download if not using git
   ```

3. **Restore TLS assets**:
   ```bash
   sudo tar -xzf /root/fireisp-ssl-backup-*.tar.gz -C /opt/fireisp
   
   # Verify certs are in place
   ls -la /opt/fireisp/nginx/certs/
   # Should show: fullchain.pem  privkey.pem
   ```

4. **Bring stack online**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
   ```

### Verify Certificate Continuity

Compare serial number before and after to confirm cert was not re-issued:

```bash
# Before reinstall
openssl x509 -in nginx/certs/fullchain.pem -noout -serial

# After reinstall
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -serial
```

**Serial and expiry date must be identical.**

### Why This Works

- **setup.sh is idempotent**: JWT_SECRET and ENCRYPTION_KEY in `.env.prod` are not rotated if they already exist, preserving session validity and DB encryption state.
- **nginx reads from persistent paths**: The container mounts `./nginx/certs → /etc/nginx/certs`. As long as files exist on disk, they are used.
- **Certbot state is preserved**: `/opt/fireisp/nginx/letsencrypt/` contains ACME account metadata, certificate archives, and renewal configuration. The certbot service continues on the same renewal schedule without re-issuing.

### Guardrails

❌ **Don't:**
- `docker compose down -v` — removes volumes and deletes certificates
- `docker system prune -a --volumes` — dangerous; deletes cert data
- `rm -rf nginx/certs` — deletes certificate files
- Re-run `./nginx/init-letsencrypt.sh` unless certificates are corrupted/missing
