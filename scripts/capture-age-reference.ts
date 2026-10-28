/** One bounded, independent current-index snapshot; no pilot or Solana RPC access. */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';

const MIB=1024*1024;
const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
const directory=resolve('evidence/age-reference-20261028');
const planPath=join(directory,'plan.json');
need(!existsSync(planPath),'ONE_PASS_ALREADY_PREPARED_NO_AUTOMATIC_RETRY');
const priorPath=resolve('evidence/high-activity-20261028/forward-reference-20261028T002814493Z-expand-receipt.json');
const priorBytes=readFileSync(priorPath),prior=JSON.parse(priorBytes.toString('utf8'));
need(prior.stopReason==='all planned requests completed','UNSETTLED_PRIOR_INDEX_PASS');
need(Date.now()-Date.parse(prior.completedAt)>120000,'PRIOR_PROVIDER_COOLDOWN');
const limits=Object.freeze({maximumRequests:5,pages:[1,2,3,4,5],minimumPhysicalStartSpacingMs:12000,maximumElapsedMs:100000,shutdownReserveMs:5000,requestTimeoutMs:8000,perResponseBytes:256*1024,totalResponseBytes:2*MIB,applicationStopBytes:Math.floor(1.75*MIB),retainedBytes:MIB,maximumRssBytes:256*MIB,oneInFlight:true,noAutomaticRetries:true});
const selection=Object.freeze({universe:'All rows on independent current PumpSwap DEX pages 1–5, sorted by documented h24_volume_usd_desc. Not a historical or exhaustive census.',leadRule:'Valid public addresses; canonical PumpSwap SOL-quoted PDA address consistency; index-created age >=0 and <=6h at that page receipt. Index time remains UNVERIFIED, not an on-chain migration proof or current support validation.',activityFilter:'NONE: retain every qualifying lead, including zero-activity and weak controls.',outcomeSelection:'NONE: population frozen at completion, before any later outcome retrieval.',marketRecallDenominator:false});
const termsPath=resolve('evidence/opportunity-coverage-20261027/reference-raw/official-public-api.html');
const sourceBytes=readFileSync(new URL(import.meta.url));
mkdirSync(directory,{recursive:true,mode:0o700});
const source={tool:'scripts/capture-age-reference.ts',sha256:sha256(sourceBytes),basedOn:'scripts/capture-forward-reference.ts',basedOnSha256:sha256(readFileSync(resolve('scripts/capture-forward-reference.ts')))};
const plan={schemaVersion:1,preparedAt:new Date().toISOString(),scope:'ONE independent pre-outcome index snapshot; public HTTPS Gecko only; no Solana RPC, pilot reads, financial data or credentials',limits,selection,source,prior:{path:priorPath,sha256:sha256(priorBytes),completedAt:prior.completedAt,cumulative:prior.cumulative},terms:{path:termsPath,sha256:sha256(readFileSync(termsPath)),claim:'Public keyless API documented 10 calls/min; own >=12s physical start spacing. Documentation is historical cached evidence; actual responses determine this test.'}};
writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
type RequestReceipt={ordinal:number;page:number;url:string;startedAt:string;startedUnixMs:number;startedMonotonicMs:number;status?:number;finishedAt?:string;elapsedMs?:number;bodyBytes:number;uncertainBodyBytes?:number;responseHeaders?:Record<string,string|null>;retainedFile?:string;sha256?:string;error?:string};
const started=Date.now(),startedMono=performance.now();
const requests:RequestReceipt[]=[];
const rows:any[]=[],duplicates:any[]=[];
let received=0,rawRetained=0,lastPhysicalStart=-Infinity,stopReason='all planned requests completed';
const receipt:any={schemaVersion:1,classification:'INDEPENDENT_CURRENT_INDEXED_PRE_OUTCOME_REFERENCE_NOT_MARKET_CENSUS',startedAt:new Date(started).toISOString(),completedAt:null,limits,selection,source,prior:plan.prior,requests,rows,duplicates,leads:[],cohortFrozenAt:null,newUsage:{},cumulative:{},limitations:['Population is current-indexed and bounded by five h24-volume-ranked pages; it is biased and nonexhaustive.','Index-created timestamps do not establish genuine migration times. Future matching must use actual on-chain origin proof.','Canonical address consistency does not prove current mint, pool, fee or vault support.','Reported transactions, volume, price changes and liquidity are provider claims, not confirmed trade flow or actual-size executable prices.','No top-winner or opportunity-recall percentage is supported. Weak controls remain in the frozen lead population.','Only HTTP response body bytes are measured. Packet/TLS overhead, request bytes and infrastructure transfer allocations remain unverified.','Zero additional public API subscription/key cost does not mean zero infrastructure cost.']};
function checkpoint(){
  const uncertain=requests.reduce((n,row)=>n+(row.uncertainBodyBytes??0),0);
  receipt.newUsage={requestStarts:requests.length,measuredBodyBytes:received,uncertainBodyBytes:uncertain,rawRetainedBytes:rawRetained,elapsedMs:performance.now()-startedMono};
  receipt.cumulative={requestStarts:prior.cumulative.requestStarts+requests.length,measuredBodyBytes:prior.cumulative.measuredBodyBytes+received,uncertainBodyBytes:prior.cumulative.uncertainBodyBytes+uncertain};
  receipt.stopReason=stopReason;
  const bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
  need(rawRetained+bytes.length<limits.retainedBytes,'RETAINED_EVIDENCE_CAP');
  writeFileSync(join(directory,'receipt.json'),bytes,{mode:0o600});
}
function normalize(pool:any,page:number,position:number,at:number){
  need(pool?.type==='pool'&&pool.attributes&&pool.relationships,'INDEX_ROW_SHAPE');
  const a=pool.attributes,mint=pool.relationships.base_token?.data?.id?.replace(/^solana_/,''),quote=pool.relationships.quote_token?.data?.id?.replace(/^solana_/,''),created=Date.parse(a.pool_created_at);
  let canonical:string|null=null,valid=false;
  try{valid=new PublicKey(mint).toBase58()===mint&&new PublicKey(quote).toBase58()===quote&&new PublicKey(a.address).toBase58()===a.address;canonical=canonicalPumpPoolPda(new PublicKey(mint)).toBase58();}catch{}
  const age=Number.isFinite(created)?at-created:null,sol=quote==='So11111111111111111111111111111111111111112',lead=valid&&sol&&canonical===a.address&&age!==null&&age>=0&&age<=6*60*60*1000;
  return {page,position,indexedPoolId:pool.id,name:a.name,pool:a.address,mint,quoteMint:quote,indexedCreatedAt:a.pool_created_at,indexedCreatedTimeVerification:'UNVERIFIED',observedAt:new Date(at).toISOString(),indexedAgeAtReceiptMs:age,canonicalAddressMatch:canonical===a.address,SOLQuoted:sol,derivedCanonicalPool:canonical,provisionalZeroToSixHourLead:lead,classification:!valid?'INVALID_ADDRESS':!sol?'OUTSIDE_SOL_QUOTE':canonical!==a.address?'NONCANONICAL_ADDRESS':age===null?'INDEXED_TIME_UNAVAILABLE':!lead?'OUTSIDE_INDEXED_ZERO_TO_SIX_HOUR_RANGE':'LEAD_REQUIRES_ONCHAIN_ORIGIN_AND_SUPPORT_PROOF',reportedVolumeUsd:a.volume_usd,reportedTransactions:a.transactions,reportedPriceChanges:a.price_change_percentage,reportedReserveUsd:a.reserve_in_usd};
}
async function getPage(page:number){
  const wait=Math.max(0,lastPhysicalStart+limits.minimumPhysicalStartSpacingMs-performance.now());
  need(performance.now()-startedMono+wait+limits.requestTimeoutMs<limits.maximumElapsedMs-limits.shutdownReserveMs,'TIME_HEADROOM');
  if(wait)await delay(wait);
  need(requests.length<limits.maximumRequests&&received+limits.perResponseBytes<=limits.totalResponseBytes&&process.memoryUsage().rss<=limits.maximumRssBytes,'RESOURCE_HEADROOM');
  const url=new URL('https://api.geckoterminal.com/api/v2/networks/solana/dexes/pumpswap/pools');
  url.search=new URLSearchParams({page:String(page),sort:'h24_volume_usd_desc',include:'base_token,quote_token'}).toString();
  const physicalStart=performance.now();
  need(physicalStart-lastPhysicalStart>=limits.minimumPhysicalStartSpacingMs,'PHYSICAL_START_PACING');
  lastPhysicalStart=physicalStart;
  const start=Date.now(),r:RequestReceipt={ordinal:requests.length+1,page,url:url.toString(),startedAt:new Date(start).toISOString(),startedUnixMs:start,startedMonotonicMs:physicalStart,bodyBytes:0};
  requests.push(r);checkpoint();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),limits.requestTimeoutMs);
  try{
    const response=await fetch(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:controller.signal});
    r.status=response.status;r.responseHeaders=Object.fromEntries(['date','content-type','content-length','retry-after'].map(k=>[k,response.headers.get(k)]));
    if(response.status!==200){const rawLength=response.headers.get('content-length'),length=rawLength===null?NaN:Number(rawLength);r.uncertainBodyBytes=Number.isSafeInteger(length)&&length>=0?length:limits.perResponseBytes;await response.body?.cancel();throw Error(`HTTP_${response.status}_NO_RETRY`);}
    need(response.body,'EMPTY_BODY');const reader=response.body.getReader(),chunks:Buffer[]=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;const bytes=Buffer.from(value);r.bodyBytes+=bytes.length;received+=bytes.length;need(r.bodyBytes<=limits.perResponseBytes&&received<=limits.applicationStopBytes,'RESPONSE_BYTE_STOP');need(process.memoryUsage().rss<=limits.maximumRssBytes,'RSS_STOP');chunks.push(bytes);}}
    catch(error){controller.abort(error);await reader.cancel().catch(()=>{});throw error;}
    const raw=Buffer.concat(chunks),parsed=JSON.parse(raw.toString('utf8'));
    need(Array.isArray(parsed.data)&&parsed.data.length<=20,'INDEX_PAGE_SHAPE');
    const file=`page-${page}.json`;writeFileSync(join(directory,file),raw,{flag:'wx',mode:0o600});rawRetained+=raw.length;r.retainedFile=file;r.sha256=sha256(raw);
    const availableAt=Date.now();
    for(const [index,pool]of parsed.data.entries()){const row=normalize(pool,page,index+1,availableAt);if(rows.some(old=>old.pool===row.pool))duplicates.push(row);else rows.push(row);}
  }catch(error){r.error=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw error;}
  finally{clearTimeout(timer);r.finishedAt=new Date().toISOString();r.elapsedMs=performance.now()-physicalStart;checkpoint();}
}
try{checkpoint();for(const page of limits.pages)await getPage(page);}
catch(error){stopReason=error instanceof Error?error.message:'UNKNOWN_FAILURE';}
receipt.leads=rows.filter(row=>row.provisionalZeroToSixHourLead);
receipt.cohortFrozenAt=new Date().toISOString();
receipt.completedAt=receipt.cohortFrozenAt;
receipt.physicalStartGapsMs=requests.slice(1).map((row,index)=>row.startedMonotonicMs-requests[index]!.startedMonotonicMs);
checkpoint();
writeFileSync(join(directory,'index-usage-append.json'),JSON.stringify({schemaVersion:1,type:'APPEND_ONLY_SETTLED_PUBLIC_INDEX_RECEIPT',createdAt:receipt.completedAt,previous:plan.prior,receipt:{path:'receipt.json',sha256:sha256(readFileSync(join(directory,'receipt.json')))},actual:receipt.newUsage,cumulative:receipt.cumulative,uncertainUsagePreserved:true,solanaResearchBook:'NOT_READ_OR_MODIFIED',provider:'GeckoTerminal public keyless HTTPS',additionalApiSubscriptionFeesUsd:0,infrastructureCost:'UNVERIFIED'},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({directory,stopReason,startedAt:receipt.startedAt,completedAt:receipt.completedAt,uniqueRows:rows.length,duplicatePositions:duplicates.length,frozenLeads:receipt.leads.map((x:any)=>({mint:x.mint,pool:x.pool,name:x.name,indexedCreatedAt:x.indexedCreatedAt})),usage:receipt.newUsage,cumulative:receipt.cumulative,physicalStartGapsMs:receipt.physicalStartGapsMs}));
