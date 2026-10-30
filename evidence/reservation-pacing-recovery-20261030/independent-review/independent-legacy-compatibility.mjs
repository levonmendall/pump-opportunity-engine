/** Independent OFFLINE compatibility probe. No service, provider, account or financial I/O. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComponentBudget,componentPacingBaselineStarts,componentKnownUninvokedReservations} from '/workspace/poe-reservation-quota-probe/src/component-budget.ts';
import {readResearchBaseline,createResearchBaselineCheckpoint} from '/workspace/poe-reservation-quota-probe/src/research-baseline.ts';
import {ComponentBudget as LegacyBudget} from './legacy69-component-budget.ts';
import {readResearchBaseline as legacyRead} from './legacy69-research-baseline.ts';

const MIB=1024*1024,dir=mkdtempSync(join(tmpdir(),'poe-independent-OFFLINE-compat-'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const old=join(dir,'old.json');let at=100000;
const limits={maxCumulativeUnits:null,maxCumulativeBytes:null,minSpacingMs:250,maxStartsPerMinute:90,maxStartsPer10s:20};
const reports=[];
try{
 writeFileSync(old,JSON.stringify({schemaVersion:1,calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[],blockedReason:'RPC_HTTP_429'}),{mode:0o600});
 const baseline=readResearchBaseline({paths:[old],now:at,physicalSettled:true}).baseline,path=join(dir,'proof.json');
 const opts={statePath:path,grantId:'independent-proof',baseline,startedAt:at,continuousAccounting:true,limits,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;}};
 const b=new ComponentBudget(opts);let invoked=0;
 await assert.rejects(b.operate({transport:'http',method:'getSlot'},async()=>{invoked++;},undefined,{admissionOpen:()=>b.usage().pending.length===0}),/ADMISSION_CLOSED/);
 await new Promise(r=>setImmediate(r));b.close();assert.equal(invoked,0);
 const protectedPaths=[old,path],protectedHashes=protectedPaths.map(hash);
 const current=readResearchBaseline({paths:protectedPaths,now:at,physicalSettled:true});
 const legacy=legacyRead({paths:protectedPaths,now:at,physicalSettled:true});
 const {knownUninvokedStarts,...currentCanonical}=current;
 assert.deepEqual(currentCanonical,legacy);assert.deepEqual(knownUninvokedStarts,[100000]);
 assert.equal(current.baseline.calls,2);assert.equal(current.pendingOperations,1);assert.equal(current.uncertainResponseBytes,2*MIB);
 reports.push({case:'actual deployed69 raw reader accepts new optional proof with byte-identical canonical baseline and cumulative accounting',pass:true});

 const copy=join(dir,'legacy-resume.json');copyFileSync(path,copy);
 const prior=new LegacyBudget({...opts,statePath:copy});
 try{assert.equal(prior.usage().cumulativeUnits,2);assert.equal(prior.usage().rolling10SecondStarts,1);assert.equal(prior.usage().pending.length,1);assert.equal(prior.usage().uncertainResponseBytes,2*MIB);assert.equal(JSON.parse(readFileSync(copy)).knownUninvokedReservations.length,1);}finally{prior.close();}
 reports.push({case:'actual deployed69 ComponentBudget can reopen a copy of a new raw book and conservatively retains its allocated start',pass:true});

 const nextPath=join(dir,'physical.json'),next=new ComponentBudget({...opts,statePath:nextPath,grantId:'independent-physical',baseline:current.baseline,knownUninvokedBaselineStarts:current.knownUninvokedStarts});
 try{await next.operate({transport:'http',method:'getSlot'},async op=>{invoked++;op.chargeHttp(2);op.completeResponse();});}finally{next.close();}
 const mixed=readResearchBaseline({paths:[...protectedPaths,nextPath],now:at,physicalSettled:true});
 assert.deepEqual(mixed.baseline.starts,[1000,100000,100000]);assert.deepEqual(mixed.knownUninvokedStarts,[100000]);
 assert.deepEqual(componentPacingBaselineStarts(mixed.baseline,mixed.knownUninvokedStarts),[1000,100000]);assert.equal(invoked,1);
 assert.deepEqual(legacyRead({paths:[...protectedPaths,nextPath],now:at,physicalSettled:true}).baseline,mixed.baseline);
 reports.push({case:'duplicate timestamps remove only the witnessed reservation, retaining the independently invoked physical start and exact canonical linkage',pass:true});

 const cp=createResearchBaselineCheckpoint({paths:[...protectedPaths,nextPath],now:at,physicalSettled:true,outputPath:join(dir,'checkpoint.json'),allowCumulativeBeyondLegacy:true,settlement:{inFlight:0,waitingOrOperating:false,physicalTransportsSettled:true}});
 const sealed=readResearchBaseline({paths:cp.baselinePaths,checkpointSha256:cp.sha256,now:at,physicalSettled:true});
 const legacySealed=legacyRead({paths:cp.baselinePaths,checkpointSha256:cp.sha256,now:at,physicalSettled:true});
 const {knownUninvokedStarts:sealedKnown,...sealedCanonical}=sealed;
 assert.deepEqual(sealedCanonical,legacySealed);assert.deepEqual(sealedKnown,[]);assert.equal(sealed.baseline.calls,3);assert.equal(sealed.pendingOperations,1);assert.equal(sealed.uncertainResponseBytes,2*MIB);assert.equal(sealed.observedBytes,2);assert.deepEqual(sealed.baseline.starts,[100000,100000]);
 assert.deepEqual(protectedPaths.map(hash),protectedHashes);
 reports.push({case:'actual deployed69 reader accepts sealed checkpoint with one proved omission, while the unknown legacy allocation and actual physical start remain retained',pass:true});

 const valid=JSON.parse(readFileSync(path,'utf8'));
 for(const mutate of [v=>v.actualInvocations.push({id:2,at:100000}),v=>v.knownUninvokedReservations[0].id=3,v=>v.pending[0].reservedBytes-=1,v=>v.knownUninvokedReservations.push({...v.knownUninvokedReservations[0]}),v=>v.knownUninvokedReservations[0].attestedAt=100001]){
  const raw=structuredClone(valid);mutate(raw);assert.deepEqual(componentKnownUninvokedReservations(raw),[]);
 }
 assert.deepEqual(componentPacingBaselineStarts({starts:[100000,100000]},[100000,100000,100000]),[100000,100000]);
 reports.push({case:'adversarial conflict, unknown ID, partial reserve, duplicate ID, impossible proof time and over-subtracted timestamp all fail conservative',pass:true});
 console.log(JSON.stringify({scope:'OFFLINE independent actual deployed69 modules, no provider or financial state',legacySource:'69aa1ef214a8c79524a25a8aca79299ccaad93dc',reports},null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
