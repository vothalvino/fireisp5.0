# Remote backup destination (PR #460, migration 404)

UI-configurable off-site backup target speaking the S3 API (AWS / GCS interop / B2 / R2 / self-hosted MinIO / custom), plus `backup_runs` visibility for every dump.

## Where things live
- `backup_settings` is a SINGLETON row (id=1, CHECK-constrained) — database backups are instance-wide like the org-NULL `database_backup` task. Secret follows the EmailSettings mold exactly (AES-GCM `secret_key_encrypted`, `toPublic()` masks, three-state write contract omit/`''`/value).
- Effective-config precedence lives in `backupSettingsService.getEffectiveRemoteConfig()`: enabled+complete DB row > `BACKUP_S3_*` env vars > null. An enabled-but-incomplete row (only reachable by direct DB edit) resolves to NULL loudly, NOT to env — the admin's intent was the row.
- `src/scripts/backup.js` requires this service top-level; the service requires backup.js LAZILY (BACKUP_DIR, runBackupNow) — flip that and you have a require cycle. backup.js keeps all DB-touching requires inside `backup()` so plain requires (rotate-only tests) stay DB-free.
- Routes mounted behind `adminIpAllowlist` like dr-drill; slugs `backup_settings.view/update` seeded admin+super_admin ONLY (migration 386 carve-out convention).

## Durable gotchas learned here
- **SigV4 canonical path needs AWS UriEncode, not bare `encodeURIComponent`**: also percent-encode `!'()*` per segment, keep `/` literal. Under-encoding fails ONLY for keys containing those chars — tests with plain names pass, then a real filename explodes with SignatureDoesNotMatch. Live-verified against MinIO.
- A custom endpoint may carry a base path (reverse-proxied MinIO `https://host/minio`) — the SIGNED path and the SENT path must both include it (`resolveTarget().basePath`).
- Never reflect a remote server's HTTP response body into API-visible error fields when the target host is user/admin-configurable — that upgrades blind SSRF into a readable one. Surface only the S3 `<Code>` token; log the body server-side (`remoteError()` in cloudStorageService).
- CI's README-sync gate also checks the TABLE count (`all N tables` vs `grep -c "CREATE TABLE" database/schema.sql`), not just the migration range — bump both when adding tables.
- Live S3 testing without Docker: MinIO server + mc are single user-space binaries; run from a scratch dir on a localhost port and you get real SigV4 validation (wrong-secret 403) and byte-integrity checks. ~100MB downloads — background them.
- Frontend forms hydrated from react-query: gate the sync effect on a `dirty` flag or any invalidate/refetch (e.g. after a test-connection call) silently clobbers unsaved edits.
