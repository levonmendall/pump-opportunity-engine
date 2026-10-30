/** Offline captured-byte replay: no provider, wallet, financial account or feed. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {PublicKey} from '@solana/web3.js';
import {ReadOnlyRpc} from '../src/network.js';
import {RpcMarket} from '../src/rpc-market.js';
import {quotePositionSell,quotePositionsSell} from '../src/pool.js';
import {evaluateExit,PROVISIONAL_RULE} from '../src/strategy.js';
import type {Mark,Position} from '../src/ledger.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const RECORD='evidence/rpc-observation-comparison.ndjson',PROOF='evidence/integration-proof-2026-10-26T23-32-41.255Z.json';
const CAP=4*1024*1024,GAS=7000n;
export type RawAccount={data:[string,string];owner:string;lamports:number;executable:boolean};
export type CapturedSample={index:number;lane:string;requestedAt:number;receivedAt:number;availableAt:number;slot:number;addresses:string[];accounts:RawAccount[];blockTime:number|null;outputLamports:string|null;status:string};
export type CapturedTrace={mint:string;inputUnits:string;migrationSlot:number;samples:CapturedSample[];notificationCount:number;changedNotifications:number;recordSha256:string;proofSha256:string};
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
function distribution(values:number[]){
  const ordered=[...values].sort((a,b)=>a-b);assert.ok(ordered.length>0&&ordered.every(n=>Number.isFinite(n)&&n>=0));
  const percentile=(p:number)=>ordered[Math.min(ordered.length-1,Math.ceil(ordered.length*p)-1)]!;
  return {samples:ordered.length,p50:percentile(0.50),p95:percentile(0.95),p99:percentile(0.99),maximum:ordered.at(-1)!};
}
export function readCapturedTrace():CapturedTrace{
  const record=readFileSync(join(ROOT,RECORD)),proofBytes=readFileSync(join(ROOT,PROOF));assert.ok(record.length<=CAP);
  const proof=JSON.parse(proofBytes.toString()) as {origin:{slot:number;commitment:string;instructionVerified:boolean;creationCpiVerified:boolean};quote:{mint:string}};
  assert.equal(proof.origin.commitment,'confirmed');assert.ok(proof.origin.instructionVerified&&proof.origin.creationCpiVerified);
  const rows=record.toString().trimEnd().split('\n').map(s=>JSON.parse(s)) as {kind:string;receivedAt:string;data:Record<string,unknown>}[];
  const blobs=new Map<string,RawAccount>(),samples:CapturedSample[]=[];
  let inputUnits='',pending:Omit<CapturedSample,'index'|'availableAt'|'blockTime'|'outputLamports'|'status'>|undefined,notificationCount=0,changedNotifications=0;
  const previous=new Map<string,string>();
  for(const row of rows){
    if(row.kind==='probe-configuration'){assert.equal(row.data.mint,proof.quote.mint);inputUnits=String(row.data.comparisonInputBaseUnits);}
    if(row.kind==='account-blob'){
      const account=row.data.account as RawAccount,hash=String(row.data.hash);assert.equal(sha(JSON.stringify(account)),hash);blobs.set(hash,account);
    }
    if(row.kind==='coherent-account-batch'){
      assert.equal(pending,undefined);const d=row.data as unknown as {lane:string;requestedAt:number;receivedAt:number;slot:number;addresses:string[];hashes:string[]};
      assert.equal(d.addresses.length,7);assert.equal(d.hashes.length,7);
      const accounts=d.hashes.map(hash=>{const a=blobs.get(hash);assert.ok(a,'account bytes must have appeared before batch in record');return structuredClone(a);});
      pending={lane:d.lane,requestedAt:d.requestedAt,receivedAt:d.receivedAt,slot:d.slot,addresses:[...d.addresses],accounts};
      for(let i=0;i<7;i++)previous.set(d.addresses[i]!,d.hashes[i]!);
    }
    if(row.kind==='quote-attempt'&&pending){
      assert.equal(row.data.lane,pending.lane);const at=Number(row.data.at),availableAt=Math.max(at,Date.parse(row.receivedAt));
      assert.ok(pending.requestedAt<=pending.receivedAt&&pending.receivedAt<=availableAt);
      if(samples.length)assert.ok(availableAt>=samples.at(-1)!.availableAt);
      samples.push({...pending,index:samples.length,availableAt,blockTime:row.data.marketBlockTime===null?null:Number(row.data.marketBlockTime),outputLamports:row.data.outputLamports===null?null:String(row.data.outputLamports),status:String(row.data.status)});pending=undefined;
    }
    if(row.kind==='account-notification'){
      notificationCount++;const address=String(row.data.address),hash=String(row.data.hash);if(previous.get(address)!==hash)changedNotifications++;previous.set(address,hash);
    }
  }
  assert.equal(pending,undefined);assert.ok(samples.length>1&&/^[1-9][0-9]*$/.test(inputUnits));
  return {mint:proof.quote.mint,inputUnits,migrationSlot:proof.origin.slot,samples,notificationCount,changedNotifications,recordSha256:sha(record),proofSha256:sha(proofBytes)};
}

/** Known RPC completion times are injected, never measured as network latency.
 * Each replay result is exposed only at the original quote-completion record.
 * Full batch receive time remains the mark time; it is never refreshed to now. */
