/** OFFLINE synthetic account and real on-disk SQLite only. No operating
 * account path, provider, publisher, or permission is exercised. */
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type Database from 'better-sqlite3';
import {PaperLedger,REPORTING_OPERATING_HISTORY_KEY,type ReportingPoint} from '../src/ledger.js';
import {pilotReportingPoints,projectPilotFilledTrades} from '../src/pilot-reporting.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {prepareV3ReportingAccount,reportingFixturePrice,resumeReportingFixture} from './fixtures/reporting-v3-account.js';

const AT=Date.parse('2026-11-04T04:00:00Z');
async function setup(t:TestContext){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-incremental-reporting-')),ledger=new PaperLedger(join(root,'finance.sqlite'),POE_OPERATING_ACCOUNT.accountId);
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 await prepareV3ReportingAccount(ledger,join(root,'backups'),AT);ledger.reconcile('offline-incremental-current',AT-100,reportingFixturePrice(AT-500),{});
 const db=(ledger as unknown as {db:Database.Database}).db;
 const financial=()=>JSON.stringify({state:db.prepare('SELECT * FROM financial_state').all(),actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),journal:db.prepare('SELECT * FROM journal ORDER BY revision').all()});
 const metadata=(key:string)=>(db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as {value:string}|undefined)?.value;
 return {ledger,db,financial,metadata};
}
function observe(f:Awaited<ReturnType<typeof setup>>,at=AT){return f.ledger.withReportingReadView(()=>{
 const state=f.ledger.state(),journal=f.ledger.exportJournal(50),actionResults=new Map<string,unknown>();for(const raw of journal){const r=raw as {kind:string;action_id:string};if(r.kind==='attempt')actionResults.set(r.action_id,f.ledger.actionResult(r.action_id));}
 const projected=projectPilotFilledTrades({at,state,journal,actionResults});return {state,trades:f.ledger.recordReportingTrades(projected.trades),history:f.ledger.getOperatingReportingHistory()};
});}
function count<T>(f:Awaited<ReturnType<typeof setup>>,operation:()=>T){
 const db=f.db,prepare=db.prepare.bind(db),transaction=db.transaction.bind(db),queries:{sql:string;method:string}[]=[];let transactions=0;
 db.prepare=((sql:string)=>{const statement=prepare(sql);for(const method of ['get','all','run'] as const){const invoke=(statement[method] as Function).bind(statement);(statement as any)[method]=(...args:unknown[])=>{queries.push({sql,method});return invoke(...args);};}return statement;}) as typeof db.prepare;
 db.transaction=((fn:(...args:any[])=>any)=>{const tx=transaction(fn),wrapper=(...args:unknown[])=>{transactions++;return tx(...args);};for(const mode of ['immediate','deferred','exclusive'] as const)Object.defineProperty(wrapper,mode,{value:(...args:unknown[])=>{transactions++;return tx[mode](...args);}});return wrapper;}) as typeof db.transaction;
 try{return {result:operation(),queries,transactions};}finally{db.prepare=prepare;db.transaction=transaction;}
}
const historyWrites=(x:{queries:{sql:string;method:string}[]})=>x.queries.filter(q=>q.method==='run'&&q.sql==='INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').length;

test('720-point gap batch exactly preserves sequential retention and original timestamps with one durable write',async t=>{
 const f=await setup(t),financial=f.financial(),before=f.metadata(REPORTING_OPERATING_HISTORY_KEY)!,at=AT+20000;
 const points=pilotReportingPoints(f.ledger.getOperatingReportingHistory(),{at,inceptionAt:f.ledger.state().inceptionAt,running:true,reconciled:true,tradingMicroUsd:'123456',economicMicroUsd:null});assert.equal(points.length,2);
 const sequential=count(f,()=>f.ledger.withReportingReadView(()=>{f.ledger.state();let history=f.ledger.getOperatingReportingHistory();for(const point of points)history=f.ledger.recordOperatingReportingPoint(point,at);return history;}));
 const expected=f.metadata(REPORTING_OPERATING_HISTORY_KEY);assert.equal(historyWrites(sequential),2);
 f.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(before,REPORTING_OPERATING_HISTORY_KEY);
 const batch=count(f,()=>f.ledger.withReportingReadView(()=>{f.ledger.state();return f.ledger.recordOperatingReportingPoints(points,at);}));
 assert.equal(historyWrites(batch),1);assert.equal(batch.transactions,1);assert.equal(f.metadata(REPORTING_OPERATING_HISTORY_KEY),expected);assert.deepEqual(batch.result,sequential.result);assert.equal(batch.result.points.length,720);
 assert.ok(batch.result.points.some(p=>p.at===points[0]!.at&&p.tradingMicroUsd===null));assert.deepEqual(batch.result.points.at(-1),points.at(-1));assert.equal(f.financial(),financial);
 assert.equal(f.ledger.withReportingReadView(()=>{f.ledger.state();return f.ledger.recordOperatingReportingPoints([],at);}).points.at(-1)!.at,at);
});

