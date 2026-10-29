#!/usr/bin/env python3
"""Validate a three-host inventory and check TCP reachability; never mutate hosts."""
import argparse
import ipaddress
import json
import socket
import sys
from pathlib import Path

PRIVATE = tuple(ipaddress.ip_network(cidr) for cidr in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.96.0.0/12"))


def private_ipv4(value):
    try:
        address = ipaddress.IPv4Address(value)
    except (ValueError, TypeError, ipaddress.AddressValueError) as error:
        raise ValueError("Fill every private IPv4 with an actual assigned address") from error
    if not any(address in network for network in PRIVATE):
        raise ValueError("Only RFC1918 or the default Cloudflare Mesh IPv4 range is supported")
    return str(address)


def endpoint(value, port):
    if not isinstance(value, str) or value.count(":") != 1:
        raise ValueError("Advertised endpoints must be private IPv4:port, not URLs or public hostnames")
    address, actual_port = value.rsplit(":", 1)
    if actual_port != str(port):
        raise ValueError(f"Expected private endpoint port {port}")
    return private_ipv4(address), port


def validate_inventory(data):
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise ValueError("Expected inventory schemaVersion 1")
    nodes = data.get("nodes")
    if not isinstance(nodes, list) or len(nodes) != 3 or not all(isinstance(n, dict) for n in nodes):
        raise ValueError("Inventory must contain exactly the existing origin and two candidates")
    ids, addresses, raft_addresses = set(), set(), set()
    existing = 0
    for node in nodes:
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip() or node_id in ids:
            raise ValueError("Every node needs a unique, persistent ID")
        ids.add(node_id)
        address = private_ipv4(node.get("meshIpv4"))
        if address in addresses:
            raise ValueError("Each host needs its own Mesh IPv4")
        addresses.add(address)
        endpoint(node.get("httpAdvertise"), 4001)
        raft = endpoint(node.get("raftAdvertise"), 4002)
        if raft in raft_addresses:
            raise ValueError("Raft endpoints must be unique")
        raft_addresses.add(raft)
        if node.get("role") == "existing":
            existing += 1
            if node.get("observedRaftAddress") != node.get("raftAdvertise"):
                raise ValueError("Existing recorded Raft address changed; resolve migration before JOIN")
        elif node.get("role") != "candidate":
            raise ValueError("Role must be existing or candidate")
    if existing != 1:
        raise ValueError("Identify exactly one existing origin; do not bootstrap a replacement")
    return nodes


def probe(address, timeout):
    try:
        with socket.create_connection(address, timeout=timeout):
            return True
    except OSError:
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--local-node")
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--coordination", action="store_true", help="Also probe Mesh ports 6379 and 26379")
    parser.add_argument("--timeout", type=float, default=3.0)
    args = parser.parse_args(argv)
    try:
        if not 0 < args.timeout <= 10:
            raise ValueError("Timeout must be greater than 0 and at most 10 seconds")
        nodes = validate_inventory(json.loads(args.inventory.read_text(encoding="utf-8")))
        if args.inventory_only:
            print(json.dumps({"inventoryValid": True, "nodes": [n["id"] for n in nodes], "networkChecked": False}))
            return 0
        if not sys.platform.startswith("linux"):
            raise ValueError("Run network checks locally on the target Linux host")
        local = next((n for n in nodes if n["id"] == args.local_node), None)
        if local is None:
            raise ValueError("Set --local-node to this host's audited persistent node ID")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as bound:
            bound.bind((local["meshIpv4"], 0))
        checks = []
        for node in nodes:
            if node is local:
                continue
            for kind, port in (("httpAdvertise", 4001), ("raftAdvertise", 4002)):
                address = endpoint(node[kind], port)
                checks.append({"peer": node["id"], "address": node[kind], "tcpReachable": probe(address, args.timeout)})
            if args.coordination:
                for port in (6379, 26379):
                    address = (node['meshIpv4'], port)
                    checks.append({'peer': node['id'], 'address': f'{address[0]}:{port}',
                                   'tcpReachable': probe(address, args.timeout)})
        ok = all(check["tcpReachable"] for check in checks)
        print(json.dumps({"localNode": local["id"], "checks": checks, "passed": ok,
                          "scope": "TCP only; verify authenticated readiness, membership and replication separately"}))
        return 0 if ok else 1
    except (ValueError, OSError) as error:
        print(json.dumps({"passed": False, "error": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
