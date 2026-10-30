/** Disposable OFFLINE DB benchmark. No financial authority or network adapters.
 * Measures duplicate persistence, NOT EC2 capacity or live trading outcomes. */
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {performance} from 'node:perf_hooks';
import Database from 'better-sqlite3';
import {PaperLedger} from '../src/ledger.js';import {NativePaper} from '../src/native-paper.js';import type {PilotMarket} from '../src/pilot-market.js';import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
const [baselineArg,outputArg]=process.argv.slice(2);if(!baselineArg||!outputArg)throw Error('baseline native-paper.ts and new evidence output required');
const baselinePath=resolve(baselineArg),output=resolve(outputArg),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex'),baselineHash=sha(readFileSync(baselinePath));
const Baseline=(await import(pathToFileURL(baselinePath).href)).NativePaper as typeof NativePaper;
const ticks=2000,repetitions=3,rows:any[]=[],start=Date.parse('2026-10-28T00:00:00Z');
for(let round=0;round<repetitions;round++)for(const [label,Constructor]of (round%2?[['repaired',NativePaper],['baseline',Baseline]]:[['baseline',Baseline],['repaired',NativePaper]]) as Array<[string,typeof NativePaper]>){
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-reconcile-write-')),path=join(directory,'fixture.sqlite');let at=start;
 const ledger=new PaperLedger(path,'poe-pilot-disposable-reconcile-benchmark'),price=()=>({at,microUsdPerSol:'100000000',source:'OFFLINE fixed USD; no trading performance'});ledger.initialize(price(),at);
 const market={context:async()=>({price:price(),marks:{}}),quote:async()=>null,executionQuote:async()=>null} as unknown as PilotMarket;
 const source={snapshot:()=>null,usage:()=>({dataContract:'OFFLINE-disposable-no-feed'})} as any;
 const bridge=new Constructor({ledger,market,source,binding:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},certificate:()=>null,record:()=>{},now:()=>at});
 const beforeDb=new Database(path,{readonly:true,fileMustExist:true}),initialDatabaseBytes=Number(beforeDb.pragma('page_count',{simple:true}))*Number(beforeDb.pragma('page_size',{simple:true}));beforeDb.close();
 const before=ledger.state(),began=performance.now(),cpu=process.cpuUsage();
 for(let i=0;i<ticks;i++){at+=2000;await bridge.protection();}
 const elapsedMs=performance.now()-began,used=process.cpuUsage(cpu),state=ledger.state(),liveBytes=['','-wal','-shm'].reduce((sum,suffix)=>sum+(existsSync(path+suffix)?statSync(path+suffix).size:0),0);ledger.close();
 const db=new Database(path,{readonly:true,fileMustExist:true});const census=db.prepare("SELECT (SELECT count(*) FROM actions) actions,(SELECT count(*) FROM journal) journal,(SELECT count(*) FROM journal WHERE kind='reconcile') reconciles,(SELECT sum(length(CAST(detail AS BLOB))) FROM journal WHERE kind='reconcile') reconcilePayloadBytes,(SELECT sum(length(CAST(id AS BLOB))+length(CAST(payload_hash AS BLOB))+length(CAST(result AS BLOB))) FROM actions) actionColumnBytes").get();if(db.pragma('quick_check',{simple:true})!=='ok')throw Error('fixture integrity failure');db.close();
 if(state.lamports!==before.lamports||state.realizedLamports!=='0'||state.executionCosts!=='0'||Object.keys(state.positions).length||Object.keys(state.pending).length||state.inceptionAt!==before.inceptionAt)throw Error('fixture financial parity failure');
 rows.push({round,label,ticks,simulatedCadenceMs:2000,elapsedMs,cpuMicros:used.user+used.system,actionsAdded:state.revision-before.revision,reconciled:bridge.trader.funnel.reconciled,liveDatabaseWalShmBytes:liveBytes,initialDatabaseBytes,settledDatabaseBytes:statSync(path).size,settledGrowthBytes:statSync(path).size-initialDatabaseBytes,census,financialParity:true});rmSync(directory,{recursive:true});
}
if(sha(readFileSync(baselinePath))!==baselineHash)throw Error('baseline source changed during benchmark');
writeFileSync(output,JSON.stringify({kind:'offline-disposable-reconciliation-write-benchmark-v1',baselineSourcePath:baselinePath,baselineSourceSha256:baselineHash,repairedSourceSha256:sha(readFileSync('src/native-paper.ts')),node:process.version,platform:process.platform,ticks,repetitions,method:'Flat hypothetical account, fixed synthetic USD, one actual NativePaper.protection call per 2s simulated step. Alternating paired runs, real SQLite WAL/FULL durability, no recorded market or network. Temporary fixture DBs removed after integrity/census.',rows},null,2)+'\n',{flag:'wx',mode:0o600});