test('batch conflict, chronology and backdating refuse atomically without damaging retained data',async t=>{
 const f=await setup(t),before=f.metadata(REPORTING_OPERATING_HISTORY_KEY),financial=f.financial();
 const invalid:ReportingPoint[][]=[
  [{at:AT,tradingMicroUsd:null,economicMicroUsd:null},{at:AT,tradingMicroUsd:'1',economicMicroUsd:null}],
  [{at:AT,tradingMicroUsd:null,economicMicroUsd:null},{at:AT-1,tradingMicroUsd:null,economicMicroUsd:null}],
  [{at:AT-1,tradingMicroUsd:'1',economicMicroUsd:null}],
  Array.from({length:4},()=>({at:AT,tradingMicroUsd:null,economicMicroUsd:null})),
 ];
 for(const points of invalid){assert.throws(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();f.ledger.recordOperatingReportingPoints(points,AT);}));assert.equal(f.metadata(REPORTING_OPERATING_HISTORY_KEY),before);assert.equal(f.financial(),financial);}
 assert.doesNotThrow(()=>f.ledger.withReportingReadView(()=>{f.ledger.state();f.ledger.recordOperatingReportingPoints([{at:AT,tradingMicroUsd:'0',economicMicroUsd:null}],AT);}));
});

test('successive no-fill reports reread every original authority row and reuse only exact immutable derivatives',async t=>{
 const f=await setup(t),financial=f.financial(),first=observe(f),evidence=(f.ledger as any).reportingTradeEvidence as Map<string,unknown>,entries=new Map(evidence);
 assert.equal(first.trades.trades.length,50);assert.equal(entries.size,50);
 const second=count(f,()=>observe(f,AT+1));
 assert.equal(second.transactions,0,'unchanged reporting trades never acquire a writer transaction');assert.equal(second.queries.filter(q=>q.sql.includes('SELECT j.action_id actionId,j.revision attemptRevision')).length,50,'original bytes are checked again even at unchanged financial revision');
 assert.equal(second.queries.filter(q=>q.sql.includes('FROM actions a JOIN journal j ON j.action_id=a.id WHERE a.id=?')).length,2,'current financial epoch anchors are still authenticated');
 assert.notEqual(second.result.state,first.state);assert.equal(second.result.trades,first.trades);assert.equal(second.result.history,first.history);assert.equal(f.financial(),financial);
 for(const [id,entry]of entries)assert.equal(evidence.get(id),entry);assert.equal(Object.isFrozen(second.result.trades.trades[0]),true);
 assert.equal(second.result.state.daily.reconciledAt,AT-100);assert.equal(second.result.history.points.at(-1)!.at,first.history.points.at(-1)!.at,'reuse never manufactures a new source observation');
});

test('same-head attempt, order and outcome tampering is reread and rejected; equivalent raw changes invalidate derived evidence',async t=>{
 const f=await setup(t),first=observe(f),trade=first.trades.trades[0]!,attempt=f.db.prepare('SELECT revision,detail FROM journal WHERE action_id=?').get(trade.actionId) as {revision:number;detail:string},payload=JSON.parse(attempt.detail),orderId='order:'+payload.orderId;
 const order=f.db.prepare('SELECT detail FROM journal WHERE action_id=?').get(orderId) as {detail:string},result=f.db.prepare('SELECT result FROM actions WHERE id=?').get(trade.actionId) as {result:string},head=f.db.prepare('SELECT body FROM financial_state').get();
 const cases=[{table:'journal',column:'detail',id:trade.actionId,original:attempt.detail,value:JSON.stringify({...payload,quote:{...payload.quote,receiveUnits:'999'}})},
  {table:'journal',column:'detail',id:orderId,original:order.detail,value:JSON.stringify({...JSON.parse(order.detail),input:{...JSON.parse(order.detail).input,gas:'999999'}})},
  {table:'actions',column:'result',id:trade.actionId,original:result.result,value:JSON.stringify({...JSON.parse(result.result),status:'rejected'})}];
 for(const c of cases){const key=c.table==='journal'?'action_id':'id';f.db.prepare(`UPDATE ${c.table} SET ${c.column}=? WHERE ${key}=?`).run(c.value,c.id);assert.throws(()=>observe(f),/durable evidence mismatch/);assert.deepEqual(f.db.prepare('SELECT body FROM financial_state').get(),head);f.db.prepare(`UPDATE ${c.table} SET ${c.column}=? WHERE ${key}=?`).run(c.original,c.id);assert.doesNotThrow(()=>observe(f));}
 const cache=(f.ledger as any).reportingTradeEvidence as Map<string,unknown>,before=cache.get(trade.actionId);
 f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(JSON.stringify(payload,null,2),trade.actionId);assert.doesNotThrow(()=>observe(f));assert.notEqual(cache.get(trade.actionId),before,'even semantically equal changed bytes are rederived');f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(attempt.detail,trade.actionId);
 const originalRevision=attempt.revision,newRevision=f.ledger.state().revision+1000,previous=cache.get(trade.actionId);
 f.db.prepare('UPDATE journal SET revision=? WHERE action_id=?').run(newRevision,trade.actionId);assert.doesNotThrow(()=>observe(f));assert.notEqual(cache.get(trade.actionId),previous,'a changed original row revision cannot reuse its earlier proof');f.db.prepare('UPDATE journal SET revision=? WHERE action_id=?').run(originalRevision,trade.actionId);
 f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({...JSON.parse(result.result),offlineIgnoredPadding:'x'.repeat(128*1024)}),trade.actionId);assert.doesNotThrow(()=>observe(f));assert.equal(cache.has(trade.actionId),false,'large unchanged-authority outcomes retain original semantics but never enter the bounded derivative cache');f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(result.result,trade.actionId);
 assert.doesNotThrow(()=>observe(f));
});

