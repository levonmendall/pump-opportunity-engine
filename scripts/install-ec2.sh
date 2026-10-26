#!/usr/bin/env bash
# Explicit owner/root bootstrap for the already verified dedicated EC2 host.
# Usage: sudo bash install-ec2.sh <tested-40-hex-release> [--init] [--start]
# --init creates PAPER state ONCE using a current public SOL/USD observation.
# No wallet credentials, live signing, legacy cleanup, or trading entries.
set -euo pipefail
umask 027

fail() { echo "POE_INSTALL_REFUSED: $*" >&2; exit 1; }
test "${EUID}" -eq 0 || fail 'execute through existing owner root access; runner privileges are not changed'
poe_release=${1:-}
[[ "$poe_release" =~ ^[0-9a-f]{40}$ ]] || fail 'first argument must be the tested exact Git commit (40 lowercase hex)'
shift
poe_initialize=false
poe_start=false
for poe_option in "$@"; do
  case "$poe_option" in
    --init) poe_initialize=true ;;
    --start) poe_start=true ;;
    *) fail 'only --init and --start are supported' ;;
  esac
done
for poe_command in curl python3 tar sha256sum git runuser systemctl install id find flock; do
  command -v "$poe_command" >/dev/null || fail "required administration command missing: $poe_command"
done
test "$(uname -m)" = x86_64 || fail 'this verified Node build targets Linux x86_64 only'

# IMDSv2 identity document only, never user-data or role credentials.
python3 -I - <<'PY'
import json,urllib.request
http=urllib.request.build_opener(urllib.request.ProxyHandler({}))
req=urllib.request.Request('http://169.254.169.254/latest/api/token',method='PUT',headers={'X-aws-ec2-metadata-token-ttl-seconds':'60'})
token=http.open(req,timeout=3).read().decode()
req=urllib.request.Request('http://169.254.169.254/latest/dynamic/instance-identity/document',headers={'X-aws-ec2-metadata-token':token})
d=json.load(http.open(req,timeout=3))
assert (d.get('accountId'),d.get('region'),d.get('instanceId'))==('133857166104','us-west-2','i-00044d4ea1471b957'),'EC2 identity mismatch; no install performed'
print(json.dumps({'verifiedInstance':d['instanceId'],'region':d['region'],'account':d['accountId']}))
PY

# No upgrade may terminate a running writer or silently abandon PAPER exposure.
if systemctl is-active --quiet poe-runtime.service; then
  fail 'runtime is active; use its safe-stop/status path and a separately reviewed upgrade'
fi
if test -L /opt/poe/current; then
  test "$(readlink -f /opt/poe/current)" = "/opt/poe/releases/$poe_release" || fail 'initial installer refuses to switch an existing release; reviewed upgrade required'
elif test -e /opt/poe/current; then
  fail '/opt/poe/current is not the expected release symlink'
fi
poe_available_kib=$(df -Pk /opt | awk 'NR==2 {print $4}')
[[ "$poe_available_kib" =~ ^[0-9]+$ ]] && test "$poe_available_kib" -ge 1048576 || fail 'less than 1 GiB available; preserve data and report capacity'

# Dedicated identity; do not grant sudo, read legacy secrets, or replace the runner.
if ! id poe-runtime >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/poe --shell /usr/sbin/nologin poe-runtime
fi
poe_uid=$(id -u poe-runtime)
test "$poe_uid" -ne 0 || fail 'poe-runtime must be nonroot'
test "$(id -gn poe-runtime)" = poe-runtime || fail 'existing poe-runtime identity has an unexpected primary group'
test "$(id -G poe-runtime)" = "$(id -g poe-runtime)" || fail 'poe-runtime must belong only to its dedicated primary group; no shared or privileged supplemental groups are allowed'
python3 -I - "$poe_uid" <<'PY'
import os,pathlib,stat,sys
uid=int(sys.argv[1])
for name,owner in [('/opt/poe',0),('/opt/poe/releases',0),('/opt/poe/node',0),('/etc/poe',0),('/etc/poe/secrets',0),('/var/lib/poe',uid),('/var/lib/poe/state',uid),('/var/lib/poe/backups',uid),('/var/lib/poe/evidence',uid),('/var/lib/poe-public',uid)]:
    p=pathlib.Path(name)
    if not os.path.lexists(p):continue
    s=p.lstat()
    assert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==owner and not s.st_mode&0o022,'Unexpected protected directory owner/type/permissions; no chown or cleanup attempted: '+name
