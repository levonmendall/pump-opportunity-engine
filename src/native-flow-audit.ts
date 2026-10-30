/** Bounded, read-only signature-history audit. The injected caller owns every
 * request, timeout, cooldown and physical-settlement counter. No own client,
 * retries, historical trade reconstruction or financial writer lives here. */
import bs58 from 'bs58';
import type {NativeNotification} from './pilot-native-flow.js';
import type {PilotRpcCallOptions} from './pilot-rpc.js';

export type NativeAuditHistoryRow={signature:string;slot:number;success:boolean;blockTime:number|null;confirmationStatus:'confirmed'|'finalized'};
/** Ephemeral, pool-bound contiguous finalized suffix from a verified audit.
 * Never restored from packets/checkpoints or accepted without a fresh overlap. */
export type NativeAuditHistoryCache={pool:string;validatedAt:number;rows:NativeAuditHistoryRow[]};
type Fence={signature:string;slot:number;receivedAt:number;availableAt:number};
export type NativeAuditContextFences={lower:{slot:number;availableAt:number;bankClockAt?:number};upper:{slot:number;availableAt:number;bankClockAt:number}};
export type NativeAuditNotificationGeneration={mint:string;pool:string;openedAt:number;connectionId:number;subscriptionId:number};
type Page={page:number;requestedLimit:100|1000;rows:number;newestSlot:number|null;oldestSlot:number|null;receivedAt:number;validatedAt:number};
export type NativeFlowAuditResult={
 schemaVersion:1;classification:'BOUNDED_CONFIRMED_POOL_SIGNATURE_WINDOW_AUDIT';status:'verified'|'unusable'|'unavailable';reason:string;
 complete:boolean;pool:string;target:{startAt:number;endAt:number};startedAt:number;availableAt:number;
 anchor:Fence|null;lowerFence:Fence|null;strictInteriorSlots:{lower:number;upper:number}|null;historyRangeCovered:boolean;
 anchorKind:'notification'|'confirmed-bank-context'|null;contextFences:NativeAuditContextFences|null;
 requestAttempts:number;maximumPages:number;pageLimit:100|1000;adaptivePageSizing:boolean;completenessScope:'all-notifications'|'executed-transactions';notificationCompletenessVerified:boolean;executedFlowCompletenessVerified:boolean;pages:Page[];historyPayloadBytes:number;historyRows:number;interiorRows:number;
 requiredSignatures:string[];comparedSignatures:string[];missingNotifications:NativeAuditHistoryRow[];missingFailedNotifications:NativeAuditHistoryRow[];missingSuccessfulNotifications:NativeAuditHistoryRow[];unconfirmedCapturedSignatures:string[];
 statusDisagreements:string[];boundaryExcludedSignatures:string[];duplicateNotifications:number;retryAt:number|null;
 scope:string;limitations:readonly string[];
 notificationSnapshot:{capturedAt:number;rows:number;requiredRows:number};
 postSnapshotTail:{enabled:boolean;generation:NativeAuditNotificationGeneration|null;refreshedAt:number|null;rows:number;addedSignatures:string[];addedPackets:Array<Pick<NativeNotification,'signature'|'slot'|'receivedAt'|'availableAt'|'success'|'rawHash'>>;matchedInteriorSignatures:string[];meaning:string};
};
export type NativeFlowAuditOptions={
 pool:string;notifications:readonly NativeNotification[];target:{startAt:number;endAt:number};
 call:<T>(method:string,params:unknown[],signal?:AbortSignal,options?:PilotRpcCallOptions)=>Promise<T>;
 now?:()=>number;signal?:AbortSignal;admission?:PilotRpcCallOptions;maximumPages?:number;maximumElapsedMs?:number;pageLimit?:100|1000;
 /** Opt-in: start with100 for a sparse captured target, otherwise1000; escalate
  * only after a full small page fails to cover the independent lower fence. */
 adaptivePageSizing?:boolean;
 /** Default packet census is preserved. Executed-flow mode tolerates ONLY an
  * independently confirmed failed history row missing from source packets. */
 completenessScope?:'all-notifications'|'executed-transactions';
 /** Actual local packets that became available after the immutable audit
  * snapshot. Diagnostic history corroboration ONLY, never target features. */
 notificationGeneration?:NativeAuditNotificationGeneration;
 postSnapshotNotifications?:(startedAt:number)=>readonly NativeNotification[];
 record?:(kind:string,data:unknown)=>void;
 /** Already decoded/validated coherent confirmed SDK+Clock contexts. A slot
  * number alone is insufficient; upper bank Clock must reach the target end. */
 contextFences?:NativeAuditContextFences;
 reusableHistory?:NativeAuditHistoryCache;
 onVerifiedHistory?:(cache:NativeAuditHistoryCache)=>void;
};
const limitations=Object.freeze([
 'The denominator is bounded confirmed pool-address history between strict slot fences, not a whole-market census or proof that every row is a swap.',
 'Boundary slots are excluded. Every target-window signature must lie strictly inside both fences; ambiguous boundaries do not pass.',
 'Local receipt and complete-validation timestamps remain distinct from chain blockTime. Historical information is available only after this audit completes.',
 'The anchor is an actual captured confirmed notification, not a separately fetched full transaction. Signature history does not establish SPL transfer checks or missing trade amounts.',
 'Every history page requests minContextSlot at the original upper fence. This is a served-node lower bound, not a per-response bank context or an atomic history snapshot.',
 'Context-fence mode uses caller-validated coherent confirmed SDK/Clock state. Its bank Clock is not getBlockTime or an invented wall-time timestamp for each trade.',
 'Caller must separately require a fresh complete source window, unchanged candidate generation, supported identity and current strategy eligibility.',
 'Injected scheduler owns physical request counts, response bytes, timeouts, cooldowns and cancellation settlement; requestAttempts are callback attempts, not additional provider allowances.',
 'Opt-in executed-transactions completeness may retain missing independently confirmed failed rows as diagnostics; this is not full notification completeness and never excuses missing successful or unknown-status activity.',
 'Each page records its actual requested limit. Adaptive sizing does not skip history rows, extend deadlines, raise page count or establish provider throughput.',
 'An opt-in local post-snapshot tail may corroborate interior history after actual arrival, without changing original target signatures, slot fences or feature availability. Missing successful activity remains blocking.',
 'Finalized history may reuse only a prior verified contiguous suffix reached by a fresh exact finalized overlap. historyRows includes those denominator rows; pages, requestAttempts and historyPayloadBytes describe fresh calls only. Reused rows are recorded separately for replay.'
]);
const int=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
function need(v:unknown,reason:string):asserts v{if(!v)throw Error('NATIVE_AUDIT_'+reason);}
function key(value:unknown,bytes:number){try{return typeof value==='string'&&value.length<=100&&bs58.decode(value).length===bytes;}catch{return false;}}
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,150}$/.test(e.message)?e.message:'NATIVE_AUDIT_UNAVAILABLE';

