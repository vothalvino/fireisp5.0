# Secrets Management

This document explains how FireISP 5.0 manages production secrets, what
options are available, and which approach is recommended for each deployment
topology.

---

## Why `.env` files are not enough for production

A plain `.env` file on disk works fine for local development, but for
production deployments it has several problems:

- **Git leak risk** — It is easy to accidentally commit `.env` to the
  repository, exposing credentials to anyone with read access.
- **No audit trail** — File edits leave no record of who changed what secret
  and when.
- **No rotation automation** — Rotating a credential requires SSH access to
  every server, manual edits, and process restarts.
- **No access control** — Every user with shell access to the host can read
  the file.

FireISP supports several alternatives. Pick the one that matches your
infrastructure.

---

## Option 1 — Kubernetes Sealed Secrets ✅ (recommended)

**Best for:** Any Kubernetes deployment (GKE, EKS, AKS, bare-metal k3s/k0s).

[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) is a
Kubernetes controller + CLI tool that lets you encrypt a regular Kubernetes
`Secret` into a `SealedSecret` resource that is **safe to commit to Git**.
Only the controller running inside your cluster can decrypt it.

### How it works

```
Plain Secret (.yaml, NEVER committed)
         │
         │  kubeseal (encrypts with cluster public key)
         ▼
SealedSecret (.yaml, safe to commit)
         │
         │  sealed-secrets controller (decrypts inside cluster)
         ▼
Plain Secret (lives only in etcd, injected into pods as env vars)
```

### Installation

See the step-by-step instructions in **[`k8s/sealed-secret.yaml`](../k8s/sealed-secret.yaml)**.

The quick version:

```bash
# 1. Install the controller
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system \
  --set fullnameOverride=sealed-secrets-controller

# 2. Create a plain Secret (do NOT commit this)
kubectl create secret generic fireisp-secret \
  --namespace fireisp \
  --from-literal=JWT_SECRET="$(openssl rand -base64 48)" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=DB_PASSWORD="$(openssl rand -base64 24)" \
  --dry-run=client -o yaml > /tmp/fireisp-plain.yaml

# 3. Seal it
kubeseal --controller-namespace kube-system \
         --controller-name sealed-secrets-controller \
         --format yaml \
  < /tmp/fireisp-plain.yaml > k8s/sealed-secret.yaml

rm /tmp/fireisp-plain.yaml   # discard plaintext immediately

# 4. Commit k8s/sealed-secret.yaml to Git — safe
git add k8s/sealed-secret.yaml && git commit -m "chore: seal production secrets"

# 5. Apply
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/sealed-secret.yaml
```

### Rotation

```bash
# Re-create the plain Secret with new values, seal, and re-apply.
# Then restart the deployment to pick up the new Secret.
kubectl rollout restart deployment/fireisp -n fireisp
```

### Required secrets

| Key | Purpose |
|---|---|
| `JWT_SECRET` | HS256 signing key (≥ 64 chars) |
| `ENCRYPTION_KEY` | AES-256-GCM key for at-rest encryption (64 hex chars) |
| `DB_PASSWORD` | Application DB user password |
| `DB_ROOT_PASSWORD` | MySQL root password (docker-compose.prod.yml) |
| `SMTP_PASS` | SMTP authentication password |
| `REDIS_PASSWORD` | Redis AUTH password |
| `MYSQL_REPL_PASSWORD` | MySQL replication credential |
| `STRIPE_SECRET_KEY` | Stripe payment API key (if used) |
| `TWILIO_AUTH_TOKEN` | Twilio SMS/WhatsApp token (if used) |
| `PAC_PASSWORD` | SAT PAC provider password (if CFDI enabled) |
| `RADIUS_SECRET` | FreeRADIUS shared secret (if RADIUS enabled) |
| `BACKUP_S3_SECRET_KEY` | Cloud backup key (if S3/B2 enabled) |

---

## Option 2 — External Secrets Operator (ESO) + AWS Secrets Manager

**Best for:** AWS-hosted Kubernetes clusters (EKS) or any cluster with AWS
IAM access.

