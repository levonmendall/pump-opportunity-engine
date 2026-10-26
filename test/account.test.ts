import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,chmodSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PaperLedger,DisposableLedger,type UsdPrice,type RuntimeReadiness} from '../src/ledger.js';
import Database from 'better-sqlite3';
import {runAccountCommand} from '../src/account.js';

const AT=Date.parse('2026-10-26T12:00:00.000Z');
const price=(at:number, microUsdPerSol='100000000'):UsdPrice=>({at,microUsdPerSol,source:'disposable account test USD observation'});
const ready=(at:number):RuntimeReadiness=>({version:'fixture-runtime-reviewed',evidence:'fixture flow and recovery proof',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
const buy=(id:string,at:number,mint='fixture-token')=>({id,side:'buy' as const,mint,decidedAt:at,executeAt:at+500,expiresAt:at+2000,gas:'10000',deposit:'2000000',maxSpend:'480000000',minReceive:'1',decisionEvidence:'fixture decision'});
function setup(t:{after:(f:()=>void)=>void}) {
  const dir=mkdtempSync(join(tmpdir(),'poe-production-path-DISPOSABLE-'));chmodSync(dir,0o700);
  t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'paper.sqlite')};
}

test('production mode remains closed across reconciliation/restart and never reseeds',t=>{
  const {path}=setup(t);let ledger=new PaperLedger(path,'poe-disposable-production-test');
  ledger.initialize(price(AT),AT);const initial=ledger.state();
  assert.equal(initial.mode,'PAPER');assert.equal(initial.accountId,'poe-disposable-production-test');assert.equal(initial.fixtureId,undefined);
  assert.equal(initial.controls.entriesEnabled,false);assert.equal(initial.initialMicroUsd,'1000000000');assert.equal(initial.lamports,'10000000000');
  ledger.reconcile('initial',AT,price(AT),{});
  assert.equal(ledger.projection(AT,price(AT)).entriesEnabled,false);
  assert.ok('rejected' in ledger.order(buy('closed',AT),price(AT),{}));
  ledger.close();ledger=new PaperLedger(path,'poe-disposable-production-test');
  try {
    ledger.initialize({microUsdPerSol:'0',at:0,source:''},0); // Recovery does not depend on a new conversion.
    assert.equal(ledger.state().inceptionAt,AT);assert.equal(ledger.state().lamports,initial.lamports);
    assert.equal(ledger.state().controls.entriesEnabled,false);
  }finally{ledger.close();}
  assert.throws(()=>new DisposableLedger(path,'fixture-invalid-cross-mode'),/wrong fixture/);
  assert.throws(()=>new PaperLedger(path,'poe-other'),/wrong fixture/);
});

test('fresh runtime readiness resumes an admin pause but never clears a sticky day loss',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-controls-test');
  try {
    l.initialize(price(AT),AT);l.reconcile('initial',AT,price(AT),{});
    assert.throws(()=>l.resume('no-budget',AT,price(AT),{},{...ready(AT),budgetAvailable:false}),/readiness/);
    assert.throws(()=>l.resume('string-budget',AT,price(AT),{},{...ready(AT),budgetAvailable:'false' as unknown as boolean}),/readiness/);
    assert.throws(()=>l.pause('bad-reason',AT,true as unknown as string),/reason/);
    assert.equal(l.resume('resume',AT,price(AT),{},ready(AT)).enabled,true);
    assert.throws(()=>l.order({...buy('bad-amount',AT),gas:10000 as unknown as string},price(AT),{}),/integer amount/);
    l.pause('operator-pause',AT+1);assert.equal(l.state().controls.entriesEnabled,false);
    l.reconcile('fresh',AT+2,price(AT+2),{});
    assert.equal(l.resume('operator-resume',AT+2,price(AT+2),{},ready(AT+2)).enabled,true);
    l.reconcile('loss',AT+3,price(AT+3,'90000000'),{});
    l.reconcile('price-recovered',AT+4,price(AT+4),{});
    assert.equal(l.resume('loss-resume-denied',AT+4,price(AT+4),{},ready(AT+4)).enabled,false);
    assert.equal(l.state().daily.lossPaused,true);
    const tomorrow=Date.parse('2026-10-27T00:00:00.000Z');
    assert.equal(l.resume('before-next-day-reconcile',tomorrow,price(tomorrow),{},ready(tomorrow)).enabled,false);
    l.reconcile('next-day',tomorrow,price(tomorrow),{});
    assert.equal(l.resume('fresh-next-day',tomorrow,price(tomorrow),{},ready(tomorrow)).enabled,true);
  }finally{l.close();}
});

