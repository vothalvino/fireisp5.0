'use strict';
// =============================================================================
// FireISP 5.0 — no credential may reach process argv
// =============================================================================
// /proc/<pid>/cmdline is mode 0444: every local account can read the argv of
// every process on the box, root's included — and CONTAINER processes appear in
// the host's /proc too, so "it runs inside Docker" is no shelter. Environment
// variables are safe (/proc/<pid>/environ is owner-only); argv is not.
//
// This class produced three real exposures found on one day (2026-08-01):
//   * deploy-agent.sh passed the SQL statement via `compose exec -e` — host
//     argv, carrying root-captured deploy output (fixed in PR #630)
//   * docker-compose.prod.yml healthchecks interpolated DB_ROOT_PASSWORD into
//     mysqladmin argv — refreshed every 10s for the life of the stack
//   * install.sh / mysql/init-replica.sh passed the root password as
//     -p"${MYSQL_ROOT_PASSWORD}" — for minutes, in retry loops
//
// The accepted idioms are MYSQL_PWD (expanded INSIDE the container, inside a
// single-quoted sh -c), statements over stdin, and --password-stdin.
//
// This is a RATCHET over the files that carry real production secrets. Test
// fixtures (docker-compose.test.yml's -ptestpassword) are deliberately not
// listed: a throwaway test-container password is not a secret.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');

const FILES = [
  'install.sh',
  'setup.sh',
  'deploy-agent.sh',
  'redeploy.sh',
  'mysql/init-replica.sh',
  'nginx/init-letsencrypt.sh',
  'docker-compose.prod.yml',
  'docker-compose.host-nginx.yml',
];

// Operator-facing docs are ratcheted too: a recipe that teaches the
// anti-pattern gets copy-pasted onto a real production box, which is the same
// exposure with extra steps. Comment/prose lines are excluded below, so these
// files may still NAME the constructs while explaining why they are wrong.
const DOCS = [
  'README.md',
  'docs/backup-restore.md',
  'docs/dr-drill.md',
  'docs/volume-persistence.md',
  'docs/secrets-management.md',
  'docs/deployment.md',
  'k8s/sealed-secret.yaml',
];

// Comment lines are excluded: these files DOCUMENT the rejected constructs
// while explaining why — a bare substring match flags its own rationale (the
// prose-vs-construct trap that produced three phantom test failures in this
// feature already).
const codeLines = (file) => fs
  .readFileSync(path.join(__dirname, '..', file), 'utf8')
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => !line.trim().startsWith('#'));

describe.each(FILES)('%s keeps credentials out of argv', (file) => {
  it('never passes --password=<value>', () => {
    const hits = codeLines(file).filter(({ line }) => /--password=/.test(line));
    expect(hits).toEqual([]);
  });

  it('never passes -p<password> to a mysql-family client', () => {
    // Scoped to mysql/mysqladmin/mysqldump lines so `mkdir -p "$DIR"` and
    // compose's own flags cannot false-positive.
    const hits = codeLines(file).filter(({ line }) =>
      /\b(mysql|mysqladmin|mysqldump)\b/.test(line) && /\s-p["']?[$\w]/.test(line));
    expect(hits).toEqual([]);
  });

  it('never passes a secret to redis-cli with -a', () => {
    const hits = codeLines(file).filter(({ line }) =>
      /\bredis-cli\b/.test(line) && /\s-a\s/.test(line));
    expect(hits).toEqual([]);
  });
});

describe.each(DOCS)('%s teaches no secret-in-argv recipe', (file) => {
  // Markdown prose and YAML comments are stripped: these documents legitimately
  // discuss --password / --from-literal / --set while explaining the hazard.
  // Only fenced shell blocks (and, for the YAML, indented command comments) can
  // be copy-pasted onto a real box, so only they are policed.
  const runnable = () => {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const lines = text.split('\n');
    if (file.endsWith('.yaml')) {
      // The install recipe lives in a comment block; a reader still runs it.
      return lines.filter((l) => /^#\s{2,}\S/.test(l)).join('\n');
    }
    const out = [];
    let inFence = false;
    for (const line of lines) {
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) out.push(line);
      else if (line.startsWith('|')) out.push(line); // command tables
    }
    return out.join('\n');
  };

  it('never documents --password=<value> or -p<value>', () => {
    const bad = runnable().split('\n').filter((l) =>
      /--password[= ]\S/.test(l) || /\b(mysql|mysqladmin|mysqldump|xtrabackup|mariabackup)\b[^\n]*\s-p["'$]/.test(l));
    expect(bad).toEqual([]);
  });

  it('never documents kubectl --from-literal or helm --set for a secret', () => {
    const bad = runnable().split('\n').filter((l) =>
      /--from-literal=/.test(l) || /--set\s+[A-Za-z_.]*(SECRET|PASSWORD|KEY)/i.test(l));
    expect(bad).toEqual([]);
  });

  it('never documents redis-cli -a <password>', () => {
    const bad = runnable().split('\n').filter((l) => /\bredis-cli\b[^\n]*\s-a\s/.test(l));
    expect(bad).toEqual([]);
  });

  it('never documents admin.js --password', () => {
    const bad = runnable().split('\n').filter((l) => /admin(\.js)?\b[^\n]*--password/.test(l));
    expect(bad).toEqual([]);
  });
});