export function capturedRpc(sample:CapturedSample,clock:{at:number}){
  const methods:string[]=[];
  const rpc=new ReadOnlyRpc('https://offline-fixture.invalid',async(_url,init)=>{
    const b=JSON.parse(String(init?.body)) as {id:number;method:string;params:unknown[]};methods.push(b.method);let result:unknown;
    if(b.method==='getMultipleAccounts'){
      const addresses=b.params[0] as string[];
      if(addresses.length===1){clock.at=sample.requestedAt;assert.equal(addresses[0],sample.addresses[0]);result={context:{slot:sample.slot},value:[sample.accounts[0]]};}
      else{clock.at=sample.receivedAt;assert.deepEqual(addresses,sample.addresses);result={context:{slot:sample.slot},value:sample.accounts};}
    }else if(b.method==='getBlockTime'){clock.at=sample.availableAt;result=sample.blockTime;}
    else throw new Error('offline replay method outside captured evidence');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
  },{profile:'runtime',monotonicNow:()=>0});
  return {rpc,methods};
}
export function hypotheticalPosition(trace:CapturedTrace,enteredAt:number,entryCostLamports:string):Position{
  assert.ok(BigInt(entryCostLamports)>GAS);return {mint:trace.mint,units:trace.inputUnits,enteredAt,entryLamports:String(BigInt(entryCostLamports)-GAS),entryGas:String(GAS),costMicroUsd:'0',deposit:'0'};
}
type QuoteRow={index:number;lane:string;availableAt:number;sourceReceivedAt:number;slot:number;pricedBaseUnits:string;grossLamports:string|null;baselineNetLamports:string|null;adapterNetLamports:string|null;batchNetLamports:string|null;sourceStatus:string;baselineCalls:number;adapterCalls:number;batchCalls:number};
async function reprice(trace:CapturedTrace):Promise<QuoteRow[]>{
  const rows:QuoteRow[]=[];
  for(const sample of trace.samples){
    const originalNow=Date.now,clock={at:sample.requestedAt-1};Date.now=()=>clock.at;
    const base=capturedRpc(sample,clock),adapter=capturedRpc(sample,clock),batch=capturedRpc(sample,clock);
    const market=new RpcMarket({rpc:adapter.rpc,now:()=>clock.at,recorder:{record(){}},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'SYNTHETIC gas assumption; not an observed charge'}});
    market.registerPool({mint:trace.mint,migrationSlot:trace.migrationSlot,migrationVerified:true,evidence:'retained confirmed migration proof; offline replay'});
    let gross:string|null=null,baseline:Mark|null=null;
    try{
      try{const quote=await quotePositionSell(base.rpc,new PublicKey(trace.mint),BigInt(trace.inputUnits),{record(){}},trace.migrationSlot);gross=quote.sell.outputLamports;assert.equal(gross,sample.outputLamports);assert.equal(Date.parse(quote.receivedAt),sample.receivedAt);assert.equal(clock.at,sample.availableAt);if(BigInt(gross)>GAS)baseline={netLamports:String(BigInt(gross)-GAS),pricedBaseUnits:trace.inputUnits,at:sample.receivedAt,evidence:'same captured coherent batch; SDK baseline'};}catch(error){if(sample.outputLamports!==null)throw error;}
      clock.at=sample.requestedAt-1;const p=hypotheticalPosition(trace,sample.availableAt-1000,'1000000');
      const context=await market.context({[p.mint]:p},new AbortController().signal),mark=context.marks[p.mint]??null;
      if(mark){assert.equal(mark.pricedBaseUnits,trace.inputUnits);assert.equal(mark.at,sample.receivedAt);assert.equal(clock.at,sample.availableAt);}
      assert.equal(mark?.netLamports??null,baseline?.netLamports??null);
      clock.at=sample.requestedAt-1;let batchNet:string|null=null;
      try{
        const output=await quotePositionsSell(batch.rpc,[{mint:new PublicKey(trace.mint),fullBaseUnits:BigInt(trace.inputUnits),minSlot:trace.migrationSlot}],{record(){}}),quote=output.quotes[trace.mint];
        assert.ok(quote);assert.deepEqual(output.unavailable,{});assert.equal(quote.sell.outputLamports,gross);assert.equal(Date.parse(quote.receivedAt),sample.receivedAt);assert.equal(clock.at,sample.availableAt);
        if(BigInt(quote.sell.outputLamports)>GAS)batchNet=String(BigInt(quote.sell.outputLamports)-GAS);
      }catch(error){if(sample.outputLamports!==null)throw error;}
      assert.equal(batchNet,baseline?.netLamports??null);
      rows.push({index:sample.index,lane:sample.lane,availableAt:sample.availableAt,sourceReceivedAt:sample.receivedAt,slot:sample.slot,pricedBaseUnits:trace.inputUnits,grossLamports:gross,baselineNetLamports:baseline?.netLamports??null,adapterNetLamports:mark?.netLamports??null,batchNetLamports:batchNet,sourceStatus:sample.status,baselineCalls:base.rpc.calls,adapterCalls:adapter.rpc.calls,batchCalls:batch.rpc.calls});
    }finally{Date.now=originalNow;}
  }
  return rows;
}
function recognize(rows:QuoteRow[],entryCost:string,enteredAt:number,path:'baseline'|'adapter'|'batch'){
  return rows.map(row=>{
    const net=path==='baseline'?row.baselineNetLamports:path==='adapter'?row.adapterNetLamports:row.batchNetLamports;
    const mark=net===null?null:{netLamports:net,pricedBaseUnits:row.pricedBaseUnits,at:row.sourceReceivedAt,evidence:'retained batch; no notification pricing'};
    return {index:row.index,availableAt:row.availableAt,executableQuoteAvailable:mark!==null&&row.availableAt-row.sourceReceivedAt<=PROVISIONAL_RULE.maximumQuoteAgeMs,decision:evaluateExit({now:row.availableAt,enteredAt,entryCostLamports:entryCost,heldBaseUnits:row.pricedBaseUnits,mark})};
  });
}
async function run(){
  const actualStartedAt=new Date().toISOString(),began=performance.now(),trace=readCapturedTrace(),rows=await reprice(trace);
  const first=rows.find(r=>r.baselineNetLamports!==null)!;assert.ok(first);
  const net=BigInt(first.baselineNetLamports!),cases=[
    {id:'no-price-trigger',cost:net.toString(),enteredAt:first.availableAt-1000},
    {id:'synthetic-stop-cost-basis',cost:((net*10_000n+8499n)/8500n).toString(),enteredAt:first.availableAt-1000},
    {id:'synthetic-profit-cost-basis',cost:(net*10_000n/13_000n).toString(),enteredAt:first.availableAt-1000},
    {id:'synthetic-15min-boundary',cost:net.toString(),enteredAt:first.availableAt-PROVISIONAL_RULE.maximumHoldingMs+1000},
  ];
  const comparisons=cases.map(c=>{
    const baseline=recognize(rows,c.cost,c.enteredAt,'baseline'),adapter=recognize(rows,c.cost,c.enteredAt,'adapter'),batch=recognize(rows,c.cost,c.enteredAt,'batch');assert.deepEqual(adapter,baseline);assert.deepEqual(batch,baseline);
    const recognition=baseline.find(r=>r.decision.action==='request-exit')??null;
    const scheduled=(prefix:string)=>recognize(rows.filter(r=>r.lane.startsWith(prefix)),c.cost,c.enteredAt,prefix==='poll'?'baseline':'adapter').find(r=>r.decision.action==='request-exit')??null;
    const syntheticTriggerAvailableAt=c.id==='synthetic-15min-boundary'?c.enteredAt+PROVISIONAL_RULE.maximumHoldingMs:c.id==='no-price-trigger'?null:first.availableAt;
    return {...c,syntheticNotional:true,syntheticTriggerAvailableAt,matchedEvidenceRecognitionDelayMs:recognition&&syntheticTriggerAvailableAt!==null?recognition.availableAt-syntheticTriggerAvailableAt:null,recognitionDelayInterpretation:'Replay sampling delay from the declared synthetic time boundary or first captured quote; no naturally observed adverse price change or provider source-latency claim.',matchedEvidenceDecisionsEqual:true,matchedEvidenceRecognition:recognition,originalConfoundedSchedule:{pollRecognition:scheduled('poll'),notificationAndPeriodicRecognition:scheduled('subscription'),interpretation:'Different recorded schedules/cadences; not a causal same-protection comparison.'},chronologicalDecisions:baseline};
  });
  assert.equal(comparisons[0]!.matchedEvidenceRecognition,null);assert.equal(trace.changedNotifications,0);
  const result={schemaVersion:1,classification:'FREE_DATA_CAPTURED_QUOTE_REPLAY_WITH_SYNTHETIC_NOTIONAL_EXITS',actualStartedAt,actualCompletedAt:new Date().toISOString(),actualWallMs:Math.round((performance.now()-began)*1000)/1000,networkRequests:0,providerCredentialsLoaded:false,financialAccountCreated:false,paperEntriesEnabled:false,naturalPaperTrades:0,acceptanceClockStarted:false,liveTradingDisabled:true,source:{record:RECORD,recordSha256:trace.recordSha256,originProof:PROOF,originProofSha256:trace.proofSha256,mint:trace.mint,comparisonBaseUnits:trace.inputUnits,capturedBatches:rows.length,usableCapturedQuotes:rows.filter(r=>r.grossLamports!==null).length,notifications:trace.notificationCount,changedContentNotifications:trace.changedNotifications},versions:{sdk:'@pump-fun/pump-swap-sdk@2.2.0',rule:PROVISIONAL_RULE,scriptSha256:sha(readFileSync(fileURLToPath(import.meta.url))),sourceHashes:Object.fromEntries(['rpc-market','pool','strategy','network'].map(name=>[name,sha(readFileSync(join(ROOT,'src',name+'.ts')))]))},gasAssumption:{lamports:String(GAS),classification:'synthetic; net marks subtract once; no refundable rent assumed'},quoteRows:rows,comparisons,recoveryEvidence:{path:'evidence/recovery-load.json',sha256:sha(readFileSync(join(ROOT,'evidence/recovery-load.json'))),reuse:'Prior disposable actual SIGKILL, WAL interruption, uncertainty quarantine and consistent restore drill; not repeated or relabeled as current forward operation.'},limits:['Identical captured coherent batches and original completion times are supplied to both primary paths; exact agreement proves offline price/rule parity, not transport coverage or profitable fills.','Synthetic entry costs and entry times intentionally exercise unchanged 15%/30%/15min thresholds; none are natural positions, signals, fills or performance.','Notional costs are derived from the first captured quote to exercise branches; they are not chronologically entered trades or usable economic backtests.','Source window had no changed content and no observed price move; it cannot prove change-trigger latency, adverse-move protection, full coverage or economic savings.','Individual account notifications never become priced marks; only a recorded coherent batch with successful block-time validation can supply a mark.','Source receive time remains the mark time, successful result appears only at original completed quote availability, and unavailable block-time sample remains unknown.','Original poll and subscription schedules are shown separately and are confounded by cadence, request ordering and a reconnect; no causal superiority is inferred.','Replay invokes SDK/RpcMarket on retained public bytes using injected clocks/transport; call counts are offline method work, not new provider usage or reduced daily costs.','The uncaptured initial pool-discovery response is reconstructed from the later captured coherent pool bytes; this cannot test intermediate pool-link changes or original discovery timing. Results still remain unavailable until recorded quote completion.','Provider/RPC exhaustion and runtime restart/capacity failures are evaluated separately; no FREE_DATA deployment or acceptance interval is authorized by this artifact.']};
  Object.assign(result,{capturedTimings:{
    classification:'Original capture timing only; replay wall time is not provider latency.',
    coherentBatchHttpResponseMs:distribution(trace.samples.map(s=>s.receivedAt-s.requestedAt)),
    quoteAvailabilityAfterBatchReceiveMs:distribution(trace.samples.map(s=>s.availableAt-s.receivedAt)),
    successfulQuoteAgeAtAvailabilityMs:distribution(trace.samples.filter(s=>s.outputLamports!==null).map(s=>s.availableAt-s.receivedAt)),
    requestedAtMeaning:'Start of the retained coherent account batch; earlier link-discovery HTTP timing was not captured here.',
  }});
  const directory=join(ROOT,'evidence/free-data-20261027');mkdirSync(directory,{recursive:true,mode:0o700});
  const encoded=JSON.stringify(result,null,2)+'\n',retained=readdirSync(directory).filter(p=>/^recovery-quote-.*\.json$/.test(p)).reduce((n,p)=>n+statSync(join(directory,p)).size,0);
  assert.ok(retained+Buffer.byteLength(encoded)<=CAP,'bounded quote-replay evidence cap');
  const output=join(directory,'recovery-quote-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');assert.equal(existsSync(output),false);writeFileSync(output,encoded,{mode:0o600});
  console.log(JSON.stringify({status:'OFFLINE_QUOTE_REPLAY_COMPLETE',output,capturedBatches:rows.length,comparisons:comparisons.length,acceptanceClockStarted:false}));
}
if(process.argv[1]&&existsSync(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))await run();