test('safe stop preserves open exposure and exit orders, cancels entries, and refuses safe exit',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-stop-test');
  try {
    l.initialize(price(AT),AT);l.reconcile('r',AT,price(AT),{});l.resume('enable',AT,price(AT),{},ready(AT));
    l.order(buy('entry',AT),price(AT),{});
    l.attempt('fill-entry','entry',AT+500,{at:AT+500,spendLamports:'470000000',receiveUnits:'1000',evidence:'fixture actual size'},price(AT+500));
    const now=AT+600;const marks={'fixture-token':{netLamports:'460000000',pricedBaseUnits:'1000',at:now,evidence:'fixture full liquidation'}};
    l.reconcile('held-r',now,price(now),marks);
    l.order(buy('next-entry',now,'second-token'),price(now),marks);
    l.order({id:'exit',side:'sell',mint:'fixture-token',decidedAt:now,executeAt:now+500,expiresAt:now+2000,gas:'10000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'fixture exit'},price(now),marks);
    const result=l.safeStop('stop',now+1);
    assert.equal(result.safeToExit,false);assert.equal(result.state,'management-required');
    assert.deepEqual(result.canceledEntries,['next-entry']);assert.equal(l.state().positions['fixture-token']!.units,'1000');
    assert.deepEqual(Object.keys(l.state().pending),['exit']);
    assert.equal(l.projection(now+1,price(now+1),marks).reservedLamports,'10000');
  }finally{l.close();}
});

test('foreign databases and non-durable production paths are refused without adding POE tables',t=>{
  const {path}=setup(t);const db=new Database(path);db.exec('CREATE TABLE unrelated_assets (id INTEGER PRIMARY KEY)');db.close();
  assert.throws(()=>new PaperLedger(path,'poe-refuse-foreign'),/foreign database/);
  const check=new Database(path,{readonly:true});try{assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),[{name:'unrelated_assets'}]);}finally{check.close();}
  assert.throws(()=>new PaperLedger(':memory:','poe-no-durability'),/durable/);
});

test('wrong-size liquidation marks stay unknown and cannot support reconciliation',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-mark-size-test');
  try{
    l.initialize(price(AT),AT);l.reconcile('r',AT,price(AT),{});l.resume('enable',AT,price(AT),{},ready(AT));
    l.order(buy('entry',AT),price(AT),{});l.attempt('fill','entry',AT+500,{at:AT+500,spendLamports:'470000000',receiveUnits:'1000',evidence:'fixture full buy'},price(AT+500));
    const wrong={'fixture-token':{netLamports:'460000000',pricedBaseUnits:'1',at:AT+600,evidence:'fixture partial quote'}};
    assert.throws(()=>l.reconcile('bad',AT+600,price(AT+600),wrong),/wrong-size/);
    assert.equal(l.projection(AT+600,price(AT+600),wrong).equityLamports,null);
    assert.equal(l.projection(AT+600,price(AT+600),wrong).entriesEnabled,false);
  }finally{l.close();}
});

