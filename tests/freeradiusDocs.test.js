const fs = require('fs');
const path = require('path');

describe('bundled FreeRADIUS SQL module', () => {
  const sqlConfig = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'freeradius', 'sql.conf'),
    'utf8',
  );

  test('loads stock dialect queries and configures the post-auth table', () => {
    expect(sqlConfig).toMatch(/^\s*postauth_table\s*=\s*"radpostauth"/m);
    expect(sqlConfig).toMatch(/^\s*auto_escape\s*=\s*yes/m);
    expect(sqlConfig).toMatch(
      /^\s*\$INCLUDE\s+\$\{modconfdir\}\/\$\{\.:name\}\/main\/\$\{dialect\}\/queries\.conf/m,
    );
  });

  test('documents SQL logging for both accept and reject post-auth paths', () => {
    const readme = fs.readFileSync(
      path.join(__dirname, '..', 'docs', 'freeradius', 'README.md'),
      'utf8',
    );
    expect(readme).toMatch(/post-auth\s*\{[\s\S]*?Post-Auth-Type REJECT\s*\{[\s\S]*?\n\s*sql\s+/);
    expect(readme).toContain('stock fail-soft `-sql` entry must also be enabled as `sql`');
    expect(readme).toMatch(/SELECT COUNT\(\*\)[\s\\]*FROM nas n2[\s\S]*?= 1/);
  });
});
