#!/usr/bin/env python3
"""Exercise campus coordination on an isolated Docker network, then clean up."""
import ipaddress
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGE = 'valkey/valkey:8.1.3@sha256:fea8b3e67b15729d4bb70589eb03367bab9ad1ee89c876f54327fc7c6e618571'


def command(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-3000:] or result.stdout[-3000:])
    return result.stdout.strip()


def main():
    if not sys.platform.startswith('linux'):
        raise SystemExit('Run this disposable fixture on Linux with Docker Engine')
    if not (ROOT / 'dist/services/cluster/cluster-redis.js').is_file():
        raise SystemExit('Build the backend first')
    project = 'cubs-campus-test-' + uuid.uuid4().hex[:8]
    network = project + '_private'
    compose = None
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        folder = Path(directory)
        secret = folder / 'coordination.hex'
        secret.write_text(uuid.uuid4().hex + uuid.uuid4().hex)
        secret.chmod(0o444)  # synthetic fixture only, no production credential
        try:
            command(['docker', 'network', 'create', network])
            subnet = json.loads(command(['docker', 'network', 'inspect', network]))[0]['IPAM']['Config'][0]['Subnet']
            base = ipaddress.ip_network(subnet).network_address
            addresses = [str(base + 11 + index) for index in range(3)]
            services = {}
            for index, address in enumerate(addresses, 1):
                data_name = f'data{index}'
                for mode, name in [('data', data_name), ('sentinel', f'sentinel{index}')]:
                    data = folder / name
                    data.mkdir()
                    service = {
                        'image': IMAGE, 'entrypoint': ['/bin/sh', '/campus-coordination.sh'],
                        'environment': {'COORDINATION_MODE': mode, 'CLUSTER_MESH_IP': address,
                                        'COORDINATION_PRIMARY_IP': addresses[0]},
                        'volumes': [f'{data}:/data', f'{secret}:/run/secrets/cluster_redis:ro',
                                    f'{ROOT / "docker/coordination/entrypoint.sh"}:/campus-coordination.sh:ro'],
                    }
                    if mode == 'sentinel':
                        service['network_mode'] = 'service:' + data_name
                        service['depends_on'] = [data_name]
                    else:
                        service['networks'] = {'default': {'ipv4_address': address}}
                    services[name] = service
            services['test'] = {
                'image': 'node:24-alpine', 'working_dir': '/app',
                'command': ['node', 'scripts/validation/campus-ha-test.mjs'],
                'environment': {'NODE_ENV': 'test', 'CORS_ORIGINS': 'http://127.0.0.1', 'CUBS_DISPOSABLE_CAMPUS_TEST': 'true',
                                'DATABASE_URL': 'http://127.0.0.1:1',
                                'DATABASE_USERNAME': 'fixture', 'DATABASE_PASSWORD': 'synthetic-only',
                                'JWT_ACCESS_SECRET': 'a' * 64, 'JWT_REFRESH_SECRET': 'b' * 64,
                                'CUBS_CLUSTER_ENABLED': 'true',
                                'CLUSTER_REDIS_SENTINELS': ','.join(a + ':26379' for a in addresses),
                                'CLUSTER_REDIS_PASSWORD_FILE': '/run/secrets/cluster_redis'},
                'volumes': [f'{ROOT}:/app:ro', f'{folder}:/fixture', f'{secret}:/run/secrets/cluster_redis:ro'],
            }
            spec = {'services': services, 'networks': {'default': {'external': True, 'name': network}}}
            fixture = folder / 'compose.json'
            fixture.write_text(json.dumps(spec))
            compose = ['docker', 'compose', '-p', project, '-f', str(fixture)]
            command(compose + ['up', '-d', *[s for s in services if s != 'test']])
            command(compose + ['up', '-d', 'test'])
            deadline = time.monotonic() + 100
            while not (folder / 'ready').exists():
                running = json.loads(command(compose + ['ps', '-a', '--format', 'json', 'test']))
                if running.get('State') == 'exited' or time.monotonic() > deadline:
                    raise RuntimeError('Initial campus fixture failed: ' + command(compose + ['logs', '--no-color', 'test']))
                time.sleep(0.5)
            # One physical-site failure: initial primary and its Sentinel stop.
            command(compose + ['stop', 'sentinel1', 'data1'])
            (folder / 'outage').touch()
            command(compose + ['wait', 'test'])
            test_id = command(compose + ['ps', '-aq', 'test'])
            result = command(['docker', 'inspect', '-f', '{{.State.ExitCode}}', test_id])
            logs = command(compose + ['logs', '--no-color', 'test'])
            if result != '0' or 'Campus HA passed:' not in logs:
                raise RuntimeError(logs[-5000:])
            print(logs)
        finally:
            if compose:
                command(compose + ['down', '--remove-orphans'])
            command(['docker', 'network', 'rm', network])
            # Containers drop privileges; restore fixture ownership for cleanup.
            if os.geteuid() != 0:
                command(['docker', 'run', '--rm', '-v', f'{folder}:/fixture', '--entrypoint', 'chown',
                         IMAGE, '-R', f'{os.getuid()}:{os.getgid()}', '/fixture'])


if __name__ == '__main__':
    main()
