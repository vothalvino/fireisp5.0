'use strict';
// =============================================================================
// FireISP 5.0 — attachments are written where deployments actually mount
// =============================================================================
// Ticket attachments and work-order photos used to be written to
// `<repo>/uploads/...`, a directory NO deployment mounts. Everything else in
// the app writes under STORAGE_ROOT (`<repo>/storage`), which is mounted as
// `storage:/app/storage` in docker-compose.prod.yml and as the fireisp-storage
// PVC in k8s/deployment.yaml.
//
// Three distinct failures came out of that one wrong path:
//
//   * Docker — files lived in the container's writable layer, so every redeploy
//     silently destroyed every ticket attachment and technician job photo.
//   * Kubernetes — `readOnlyRootFilesystem: true` made the top-level mkdirSync
//     throw EROFS during require(), so the app did not fail to upload, it
//     failed to BOOT.
//   * Multi-replica — files were never shared between pods.
//
// The first is invisible until a redeploy and unrecoverable afterwards, which is
// why this file guards the shape of the fix and not just its behaviour.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { STORAGE_ROOT, resolveStoredPath, attachmentStorage } = require('../src/middleware/upload');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const ATTACHMENT_ROUTES = ['src/routes/tickets.js', 'src/routes/workOrders.js'];

describe('attachment directories live under STORAGE_ROOT', () => {
  it.each(ATTACHMENT_ROUTES)('%s writes nothing to an unmounted uploads/ path', (file) => {
    const body = read(file);
    // Comments explaining the old path are fine; a live path is not.
    const offenders = body.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => !line.trim().startsWith('//'))
      .filter(([, line]) => /['"`][^'"`]*\.\.\/\.\.\/uploads/.test(line));
    expect(offenders).toEqual([]);
  });

  it.each(ATTACHMENT_ROUTES)('%s uses the shared attachmentStorage helper', (file) => {
    expect(read(file)).toMatch(/attachmentStorage\(/);
  });

  it('the helper resolves to a subdirectory of STORAGE_ROOT', () => {
    // multer calls destination(req, file, cb); assert where it points without
    // performing a real upload.
    const storage = attachmentStorage('tickets');
    let got = null;
    storage.getDestination({}, {}, (err, dir) => { if (!err) got = dir; });
    expect(got).toBe(path.join(STORAGE_ROOT, 'tickets'));
    expect(got.startsWith(STORAGE_ROOT + path.sep)).toBe(true);
  });
});

describe('no attachment directory is created at module load', () => {
  // This is the k8s boot-loop guard. A top-level mkdirSync runs during
  // require(), so on a read-only root filesystem it throws EROFS while app.js
  // is still mounting routes and kills the process. The directory must be
  // created at UPLOAD time, where a failure is a 422 on one request instead.
  it.each(ATTACHMENT_ROUTES)('%s has no top-level mkdirSync', (file) => {
    const topLevel = read(file).split('\n')
      .filter(line => /^\s{0,2}(?:const|let|var|if|fs)\b/.test(line))
      .filter(line => /mkdirSync/.test(line));
    expect(topLevel).toEqual([]);
  });

  it('the guard would catch the exact line that was removed', () => {
    // Without this, a regex that silently matches nothing makes both
    // assertions above pass forever.
    const sample = 'if (!fs.existsSync(ATTACH_DIR)) fs.mkdirSync(ATTACH_DIR, { recursive: true });';
    expect(/^\s{0,2}(?:const|let|var|if|fs)\b/.test(sample)).toBe(true);
    expect(/mkdirSync/.test(sample)).toBe(true);
  });
});

describe('resolveStoredPath accepts both stored shapes', () => {
  it('joins a relative path onto STORAGE_ROOT', () => {
    expect(resolveStoredPath('tickets/1700000000-abc.png'))
      .toBe(path.join(STORAGE_ROOT, 'tickets/1700000000-abc.png'));
  });

  it('returns a legacy absolute path unchanged', () => {
    // Rows written before the fix stored req.file.path verbatim. Those files
    // must stay downloadable on an install that has not been recreated yet.
    const legacy = '/app/uploads/tickets/1700000000-xyz.pdf';
    expect(resolveStoredPath(legacy)).toBe(legacy);
  });

  it('refuses a relative path that escapes STORAGE_ROOT', () => {
    // A malformed or tampered row must never become a read of an arbitrary
    // file — the value reaches res.sendFile().
    expect(resolveStoredPath('../../../etc/passwd')).toBeNull();
    expect(resolveStoredPath('tickets/../../../etc/shadow')).toBeNull();
  });

  it('refuses empty and non-string values', () => {
    expect(resolveStoredPath('')).toBeNull();
    expect(resolveStoredPath(null)).toBeNull();
    expect(resolveStoredPath(undefined)).toBeNull();
    expect(resolveStoredPath(42)).toBeNull();
  });
});

describe('what the deployment actually mounts', () => {
  // The bug was a mismatch between code and deployment, so assert the other
  // half too — moving the mount without moving the code reintroduces it.
  it('docker-compose.prod.yml mounts the storage volume at /app/storage', () => {
    expect(read('docker-compose.prod.yml')).toMatch(/-\s*storage:\/app\/storage/);
  });

  it('k8s mounts a volume at /app/storage', () => {
    expect(read('k8s/deployment.yaml')).toMatch(/mountPath:\s*\/app\/storage/);
  });

  it('neither deployment mounts anything at /app/uploads', () => {
    for (const f of ['docker-compose.prod.yml', 'k8s/deployment.yaml']) {
      expect(read(f)).not.toMatch(/\/app\/uploads/);
    }
  });
});
