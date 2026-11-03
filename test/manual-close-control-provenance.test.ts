import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PaperLedger,type LedgerState} from '../src/ledger.js';
import {isReviewedManualCloseControlRestoration as recognizes,
 REVIEWED_MANUAL_CLOSE_CONTROL_PROVENANCE as incident,type ManualCloseControlProvenanceInput} from '../src/manual-close-control-provenance.js';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
// Only the four original control rows used by the recognizer. These compact
// fields were retained in authenticated diagnostic41720510364; no market/raw
// success archive or live database is needed by this regression.
const anchorDetail='{"now":1793730051048,"price":{"microUsdPerSol":"93475000","at":1793730046013,"source":"Coinbase public SOL-USD spot; application receive time, not guaranteed oracle publication time"},"marks":{"hj4HMwUZ3XwuxNcmMmav7nzUjWWXp3TbkYydC5Mpump":{"netLamports":"537494625","pricedBaseUnits":"13492899","at":1793730050980,"evidence":"research-held-market:00f32ac7841026d8935d55a46aa041a2824235b53ae299071e886cfc26c2f5bd"}},"readiness":{"technicalProtectionRecovery":{"version":"paper-technical-protection-recovery-v1","authoritySha256":"85a73087945517f8b81a4cc50bfb224779bab87778c3e6f13c24bd9d7681ada1","originRevision":347862,"accountId":"poe-3123e352-4581-455b-85db-acd7e825e99e","inceptionAt":1793052456212,"stateRevision":347893,"controlChangedAt":1793729985745,"controlReason":"PAPER protection currently overdue; candidate admissions closed","positionUnits":{"hj4HMwUZ3XwuxNcmMmav7nzUjWWXp3TbkYydC5Mpump":"13492899"},"startedAt":1793729989388,"completedAt":1793730051048,"completedEvaluations":29,"maximumCompletedGapMs":3863,"lastQuoteAt":1793730050980},"version":"paper-operating-financial-readiness-v1","purpose":"financial-permission-only","evidence":"current original financial reconciliation, exact complete inventory and original verified bank Clock source; no candidate window, signal, entry price or order asserted","accountId":"poe-3123e352-4581-455b-85db-acd7e825e99e","stateRevision":347893,"reconciledAt":1793730051027,"positionUnits":{"hj4HMwUZ3XwuxNcmMmav7nzUjWWXp3TbkYydC5Mpump":"13492899"},"source":{"kind":"complete-held-liquidation-context","bankClockAt":1793730050000,"receivedAt":1793730050980,"validUntil":1793730080000},"recoveryComplete":true,"financialInventoryReady":true,"budgetAvailable":true}}';
const originalEpochJson="{\"version\":\"poe-paper-epoch-v3\",\"id\":\"poe-paper-10sol-v3-20261030\",\"priorEpoch\":{\"version\":\"poe-paper-epoch-v1\",\"id\":\"poe-paper-10sol-20261030\",\"startedAt\":1793374223584,\"transitionRevision\":93227,\"initialLamports\":\"10000000000\",\"initialMicroUsd\":\"948100000\",\"price\":{\"microUsdPerSol\":\"94810000\",\"at\":1793374221788,\"source\":\"coinbase-public-sol-usd\"},\"priorStateSha256\":\"8e68c062159124f597a20fd357ab12c52999d40ec6f31440fb0550650f0be288\",\"backupSha256\":\"49a0a6a543af94c04e3fff6d9ce88eb074978142ff3664aa929f192385170088\",\"priorRealizedLamports\":\"-616459874\",\"priorExecutionCostsLamports\":\"161000\",\"priorOperatingCostsMicroUsd\":null,\"capitalAdjustmentLamports\":\"654812218\",\"contributionLamports\":\"10000000000\",\"capitalArchivedLamports\":\"9345187782\",\"archivedAssets\":{\"cashLamports\":\"9321194942\",\"lockedDeposits\":{\"Fa24xN13pzjmcx1dtKP9nBMMFCwLtXCJrtP5hSPKpump\":\"3002280\",\"AcBX8a8eHbzQghgqMfqXeAz4kQSRbtHWKUSGXvwMpump\":\"3002280\",\"8TJ1uhidGn7PmzEtmftDUJkAxEcLpPNWqdvh42SZpump\":\"3002280\",\"8NTU6e46S8c8VD3uscMAgz8sQYjF2GofuZy4znQwpump\":\"3002280\",\"qoRXadwqYw98Qe2TmQPrMJZzYXYM2vyA5NrTFDcpump\":\"3002280\",\"CNtdYoJq9viwsj5eogkK45Bn9HjMyGKWpU6GB2dwpump\":\"3002280\",\"qi6wtTo9jZhkGcokNrjNNnBSjt12sUxgNyhWuUUpump\":\"3002280\",\"8r7gzXUXgqy4PaKfQ4bKUadUcVfZuFafMRJyJiEYpump\":\"2976880\"},\"totalLamports\":\"9345187782\",\"provenanceSha256\":\"2a99eef544389acae37197ae48246a84275abccedb172796e3818928780c8bb1\"}},\"startedAt\":1793387705083,\"transitionRevision\":104789,\"initialLamports\":\"10000000000\",\"initialMicroUsd\":\"941550000\",\"price\":{\"microUsdPerSol\":\"94155000\",\"at\":1793387703104,\"source\":\"coinbase-public-sol-usd\"},\"priorStateSha256\":\"749e1f8f0c2bfa0f6d79ecb99bfeeacc7965237652404e74147accbd5298938a\",\"backupSha256\":\"1d96ae92b8d4e0f7f1005e819357a03dcea2dea0aaf504c7fb4cb4a1c1aa927a\",\"priorRealizedLamports\":\"-1733277880\",\"priorExecutionCostsLamports\":\"245000\",\"priorOperatingCostsMicroUsd\":null,\"capitalAdjustmentLamports\":\"1116818006\",\"contributionLamports\":\"10000000000\",\"capitalArchivedLamports\":\"8883181994\",\"archivedAssets\":{\"cashLamports\":\"8874098954\",\"lockedDeposits\":{\"GWUen31GwoTPgyqkPxVP8oESyxRgFVo7PETuxkBpump\":\"1513840\",\"4qizrkdhWZBRMSm1BCs1m13Ju3YJxAu4mjbuSKjypump\":\"1513840\",\"2gTbp2gwH46rqExzabSyrdR3294SLwCp2rSqWDS6Sim1\":\"1513840\",\"CjRn9ZS9aPbsS4MPwjScJnKz56QeKVsyUtkenjcjohAX\":\"1513840\",\"JrvC7qKnGVn163q1u11VDUno7JtJ4ME2euiJkaupump\":\"1513840\",\"G2uncTSiChQgbAGou8Si56c8smihtXmFkUiQb4oepump\":\"1513840\"},\"totalLamports\":\"8883181994\",\"provenanceSha256\":\"8b1b31e83ac292b08bf03ff3f5ef7be4b33a94ae834a4386d487a335ce1b3ea4\"}}";
const pauseResult='{"paused":true,"pendingBuyCancellations":[]}';
function fixture():ManualCloseControlProvenanceInput{
 const anchor={revision:347894,at:1793730051048,kind:'resume',
  actionId:'native-paper-operating-financial-ready:347893:1793730051048',
  payloadHash:'e4894cf7d68adad2435c8324f706fbd873a04a03f94f2514db0b29d43c6bbfc4',
  detail:anchorDetail,result:'{"enabled":true,"reason":"explicit verified operating financial readiness"}'};
 const originalPause={revision:347982,at:1793730244591,kind:'pause',
  actionId:'trader:pause:347981:1793730244592',
  payloadHash:'52c6b533dfe1926c79d0878a874f493fd65e77e007d4b0b8e2ceac4b0edd5084',
  detail:'{"now":1793730244591,"reason":"PAPER protection currently overdue; candidate admissions closed"}',result:pauseResult};
 const previousControl={revision:348003,at:1793730308146,kind:'pause',
  actionId:'execution-recovery:poe-3123e352-4581-455b-85db-acd7e825e99e:348002',
  payloadHash:'5c621969ff2fbc7f78fdfcd873a1f049623ad483e177721da434adf3e6c2ff2f',
  detail:'{"now":1793730308146,"reason":"execution startup: fresh reconciliation/readiness required"}',result:pauseResult};
 const row={revision:348004,at:1793730308156,kind:'pause',
  actionId:'manual-hard:788f82d8b8a774f9d479574c8c1313ce7f5474faf1ed0c19866eb6c11ade77de',
  payloadHash:'85e112582e8f8bfe326b92344309d08b7dd9f7fb8b2833eb2f87071bc0b6f1f9',
  detail:'{"now":1793730308156,"reason":"PAPER protection currently overdue; candidate admissions closed"}',result:pauseResult};
 const state={accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,
  mode:'PAPER',revision:357305,lastAt:1793740750448,
  paperEpoch:JSON.parse(originalEpochJson)} as ManualCloseControlProvenanceInput['state'];
 return {state,anchor,originalPause,previousControl,row};
}

