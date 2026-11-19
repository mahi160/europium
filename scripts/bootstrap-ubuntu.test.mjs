import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const bootstrap = readFileSync(join(source, 'scripts/bootstrap-ubuntu.sh'), 'utf8');
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'office-bootstrap-'));
  directories.push(root);
  const bin = join(root, 'bin');
  const deployment = join(root, 'opt/office-service');
  const checkout = join(root, 'checkout');
  for (const path of ['bin', 'etc/apt/sources.list.d', 'run/systemd/system', 'checkout/scripts']) {
    mkdirSync(join(root, path), { recursive: true });
  }
  for (const name of ['sh', 'awk', 'chmod', 'mkdir', 'rmdir', 'dirname', 'cp', 'openssl', 'install']) {
    const command = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], { encoding: 'utf8' });
    assert.equal(command.status, 0, `${name} is required by the shell fixture`);
    symlinkSync(command.stdout.trim(), join(bin, name));
  }
  for (const name of ['scripts/install.sh', 'compose.yaml', 'Caddyfile', 'Dockerfile']) {
    copyFileSync(join(source, name), join(checkout, name));
  }
  writeFileSync(join(root, 'etc/os-release'), `ID=${options.os ?? 'ubuntu'}\nVERSION_ID=${options.version ?? '24.04'}\n`);
  writeFileSync(join(root, 'boundary.log'), '');
  writeFileSync(join(root, 'readiness-attempt'), '0\n');
  writeFileSync(join(root, 'bootstrap.sh'), bootstrap
    .split('/etc').join(join(root, 'etc'))
    .split('/run/systemd').join(join(root, 'run/systemd'))
    .split('/opt').join(join(root, 'opt')));

  const commands = {
    id: 'printf "0\\n"',
    dpkg: 'printf "%s\\n" "$ARCHITECTURE"',
    'dpkg-query': `
[ "$3" = "$CONFLICT" ] || exit 1
printf 'install ok installed'
`,
    'apt-get': `
case "$*" in
  update|'install -y ca-certificates curl git openssl') ;;
  'install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin')
    cp "$FIXTURE/docker-stub" "$FIXTURE/bin/docker" ;;
  *) exit 90 ;;
esac
`,
    systemctl: `
case "$*" in 'enable docker.service'|'start docker.service') ;; *) exit 90 ;; esac
`,
    curl: `
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then
    printf 'fixture Docker signing key\\n' > "$2"
    exit 0
  fi
  shift
done
exit 90
`,
    git: `
case "$1" in
  clone)
    for destination; do :; done
    if [ "$CLONE_FAILURE" = 1 ]; then
      printf 'partial clone retained\\n' > "$destination/partial-download"
      exit 1
    fi
    cp -R "$CHECKOUT/." "$destination/" ;;
  rev-parse) printf '0123456789abcdef0123456789abcdef01234567\\n' ;;
  *) exit 90 ;;
esac
`,
    sleep: '[ "$*" = 2 ]',
  };
  function stub(name, body, destination = join(bin, name)) {
    writeFileSync(destination, `#!/bin/sh\nset -eu\nprintf '${name} %s\\n' "$*" >> "$BOUNDARY_LOG"\n${body}\n`, { mode: 0o700 });
  }
  for (const [name, body] of Object.entries(commands)) stub(name, body);
  stub('docker', `
case "$*" in
  info|'compose version'|'buildx version') ;;
  'volume inspect '*) exit 1 ;;
  'compose --env-file .env -f compose.yaml -p office-service build') ;;
  'compose --env-file .env -f compose.yaml -p office-service up -d --no-build --pull never --no-recreate')
    cp .env "$FIXTURE/started.env"
    mkdir "$FIXTURE/volume"
    printf 'application data retained\\n' > "$FIXTURE/volume/data" ;;
  'compose --env-file .env -f compose.yaml -p office-service exec -T api node -e '*)
    IFS= read -r attempt < "$FIXTURE/readiness-attempt"
    attempt=$((attempt + 1))
    printf '%s\\n' "$attempt" > "$FIXTURE/readiness-attempt"
    [ "$READINESS_FAILURE" != 1 ] && [ "$attempt" -gt "$READINESS_RETRIES" ] ;;
  *) exit 90 ;;
esac
`, join(root, 'docker-stub'));
  if (options.docker) copyFileSync(join(root, 'docker-stub'), join(bin, 'docker'));

  const run = (input = 'yes\n192.168.1.20\nyes\n') => spawnSync('/bin/sh', [join(root, 'bootstrap.sh')], {
    cwd: root, encoding: 'utf8', input, timeout: 15000,
    env: {
      PATH: bin, HOME: root, LC_ALL: 'C', FIXTURE: root, CHECKOUT: checkout,
      BOUNDARY_LOG: join(root, 'boundary.log'), ARCHITECTURE: options.architecture ?? 'amd64',
      CONFLICT: options.conflict ?? '', CLONE_FAILURE: options.cloneFailure ? '1' : '0',
      READINESS_FAILURE: options.readinessFailure ? '1' : '0', READINESS_RETRIES: String(options.readinessRetries ?? 0),
    },
  });
  return {
    root, deployment, run,
    log: () => readFileSync(join(root, 'boundary.log'), 'utf8').trim().split('\n'),
  };
}

