"""Exercise rollout ordering with Docker/Git doubles; only credential helpers run in Docker."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which('docker')
FAKE_DOCKER = r'''#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$MOCK_LOG"
case "$1" in
  inspect)
    case "$*" in
      *State.Status*) echo running ;;
      *State.Health*) echo healthy ;;
      *Destination*) echo docker_rqlite_data ;;
      *Image*) printf 'sha256:%064d\n' 1 ;;
    esac ;;
  compose)
    if [[ "$*" == *"migrate status"* ]]; then
      if [[ ${MOCK_PENDING:-0} == 1 ]]; then echo '{"pending":["needs-review"]}'; else echo '{"pending":[]}'; fi
    fi ;;
  run)
    if [[ "$*" == *"/task/config.mjs"* || "$*" == *"node -e"* ]]; then exec "$REAL_DOCKER" "$@"; fi
    if [[ "$*" == *"--entrypoint tar"* ]]; then
      [[ ${MOCK_BACKUP_FAIL:-0} == 0 ]] || exit 54
      for argument in "$@"; do
        if [[ "$argument" == type=bind,src=*,dst=/backup ]]; then
          folder=${argument#type=bind,src=}; folder=${folder%,dst=/backup}; touch "$folder/rqlite-data.tar.gz"
        fi
      done
    fi ;;
  exec)
    if [[ "$*" == *"sha256sum /run/secrets/rqlite_auth"* ]]; then sha256sum "$FIXTURE_ROOT/docker/.generated/rqlite-auth.json"; fi ;;
esac
'''
FAKE_GIT = '''#!/usr/bin/env bash
if [[ "$1" == rev-parse ]]; then echo fixture-commit; fi
'''

class DeploymentTest(unittest.TestCase):
    def run_rollout(self, arguments, **variables):
        temp = tempfile.TemporaryDirectory(prefix='cubs-deploy-test-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        (root/'scripts/deploy').mkdir(parents=True)
        (root/'docker').mkdir()
        shutil.copy(ROOT/'scripts/deploy-prod.sh',root/'scripts/deploy-prod.sh')
        shutil.copy(ROOT/'scripts/deploy/config.mjs',root/'scripts/deploy/config.mjs')
        shutil.copy(ROOT/'Dockerfile',root/'Dockerfile')
        (root/'docker/backend.prod.env').write_text('NODE_ENV=production\n')
        (root/'docker/rqlite.prod.env').write_text('NODE_ID=1\n')
        (root/'bin').mkdir()
        for name, content in [('docker',FAKE_DOCKER),('git',FAKE_GIT)]:
            file=root/'bin'/name; file.write_text(content); file.chmod(0o700)
        log=root/'commands.log'
        env={**os.environ,'PATH':str(root/'bin')+os.pathsep+os.environ['PATH'], 'REAL_DOCKER':DOCKER,
             'MOCK_LOG':str(log),'FIXTURE_ROOT':str(root),**variables}
        # First provision only fixture files; do not exercise a production container.
        check=subprocess.run(['bash','scripts/deploy-prod.sh','--bootstrap-auth','--check'],cwd=root,env=env,capture_output=True,text=True)
        self.assertEqual(check.returncode,0,check.stdout+check.stderr)
        log.write_text('')
        result=subprocess.run(['bash','scripts/deploy-prod.sh',*arguments],cwd=root,env=env,capture_output=True,text=True)
        return result, log.read_text(), root

    def test_bootstrap_orders_backup_and_auth_before_backend_restart(self):
        result, log, root=self.run_rollout(['--bootstrap-auth','backend'])
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('build backend rqlite',log)
        self.assertNotIn('up -d --no-deps frontend',log)
        self.assertLess(log.index('migrate status'),log.index('up -d --no-deps backend'))
        self.assertLess(log.index('stop backend rqlite'),log.index('--entrypoint tar'))
        self.assertLess(log.index('--entrypoint tar'),log.index('up -d --no-deps rqlite'))
        self.assertNotIn('--allow-manual',log)
        self.assertNotIn('down',log)
        passwords=json.loads((root/'docker/.generated/rqlite-auth.json').read_text())
        for user in passwords:self.assertNotIn(user['password'],result.stdout+result.stderr+log)

    def test_pending_migrations_prevent_any_service_switch(self):
        result, log, _=self.run_rollout(['backend'],MOCK_PENDING='1')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('up -d',log)
        self.assertNotIn('stop backend',log)

    def test_frontend_rollout_does_not_build_or_recreate_dependencies(self):
        result, log, _=self.run_rollout(['frontend'])
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('build frontend',log)
        self.assertNotIn('build backend',log)
        self.assertNotIn('up -d --no-deps backend',log)
        self.assertNotIn('up -d --no-deps rqlite',log)

    def test_backup_failure_stops_before_database_recreation(self):
        result, log, _=self.run_rollout(['--bootstrap-auth','backend'],MOCK_BACKUP_FAIL='1')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('up -d --no-deps rqlite',log)

if __name__=='__main__':unittest.main()
