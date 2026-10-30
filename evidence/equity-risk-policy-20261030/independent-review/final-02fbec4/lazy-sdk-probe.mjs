/** OFFLINE diagnostic copy only: no rebuild, real account or provider access. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw Error('INDEPENDENT_BUNDLE_NETWORK_FORBIDDEN');};
globalThis.fetch=denied;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=tls.connect=dns.lookup=denied;syncBuiltinESMExports();
const m=await import('./diagnostic-native-paper.mjs');
assert.equal(m.nativePaperConfigurationSha256({service:true,stage:'two',deepSlots:4,strategy:'adaptive-momentum-v2'}),'1a81d2156865467cab6300c260a809e0f98ae6649bdd88b4161f13b4c7d8edef');
const fixtures=JSON.parse(readFileSync(new URL('./fixture-inputs.json',import.meta.url),'utf8')),results=[];
for(const f of fixtures)for(const side of ['buy','sell']){
 const request={...f.request,side,inputUnits:side==='buy'?f.request.inputUnits:f.expectedOutput,accountPlan:{...f.request.accountPlan,baseExists:side==='sell'}};
 const q=await m.__independentUnsignedSdkProbe(f.batch,request,()=>f.at);
 assert.equal(q.expectedOutputUnits,side==='buy'?f.expectedOutput:f.expectedSell);assert.equal(q.wallet.signerAvailable,false);assert.equal(q.accounts.quoteClosedByInstructions,true);assert.equal(q.networkRequests,0);
 const bids=q.instructions.filter(i=>i.programId==='ComputeBudget111111111111111111111111111111');assert.equal(bids.length,2);assert.deepEqual(q.instructions.slice(0,2),bids);assert.ok(bids.every(i=>i.keys.length===0));
 const limit=Buffer.from(bids[0].dataBase64,'base64'),price=Buffer.from(bids[1].dataBase64,'base64');assert.equal(limit.length,5);assert.equal(limit[0],2);assert.equal(limit.readUInt32LE(1),200000);assert.equal(price.length,9);assert.equal(price[0],3);assert.equal(price.readBigUInt64LE(1),10000n);
 const priority=(BigInt(limit.readUInt32LE(1))*price.readBigUInt64LE(1)+999999n)/1000000n;assert.equal(priority,2000n);
 const plan=m.__independentPlanProbe({plannedAt:f.at,decisionQuoteAt:f.at,sourceSlot:q.sourceSlot,constructionSha256:q.constructionSha256,intentSha256:'b'.repeat(64),temporaryQuoteRentLamports:q.temporaryQuoteRentLamports,quoteRentProofSha256:q.quoteRentProofSha256,constructionMs:1,observedRpcMs:10});assert.ok(plan);assert.equal(m.__independentFeeProbe(plan),(5000n+priority).toString());
 results.push({mint:q.mint,side,expectedOutputMatched:true,computeLimit:200000,computePriceMicroLamports:'10000',encodedPriorityFeeLamports:priority.toString(),declaredTotalFeeLamports:m.__independentFeeProbe(plan),instructionCount:q.instructionCount,quoteClosedByInstructions:q.accounts.quoteClosedByInstructions,signerAvailable:q.wallet.signerAvailable,networkRequests:q.networkRequests});
}
console.log(JSON.stringify({scope:'Temporary diagnostic export appended to a copy of the hash-verified standalone bundle, not deployable artifact or financial operation',nodeModulesPresent:false,syntheticAccountAndRentAssumptions:true,configurationMatched:true,actualSdkConstructions:results}));
