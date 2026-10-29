#!/usr/bin/env python3
"""Offline frozen-publisher checks using explicitly synthetic files only.

The watch cases have no snapshot.json, hence can never enqueue or POST a body.
The source and repository are never changed. Credential values below are fake.
"""
import hashlib
import json
import os
import pathlib
import signal
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
NODE = pathlib.Path('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node')
PUBLISHER = pathlib.Path('/tmp/poe-native-paper-output-original-issue11-20261029/snapshot-publisher.mjs')
FIXTURE = ROOT / 'synthetic-fixture'
FIXTURE.mkdir(mode=0o700, exist_ok=True)
SECRET = FIXTURE / 'poe-ingest-secret'
SNAPSHOT = FIXTURE / 'snapshot.json'
assert not SNAPSHOT.exists(), 'This deliberately absent fixture prevents all real POSTs'
SECRET.write_text('synthetic-offline-only-value-0123456789')
SECRET.chmod(0o600)
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TZ': 'UTC',
       'CREDENTIALS_DIRECTORY': str(FIXTURE), 'POE_PUBLISH_SECRET_FILE': str(SECRET)}
BASE = [str(NODE), '--permission', '--allow-fs-read='+str(PUBLISHER),
        '--allow-fs-read='+str(SNAPSHOT), '--allow-fs-read='+str(SECRET),
        '--max-old-space-size=64', '--disable-proto=throw']
CLI = BASE + [str(PUBLISHER), '--file', str(SNAPSHOT),
              '--account-id', 'poe-3123e352-4581-455b-85db-acd7e825e99e',
              '--inception-at', '2026-10-26T22:07:36.212Z',
              '--release', '5e55d8b939de99698ddb311a282461931fcbc957',
              '--strategy', 'persistent-buying-pilot-v1', '--watch']
results = []

def retain(name, argv, stdout, stderr, **result):
    (ROOT/(name+'.argv.json')).write_text(json.dumps(argv, indent=2)+'\n')
    (ROOT/(name+'.stdout.txt')).write_text(stdout)
    (ROOT/(name+'.stderr.txt')).write_text(stderr)
    results.append({'case': name, **result,
                    'stdoutPath': str(ROOT/(name+'.stdout.txt')),
                    'stderrPath': str(ROOT/(name+'.stderr.txt')),
                    'argvPath': str(ROOT/(name+'.argv.json')),
                    'actualNetworkRequests': 0})

module_js = ('import {readPublisherCredential} from '+json.dumps(PUBLISHER.as_uri())+'; '
             'try { const s=readPublisherCredential(process.env); '
             'console.log(JSON.stringify({credentialReadSucceeded:!!s.length})); } '
             'catch(e) { console.log(JSON.stringify({name:e.name,code:e.code,'
             'message:e.message,resource:e.resource,permission:e.permission})); '
             'process.exitCode=1; }')
argv = BASE + ['--input-type=module', '--eval', module_js]
r = subprocess.run(argv, env=ENV, text=True, capture_output=True, timeout=5)
retain('same-flags-credential-fixture', argv, r.stdout, r.stderr, returncode=r.returncode)

p = subprocess.Popen(CLI, env=ENV, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
time.sleep(1)
alive = p.poll() is None
if alive:
    p.send_signal(signal.SIGTERM)
stdout, stderr = p.communicate(timeout=3)
retain('exact-cli-missing-snapshot', CLI, stdout, stderr,
       aliveAfterOneSecond=alive, returncode=p.returncode,
       snapshotExists=False, stoppedByThisFixtureWith='SIGTERM' if alive else None)

SECRET.chmod(0o644)
r = subprocess.run(CLI, env=ENV, text=True, capture_output=True, timeout=3)
retain('exact-cli-unsafe-credential-mode', CLI, r.stdout, r.stderr,
       syntheticCredentialMode='0644', returncode=r.returncode)
SECRET.chmod(0o600)

report = {
    'kind': 'poe-frozen-publisher-zero-network-fixture',
    'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'uid': os.getuid(),
    'nodeVersion': subprocess.run([str(NODE), '--version'], text=True,
                                  capture_output=True, check=True).stdout.strip(),
    'publisherPath': str(PUBLISHER),
    'publisherSha256': hashlib.sha256(PUBLISHER.read_bytes()).hexdigest(),
    'syntheticCredentialPath': str(SECRET),
    'snapshotFixturePathDeliberatelyAbsent': str(SNAPSHOT),
    'actualCredentialsRead': False,
    'financialFilesRead': False,
    'sourceEdits': False,
    'networkPrevention': 'CLI cases have no snapshot file so no publish queue; export case only reads synthetic credential',
    'actualNetworkRequests': 0,
    'results': results,
}
(ROOT/'cli-results.json').write_text(json.dumps(report, indent=2)+'\n')
assert results[0]['returncode'] == 0
assert results[1]['aliveAfterOneSecond'] is True and results[1]['returncode'] == 0
assert results[2]['returncode'] == 1
print(json.dumps(report, indent=2))
