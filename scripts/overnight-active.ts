/** Targeted current-migration preparation; no broad program history or trading. */
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {validateComponentParity,deriveComponentHypothetical,type ComponentSnapshot} from '../src/component-parity.js';
import {verifyMigration} from '../src/pool.js';
import type {ReadOnlyRpc} from '../src/network.js';
import {invokedCanonicalSolSwaps} from '../src/active-selection.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {auditPool} from './active-pumpapi-trial.js';
import type {ResearchRpc} from '../src/research-rpc.js';
import {runComponentLauncher} from './component-launcher.js';
async function child(){
 const out=process.env.POE_COMPONENT_OUT_DIR!,startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),leg=process.env.POE_OVERNIGHT_LEG!;
 const baseline=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8'));
 const budget=new ComponentBudget({statePath:join(out,'rpc-budget.json'),grantId:'overnight-'+leg,baseline:baseline.baseline,startedAt,notBefore:baseline.providerNotBefore});
 let latest:ComponentSnapshot|null=null,retained=0,reason:string|null=null,selected:any=null,auditResult:any=null,last=performance.now();const records:any[]=[],controller=new AbortController();
 const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,recordedAt:Date.now(),data})+'\n';retained+=Buffer.byteLength(line);if(retained>6*1024*1024)throw Error('COMPONENT_EVIDENCE_CAP');appendFileSync(join(out,'observations.ndjson'),line,{mode:0o600});if(kind==='research-clock-pool-state')latest=data as ComponentSnapshot;};
 const rpc=new ComponentTransport(budget,record,()=>{}),pricer=new ResearchClockPositionPricer(rpc,{record});
 const stop=()=>{controller.abort();};process.on('SIGTERM',stop);process.on('message',(m:any)=>{if(m?.kind==='stop')stop();});
 const watch=setInterval(()=>{const now=performance.now(),lag=Math.max(0,now-last-100);last=now;const rss=process.memoryUsage().rss;process.send?.({kind:'progress',stage:leg,rss,eventLoopLagMs:lag});if(rss>256*1024*1024||lag>500||Date.now()-startedAt>80000)stop();},100);
 try{
  if(leg.endsWith('-audit')){
   const subject=JSON.parse(readFileSync('evidence/overnight-20261027/06-targeted/selected.json','utf8')),capture=JSON.parse(readFileSync('evidence/overnight-20261027/07-field/capture.json','utf8'));
   const adapter={get calls(){return budget.calls;},get bytes(){return budget.bytes;},call:rpc.call.bind(rpc)};
   auditResult=await auditPool(subject,capture,adapter as unknown as ResearchRpc,record,controller.signal,{maxCalls:8,maxElapsedMs:25000});record('bounded-independent-audit',auditResult);selected={audit:auditResult};
  }else{
  const targeted=leg.endsWith('-targeted');
  const hints=targeted?JSON.parse(readFileSync('evidence/overnight-20261027/05-sampler/hints.json','utf8')).hints.map((h:any)=>({...h,observedAt:h.receivedAt,sourceRef:'evidence/overnight-20261027/05-sampler/observations.ndjson'})):JSON.parse(readFileSync('evidence/overnight-20261027/03-discovery/seeds.json','utf8')).seeds.slice(-3).reverse();
  for(const hint of hints){
   if(budget.newUnits>20)break;
   let origin:any=null;try{if(!targeted)origin=await verifyMigration(rpc as unknown as ReadOnlyRpc,new PublicKey(hint.mint),hint.signature,{record},controller.signal);record('verified-migration',{hint,origin});}catch(e){record('migration-verification-unavailable',{hint,reason:e instanceof Error?e.message:'UNKNOWN'});if(budget.usage().haltedReason)throw e;}
   const history=await rpc.call<any[]>('getSignaturesForAddress',[hint.pool,{limit:8,commitment:'confirmed'}],controller.signal);record('targeted-pool-history',{hint,availableAt:Date.now(),history});
   for(const row of history.filter(r=>r.err===null&&Number.isSafeInteger(r.blockTime)&&Date.now()-r.blockTime*1000<=30000&&r.blockTime*1000<=Date.now()).slice(0,3)){
    const availableFrom=Date.now(),tx=await rpc.call<any>('getTransaction',[row.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}],controller.signal),availableAt=Date.now();record('targeted-current-transaction',{signature:row.signature,requestedAt:availableFrom,availableAt,tx});
    if(!tx||tx.slot!==row.slot||tx.transaction?.signatures?.[0]!==row.signature)throw Error('COMPONENT_TARGETED_CONTEXT_MISMATCH');
    const count=invokedCanonicalSolSwaps(tx).filter(p=>p.pool===hint.pool&&p.mint===hint.mint).length;if(!count)continue;
    const mapped=mapConfirmedPumpSwapEvidence(tx,{mint:hint.mint,pool:hint.pool,signature:row.signature,providerReceivedAt:null,availableAt});
    if(mapped.length!==count||mapped.some(t=>!t.transferChecks.baseTransfer||!t.transferChecks.userQuoteTransfer))continue;
    if(Date.now()-tx.blockTime*1000>30000)continue;
    const quote=await pricer.quote({mint:new PublicKey(hint.mint),fullBaseUnits:BigInt(mapped[0]!.tokenUnits),minSlot:tx.slot},controller.signal);if(!latest)throw Error('COMPONENT_CAPTURE_MISSING');
    const state:ComponentSnapshot=latest,parity=validateComponentParity(state,hint.mint,BigInt(mapped[0]!.tokenUnits),quote),hypothetical=deriveComponentHypothetical(state,hint.mint);
    selected={...hint,origin,activityVerifiedAt:availableAt,verifiedSignature:row.signature,trades:mapped,minSlot:quote.slot,baseUnits:hypothetical.fullBaseUnits,hypothetical,quote,parity,supportedPoolEvidence:createHash('sha256').update(JSON.stringify(state)).digest('hex'),entryEligibility:'UNVERIFIED_RESEARCH_ONLY'};
    record('supported-active-research-subject',selected);writeFileSync(join(out,'selected.json'),JSON.stringify(selected,null,2)+'\n',{flag:'wx',mode:0o600});break;
   }
   if(selected)break;
  }
  if(!selected)reason='NO_CURRENT_SUPPORTED_SWAP_IN_BOUNDED_MIGRATION_SAMPLE';
  }
 }catch(e){reason=e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,110}$/.test(e.message)?e.message:'COMPONENT_SELECTION_UNAVAILABLE';record('selection-stopped',{reason});}
 finally{
  controller.abort();clearInterval(watch);const until=Date.now()+1000;while(budget.inFlight&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  const summary={outcome:leg.endsWith('-audit')?(auditResult?.complete?'BOUNDED_AUDIT_COMPLETE':'BOUNDED_AUDIT_INCOMPLETE'):(selected?'SUPPORTED_ACTIVE_SUBJECT_VERIFIED':'ACTIVE_PREPARATION_INCONCLUSIVE'),reason,selected,usage:budget.usage(),elapsedMs:Date.now()-startedAt,productionTouched:false,liveTrading:false,paperEntries:false};writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});process.send?.({kind:'final',summary});if(!budget.inFlight)budget.close();process.exitCode=selected?0:2;process.disconnect?.();
 }
}
if(process.argv[2]==='--overnight-child')await child();else if(process.argv[2]==='run'&&process.argv[3])process.exitCode=(await runComponentLauncher(resolve(import.meta.filename),{leg:process.argv[3]})).exitCode;else console.log('No network; overnight targeted preparation only.');
