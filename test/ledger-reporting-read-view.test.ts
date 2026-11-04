import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {PaperLedger,hasLedgerReportingAuthentication,REPORTING_OPERATING_HISTORY_KEY,type Mark} from '../src/ledger.js';
import {buildPilotPortfolio,pilotReportingPoints,projectPilotFilledTrades,type PilotPortfolioInput} from '../src/pilot-reporting.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {PAPER_TEN_SOL_EPOCH_ID,PAPER_V3_TEN_SOL_EPOCH_ID} from '../src/paper-epoch.js';
import {prepareV3ReportingAccount,reportingFixturePrice} from './fixtures/reporting-v3-account.js';

const AT=Date.parse('2026-11-03T15:00:00Z'),MINT='11111111111111111111111111111111';
async function setup(t:TestContext){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-reporting-view-')),path=join(root,'finance.sqlite'),ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});await prepareV3ReportingAccount(ledger,join(root,'epoch-backups'),AT,MINT);
 const marks:Record<string,Mark>={[MINT]:{at:AT-500,pricedBaseUnits:'1000',netLamports:'470000000',evidence:'OFFLINE contemporaneous actual-size mark'}};
 ledger.reconcile('fixture-report-current',AT-100,reportingFixturePrice(AT-500),marks);
 const db=(ledger as unknown as {db:Database.Database}).db;
 const prefix=()=>JSON.stringify({state:db.prepare('SELECT * FROM financial_state').all(),actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),journal:db.prepare('SELECT * FROM journal ORDER BY revision').all()});
 return {root,path,ledger,db,marks,prefix};
}
function portfolio(f:Awaited<ReturnType<typeof setup>>,at=AT){
 const {ledger,marks}=f,state=ledger.state(),price=reportingFixturePrice(AT-500),projection=ledger.projection(at,price,marks),journal=ledger.exportJournal(50),actionResults=new Map<string,unknown>();
 for(const raw of journal){const row=raw as {kind:string;action_id:string};if(row.kind==='attempt')actionResults.set(row.action_id,ledger.actionResult(row.action_id));}
 let history=ledger.getOperatingReportingHistory();for(const point of pilotReportingPoints(history,{at,inceptionAt:state.inceptionAt,running:true,reconciled:true,tradingMicroUsd:'0',economicMicroUsd:null}))history=ledger.recordOperatingReportingPoint(point,at);
 const filledTradesProjection=projectPilotFilledTrades({at,state,journal,actionResults}),tradeCache=ledger.recordReportingTrades(filledTradesProjection.trades);
 const input:PilotPortfolioInput={authoritativeOperating:true,at,running:true,state,projection,price,marks,sourceValidUntil:AT+29000,history,journal,actionResults,tradeCache,filledTradesProjection,identity:{accountId:state.accountId,inceptionAt:new Date(state.inceptionAt).toISOString(),release:'a'.repeat(40),strategy:'liquidity-resilient-momentum-v3.1'},sequence:ledger.nextSnapshotSequence(),decisions:[],funnel:{discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:0},connected:true,warming:false,usefulProgressAt:state.daily.reconciledAt,blocker:'OFFLINE fixture',metrics:{eventLoopLagMs:0,processingLagMs:0,providerEvents:0,rpcRequests:0,rpcAvailable:true}};
 return {input,snapshot:buildPilotPortfolio(input)};
}

test('one V3 reporting view authenticates each epoch and each cached fill once and preserves every financial row',async t=>{
 const f=await setup(t),before=f.prefix(),queries:{sql:string;args:unknown[]}[]=[],prepare=f.db.prepare.bind(f.db);
 f.db.prepare=((sql:string)=>{const statement=prepare(sql),get=statement.get.bind(statement);statement.get=((...args:unknown[])=>{queries.push({sql,args});return get(...args);}) as typeof statement.get;return statement;}) as typeof f.db.prepare;
 const result=f.ledger.withReportingReadView(()=>{const first=f.ledger.state();assert.equal(f.ledger.state(),first);assert.throws(()=>{first.controls.reason='forged';},TypeError);const old=f.ledger.getOperatingReportingHistory();const result=portfolio(f);assert.equal(hasLedgerReportingAuthentication(old,first,'history'),false,'superseded history cannot claim current-view authentication');assert.equal(hasLedgerReportingAuthentication(result.input.history,first,'history'),true);assert.equal(f.ledger.getOperatingReportingHistory(),result.input.history);return result;});
 f.db.prepare=prepare;
 const anchors=queries.filter(q=>q.sql.includes('FROM actions a JOIN journal j ON j.action_id=a.id WHERE a.id=?'));
 assert.deepEqual(anchors.map(q=>q.args[0]).sort(),['epoch:'+PAPER_TEN_SOL_EPOCH_ID,'epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID].sort());
 assert.equal(queries.filter(q=>q.sql==='SELECT at,kind,detail FROM journal WHERE action_id=?').length,50,'overlapping recent/cache fills reuse exact already-authenticated evidence');
 assert.equal(f.prefix(),before);assert.equal(result.input.history.points.at(-1)!.at,AT);assert.equal(result.input.tradeCache!.trades.length,50);assert.ok(result.snapshot.trades.length>=20);assert.equal(result.input.projection.operatingCostsMicroUsd,null);assert.equal(result.snapshot.balances.economicPnlUsd,null,'unknown operating costs remain unknown');
 for(const [value,kind] of [[result.input.state,'state'],[result.input.history,'history'],[result.input.tradeCache,'trades']] as const)assert.equal(hasLedgerReportingAuthentication(value,result.input.state,kind),false,'authentication expires at publication boundary');
});

test('financial mutation, nested and asynchronous callbacks refuse before financial changes and leave the owner usable',async t=>{
 const f=await setup(t),before=f.prefix();let invoked=false;
 assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();f.ledger.reconcile('must-not-append',AT,reportingFixturePrice(AT),f.marks);}),/FINANCIAL_MUTATION_REFUSED/);
 assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();f.ledger.pause('must-not-pause',AT,'OFFLINE forbidden reporting mutation');}),/FINANCIAL_MUTATION_REFUSED/);
 assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();return f.ledger.withReportingReadView(()=>f.ledger.state());}),/SCOPE_NESTED/);
 assert.throws(()=>f.ledger.withReportingReadView(async()=>{invoked=true;}),/SYNCHRONOUS_REQUIRED/);assert.equal(invoked,false);
 assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();return Promise.resolve('not synchronous');}),/SYNCHRONOUS_REQUIRED/);
 assert.equal(f.prefix(),before);assert.doesNotThrow(()=>f.ledger.withReportingReadView(()=>portfolio(f)));
});

