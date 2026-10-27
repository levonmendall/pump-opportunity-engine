/** Offline proposal, filesystem-race and accounting checks. Never launches the
 * diagnostic child, reserves a live grant or contacts a provider. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,unlinkSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSchedulerForwardProposal,scanSchedulerForwardEvidence,schedulerForwardUsage,schedulerForwardChildArguments,SCHEDULER_FORWARD_LIMITS,SCHEDULER_FORWARD_PIN} from '../scripts/scheduler-forward-launcher.js';
const MIB=1024*1024,pid=12345,baseline={calls:163,bytes:3587908};
function fixture(t:TestContext){const path=mkdtempSync(join(tmpdir(),'poe-scheduler-launcher-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function book(path:string,phase:string,units:number,baseCalls=163,bodyBytes=100,pendingBytes=0,haltedReason:string|null=null){
  const directory=join(path,phase);try{mkdirSync(directory);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  writeFileSync(join(directory,'rpc-budget.json'),JSON.stringify({schemaVersion:1,baseline:{calls:baseCalls,bytes:baseline.bytes,refusal:'RPC_HTTP_429'},starts:Array.from({length:units},(_,i)=>1000+i*1000),httpBytes:bodyBytes,wsBytes:0,pending:pendingBytes?[{id:baseCalls+units,reservedBytes:pendingBytes}]:[],haltedReason}));
}

test('only exact owner-pinned proposal bytes with the approved ceilings pass',()=>{
  const path='evidence/scheduler-correction-20261027/forward-proposal.json',current=readFileSync(path),shown=spawnSync('git',['show',`${SCHEDULER_FORWARD_PIN}:${path}`],{maxBuffer:MIB});assert.equal(shown.status,0);
  const approved=validateSchedulerForwardProposal(shown.stdout,current);assert.equal(approved.existingRpcAllowanceAllocation.plannedMaximumUnits,73);
  assert.throws(()=>validateSchedulerForwardProposal(shown.stdout,Buffer.concat([current,Buffer.from('\n')])),/OWNER_PROPOSAL_CHANGED/);
  for(const [key,value] of [['newRequestUnitsCeiling',78],['plannedMaximumUnits',74],['newRelatedResponseByteCeiling',33*MIB]] as const){const p=JSON.parse(current.toString());p.existingRpcAllowanceAllocation[key]=value;const malformed=Buffer.from(JSON.stringify(p));assert.throws(()=>validateSchedulerForwardProposal(malformed,malformed),/PROPOSAL_REQUEST_LIMITS/);}
});

test('all phase atomic slots remain reserved and only exact writer temp disappearance is tolerated',t=>{
  const path=fixture(t);mkdirSync(join(path,'01-preflight'));writeFileSync(join(path,'authorization.json'),'auth');writeFileSync(join(path,'01-preflight','rpc-budget.json'),'stable');const temp=join(path,'01-preflight','rpc-budget.json.pending-'+pid);writeFileSync(temp,'atomic');
  const scan=scanSchedulerForwardEvidence(path,{writerPid:pid,beforeStat(file){if(file===temp)unlinkSync(file);}});
  assert.equal(scan.stableBytes,10);assert.equal(scan.vanishedAtomicFiles,1);assert.equal(scan.countedBytes,10+3*128*1024);assert.equal(scan.atomicTempHeadroomBytes,3*128*1024);
  const unknown=join(path,'01-preflight','rpc-budget.json.pending-'+(pid+1));writeFileSync(unknown,'other');assert.throws(()=>scanSchedulerForwardEvidence(path,{writerPid:pid,beforeStat(file){if(file===unknown)unlinkSync(file);}}),(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT');
});

test('stable evidence disappearance, unknown phase and symlinks fail closed',t=>{
  const path=fixture(t),stable=join(path,'baseline.json');writeFileSync(stable,'baseline');assert.throws(()=>scanSchedulerForwardEvidence(path,{writerPid:pid,beforeStat(file){if(file===stable)unlinkSync(file);}}),(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT');
  mkdirSync(join(path,'04-extra'));assert.throws(()=>scanSchedulerForwardEvidence(path,{writerPid:pid}),/UNKNOWN_PHASE_DIRECTORY/);rmSync(join(path,'04-extra'),{recursive:true});symlinkSync('/tmp',join(path,'01-preflight'));assert.throws(()=>scanSchedulerForwardEvidence(path,{writerPid:pid}),/EVIDENCE_SYMLINK/);
});

test('phase accounting counts only increments and retains uncertain reservations, without replaying old refusal',t=>{
  const path=fixture(t);book(path,'01-preflight',3,163);book(path,'02-combined',56,166);book(path,'03-audit',14,222,100,2*MIB);
  const usage=schedulerForwardUsage(path,baseline);assert.equal(usage.newUnits,73);assert.equal(usage.cumulativeUnits,236);assert.equal(usage.headroomUnitsRemaining,4);assert.equal(usage.observedBytes,300);assert.equal(usage.uncertainBytes,2*MIB);assert.equal(usage.cumulativeAccountedBytes,baseline.bytes+300+2*MIB);assert.equal(usage.firstProviderFailure,null);
  book(path,'03-audit',14,222,100,2*MIB,'COMPONENT_RPC_-32005');assert.equal(schedulerForwardUsage(path,baseline).firstProviderFailure,'COMPONENT_RPC_-32005');
});

test('absolute77-unit and32MiB-new/64MiB-cumulative limits stop before accepting an over-limit projection',t=>{
  const path=fixture(t);book(path,'01-preflight',3);book(path,'02-combined',60);book(path,'03-audit',14);assert.equal(schedulerForwardUsage(path,baseline).newUnits,77);book(path,'02-combined',61);assert.throws(()=>schedulerForwardUsage(path,baseline),/REQUEST_UNIT_CAP/);
  book(path,'02-combined',56,166,30*MIB);book(path,'01-preflight',3,163,0);book(path,'03-audit',14,222,0,2*MIB);assert.equal(schedulerForwardUsage(path,baseline).accountedBytes,32*MIB);
  book(path,'03-audit',14,222,1,2*MIB);assert.throws(()=>schedulerForwardUsage(path,baseline),/RELATED_BYTE_CAP/);book(path,'03-audit',14,222,0,0);assert.throws(()=>schedulerForwardUsage(path,{calls:163,bytes:40*MIB}),/COUNTER_BASELINE_CONFLICT|RELATED_BYTE_CAP/);
});

test('the child command is bounded without invoking a shell or launching a process',()=>{
  const args=schedulerForwardChildArguments('/workspace/pump-opportunity-engine/scripts/scheduler-forward.ts');assert.deepEqual(args.slice(0,4),['--cpu=20:21','--fsize=16777216:16777216','--nofile=64:64','--']);assert.ok(args.includes('--max-old-space-size=128'));assert.equal(args.at(-1),'--child');
  assert.equal(SCHEDULER_FORWARD_LIMITS.totalMs,120000);assert.equal(SCHEDULER_FORWARD_LIMITS.softStopMs,115000);assert.equal(SCHEDULER_FORWARD_LIMITS.rssBytes,256*MIB);assert.equal(SCHEDULER_FORWARD_LIMITS.newEvidenceBytes,6*MIB);assert.equal(SCHEDULER_FORWARD_LIMITS.allEvidenceBytes,32*MIB);
});
