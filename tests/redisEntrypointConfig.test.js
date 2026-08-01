'use strict';
// =============================================================================
// FireISP 5.0 — the Redis entrypoint writes a config Redis can actually parse
// =============================================================================
// The password was moved out of `redis-server --requirepass <pw>` (argv, and
// /proc/<pid>/cmdline is world-readable) into a config file written from the
// container's environment. That trade buys secrecy and inherits redis.conf's
// QUOTING RULES, which are not obvious and fail in two very different ways:
//
//   password contains "  or ends in \   -> "Unbalanced quotes in configuration
//                                          line" -> redis exit(1) -> crash-loop
//   password contains an interior \     -> Redis starts having stored a
//                                          DIFFERENT password (\n, \xNN are
//                                          interpreted) -> auth fails silently
//
// Neither is contained to Redis: `app` gates on `redis: service_healthy`, so
// either one wedges the entire stack on `up -d`, with the only diagnosis buried
// in `docker compose logs redis`.
//
// So this test does not assert on the YAML text. It EXTRACTS the entrypoint
// script, runs it under /bin/sh exactly as the container would, and parses the
// file it produced with a port of Redis's own sdssplitargs() — asserting the
// password Redis would end up requiring is byte-for-byte the one we supplied.
// =============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const COMPOSE = path.join(__dirname, '..', 'docker-compose.prod.yml');

/**
 * Pull the redis service's entrypoint block scalar out of the compose file and
 * undo compose's `$$` escape, yielding the script text the container shell
 * actually receives.
 */
function entrypointScript() {
  const text = fs.readFileSync(COMPOSE, 'utf8');
  const start = text.indexOf('    entrypoint:');
  expect(start).toBeGreaterThan(-1);
  const lines = text.slice(start).split('\n');
  const body = [];
  let inBlock = false;
  for (const line of lines.slice(1)) {
    if (!inBlock) {
      if (line.trim() === '- |') { inBlock = true; }
      continue;
    }
    // The block ends at the next key at the service's indent level.
    if (/^ {4}\S/.test(line)) break;
    body.push(line.replace(/^ {8}/, ''));
  }
  expect(body.length).toBeGreaterThan(3);
  // compose renders `$$` as a literal `$` for the container.
  return body.join('\n').replace(/\$\$/g, '$');
}

/**
 * Port of redis sds.c sdssplitargs(). Returns the parsed argument vector, or
 * null for the unbalanced-quotes error — which in config.c is a hard
 * `*** FATAL CONFIG FILE ERROR ***` followed by exit(1).
 */