test('changed metadata and malformed bounded evidence cannot use old cache proof',async t=>{
 const f=await setup(t);observe(f);const before=f.metadata(REPORTING_OPERATING_HISTORY_KEY)!,history=JSON.parse(before);history.points[0].tradingMicroUsd='1';
 f.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify(history),REPORTING_OPERATING_HISTORY_KEY);assert.throws(()=>observe(f),/operating reporting inception mismatch/);f.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(before,REPORTING_OPERATING_HISTORY_KEY);
 const trades=f.metadata('reporting_trades')!,cache=JSON.parse(trades);cache.trades[0].quantity='999';f.db.prepare("UPDATE metadata SET value=? WHERE key='reporting_trades'").run(JSON.stringify(cache));assert.throws(()=>observe(f),/durable evidence mismatch/);f.db.prepare("UPDATE metadata SET value=? WHERE key='reporting_trades'").run(trades);
 const id=cache.trades[0].actionId,detail=(f.db.prepare('SELECT detail FROM journal WHERE action_id=?').get(id) as {detail:string}).detail;
 for(const invalid of ['{',JSON.stringify({padding:'x'.repeat(65537)})]){f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(invalid,id);assert.throws(()=>observe(f));}f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(detail,id);assert.doesNotThrow(()=>observe(f));
});

test('a real new fill refreshes the bounded cache while all earlier original clocks remain fixed',async t=>{
 const f=await setup(t),first=observe(f),beforeIds=first.trades.trades.map(x=>x.actionId),at=AT+1000;
 resumeReportingFixture(f.ledger,at);f.ledger.order({id:'offline-new-report-fill',mint:'OFFLINE-new-report-mint',side:'buy',decidedAt:at,executeAt:at+500,expiresAt:at+2500,gas:'7000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'OFFLINE current reporting mutation'},reportingFixturePrice(at),{});
 assert.equal(f.ledger.attempt('offline-new-report-attempt','offline-new-report-fill',at+500,{at:at+500,spendLamports:'1000000',receiveUnits:'100',evidence:'OFFLINE real fixture fill'},reportingFixturePrice(at+500)).status,'filled');
 const financial=f.financial(),oldMetadata=f.metadata('reporting_trades');
 f.db.exec("CREATE TEMP TRIGGER offline_report_write_refusal BEFORE UPDATE ON metadata WHEN NEW.key='reporting_trades' BEGIN SELECT RAISE(ABORT,'OFFLINE_REPORT_WRITE_REFUSED'); END");
 assert.throws(()=>observe(f,at+501),/OFFLINE_REPORT_WRITE_REFUSED/);assert.equal(f.metadata('reporting_trades'),oldMetadata);assert.equal(f.financial(),financial);assert.ok((f.ledger as any).reportingTradeEvidence.size<=50,'failed metadata commit cannot grow the private evidence cache');
 f.db.exec('DROP TRIGGER offline_report_write_refusal');
 const next=count(f,()=>observe(f,at+501));assert.equal(next.transactions,1);assert.equal(next.result.trades.trades.length,50);assert.equal(next.result.trades.trades[0]!.actionId,'offline-new-report-attempt');assert.equal(f.financial(),financial);
 const retained=next.result.trades.trades.slice(1);assert.equal(retained.length,49);for(const row of retained)assert.deepEqual(row,first.trades.trades.find(old=>old.actionId===row.actionId));assert.equal(beforeIds.includes(next.result.trades.trades[0]!.actionId),false);assert.equal((f.ledger as any).reportingTradeEvidence.size,50);
});
