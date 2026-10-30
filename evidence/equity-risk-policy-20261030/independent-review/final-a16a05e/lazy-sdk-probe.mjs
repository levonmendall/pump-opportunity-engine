/** OFFLINE diagnostic copy only: no rebuild, real account or provider access. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw Error('INDEPENDENT_BUNDLE_NETWORK_FORBIDDEN');};
globalThis.fetch=denied;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=tls.connect=dns.lookup=denied;syncBuiltinESMExports();
const m=await import('./diagnostic-native-paper.mjs');
assert.equal(m.nativePaperConfigurationSha256({service:true,stage:'two',deepSlots:4,strategy:'adaptive-momentum-v2'}),'1a81d2156865467cab6300c260a809e0f98ae6649bdd88b4161f13b4c7d8edef');
const fixtures=JSON.parse(readFileSync(new URL('./fixture-inputs.json',import.meta.url),'utf8')),results=[];
for(const f of fixtures){
 const q=await m.__independentUnsignedSdkProbe(f.batch,f.request,()=>f.at);
 assert.equal(q.expectedOutputUnits,f.expectedOutput);assert.equal(q.wallet.signerAvailable,false);assert.equal(q.wallet.chainBalancesVerified,false);assert.equal(q.accounts.quoteClosedByInstructions,true);assert.equal(q.networkRequests,0);assert.equal(q.temporaryQuoteRentLamports,'2039280');
 results.push({mint:q.mint,expectedOutputMatched:true,instructionCount:q.instructionCount,quoteClosedByInstructions:q.accounts.quoteClosedByInstructions,signerAvailable:q.wallet.signerAvailable,networkRequests:q.networkRequests});
}
console.log(JSON.stringify({scope:'Temporary diagnostic export appended to a copy of the hash-verified standalone bundle, not deployable artifact or financial operation',nodeModulesPresent:false,syntheticAccountAndRentAssumptions:true,configurationMatched:true,actualSdkConstructions:results}));