test('startup entry cancellation leaves uncertainty on exits and does not request full stop',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-cancel-test');
  try {
    l.initialize(price(AT),AT);l.reconcile('r',AT,price(AT),{});l.resume('enable',AT,price(AT),{},ready(AT));
    l.order(buy('obsolete',AT),price(AT),{});
    assert.deepEqual(l.cancelEntryOrders('recovery-cancel',AT+10,'restart obsolete entry signal'),{canceledEntries:['obsolete'],preservedExitOrders:[]});
    assert.equal(l.projection(AT+10,price(AT+10)).reservedLamports,'0');
    assert.equal(l.state().controls.stopRequested,false);
  }finally{l.close();}
});

test('snapshot sequence survives restart and reporting counters never alter financial revision',t=>{
  const {path}=setup(t);let l=new PaperLedger(path,'poe-snapshot-test');
  l.initialize(price(AT),AT);const revision=l.state().revision;
  assert.equal(l.nextSnapshotSequence(),'1');assert.equal(l.nextSnapshotSequence(),'2');assert.equal(l.state().revision,revision);l.close();
  l=new PaperLedger(path,'poe-snapshot-test');
  try{assert.equal(l.nextSnapshotSequence(),'3');assert.equal(l.state().revision,revision);}finally{l.close();}
});

test('reporting history is bounded, preserves real gaps/inception, and survives SQLite backup',async t=>{
  const {dir,path}=setup(t);const l=new PaperLedger(path,'poe-history-test');
  l.initialize(price(AT),AT);const revision=l.state().revision;
  assert.deepEqual(l.getReportingHistory(),{points:[{at:AT,tradingMicroUsd:'0',economicMicroUsd:null}],windowLimited:false,downsampled:false});
  for(let i=0;i<1000;i++)l.recordReportingPoint({at:AT+i*1000,tradingMicroUsd:i===400?null:String(i),economicMicroUsd:null});
  const history=l.getReportingHistory();assert.equal(history.points.length,720);assert.equal(history.downsampled,true);assert.equal(history.windowLimited,false);
  assert.deepEqual(history.points[0],{at:AT,tradingMicroUsd:'0',economicMicroUsd:null});assert.equal(history.points.at(-1)!.at,AT+999000);
  for(const i of [399,400,401])assert.ok(history.points.some(p=>p.at===AT+i*1000));
  assert.equal(l.state().revision,revision);
  const last=history.points.at(-1)!;assert.deepEqual(l.recordReportingPoint(last),history);
  assert.throws(()=>l.recordReportingPoint({...last,tradingMicroUsd:'1'}),/conflict/);
  assert.throws(()=>l.recordReportingPoint({at:AT+1,tradingMicroUsd:'0',economicMicroUsd:null}),/regression/);
  const backup=join(dir,'history-backup.sqlite');await l.backup(backup);l.close();
  const restored=new PaperLedger(backup,'poe-history-test');
  try{assert.deepEqual(restored.getReportingHistory(),history);assert.equal(restored.state().revision,revision);}finally{restored.close();}
});

test('too many actual gap boundaries become an explicitly limited window, never invented points',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-history-window-test');
  try{
    l.initialize(price(AT),AT);
    for(let i=0;i<722;i++)l.recordReportingPoint({at:AT+i*1000,tradingMicroUsd:i%2?null:String(i),economicMicroUsd:null});
    const history=l.getReportingHistory();assert.equal(history.windowLimited,true);assert.equal(history.points.length,720);assert.equal(history.points[0]!.at,AT+2000);
    assert.ok(history.points.every(p=>(p.at-AT)%1000===0));
    assert.equal(history.points[0]!.tradingMicroUsd,'2');assert.equal(history.points[1]!.tradingMicroUsd,null);
  }finally{l.close();}
});