function sdssplitargs(line) {
  let p = 0;
  const vector = [];
  for (;;) {
    while (p < line.length && /\s/.test(line[p])) p++;
    if (p >= line.length) return vector;
    let inq = false, insq = false, done = false, cur = '';
    while (!done) {
      if (inq) {
        if (line[p] === '\\' && line[p + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(line.slice(p + 2, p + 4))) {
          cur += String.fromCharCode(parseInt(line.slice(p + 2, p + 4), 16));
          p += 3;
        } else if (line[p] === '\\' && p + 1 < line.length) {
          p++;
          cur += ({ n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07' })[line[p]] ?? line[p];
        } else if (line[p] === '"') {
          if (p + 1 < line.length && !/\s/.test(line[p + 1])) return null;
          done = true;
        } else if (p >= line.length) {
          return null;
        } else {
          cur += line[p];
        }
      } else if (insq) {
        if (line[p] === '\\' && line[p + 1] === "'") { p++; cur += "'"; } else if (line[p] === "'") {
          if (p + 1 < line.length && !/\s/.test(line[p + 1])) return null;
          done = true;
        } else if (p >= line.length) { return null; } else { cur += line[p]; }
      } else {
        const c = p < line.length ? line[p] : null;
        if (c === null || /\s/.test(c)) done = true;
        else if (c === '"') inq = true;
        else if (c === "'") insq = true;
        else cur += c;
      }
      if (p < line.length) p++;
      if (p >= line.length && !done) {
        if (inq || insq) return null;
        done = true;
      }
    }
    vector.push(cur);
  }
}

/**
 * Run the real entrypoint script with REDIS_PASSWORD set, against stubs for the
 * things only a container provides, and return the requirepass line it wrote.
 */
function requirepassLineFor(password, { chownFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-redis-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // `exec docker-entrypoint.sh redis-server <conf> ...` must be reached, and is
  // where the real image chowns /data and drops to the redis user.
  fs.writeFileSync(path.join(bin, 'docker-entrypoint.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_ARGV_OUT"\n');
  // chown needs root in a container; here it must simply not abort the script.
  fs.writeFileSync(path.join(bin, 'chown'), `#!/bin/sh\nexit ${chownFails ? 1 : 0}\n`);
  for (const f of ['docker-entrypoint.sh', 'chown']) fs.chmodSync(path.join(bin, f), 0o755);

  const argvOut = path.join(dir, 'argv.txt');
  // The script writes to a fixed /tmp path; run it with TMPDIR-independent
  // redirection by rewriting that single literal to the sandbox.
  const conf = path.join(dir, 'redis.conf');
  const script = entrypointScript().replace(/\/tmp\/redis\.conf/g, conf);

  execFileSync('sh', ['-c', script], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      REDIS_PASSWORD: password,
      STUB_ARGV_OUT: argvOut,
      REDIS_MAXMEMORY: '256mb',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    line: fs.readFileSync(conf, 'utf8').split('\n').find((l) => l.startsWith('requirepass')),
    argv: fs.readFileSync(argvOut, 'utf8').trim().split('\n'),
    mode: fs.statSync(conf).mode & 0o777,
  };
}

/** Same, but expects the script to abort; returns its exit status and stderr. */
function runExpectingFailure(password, opts) {
  try {
    requirepassLineFor(password, opts);
    return null;
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr || '') };
  }
}

// Alphanumeric is what install.sh's gen_pass produces; the rest are what an
// operator's password manager produces, and every one of them broke the
// unescaped version — three fatally, three by silently changing the password.
const PASSWORDS = [
  ['generated (alphanumeric)', 'AbC123xyzQ9'],
  ['with spaces', 'has space here'],
  ['embedded double quote', 'quo"te'],
  ['quote and backslash', 'a"b\\c'],
  ['trailing backslash', 'tail\\'],
  ['interior backslash', 'back\\slash'],
  ['backslash-n', 'pa\\nss'],
  ['backslash-x hex', 'hex\\x41here'],
  ['single quote', "sin'gle"],
  ['shell substitution shapes', '$(id)`id`'],
  ['dollar and brace', '${FOO}$BAR'],
];

describe('the redis entrypoint writes a config Redis parses back exactly', () => {
  it.each(PASSWORDS)('%s', (_label, password) => {
    const { line } = requirepassLineFor(password);
    const parsed = sdssplitargs(line);
    // null = "Unbalanced quotes in configuration line" = redis exit(1).
    expect(parsed).not.toBeNull();
    expect(parsed[0]).toBe('requirepass');
    // The password Redis ends up requiring must equal what the app will send.
    expect(parsed[1]).toBe(password);
  });
});

describe('the entrypoint keeps its other guarantees', () => {
  it('puts no password on redis-server argv — only the config path and tuning', () => {
    const password = 'AbC123xyzQ9';
    const { argv } = requirepassLineFor(password);
    expect(argv[0]).toBe('redis-server');
    expect(argv.join(' ')).not.toContain(password);
    expect(argv.join(' ')).toContain('--maxmemory');
  });

  it('still exec s the image entrypoint, which is what drops privileges', () => {
    // The official image chowns /data and gosu's to the redis user ONLY when
    // arg 1 is redis-server and it is running as root. Bypassing it would leave
    // Redis running as root with a root-owned data dir.
    expect(entrypointScript()).toMatch(/exec docker-entrypoint\.sh redis-server/);
  });

  it('does not leave the plaintext config world-readable inside the container', () => {
    const { mode } = requirepassLineFor('AbC123xyzQ9');
    expect(mode & 0o077).toBe(0);
  });

  it('fails loudly if the config cannot be handed to the redis user', () => {
    // The file is created 0600 root-owned (umask 077) and the image entrypoint
    // drops to the redis user before redis-server reads it. If the chown were
    // skipped, redis-server would die on an unreadable config — a crash loop
    // whose message points at the file, not at the cause. Better to stop here
    // and say so.
    const failed = runExpectingFailure('AbC123xyzQ9', { chownFails: true });
    expect(failed).not.toBeNull();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/could not give the config to the redis user/);
  });
});