test('actual authenticated manual-close preservation is recognized without changing inputs or granting permission',()=>{
 const value=fixture(),before=structuredClone(value);
 assert.equal(recognizes(value),true);
 assert.deepEqual(value,before);
 assert.equal(incident.entryPermissionGranted,false);
 for(const [key,pin]of [['anchor',incident.anchor],['originalPause',incident.originalPause],
  ['previousControl',incident.startup],['row',incident.restoration]] as const){
  const row=value[key]!;
  assert.equal(sha(row.detail),pin.detailSha256);
  assert.equal(sha(row.result),pin.resultSha256);
  assert.equal(sha(JSON.stringify({kind:row.kind,payload:JSON.parse(row.detail)})),row.payloadHash);
 }
 assert.ok(Object.isFrozen(incident)&&Object.isFrozen(incident.restoration));
});

test('exact original authorization derives the sale order and manual preservation action',()=>{
 const p=incident;
 const order='manual-close:'+sha(JSON.stringify({scope:p.orderScope,authorizationId:p.authorizationId,
  accountId:p.accountId,inceptionAt:p.inceptionAt,epochId:p.epochId,mint:p.mint,roundTripId:p.roundTripId}));
 assert.equal(order,'manual-close:3df5c5ce81759852d3a18901cb2570809d59e066e727fc9e21dc58c8dbfd5a5f');
 assert.equal('manual-hard:'+sha(JSON.stringify({id:order,revision:348003})),fixture().row!.actionId);
 assert.notEqual('manual-hard:'+sha(JSON.stringify({id:order,revision:348004})),fixture().row!.actionId);
});