PY
install -d -o root -g poe-runtime -m 0750 /opt/poe /opt/poe/releases /etc/poe
install -d -o root -g root -m 0700 /etc/poe/secrets
install -d -o poe-runtime -g poe-runtime -m 0700 /var/lib/poe /var/lib/poe/state /var/lib/poe/backups /var/lib/poe/evidence
install -d -o poe-runtime -g poe-runtime -m 0755 /var/lib/poe-public

# Do not accumulate releases, automatically prune a checkout, or touch history.
poe_release_count=$(find /opt/poe/releases -mindepth 1 -maxdepth 1 -type d | wc -l)
test "$poe_release_count" -le 2 || fail 'more than current+one rollback present; explicit reviewed release cleanup required'
poe_target="/opt/poe/releases/$poe_release"
test ! -L "$poe_target" || fail 'release target is an unexpected symlink'
if ! test -d "$poe_target" && test "$poe_release_count" -ge 2; then
  fail 'release retention is full; no release was deleted'
fi

poe_stage=$(mktemp -d /opt/poe/.install-XXXXXXXX)
cleanup() { test -n "${poe_stage:-}" && test -d "$poe_stage" && rm -rf -- "$poe_stage"; }
trap cleanup EXIT

if ! test -x /opt/poe/node/bin/node; then
  test ! -e /opt/poe/node || fail 'unexpected incomplete Node directory; no replacement performed'
  curl -fsSL --max-time 120 https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz -o "$poe_stage/node.tar.xz"
  echo '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647  '"$poe_stage/node.tar.xz" | sha256sum --check --status || fail 'official Node archive checksum mismatch'
  install -d -o root -g poe-runtime -m 0750 "$poe_stage/node"
  tar -xJf "$poe_stage/node.tar.xz" -C "$poe_stage/node" --strip-components=1
  chown -R root:poe-runtime "$poe_stage/node"
  chmod -R go-w "$poe_stage/node"
  mv "$poe_stage/node" /opt/poe/node
fi
# The dedicated tree may already exist. Validate it without running any of its
# programs, including --version, before trusting an executable as owner/root.
python3 -I - /opt/poe/node <<'PY'
import pathlib,stat,sys
root=pathlib.Path(sys.argv[1]);s=root.lstat();prefix=str(root)+'/'
assert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode),'Dedicated Node path must be a real directory'
for p in [root,*root.rglob('*')]:
    s=p.lstat()
    assert s.st_uid==0,'Dedicated Node tree contains a nonroot-owned path'
    if stat.S_ISLNK(s.st_mode):
        assert str(p.resolve(strict=True)).startswith(prefix),'Dedicated Node symlink escapes its tree'
    else:
        assert (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)) and not s.st_mode&0o022,'Dedicated Node tree has an unsafe type or writable path'
binary=(root/'bin/node').lstat()
assert stat.S_ISREG(binary.st_mode) and not stat.S_ISLNK(binary.st_mode),'Dedicated Node executable must be a regular file'
PY
test "$(/opt/poe/node/bin/node --version)" = v24.19.0 || fail 'dedicated Node version differs from tested v24.19.0'

if ! test -d "$poe_target"; then
  install -d -o poe-runtime -g poe-runtime -m 0700 "$poe_stage/source"
  # Parent is traversable by only the dedicated build user, not world writable.
  chown root:poe-runtime "$poe_stage"
  chmod 0750 "$poe_stage"
  runuser -u poe-runtime -- git -c credential.helper= -C "$poe_stage/source" init -q
  runuser -u poe-runtime -- git -c credential.helper= -C "$poe_stage/source" fetch --quiet --depth=1 https://github.com/levonmendall/pump-opportunity-engine.git "$poe_release"
  runuser -u poe-runtime -- git -C "$poe_stage/source" checkout --quiet --detach FETCH_HEAD
  test "$(runuser -u poe-runtime -- git -C "$poe_stage/source" rev-parse HEAD)" = "$poe_release" || fail 'fetched source differs from requested release'
  runuser -u poe-runtime -- env PATH=/opt/poe/node/bin:/usr/bin:/bin bash -c 'cd "$1" && npm ci --include=dev && npm run build && npm run compile' bash "$poe_stage/source"
  test -f "$poe_stage/source/dist/src/runtime.js" && test -f "$poe_stage/source/dist/src/account.js" && test -f "$poe_stage/source/dist/src/valuation.js" || fail 'requested release lacks compiled PAPER runtime/account/valuation commands'
  # Freeze code after build. The runtime only writes its separate state directory.
  printf '%s\n' "$poe_release" > "$poe_stage/source/POE_RELEASE"
  chown -R root:poe-runtime "$poe_stage/source"
  chmod -R go-w "$poe_stage/source"
  chmod 0750 "$poe_stage/source"
  mv "$poe_stage/source" "$poe_target"
