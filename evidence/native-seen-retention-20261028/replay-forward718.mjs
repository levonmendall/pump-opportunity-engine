/** Retained bookkeeping-only replay: original bytes/times, not new provider
 * behavior, reconstructed trade flow, qualification or a repaired live window. */
import {readFileSync,createReadStream,readdirSync} from 'node:fs';import {createInterface} from 'node:readline';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {dirname,join} from 'node:path';import {BorshCoder} from '@coral-xyz/anchor';
import {NativeTransactionRetention} from '../../src/native-transaction-retention.js';
const root=process.argv[2];if(!root)throw Error('RETAINED_SOURCE_DIRECTORY_REQUIRED');
const require=createRequire(import.meta.url),coder=new BorshCoder(JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')));
const receipt=JSON.parse(readFileSync(join(root,'receipt.json'))),c=new NativeTransactionRetention(16384),active=new Set(),poolMints=new Map(),probes=[],segments=[];let validated=0,duplicates=0,refusals=0,maxActive=0,maxRecords=0,sourceRows=0;
for(const name of readdirSync(join(root,'events')).filter(n=>/^events-\d+\.ndjson$/.test(n)).sort()){
 const file=join(root,'events',name),digest=createHash('sha256');let bytes=0,lines=0;const input=createReadStream(file);input.on('data',chunk=>{digest.update(chunk);bytes+=chunk.length;});
 for await(const line of createInterface({input,crlfDelay:Infinity})){lines++;sourceRows++;const e=JSON.parse(line),d=e.data;
  if(e.kind==='native-flow-subscription-ack'){active.add(d.mint);poolMints.set(d.pool,d.mint);continue;}
  if(e.kind==='native-candidate-retired'){active.delete(d.mint);c.releaseScope(d.mint);continue;}
  if(e.kind==='native-candidate-quality-gap'){if(d.reason!=='NATIVE_FLOW_TRANSACTION_CACHE_LIMIT'){active.delete(d.mint);c.releaseScope(d.mint);}continue;}
  if(e.kind==='native-flow-validated-events'){
   const n=d.notification;c.prune(n.availableAt);const prior=c.get(n.signature);const owners=new Set([n.subscriptionMint]);for(const packet of d.events??[]){const event=coder.events.decode(packet.eventBase64);if(!event)throw Error('RECORDED_EVENT_DECODE');const mint=poolMints.get(event.data.pool.toBase58());if(mint)owners.add(mint);}for(const effect of d.protocolEffects??[])owners.add(effect.mint);
   c.set(n.signature,{slot:n.slot,hash:n.rawHash,at:prior?.at??n.availableAt,mints:[...new Set([...(prior?.mints??[]),...owners])],scopes:[...new Set([...(prior?.scopes??[]),...active])],protocolFramesObserved:n.protocolFramesObserved??0});validated++;
  }else if(e.kind==='native-flow-notification'&&d.duplicate&&!d.correction){const prior=c.get(d.signature);if(prior&&!prior.mints.includes(d.subscriptionMint)&&prior.scopes.includes(d.subscriptionMint))prior.mints.push(d.subscriptionMint);duplicates++;
  }else if(e.kind==='native-flow-refusal'&&d.reason==='NATIVE_FLOW_TRANSACTION_CACHE_LIMIT'){
   refusals++;c.prune(d.availableAt);let result='ADMISSION_AVAILABLE';try{c.admit(d.signature,d.availableAt);}catch(error){result=error.message;}probes.push({at:d.availableAt,mint:d.subscriptionMint,signature:d.signature,slot:d.slot,rawHash:d.rawHash,originalRefusal:d.reason,repairedBookkeepingProbe:result,usage:c.usage(),reference:'events/'+name+':'+lines,meaning:'Admission-only probe on original refused metadata; no absent transaction content parsed, accepted or backdated'});
  }
  const usage=c.usage();maxActive=Math.max(maxActive,usage.activeRecords);maxRecords=Math.max(maxRecords,usage.records);
 }
 segments.push({path:'events/'+name,bytes,sha256:digest.digest('hex'),lines});
}
console.log(JSON.stringify({classification:'RETAINED_BOOKKEEPING_REPLAY_NOT_FORWARD_TRADING',source:receipt.source,runId:receipt.runId,sourceRows,segments,validatedPackets:validated,duplicatePackets:duplicates,originalCacheRefusals:refusals,repairedAdmissionProbes:probes,maximumActiveRecords:maxActive,maximumTotalRecords:maxRecords,finalUsage:c.usage(),limitations:['Retained successful parser outputs are reused only for ownership bookkeeping.','Original cache-refused packets are admission probes only; their actual event content and future corrected windows are not manufactured.','Original candidate retirements, data gaps and all failed forward results remain unchanged.','Historical response/notification delivery would not necessarily be identical with a revised runtime.']},null,2));
