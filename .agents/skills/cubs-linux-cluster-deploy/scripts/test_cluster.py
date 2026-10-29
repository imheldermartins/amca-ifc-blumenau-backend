#!/usr/bin/env python3
"""Linux tests; --integration also forms a disposable authenticated 3-node cluster."""
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

import preflight
import campus

ROOT = Path(__file__).resolve().parents[4]
ENTRYPOINT = ROOT / "docker/rqlite/cluster-entrypoint.sh"


def command(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise AssertionError(f"Command failed: {args[0]}\n{result.stderr[-2000:]}")
    return result.stdout


class ClusterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cubs-cluster-unit-")
        self.folder = Path(self.temp.name)
        self.auth = self.folder / "auth.json"
        self.auth.write_text('[]', encoding="utf-8")
        fake = self.folder / "rqlited"
        fake.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n')
        fake.chmod(0o700)
        self.env = {**os.environ, "PATH": f"{self.folder}:{os.environ['PATH']}",
                    "NODE_ID": "test-peer", "RQLITE_ADVERTISE_IP": "100.96.0.2",
                    "JOIN_NODE": "172.19.0.2:4002", "RQLITE_JOIN_AS": "cubs_cluster_join",
                    "RQLITE_AUTH_FILE": str(self.auth), "RQLITE_NON_VOTER": "true"}

    def tearDown(self):
        self.temp.cleanup()

    def launch(self, **overrides):
        return subprocess.run(["/bin/sh", str(ENTRYPOINT)], env={**self.env, **overrides},
                              text=True, capture_output=True)

    def inventory(self):
        return {"schemaVersion": 1, "nodes": [
            {"id": str(i), "meshIpv4": f"100.96.0.{i}", "httpAdvertise": f"100.96.0.{i}:4001",
             "raftAdvertise": f"100.96.0.{i}:4002", "role": "existing" if i == 1 else "candidate",
             **({"observedRaftAddress": "100.96.0.1:4002"} if i == 1 else {})}
            for i in (1, 2, 3)]}

    def test_candidate_joins_authenticated_and_cannot_bootstrap(self):
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(result.stdout)
        self.assertIn("-raft-non-voter", args)
        self.assertEqual(args[args.index("-join") + 1], "172.19.0.2:4002")
        self.assertEqual(args[args.index("-join-as") + 1], "cubs_cluster_join")
        self.assertEqual(args[-1], "/rqlite/file")
        self.assertNotIn("-bootstrap-expect", args)
        self.assertNotEqual(self.launch(JOIN_NODE="").returncode, 0)

    def test_persistent_voter_configuration_is_explicit(self):
        result = self.launch(RQLITE_NON_VOTER="false")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("-raft-non-voter", json.loads(result.stdout))
        self.assertNotEqual(self.launch(RQLITE_NON_VOTER="maybe").returncode, 0)

    def test_rejects_public_http_and_invalid_join_addresses(self):
        for target in ("https://cubsonline.com.br", "172.19.0.2:4001", "8.8.8.8:4002",
                       "127.0.0.1:4002", "10.attacker.example:4002", "100.96.999.1:4002",
                       "172.19.0.2:4002,", ",172.19.0.2:4002", "172.19.0.2:4002,,100.96.0.2:4002"):
            with self.subTest(target=target):
                self.assertNotEqual(self.launch(JOIN_NODE=target).returncode, 0)

    def test_missing_identity_and_auth_fail_before_launch(self):
        for override in ({"NODE_ID": ""}, {"RQLITE_JOIN_AS": ""}, {"RQLITE_AUTH_FILE": "/missing"},
                         {"RQLITE_ADVERTISE_IP": "0.0.0.0"}, {"RQLITE_ADVERTISE_IP": "100.96.300.1"}):
            with self.subTest(override=override):
                self.assertNotEqual(self.launch(**override).returncode, 0)

    def test_inventory_requires_distinct_nodes_and_retained_origin_address(self):
        inventory = self.inventory()
        self.assertEqual(len(preflight.validate_inventory(inventory)), 3)
        for field, value in (("id", "1"), ("meshIpv4", "100.96.0.1"),
                             ("raftAdvertise", "https://cubsonline.com.br"), ("meshIpv4", None)):
            invalid = copy.deepcopy(inventory)
            invalid["nodes"][1][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                preflight.validate_inventory(invalid)
        inventory["nodes"][0]["raftAdvertise"] = "100.96.0.100:4002"
        with self.assertRaisesRegex(ValueError, "recorded Raft address changed"):
            preflight.validate_inventory(inventory)

    def test_campus_binding_rejects_another_physical_host(self):
        binding = {"schemaVersion": 1, "site": "blumenau", "machineId": "host-one",
                   "publicHostname": "ifc-blumenau.cubsonline.com.br"}
        self.assertEqual(campus.validate(binding, "blumenau", "host-one"), binding)
        for site, machine in (("videira", "host-one"), ("blumenau", "host-two")):
            with self.assertRaises(ValueError):
                campus.validate(binding, site, machine)
        with self.assertRaises(ValueError):
            campus.validate(binding, "blumenau", "host-one", "ifc-videira.cubsonline.com.br")

    def test_tcp_probe_checks_real_connections_and_closed_ports(self):
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            address = server.getsockname()
            self.assertTrue(preflight.probe(address, 1))
        self.assertFalse(preflight.probe(address, 1))

    def test_compose_files_preserve_origin_and_isolate_peers(self):
        env = {**self.env, "CLUSTER_NODE_ID": "ifc-test", "CLUSTER_MESH_IP": "100.96.0.2",
               "CLUSTER_JOIN_PEERS": "172.19.0.2:4002", "CLUSTER_NON_VOTER": "true",
               "CLUSTER_DOCKER_SUBNET": "172.30.20.0/24", "CLUSTER_AUTH_FILE": str(self.auth),
               "CLUSTER_HEALTH_FILE": str(self.auth), "CLUSTER_ORIGIN_DOCKER_IP": "172.19.0.2",
               "CLUSTER_ORIGIN_DOCKER_NETWORK": "docker_default", "RQLITE_USERNAME": "test-only",
               "RQLITE_PASSWORD": "synthetic-test-only", "CLUSTER_PUBLIC_HOST": "ifc-videira.cubsonline.com.br",
               "CLUSTER_REDIS_SENTINELS": "100.96.0.1:26379,100.96.0.2:26379,100.96.0.3:26379",
               "COORDINATION_PRIMARY_IP": "100.96.0.1", "CLUSTER_REDIS_PASSWORD_FILE": str(self.auth),
               "CAMPUS_BACKEND_ENV": str(self.auth), "CAMPUS_TUNNEL_ENV": str(self.auth)}
        empty_env = self.folder / "empty.env"
        empty_env.touch()
        base = ["docker", "compose", "--env-file", str(empty_env), "-p", "cubs-config-test"]
        def config(files):
            args = base + [part for f in files for part in ("-f", str(ROOT / f))]
            return json.loads(command(args + ["config", "--format", "json", "--no-env-resolution"], env=env))
        peer = config(["docker/docker-compose.cluster-peer.yml"])
        self.assertEqual(list(peer["services"]), ["rqlite"])
        self.assertEqual({p["host_ip"] for p in peer["services"]["rqlite"]["ports"]}, {"100.96.0.2"})
        self.assertEqual({p["target"] for p in peer["services"]["rqlite"]["ports"]}, {4001, 4002})
        origin = config(["docker/docker-compose.prod.yml", "docker/docker-compose.cluster-origin.yml"])
        self.assertTrue(origin["networks"]["default"]["external"])
        self.assertEqual(origin["networks"]["default"]["name"], "docker_default")
        rqlite = origin["services"]["rqlite"]
        self.assertEqual(rqlite["networks"]["default"]["ipv4_address"], "172.19.0.2")
        self.assertIn("rqlite_data", origin["volumes"])
        self.assertEqual(rqlite["environment"]["RQLITE_ADVERTISE_IP"], "172.19.0.2")
        for files in (["docker/docker-compose.cluster-peer.yml"],
                      ["docker/docker-compose.prod.yml", "docker/docker-compose.cluster-origin.yml"]):
            app = config(files + ["docker/docker-compose.campus-coordination.yml", "docker/docker-compose.campus-app.yml"])
            self.assertIn("sentinel", app["services"])
            self.assertEqual(app["services"]["backend"]["environment"]["DATABASE_URL"], "http://rqlite:4001")
            self.assertEqual(app["services"]["backend"]["environment"]["CUBS_CLUSTER_ENABLED"], "true")
            self.assertEqual(app["services"]["frontend"]["build"]["args"]["VITE_CUBS_API_URL"],
                             "https://ifc-videira.cubsonline.com.br/api/v1")
            for service in ("rqlite", "coordination", "sentinel"):
                self.assertEqual({p["host_ip"] for p in app["services"][service]["ports"]}, {"100.96.0.2"})



def integration():
    """No production volumes, networks, credentials or published host ports."""
    with tempfile.TemporaryDirectory(prefix="cubs-cluster-integration-") as directory:
        folder = Path(directory)
        password = uuid.uuid4().hex
        auth = folder / "auth.json"
        auth.write_text(json.dumps([
            {"username": "operator", "password": password,
             "perms": ["query", "execute", "status", "ready", "remove"]},
            {"username": "cubs_cluster_join", "password": password, "perms": ["join", "join-read-only"]}]))
        auth.chmod(0o400)
        curl_config = folder / "curl.conf"
        curl_config.write_text(f'user = "operator:{password}"\n')
        curl_config.chmod(0o400)
        project = f"cubs-cluster-test-{uuid.uuid4().hex[:8]}"
        # Docker chooses an unused subnet; fixed internal IPs are discovered after origin creation.
        image = "cubs-rqlite-cluster-validation:10.3.3"
        command(["docker", "build", "-t", image, str(ROOT / "docker/rqlite")])
        common = {"image": image,
                  "volumes": [f"{auth}:/run/secrets/auth:ro", f"{curl_config}:/run/secrets/curl:ro"],
                  "environment": {"NODE_ID": "validation-origin", "RQLITE_AUTH_FILE": "/run/secrets/auth"}}
        spec = {"services": {"origin": copy.deepcopy(common)}}
        def mount_data(service, site):
            data = folder / f"data-{site}"
            data.mkdir(mode=0o700)
            service["volumes"].append(f"{data}:/rqlite/file")
        mount_data(spec["services"]["origin"], "origin")
        fixture = folder / "compose.json"
        fixture.write_text(json.dumps(spec))
        compose = ["docker", "compose", "-p", project, "-f", str(fixture)]
        def run(*args):
            return command(compose + list(args))
        def request(node, path, data=None, method=None):
            args = ["exec", "-T", node, "curl", "--fail", "--silent", "--show-error", "--max-time", "4",
                    "--config", "/run/secrets/curl", "http://127.0.0.1:4001" + path]
            if data is not None:
                args += ["--header", "Content-Type: application/json", "--data", json.dumps(data)]
            if method:
                args += ["--request", method]
            return run(*args)
        def wait(check):
            for _ in range(60):
                try:
                    if check():
                        return
                except (AssertionError, ValueError, KeyError):
                    pass
                time.sleep(0.5)
            raise AssertionError("Disposable cluster did not reach the expected state")
        try:
            run("up", "-d", "origin")
            wait(lambda: "ok" in request("origin", "/readyz"))
            node = json.loads(request("origin", "/nodes"))["validation-origin"]
            raft_address = node["addr"]
            response = json.loads(request("origin", "/db/execute?transaction", [
                "CREATE TABLE cluster_skill_fixture(id INTEGER PRIMARY KEY, value TEXT)",
                ["INSERT INTO cluster_skill_fixture VALUES(1,?)", "replicated-before-join"]]))
            assert not any(row.get("error") for row in response["results"])
            for site in ("videira", "riodosul"):
                peer = copy.deepcopy(common)
                mount_data(peer, site)
                peer["entrypoint"] = ["/bin/sh", "/cluster-entrypoint.sh"]
                peer["volumes"].append(f"{ENTRYPOINT}:/cluster-entrypoint.sh:ro")
                # Resolve this container's private address at startup, like the existing launcher.
                peer["entrypoint"] = ["/bin/sh", "-c", 'export RQLITE_ADVERTISE_IP=$(hostname -i | awk \'{print $1}\'); exec /bin/sh /cluster-entrypoint.sh']
                peer["environment"].update({"NODE_ID": f"ifc-{site}", "JOIN_NODE": raft_address,
                                             "RQLITE_JOIN_AS": "cubs_cluster_join", "RQLITE_NON_VOTER": "true"})
                spec["services"][site] = peer
            fixture.write_text(json.dumps(spec))
            run("up", "-d", "--no-deps", "videira", "riodosul")
            def members():
                return json.loads(request("origin", "/nodes?nonvoters&timeout=2s"))
            wait(lambda: len(members()) == 3 and all(n["reachable"] for n in members().values()))
            assert sum(n["voter"] for n in members().values()) == 1
            for site in ("origin", "videira", "riodosul"):
                wait(lambda site=site: "ok" in request(site, "/readyz"))
                query = json.loads(request(site, "/db/query?level=none", [["SELECT value FROM cluster_skill_fixture WHERE id=1"]]))
                assert query["results"][0]["values"] == [["replicated-before-join"]]
            for site, voters in (("videira", 2), ("riodosul", 3)):
                # v10.3.3 has no /promote and ignores a JOIN with unchanged ID/address.
                # Stop/remove only the newly added NON-VOTER, retain its data, rejoin as voter.
                assert members()[f"ifc-{site}"]["voter"] is False
                run("stop", site)
                request("origin", "/remove", {"id": f"ifc-{site}"}, method="DELETE")
                wait(lambda site=site: f"ifc-{site}" not in members())
                spec["services"][site]["environment"]["RQLITE_NON_VOTER"] = "false"
                fixture.write_text(json.dumps(spec))
                run("up", "-d", "--no-deps", site)
                wait(lambda voters=voters: sum(n["voter"] for n in members().values()) == voters)
            assert sum(n["leader"] for n in members().values()) == 1
            print("Disposable cluster passed: authenticated JOIN, two non-voters, replicated data, retained peer state on rejoin, three voters.")
        finally:
            run("down", "--remove-orphans")


if __name__ == "__main__":
    run_integration = "--integration" in sys.argv
    if run_integration:
        sys.argv.remove("--integration")
    result = unittest.main(exit=False).result
    if not result.wasSuccessful():
        raise SystemExit(1)
    if run_integration:
        integration()