test('malformed first-attempt amounts still finalize a failure and count gas exactly once',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-malformed-attempt-test');
  try{
    l.initialize(price(AT),AT);l.reconcile('r',AT,price(AT),{});l.resume('enable',AT,price(AT),{},ready(AT));
    l.order(buy('entry',AT),price(AT),{});
    const result=l.attempt('malformed','entry',AT+500,{at:AT+500,spendLamports:123 as unknown as string,receiveUnits:'1000',evidence:'fixture malformed recorded quote'},price(AT+500));
    assert.equal(result.status,'failed');assert.equal(l.state().lamports,'9999990000');assert.equal(l.state().executionCosts,'10000');assert.equal(l.state().pending.entry,undefined);
    assert.throws(()=>l.attempt('later','entry',AT+600,{at:AT+600,spendLamports:'470000000',receiveUnits:'1000',evidence:'fixture later favorable quote'},price(AT+600)),/not pending/);
  }finally{l.close();}
});

test('held-position exits can consume the gas reserve while new entries cannot',t=>{
  const {path}=setup(t);let l=new PaperLedger(path,'poe-exit-gas-reserve-test');
  l.initialize(price(AT),AT,'9517990000');l.reconcile('r',AT,price(AT),{});l.resume('enable',AT,price(AT),{},ready(AT));
  l.order(buy('entry',AT),price(AT),{});
  l.attempt('fill','entry',AT+500,{at:AT+500,spendLamports:'480000000',receiveUnits:'1000',evidence:'fixture full buy'},price(AT+500));
  assert.equal(l.state().lamports,l.state().gasReserve);
  const exit=(id:string,at:number)=>({id,side:'sell' as const,mint:'fixture-token',decidedAt:at,executeAt:at+500,expiresAt:at+2000,gas:'10000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'fixture protection exit'});
  l.order(exit('first-exit',AT+600),price(AT+600),{});
  assert.equal(l.attempt('failed-exit','first-exit',AT+1100,null,price(AT+1100)).status,'failed');
  assert.equal(l.state().lamports,'9517980000');assert.equal(l.state().executionCosts,'20000');
  l.close();l=new PaperLedger(path,'poe-exit-gas-reserve-test');
  try{
    const now=AT+1200;const marks={'fixture-token':{netLamports:'490000000',pricedBaseUnits:'1000',at:now,evidence:'fixture actual size'}};
    l.reconcile('fresh-held',now,price(now),marks);
    assert.throws(()=>l.order(buy('new-risk',now,'second-token'),price(now),marks),/insufficient unreserved cash/);
    l.order(exit('later-protection-decision',now),price(now),marks);
    assert.equal(l.attempt('filled-exit','later-protection-decision',now+500,{at:now+500,spendLamports:'0',receiveUnits:'500000000',pricedBaseUnits:'1000',evidence:'fixture actual-size sell'},price(now+500)).status,'filled');
    assert.equal(l.state().lamports,'10017970000');assert.equal(l.state().executionCosts,'30000');assert.deepEqual(l.state().positions,{});
  }finally{l.close();}
});

test('semantically corrupt JSON in valid SQLite refuses recovery without reseeding or rewriting',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-semantic-corruption-test');
  l.initialize(price(AT),AT);l.reconcile('r',AT,price(AT),{});l.resume('enable',AT,price(AT),{},ready(AT));
  l.order(buy('entry',AT),price(AT),{});
  l.attempt('fill','entry',AT+500,{at:AT+500,spendLamports:'470000000',receiveUnits:'1000',evidence:'fixture full buy'},price(AT+500));
  const now=AT+600,marks={'fixture-token':{netLamports:'480000000',pricedBaseUnits:'1000',at:now,evidence:'fixture mark'}};
  l.reconcile('held-r',now,price(now),marks);l.order(buy('pending',now,'second-token'),price(now),marks);
  const original=l.state();l.close();
  const corruptions:((s:any)=>void)[]=[
    s=>{s.inceptionPrice.microUsdPerSol='0';},s=>{s.inceptionPrice.at=s.inceptionAt+1;},s=>{s.inceptionPrice.source={};},
    s=>{s.lockedDeposits['fixture-token']='-1';},s=>{s.positions['fixture-token'].mint='different-token';},
    s=>{s.positions['fixture-token'].costMicroUsd='malformed';},s=>{s.positions['fixture-token'].enteredAt=s.lastAt+1;},
    s=>{s.pending.pending.id='different-order';},s=>{s.pending.pending.side='unknown';},s=>{s.pending.pending.gas='0';},
    s=>{s.pending.pending.maxSpend='-1';},s=>{s.pending.pending.minReceive='0';},s=>{s.pending.pending.reserved='1';},
    s=>{s.pending.pending.expiresAt=s.pending.pending.executeAt;},s=>{s.daily.lossPaused=true;s.daily.paused=false;},
  ];
  for(const corrupt of corruptions){
    const bad=structuredClone(original);corrupt(bad);const encoded=JSON.stringify(bad);
    const db=new Database(path);db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(encoded);db.close();
    assert.throws(()=>new PaperLedger(path,'poe-semantic-corruption-test'));
    const preserved=new Database(path,{readonly:true});
    try{assert.equal((preserved.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body,encoded);}finally{preserved.close();}
  }
});

test('a missing financial singleton with existing history is recovery failure, never new inception',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-missing-state-test');l.initialize(price(AT),AT);l.close();
  const db=new Database(path);db.exec('DELETE FROM financial_state');db.close();
  assert.throws(()=>new PaperLedger(path,'poe-missing-state-test'),/missing.*never reseed/);
  const preserved=new Database(path,{readonly:true});
  try{
    assert.equal((preserved.prepare('SELECT count(*) n FROM financial_state').get() as {n:number}).n,0);
    assert.equal((preserved.prepare('SELECT count(*) n FROM journal').get() as {n:number}).n,1);
  }finally{preserved.close();}
});

test('projection distinguishes unknown USD, actual SOL balance, and passive SOL price effect',t=>{
  const {path}=setup(t);const l=new PaperLedger(path,'poe-projection-test');
  try {
    l.initialize(price(AT),AT);
    const unknown=l.projection(AT);assert.equal(unknown.equityLamports,'10000000000');assert.equal(unknown.equityMicroUsd,null);assert.equal(unknown.totalPnlMicroUsd,null);
    const changed=l.projection(AT+1,price(AT+1,'110000000'));
    assert.equal(changed.equityMicroUsd,'1100000000');assert.equal(changed.totalPnlLamports,'0');assert.equal(changed.totalPnlMicroUsd,'100000000');assert.equal(changed.solPriceEffectMicroUsd,'100000000');
    assert.equal(l.projection(AT+20000,price(AT)).equityMicroUsd,null);
  }finally{l.close();}
});

test('offline commands require explicit init and restore a consistent account without reseeding',async t=>{
  const {dir,path}=setup(t);const input=join(dir,'input.json');writeFileSync(input,JSON.stringify({price:price(AT)}),{mode:0o600});
  const args=['--db',path,'--account','poe-cli-disposable-test'];
  await assert.rejects(runAccountCommand(['status',...args],AT),/not found/);assert.equal(existsSync(path),false);
  const initial=await runAccountCommand(['init',...args,'--input',input],AT) as {cashLamports:string};assert.equal(initial.cashLamports,'10000000000');
  const status=await runAccountCommand(['status',...args],AT) as {entriesEnabled:boolean;equityMicroUsd:null};assert.equal(status.entriesEnabled,false);assert.equal(status.equityMicroUsd,null);
  await assert.rejects(runAccountCommand(['resume',...args,'--id','resume'],AT),/actual runtime readiness/);
  await runAccountCommand(['pause',...args,'--id','pause'],AT+1);
  const stop=await runAccountCommand(['safe-stop',...args,'--id','stop'],AT+2) as {safeToExit:boolean};assert.equal(stop.safeToExit,true);
  const backup=join(dir,'backup.sqlite');await runAccountCommand(['backup',...args,'--target',backup],AT+2);
  await assert.rejects(runAccountCommand(['backup',...args,'--target',backup],AT+2),/must not exist/);
  const restored=join(dir,'restored.sqlite');await runAccountCommand(['restore','--db',restored,'--account','poe-cli-disposable-test','--input',backup],AT+2);
  const l=new PaperLedger(restored,'poe-cli-disposable-test');try{assert.equal(l.state().inceptionAt,AT);assert.equal(l.state().lamports,initial.cashLamports);assert.equal(l.state().controls.entriesEnabled,false);}finally{l.close();}
  await assert.rejects(runAccountCommand(['restore','--db',restored,'--account','poe-cli-disposable-test','--input',backup],AT+2),/must not exist/);
});
test('compiled and TSX account CLIs dispatch through directory symlinks and preserve existing inception',async t=>{
  const {dir,path}=setup(t),project=fileURLToPath(new URL('../',import.meta.url));
  const build=mkdtempSync(join(project,'.poe-account-entrypoint-fixture-')),run=promisify(execFile);
  t.after(()=>rmSync(build,{recursive:true,force:true}));
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('POE_')||key==='CREDENTIALS_DIRECTORY')delete env[key];
  await run(process.execPath,['node_modules/typescript/bin/tsc','--outDir',join(build,'compiled'),'--noEmit','false'],{cwd:project,env,timeout:20_000,maxBuffer:128*1024});
  symlinkSync(join(build,'compiled'),join(build,'current'),'dir');symlinkSync(project,join(build,'source-current'),'dir');
  const direct=join(build,'compiled/src/account.js'),alias=join(build,'current/src/account.js');
  const imported=await run(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(direct).href)});process.stdout.write('imported');`,'-'],{cwd:project,env,timeout:5000,maxBuffer:128*1024});
  assert.equal(imported.stdout,'imported');assert.equal(imported.stderr,'');
  const missing=join(dir,'not-initialized.sqlite');
  await assert.rejects(run(process.execPath,[alias,'status','--db',missing,'--account','poe-cli-disposable-test'],{cwd:project,env,timeout:5000,maxBuffer:128*1024}),
    (error:unknown)=>{const e=error as Error&{code:number;stderr:string};return e.code===1&&/account database not found/.test(e.stderr);});
  assert.equal(existsSync(missing),false);
  const input=join(dir,'input.json');writeFileSync(input,JSON.stringify({price:price(AT)}),{mode:0o600});
  await runAccountCommand(['init','--db',path,'--account','poe-cli-disposable-test','--input',input],AT);
  const args=['status','--db',path,'--account','poe-cli-disposable-test'];
  for(const entry of [direct,alias]){
    const status=JSON.parse((await run(process.execPath,[entry,...args],{cwd:project,env,timeout:5000,maxBuffer:128*1024})).stdout);
    assert.equal(status.accountId,'poe-cli-disposable-test');assert.equal(status.inceptionAt,AT);
    assert.equal(status.cashLamports,'10000000000');assert.equal(status.entriesEnabled,false);assert.equal(status.liveTrading,false);
  }
  const tsx=JSON.parse((await run(process.execPath,['--import','tsx',join(build,'source-current/src/account.ts'),...args],{cwd:project,env,timeout:5000,maxBuffer:128*1024})).stdout);
  assert.equal(tsx.inceptionAt,AT);assert.equal(tsx.entriesEnabled,false);
  const stopped=JSON.parse((await run(process.execPath,[alias,'safe-stop','--db',path,'--account','poe-cli-disposable-test','--id','fixture-cli-stop'],{cwd:project,env,timeout:5000,maxBuffer:128*1024})).stdout);
  assert.equal(stopped.safeToExit,true);
  const ledger=new PaperLedger(path,'poe-cli-disposable-test');
  try{assert.equal(ledger.state().inceptionAt,AT);assert.equal(ledger.state().lamports,'10000000000');assert.equal(ledger.state().controls.entriesEnabled,false);}
  finally{ledger.close();}
});
