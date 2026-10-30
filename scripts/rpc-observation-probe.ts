/** One bounded paired public-RPC experiment. No secrets, ledger, paid data,
 * transaction construction/signing/submission, broad account/log subscriptions. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {setTimeout as wait} from 'node:timers/promises';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {PublicKey} from '@solana/web3.js';
import {ReadOnlyRpc} from '../src/network.js';
import {quotePositionSell} from '../src/pool.js';
import {Recorder} from '../src/recorder.js';

const HTTP='https://api.mainnet.solana.com',WS='wss://api.mainnet.solana.com';
const DURATION=60_000,POLL=7500,RECONCILE=15_000,MAX_REQUESTS=80,MAX_NOTIFICATIONS=256;
const PROOF='evidence/integration-proof-2026-10-26T23-32-41.255Z.json';
const prefix=process.argv[2]??'evidence/rpc-observation-comparison';
if(!/^evidence\/rpc-observation-[a-zA-Z0-9_-]+$/.test(prefix))throw new Error('bounded evidence output prefix required');
const OUTPUT=prefix+'.json',RECORD=prefix+'.ndjson';
if(existsSync(OUTPUT)||existsSync(RECORD))throw new Error('completed research evidence exists; choose a new output prefix');
const prior=JSON.parse(readFileSync(PROOF,'utf8')),mint=new PublicKey(prior.quote.mint),input=BigInt(prior.quote.buy.outputBaseUnits);
if(prior.origin.instructionVerified!==true||prior.origin.creationCpiVerified!==true||prior.origin.commitment!=='confirmed'||mint.toBase58()!==prior.quote.mint)throw new Error('verified retained origin required');
mkdirSync('evidence',{recursive:true});
const recorder=new Recorder(RECORD,4_000_000),started=performance.now(),startedAt=Date.now();
const overall=new AbortController();const hardStop=setTimeout(()=>overall.abort(),115_000);
let requests=0,httpRequests=0,wsRequests=0,httpFailed=0,currentLane='setup',floor=prior.origin.slot,addresses:string[]=[];
let socket:WebSocket|undefined,connection=0,nextId=1,expectedClose=false,stopping=false,wsReady=false,readyAt:number|null=null;
let wsOpenAt:number|null=null,readyStart:number|null=null,readyMs=0,wsErrors=0,closeCount=0,malformed=0,duplicates=0,regressions=0,preAckDropped=0;
let wsBytes=0,notifications=0,notificationsCapped=false,changeRefreshes=0,changeRefreshCapped=false,dirty=false,lastChangeAt=0;
const blobs=new Set<string>(),seen=new Set<string>(),subscriptions=new Map<number,string>(),pending=new Map<number,string>(),early:any[]=[];
const samples:Array<{lane:string;requestedAt:number;receivedAt:number;receivedMonotonicMs:number;validatedAt:number;validatedMonotonicMs:number;slot:number;hashes:string[];outputLamports:string|null;blockTime:number|null;status:string}>=[];
const notices:Array<{address:string;slot:number;hash:string;at:number;receivedMonotonicMs:number}>=[],acks:Array<{connection:number;address:string;at:number}>=[],connections:Array<{connection:number;openedAt:number|null;readyAt:number|null;readyEndedAt:number|null;closedAt:number|null;code?:number;reason:string}>=[];
const attempts:Array<{lane:string;status:string;durationMs:number;requests:number}>=[];
const failures:Array<{lane:string;at:number;reason:string}>=[],gaps:Array<{at:number;reason:string}>=[];
const record=(kind:string,data:unknown)=>recorder.record(kind,data);
const hashAccount=(account:unknown)=>{
  const raw=account as any,canonical=raw===null?null:{data:raw.data,owner:raw.owner,lamports:raw.lamports,executable:raw.executable};
  const hash=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  if(!blobs.has(hash)){if(blobs.size>=512)throw new Error('ACCOUNT_BLOB_CAP');blobs.add(hash);record('account-blob',{hash,account:canonical,hashFields:['data','owner','lamports','executable']});}
  return hash;
};
const transport=(async(url,init)=>{if(requests>=MAX_REQUESTS)throw new Error('PROBE_REQUEST_CAP');requests++;httpRequests++;return fetch(url,init);}) as typeof fetch;
const rpc=new ReadOnlyRpc(HTTP,transport,{profile:'runtime',maxCallsPerMinute:60,maxInFlight:1,timeoutMs:2500});
let capture:{requestedAt:number;receivedAt:number;receivedMonotonicMs:number;slot:number;hashes:string[]}|undefined;
const marketRecorder={record(kind:string,data:any){
  if(kind==='pool-state'){
    if(!addresses.length){addresses=data.addresses.map((x:string)=>new PublicKey(x).toBase58());if(addresses.length!==7||new Set(addresses).size!==7)throw new Error('EXACT_ACCOUNT_SET_REQUIRED');}
    if(JSON.stringify(addresses)!==JSON.stringify(data.addresses))throw new Error('POOL_ACCOUNT_LINKS_CHANGED');
    capture={requestedAt:Date.parse(data.requestedAt),receivedAt:Date.parse(data.receivedAt),receivedMonotonicMs:performance.now(),slot:data.context.slot,hashes:data.value.map(hashAccount)};
    record('coherent-account-batch',{lane:currentLane,...capture,addresses,commitment:'confirmed'});
  }else record(kind,{lane:currentLane,...data});
}};
async function price(lane:string){
  currentLane=lane;capture=undefined;const began=performance.now(),beforeRequests=httpRequests;let output:string|null=null,blockTime:number|null=null,status='unavailable';
  try{
    if(requests>MAX_REQUESTS-10)throw new Error('PROBE_TERMINATION_RESERVE');
    const q=await quotePositionSell(rpc,mint,input,marketRecorder,floor,overall.signal);
    floor=q.slot;output=q.sell.outputLamports;blockTime=q.marketBlockTime;
    status=Date.now()-Date.parse(q.receivedAt)<=2000?'fresh-verified-size-quote':'stale-verified-size-quote';
  }catch(e){httpFailed++;failures.push({lane,at:Date.now(),reason:e instanceof Error?e.message.slice(0,120):'read unavailable'});record('read-unavailable',failures.at(-1));}
  const captured=capture as {requestedAt:number;receivedAt:number;receivedMonotonicMs:number;slot:number;hashes:string[]}|undefined;
  if(captured)samples.push({lane,...captured,validatedAt:Date.now(),validatedMonotonicMs:performance.now(),outputLamports:output,blockTime,status});
  const durationMs=performance.now()-began;attempts.push({lane,status,durationMs,requests:httpRequests-beforeRequests});record('quote-attempt',{lane,at:Date.now(),durationMs,httpRequests:httpRequests-beforeRequests,status,outputLamports:output,marketBlockTime:blockTime});
}
function send(method:'accountSubscribe'|'accountUnsubscribe',params:unknown[],address?:string){
  if(!socket||socket.readyState!==WebSocket.OPEN||requests>=MAX_REQUESTS)throw new Error('WS_UNAVAILABLE_OR_REQUEST_CAP');
  if(method==='accountSubscribe'&&(!address||!addresses.includes(address)))throw new Error('UNSCOPED_SUBSCRIPTION_DENIED');
  const id=nextId++;requests++;wsRequests++;if(address)pending.set(id,address);
  socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));record('ws-request',{connection,id,method,address:address??null});
}
function acceptNotice(message:any,received:{at:number;receivedMonotonicMs:number}){
  const address=subscriptions.get(message.params?.subscription);if(!address){if(pending.size&&early.length<16)early.push({message,received});else preAckDropped++;return;}
  const slot=message.params?.result?.context?.slot,account=message.params?.result?.value;
  if(!Number.isSafeInteger(slot)||slot<prior.origin.slot||!account||typeof account!=='object'){malformed++;return;}
  if(notifications>=MAX_NOTIFICATIONS){notificationsCapped=true;expectedClose=true;socket?.terminate();return;}
  const {at,receivedMonotonicMs}=received;const hash=hashAccount(account),identity=`${address}:${slot}:${hash}`;
  notifications++;if(seen.has(identity)){duplicates++;record('account-notification-duplicate',{connection,address,slot,hash,receivedAt:at,receivedMonotonicMs});return;}seen.add(identity);
  const last=notices.findLast(x=>x.address===address);if(last&&slot<last.slot)regressions++;
  notices.push({address,slot,hash,at,receivedMonotonicMs});dirty=true;lastChangeAt=performance.now();
  record('account-notification',{connection,address,slot,hash,receivedAt:at,receivedMonotonicMs,commitment:'confirmed'});
}
async function connect(reason:string){
  connection++;const cid=connection;wsReady=false;pending.clear();subscriptions.clear();early.length=0;expectedClose=false;
  const row={connection,openedAt:null,readyAt:null,readyEndedAt:null,closedAt:null,reason} as (typeof connections)[number];connections.push(row);
  return await new Promise<boolean>(resolve=>{
    let settled=false;const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
    const timer=setTimeout(()=>{gaps.push({at:Date.now(),reason:'subscription handshake/ACK deadline'});expectedClose=true;socket?.terminate();finish(false);},8000);
    const ws=new WebSocket(WS,{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,handshakeTimeout:6000,maxPayload:65536,followRedirects:false});socket=ws;
    ws.on('open',()=>{if(ws!==socket)return;try{wsOpenAt=row.openedAt=Date.now();record('ws-open',{connection:cid,at:wsOpenAt});for(const address of addresses)send('accountSubscribe',[address,{encoding:'base64',commitment:'confirmed'}],address);}catch{finish(false);socket?.terminate();}});
    ws.on('message',raw=>{if(ws!==socket)return;try{
      const received={at:Date.now(),receivedMonotonicMs:performance.now()};wsBytes+=Array.isArray(raw)?raw.reduce((n,b)=>n+b.byteLength,0):raw.byteLength;const message=JSON.parse(raw.toString());
      if(message.method==='accountNotification'){acceptNotice(message,received);return;}
      const address=pending.get(message.id);if(!address)return;
      pending.delete(message.id);
      if(message.error||!Number.isSafeInteger(message.result)){record('ws-subscription-refused',{connection:cid,address,code:message.error?.code??null});gaps.push({at:Date.now(),reason:'account subscription refused'});finish(false);socket?.terminate();return;}
      subscriptions.set(message.result,address);acks.push({connection,address,at:Date.now()});record('ws-ack',{connection:cid,address,subscription:message.result,at:Date.now()});
      for(let i=early.length-1;i>=0;i--)if(subscriptions.has(early[i].message.params?.subscription)){const item=early.splice(i,1)[0];acceptNotice(item.message,item.received);}
      if(subscriptions.size===addresses.length){wsReady=true;readyAt=row.readyAt=readyStart=Date.now();record('ws-ready',{connection:cid,at:readyAt,subscriptions:subscriptions.size});finish(true);}
    }catch{malformed++;}});
    ws.on('unexpected-response',(_request,response)=>{wsErrors++;record('ws-handshake-refused',{connection:cid,status:response.statusCode});response.resume();socket?.terminate();finish(false);});
    ws.on('error',()=>{wsErrors++;record('ws-transport-error',{connection:cid});finish(false);});
    ws.on('close',code=>{closeCount++;row.closedAt=Date.now();row.readyEndedAt??=row.closedAt;row.code=code;const active=ws===socket;if(active&&readyStart!==null){readyMs+=Date.now()-readyStart;readyStart=null;}if(active)wsReady=false;record('ws-close',{connection:cid,at:row.closedAt,code,expected:active?expectedClose:true});if(active&&!expectedClose&&!stopping)gaps.push({at:Date.now(),reason:'unexpected socket close'});finish(false);});
  });
}
const distribution=(values:number[])=>{const x=values.toSorted((a,b)=>a-b),p=(q:number)=>x.length?x[Math.min(x.length-1,Math.floor((x.length-1)*q))]!:null;return {count:x.length,min:x[0]??null,p50:p(.5),p95:p(.95),max:x.at(-1)??null};};
let commonStart:number|null=null,commonEnd:number|null=null,setupOkay=false,reconnectAttempted=false,reconnectRestored=false,reconnectAt:number|null=null,firstPostReconnectQuoteAt:number|null=null;
let boundedSignatures:any[]|null=null,verifiedTransaction:any|null=null,fatal:string|null=null;
try{
  record('probe-configuration',{mode:'READ_ONLY_QUOTE_RESEARCH',mint:mint.toBase58(),comparisonInputBaseUnits:input.toString(),origin:{signature:prior.origin.signature,slot:prior.origin.slot,blockTime:prior.origin.blockTime},durationMs:DURATION,pollMs:POLL,reconcileMs:RECONCILE,maxChangeRefreshes:3,maximumRequests:MAX_REQUESTS,maximumNotifications:MAX_NOTIFICATIONS,maximumAccounts:7,paidData:false});
  if(await rpc.call<string>('getGenesisHash',[],overall.signal)!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('WRONG_CLUSTER');
  await price('setup');if(!addresses.length||!samples.some(x=>x.lane==='setup'&&x.outputLamports))throw new Error('CURRENT_SUPPORTED_POOL_NOT_VERIFIED');setupOkay=true;
  await connect('initial');commonStart=Date.now();const mono=performance.now();let nextPoll=mono,nextReconcile=mono;
  while(performance.now()-mono<DURATION&&!overall.signal.aborted){
    const tick=performance.now(),elapsed=tick-mono;
    if(!reconnectAttempted&&elapsed>=30_000&&wsReady){
      reconnectAttempted=true;reconnectAt=Date.now();const retired=connections.at(-1);if(retired)retired.readyEndedAt=reconnectAt;if(readyStart!==null){readyMs+=reconnectAt-readyStart;readyStart=null;}wsReady=false;expectedClose=true;socket?.terminate();await wait(100);reconnectRestored=await connect('planned-reconnect');nextReconcile=performance.now();dirty=false;
    }
    if(tick>=nextPoll){await price('poll');nextPoll+=POLL;}
    const now=performance.now(),trigger=dirty&&now-lastChangeAt>=250&&now>=nextReconcile-RECONCILE+1500;
    if(wsReady&&(now>=nextReconcile||trigger&&changeRefreshes<3)){
      const byChange=now<nextReconcile;if(byChange)changeRefreshes++;
      await price(byChange?'subscription-change-reconcile':'subscription-periodic-reconcile');dirty=false;nextReconcile=performance.now()+RECONCILE;
      if(reconnectAt!==null&&firstPostReconnectQuoteAt===null&&samples.at(-1)?.lane.startsWith('subscription')&&samples.at(-1)?.outputLamports)firstPostReconnectQuoteAt=Date.now();
    }
    if(trigger&&changeRefreshes>=3)changeRefreshCapped=true;
    await wait(100);
  }
  commonEnd=Date.now();if(wsReady)await price('subscription-final-reconcile');
  // One bounded transaction sample is verification of a selected transaction,
  // not reconstruction of all swaps or a substitute for the paid flow reference.
  if(requests<=MAX_REQUESTS-10){
    boundedSignatures=await rpc.call<any[]>('getSignaturesForAddress',[addresses[0],{limit:2,commitment:'confirmed'}],overall.signal);record('bounded-pool-signatures',{pool:addresses[0],rows:boundedSignatures});
    const row=boundedSignatures.find(x=>x.err===null&&typeof x.signature==='string');
    if(row&&requests<=MAX_REQUESTS-9){const tx=await rpc.call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],overall.signal);record('bounded-pool-transaction',{signature:row.signature,transaction:tx});verifiedTransaction=tx?{signature:row.signature,slot:tx.slot,blockTime:tx.blockTime,successful:tx.meta?.err===null,withinObservedSlots:samples.length>0&&tx.slot>=Math.min(...samples.filter(x=>x.lane!=='setup').map(x=>x.slot))&&tx.slot<=Math.max(...samples.map(x=>x.slot)),classification:'one transaction touching pool; not classified as a swap or feed-equivalent flow'}:null;}
  }
}catch(e){fatal=e instanceof Error?e.message.slice(0,160):'probe failed';record('probe-failure',{at:Date.now(),reason:fatal});}
finally{
  stopping=true;expectedClose=true;
  if(socket?.readyState===WebSocket.OPEN){for(const id of subscriptions.keys()){try{send('accountUnsubscribe',[id]);}catch{break;}}await wait(100);}
  socket?.terminate();overall.abort();clearTimeout(hardStop);if(readyStart!==null){readyMs+=Date.now()-readyStart;readyStart=null;}
  commonEnd??=Date.now();
  const windowSamples=samples.filter(x=>x.lane!=='setup'&&commonStart!==null&&x.receivedAt>=commonStart&&x.receivedAt<=commonEnd!);
  const lane=(prefix:string)=>windowSamples.filter(x=>x.lane.startsWith(prefix));
  const freshFraction=(rows:typeof samples)=>{if(commonStart===null||commonEnd===null||commonEnd<=commonStart)return null;let covered=0,end=commonStart;for(const row of rows.filter(x=>x.outputLamports&&x.status==='fresh-verified-size-quote').toSorted((a,b)=>a.validatedAt-b.validatedAt)){const from=Math.max(commonStart,row.validatedAt,end),until=Math.min(commonEnd,row.receivedAt+2000);if(until>from){covered+=until-from;end=until;}}return covered/(commonEnd-commonStart);};
  const previous=new Map(addresses.map((address,i)=>[address,samples.find(x=>x.lane==='setup')?.hashes[i]]));
  const contentChanges=notices.filter(n=>{const changed=previous.get(n.address)!==n.hash;previous.set(n.address,n.hash);return changed;});
  const matchingNotices=contentChanges.filter(n=>commonStart!==null&&n.at>=commonStart&&n.at<=commonEnd!&&connections.some(c=>c.readyAt!==null&&n.at>=c.readyAt&&n.at<=(c.readyEndedAt??c.closedAt??commonEnd!)));
  const staleGaps=(rows:typeof samples)=>{let end=commonStart??commonEnd!,maximum=0,count=0;for(const row of rows.filter(x=>x.outputLamports&&x.status==='fresh-verified-size-quote').toSorted((a,b)=>a.validatedAt-b.validatedAt)){const from=Math.max(commonStart??commonEnd!,row.validatedAt),until=Math.min(commonEnd!,row.receivedAt+2000);if(until<=from)continue;if(from>end){maximum=Math.max(maximum,from-end);count++;}end=Math.max(end,until);}if(end<commonEnd!){maximum=Math.max(maximum,commonEnd!-end);count++;}return {maxUnavailableMs:maximum,unavailableIntervals:count,meaning:'No completed quote within2seconds of original batch receipt; not a proved live exit failure/latency'};};
  const matches=matchingNotices.flatMap(n=>{const index=addresses.indexOf(n.address),match=lane('poll').find(s=>s.slot>=n.slot&&s.hashes[index]===n.hash);return match?[{address:n.address,notificationSlot:n.slot,pollSlot:match.slot,notificationAt:n.at,pollReceivedAt:match.receivedAt,notificationReceiveMonotonicMs:n.receivedMonotonicMs,pollReceiveMonotonicMs:match.receivedMonotonicMs,pollFullQuoteStatus:match.status,notificationToUsablePollQuoteMs:match.status==='fresh-verified-size-quote'?match.validatedMonotonicMs-n.receivedMonotonicMs:null,observedPollMinusNotificationMs:match.receivedMonotonicMs-n.receivedMonotonicMs}]:[];});
  const overlapMs=commonStart===null?0:connections.reduce((sum,c)=>sum+(c.readyAt===null?0:Math.max(0,Math.min(c.readyEndedAt??c.closedAt??commonEnd!,commonEnd!)-Math.max(c.readyAt,commonStart!))),0);
  const allResults={schemaVersion:1,project:'pump-opportunity-engine',mode:'READ_ONLY_QUOTE_RESEARCH',generatedAt:new Date().toISOString(),scriptSha256:createHash('sha256').update(readFileSync('scripts/rpc-observation-probe.ts')).digest('hex'),sourceVersion:'local working tree; not deployed or acceptance-tested',setupOkay,fatal,originProof:PROOF,mint:mint.toBase58(),originAt:new Date(prior.origin.blockTime*1000).toISOString(),migrationAgeAtCommonStartMs:commonStart===null?null:commonStart-prior.origin.blockTime*1000,qualificationAgeScope:commonStart===null?'not evaluated':commonStart-prior.origin.blockTime*1000>=300_000&&commonStart-prior.origin.blockTime*1000<=7_200_000?'within provisional5–120minute migration age only':'outside provisional age; research only',comparisonInputBaseUnits:input.toString(),inputMeaning:'historical comparison quantity, no held position or PAPER order',addresses,startedAt:new Date(startedAt).toISOString(),commonStart:commonStart===null?null:new Date(commonStart).toISOString(),commonEnd:new Date(commonEnd).toISOString(),attemptedWindowMs:commonStart===null?0:commonEnd-commonStart,observedCommonWindowMs:overlapMs,commonReadyAtStart:connections[0]?.readyAt!=null,poll:{httpRequests:attempts.filter(x=>x.lane==='poll').reduce((sum,x)=>sum+x.requests,0),unavailable:staleGaps(lane('poll')),attempts:attempts.filter(x=>x.lane==='poll').length,freshQuotes:lane('poll').filter(x=>x.status==='fresh-verified-size-quote').length,quotePreparationMs:distribution(attempts.filter(x=>x.lane==='poll').map(x=>x.durationMs)),twoSecondFreshStateFraction:freshFraction(lane('poll'))},subscription:{httpRequests:attempts.filter(x=>x.lane.startsWith('subscription')).reduce((sum,x)=>sum+x.requests,0),websocketRequests:wsRequests,unavailable:staleGaps(lane('subscription')),connections,acknowledgedSubscriptions:acks.length,readyMs:overlapMs,totalReadyMsIncludingSetupAndShutdown:readyMs,notifications,uniqueNotifications:notices.length,bytes:wsBytes,duplicates,slotRegressions:regressions,malformed,preAckDropped,notificationsCapped,changeRefreshes,changeRefreshCapped,periodicOrTriggeredQuotes:lane('subscription').length,freshQuotes:lane('subscription').filter(x=>x.status==='fresh-verified-size-quote').length,twoSecondFreshStateFraction:freshFraction(lane('subscription')),reconnectAttempted,reconnectRestored,reconnectAt,firstPostReconnectQuoteAt,postReconnectCoherentRecoveryMs:reconnectAt!==null&&firstPostReconnectQuoteAt!==null?firstPostReconnectQuoteAt-reconnectAt:null},accountContent:{changedNotifications:contentChanges.length,unchangedByteNotifications:notices.length-contentChanges.length,poolOrVaultChangedNotifications:contentChanges.filter(x=>[addresses[0],addresses[5],addresses[6]].includes(x.address)).length,meaning:'canonical account content bytes/owner/lamports/executable; write notifications alone are not content changes'},matchedChanges:{count:matches.length,conditionalPollMinusNotificationMs:distribution(matches.map(x=>x.observedPollMinusNotificationMs)),rows:matches,meaning:'changed account content only, matching bytes with compatible later poll slot; no unchanged-write latency; not chain-publication latency or full update coverage'},requests:{total:requests,http:httpRequests,websocket:wsRequests,maximum:MAX_REQUESTS,rpc:rpc.usage(),httpBytes:rpc.bytes,httpFailureCount:httpFailed,rpcDurationMs:distribution(rpc.durationsMs)},gaps,failures,transactionSample:verifiedTransaction,costs:{paidDataEvents:0,paidDataCostSol:'0',rpc:'public endpoint, no paid key/charge; no provider unit price or daily economic savings verified'},conclusions:{verifiedCoherentQuotes:windowSamples.filter(x=>x.outputLamports).length,flowDecisionEquivalence:'UNMEASURED: no selected-token PumpPortal reference flow; account changes cannot verify participation/net-buying features',threeWayEconomicComparison:'UNMEASURED: paid flow costs and decision quality unavailable',productionReplacement:'NOT DEPLOYED; healthy EC2 observer/protection untouched',acceptanceClockStarted:false,naturalPaperTrades:0},limits:['One pool and one short matched window; no universal coverage/reliability claim','Same public RPC provider across transports, not independent ground truth','Individual account notifications never form an atomic priced pool','Quotes retain original batch receive/context and use fresh coherent SDK reconciliation','Planned reconnect is an injected transport drill, not measured natural reliability','Different7.5second polling and15second fallback reconciliation cadences confound traffic comparison; no equivalent-protection savings claim','Polling/reconciliation cadence creates deliberately stale intervals; these snapshots do not continuously satisfy2second mark freshness or set a production policy','Bounded optional transaction sample is not complete swap/trade-flow verification']};
  record('probe-ended',{at:Date.now(),totalRequests:requests,wallDurationMs:performance.now()-started,fatal});recorder.close();writeFileSync(OUTPUT,JSON.stringify(allResults,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({output:OUTPUT,record:RECORD,setupOkay,fatal,commonWindowMs:allResults.observedCommonWindowMs,poll:allResults.poll,subscription:allResults.subscription,requests:allResults.requests.total,matchedChanges:matches.length}));
}
