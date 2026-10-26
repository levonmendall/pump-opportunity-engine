# One-time owner/root EC2 bootstrap

**COMPLETED. Do not rerun on the installed host.** The actual account/inception
and running C2 observer are verified in STATUS.md. This file retains the pinned
initial-install procedure for review; it is not a pending owner request.

At initial installation, the verified
administration runner is connected, but run40404058329/job121857131607 proved it
cannot create the POE user/service under its existing sudo policy. Do not change
that policy, redispatch inventory, repeat reporter shutdown or obtain AWS keys.

Use the existing private interactive owner/root shell on instance
i-00044d4ea1471b957, account133857166104/us-west-2. The script independently checks
that identity. It preserves the runner, old financial records and unrelated
infrastructure; no cleanup, real wallet operations or spending. It installs an
entry-blocked PAPER observer, not an accepted trading/exit strategy. No24/72-hour
acceptance clock starts from this action.

First open the existing service's authenticated Render Environment console:
https://dashboard.render.com/web/srv-daqon53tqb8s73bdceq0/env .
Privately copy the current POE_INGEST_SECRET. Do not use a wallet/provider key or
the viewer password. Paste it only at the hidden terminal prompt below; never in
chat, a command argument, GitHub, environment exports, logs or workflow artifacts.
The same action initializes virtual capital once, installs standard systemd
LoadCredential, and starts the restricted nonroot service.

The reviewed installation release is bce3d22bb434eb429aafacb788a18f39ec189c1b. Installer SHA-256:
3a1b269f2b10f97f45b0fae5d6f9185cc4f6d35abf965df79a2a5941d63c6136. These differ from the already-live dashboard release;
its read-model schema is compatible. The code/account source identity comes from
the installed release, never a fixture.

```sh
sudo /usr/bin/bash <<'POE_OWNER_BOOTSTRAP'
set +x
set -euo pipefail
umask 077
poe_release='bce3d22bb434eb429aafacb788a18f39ec189c1b'
poe_hash='3a1b269f2b10f97f45b0fae5d6f9185cc4f6d35abf965df79a2a5941d63c6136'
poe_stage=$(mktemp -d /root/poe-bootstrap.XXXXXXXX)
trap 'rm -rf -- "$poe_stage"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 45 \
  "https://raw.githubusercontent.com/levonmendall/pump-opportunity-engine/$poe_release/scripts/install-ec2.sh" \
  -o "$poe_stage/install.sh"
printf '%s  %s\n' "$poe_hash" "$poe_stage/install.sh" | sha256sum --check --status
/usr/bin/bash "$poe_stage/install.sh" "$poe_release" --init

if test ! -e /etc/poe/secrets/ingest-secret && test ! -L /etc/poe/secrets/ingest-secret; then
  IFS= read -r -s -p 'Paste current Render POE_INGEST_SECRET (hidden): ' poe_ingest_secret </dev/tty
  printf '\n' >/dev/tty
  printf '%s' "$poe_ingest_secret" | python3 -I -c '
import os,sys
data=sys.stdin.buffer.read(257)
assert 24<=len(data)<=256 and all(33<=c<=126 for c in data),"Invalid reporting credential; nothing written"
fd=os.open("/etc/poe/secrets/ingest-secret",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
    os.write(fd,data);os.fsync(fd)
finally:os.close(fd)
'
  unset poe_ingest_secret
fi
python3 -I - <<'PY'
import pathlib,stat
p=pathlib.Path('/etc/poe/secrets/ingest-secret');s=p.lstat()
assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and s.st_mode&0o777==0o600
assert 24<=s.st_size<=256
PY
/usr/bin/bash "$poe_stage/install.sh" "$poe_release" --start

poe_ready=false
for poe_attempt in $(seq 1 20); do
  if systemctl is-active --quiet poe-runtime.service &&
     python3 -I - "$poe_release" <<'PY'
import datetime,json,pathlib,pwd,stat,sys,time
p=pathlib.Path('/var/lib/poe-public/status.json')
try:
    owner=pwd.getpwnam('poe-runtime').pw_uid
    parent=p.parent.lstat();s=p.lstat()
    assert stat.S_ISDIR(parent.st_mode) and not stat.S_ISLNK(parent.st_mode) and parent.st_uid==owner and parent.st_mode&0o777==0o755
    assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==owner and s.st_mode&0o777==0o644 and s.st_size<=4096
    d=json.loads(p.read_text());now=time.time()
    def age(key):
        v=d.get(key)
        return None if v is None else now-datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()
    assert d['project']=='pump-opportunity-engine' and d['mode']=='PAPER' and d['liveTrading'] is False
    assert d['release']==sys.argv[1] and d['strategy']=='UNIMPLEMENTED_FLOW_BLOCKED'
    assert d['entriesDisabled'] is True and d['flowVerified'] is False and d['reportingConfigured'] is True
    assert d['feedConnected'] is True and 0<=age('generatedAt')<=15
    assert age('lastReconciledAt') is not None and 0<=age('lastReconciledAt')<=15
except Exception:sys.exit(1)
PY
  then
    poe_ready=true
    break
  fi
  sleep 1
done
if test "$poe_ready" != true; then
  echo 'POE service was installed; useful observation/reconciliation is not yet verified. Preserve state; do not reinitialize.'
  exit 2
fi
python3 -I - <<'PY'
import json,pathlib
d=json.loads(pathlib.Path('/var/lib/poe-public/status.json').read_text())
keys=['project','mode','liveTrading','accountId','inceptionAt','release','strategy','generatedAt','lastUsefulProgressAt','usdPriceAt','lastReconciledAt','feedConnected','entriesDisabled','flowVerified','reportingConfigured','blocker']
print(json.dumps({k:d[k] for k in keys},sort_keys=True))
PY
echo 'Restricted PAPER observer verified. Entries remain disabled; authoritative Render identity configuration follows independently.'
POE_OWNER_BOOTSTRAP
```

The root-owned0700 staging copy is checked before execution; do not run the
historical runner-owned/tmp command from preflight logs. The reporting secret is
written with exclusive/no-follow0600 creation. An existing protected credential
is preserved, not overwritten. The second installer invocation uses the existing
PAPER account and cannot reseed it.

Keep only the final sanitized receipt when reporting completion. Do not share
secret values or terminal/environment dumps. The existing runner can then read
the bounded nonfinancial status file without new privileges, and the connector
can set the four actual source identifiers and verify reporting. Render's current
empty-source503 is expected until that step; it does not stop EC2.

If initialization or startup fails, preserve the account/configuration and
report the bounded error. Never delete a database, reset capital or repeat
initialization to make readiness pass. Existing positions/pending sells cause
this observer to refuse startup until supported exit management is connected.
