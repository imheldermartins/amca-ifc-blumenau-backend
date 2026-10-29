#!/usr/bin/env python3
"""Bind a physical Linux host to one IFC campus, or validate a deployment target."""
import argparse
import json
import re
import socket
import sys
from pathlib import Path

SITES = ('blumenau', 'videira', 'riodosul')


def validate(binding, site, machine_id, public_host=None):
    if binding.get('schemaVersion') != 1 or binding.get('site') != site:
        raise ValueError('Requested campus differs from this host binding; execute Codex on the target host')
    if binding.get('machineId') != machine_id:
        raise ValueError('Binding belongs to another machine; never copy a campus binding between hosts')
    if public_host and binding.get('publicHostname') != public_host:
        raise ValueError('Public hostname differs from the bound campus hostname')
    return binding


def hostname_for(site, value):
    if value != f'ifc-{site}.cubsonline.com.br':
        raise ValueError('Use the approved public hostname for the requested campus')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True, choices=SITES)
    parser.add_argument('--public-host')
    parser.add_argument('--binding', type=Path, default=Path('/etc/cubs/campus.json'))
    parser.add_argument('--bind', action='store_true')
    args = parser.parse_args()
    try:
        if not sys.platform.startswith('linux'):
            raise ValueError('Execute on the actual target Linux host')
        machine_id = Path('/etc/machine-id').read_text().strip()
        if not re.fullmatch('[a-f0-9]{32}', machine_id):
            raise ValueError('An initialized, unique Linux machine-id is required')
        if args.bind:
            hostname = hostname_for(args.site, args.public_host)
            if args.binding.exists():
                validate(json.loads(args.binding.read_text()), args.site, machine_id, hostname)
            else:
                args.binding.parent.mkdir(parents=True, exist_ok=True)
                with args.binding.open('x') as stream:
                    json.dump({'schemaVersion': 1, 'site': args.site, 'machineId': machine_id,
                               'hostname': socket.gethostname(), 'publicHostname': hostname}, stream, indent=2)
                args.binding.chmod(0o644)
        binding = validate(json.loads(args.binding.read_text()), args.site, machine_id, args.public_host)
        print(json.dumps({'host': socket.gethostname(), 'site': binding['site'],
                          'publicHostname': binding['publicHostname'], 'targetVerified': True}))
        return 0
    except (ValueError, OSError) as error:
        print(json.dumps({'targetVerified': False, 'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
