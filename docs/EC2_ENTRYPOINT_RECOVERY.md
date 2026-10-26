# Targeted recovery of the installed C2 observer

The owner bootstrap installed the service and reporting credential drop-in.
Read-only run40410457283/job121879546758 verified it enabled under poe-runtime,
but its process exited0 immediately and no public status file exists. This is a
launch bug: the original main-module test compares the real release path with
the lexical current symlink and silently skips the CLI. The problem is reproduced
against the compiled release and TSX. No account reset or installation rerun is needed.

Node24.19's standard --preserve-symlinks-main flag fixes the installed release
without replacing code or financial records. Both ExecStart and ExecStop need it.
The existing runner's exact systemctl start permission is denied, and it cannot
write root-owned unit overrides. One existing owner/root action is unavoidable;
no AWS key, inventory dispatch, account initialization, key handling or new sudo
rule is requested. This action preserves reporting.conf and all private data.

Run this once in the existing owner/root shell on i-00044d4ea1471b957:

```sh
sudo /usr/bin/bash <<'POE_ENTRYPOINT_FIX'
set -euo pipefail
umask 077
python3 -I - <<'PY'
import json,urllib.request
http=urllib.request.build_opener(urllib.request.ProxyHandler({}))
token=http.open(urllib.request.Request('http://169.254.169.254/latest/api/token',method='PUT',headers={'X-aws-ec2-metadata-token-ttl-seconds':'60'}),timeout=3).read().decode()
d=json.load(http.open(urllib.request.Request('http://169.254.169.254/latest/dynamic/instance-identity/document',headers={'X-aws-ec2-metadata-token':token}),timeout=3))
assert (d.get('accountId'),d.get('region'),d.get('instanceId'))==('133857166104','us-west-2','i-00044d4ea1471b957'),'Wrong host; no change'
PY
if systemctl is-active --quiet poe-runtime.service; then
  echo 'POE is already active; no change or restart performed.'
  exit 0
fi
test "$(readlink -f /opt/poe/current)" = /opt/poe/releases/bce3d22bb434eb429aafacb788a18f39ec189c1b
test -f /var/lib/poe/state/ledger.sqlite
test ! -L /var/lib/poe/state/ledger.sqlite
test ! -L /etc/systemd/system/poe-runtime.service.d
test -d /etc/systemd/system/poe-runtime.service.d
test "$(stat -c '%u:%a' /etc/systemd/system/poe-runtime.service.d)" = '0:755'
poe_stage=$(mktemp -d /root/poe-service-fix.XXXXXXXX)
trap 'rm -rf -- "$poe_stage"' EXIT
cat >"$poe_stage/entrypoint.conf" <<'POE_UNIT'
[Service]
ExecStart=
ExecStart=/opt/poe/node/bin/node --preserve-symlinks-main --use-env-proxy /opt/poe/current/dist/src/runtime.js run
ExecStop=
ExecStop=/opt/poe/node/bin/node --preserve-symlinks-main /opt/poe/current/dist/src/runtime.js safe-stop
POE_UNIT
poe_override=/etc/systemd/system/poe-runtime.service.d/entrypoint.conf
test ! -L "$poe_override"
if test -e "$poe_override"; then
  test -f "$poe_override"
  test "$(stat -c '%u:%a:%h' "$poe_override")" = '0:644:1'
  cmp --silent "$poe_stage/entrypoint.conf" "$poe_override"
else
  install -o root -g root -m 0644 "$poe_stage/entrypoint.conf" "$poe_override"
fi
systemctl daemon-reload
systemctl start poe-runtime.service
systemctl is-active --quiet poe-runtime.service
echo 'Existing PAPER observer started. No --init, release replacement, account reset or key handling occurred.'
POE_ENTRYPOINT_FIX
```

After completion, the existing read-only job can retrieve actual account/inception/
release/strategy and fact times, then configure Render. A service start alone does
not prove fresh observation/reconciliation or authenticated reporting. No acceptance
clock is started. Until the source fix is deployed in a later reviewed release,
manual runtime/account CLI commands through current also need this Node flag.

If the command refuses because the database is absent or an unexpected override
exists, preserve everything and report only that bounded error. Do not initialize,
delete state, replace the release or restart an already-active service to pass.
