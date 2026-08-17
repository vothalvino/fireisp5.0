'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SNMP trap listener deployment boundary', () => {
  test('Compose separates the container bind from the loopback-safe host publish address', () => {
    for (const file of ['docker-compose.yml', 'docker-compose.prod.yml']) {
      const source = read(file);
      expect(source).toContain(
        '${SNMP_TRAP_PUBLISH_IP:-127.0.0.1}:${SNMP_TRAP_PORT:-1620}:${SNMP_TRAP_PORT:-1620}/udp',
      );
      expect(source).toMatch(/SNMP_TRAP_PORT:\s+\$\{SNMP_TRAP_PORT:-1620\}/);
      expect(source).toMatch(/SNMP_TRAP_BIND_IP:\s+0\.0\.0\.0/);
    }
  });

  test('example environments keep the receiver loopback-only until an operator opts in', () => {
    for (const file of ['.env.example', '.env.prod.example']) {
      const source = read(file);
      expect(source).toMatch(/^SNMP_TRAP_PORT=1620$/m);
      expect(source).toMatch(/^SNMP_TRAP_BIND_IP=127\.0\.0\.1$/m);
      expect(source).toMatch(/^SNMP_TRAP_PUBLISH_IP=127\.0\.0\.1$/m);
      expect(source).toMatch(/^SNMP_TRAP_MAX_IN_FLIGHT=16$/m);
      expect(source).toMatch(/^SNMP_TRAP_RATE_PER_SECOND=50$/m);
      expect(source).toMatch(/^SNMP_TRAP_RATE_BURST=100$/m);
      expect(source).toMatch(/^SNMP_TRAP_RATE_PER_MINUTE=600$/m);
      expect(source).toMatch(/^SNMP_TRAP_RATE_MINUTE_BURST=120$/m);
      expect(source).toMatch(/^SNMP_TRAP_SOURCE_RATE_PER_MINUTE=10$/m);
      expect(source).toMatch(/^SNMP_TRAP_SOURCE_RATE_BURST=20$/m);
      expect(source).toMatch(/^SNMP_TRAP_ORG_DAILY_ROW_LIMIT=10000$/m);
      expect(source).toMatch(/^SNMP_TRAP_GLOBAL_DAILY_ROW_LIMIT=100000$/m);
      expect(source).toMatch(/^SNMP_TRAP_ORG_DAILY_VARBIND_BYTES=16777216$/m);
      expect(source).toMatch(/^SNMP_TRAP_GLOBAL_DAILY_VARBIND_BYTES=134217728$/m);
      expect(source).toMatch(/^SNMP_TRAP_ORG_DAILY_DELIVERY_LIMIT=10000$/m);
      expect(source).toMatch(/^SNMP_TRAP_GLOBAL_DAILY_DELIVERY_LIMIT=100000$/m);
      expect(source).toMatch(/^SNMP_TRAP_LOCAL_QUEUE_CAPACITY=100$/m);
      expect(source).toMatch(/^SNMP_TRAP_DRAIN_TIMEOUT_MS=10000$/m);
    }
  });

  test('documented limiter and quota defaults match the runtime fallbacks', () => {
    const receiver = read('src/services/snmpTrapReceiver.js');
    const normalizedReceiver = receiver.replace(/\s+/g, ' ');
    const expected = [
      ['SNMP_TRAP_MAX_IN_FLIGHT', '16'],
      ['SNMP_TRAP_RATE_PER_SECOND', '50'],
      ['SNMP_TRAP_RATE_BURST', '100'],
      ['SNMP_TRAP_RATE_PER_MINUTE', '600'],
      ['SNMP_TRAP_RATE_MINUTE_BURST', '120'],
      ['SNMP_TRAP_SOURCE_RATE_PER_MINUTE', '10'],
      ['SNMP_TRAP_SOURCE_RATE_BURST', '20'],
      ['SNMP_TRAP_ORG_DAILY_ROW_LIMIT', '10000'],
      ['SNMP_TRAP_GLOBAL_DAILY_ROW_LIMIT', '100000'],
      ['SNMP_TRAP_ORG_DAILY_VARBIND_BYTES', '16 * 1024 * 1024'],
      ['SNMP_TRAP_GLOBAL_DAILY_VARBIND_BYTES', '128 * 1024 * 1024'],
      ['SNMP_TRAP_ORG_DAILY_DELIVERY_LIMIT', '10000'],
      ['SNMP_TRAP_GLOBAL_DAILY_DELIVERY_LIMIT', '100000'],
    ];
    for (const [name, fallback] of expected) {
      expect(normalizedReceiver).toContain(`'${name}', ${fallback}`);
    }
    expect(read('src/services/jobQueueService.js')).toMatch(
      /SNMP_TRAP_LOCAL_QUEUE_CAPACITY \|\| '100'/,
    );
  });

  test('Helm declares UDP internally but leaves its external service disabled by default', () => {
    const values = yaml.load(read('charts/fireisp/values.yaml'));
    expect(values.config.SNMP_TRAP_PORT).toBe('1620');
    expect(values.config.SNMP_TRAP_BIND_IP).toBe('127.0.0.1');
    expect(values.config).toMatchObject({
      SNMP_TRAP_MAX_IN_FLIGHT: '16',
      SNMP_TRAP_RATE_PER_SECOND: '50',
      SNMP_TRAP_RATE_BURST: '100',
      SNMP_TRAP_RATE_PER_MINUTE: '600',
      SNMP_TRAP_RATE_MINUTE_BURST: '120',
      SNMP_TRAP_SOURCE_RATE_PER_MINUTE: '10',
      SNMP_TRAP_SOURCE_RATE_BURST: '20',
      SNMP_TRAP_ORG_DAILY_ROW_LIMIT: '10000',
      SNMP_TRAP_GLOBAL_DAILY_ROW_LIMIT: '100000',
      SNMP_TRAP_ORG_DAILY_VARBIND_BYTES: '16777216',
      SNMP_TRAP_GLOBAL_DAILY_VARBIND_BYTES: '134217728',
      SNMP_TRAP_ORG_DAILY_DELIVERY_LIMIT: '10000',
      SNMP_TRAP_GLOBAL_DAILY_DELIVERY_LIMIT: '100000',
      SNMP_TRAP_LOCAL_QUEUE_CAPACITY: '100',
      SNMP_TRAP_DRAIN_TIMEOUT_MS: '10000',
    });
    expect(values.snmpTrap).toMatchObject({
      enabled: false,
      type: 'LoadBalancer',
      port: 162,
      externalTrafficPolicy: 'Local',
      loadBalancerSourceRanges: [],
      allowUnrestrictedSources: false,
    });

    const deployment = read('charts/fireisp/templates/deployment.yaml');
    expect(deployment).toMatch(/name: snmp-trap\s+containerPort:.*SNMP_TRAP_PORT[\s\S]*?protocol: UDP/);
    expect(deployment).toMatch(/name: SNMP_TRAP_BIND_IP[\s\S]*ternary "0\.0\.0\.0"/);

    const service = read('charts/fireisp/templates/snmp-trap-service.yaml');
    expect(service).toMatch(/^\{\{- if \.Values\.snmpTrap\.enabled \}\}/);
    expect(service).toMatch(/loadBalancerSourceRanges/);
    expect(service).toMatch(/allowUnrestrictedSources/);
    expect(service).toMatch(/fail .*external exposure requires non-empty loadBalancerSourceRanges/);
    expect(service).toMatch(/targetPort: snmp-trap\s+protocol: UDP/);
  });

  test('plain Kubernetes manifests declare the listener without pretending HTTP Ingress carries UDP', () => {
    const deployment = yaml.load(read('k8s/deployment.yaml'));
    const ports = deployment.spec.template.spec.containers[0].ports;
    expect(ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'snmp-trap', containerPort: 1620, protocol: 'UDP' }),
    ]));

    const config = yaml.load(read('k8s/configmap.yaml'));
    expect(config.data.SNMP_TRAP_PORT).toBe('1620');
    expect(config.data.SNMP_TRAP_BIND_IP).toBe('127.0.0.1');
    expect(config.data).toMatchObject({
      SNMP_TRAP_MAX_IN_FLIGHT: '16',
      SNMP_TRAP_RATE_PER_SECOND: '50',
      SNMP_TRAP_RATE_BURST: '100',
      SNMP_TRAP_RATE_PER_MINUTE: '600',
      SNMP_TRAP_RATE_MINUTE_BURST: '120',
      SNMP_TRAP_SOURCE_RATE_PER_MINUTE: '10',
      SNMP_TRAP_SOURCE_RATE_BURST: '20',
      SNMP_TRAP_ORG_DAILY_ROW_LIMIT: '10000',
      SNMP_TRAP_GLOBAL_DAILY_ROW_LIMIT: '100000',
      SNMP_TRAP_ORG_DAILY_VARBIND_BYTES: '16777216',
      SNMP_TRAP_GLOBAL_DAILY_VARBIND_BYTES: '134217728',
      SNMP_TRAP_ORG_DAILY_DELIVERY_LIMIT: '10000',
      SNMP_TRAP_GLOBAL_DAILY_DELIVERY_LIMIT: '100000',
      SNMP_TRAP_LOCAL_QUEUE_CAPACITY: '100',
      SNMP_TRAP_DRAIN_TIMEOUT_MS: '10000',
    });
    expect(read('k8s/service.yaml')).not.toMatch(/snmp-trap|1620/);
  });

  test('Helm and plain Kubernetes migrate before application listeners start', () => {
    const values = yaml.load(read('charts/fireisp/values.yaml'));
    expect(values.migration).toEqual({ enabled: true, migrateIsolatedTenants: true });
    expect(values.strategy).toEqual({ type: 'Recreate' });

    const helmDeployment = read('charts/fireisp/templates/deployment.yaml');
    expect(helmDeployment).toMatch(/initContainers:[\s\S]*name: database-migrate/);
    expect(helmDeployment).toMatch(/command: \['node', 'src\/scripts\/migrate\.js'\]/);
    expect(helmDeployment).toMatch(/MIGRATE_ISOLATED_TENANTS/);

    const deployment = yaml.load(read('k8s/deployment.yaml'));
    expect(deployment.spec.strategy).toEqual({ type: 'Recreate' });
    const migrationContainer = deployment.spec.template.spec.initContainers.find(
      container => container.name === 'database-migrate',
    );
    const applicationContainer = deployment.spec.template.spec.containers.find(
      container => container.name === 'fireisp',
    );
    expect(deployment.spec.template.spec.initContainers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'database-migrate',
        command: ['node', 'src/scripts/migrate.js'],
        env: expect.arrayContaining([
          { name: 'MIGRATE_ISOLATED_TENANTS', value: 'true' },
        ]),
      }),
    ]));
    expect(migrationContainer.image).toBe(applicationContainer.image);
    expect(migrationContainer.image).toMatch(/:REPLACE_WITH_FULL_COMMIT_SHA$/);
    expect(migrationContainer.image).not.toMatch(/:latest$/);
    expect(migrationContainer.imagePullPolicy).toBe(applicationContainer.imagePullPolicy);
    expect(yaml.load(read('k8s/configmap.yaml')).data.MIGRATE_ISOLATED_TENANTS).toBe('true');

    const notes = read('charts/fireisp/templates/NOTES.txt');
    expect(notes).toMatch(/migrations already ran in the pre-start init container/i);
    expect(notes).not.toMatch(/npm run migrate/);

    const helmValues = yaml.load(read('charts/fireisp/values.yaml'));
    expect(helmValues.image.tag).toBe('');
    expect(read('charts/fireisp/templates/_helpers.tpl')).toMatch(
      /required "image\.tag is required; use a published full commit SHA/,
    );
  });

  test('plain Kubernetes users get an opt-in, source-restricted UDP Service example', () => {
    const service = yaml.load(read('k8s/examples/snmp-trap-service.yaml'));
    expect(service.spec).toMatchObject({
      type: 'LoadBalancer',
      externalTrafficPolicy: 'Local',
      loadBalancerSourceRanges: ['192.0.2.0/24'],
    });
    expect(service.spec.ports).toEqual([
      expect.objectContaining({ protocol: 'UDP', port: 162, targetPort: 'snmp-trap' }),
    ]);
    expect(read('k8s/examples/snmp-trap-service.yaml')).toMatch(/Replace before applying/);
  });

  test('operator guide explains the safe exposure step and one-destination rule', () => {
    const guide = read('docs/snmp-trap-forwarding.md');
    expect(guide).toMatch(/SNMP_TRAP_BIND_IP/);
    expect(guide).toMatch(/SNMP_TRAP_PUBLISH_IP/);
    expect(guide).toMatch(/trusted device-management networks/i);
    expect(guide).toMatch(/attributes\s+senders by source IP[\s\S]*does not authenticate inbound traps with an SNMP\s+community/i);
    expect(guide).toMatch(/non-loopback deployment must enforce that network ACL/i);
    expect(guide).toMatch(/refuses to render an externally reachable Service without a nonempty/i);
    expect(guide).toMatch(/fixed-memory overload boundary/i);
    expect(guide).toMatch(/SNMP_TRAP_MAX_IN_FLIGHT/);
    expect(guide).toMatch(/receives traps over IPv4 UDP/i);
    expect(guide).toMatch(/Native IPv6 trap intake is not claimed/i);
    expect(guide).toMatch(/k8s\/examples\/snmp-trap-service\.yaml/);
    expect(guide).toMatch(/One rule sends to exactly one destination/);
    expect(guide).toMatch(/does not insert a fake\s+SNMP trap/);
    expect(guide).toMatch(
      /when any retained tenant[\s\S]*physically isolated storage[\s\S]*stores\s+nothing and sends nothing/i,
    );
    expect(guide).toMatch(/requires a future primary source-binding registry/i);
    expect(guide).toMatch(/irreversibly clears those legacy values/i);
    expect(guide).toMatch(/rotate the secret/i);
    expect(guide).toMatch(/URL column itself is not application-encrypted/i);
    expect(guide).toMatch(/database,\s+replicas, and backups as sensitive encrypted infrastructure/i);
    expect(guide).toMatch(/requires a short maintenance window/i);
    expect(guide).toMatch(/stop and drain every old[\s\S]*UDP trap listener/i);
    expect(guide).toMatch(/Do not perform this upgrade as a rolling overlap/i);
    expect(guide).not.toMatch(/isolated tenant(?: database)?(?:s)? (?:are|is) supported for trap attribution/i);
  });
});