test('exact raw head change, including same-revision byte changes, invalidates the view before metadata write',async t=>{
 const f=await setup(t),original=(f.db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body;
 const before=f.db.prepare('SELECT * FROM metadata ORDER BY key').all();
 for(const changed of [JSON.stringify({...JSON.parse(original),revision:JSON.parse(original).revision+1}),JSON.stringify(JSON.parse(original),null,2)]){
  try{assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();f.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(changed);f.ledger.nextSnapshotSequence();}),/FINANCIAL_HEAD_CHANGED/);assert.deepEqual(f.db.prepare('SELECT * FROM metadata ORDER BY key').all(),before);}
  finally{f.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(original);}
 }
 assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();f.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(original+' ');return 'must-not-escape';}),/FINANCIAL_HEAD_CHANGED/);
 f.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(original);
});

test('new publication reauthenticates both epoch history and cached trade evidence after corruption',async t=>{
 const f=await setup(t);f.ledger.withReportingReadView(()=>portfolio(f));
 const id='epoch:'+PAPER_TEN_SOL_EPOCH_ID,anchor=f.db.prepare('SELECT payload_hash FROM actions WHERE id=?').get(id) as {payload_hash:string};
 f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),id);assert.throws(()=>f.ledger.withReportingReadView(()=>portfolio(f)),/EPOCH_HISTORY_UNAVAILABLE/);f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run(anchor.payload_hash,id);
 const fill=f.ledger.getReportingTrades().trades[0]!,row=f.db.prepare('SELECT result FROM actions WHERE id=?').get(fill.actionId) as {result:string};
 f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.result),status:'rejected'}),fill.actionId);assert.throws(()=>f.ledger.withReportingReadView(()=>portfolio(f)),/reporting trade durable evidence mismatch/);f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(row.result,fill.actionId);
 const history=f.db.prepare('SELECT value FROM metadata WHERE key=?').get(REPORTING_OPERATING_HISTORY_KEY) as {value:string},invalid=JSON.parse(history.value);invalid.points[0].tradingMicroUsd='1';
 f.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify(invalid),REPORTING_OPERATING_HISTORY_KEY);assert.throws(()=>f.ledger.withReportingReadView(()=>portfolio(f)),/operating reporting inception mismatch/);f.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(history.value,REPORTING_OPERATING_HISTORY_KEY);
 assert.doesNotThrow(()=>f.ledger.withReportingReadView(()=>portfolio(f)));
});

test('view never refreshes original price/mark/reconciliation clocks or accepts forged projection provenance',async t=>{
 const f=await setup(t),before=f.prefix();f.ledger.withReportingReadView(()=>{
  const {input}=portfolio(f),fresh=buildPilotPortfolio(input);assert.equal(fresh.status.reconciled,true);
  const stale=buildPilotPortfolio({...input,at:AT+3000,projection:f.ledger.projection(AT+3000,input.price!,f.marks)});assert.equal(stale.balances.equityUsd,null);assert.equal(stale.status.reconciled,false);assert.equal(stale.times.reconciledAt,fresh.times.reconciledAt);
  const forged=buildPilotPortfolio({...input,filledTradesProjection:{trades:[],unresolvedFilledRows:123456}});assert.doesNotMatch(forged.history.label,/123456/);assert.deepEqual(forged.trades,fresh.trades);
  assert.throws(()=>{input.filledTradesProjection!.unresolvedFilledRows=123;},TypeError);
  const attempt=f.ledger.exportJournal(50).find(row=>(row as {kind:string}).kind==='attempt') as {action_id:string;kind:string;detail:string};assert.ok(attempt);
  const journal=Object.freeze([attempt]),actionResults=new Map<string,unknown>([['unrelated-undefined',undefined]]),projected=projectPilotFilledTrades({...input,journal,actionResults});
  assert.equal(Object.isFrozen(attempt),true,'a shallow-frozen outer array cannot leave row data mutable');assert.throws(()=>{attempt.detail='{}';},TypeError);
  actionResults.delete('unrelated-undefined');actionResults.set(attempt.action_id,f.ledger.actionResult(attempt.action_id));
  const changed=buildPilotPortfolio({...input,journal,actionResults,filledTradesProjection:projected});assert.match(changed.history.label,/1 fills lack context/,'same-size Map changes cannot reuse prior undefined entries');
 });assert.equal(f.prefix(),before);
});