test('each original row requires its exact action, revision, time, kind, payload and result',()=>{
 for(const key of ['anchor','originalPause','previousControl','row'] as const){
  for(const field of ['revision','at','actionId','kind','detail','payloadHash','result'] as const){
   const original=fixture(),row=original[key]!;
   const changed={...row,[field]:typeof row[field]==='number'?Number(row[field])+1:String(row[field])+'-changed'};
   assert.equal(recognizes({...original,[key]:changed}),false,key+':'+field);
  }
  assert.equal(recognizes({...fixture(),[key]:undefined}),false,key+':absent');
 }
});

test('other account, epoch, mode or a state preceding the original row cannot use this recognition',()=>{
 const value=fixture();
 const badStates=[{...value.state,accountId:'other'},{...value.state,inceptionAt:value.state.inceptionAt+1},
  {...value.state,mode:'DISPOSABLE_PAPER' as const},{...value.state,revision:348003},
  {...value.state,lastAt:1793730308155},
  {...value.state,paperEpoch:{...value.state.paperEpoch!,id:'other'}},
  {...value.state,paperEpoch:{...value.state.paperEpoch!,transitionRevision:104790}},
  {...value.state,paperEpoch:{...value.state.paperEpoch!,startedAt:1793387705084}},
  {...value.state,paperEpoch:{...value.state.paperEpoch!,backupSha256:'0'.repeat(64)}},
  {...value.state,paperEpoch:{...value.state.paperEpoch!,priorEpoch:undefined}},
  {...value.state,paperEpoch:undefined}];
 for(const state of badStates)assert.equal(recognizes({...value,state} as ManualCloseControlProvenanceInput),false);
});

test('self-consistent owner, unknown, stop and other manual-hard records remain unrecognized',()=>{
 const value=fixture(),original=value.row!;
 const inputs=[
  {...original,actionId:'manual-hard:'+'0'.repeat(64)},
  {...original,actionId:'owner-pause'},
  {...original,actionId:'trader:restore-hard-pause:348003:1793730308156'},
  {...original,kind:'safe-stop',detail:JSON.stringify({now:original.at}),
   result:JSON.stringify({safeToExit:true,state:'stopped-safe',openPositions:0,uncertainActions:0,canceledEntries:[]})},
  {...original,detail:JSON.stringify({now:original.at,reason:'operator paused new entries'})},
  {...original,result:JSON.stringify({paused:true,pendingBuyCancellations:['buy:other']})},
 ];
 for(const row of inputs){
  row.payloadHash=sha(JSON.stringify({kind:row.kind,payload:JSON.parse(row.detail)}));
  assert.equal(recognizes({...value,row}),false);
 }
});

