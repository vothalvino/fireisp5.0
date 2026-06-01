# Volume Persistence — Verification & Migration Protocol

Before updating or recreating the FireISP application stack, you must confirm
that **no data loss will occur** when a container is stopped and removed
(`docker rm`). This guide is the operational companion to the
[backup & restore guide](backup-restore.md): use it to **verify** that the
database and other persistent data are safe, and to **migrate** them to a
persistent host volume if they are currently ephemeral.

---

## Mission Objective

Containers are immutable cattle, not pets. Anything written to a container's
writable layer is destroyed the moment the container is removed. Data only
survives container recreation when it is stored on a **persistent mount**:

- a **named volume** (e.g. `db_primary_data:/var/lib/mysql`), or
- a **host bind mount** (e.g. `./storage:/app/storage`).

Data is **ephemeral** when no mount covers its directory — it lives in the
container's mutable layer and is lost on `docker rm`,
`docker compose up --force-recreate`, or an image update.

> **The one command that destroys persistent data:** `docker compose down -v`
> (and `docker volume rm` / `docker volume prune`). Never use the `-v` flag
> during a routine update.

In the shipped FireISP compose files the critical paths are **already**
persistent:

| Service | Container path | Volume (prod) | Volume (dev) |
|---------|----------------|---------------|--------------|
| MySQL primary | `/var/lib/mysql` | `db_primary_data` | `db_data` |
| MySQL replica | `/var/lib/mysql` | `db_replica_data` | — |
| Redis (AOF) | `/data` | `redis_data` | `redis_data` |
| App storage | `/app/storage` | `./storage` (bind) | `./storage` (bind) |
| ChromaDB | `/chroma/chroma` | `chroma_data` | `chroma_data` |

See [`docker-compose.prod.yml`](../docker-compose.prod.yml) and
[`docker-compose.yml`](../docker-compose.yml).

---

## Phase 1 — Verify (automated)

FireISP ships a verifier that inspects a running container and reports whether
each critical path is persistent or ephemeral:

```bash
# Check the MySQL data directory (default target)
npm run verify:volumes -- fireisp-db-1

# Check several paths at once
npm run verify:volumes -- fireisp-db-1 /var/lib/mysql
npm run verify:volumes -- fireisp-redis-1 /data
npm run verify:volumes -- fireisp-app-1 /app/storage
```

Exit codes make it scriptable in a pre-update gate:

| Exit code | Meaning | Action |
|-----------|---------|--------|
| `0` | All checked paths are **persistent** | Proceed to the update phase |
| `1` | At least one path is **ephemeral** | Run Phase 2 (back up + migrate) first |
| `2` | Could not inspect the container | Check the container name / Docker access |

The verifier classifies `volume` and `bind` mounts as safe; a missing mount or
a `tmpfs` mount is reported as ephemeral.

### Manual cross-check

```bash
# List mount type → name → destination for a container
docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{println}}{{end}}' fireisp-db-1

# Confirm the named volume exists and is Docker-managed
docker volume ls | grep -E 'db_data|db_primary_data'
```

If the mount for `/var/lib/mysql` shows **`volume`** (with a name) or
**`bind`** (with a host source), the data is safe.

---

## Phase 2 — Migrate ephemeral data to a named volume

Only required when Phase 1 reports a path as **ephemeral** (for example, a
container that was started manually with `docker run` and no `-v` flag). The
safest migration is a logical dump taken **before** the old container is
removed, restored into the new container that has the named volume attached.

1. **Back up while the old container is still alive.** A logical dump survives
   any storage-driver or schema change across recreation:

   ```bash
   docker exec fireisp-db-1 sh -c \
     'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
       --single-transaction --routines --triggers --events --all-databases' \
     | gzip > migrate-$(date +%F-%H%M%S).sql.gz
   ```

   (Or run `npm run backup` if the app container can reach the database.)

2. **Recreate the stack from the committed compose file** so the named volume
   is attached. Bring the stack down **without** `-v`:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod down
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
   ```

3. **Restore the dump** into the now-persistent volume:

   ```bash
   gunzip < migrate-YYYY-MM-DD-HHMMSS.sql.gz \
     | docker exec -i fireisp-db-1 sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
   ```

4. **Re-verify** before declaring success:

   ```bash
   npm run verify:volumes -- fireisp-db-1
   ```

5. **Enable the event scheduler** (required for SNMP rollups and partition
   maintenance) and run the preflight check — see
   [backup-restore.md → Restore Procedures](backup-restore.md#restore-procedures).

---

## Belt-and-suspenders for an update

TLS artifacts in `./nginx/certs` and `./nginx/letsencrypt` are host-visible
mounts that also survive recreation. Before any update, back up `.env.prod`,
`nginx/certs`, and `nginx/letsencrypt` so certificates are never rotated
unexpectedly (consistent with the [TLS setup guide](tls-setup.md)).