else
  test -f "$poe_target/POE_RELEASE" && test "$(cat "$poe_target/POE_RELEASE")" = "$poe_release" || fail 'existing target lacks the expected immutable release record'
fi
# Validate the actual target before trusting its service file or compiled code.
python3 -I - "$poe_target" <<'PY'
import os,pathlib,stat,sys
root=pathlib.Path(sys.argv[1]);prefix=str(root)+'/'
for p in [root,*root.rglob('*')]:
    s=p.lstat()
    assert s.st_uid==0,'Release contains a nonroot-owned path; no service installed'
    if stat.S_ISLNK(s.st_mode):
        assert str(p.resolve()).startswith(prefix),'Release symlink escapes its immutable directory'
    else:
        assert not s.st_mode&0o022,'Release contains group/world writable paths; no service installed'
assert stat.S_ISDIR(root.lstat().st_mode),'Release target is not a directory'
PY
test "$(git -C "$poe_target" rev-parse HEAD)" = "$poe_release" || fail 'existing release Git HEAD differs from requested tested source'
test -L /opt/poe/current || ln -s "$poe_target" /opt/poe/current

validate_runtime_env() {
  python3 -I - /etc/poe/runtime.env <<'PY'
import os,pathlib,stat,sys
p=pathlib.Path(sys.argv[1])
if os.path.lexists(p):
    s=p.lstat()
    assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o027 and s.st_size<8192,'Runtime configuration must be a root-owned regular non-symlink file, without group write or other access'
PY
}
validate_runtime_env
if ! test -e /etc/poe/runtime.env && ! test -L /etc/poe/runtime.env; then
  poe_account="poe-$(cat /proc/sys/kernel/random/uuid)"
  python3 -I - "$poe_account" "$poe_release" <<'PY'
