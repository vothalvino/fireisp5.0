# TLS Setup Guide

FireISP 5.0 ships with a production-ready Nginx reverse proxy that enforces
HTTPS.  This guide covers three ways to provision TLS certificates:

| Method | Use case |
|---|---|
| [Let's Encrypt (HTTP-01)](#lets-encrypt-http-01-challenge) | Single-domain cert, server reachable on port 80 |
| [Let's Encrypt (DNS-01 / Cloudflare)](#lets-encrypt-dns-01-cloudflare) | Wildcard cert (`*.isp.example.com`), or server not on port 80 |
| [Manual / commercial certificate](#manual--commercial-certificate) | Bring-your-own cert (DigiCert, ZeroSSL, self-signed) |

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
1. Creates a temporary self-signed certificate in `./nginx/certs/`.
2. Starts the nginx container with the dummy cert.
3. Runs Certbot (`certonly --webroot`) to issue the real certificate.
4. Copies `fullchain.pem` + `privkey.pem` into `./nginx/certs/`.
5. Sends `nginx -s reload` so nginx uses the real certificate immediately.

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

### Certbot ACME challenge fails (HTTP-01)

- Verify port 80 is open in your firewall/security group.
- Confirm DNS A record points to the correct server IP.
- Check nginx logs: `docker compose -f docker-compose.prod.yml logs nginx`.

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
