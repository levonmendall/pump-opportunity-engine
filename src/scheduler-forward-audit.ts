/** Bounded independent read audit for the one approved scheduler diagnostic.
 * Original enrichment responses are NEVER reused as independent RPC evidence.
 * Chain-time coverage and application-availability windows remain separate.
 */
import {performance} from 'node:perf_hooks';
import bs58 from 'bs58';
import {invokedCanonicalSolSwaps} from './active-selection.js';
import {decodePumpSwapInstruction,mapConfirmedPumpSwapEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';
import type {ActiveScope} from './active-pipeline.js';
import {PUMP_AMM_PROGRAM_ID} from './sdk.js';

const SWAPS=new Set(['buy','buy_exact_quote_in','buy_v2','buy_exact_quote_in_v2','sell','sell_v2']);

export const SCHEDULER_FORWARD_AUDIT_LIMITS=Object.freeze({historyPages:2,signaturesPerPage:50,independentTransactions:10,finalityRechecks:2,requestUnits:14,elapsedMs:20000});
/** Explicit bounded standing experiment; the caller still owns the shared
 * per-run request/response/time budget and physical operation gate. */
export const STANDING_MEASURED_18_AUDIT_LIMITS=Object.freeze({...SCHEDULER_FORWARD_AUDIT_LIMITS,independentTransactions:20,requestUnits:24,elapsedMs:25000});
export type ForwardAuditRpc={call<T>(method:string,params:unknown[],signal?:AbortSignal):Promise<T>;readonly budget:{readonly calls:number;readonly inFlight:number};error?:()=>Error|null};
export type ForwardAuditHint={signature:string;receivedAt:number;expectedTrade?:boolean};
export type ForwardAuditNormalization={identityKey:string;rpcAvailableAt:number;validationCompletedAt:number;duringObservation:boolean};
export type ForwardAuditCapture={openedAt:number|null;observationEndedAt?:number|null;endedAt?:number|null;closedAt?:number|null;physicalSlotUncertain?:boolean;selectedMessages?:number;duplicateSignatureHints?:number;pending?:number;qualityGaps?:Array<{at:number;reason:string}>;executedEvidence:MappedTradeEvidence[];enrichmentHints?:Record<string,{receivedAt:number;requestedAt:number;availableAt:number}>;auditSelectedHints?:ForwardAuditHint[];auditNormalizedAvailability?:ForwardAuditNormalization[];featureRows?:any[]};
export type SchedulerForwardAuditOptions={capture:ForwardAuditCapture;scope:ActiveScope;rpc:ForwardAuditRpc;record:(kind:string,data:unknown)=>void;signal:AbortSignal;target:{startAt:number;endAt:number};profile?:'standing-measured-18';now?:()=>number;monotonic?:()=>number};
type HistoryRow={signature:string;slot:number;err:unknown;blockTime:number|null};
function need(v:unknown,m:string):asserts v {if(!v)throw Error('FORWARD_AUDIT_'+m);}
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,120}$/.test(e.message)?e.message:'FORWARD_AUDIT_UNVERIFIED_RESPONSE';
function signature(s:unknown):asserts s is string {need(typeof s==='string'&&s.length<=100,'SIGNATURE');try{need(bs58.decode(s).length===64,'SIGNATURE');}catch{throw Error('FORWARD_AUDIT_SIGNATURE');}}