[External Secrets Operator](https://external-secrets.io/) syncs secrets from
an external provider (AWS Secrets Manager, GCP Secret Manager, HashiCorp
Vault, Azure Key Vault, etc.) into native Kubernetes Secrets.

### Setup

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace
```

### Store all FireISP secrets under one AWS Secrets Manager path

Create the secret in AWS:

```bash
aws secretsmanager create-secret \
  --name "fireisp/production" \
  --secret-string '{
    "JWT_SECRET": "<value>",
    "ENCRYPTION_KEY": "<value>",
    "DB_PASSWORD": "<value>",
    "SMTP_PASS": "<value>",
    "REDIS_PASSWORD": "<value>"
  }'
```

Create an IAM role with `secretsmanager:GetSecretValue` on `fireisp/*` and
annotate the Kubernetes service account to use it (IRSA).

### ClusterSecretStore

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
```

### ExternalSecret

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: fireisp-secret
  namespace: fireisp
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: fireisp-secret
    creationPolicy: Owner
  dataFrom:
    - extract:
        key: fireisp/production
```

ESO will create (and periodically refresh) a Kubernetes Secret named
`fireisp-secret` in the `fireisp` namespace with all keys from the AWS secret.

---

## Option 3 — External Secrets Operator (ESO) + GCP Secret Manager

**Best for:** GKE clusters or any cluster with Workload Identity access to GCP.

```bash
# Create each secret in GCP
echo -n "$(openssl rand -base64 48)" | \
  gcloud secrets create fireisp-jwt-secret --data-file=-

echo -n "$(openssl rand -hex 32)" | \
  gcloud secrets create fireisp-encryption-key --data-file=-
```

Grant the Kubernetes service account the `secretmanager.secretAccessor` role.

### ClusterSecretStore

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: gcp-secret-manager
spec:
  provider:
    gcpsm:
      projectID: my-gcp-project
      auth:
        workloadIdentity:
          clusterLocation: us-central1
          clusterName: my-cluster
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
```

### ExternalSecret

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: fireisp-secret
  namespace: fireisp
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: gcp-secret-manager
    kind: ClusterSecretStore
  target:
    name: fireisp-secret
    creationPolicy: Owner
  data:
    - secretKey: JWT_SECRET
      remoteRef:
        key: fireisp-jwt-secret
    - secretKey: ENCRYPTION_KEY
      remoteRef:
        key: fireisp-encryption-key
    - secretKey: DB_PASSWORD
      remoteRef:
        key: fireisp-db-password
```

---

## Option 4 — HashiCorp Vault

**Best for:** Multi-cloud or on-premise deployments where a central Vault
cluster already exists, or where dynamic credentials are needed.

### Vault Agent Injector

The [Vault Agent Sidecar Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector)
runs a sidecar container that authenticates to Vault, fetches secrets, and
writes them as environment files mounted into the main container.

Enable Vault's Kubernetes auth method:

```bash
vault auth enable kubernetes

vault write auth/kubernetes/config \
  token_reviewer_jwt="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  kubernetes_host="https://$(kubectl get svc kubernetes -o jsonpath='{.spec.clusterIP}'):443" \
  kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt

vault policy write fireisp - <<EOF
path "secret/data/fireisp/production" {
  capabilities = ["read"]
}
EOF

vault write auth/kubernetes/role/fireisp \
  bound_service_account_names=fireisp \
  bound_service_account_namespaces=fireisp \
  policies=fireisp \
  ttl=1h
```

Write the secrets to Vault:

```bash
vault kv put secret/fireisp/production \
  JWT_SECRET="$(openssl rand -base64 48)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  DB_PASSWORD="$(openssl rand -base64 24)"
```

Add annotations to the `fireisp` Deployment pod template to inject secrets:

```yaml
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "fireisp"
  vault.hashicorp.com/agent-inject-secret-config: "secret/data/fireisp/production"
  vault.hashicorp.com/agent-inject-template-config: |
    {{- with secret "secret/data/fireisp/production" -}}
    export JWT_SECRET="{{ .Data.data.JWT_SECRET }}"
    export ENCRYPTION_KEY="{{ .Data.data.ENCRYPTION_KEY }}"
    export DB_PASSWORD="{{ .Data.data.DB_PASSWORD }}"
    {{- end }}
```

Then update the container command to source the injected file:

```yaml
command: ["/bin/sh", "-c", "source /vault/secrets/config && exec node src/server.js"]
```

Alternatively, use ESO with the Vault provider (same ESO installation as
options 2 & 3) — this avoids the sidecar and produces a standard Kubernetes
Secret.

---

## Bare-metal / VM deployments

For non-Kubernetes production deployments (systemd service on a Linux VM):

### Recommended: systemd `LoadCredential`

```ini
[Service]
LoadCredential=jwt_secret:/run/credentials/fireisp/jwt_secret
LoadCredential=encryption_key:/run/credentials/fireisp/encryption_key
ExecStartPre=/bin/sh -c 'export JWT_SECRET=$(cat $CREDENTIALS_DIRECTORY/jwt_secret)'
ExecStart=/usr/bin/node src/server.js
```

Credentials are stored with `0400` permissions and exposed only to the service
process.

### Alternative: environment file with strict permissions

```bash
# /etc/fireisp/secrets.env — NEVER in the application directory or version control
install -m 0600 -o fireisp -g fireisp /dev/null /etc/fireisp/secrets.env
echo "JWT_SECRET=$(openssl rand -base64 48)" >> /etc/fireisp/secrets.env
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> /etc/fireisp/secrets.env
```

Reference it from the systemd unit:

```ini
[Service]
EnvironmentFile=/etc/fireisp/secrets.env
```

Non-secret configuration (NODE_ENV, PORT, etc.) can still live in
`/opt/fireisp/.env`.

---

## Secrets audit: what is and is not logged

### Pino logger redaction

`src/utils/logger.js` configures Pino with a `redact` list. Any log call that
includes one of the listed field names will have the value replaced with
`[REDACTED]` before the line is written to stdout. The redact list covers:

- Common secret field names: `password`, `secret`, `token`, `authorization`,
  `accessToken`, `refreshToken`, `apiKey`, `privateKey`, `clientSecret`
- All known environment variable names: `JWT_SECRET`, `ENCRYPTION_KEY`,
  `DB_PASSWORD`, `SMTP_PASS`, `TWILIO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`,
  `CONEKTA_API_KEY`, `PAC_PASSWORD`, `RADIUS_SECRET`, `REDIS_PASSWORD`,
  `BACKUP_S3_SECRET_KEY`, `CF_API_TOKEN`
- HTTP request fields: `req.headers.authorization`, `req.headers["x-api-key"]`,
  `req.body.password`, `req.body.token`, `req.body.secret`

### URL parameter masking

`src/middleware/requestLogger.js` masks sensitive query parameters
(`password`, `token`, `api_key`, `secret`, `access_token`, `refresh_token`)
in every request log line, replacing their values with `[REDACTED]`.

### Health endpoints

The health endpoints (`/health`, `/health?detail=true`, `/health/live`,
`/health/ready`, `/healthz`) return only operational metadata:

| Field | Example | Secret? |
|---|---|---|
| `status` | `"ok"` | No |
| `version` | `"5.0.0"` | No |
| `uptime` | `3600` | No |
| `relay` | `"standalone"` | No |
| `timestamp` | `"2026-04-23T..."` | No |
| `memory.rss` | `128` (MB) | No |
| `memory.heapUsed` | `64` (MB) | No |
| `db.connected` | `true` | No |
| `db.latencyMs` | `1` | No |
| `checks.redis.connected` | `true` | No |

No secret values, environment variable names, or credentials are ever included
in health endpoint responses.

---

## Checklist — pre-production secrets review

- [ ] No plaintext `.env` file on production hosts (or strict `0600`
  permissions + out-of-repo path)
- [ ] `JWT_SECRET` generated with `openssl rand -base64 48` (≥ 64 chars)
- [ ] `ENCRYPTION_KEY` generated with `openssl rand -hex 32` (64 hex chars)
- [ ] All secrets stored via one of the four options above (Sealed Secrets
  recommended for K8s)
- [ ] `git log --all -p | grep -i "jwt_secret\|encryption_key\|db_password"` returns nothing
- [ ] Pino redact list includes any new secret field names added to the app
- [ ] Health endpoints verified: `curl .../health?detail=true` shows no secrets
- [ ] Secret rotation procedure documented and tested at least once