export async function auditNativeFlowWindow(options:NativeFlowAuditOptions):Promise<NativeFlowAuditResult>{
 const now=options.now??Date.now,startedAt=now(),target={...options.target};let lastAt=startedAt,open=true;
 const maximumPages=options.maximumPages??4,maximumElapsedMs=options.maximumElapsedMs??10000,pageLimit=options.pageLimit??100,adaptivePageSizing=options.adaptivePageSizing??false,completenessScope=options.completenessScope??'all-notifications';
 const result:NativeFlowAuditResult={schemaVersion:1,classification:'BOUNDED_CONFIRMED_POOL_SIGNATURE_WINDOW_AUDIT',status:'unavailable',reason:'NATIVE_AUDIT_NOT_COMPLETED',complete:false,pool:options.pool,target,startedAt,availableAt:startedAt,anchor:null,lowerFence:null,strictInteriorSlots:null,anchorKind:null,contextFences:null,historyRangeCovered:false,requestAttempts:0,maximumPages,pageLimit,adaptivePageSizing,completenessScope,notificationCompletenessVerified:false,executedFlowCompletenessVerified:false,pages:[],historyPayloadBytes:0,historyRows:0,interiorRows:0,requiredSignatures:[],comparedSignatures:[],missingNotifications:[],missingFailedNotifications:[],missingSuccessfulNotifications:[],unconfirmedCapturedSignatures:[],statusDisagreements:[],boundaryExcludedSignatures:[],duplicateNotifications:0,retryAt:null,scope:completenessScope==='executed-transactions'?'Exact target application-availability executed-transaction flow, with missing independently confirmed failed packets retained separately; not full notification coverage.':'Exact target application-availability window, audited conservatively within independently retrieved strict-interior pool-address signature history.',limitations,notificationSnapshot:{capturedAt:startedAt,rows:Array.isArray(options.notifications)?options.notifications.length:0,requiredRows:0},postSnapshotTail:{enabled:options.postSnapshotNotifications!==undefined,generation:null,refreshedAt:null,rows:0,addedSignatures:[],addedPackets:[],matchedInteriorSignatures:[],meaning:'Actual post-snapshot packet diagnostics only; original target availability and features unchanged.'}};
 const clock=()=>{const at=now();need(int(at)&&at>=lastAt&&at>=startedAt,'CLOCK_REGRESSION');lastAt=at;need(at-startedAt<=maximumElapsedMs,'ELAPSED_LIMIT');return at;};
 const finish=(status:NativeFlowAuditResult['status'],reason:string,coverage?:{notifications:boolean;executed:boolean})=>{const availableAt=clock();result.status=status;result.reason=reason;result.complete=status==='verified';result.availableAt=availableAt;result.notificationCompletenessVerified=result.complete&&coverage?.notifications===true;result.executedFlowCompletenessVerified=result.complete&&coverage?.executed===true;return result;};
 try{
  need(int(startedAt)&&key(options.pool,32)&&int(maximumPages)&&maximumPages>=1&&maximumPages<=6&&int(maximumElapsedMs)&&maximumElapsedMs>=1&&maximumElapsedMs<=10000&&(pageLimit===100||pageLimit===1000)&&typeof adaptivePageSizing==='boolean'&&['all-notifications','executed-transactions'].includes(completenessScope),'INVALID_OPTIONS');
  const generation=options.notificationGeneration?{...options.notificationGeneration}:null;
  need(options.postSnapshotNotifications===undefined||typeof options.postSnapshotNotifications==='function'&&generation!==null,'TAIL_OPTIONS');
  if(generation)need(key(generation.mint,32)&&generation.pool===options.pool&&int(generation.openedAt)&&generation.openedAt<=target.startAt&&int(generation.connectionId)&&int(generation.subscriptionId),'TAIL_GENERATION');
  result.postSnapshotTail.generation=generation;
  need(int(target.startAt)&&int(target.endAt)&&target.endAt-target.startAt===60000&&target.startAt%10000===0&&target.endAt%10000===0&&target.endAt<=startedAt,'INVALID_TARGET');
  need(Array.isArray(options.notifications)&&options.notifications.length<=8192,'NOTIFICATION_BOUND');
  const cache=options.reusableHistory?structuredClone(options.reusableHistory):null;
  if(cache){
   need(cache.pool===options.pool&&int(cache.validatedAt)&&cache.validatedAt<=startedAt&&Array.isArray(cache.rows)&&cache.rows.length<=6000,'HISTORY_CACHE_BINDING');
   const signatures=new Set<string>();let previous=Infinity;for(const r of cache.rows){need(key(r.signature,64)&&!signatures.has(r.signature)&&int(r.slot)&&r.slot<=previous&&typeof r.success==='boolean'&&(r.blockTime===null||int(r.blockTime))&&r.confirmationStatus==='finalized','HISTORY_CACHE_SCHEMA');signatures.add(r.signature);previous=r.slot;}
  }
  const captured=new Map<string,NativeNotification>(),all:NativeNotification[]=[];
  for(const raw of options.notifications){
   const n={...raw};need(key(n.signature,64)&&int(n.slot)&&int(n.receivedAt)&&int(n.availableAt)&&n.receivedAt<=n.availableAt&&n.availableAt<=startedAt&&typeof n.success==='boolean'&&typeof n.duplicate==='boolean'&&typeof n.correction==='boolean'&&/^[a-f0-9]{64}$/.test(n.rawHash)&&['failed-transaction','program-event','nontrade','unusable'].includes(n.classification),'NOTIFICATION_SCHEMA');
   all.push(n);const prior=captured.get(n.signature);if(prior){result.duplicateNotifications++;if(prior.slot!==n.slot||prior.success!==n.success||prior.rawHash!==n.rawHash||n.correction)return finish('unusable','NATIVE_AUDIT_CAPTURED_CORRECTION');if(n.availableAt<prior.availableAt)captured.set(n.signature,n);}else captured.set(n.signature,n);
  }
  const required=[...captured.values()].filter(n=>n.availableAt>=target.startAt&&n.availableAt<target.endAt);result.requiredSignatures=required.map(n=>n.signature);result.notificationSnapshot.requiredRows=required.length;
  if(all.some(n=>n.availableAt>=target.startAt&&n.availableAt<target.endAt&&(n.classification==='unusable'||n.correction)))return finish('unusable','NATIVE_AUDIT_UNUSABLE_TARGET_INFORMATION');
  const minimumRequired=required.length?Math.min(...required.map(n=>n.slot)):Infinity,maximumRequired=required.length?Math.max(...required.map(n=>n.slot)):-1;
  let lowerSlot:number,upperSlot:number,before:string|undefined,previousSlot:number;
  if(options.contextFences){
   const contexts={lower:{...options.contextFences.lower},upper:{...options.contextFences.upper}},lo=contexts.lower,hi=contexts.upper;
   need(int(lo.slot)&&int(hi.slot)&&lo.slot<hi.slot&&int(lo.availableAt)&&lo.availableAt<=target.startAt&&int(hi.availableAt)&&hi.availableAt>=target.endAt&&hi.availableAt<=startedAt&&int(hi.bankClockAt)&&hi.bankClockAt>=target.endAt&&hi.bankClockAt<=hi.availableAt&&startedAt-hi.bankClockAt<=30000,'CONTEXT_FENCE_INVALID_OR_STALE');
   need(lo.bankClockAt===undefined||int(lo.bankClockAt)&&lo.bankClockAt<=lo.availableAt&&lo.availableAt-lo.bankClockAt<=30000,'LOWER_CONTEXT_CLOCK_INVALID');
   result.contextFences=contexts;result.anchorKind='confirmed-bank-context';lowerSlot=lo.slot;upperSlot=hi.slot;
   const observedLower=[...captured.values()].filter(n=>n.receivedAt<target.startAt&&n.availableAt<target.startAt&&n.slot>lowerSlot&&n.slot<minimumRequired&&n.slot<upperSlot&&!n.correction&&n.classification!=='unusable').sort((a,b)=>b.slot-a.slot||b.availableAt-a.availableAt)[0];
   if(observedLower){lowerSlot=observedLower.slot;result.lowerFence={signature:observedLower.signature,slot:observedLower.slot,receivedAt:observedLower.receivedAt,availableAt:observedLower.availableAt};}
   const anchor=[...captured.values()].filter(n=>n.receivedAt>=target.endAt&&n.slot>=upperSlot&&!n.correction&&n.classification!=='unusable').sort((a,b)=>b.receivedAt-a.receivedAt)[0];
   if(anchor){result.anchor={signature:anchor.signature,slot:anchor.slot,receivedAt:anchor.receivedAt,availableAt:anchor.availableAt};before=anchor.signature;previousSlot=anchor.slot;}else previousSlot=Infinity;
  }else{
   const anchor=[...captured.values()].filter(n=>n.receivedAt>=target.endAt&&n.availableAt>=target.endAt&&n.slot>maximumRequired&&!n.correction&&n.classification!=='unusable').sort((a,b)=>b.receivedAt-a.receivedAt||b.availableAt-a.availableAt)[0];
   if(!anchor)return finish('unavailable','NATIVE_AUDIT_POST_WINDOW_SLOT_FENCE_UNAVAILABLE');
   const lower=[...captured.values()].filter(n=>n.receivedAt<target.startAt&&n.availableAt<target.startAt&&n.slot<minimumRequired&&n.slot<anchor.slot&&!n.correction&&n.classification!=='unusable').sort((a,b)=>b.slot-a.slot||b.availableAt-a.availableAt)[0];
   if(!lower)return finish('unavailable','NATIVE_AUDIT_PRE_WINDOW_SLOT_FENCE_UNAVAILABLE');
   result.anchor={signature:anchor.signature,slot:anchor.slot,receivedAt:anchor.receivedAt,availableAt:anchor.availableAt};result.lowerFence={signature:lower.signature,slot:lower.slot,receivedAt:lower.receivedAt,availableAt:lower.availableAt};result.anchorKind='notification';lowerSlot=lower.slot;upperSlot=anchor.slot;before=anchor.signature;previousSlot=anchor.slot;
  }
  result.strictInteriorSlots={lower:lowerSlot,upper:upperSlot};if(required.some(n=>n.slot<=lowerSlot||n.slot>=upperSlot))return finish('unavailable','NATIVE_AUDIT_TARGET_SLOT_BOUNDARY_AMBIGUOUS');
  result.boundaryExcludedSignatures=[...captured.values()].filter(n=>n.slot===lowerSlot||n.slot===upperSlot).map(n=>n.signature);
  const history:NativeAuditHistoryRow[]=[],seen=new Set<string>();let requestedLimit:100|1000=adaptivePageSizing&&pageLimit===1000&&required.length<100?100:pageLimit;
  for(let page=0;page<maximumPages;page++){
   options.signal?.throwIfAborted();clock();if(options.admission?.admissionOpen&&!options.admission.admissionOpen())return finish('unavailable','NATIVE_AUDIT_ADMISSION_CLOSED');
   const requestOptions:PilotRpcCallOptions={...options.admission,latestStartAt:Math.min(options.admission?.latestStartAt??Infinity,startedAt+maximumElapsedMs),admissionOpen:()=>open&&!options.signal?.aborted&&now()>=startedAt&&now()-startedAt<=maximumElapsedMs&&(options.admission?.admissionOpen?.()??true)};
   result.requestAttempts++;const payload=await options.call<unknown>('getSignaturesForAddress',[options.pool,{...(before?{before}:{}),limit:requestedLimit,commitment:'confirmed',minContextSlot:upperSlot}],options.signal,requestOptions),receivedAt=clock();
   need(Array.isArray(payload)&&payload.length<=requestedLimit,'HISTORY_PAGE_SCHEMA');const pageBytes=Buffer.byteLength(JSON.stringify(payload));result.historyPayloadBytes+=pageBytes;need(pageBytes<=(requestedLimit===1000?1024*1024:256*1024),'HISTORY_PAGE_PAYLOAD_LIMIT');
   const rows:NativeAuditHistoryRow[]=[];for(const r of payload){need(r&&key(r.signature,64)&&r.signature!==result.anchor?.signature&&!seen.has(r.signature)&&int(r.slot)&&r.slot<=previousSlot&&Object.hasOwn(r,'err')&&(r.err===null||typeof r.err==='object'&&!Array.isArray(r.err)&&Object.keys(r.err).length>0)&&(r.blockTime===null||int(r.blockTime))&&['confirmed','finalized'].includes(r.confirmationStatus),'HISTORY_CONTEXT');seen.add(r.signature);previousSlot=r.slot;rows.push({signature:r.signature,slot:r.slot,success:r.err===null,blockTime:r.blockTime,confirmationStatus:r.confirmationStatus});}
   history.push(...rows);result.historyRows=history.length;options.record?.('native-flow-history-page',{pool:options.pool,target,anchor:result.anchor,page:page+1,requestedLimit,requestedBefore:before,receivedAt,rows});const validatedAt=clock();result.pages.push({page:page+1,requestedLimit,rows:rows.length,newestSlot:rows[0]?.slot??null,oldestSlot:rows.at(-1)?.slot??null,receivedAt,validatedAt});
   // A fresh provider page must independently reach an exact finalized
   // overlap. Only its previously audited contiguous suffix is reusable;
   // confirmed history, packet-derived rows and unbridged cache gaps never are.
   let reused=0;
   if(cache&&rows.length===requestedLimit&&rows.at(-1)!.slot>lowerSlot){
    const cachedIndex=new Map(cache.rows.map((r,i)=>[r.signature,i]));
    const overlap=rows.findIndex(r=>r.confirmationStatus==='finalized'&&cachedIndex.has(r.signature));
    if(overlap>=0){
     const index=cachedIndex.get(rows[overlap]!.signature)!;
     for(let i=overlap;i<rows.length&&index+i-overlap<cache.rows.length;i++){const fresh=rows[i]!,old=cache.rows[index+i-overlap]!;need(fresh.signature===old.signature&&fresh.slot===old.slot&&fresh.success===old.success&&fresh.confirmationStatus==='finalized','FINALIZED_HISTORY_CONFLICT');}
     const suffix=cache.rows.slice(index+rows.length-overlap);
     for(const row of suffix){need(!seen.has(row.signature)&&row.slot<=previousSlot&&history.length<6000,'HISTORY_CACHE_CONTIGUITY');seen.add(row.signature);previousSlot=row.slot;history.push({...row});reused++;if(row.slot<=lowerSlot)break;}
     if(reused){result.historyRows=history.length;options.record?.('native-flow-finalized-history-reused',{pool:options.pool,target,at:clock(),validatedAt:cache.validatedAt,freshOverlapSignature:rows[overlap]!.signature,freshOverlapSlot:rows[overlap]!.slot,reusedRows:reused,rows:structuredClone(history.slice(-reused)),physicalRequestStarted:false,freshProviderOverlapRequired:true,originalDeadlineUnchanged:true});}
    }
   }
   if(history.length&&history.at(-1)!.slot<=lowerSlot){result.historyRangeCovered=true;break;}if(rows.length<requestedLimit&&!reused)break;before=history.at(-1)!.signature;if(adaptivePageSizing&&pageLimit===1000)requestedLimit=1000;
  }
  if(!result.historyRangeCovered)return finish('unavailable',pageLimit===1000&&result.pages.at(-1)?.rows===result.pages.at(-1)?.requestedLimit?'NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN':'NATIVE_AUDIT_HISTORY_RANGE_NOT_COVERED');
  const interior=history.filter(r=>r.slot>lowerSlot&&r.slot<upperSlot);result.interiorRows=interior.length;result.comparedSignatures=interior.map(r=>r.signature);result.boundaryExcludedSignatures=[...new Set([...result.boundaryExcludedSignatures,...history.filter(r=>r.slot===lowerSlot||r.slot===upperSlot).map(r=>r.signature)])];
  if(options.postSnapshotNotifications){
   options.signal?.throwIfAborted();clock();need(options.admission?.admissionOpen?.()??true,'TAIL_ADMISSION_CLOSED');
   const tail=options.postSnapshotNotifications(startedAt),refreshedAt=clock();options.signal?.throwIfAborted();need(options.admission?.admissionOpen?.()??true,'TAIL_ADMISSION_CLOSED');
   need(Array.isArray(tail)&&tail.length<=8192,'TAIL_NOTIFICATION_BOUND');result.postSnapshotTail.refreshedAt=refreshedAt;result.postSnapshotTail.rows=tail.length;
   for(const raw of tail){
    const n={...raw};need(key(n.signature,64)&&int(n.slot)&&int(n.receivedAt)&&int(n.availableAt)&&n.receivedAt<=n.availableAt&&n.availableAt>startedAt&&n.availableAt<=refreshedAt&&n.receivedAt>=generation!.openedAt&&typeof n.success==='boolean'&&typeof n.duplicate==='boolean'&&typeof n.correction==='boolean'&&/^[a-f0-9]{64}$/.test(n.rawHash)&&['failed-transaction','program-event','nontrade','unusable'].includes(n.classification),'TAIL_NOTIFICATION_SCHEMA');
    need(n.subscriptionMint===generation!.mint&&n.subscriptionPool===generation!.pool&&n.connectionId===generation!.connectionId&&n.subscriptionId===generation!.subscriptionId,'TAIL_NOTIFICATION_GENERATION');
    const prior=captured.get(n.signature);if(n.correction||n.classification==='unusable'||prior&&(prior.slot!==n.slot||prior.success!==n.success||prior.rawHash!==n.rawHash))return finish('unusable','NATIVE_AUDIT_POST_SNAPSHOT_CORRECTION');
    if(!prior){need(captured.size<8192,'TAIL_NOTIFICATION_BOUND');captured.set(n.signature,n);result.postSnapshotTail.addedSignatures.push(n.signature);result.postSnapshotTail.addedPackets.push({signature:n.signature,slot:n.slot,receivedAt:n.receivedAt,availableAt:n.availableAt,success:n.success,rawHash:n.rawHash});}
   }
   const addedSignatures=new Set(result.postSnapshotTail.addedSignatures);result.postSnapshotTail.matchedInteriorSignatures=interior.filter(r=>addedSignatures.has(r.signature)).map(r=>r.signature);
   options.record?.('native-flow-audit-post-snapshot-tail',{pool:options.pool,target,originalSnapshot:result.notificationSnapshot,...result.postSnapshotTail,requiredTargetSignaturesUnchanged:true,featureInformationBackdated:false});
  }
  result.missingNotifications=interior.filter(r=>!captured.has(r.signature));result.missingFailedNotifications=result.missingNotifications.filter(r=>r.success===false);result.missingSuccessfulNotifications=result.missingNotifications.filter(r=>r.success===true);
  const bySignature=new Map(interior.map(r=>[r.signature,r]));result.unconfirmedCapturedSignatures=required.filter(n=>!bySignature.has(n.signature)).map(n=>n.signature);
  result.statusDisagreements=interior.filter(r=>{const n=captured.get(r.signature);return n&&(n.slot!==r.slot||n.success!==r.success);}).map(r=>r.signature);
  // A failed source hint without an independently retrieved failed history row
  // is NOT enough. Status reversals and missing successful nontrades remain
  // blocking: their actual executed instructions are not invented here.
  if(result.missingSuccessfulNotifications.length||completenessScope==='all-notifications'&&result.missingNotifications.length)return finish('unusable','NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED');
  if(result.unconfirmedCapturedSignatures.length)return finish('unavailable','NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY');
  if(result.statusDisagreements.length)return finish('unusable','NATIVE_AUDIT_CONFIRMED_STATUS_DISAGREEMENT');
  const notificationsComplete=result.missingNotifications.length===0;
  const verified=finish('verified',notificationsComplete?'NATIVE_AUDIT_STRICT_INTERIOR_SIGNATURES_VERIFIED':'NATIVE_AUDIT_EXECUTED_FLOW_VERIFIED_WITH_MISSING_FAILED_PACKETS',{notifications:notificationsComplete,executed:true});
  const lastNonfinal=history.findLastIndex(r=>r.confirmationStatus!=='finalized'),finalizedSuffix=history.slice(lastNonfinal+1);
  if(finalizedSuffix.length)options.onVerifiedHistory?.({pool:options.pool,validatedAt:verified.availableAt,rows:structuredClone(finalizedSuffix)});
  return verified;
 }catch(e){result.status='unavailable';result.complete=false;result.notificationCompletenessVerified=false;result.executedFlowCompletenessVerified=false;result.reason=safe(e);const retry=(e as {retryAt?:unknown})?.retryAt;result.retryAt=int(retry)?retry:null;const at=now();result.availableAt=int(at)&&at>=startedAt?at:Math.max(startedAt,lastAt);return result;}
 finally{open=false;}
}