import grp,os,sys
account,release=sys.argv[1:]
fields={'POE_DB_PATH':'/var/lib/poe/state/ledger.sqlite','POE_ACCOUNT_ID':account,'POE_RUNTIME_RELEASE':release,'POE_DATA_DIR':'/var/lib/poe','POE_SOCKET_PATH':'/run/poe/control.sock','POE_PUBLISH_URL':'https://meme-machine-dashboard-staging.onrender.com/api/snapshot','POE_USD_SOURCE':'coinbase-spot','POE_USD_PRICE_FILE':'/var/lib/poe/state/valuation.json','POE_PUBLIC_STATUS_PATH':'/var/lib/poe-public/status.json'}
fd=os.open('/etc/poe/runtime.env',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
try:
    os.fchown(fd,0,grp.getgrnam('poe-runtime').gr_gid);os.fchmod(fd,0o640)
    os.write(fd,(''.join(key+'='+value+'\n' for key,value in fields.items())).encode());os.fsync(fd)
finally:os.close(fd)
PY
fi
validate_runtime_env
# Parse data, never source an environment file as shell code.
poe_account=$(python3 -I - <<'PY'
import pathlib,re,stat
p=pathlib.Path('/etc/poe/runtime.env');s=p.lstat()
assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o027 and s.st_size<8192
d=dict(line.split('=',1) for line in p.read_text().splitlines() if line and not line.startswith('#'))
assert d['POE_DB_PATH']=='/var/lib/poe/state/ledger.sqlite'
assert re.fullmatch(r'poe-[a-z0-9-]{1,80}',d['POE_ACCOUNT_ID'])
print(d['POE_ACCOUNT_ID'])
PY
)
test "$(sed -n 's/^POE_RUNTIME_RELEASE=//p' /etc/poe/runtime.env)" = "$poe_release" || fail 'existing runtime config identifies another release; no overwrite performed'
if grep -q '^POE_USD_SOURCE=' /etc/poe/runtime.env; then
  test "$(sed -n 's/^POE_USD_SOURCE=//p' /etc/poe/runtime.env)" = coinbase-spot || fail 'existing USD source differs; no configuration overwrite performed'
else
  validate_runtime_env
  python3 -I - <<'PY'
import os,stat
fd=os.open('/etc/poe/runtime.env',os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
try:
    s=os.fstat(fd)
    assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o027 and s.st_size<8192
    os.write(fd,b'POE_USD_SOURCE=coinbase-spot\n');os.fsync(fd)
finally:os.close(fd)
PY
fi
validate_runtime_env
if grep -q '^POE_PUBLIC_STATUS_PATH=' /etc/poe/runtime.env; then
  test "$(sed -n 's/^POE_PUBLIC_STATUS_PATH=//p' /etc/poe/runtime.env)" = /var/lib/poe-public/status.json || fail 'existing public status path differs; no overwrite performed'
else
  python3 -I - <<'PY'
import os,stat
fd=os.open('/etc/poe/runtime.env',os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
try:
    s=os.fstat(fd)
    assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o027 and s.st_size<8192
    os.write(fd,b'POE_PUBLIC_STATUS_PATH=/var/lib/poe-public/status.json\n');os.fsync(fd)
finally:os.close(fd)
PY
fi

install -o root -g root -m 0644 "$poe_target/scripts/poe-runtime.service" /etc/systemd/system/poe-runtime.service
if test -f /etc/poe/secrets/ingest-secret; then
  install -d -o root -g root -m 0755 /etc/systemd/system/poe-runtime.service.d
  printf '[Service]\nLoadCredential=poe-ingest-secret:/etc/poe/secrets/ingest-secret\n' > /etc/systemd/system/poe-runtime.service.d/reporting.conf
  chmod 0644 /etc/systemd/system/poe-runtime.service.d/reporting.conf
fi
systemctl daemon-reload

if "$poe_initialize" && ! test -e /var/lib/poe/state/ledger.sqlite; then
  # Explicit --init only, after the long build. This fetches public spot data,
  # creates virtual capital, and records its source/receive time; no real wallet.
  runuser -u poe-runtime -- env PATH=/opt/poe/node/bin:/usr/bin:/bin POE_INSTALL_ACCOUNT="$poe_account" /opt/poe/node/bin/node --use-env-proxy --input-type=module - <<'JS'
import {writeFileSync} from 'node:fs';
import {runAccountCommand} from '/opt/poe/current/dist/src/account.js';
import {fetchPublicUsdPrice} from '/opt/poe/current/dist/src/valuation.js';
const price=await fetchPublicUsdPrice();
writeFileSync('/var/lib/poe/state/valuation.json',JSON.stringify(price)+'\n',{mode:0o600,flag:'wx'});
writeFileSync('/var/lib/poe/state/init-input.json',JSON.stringify({price})+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(await runAccountCommand(['init','--db','/var/lib/poe/state/ledger.sqlite','--account',process.env.POE_INSTALL_ACCOUNT,'--input','/var/lib/poe/state/init-input.json'])));
JS
fi
if "$poe_start"; then
  test -f /var/lib/poe/state/ledger.sqlite || fail '--start requires an existing authoritative PAPER account; use explicit --init once'
  runuser -u poe-runtime -- env POE_INSTALL_ACCOUNT="$poe_account" /opt/poe/node/bin/node --input-type=module - <<'JS'
import {PaperLedger} from '/opt/poe/current/dist/src/ledger.js';
const ledger=new PaperLedger('/var/lib/poe/state/ledger.sqlite',process.env.POE_INSTALL_ACCOUNT);
try{
  const state=ledger.state();
  if(Object.keys(state.positions).length||Object.values(state.pending).some(order=>order.side==='sell'))throw new Error('Observer cannot start with positions or pending SELL actions until supported exit management is connected; state preserved');
}finally{ledger.close();}
JS
  systemctl enable --now poe-runtime.service
  systemctl is-active --quiet poe-runtime.service || fail 'supervised runtime failed; inspect its safe status/logs without resetting financial state'
fi
printf 'POE installed release %s for account identity %s. Entry-blocked scaffold; live trading unavailable.\n' "$poe_release" "$poe_account"
echo 'No legacy services, wallet credentials, financial history or global Node installation were changed.'