export async function auditSchedulerForward(options:SchedulerForwardAuditOptions){
  const {capture,scope,rpc,record,target}=options,now=options.now??Date.now,mono=options.monotonic??(()=>performance.now()),began=mono(),startedAt=now(),before=rpc.budget.calls;
  need(options.profile===undefined||options.profile==='standing-measured-18','INVALID_PROFILE');
  const limit=options.profile==='standing-measured-18'?STANDING_MEASURED_18_AUDIT_LIMITS:SCHEDULER_FORWARD_AUDIT_LIMITS,controller=new AbortController(),signal=AbortSignal.any([options.signal,controller.signal]),timer=setTimeout(()=>controller.abort(),limit.elapsedMs);timer.unref?.();
  const result:any={classification:'BOUNDED_INDEPENDENT_CHAIN_AND_CAPTURED_HINT_AUDIT',complete:false,completeScope:'Exact nominal chain interval plus every explicitly recorded selected signature; not proof of receive-window completeness',applicationAvailabilityTarget:{...target,interval:'[startAt,endAt)',timeBasis:'fully validated application availability; never chain or feed time'},chainAuditTarget:{startAt:target.startAt,endAt:target.endAt,interval:'[startAt,endAt)',boundaryExclusionMs:0,timeBasis:'on-chain blockTime seconds; separate from the application window'},limits:limit,startedAt,history:[],historyPages:[],historyRangeCovered:false,historyBoundary:null,requiredIndependentSignatures:[],independentTransactions:[],unretrievedSignatures:[],denominatorChecks:[],relevantInstructionChecks:[],compiledSwapInstructions:0,verifiedSwapEvents:0,matchedOriginalEvents:0,unmatchedOriginalEvents:[],unsupported:[],unresolvedSelectedHints:[],rechecks:[],calls:0,attemptedOperations:{history:0,independent:0,finality:0},originalResponseReuse:false,reason:null,receiveWindowCompleteness:'NOT_ESTABLISHED_BY_CHAIN_TIME_ALONE',entryEligibility:'UNVERIFIED_SEPARATE_REQUIREMENT',primaryStrategyEnabled:false,paperTradesCreated:0,financialAccountChanged:false};
  if(options.profile)result.profile=options.profile;
  const hintMap=new Map<string,ForwardAuditHint>(),independentlyRequested=new Set<string>(),independentResponsesReceived=new Set<string>();
  const problem=(reason:string,details:Record<string,unknown>={})=>result.unsupported.push({reason,...details});
  const firstQualityReason=():string|null=>result.unsupported[0]?.reason??result.unmatchedOriginalEvents[0]?.reason??result.unresolvedSelectedHints[0]?.reason??null;
  const call=async<T>(purpose:'history'|'independent'|'finality',method:string,params:unknown[]):Promise<{value:T;requestedAt:number;availableAt:number} >=>{
    const quality=firstQualityReason();if(quality)throw Error(quality);
    const existingFault=rpc.error?.();if(existingFault)throw existingFault;
    signal.throwIfAborted();need(mono()-began<limit.elapsedMs,'ELAPSED_CAP');need(rpc.budget.inFlight===0,'PHYSICAL_SLOT_UNCERTAIN');
    need(rpc.budget.calls-before<limit.requestUnits&&result.attemptedOperations.history+result.attemptedOperations.independent+result.attemptedOperations.finality<limit.requestUnits,'REQUEST_UNIT_CAP');
    const cap=purpose==='history'?limit.historyPages:purpose==='independent'?limit.independentTransactions:limit.finalityRechecks;
    need(result.attemptedOperations[purpose]<cap,'SUBALLOCATION_CAP');result.attemptedOperations[purpose]++;
    if(purpose==='independent')independentlyRequested.add(String(params[0]));
    const requestedAt=now(),value=await rpc.call<T>(method,params,signal),availableAt=now();
    if(purpose==='independent'&&value!==null&&value!==undefined)independentResponsesReceived.add(String(params[0]));
    need(mono()-began<limit.elapsedMs&&!signal.aborted,'ELAPSED_CAP');return {value,requestedAt,availableAt};
  };
  const decode=(tx:any,sig:string,at:number,commitment:'confirmed'|'finalized',history?:HistoryRow)=>{
    need(tx&&tx.transaction?.signatures?.[0]===sig,'TRANSACTION_SIGNATURE_MISMATCH');
    need(integer(tx.slot)&&integer(tx.blockTime),'TRANSACTION_CHAIN_CONTEXT');
    if(history)need(tx.slot===history.slot&&(history.blockTime===null||tx.blockTime===history.blockTime)&&(history.err===null)===(tx.meta?.err===null),'HISTORY_CONTEXT_MISMATCH');
    if(tx.meta?.err!==null){problem('FAILED_TRANSACTION',{signature:sig,commitment});return null;}
    const compiled=invokedCanonicalSolSwaps(tx).filter(s=>s.pool===scope.pool&&s.mint===scope.mint);
    // A program mention is insufficient, but a genuine AMM invocation whose
    // account list contains this pool cannot disappear as zero trades merely
    // because the packaged IDL does not recognize its new instruction bytes.
    const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
    const positioned=[...tx.transaction.message.instructions.map((ix:any,i:number)=>({ix,outerInstructionIndex:i,innerInstructionIndex:null})),...tx.meta.innerInstructions.flatMap((g:any)=>g.instructions.map((ix:any,i:number)=>({ix,outerInstructionIndex:g.index,innerInstructionIndex:i})))];
    for(const p of positioned){
      const ix=p.ix;if(keys[ix.programIdIndex]!==PUMP_AMM_PROGRAM_ID.toBase58())continue;
      need(Array.isArray(ix.accounts)&&ix.accounts.every((i:unknown)=>integer(i)&&i<keys.length),'AMM_ACCOUNT_INDICES');
      if(!ix.accounts.some((i:number)=>keys[i]===scope.pool))continue;
      need(typeof ix.data==='string'&&ix.data.length<=4096,'AMM_INSTRUCTION_BYTES');let raw:Buffer;try{raw=Buffer.from(bs58.decode(ix.data));}catch{throw Error('FORWARD_AUDIT_AMM_INSTRUCTION_BYTES');}
      let decoded:ReturnType<typeof decodePumpSwapInstruction>|null=null;try{decoded=decodePumpSwapInstruction(raw);}catch{}
      const checked={signature:sig,requestCommitment:commitment,outerInstructionIndex:p.outerInstructionIndex,innerInstructionIndex:p.innerInstructionIndex,discriminatorHex:raw.subarray(0,8).toString('hex'),instructionName:decoded?.name??null,exactRecognizedLayout:decoded?.exactLayout??false,exactPackagedLayout:decoded?.layout==='pinned-sdk',instructionLayout:decoded?.layout??null,trackVolumeAvailable:decoded?.trackVolumeAvailable??null,knownNonSwap:!!decoded&&!SWAPS.has(decoded.name)};result.relevantInstructionChecks.push(checked);
      need(decoded&&decoded.exactLayout,'RELEVANT_AMM_INSTRUCTION_UNSUPPORTED');
      need(!/^(buy|sell)(_|$)/.test(decoded.name)||SWAPS.has(decoded.name),'RELEVANT_SWAP_VARIANT_UNSUPPORTED');
    }
    const mapped=mapConfirmedPumpSwapEvidence(tx,{mint:scope.mint,pool:scope.pool,signature:sig,providerReceivedAt:null,availableAt:at});
    result.denominatorChecks.push({signature:sig,requestCommitment:commitment,compiledSwapInstructions:compiled.length,decodedSwapEvents:mapped.length});
    need(compiled.length===mapped.length,'COMPILED_SWAP_EVENT_COUNT_MISMATCH');need(mapped.every(e=>e.transferChecks.baseTransfer&&e.transferChecks.userQuoteTransfer),'EXECUTED_TRANSFER_UNVERIFIED');
    return {compiled:compiled.length,mapped,slot:tx.slot as number,blockTime:tx.blockTime as number};
  };
  const independent=new Map<string,ReturnType<typeof decode>>();
  try{
    need(integer(target.startAt)&&target.startAt%10000===0&&target.endAt===target.startAt+60000,'EXACT_CLOSED_TARGET_REQUIRED');
    const ended=capture.observationEndedAt??capture.endedAt,closed=capture.closedAt??ended;
    need(capture.openedAt!==null&&integer(capture.openedAt)&&ended!==null&&ended!==undefined&&integer(ended)&&closed!==null&&closed!==undefined&&integer(closed)&&closed>=ended,'NO_CLOSED_OBSERVATION');
    need(!capture.physicalSlotUncertain&&rpc.budget.inFlight===0,'PHYSICAL_SLOT_UNCERTAIN');
    if(capture.openedAt>target.startAt||ended<target.endAt)problem('APPLICATION_TARGET_NOT_FULLY_OBSERVED',{openedAt:capture.openedAt,endedAt:ended});
    if((capture.pending??0)>0)problem('ORIGINAL_SELECTED_WORK_REMAINS_UNRESOLVED',{pending:capture.pending});
    if(capture.qualityGaps?.length)problem('ORIGINAL_CAPTURE_QUALITY_GAP',{firstGap:capture.qualityGaps[0]});
    const explicitHints=capture.auditSelectedHints;
    if(!explicitHints)problem('EXPLICIT_SELECTED_HINT_LIST_UNAVAILABLE');
    const hints=explicitHints??Object.entries(capture.enrichmentHints??{}).map(([sig,h])=>({signature:sig,receivedAt:h.receivedAt,expectedTrade:true}));
    for(const h of hints){signature(h.signature);need(integer(h.receivedAt)&&h.receivedAt>=capture.openedAt,'HINT_RECEIPT_CONTEXT');const prior=hintMap.get(h.signature);if(!prior||h.receivedAt<prior.receivedAt)hintMap.set(h.signature,{...h});}
    result.requiredIndependentSignatures=[...new Set([...hintMap.keys(),...capture.executedEvidence.map(e=>e.identity.signature)])];
    const expectedUnique=(capture.selectedMessages??hints.length)-(capture.duplicateSignatureHints??0);if(hintMap.size<expectedUnique)problem('SELECTED_HINT_LIST_INCOMPLETE',{expectedUnique,providedUnique:hintMap.size});
    const observed=new Map(capture.executedEvidence.map(e=>[e.identityKey,e])),normalization=new Map((capture.auditNormalizedAvailability??[]).map(e=>[e.identityKey,e]));
    for(const event of capture.executedEvidence){const n=normalization.get(event.identityKey);if(!n||n.rpcAvailableAt!==event.availableAt||!integer(n.validationCompletedAt)||n.validationCompletedAt<event.availableAt||n.validationCompletedAt>startedAt)problem('ORIGINAL_VALIDATION_AVAILABILITY_UNVERIFIED',{signature:event.identity.signature,identityKey:event.identityKey});}
    const history=new Map<string,HistoryRow>();let cursor:string|undefined;
    for(let page=0;page<limit.historyPages;page++){
      const read=await call<unknown>('history','getSignaturesForAddress',[scope.pool,{commitment:'confirmed',limit:limit.signaturesPerPage,...(cursor?{before:cursor}:{})}]);
      need(Array.isArray(read.value)&&read.value.length<=limit.signaturesPerPage,'HISTORY_PAGE');const rows=read.value as HistoryRow[];
      for(let i=0;i<rows.length;i++){const row=rows[i]!;signature(row.signature);need(integer(row.slot)&&(row.blockTime===null||integer(row.blockTime))&&Object.hasOwn(row,'err')&&(row.err===null||typeof row.err==='object')&&(i===0||row.slot<=rows[i-1]!.slot),'HISTORY_ROW');const prior=history.get(row.signature);if(prior)need(JSON.stringify(prior)===JSON.stringify(row),'CONFLICTING_HISTORY_DUPLICATE');else history.set(row.signature,{...row});}
      const entry={page,requestedAt:read.requestedAt,availableAt:read.availableAt,before:cursor??null,limit:limit.signaturesPerPage,rows};result.historyPages.push(entry);record('forward-audit-signature-page',entry);
      if(rows.some(row=>row.blockTime!==null&&row.blockTime*1000<target.startAt)){result.historyRangeCovered=true;result.historyBoundary='OLDER_THAN_EXACT_TARGET_START_OBSERVED';break;}
      if(rows.length<limit.signaturesPerPage){result.historyBoundary='AVAILABLE_HISTORY_EXHAUSTED_WITHOUT_OLDER_BOUNDARY';break;}
      const next=rows.at(-1)!.signature;need(next!==cursor,'HISTORY_CURSOR_STALLED');cursor=next;
    }
    result.history=[...history.values()];if(!result.historyRangeCovered)problem('EXACT_CHAIN_HISTORY_START_BOUNDARY_UNVERIFIED');
    const chainRows=[...history.values()].filter(r=>r.err===null&&(r.blockTime===null||r.blockTime*1000>=target.startAt&&r.blockTime*1000<target.endAt));
    const required=[...new Set([...chainRows.map(r=>r.signature),...hintMap.keys(),...capture.executedEvidence.map(e=>e.identity.signature)])];result.requiredIndependentSignatures=required;
    if(required.length>limit.independentTransactions)problem('INDEPENDENT_TRANSACTION_ALLOCATION_INSUFFICIENT',{required:required.length,maximum:limit.independentTransactions});
    for(const sig of required.slice(0,limit.independentTransactions)){
      const read=await call<any>('independent','getTransaction',[sig,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}]);
      record('forward-audit-independent-transaction',{signature:sig,requestedAt:read.requestedAt,availableAt:read.availableAt,requestCommitment:'confirmed',transaction:read.value,originalResponseReused:false});
      if(!read.value){problem('INDEPENDENT_TRANSACTION_UNAVAILABLE',{signature:sig});independent.set(sig,null);continue;}
      try{
        const decoded=decode(read.value,sig,read.availableAt,'confirmed',history.get(sig));independent.set(sig,decoded);if(!decoded)continue;
        const inChainTarget=decoded.blockTime*1000>=target.startAt&&decoded.blockTime*1000<target.endAt;
        if(inChainTarget&&decoded.compiled>0&&!history.has(sig))problem('HISTORY_OMITTED_KNOWN_TRANSACTION',{signature:sig,slot:decoded.slot,chainBlockTime:decoded.blockTime});
        for(const event of capture.executedEvidence.filter(e=>e.identity.signature===sig))if(event.slot!==decoded.slot||event.chainBlockTime!==null&&event.chainBlockTime!==decoded.blockTime)problem('ORIGINAL_CHAIN_CONTEXT_CHANGED',{signature:sig,originalSlot:event.slot,independentSlot:decoded.slot,originalBlockTime:event.chainBlockTime,independentBlockTime:decoded.blockTime});
        if(inChainTarget){result.compiledSwapInstructions+=decoded.compiled;result.verifiedSwapEvents+=decoded.mapped.length;}
        const events=decoded.mapped.map(e=>{const original=observed.get(e.identityKey),same=original?.fingerprint===e.fingerprint,usable=normalization.get(e.identityKey);if(inChainTarget&&same)result.matchedOriginalEvents++;if(!same)result.unmatchedOriginalEvents.push({signature:sig,identity:e.identity,reason:original?'EXECUTED_CONTENT_CHANGED':'ONCHAIN_SWAP_NOT_ORIGINALLY_NORMALIZED'});return {identity:e.identity,identityKey:e.identityKey,fingerprint:e.fingerprint,matchedOriginal:same,originalRpcAvailableAt:original?.availableAt??null,originalValidationCompletedAt:usable?.validationCompletedAt??null,validationInsideApplicationTarget:usable?usable.validationCompletedAt>=target.startAt&&usable.validationCompletedAt<target.endAt:null,independentAvailableAt:read.availableAt};});
        result.independentTransactions.push({signature:sig,requestedAt:read.requestedAt,availableAt:read.availableAt,slot:decoded.slot,chainBlockTime:decoded.blockTime,inChainTarget,compiledSwapInstructions:decoded.compiled,events});
        if(hintMap.has(sig)&&decoded.mapped.length===0&&hintMap.get(sig)!.expectedTrade!==false)problem('SELECTED_HINT_WITHOUT_SUPPORTED_SWAP',{signature:sig});
      }catch(e){problem(safe(e),{signature:sig});independent.set(sig,null);}
    }
    result.unretrievedSignatures=required.filter(sig=>!independent.has(sig));
    for(const [sig,hint]of hintMap){
      const decoded=independent.get(sig),originals=capture.executedEvidence.filter(e=>e.identity.signature===sig),validated=originals.length>0&&originals.every(e=>{const n=normalization.get(e.identityKey);return n&&integer(n.validationCompletedAt)&&n.validationCompletedAt>=e.availableAt;});
      if(!decoded||!validated)result.unresolvedSelectedHints.push({signature:sig,providerReceivedAt:hint.receivedAt,receivedAfterTargetClose:hint.receivedAt>=target.endAt,receivedAfterObservationClose:hint.receivedAt>ended,chainTargetMembership:decoded?decoded.blockTime*1000>=target.startAt&&decoded.blockTime*1000<target.endAt?'INSIDE':'OUTSIDE':'UNKNOWN',reason:!decoded?'INDEPENDENT_CHAIN_CONTEXT_UNRESOLVED':'ORIGINAL_FULLY_VALIDATED_AVAILABILITY_UNRESOLVED',laterAuditDoesNotRepairOriginalWindow:true});
    }
    if((capture.pending??0)>0)problem('ORIGINAL_SELECTED_WORK_REMAINS_UNRESOLVED',{pending:capture.pending});
    if(result.verifiedSwapEvents===0)problem('ZERO_SUPPORTED_SWAP_DENOMINATOR');
    const finalityCandidates=[...independent].filter(([,d])=>d&&d.mapped.length>0).slice(0,limit.finalityRechecks);
    for(const [sig,original]of finalityCandidates){
      const read=await call<any>('finality','getTransaction',[sig,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1}]);let identical:boolean|null=null;
      if(read.value){try{const current=decode(read.value,sig,read.availableAt,'finalized');identical=!!current&&current.slot===original!.slot&&current.blockTime===original!.blockTime&&current.mapped.length===original!.mapped.length&&current.mapped.every(e=>original!.mapped.some(o=>o.identityKey===e.identityKey&&o.fingerprint===e.fingerprint));}catch{identical=false;}}
      if(identical!==true)problem(read.value?'FINALIZED_EXECUTED_CONTENT_CHANGED':'FINALITY_PENDING_NOT_A_REVERSAL',{signature:sig});
      const row={signature:sig,requestedAt:read.requestedAt,availableAt:read.availableAt,requestCommitment:'finalized',finalizedAvailable:!!read.value,executedEvidenceIdentical:identical};result.rechecks.push(row);record('forward-audit-finalized-recheck',{...row,transaction:read.value});
    }
    const rawRows=(capture.featureRows??[]).filter(r=>r.curve?.windowStartAt===target.startAt&&r.curve?.windowEndAt===target.endAt&&r.user?.windowStartAt===target.startAt&&r.user?.windowEndAt===target.endAt&&r.curve.sufficientlyObserved===true&&r.user.sufficientlyObserved===true&&r.fullyEnriched===true&&r.at>=target.endAt&&!(capture.qualityGaps??[]).some(g=>g.at>=target.startAt&&g.at<=r.at));
    result.applicationTargetReadiness={rawReadyFeatureRows:rawRows,rawReadyClosedTargetWindows:rawRows.length?1:0,independentlyProvenReceiveWindowCompleteness:false,explanation:'Independent blockTime coverage audits a separate chain interval. Original validated receive times remain explicit, including events before/after this target; later audit data never enters the original feature window.'};
    need(mono()-began<limit.elapsedMs&&!signal.aborted,'ELAPSED_OR_ABORT_CAP');
    result.complete=result.historyRangeCovered&&result.unsupported.length===0&&result.unretrievedSignatures.length===0&&result.unresolvedSelectedHints.length===0&&result.unmatchedOriginalEvents.length===0&&result.verifiedSwapEvents>0&&result.matchedOriginalEvents===result.verifiedSwapEvents&&result.rechecks.length===finalityCandidates.length;
    result.reason=result.complete?'BOUNDED_CHAIN_INTERVAL_AND_RECORDED_HINTS_MATCHED':firstQualityReason()??'INCOMPLETE_DENOMINATOR_OR_ORIGINAL_AVAILABILITY';
  }catch(e){result.reason=firstQualityReason()??safe(e);}
  finally{
    clearTimeout(timer);result.calls=rpc.budget.calls-before;result.finishedAt=now();result.elapsedMs=mono()-began;result.physicalSlotUncertain=rpc.budget.inFlight!==0;
    result.independentTransactionAttempts=[...independentlyRequested];result.unretrievedSignatures=result.requiredIndependentSignatures.filter((sig:string)=>!independentResponsesReceived.has(sig));
    for(const [sig,hint]of hintMap)if(!result.unresolvedSelectedHints.some((h:any)=>h.signature===sig)&&!independent.get(sig))result.unresolvedSelectedHints.push({signature:sig,providerReceivedAt:hint.receivedAt,receivedAfterTargetClose:hint.receivedAt>=target.endAt,receivedAfterObservationClose:hint.receivedAt>(capture.observationEndedAt??capture.endedAt??0),chainTargetMembership:'UNKNOWN',reason:'INDEPENDENT_CHAIN_CONTEXT_UNRESOLVED',laterAuditDoesNotRepairOriginalWindow:true});
    result.firstQualityFailure=firstQualityReason();
    if(result.physicalSlotUncertain){result.complete=false;result.reason='FORWARD_AUDIT_PHYSICAL_SLOT_UNCERTAIN';}
    if(result.elapsedMs>=limit.elapsedMs||signal.aborted){result.complete=false;result.reason='FORWARD_AUDIT_ELAPSED_OR_ABORT_CAP';}
    result.stopsOnFirstQualityFailure=true;result.noRetry=true;result.laterAuditInformationBackdated=false;
  }
  return result;
}
