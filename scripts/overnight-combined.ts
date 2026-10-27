/** Final bounded combined workload: complete selected flow + three hypothetical
 * liquidation marks, fixed2s schedule. Never a production account or trader. */
import {readFileSync,appendFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import {PUMP_AMM_SDK,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA} from '../src/sdk.js';
import {captureOvernightFields} from '../src/overnight-field.js';
import {runComponentLauncher} from './component-launcher.js';
const MIB=1024*1024;
async function child(){
 const out=process.env.POE_COMPONENT_OUT_DIR!,startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),leg=process.env.POE_OVERNIGHT_LEG!,baseline=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8'));
 const budget=new ComponentBudget({statePath:join(out,'rpc-budget.json'),grantId:'overnight-'+leg,baseline:baseline.baseline,startedAt,totalMs:baseline.maximumTotalMs,notBefore:baseline.providerNotBefore});
 let latest:ComponentSnapshot|null=null,retained=0,last=performance.now(),reason:string|null=null,result:any=null;const controller=new AbortController();
 const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,recordedAt:Date.now(),data})+'\n';retained+=Buffer.byteLength(line);if(retained>6*MIB)throw Error('COMPONENT_EVIDENCE_CAP');appendFileSync(join(out,'observations.ndjson'),line,{mode:0o600});if(kind==='research-clock-pool-state')latest=data as ComponentSnapshot;};
 const rpc=new ComponentTransport(budget,record,()=>{}),pricer=new ResearchClockPositionPricer(rpc,{record});
 const selected=JSON.parse(readFileSync('evidence/overnight-20261027/06-targeted/selected.json','utf8'));
 const holdings=[{mint:selected.mint,units:selected.baseUnits,minSlot:selected.minSlot}];
 for(const path of ['evidence/integration-proof-2026-10-26T23-32-41.255Z.json','evidence/integration-proof-2026-10-26T19-57-35.882Z.json']){const proof=JSON.parse(readFileSync(path,'utf8'));holdings.push({mint:proof.quote.mint,units:proof.quote.buy.outputBaseUnits,minSlot:proof.quote.slot});}
 const marks:any[]=[];
 const quote=async(signal:AbortSignal,floor:number)=>{
  const batch=await pricer.quoteMany(holdings.map(h=>({mint:new PublicKey(h.mint),fullBaseUnits:BigInt(h.units),minSlot:Math.max(h.minSlot,h.mint===selected.mint?floor:0)})),signal);
  if(!latest||!batch.context)throw Error('COMPONENT_COMBINED_NO_FRESH_CONTEXT');const snapshot:ComponentSnapshot=latest;
  for(const h of holdings){
   const q=batch.quotes[h.mint];if(!q){record('combined-held-unavailable',{mint:h.mint,unavailable:batch.unavailable});return null;}
   const raw=snapshot.value[snapshot.addresses.indexOf(q.pool)]!,pool=PUMP_AMM_SDK.decodePool({...raw,owner:new PublicKey(raw.owner),data:Buffer.from(raw.data[0],'base64')});
   const addresses=[q.pool,GLOBAL_CONFIG_PDA.toBase58(),PUMP_AMM_FEE_CONFIG_PDA.toBase58(),h.mint,NATIVE_MINT.toBase58(),pool.poolBaseTokenAccount.toBase58(),pool.poolQuoteTokenAccount.toBase58(),SYSVAR_CLOCK_PUBKEY.toBase58()];
   validateComponentParity({...snapshot,addresses,value:addresses.map(a=>snapshot.value[snapshot.addresses.indexOf(a)]??null)},h.mint,BigInt(h.units),q);
  }
  const usedAt=Date.now();for(const h of holdings){const q=batch.quotes[h.mint]!;if(usedAt-Date.parse(q.receivedAt)<0||usedAt-Date.parse(q.receivedAt)>2000||usedAt-q.marketClockUnixSeconds*1000<0||usedAt-q.marketClockUnixSeconds*1000>30000)throw Error('COMPONENT_COMBINED_STALE_AT_USE');}
  const row={usedAt,slot:batch.context.slot,unionAccounts:snapshot.addresses.length,holdings:holdings.map(h=>({mint:h.mint,units:h.units,quote:batch.quotes[h.mint],netAfterModeledGasLamports:(BigInt(batch.quotes[h.mint]!.sell.outputLamports)-7000n).toString()})),classification:'HYPOTHETICAL_HOLDINGS_ONLY'};marks.push(row);record('combined-three-holding-evaluation',row);return batch.quotes[selected.mint]!;
 };
 const stop=()=>controller.abort();process.on('SIGTERM',stop);const watcher=setInterval(()=>{const n=performance.now(),lag=Math.max(0,n-last-100);last=n;const rss=process.memoryUsage().rss;process.send?.({kind:'progress',stage:leg,rss,eventLoopLagMs:lag});if(rss>256*MIB||lag>500)stop();},100);
 const lease=openSync('/tmp/poe-pumpapi-probe.lock','a+',0o600);if(spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',lease]}).status!==0)throw Error('COMPONENT_PUMPAPI_ALREADY_OWNED');
 const pbPath='evidence/overnight-20261027/pumpapi-budget.json';let pb:any;
 try{
  if(budget.usage().remainingCumulativeUnits<67)throw Error('COMPONENT_COMBINED_REQUEST_RESERVE');
  const prewarm=await quote(controller.signal,selected.minSlot);if(!prewarm)throw Error('COMPONENT_COMBINED_HELD_PREFLIGHT_UNAVAILABLE');
  pb=JSON.parse(readFileSync(pbPath,'utf8'));if(pb.reservedBytes+64*MIB>256*MIB||pb.reservedMs+85000>300000)throw Error('COMPONENT_PUMPAPI_AGGREGATE_CAP');pb.reservedBytes+=64*MIB;pb.reservedMs+=85000;pb.attempts.push({leg,reservedAt:Date.now(),reservedBytes:64*MIB,reservedMs:85000,status:'reserved-before-network'});
  save();
  result=await captureOvernightFields({scope:{mint:selected.mint,pool:selected.pool,baseUnits:selected.baseUnits,minSlot:selected.minSlot,supportedPoolEvidence:selected.supportedPoolEvidence},budget,rpc,record,signal:controller.signal,observationMs:75000,protection:{everyMs:2000,quote}});
  writeFileSync(join(out,'capture.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 }catch(e){reason=e instanceof Error?e.message:'COMPONENT_COMBINED_UNAVAILABLE';record('combined-stop',{reason});}
 finally{
  stop();clearInterval(watcher);const until=Date.now()+1000;while(budget.inFlight&&Date.now()<until)await new Promise(r=>setTimeout(r,10));closeSync(lease);if(pb){Object.assign(pb.attempts.at(-1),{status:'completed-with-receipt',observedSocketBytes:result?.socketBytes??null,stopReason:result?.stopReason??reason});save();}
  const summary={outcome:result?.normalizedEvents>0?'COMBINED_RESEARCH_SAMPLE_CAPTURED':'COMBINED_SAMPLE_INCONCLUSIVE',reason,result:result?{...result,enrichmentTransactions:undefined,enrichmentHints:undefined,executedEvidence:undefined,featureRows:undefined}:null,heldEvaluations:marks.length,holdingCount:3,usage:budget.usage(),hypotheticalOnly:true,productionTouched:false,paperEntries:false,liveTrading:false,acceptanceClock:false};writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});process.send?.({kind:'final',summary});if(!budget.inFlight)budget.close();process.exitCode=reason?2:0;process.disconnect?.();
 }
 function save(){const fd=openSync(pbPath+'.pending','wx',0o600);writeFileSync(fd,JSON.stringify(pb,null,2)+'\n');fsyncSync(fd);closeSync(fd);renameSync(pbPath+'.pending',pbPath);const d=openSync(dirname(pbPath),'r');fsyncSync(d);closeSync(d);}
}
if(process.argv[2]==='--overnight-child')await child();else if(process.argv[2]==='run'&&process.argv[3])process.exitCode=(await runComponentLauncher(resolve(import.meta.filename),{leg:process.argv[3]})).exitCode;else console.log('No network; combined research requires the overnight grant.');
