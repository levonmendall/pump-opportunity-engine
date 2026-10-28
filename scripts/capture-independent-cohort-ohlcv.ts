/** One bounded public independent-index OHLC pass. No credentials or trading endpoints. */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';

type Lead={mint:string;pool:string;name:string;canonicalAddressMatch:boolean;SOLQuoted:boolean;provisionalEligibilityStartAt:string;provisionalEligibilityEndAt:string;overlappingMainBenchmarkRuns:string[]};
type Receipt={ordinal:number;mint:string;pool:string;url:string;startedAt:string;startedUnixMs:number;finishedAt?:string;status?:number;bodyBytes:number;uncertainBodyBytes?:number;retainedFile?:string;sha256?:string;elapsedMs?:number;error?:string;responseHeaders?:Record<string,string|null>};
const dir=resolve('evidence/opportunity-coverage-20261027'),MIB=1024*1024;
const limits=Object.freeze({maximumRequests:8,minimumStartSpacingMs:12000,maximumElapsedMs:130000,shutdownReserveMs:5000,timeoutMs:8000,perResponseBodyBytes:2*MIB,totalReceivedBodyBytes:8*MIB,totalRetainedBytes:2*MIB,applicationResponseStopBytes:Math.floor(1.5*MIB),noRetries:true,oneInFlight:true,maximumRssBytes:256*MIB});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
type Bar=[number,number,number,number,number,number];
function bars(value:any):Bar[]{const rows=value?.data?.attributes?.ohlcv_list;need(Array.isArray(rows)&&rows.length<=1000,'INVALID_OHLC_SHAPE');const seen=new Set<number>();for(const row of rows){need(Array.isArray(row)&&row.length===6&&Number.isSafeInteger(row[0])&&row[0]%60===0&&!seen.has(row[0])&&row.slice(1).every((x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0)&&row[1]>0&&row[2]>=row[1]&&row[2]>=row[4]&&row[3]<=row[1]&&row[3]<=row[4]&&row[2]>=row[3]&&row[3]>0,'INVALID_OHLC_BAR');seen.add(row[0]);}return [...rows].sort((a,b)=>a[0]-b[0]);}
const cohortBytes=readFileSync(join(dir,'reference-current-indexed-cohort.json')),cohort=JSON.parse(cohortBytes.toString());
const selected:Lead[]=cohort.canonicalSOLAgeOverlapLeads.filter((l:Lead)=>l.overlappingMainBenchmarkRuns.length&&l.mint!=='2nPPKzFCYDZLqHxJJdFJA1iV2V4ZqV9K6z8qSiYTpump'&&l.mint!=='5fYBASRkQ7GHypQMShaYRWUyXQ74tbwZ51hBfzPXpump');
need(selected.length<=8&&selected.length>=1&&selected.every(l=>l.canonicalAddressMatch&&l.SOLQuoted&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(l.pool)&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(l.mint)),'INVALID_FROZEN_COHORT');
const previous=JSON.parse(readFileSync(join(dir,'reference-frongus-corrected-leg.json'),'utf8'));
const baseline={book:'reference-frongus-corrected-leg.json',requestStarts:previous.cumulativeActualRequestStarts,measuredBodyBytes:previous.cumulativeMeasuredBodyBytes,uncertainBodyBytes:previous.baseline.uncertainBodyBytes,lastFinishedAt:previous.finishedAt,original429:'reference-network-receipts.json preserved unchanged'};
need(Date.now()-Date.parse(previous.finishedAt)>120000,'PRIOR_PROVIDER_COOLDOWN');
need(process.argv.includes('--capture'),'EXPLICIT_CAPTURE_ARGUMENT_REQUIRED');
need(!readdirSync(dir).some(name=>/^cohort-ohlcv-\d.*-receipt\.json$/.test(name)),'COHORT_PASS_ALREADY_RECORDED_NO_AUTOMATIC_RETRY');
const tag=new Date().toISOString().replace(/[-:.]/g,''),receiptPath=join(dir,`cohort-ohlcv-${tag}-receipt.json`),rawDir=join(dir,`cohort-ohlcv-${tag}-raw`);mkdirSync(rawDir,{mode:0o700});
const receipts:Receipt[]=[],startedAt=Date.now(),startedMono=performance.now();let retainedBytes=0,totalReceivedBytes=0,stopReason='all bounded selected leads completed',lastStart=-Infinity;
const evidence={schemaVersion:1,classification:'BOUNDED_INDEPENDENT_CURRENT_COHORT_HISTORICAL_OHLC; NOT_WINNER_CENSUS_OR_EXECUTABLE_RETURN',startedAt:new Date(startedAt).toISOString(),baseline,limits,cohortSha256:sha(cohortBytes),beforeTimestamp:1793143038,credentials:'none; documented public keyless GeckoTerminal HTTPS GET only',providerTermsEvidence:'reference-raw/official-public-api.html documents free public access and10calls/min; selected policy>=12s betweenstarts',selected,requests:receipts,completedAt:null as string|null,elapsedMs:0,stopReason:'running',newMeasuredBodyBytes:0,newRetainedBytes:0,cumulativeActualRequestStarts:baseline.requestStarts,cumulativeMeasuredBodyBytes:baseline.measuredBodyBytes,cumulativeUncertainBodyBytes:baseline.uncertainBodyBytes,apiFees:'documented free public requests; no plan, key or charge authorization used',infrastructureTransferCost:'unverified; excluded from API fee statement'};
function checkpoint(){evidence.elapsedMs=performance.now()-startedMono;evidence.newMeasuredBodyBytes=totalReceivedBytes;evidence.newRetainedBytes=retainedBytes;evidence.cumulativeActualRequestStarts=baseline.requestStarts+receipts.length;evidence.cumulativeMeasuredBodyBytes=baseline.measuredBodyBytes+totalReceivedBytes;const bytes=Buffer.from(JSON.stringify(evidence,null,2)+'\n');need(retainedBytes+bytes.length<=limits.totalRetainedBytes,'RETAINED_EVIDENCE_CAP');writeFileSync(receiptPath,bytes,{mode:0o600});}
checkpoint();
for(const lead of selected){
  try{
    const wait=Math.max(0,lastStart+limits.minimumStartSpacingMs-Date.now());need(performance.now()-startedMono+wait+limits.timeoutMs<limits.maximumElapsedMs-limits.shutdownReserveMs,'ELAPSED_HEADROOM');if(wait)await delay(wait);
    need(receipts.length<limits.maximumRequests&&totalReceivedBytes<limits.totalReceivedBodyBytes-limits.perResponseBodyBytes&&process.memoryUsage().rss<=limits.maximumRssBytes,'RESOURCE_HEADROOM');
    const url=new URL(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${lead.pool}/ohlcv/minute`);url.search=new URLSearchParams({aggregate:'1',before_timestamp:'1793143038',limit:'1000',currency:'usd',token:lead.mint,include_empty_intervals:'false'}).toString();
    lastStart=Date.now();const receipt:Receipt={ordinal:receipts.length+1,mint:lead.mint,pool:lead.pool,url:url.toString(),startedAt:new Date(lastStart).toISOString(),startedUnixMs:lastStart,bodyBytes:0};receipts.push(receipt);checkpoint();
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(Error('REQUEST_TIMEOUT')),limits.timeoutMs);
    try{
      const response=await fetch(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:abort.signal});receipt.status=response.status;receipt.responseHeaders=Object.fromEntries(['date','content-type','content-length','retry-after'].map(k=>[k,response.headers.get(k)]));
      if(response.status!==200){const advertised=Number(response.headers.get('content-length'));if(Number.isSafeInteger(advertised)&&advertised>0){receipt.uncertainBodyBytes=advertised;evidence.cumulativeUncertainBodyBytes+=advertised;}await response.body?.cancel();throw Error(`HTTP_${response.status}_NO_RETRY`);}
      need(response.body,'MISSING_RESPONSE_BODY');const reader=response.body.getReader(),chunks:Buffer[]=[];try{for(;;){const {value,done}=await reader.read();if(done)break;const chunk=Buffer.from(value);receipt.bodyBytes+=chunk.length;totalReceivedBytes+=chunk.length;need(receipt.bodyBytes<=limits.applicationResponseStopBytes&&totalReceivedBytes<=limits.totalReceivedBodyBytes,'BODY_CAP');chunks.push(chunk);}}catch(error){abort.abort(error);await reader.cancel().catch(()=>{});throw error;}
      const raw=Buffer.concat(chunks),parsed=JSON.parse(raw.toString('utf8'));bars(parsed);need(retainedBytes+raw.length+65536<=limits.totalRetainedBytes,'RETAINED_HEADROOM');
      const file=join(rawDir,`${lead.mint}.json`);need(!existsSync(file),'DUPLICATE_CAPTURE');writeFileSync(file,raw,{mode:0o600});retainedBytes+=raw.length;receipt.retainedFile=file.slice(dir.length+1);receipt.sha256=sha(raw);
    }catch(error){receipt.error=error instanceof Error?error.message:'unknown error';throw error;}
    finally{clearTimeout(timer);receipt.finishedAt=new Date().toISOString();receipt.elapsedMs=Date.now()-receipt.startedUnixMs;checkpoint();}
  }catch(error){stopReason=error instanceof Error?error.message:'unknown error';break;}
}
evidence.stopReason=stopReason;evidence.completedAt=new Date().toISOString();checkpoint();console.log(JSON.stringify({receiptPath,requestStarts:receipts.length,bytes:totalReceivedBytes,retainedBytes,stopReason,elapsedMs:evidence.elapsedMs}));