test('recognition cannot substitute a searched origin or an intervening control for the actual preceding startup',()=>{
 const value=fixture();
 const replacement={...value.previousControl!,revision:348002,
  actionId:'execution-recovery:'+incident.accountId+':348001'};
 assert.equal(recognizes({...value,previousControl:replacement}),false);
 assert.equal(recognizes({...value,previousControl:value.originalPause}),false);
 assert.equal(recognizes({...value,originalPause:{...value.originalPause!,revision:347983}}),false);
 assert.equal(recognizes({...value,previousControl:{...value.previousControl!,kind:'safe-stop',actionId:'owner-stop'}}),false);
});

test('unrelated rows are rejected before retained state or other control payloads are inspected',()=>{
 const value=fixture();
 const input={row:{...value.row!,actionId:'owner-pause'},
  get state():never{throw new Error('unrelated state read');},
  get anchor():never{throw new Error('unrelated anchor read');},
  get originalPause():never{throw new Error('unrelated origin read');},
  get previousControl():never{throw new Error('unrelated startup read');}};
 assert.equal(recognizes(input),false);
});

// In-memory fixture at the authenticated-history boundary. This test invokes
// the real authority loop but deliberately does not instantiate PaperLedger,
// open a database, acquire an owner lease or replay source history validation.
// Original source validation and export authenticity are separate evidence;
// each fixture's payload hash is also checked below before entering the loop.
const remainingCapturedControls = [
 {
  "revision": 347981,
  "actionId": "trader:pause:347980:1793730244184",
  "at": 1793730244183,
  "kind": "pause",
  "detail": "{\"now\":1793730244183,\"reason\":\"current equity or liquidation unavailable; entries closed\"}",
  "payloadHash": "3da596797e896ef8bd470a17764b0bd83b2479d23eaea3af7e4fc1826e58f9c7",
  "result": "{\"paused\":true,\"pendingBuyCancellations\":[]}"
 },
 {
  "revision": 348007,
  "actionId": "execution-recovery:poe-3123e352-4581-455b-85db-acd7e825e99e:348006",
  "at": 1793730311308,
  "kind": "pause",
  "detail": "{\"now\":1793730311308,\"reason\":\"execution startup: fresh reconciliation/readiness required\"}",
  "payloadHash": "a5a09c5fe3ca8a669735e6596b33ed3a894f33501361cacf3d2feef597a407f0",
  "result": "{\"paused\":true,\"pendingBuyCancellations\":[]}"
 },
 {
  "revision": 348008,
  "actionId": "trader:restore-hard-pause:348007:1793730311316",
  "at": 1793730311316,
  "kind": "pause",
  "detail": "{\"now\":1793730311316,\"reason\":\"PAPER protection currently overdue; candidate admissions closed\"}",
  "payloadHash": "b03c4676acbb8c17ffc7a3db1da745d730d76c77d4e13306def67b40a7b85cd4",
  "result": "{\"paused\":true,\"pendingBuyCancellations\":[]}"
 },
 {
  "revision": 349074,
  "actionId": "execution-recovery:poe-3123e352-4581-455b-85db-acd7e825e99e:349073",
  "at": 1793732431570,
  "kind": "pause",
  "detail": "{\"now\":1793732431570,\"reason\":\"execution startup: fresh reconciliation/readiness required\"}",
  "payloadHash": "3a5ab0d81b60b80850f2c466a7451d64229f56a9aec9df10dc3bfdd57b5ab297",
  "result": "{\"paused\":true,\"pendingBuyCancellations\":[]}"
 },
 {
  "revision": 349075,
  "actionId": "trader:restore-hard-pause:349074:1793732431578",
  "at": 1793732431578,
  "kind": "pause",
  "detail": "{\"now\":1793732431578,\"reason\":\"PAPER protection currently overdue; candidate admissions closed\"}",
  "payloadHash": "4d505e97ac5eb682c7d7d803ddd267c109025c9ff03468726a0db5a912a68e71",
  "result": "{\"paused\":true,\"pendingBuyCancellations\":[]}"
 }
];