function assertStopped(f, result, message) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(message), `expected failure: ${message}`);
  assert.ok(!f.log().some(line => /^(apt-get|curl|systemctl|git|sleep) /.test(line)));
  assert.equal(existsSync(join(f.root, 'opt/.office-bootstrap.lock')), false);
  assert.equal(existsSync(join(f.root, 'etc/apt/keyrings/docker.asc')), false);
  assert.equal(existsSync(join(f.root, 'etc/apt/sources.list.d/docker.sources')), false);
}

function assertInstalled(f, result) {
  assert.equal(result.error, undefined);
  assert.ok(readFileSync(join(f.deployment, 'scripts/install.sh')).equals(readFileSync(join(source, 'scripts/install.sh'))));
  const configuration = readFileSync(join(f.deployment, '.env'), 'utf8');
  assert.ok(configuration.includes('OFFICE_ADDRESS=192.168.1.20\nIMAGE_SOURCE=local\nAPP_IMAGE=office-service-api:local\nWEB_IMAGE=office-service-web:local\n'));
  assert.ok(/^AUTH_SECRET=[a-f0-9]{64}$/m.test(configuration));
  assert.ok(/^SETUP_TOKEN=[a-f0-9]{64}$/m.test(configuration));
  assert.equal(statSync(join(f.deployment, '.env')).mode & 0o777, 0o600);
  assert.ok(readFileSync(join(f.root, 'started.env')).equals(Buffer.from(configuration)), 'configuration was preserved after startup');
  assert.equal(readFileSync(join(f.root, 'volume/data'), 'utf8'), 'application data retained\n');
  const output = result.stdout + result.stderr + f.log().join('\n');
  for (const line of configuration.split('\n')) {
    if (/^(AUTH_SECRET|SETUP_TOKEN)=/.test(line)) {
      assert.ok(!output.includes(line.split('=')[1]), 'generated secrets must not be logged');
    }
  }
  assert.ok(result.stdout.includes('Deployment requested at https://192.168.1.20 (readiness is not yet verified).'));
  assert.equal(existsSync(join(f.root, 'opt/.office-bootstrap.lock')), false);
  assert.equal(existsSync(join(f.deployment, '.office-install.lock')), false);
}

