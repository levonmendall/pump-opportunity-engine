/** Actual native notification parsing over retained logs; no network or ledger. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {setup,scope} from './native-flow-fixture.js';
import {nativePaperSourceWorkAdmission} from '../src/run-native-paper.js';

test('healthy real native notifications survive recurring-financial reserve and entry physical headroom deferrals',async()=>{
 let informationOpen=true,used=12,knownFinancial=true;const information=()=>informationOpen,usage=()=>({chapter:1,newUnits:used,maximumNewUnits:1500,newAccountedResponseBytes:1000,maximumNewResponseBytes:256*1024*1024,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:80,rolling10SecondStarts:used},...(knownFinancial?{protectionRecovery:{rolling60SecondStarts:30,rolling10SecondStarts:5}}:{})}),work=(entryWork:boolean)=>nativePaperSourceWorkAdmission({informationOpen:information(),owned:true,entryWork,usage:usage(),persistent:true});
 const f=setup({informationAdmissionOpen:information}),socket=await f.open(),controls=f.operations.length,support=f.supportCalls.length;
 try{for(const headroom of [8,7,6,5,4,3]){used=20-headroom;assert.equal(work(true),false,'cold entry needs its seven reads and two associated contexts in addition to retained future holding reserve');assert.equal(work(false),headroom>=5,'one prospective call must leave the four-start emergency margin');const before=f.trades.length;f.notice(socket,{signature:bs58.encode(Buffer.alloc(64,headroom))});assert.ok(f.trades.length>before,'physical work refusal cannot invalidate already delivered executed information');assert.equal(f.flow.snapshot(scope.mint)?.hasQualityLoss,false);assert.equal(f.flow.snapshot(scope.mint)?.connected,true);}
 knownFinancial=false;used=12;assert.equal(work(true),false,'unknown financial history conservatively reserves the recurring minute demand');assert.equal(work(false),false);const beforeUnknown=f.trades.length;f.notice(socket,{signature:bs58.encode(Buffer.alloc(64,10))});assert.ok(f.trades.length>beforeUnknown,'even conservative unknown provider scheduling cannot close delivered notification capture');
 assert.equal(f.gaps.length,0);assert.equal(f.operations.length,controls,'capture does not require another physical control start');assert.equal(f.supportCalls.length,support,'capture does not acquire redundant support on a quota transition');
 informationOpen=false;assert.equal(work(true),false);const before=f.trades.length;f.notice(socket,{signature:bs58.encode(Buffer.alloc(64,9))});assert.equal(f.trades.length,before);assert.ok(f.gaps.some(gap=>gap.reason==='NATIVE_FLOW_INFORMATION_CUTOFF'));assert.equal(f.flow.snapshot(scope.mint)?.hasQualityLoss,true);
 }finally{await f.flow.stop();}
});

for(const cutoff of ['required-evidence','memory-resource'] as const)test(`genuine ${cutoff} cutoff still refuses a real native packet despite ample RPC allowance`,async()=>{
 let evidence=true,memory=true;const information=()=>evidence&&memory,f=setup({informationAdmissionOpen:information}),socket=await f.open();try{if(cutoff==='required-evidence')evidence=false;else memory=false;assert.equal(nativePaperSourceWorkAdmission({informationOpen:information(),owned:true,entryWork:true,usage:{chapter:1,newUnits:0,maximumNewUnits:1500,newAccountedResponseBytes:0,maximumNewResponseBytes:256*1024*1024,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:0,rolling10SecondStarts:0}},persistent:true}),false);f.notice(socket);assert.equal(f.trades.length,0);assert.ok(f.gaps.some(gap=>gap.reason==='NATIVE_FLOW_INFORMATION_CUTOFF'));assert.equal(f.flow.snapshot(scope.mint)?.hasQualityLoss,true);}finally{await f.flow.stop();}
});

test('operating launcher wires native capture to safety independently of source/RPC admission',()=>{
 const source=readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8'),capture=source.slice(source.indexOf('const sourceInformationAdmission='),source.indexOf('const sourceAdmission='));
 assert.match(source,/informationAdmissionOpen:sourceInformationAdmission/);assert.doesNotMatch(capture,/nativePaperManagementReserve|rolling|entryAllowed|candidateWorkWithExposureAllowed/);assert.match(capture,/serviceEvidenceHealthy/);assert.match(capture,/candidateAdmissionAllowed/);assert.match(capture,/stop\.request/);assert.match(source,/sourceAdmission=\(\)=>[^\n]*nativePaperSourceWorkAdmission/);
});