test('real authority loop preserves the exact eight-row legacy lineage and retains intervening barriers',()=>{
 const original=fixture();
 const rows=[...structuredClone(remainingCapturedControls),original.originalPause!,original.previousControl!,original.row!]
  .sort((a,b)=>a.revision-b.revision);
 assert.deepEqual(rows.map(row=>row.revision),[347981,347982,348003,348004,348007,348008,349074,349075]);
 const state={...original.state,positions:{},pending:{},
  controls:{entriesEnabled:false,stopRequested:false,changedAt:1793732431578,
   readinessVersion:'paper-operating-financial-readiness-v1',
   reason:'PAPER protection currently overdue; candidate admissions closed'},
  daily:{day:'2026-11-03',baselineMicroUsd:'896104909',paused:true,lossPaused:false,reconciledAt:1793740750448}};
 const decode=(control:typeof rows[number])=>{
  const payload=JSON.parse(control.detail),result=JSON.parse(control.result);
  assert.equal(sha(JSON.stringify({kind:control.kind,payload})),control.payloadHash);
  assert.equal(payload.now,control.at);
  return {row:control,payload,result,ordinary:/^trader:pause:(\d+):(\d+)$/.test(control.actionId),
   restored:/^trader:restore-hard-pause:(\d+):(\d+)$/.test(control.actionId),
   startup:control.actionId===`execution-recovery:${state.accountId}:${control.revision-1}`};
 };
 const history={anchor:original.anchor!,decoded:rows.map(decode),controlPrefixSha256:'',reviewedPrefixSha256:'',
  reviewedCounts:{deniedResumes:0,pauseIntents:8,stopIntents:0}};
 const at=1793740751351;
 const evaluate=(h:typeof history)=>{
  // These are the only receiver capabilities. Any database/control/permission
  // call introduced into this read-only method fails rather than being mocked.
  const receiver={state:()=>state as LedgerState,operatingControlHistory:(s:LedgerState,time:number)=>{
   assert.equal(s,state);assert.equal(time,at);return h;
  }};
  const before=structuredClone({state,history:h});
  const result=PaperLedger.prototype.technicalProtectionRecoveryAuthority.call(receiver as unknown as PaperLedger,at);
  assert.deepEqual({state,history:h},before,'authority must not modify original inputs');
  assert.equal(state.controls.entriesEnabled,false,'authority is not an entry permission grant');
  return result;
 };
 const authority=evaluate(history);
 assert.equal(authority.verified,true,JSON.stringify(authority));
 if(!authority.verified)throw new Error('expected exact historical lineage recognition');
 assert.equal(authority.originRevision,347982);
 assert.equal(authority.controlChangedAt,1793732431578);
 assert.equal(authority.stateRevision,357305);
 const expectedBody={version:'technical-protection-control-authority-v1',accountId:state.accountId,inceptionAt:state.inceptionAt,
  anchor:{revision:original.anchor!.revision,actionId:original.anchor!.actionId,payloadHash:original.anchor!.payloadHash,
   resultSha256:sha(JSON.stringify(JSON.parse(original.anchor!.result)))},originRevision:347982,
  controlChangedAt:1793732431578,controlReason:state.controls.reason,
  intents:rows.map(row=>({revision:row.revision,actionId:row.actionId,at:row.at,kind:row.kind,payloadHash:row.payloadHash,
   resultSha256:sha(JSON.stringify(JSON.parse(row.result)))}))};
 const expectedSha256='6b8ed21c1dab09e5960578f810439cdcad48f7e6d85c07cfa91db162fc739ae8';
 assert.equal(sha(JSON.stringify(expectedBody)),expectedSha256,'all eight original rows remain in the independently fixed digest');
 assert.equal(authority.authoritySha256,expectedSha256);
 for(const barrier of ['owner','unknown','safe-stop'] as const){
  const kind=barrier==='safe-stop'?'safe-stop':'pause',time=1793730308145;
  const payload=kind==='safe-stop'?{now:time}:{now:time,reason:barrier==='owner'?'operator paused new entries':'unknown control reason'};
  const detail=JSON.stringify(payload),result=kind==='safe-stop'?JSON.stringify({safeToExit:true,state:'stopped-safe',openPositions:0,uncertainActions:0,canceledEntries:[]}):pauseResult;
  const inserted={revision:348001,at:time,kind,actionId:barrier==='unknown'?`trader:pause:348000:${time}`:'in-memory-'+barrier+'-barrier',
   detail,result,payloadHash:sha(JSON.stringify({kind,payload}))};
  const changed={...history,decoded:[...rows,inserted].sort((a,b)=>a.revision-b.revision).map(decode)};
  assert.deepEqual(changed.decoded.find(item=>item.row.revision===348004)!.row,original.row,'exact manual row remains present');
  assert.deepEqual(evaluate(changed),{verified:false,reason:barrier==='safe-stop'?'TECHNICAL_PROTECTION_STOP_INTENT_PRESENT':'TECHNICAL_PROTECTION_OWNER_OR_UNKNOWN_CONTROL'},barrier);
 }
});
