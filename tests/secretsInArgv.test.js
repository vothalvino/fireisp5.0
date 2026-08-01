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
  'deploy-agent.sh',
  'redeploy.sh',
  'mysql/init-replica.sh',
  'nginx/init-letsencrypt.sh',
  'docker-compose.prod.yml',
  'docker-compose.host-nginx.yml',
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
