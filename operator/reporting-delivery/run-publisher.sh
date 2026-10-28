#!/usr/bin/env bash
# Reporting-only process. Identity and private file paths are explicit, never guessed.
set -euo pipefail
fail() { printf '%s\n' 'POE reporting publisher configuration rejected.' >&2; exit 1; }
[[ $(/usr/bin/id -u) != 0 ]] || fail
node_path='' status_file='' secret_file='' account_id='' inception_at='' watch='--watch' verify_only=false
while (($#)); do
  case "$1" in
    --node|--status-file|--secret-file|--account-id|--inception-at)
      (($# >= 2)) || fail
      case "$1" in
        --node) node_path=$2;; --status-file) status_file=$2;; --secret-file) secret_file=$2;;
        --account-id) account_id=$2;; --inception-at) inception_at=$2;;
      esac
      shift 2;;
    --once) watch=''; shift;;
    --watch) watch='--watch'; shift;;
    --verify-only) verify_only=true; shift;;
    *) fail;;
  esac
done
for path in "$node_path" "$status_file" "$secret_file"; do
  [[ $path == /* && $path != *','* && $path != *$'\n'* && $path != *$'\r'* && $path != *$'\t'* ]] || fail
done
[[ -x $node_path && -f $status_file && ! -L $status_file && -f $secret_file && ! -L $secret_file ]] || fail
[[ $status_file != "$secret_file" && $account_id =~ ^poe-pilot-[a-z0-9-]+$ && $inception_at =~ ^[1-9][0-9]{0,15}$ ]] || fail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
bundle=$script_dir/dist/publisher.mjs
manifest=$script_dir/dist/manifest.json
[[ -f $bundle && ! -L $bundle && -f $manifest && ! -L $manifest ]] || fail
# Integrity preflight can read only its two public artifacts. No secret is opened here.
/usr/bin/env -i /usr/bin/prlimit --core=0:0 -- "$node_path" --permission --allow-fs-read="$bundle" --allow-fs-read="$manifest" --input-type=module -e '
import {readFileSync} from "node:fs"; import {createHash} from "node:crypto";
const [bundle,manifest]=process.argv.slice(1),m=JSON.parse(readFileSync(manifest,"utf8")),bytes=readFileSync(bundle),[major,minor]=process.versions.node.split(".").map(Number);
if(major<24||major===24&&minor<19||m.schemaVersion!==1||m.sourceRelease!=="a40c75e7256ffdf4aff720cf79e53a0960252246"||m.destination!=="https://meme-machine-dashboard-staging.onrender.com/api/pilot"||m.bundle.file!=="publisher.mjs"||m.bundle.bytes!==bytes.length||bytes.length>131072||m.bundle.sha256!==createHash("sha256").update(bytes).digest("hex"))process.exit(1);
' "$bundle" "$manifest" >/dev/null 2>&1 || fail
permissions=(--permission --allow-fs-read="$bundle" --allow-fs-read="$status_file" --allow-fs-read="$secret_file" --max-old-space-size=64 --disable-proto=throw)
# No HOME, NODE_OPTIONS, cloud credentials, wallet/provider variables, or inherited proxies.
# This host launcher is for the verified native host; Cloud network tests use its managed route.
if $verify_only; then
  exec /usr/bin/env -i PATH=/usr/bin:/bin POE_PILOT_INGEST_SECRET_FILE="$secret_file" POE_PILOT_ACCOUNT_ID="$account_id" POE_PILOT_INCEPTION_AT="$inception_at" \
    /usr/bin/prlimit --core=0:0 -- "$node_path" "${permissions[@]}" --input-type=module -e '
import {pathToFileURL} from "node:url";
try { const [bundle,status,key]=process.argv.slice(2),allowed=new Set(["PATH","POE_PILOT_INGEST_SECRET_FILE","POE_PILOT_ACCOUNT_ID","POE_PILOT_INCEPTION_AT"]);
if(Object.keys(process.env).some(name=>!allowed.has(name)))throw Error();
const {readPrivateFile,projectPilotStatus}=await import(pathToFileURL(bundle).href),s=projectPilotStatus(JSON.parse(await readPrivateFile(status,4194304))),token=(await readPrivateFile(key,4096)).trim();
if(!Number.isSafeInteger(Number(process.env.POE_PILOT_INCEPTION_AT))||s.accountId!==process.env.POE_PILOT_ACCOUNT_ID||s.inceptionAt!==Number(process.env.POE_PILOT_INCEPTION_AT)||s.generatedAt>Date.now()+5000||token.length<32||token.length>512||/[\s\u0000-\u001f]/.test(token))throw Error();
console.log(JSON.stringify({configurationVerified:true,accountId:s.accountId,inceptionAt:s.inceptionAt,networkRequests:0,financialWriter:false}));
} catch { console.error("POE reporting publisher private-file or identity check failed.");process.exitCode=1; }
' poe-reporting-private-file-check "$bundle" "$status_file" "$secret_file"
fi
args=("$bundle" --file "$status_file")
[[ -z $watch ]] || args+=("$watch")
exec /usr/bin/env -i PATH=/usr/bin:/bin POE_PILOT_INGEST_SECRET_FILE="$secret_file" POE_PILOT_ACCOUNT_ID="$account_id" POE_PILOT_INCEPTION_AT="$inception_at" \
  /usr/bin/prlimit --core=0:0 -- "$node_path" "${permissions[@]}" "${args[@]}"