for (const [version, suite, architecture] of [['22.04', 'jammy', 'amd64'], ['24.04', 'noble', 'arm64']]) {
  test(`fresh Ubuntu ${version}/${architecture} installs official packages, runs the real installer and waits for readiness`, () => {
    const f = fixture({ version, architecture, readinessRetries: 2 });
    const result = f.run();
    assert.equal(result.status, 0);
    assertInstalled(f, result);
    const log = f.log();
    assert.deepEqual(log.filter(line => line.startsWith('apt-get ')), [
      'apt-get update', 'apt-get install -y ca-certificates curl git openssl',
      'apt-get update', 'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
    ]);
    assert.deepEqual(log.filter(line => line.startsWith('curl ')), [
      `curl --fail --silent --show-error --location --proto =https --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg --output ${f.root}/etc/apt/keyrings/docker.asc`,
    ]);
    assert.equal(readFileSync(join(f.root, 'etc/apt/sources.list.d/docker.sources'), 'utf8'),
      `Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: ${suite}\nComponents: stable\nArchitectures: ${architecture}\nSigned-By: ${f.root}/etc/apt/keyrings/docker.asc\n`);
    assert.equal(readFileSync(join(f.root, 'etc/apt/keyrings/docker.asc'), 'utf8'), 'fixture Docker signing key\n');
    assert.equal(statSync(join(f.root, 'etc/apt/keyrings/docker.asc')).mode & 0o777, 0o644);
    assert.deepEqual(log.filter(line => line.startsWith('systemctl ')), ['systemctl enable docker.service', 'systemctl start docker.service']);
    const clone = `git clone --depth 1 --branch main https://github.com/mahi160/europium.git ${f.deployment}`;
    const build = 'docker compose --env-file .env -f compose.yaml -p office-service build';
    const start = 'docker compose --env-file .env -f compose.yaml -p office-service up -d --no-build --pull never --no-recreate';
    assert.ok(log.indexOf(clone) > log.indexOf('systemctl start docker.service'));
    assert.ok(log.indexOf(build) > log.indexOf(clone));
    assert.ok(log.indexOf(start) > log.indexOf(build));
    const probes = log.filter(line => line.startsWith('docker compose ') && line.includes(' exec -T api node -e '));
    assert.equal(probes.length, 3);
    assert.ok(probes.every(line => line.includes('http://127.0.0.1:3000/api/setup')));
    assert.ok(log.indexOf(probes[0]) > log.indexOf(start));
    assert.deepEqual(log.filter(line => line.startsWith('sleep ')), ['sleep 2', 'sleep 2']);
    assert.ok(result.stdout.includes('Downloaded source commit: 0123456789abcdef0123456789abcdef01234567'));
    assert.ok(result.stdout.includes('API is ready.'));
  });
}

test('declining authorization has no installation side effects', () => {
  const f = fixture();
  const result = f.run('no\n');
  assertStopped(f, result, 'Cancelled; nothing changed.');
  assert.equal(existsSync(join(f.root, 'opt')), false);
  assert.equal(existsSync(join(f.root, 'bin/docker')), false);
  assert.ok(f.log().every(line => /^(id|dpkg|dpkg-query) /.test(line)));
});

for (const [label, options, message] of [
  ['non-Ubuntu', { os: 'debian' }, 'Only Ubuntu is supported.'],
  ['unsupported Ubuntu release', { version: '20.04' }, 'Use Ubuntu 22.04 or 24.04 LTS.'],
  ['unsupported architecture', { architecture: 'armhf' }, 'Only amd64 and arm64 hosts are supported.'],
]) {
  test(`${label} is rejected before host changes`, () => {
    const f = fixture(options);
    assertStopped(f, f.run(), message);
    assert.equal(existsSync(join(f.root, 'opt')), false);
    assert.ok(f.log().every(line => /^(id|dpkg) /.test(line)));
  });
}

for (const symlink of [false, true]) {
  test(`existing installation ${symlink ? 'symlink' : 'directory'} is left untouched`, () => {
    const f = fixture();
    const existing = symlink ? join(f.root, 'existing-deployment') : f.deployment;
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, '.env'), 'protected fixture configuration\n', { mode: 0o600 });
    writeFileSync(join(existing, 'data'), 'existing application data\n');
    if (symlink) {
      mkdirSync(join(f.root, 'opt'));
      symlinkSync(existing, f.deployment);
    }
    const result = f.run();
    assertStopped(f, result, `Existing ${f.deployment} preserved.`);
    assert.ok(readFileSync(join(f.deployment, '.env')).equals(Buffer.from('protected fixture configuration\n')));
    assert.equal(readFileSync(join(f.deployment, 'data'), 'utf8'), 'existing application data\n');
    assert.equal(statSync(join(f.deployment, '.env')).mode & 0o777, 0o600);
    assert.deepEqual(f.log(), ['id -u', 'dpkg --print-architecture']);
  });
}

