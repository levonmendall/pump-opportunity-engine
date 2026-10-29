#!/usr/bin/env bash
# LOCAL ONLY, after final committed two-position source/full suite/review.
# The established builder performs isolated network-denied disposable smoke;
# this does not run the service, access the original ledger or contact providers.
set -euo pipefail
cd /workspace/pump-opportunity-engine
: "${POE_TWO_FINAL_SOURCE:?Set the final integrated, reviewed 40-hex source commit}"
[[ "$POE_TWO_FINAL_SOURCE" =~ ^[a-f0-9]{40}$ ]]
test "$(git rev-parse HEAD)" = "$POE_TWO_FINAL_SOURCE"
export POE_TWO_FINAL_SOURCE
export POE_TWO_BUILD_OUT=/tmp/poe-native-paper-output-two-position-final
export POE_TWO_BUILD_LOG=/tmp/poe-two-position-final-build.raw.txt
export POE_TWO_CONFIG_JSON=/tmp/poe-two-position-final-configuration.json
# Builder refuses dirty src/scripts/package/lock, mutable source, reused output,
# unpinned dependencies/SQLite ABI or failed import/backup/reopen/CLI guards.
node scripts/build-native-paper-ec2.mjs --output-directory "$POE_TWO_BUILD_OUT" > "$POE_TWO_BUILD_LOG" 2>&1
node --input-type=module > "$POE_TWO_CONFIG_JSON" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const out=process.env.POE_TWO_BUILD_OUT,source=process.env.POE_TWO_FINAL_SOURCE;
const metadata=JSON.parse(readFileSync(out+'/metadata.json','utf8'));
assert.equal(metadata.git.commit,source);
assert.equal(metadata.git.workingTreeStatus,'');
assert.equal(metadata.financialMode,'PAPER');
assert.equal(metadata.liveTradingEnabled,false);
const m=await import(pathToFileURL(out+'/native-paper.mjs').href);
const configurationSha256=m.nativePaperConfigurationSha256({service:true,stage:'two',deepSlots:4});
assert.match(configurationSha256,/^[a-f0-9]{64}$/);
assert.notEqual(configurationSha256,m.nativePaperConfigurationSha256({service:true,stage:'single',deepSlots:4}));
const files={};
for(const name of ['native-paper.mjs','metadata.json','backup-worker.mjs','better_sqlite3.node','snapshot-publisher.mjs']) {
 const b=readFileSync(out+'/'+name);files[name]={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};
}
assert.equal(files['native-paper.mjs'].sha256,metadata.bundle.sha256);
assert.equal(files['backup-worker.mjs'].sha256,metadata.closure.worker.sha256);
assert.equal(files['better_sqlite3.node'].sha256,metadata.closure.addon.sha256);
assert.equal(files['snapshot-publisher.mjs'].sha256,metadata.publisher.sha256);
console.log(JSON.stringify({kind:'frozen-original-two-position-configuration-and-file-pins',sourceCommit:source,configurationSha256,requestedStage:'two',requestedDeepSlots:4,expectedStrategyVersion:'persistent-buying-pilot-concurrent-stage-2-v1',expectedPositionLimit:2,expectedProfileContractSha256:'416dda5b84dd2e282534fcf20c77137afd61afb7de178d418bf2772bd6f2f100',files,measurementExecuted:false,financialAccountRead:false,providerRequests:0},null,2));
JS
