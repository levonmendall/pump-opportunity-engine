/** Disposable CPU-only recognition regression. No provider or installed ledger. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger} from '../src/ledger.js';
import {PaperTrader,type TraderOptions} from '../src/trader.js';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
import {pilotCandidateAssessmentAdmission} from '../src/pilot.js';

const T=Date.parse('2026-10-28T02:54:50Z'),A='fixture-ready-A',B='fixture-pending-B';
const CLOSED=T+60000,READY=T+66769,PRIOR=T+53189;
type RecordRow={kind:string;data:any};
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-cpu-assessment-'));
 const ledger=new PaperLedger(join(directory,'fixture.sqlite'),'poe-pilot-cpu-assessment-fixture');
 let at=T,readinessHook:((mint:string,at:number)=>boolean)|null=null;
 const records:RecordRow[]=[],financialMutations:string[]=[],adapterCalls:string[]=[];
 const auditedThrough=new Map<string,number>(),pending=new Map<string,boolean>();
 ledger.initialize({microUsdPerSol:'100000000',at,source:'DISPOSABLE startup only'},at);
 const readonlyLedger=new Proxy(ledger,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;if(key==='state'||key==='hasTradedMint'||key==='projection')return value.bind(target);return (..._args:unknown[])=>{financialMutations.push(String(key));throw Error('DISPOSABLE forbidden financial method '+String(key));};}});
 const forbidden=async(name:string):Promise<never>=>{adapterCalls.push(name);throw Error('DISPOSABLE no network/quote adapter is permitted');};
 const ready=(mint:string,now:number)=>!pending.get(mint)&&(auditedThrough.get(mint)??0)>=Math.floor(now/10000)*10000;
 const options:TraderOptions={ledger:readonlyLedger,now:()=>at,candidateEvaluationOnly:true,predictiveDiagnostics:true,maximumCandidates:3,
  context:()=>forbidden('context'),quote:()=>forbidden('quote'),pilotExecution:{context:()=>forbidden('execution-context'),quote:()=>forbidden('execution-quote')},
  costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'DISPOSABLE immutable cost contract'},
  flowVerification:{verified:true,evidence:'DISPOSABLE confirmed complete field contract'},candidateReadiness:()=>false,
  predictiveReadiness:(mint,now)=>readinessHook?readinessHook(mint,now):ready(mint,now),
  experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},recorder:{record:(kind,data)=>records.push({kind,data})}};
 const trader=new PaperTrader(options);trader.start();
 for(const mint of [A,B]){assert.equal(trader.admit({mint,migrationAt:T-300000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE verified canonical identity'}),true);trader.activateFlow(mint,'DISPOSABLE continuous selected observation');pending.set(mint,false);}
 // Six confirmed synthetic buys per mint; collection remains continuous and
 // separate from calculation/verification availability.
 for(let i=0;i<6;i++)for(const[m,mint]of[A,B].entries()){at=T+i*10000+100+m;trader.ingest({identity:{signature:'fixture-cpu-'+mint+'-'+i,instructionIndex:0,eventIndex:0},mint,wallet:'fixture-'+mint+'-buyer-'+i,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*10000),receivedAt:at,commitment:'confirmed',slot:100+i},'curve');}
 const before=ledger.state(),financialFiles=()=>Object.fromEntries(['fixture.sqlite','fixture.sqlite-wal'].filter(name=>existsSync(join(directory,name))).map(name=>[name,readFileSync(join(directory,name))])),beforeBytes=financialFiles();
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 return {ledger,readonlyLedger,trader,options,records,adapterCalls,financialMutations,auditedThrough,
  setAt:(value:number)=>{at=value;},at:()=>at,ready,
  setPending:(mint:string,value:boolean)=>{pending.set(mint,value);trader.setCandidateInformationPending(mint,value);},
  setReadinessHook:(value:typeof readinessHook)=>{readinessHook=value;},
  assessments:(mint?:string)=>records.filter(r=>r.kind==='trader-predictive-assessment'&&(mint===undefined||r.data.mint===mint)).map(r=>r.data),
  decisions:(mint?:string)=>records.filter(r=>r.kind==='trader-decision'&&(mint===undefined||r.data.mint===mint)).map(r=>r.data),
  unchanged:()=>{assert.deepEqual(financialFiles(),beforeBytes,'SQLite database and financial WAL bytes remain unchanged');assert.deepEqual(ledger.state(),before);assert.equal(ledger.state().revision,before.revision);assert.deepEqual(adapterCalls,[]);assert.deepEqual(financialMutations,[]);assert.equal(trader.funnel.qualified,0);assert.equal(trader.funnel.reserved,0);assert.equal(trader.funnel.attempted,0);assert.equal(trader.funnel.paperFilled,0);assert.equal(trader.funnel.exited,0);}};
}
const admission=(overrides:Partial<Parameters<typeof pilotCandidateAssessmentAdmission>[0]>={})=>pilotCandidateAssessmentAdmission({candidateOnly:true,ready:true,at:READY,windowEndAt:CLOSED,lastEvaluatedAt:PRIOR,nextPhysicalLatestStartAt:null,...overrides});

test('CPU admission uses current verified closed-window deadlines, independently of physical RPC admission',()=>{
 assert.equal(admission().allowed,true);
 assert.equal(admission({nextPhysicalLatestStartAt:READY+25}).allowed,true);
 for(const change of [{candidateOnly:false},{ready:false},{windowEndAt:CLOSED-10000},{windowEndAt:CLOSED+10000},{windowEndAt:CLOSED+1},{lastEvaluatedAt:READY-1},{nextPhysicalLatestStartAt:READY+19},{nextPhysicalLatestStartAt:READY-1},{at:CLOSED+9981},{cpuBudgetMs:21,nextPhysicalLatestStartAt:READY+20}]){
  const result=admission(change);assert.equal(result.allowed,false,JSON.stringify(change));assert.equal(typeof result.reason,'string');assert.ok(result.reason.length>0);
 }
});

test('recorded 5jV timing shape assesses ready A before unrelated B enrichment, without network or financial work',async t=>{
 const f=fixture(t);f.setAt(PRIOR);await f.trader.tick({candidateMint:A});assert.equal(f.decisions(A).at(-1).reason,'warming');assert.equal(f.assessments().length,0);
 // A's audit is available at :56.767, then its own pending flag clears at
 // :56.769. B remains pending. Prior A evaluation was in the :40 bucket.
 f.auditedThrough.set(A,CLOSED);f.setAt(READY);f.setPending(A,false);f.setPending(B,true);
 const chosen=admission({ready:f.ready(A,f.at()),at:f.at(),nextPhysicalLatestStartAt:f.at()+100});assert.equal(chosen.allowed,true);
 const order:string[]=[];order.push('ready-CPU-dispatch');await f.trader.tick({candidateMint:A});order.push('unrelated-physical-work-may-now-start');
 assert.deepEqual(order,['ready-CPU-dispatch','unrelated-physical-work-may-now-start']);assert.equal(f.assessments(A).length,1);
 const a=f.assessments(A)[0]!;assert.equal(a.at,READY);assert.equal(a.features.asOf,READY);assert.equal(a.windowEndAt,CLOSED);assert.equal(a.status,'not-rejected');assert.equal(a.riskDecision.reason,'entries-not-authorized-by-ledger');
 assert.equal(f.decisions(A).at(-1).reason,'financial-execution-intentionally-disabled');assert.equal(f.assessments(B).length,0);assert.equal(f.decisions(B).length,0,'targeting A does not consume B primary bucket');
 await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,1,'same closed bucket stays coalesced');
 f.auditedThrough.set(B,CLOSED);f.setPending(B,false);await f.trader.tick({candidateMint:B});assert.equal(f.assessments(B).length,1,'B can still be assessed in its own unused bucket');f.unchanged();
});

test('own pending information, missing audit and gaps cannot become a CPU-ready assessment',async t=>{
 for(const condition of ['own-pending','unaudited','gap']){const f=fixture(t);f.setAt(READY);if(condition!=='unaudited')f.auditedThrough.set(A,CLOSED);if(condition==='own-pending')f.setPending(A,true);if(condition==='gap')f.trader.candidateGap(A,'DISPOSABLE missing required observation');
  const inputReady=condition!=='gap'&&f.ready(A,f.at());assert.equal(admission({ready:inputReady}).allowed,false,condition);await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,0,condition);f.unchanged();
  if(condition==='gap'){f.setPending(A,false);f.setAt(T+70001);f.auditedThrough.set(A,T+70000);await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,0,'pending false and later audit cannot restore interrupted flow');f.unchanged();}
 }
});

test('diagnostic availability crossing a bucket boundary cannot backdate a completed assessment',async t=>{
 const f=fixture(t);f.setAt(READY);f.auditedThrough.set(A,CLOSED);f.setReadinessHook(()=>{f.setAt(T+70000);return true;});assert.equal(admission().allowed,true);
 await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,0);f.unchanged();
 f.setReadinessHook(null);f.setAt(T+70001);assert.equal(f.ready(A,f.at()),false,'old audit is not current just because the clock advanced');assert.equal(admission({at:f.at(),windowEndAt:T+70000,ready:f.ready(A,f.at()),lastEvaluatedAt:READY}).allowed,false);
 f.auditedThrough.set(A,T+70000);await f.trader.tick({candidateMint:A});const a=f.assessments(A)[0]!;assert.equal(a.at,T+70001);assert.equal(a.windowEndAt,T+70000);f.unchanged();
});


test('own pending state or gap appearing during diagnostic readiness blocks information admission',async t=>{
 for(const condition of ['pending','gap']){const f=fixture(t);f.setAt(READY);f.auditedThrough.set(A,CLOSED);f.setReadinessHook(()=>{if(condition==='pending')f.setPending(A,true);else f.trader.candidateGap(A,'DISPOSABLE loss during CPU validation');return true;});
  assert.equal(admission().allowed,true,'admission estimate is not final information admission');await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,0,condition);f.unchanged();
 }
});

test('previously consumed unaudited bucket remains distinct from the recorded fresh-bucket controller defect',async t=>{
 const f=fixture(t);f.setAt(READY-1);await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,0);
 f.setAt(READY);f.auditedThrough.set(A,CLOSED);assert.equal(admission({lastEvaluatedAt:READY-1}).allowed,false,'existing primary bucket guard remains unchanged');await f.trader.tick({candidateMint:A});assert.equal(f.assessments(A).length,0,'this hypothetical cannot be claimed as newly recognized by the controller-only repair');f.unchanged();
});

test('CPU candidate-only mode refuses held exposure or unresolved financial actions rather than taking management ownership',t=>{
 const f=fixture(t);for(const field of ['positions','pending'] as const){const occupied=new Proxy(f.readonlyLedger,{get(target,key){if(key==='state')return()=>({...f.ledger.state(),[field]:{existing:{}}});return Reflect.get(target,key,target);}});const trader=new PaperTrader({...f.options,ledger:occupied});assert.throws(()=>trader.start(),/candidate-only mode requires closed financial permission and no unresolved exposure/);}
 assert.equal(admission({candidateOnly:false}).allowed,false,'the CPU-only scheduling path cannot authorize PAPER management or due actions');f.unchanged();
});