for (const conflict of ['docker.io', 'docker-compose', 'docker-compose-v2', 'docker-doc', 'docker-buildx', 'podman-docker', 'containerd', 'runc']) {
  test(`conflicting installed package ${conflict} blocks bootstrap without removal`, () => {
    const f = fixture({ conflict });
    assertStopped(f, f.run(), `Conflicting package ${conflict} exists.`);
    assert.equal(existsSync(join(f.root, 'opt')), false);
    assert.ok(f.log().some(line => line === `dpkg-query -W -f=\${Status} ${conflict}`));
    assert.ok(f.log().every(line => /^(id|dpkg|dpkg-query) /.test(line)));
  });
}

test('existing working Docker is preserved without Docker package or repository installation', () => {
  const f = fixture({ docker: true });
  const originalDocker = readFileSync(join(f.root, 'bin/docker'));
  const result = f.run();
  assert.equal(result.status, 0);
  assertInstalled(f, result);
  assert.ok(readFileSync(join(f.root, 'bin/docker')).equals(originalDocker));
  const log = f.log();
  assert.deepEqual(log.slice(0, 5), ['id -u', 'dpkg --print-architecture', 'docker info', 'docker compose version', 'docker buildx version']);
  assert.deepEqual(log.filter(line => line.startsWith('apt-get ')), ['apt-get update', 'apt-get install -y ca-certificates curl git openssl']);
  assert.deepEqual(log.filter(line => /^(curl|dpkg-query) /.test(line)), []);
  assert.deepEqual(log.filter(line => line.startsWith('systemctl ')), ['systemctl enable docker.service', 'systemctl start docker.service']);
  assert.equal(existsSync(join(f.root, 'etc/apt/keyrings/docker.asc')), false);
  assert.equal(existsSync(join(f.root, 'etc/apt/sources.list.d/docker.sources')), false);
  assert.ok(result.stdout.includes('API is ready.'));
});

test('failed git clone reports failure and preserves the partial checkout for inspection', () => {
  const f = fixture({ cloneFailure: true });
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`Source download failed. Keep ${f.deployment} for inspection; no existing deployment should be deleted.`));
  assert.equal(readFileSync(join(f.deployment, 'partial-download'), 'utf8'), 'partial clone retained\n');
  assert.equal(existsSync(join(f.deployment, '.env')), false);
  assert.equal(existsSync(join(f.root, 'opt/.office-bootstrap.lock')), false);
  assert.ok(!f.log().some(line => line === 'git rev-parse HEAD' || line.includes(' --env-file ') || line.startsWith('sleep ')));
  assert.ok(!result.stdout.includes('API is ready.'));
});

test('readiness failure reports preservation and retains the real installer configuration and application data', () => {
  const f = fixture({ readinessFailure: true });
  const result = f.run();
  assert.equal(result.status, 1);
  assertInstalled(f, result);
  assert.ok(result.stderr.includes('API readiness check failed. Configuration/data were preserved; inspect the deployment privately. Do not rerun bootstrap or delete volumes.'));
  assert.ok(!result.stdout.includes('API is ready.'));
  const log = f.log();
  assert.equal(log.filter(line => line.includes(' exec -T api node -e ')).length, 30);
  assert.equal(log.filter(line => line === 'sleep 2').length, 29);
  assert.equal(log.filter(line => line.includes(' up -d ')).length, 1);
  assert.ok(!log.some(line => /\b(down|rm|prune|remove)\b/.test(line)));
});
