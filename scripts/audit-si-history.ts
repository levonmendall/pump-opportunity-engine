/** Bounded historical SI audit. Public read-only RPC; no ledger connection. */
import {appendFileSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PilotRpc} from '../src/pilot-rpc.js';
import {mapConfirmedPumpSwapEvidence,inspectScopedPumpSwapInstructions,toResearchNormalizedTrade} from '../src/pumpapi-mapping.js';

const privateRoot='/workspace/poe-pilot',manifestPath=join(privateRoot,'pilot.json');
const out='evidence/opportunity-coverage-20261027';
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
const runId='pilot-si-history-'+stamp,runDir=join(privateRoot,'runs',runId);
const pool='3guuqmtbVjQvY3mTQqMc2M7k33gZG8cyVrHrpYMzixL2';
const globalCursor=process.argv.includes('--retained-temporal-cursor');
const anchor=globalCursor?'LuHGSF7H2wouHfHVGArgt72Fi1jf14P1merSyXZ2Lc84DuECmXCDbE8i9WEfaUgzpbQux3jFKbwntU7qGsccSJA':'42LsRDR3p8bhEaz6gs8Y8qZuffa6Y6QM1bXiwSeZ79hUv81kGUpAU9gG6m3BMQDtyizQsZzAcnm22f15sJ44Paac';
const until='iEcoiH3MNTd6hPcN2z5x3pLNLNnxuSKKpGe1QCt4o14yqhXyxyKAGLnAFGeuXWvRxYgmBRPqbgwgsjgsic267dK';
const lastPrestopWindow=process.argv.includes('--last-prestop-window');
const targetStart=Date.parse(lastPrestopWindow?'2026-10-27T20:26:00Z':'2026-10-27T20:25:20Z')/1000;
const enrich=process.argv.includes('--enrich-window'),resumePartial=process.argv.includes('--resume-partial'),limits={requestUnits:lastPrestopWindow?8:resumePartial?32:enrich?42:8,responseBytes:(enrich?16:8)*1024*1024,durationMs:enrich?180000:120000,retainedBytes:(enrich?12:6)*1024*1024};
const mappedRows:any[]=[];
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
if(manifest.accountId!=='poe-pilot-8468add6-f916-48cf-a585-6cd008a81360'||manifest.unresolvedResearch)throw Error('verified existing isolated account and settled prior research required');
mkdirSync(runDir,{mode:0o700});mkdirSync(out,{recursive:true});
const persist=()=>{const tmp=manifestPath+'.history-pending';writeFileSync(tmp,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,manifestPath);};
const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,at:Date.now(),data})+'\n';if(Buffer.byteLength(line)>1024*1024)throw Error('bounded audit event');appendFileSync(join(runDir,'events.ndjson'),line,{mode:0o600});};
manifest.runs.push(runId);manifest.unresolvedResearch={runId,rpcDirectory:join(runDir,'rpc'),pid:process.pid};persist();
let rpc:PilotRpc|undefined;let rawBytes=0;const calls:any[]=[],pages:any[]=[],startedAt=Date.now();let failure:string|null=null;
const save=(label:string,value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value)+'\n');if(rawBytes+bytes.length>limits.retainedBytes)throw Error('historical retained-evidence cap');rawBytes+=bytes.length;const file=join(out,'si-'+label+'-'+stamp+'.json');writeFileSync(file,bytes,{flag:'wx',mode:0o600});return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
try{
  rpc=new PilotRpc({directory:join(runDir,'rpc'),runId,baselinePaths:manifest.baselinePaths,priorPhysicalSettled:true,priorCooldownUntil:manifest.cooldownUntil,durationMs:limits.durationMs,maxUnits:limits.requestUnits,maxResponseBytes:limits.responseBytes,maxChapters:2,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,record});
  const call=async(method:string,params:unknown[],label:string)=>{const requestedAt=Date.now();const value=await rpc!.call<any>(method,params);const availableAt=Date.now(),artifact=save(label,value);calls.push({method,params,requestedAt,availableAt,artifact,informationAvailability:'retrieved now for historical audit; not backdated into POE decisions'});return value;};
  if(!enrich){
  const tx=await call('getTransaction',[anchor,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}],'anchor-transaction');
  if(!tx||tx.meta?.err!==null||tx.slot!==(globalCursor?462205500:462220183)||!Number.isSafeInteger(tx.blockTime))throw Error('retained SI anchor failed independent context verification');
  let before=anchor;
  for(let i=0;i<2;i++){
    const rows=await call('getSignaturesForAddress',[pool,{before,until,limit:1000,commitment:'confirmed'}],'history-page-'+(i+1));
    if(!Array.isArray(rows)||rows.length>1000)throw Error('invalid bounded historical page');
    let previous=Infinity;const seen=new Set<string>();for(const r of rows){if(typeof r.signature!=='string'||!Number.isSafeInteger(r.slot)||r.slot>previous||seen.has(r.signature)||!Object.hasOwn(r,'err'))throw Error('malformed historical identity/context');if(r.slot>tx.slot)throw Error('cursor context failed historical upper bound');previous=r.slot;seen.add(r.signature);}
    const times=rows.map(r=>r.blockTime).filter(Number.isSafeInteger);pages.push({rows:rows.length,newestChainTime:times.length?Math.max(...times):null,oldestChainTime:times.length?Math.min(...times):null,successfulRows:rows.filter(r=>r.err===null).length});
    if(rows.length<1000||times.length&&Math.min(...times)<=targetStart)break;
    before=rows.at(-1)!.signature;
  }
  }else{
    const history=JSON.parse(readFileSync(join(out,'si-history-page-1-20261027232707767.json'),'utf8')) as any[];
    const selected=history.filter(r=>r.err===null&&Number.isSafeInteger(r.blockTime)&&r.blockTime>=targetStart&&r.blockTime<targetStart+60).reverse();
    const expected=lastPrestopWindow?43:37;if(selected.length!==expected||new Set(selected.map(r=>r.signature)).size!==expected)throw Error('predeclared historical transaction count mismatch');
    record('si-historical-window-plan',{start:targetStart,end:targetStart+60,successfulPoolTransactions:expected,knownFailedTransactionsExcluded:history.filter(r=>r.err!==null&&r.blockTime>=targetStart&&r.blockTime<targetStart+60).length,informationAvailability:'All fetched now; retrospective chain-time scenarios are not actual POE observations.'});
    const priorFile=lastPrestopWindow?'si-history-receipt-20261027234046662.json':'si-history-receipt-20261027232852598.json';
    const prior=resumePartial?JSON.parse(readFileSync(join(out,priorFile),'utf8')):null;
    let lastPhysicalStart=0;
    for(const row of selected){
      while(Date.now()<rpc!.methodReadyAt('getTransaction'))await new Promise(r=>setTimeout(r,Math.min(100,rpc!.methodReadyAt('getTransaction')-Date.now())));
      const cached=prior?.calls.find((c:any)=>c.method==='getTransaction'&&c.params[0]===row.signature);
      let tx:any;
      if(cached){const bytes=readFileSync(cached.artifact.file);if(createHash('sha256').update(bytes).digest('hex')!==cached.artifact.sha256)throw Error('retained response hash mismatch');tx=JSON.parse(bytes.toString());calls.push({...cached,reusedRetainedResponse:true,newRequestUnits:0});}
      else{const wait=Math.max(0,lastPhysicalStart+2000-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));lastPhysicalStart=Date.now();tx=await call('getTransaction',[row.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}],'window-tx-'+String(mappedRows.length).padStart(2,'0'));}
      if(!tx||tx.meta?.err!==null||tx.slot!==row.slot||tx.blockTime!==row.blockTime)throw Error('independent historical transaction context mismatch');
      const availableAt=Date.now();
      try{const inspections=inspectScopedPumpSwapInstructions(tx,{signature:row.signature,mint:'5fYBASRkQ7GHypQMShaYRWUyXQ74tbwZ51hBfzPXpump',pool});
        const mapped=mapConfirmedPumpSwapEvidence(tx,{signature:row.signature,mint:'5fYBASRkQ7GHypQMShaYRWUyXQ74tbwZ51hBfzPXpump',pool,providerReceivedAt:null,availableAt});
        const normalized=mapped.map(m=>toResearchNormalizedTrade(m,'curve','historical canonical SI identity; original finalized proof retained'));
        mappedRows.push({signature:row.signature,slot:row.slot,chainBlockTime:row.blockTime,availableAt,inspections,mapped,normalized,retrospectiveOnly:true});
      }catch(error){mappedRows.push({signature:row.signature,slot:row.slot,chainBlockTime:row.blockTime,availableAt,error:error instanceof Error?error.message:'mapping unavailable',windowMustNotBeClaimedComplete:true});}
    }
    save('historical-window-mapping',mappedRows);
  }
}catch(error){failure=error instanceof Error?error.message:'historical RPC unavailable';}
finally{
  if(enrich&&mappedRows.length)save('historical-window-mapping-partial-or-complete',mappedRows);
  let settled=false;try{rpc?.close();settled=!!rpc&&!rpc.usage().inFlight;}catch{}
  if(rpc){const u=rpc.usage();manifest.baselinePaths=u.chapterPaths;manifest.cooldownUntil=u.cooldownUntil;manifest.controlCooldownUntil=Math.max(manifest.controlCooldownUntil??0,u.controlCooldownUntil);if(settled)delete manifest.unresolvedResearch;persist();}
  const receipt={purpose:'Independent bounded SI historical on-chain audit',runId,startedAt,finishedAt:Date.now(),pool,anchor,cursorMeaning:globalCursor?'Verified different-pool transaction used only as a temporal cursor; not labeled a SI trade. Response slot upper bound checked.':'Verified retained SI Sell transaction',until,targetStart,mode:enrich?'historical-window-enrichment':'bounded-history',resumesPartialReceipt:resumePartial?(lastPrestopWindow?'si-history-receipt-20261027234046662.json':'si-history-receipt-20261027232852598.json'):null,newTransactionSpacingMs:resumePartial?2000:null,limits:{...limits,pages:enrich?0:2},mapping:{transactions:mappedRows.length,errors:mappedRows.filter(r=>r.error).length,trades:mappedRows.reduce((n,r)=>n+(r.mapped?.length??0),0)},calls,pages,failure,rawBytes,physicalSettled:settled,usage:rpc?.usage()??null,financialWriterOpened:false,financialExecution:false,productionChanged:false};
  writeFileSync(join(out,'si-history-receipt-'+stamp+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({runId,pages,failure,rawBytes,newUnits:rpc?.usage().newUnits,cumulativeUnits:rpc?.usage().cumulativeUnits,physicalSettled:settled}));
}
if(failure)process.exitCode=1;
