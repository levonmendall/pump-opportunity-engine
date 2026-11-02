/** On-demand birth-signature discovery AFTER a canonical PumpSwap pool exists.
 * History metadata only chooses a transaction to verify. It never proves age.
 * Each scheduler turn performs one existing-budget RPC; no history loop holds
 * the event loop or physical RPC slot across pages. */
import bs58 from 'bs58';
import {TOKEN_AGE_POLICY} from './token-age-policy.js';

export const TOKEN_CREATION_HISTORY_POLICY=Object.freeze({version:'post-pumpswap-finalized-mint-history-v1',pageLimit:1000,maximumHorizonMs:TOKEN_AGE_POLICY.maximumAgeMs,maximumRequestsPerTurn:1,retryMs:60000,retainedData:'descending cursor, rejected-candidate lower bound and oldest successful candidate only; no raw history'});
export type TokenCreationHistoryRequest={mint:string;before:string|null;beforeSlot:number|null;until:string|null;untilSlot:number|null;oldestCandidate:string|null;oldestCandidateSlot:number|null};
export type TokenCreationHistoryPage={kind:'continue';before:string;beforeSlot:number;oldestCandidate:string|null;oldestCandidateSlot:number|null}|{kind:'candidate';signature:string;slot:number}|{kind:'unavailable';reason:string;terminal:boolean};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const canonicalSignature=(v:unknown):v is string=>{try{return typeof v==='string'&&v.length<=100&&bs58.decode(v).length===64;}catch{return false;}};
export function selectTokenCreationHistoryPage(rows:unknown,request:TokenCreationHistoryRequest,at:number):TokenCreationHistoryPage {
 const cursorValid=request.before===null?request.beforeSlot===null:canonicalSignature(request.before)&&integer(request.beforeSlot);
 const lowerBoundValid=request.until===null?request.untilSlot===null:canonicalSignature(request.until)&&integer(request.untilSlot);
 const candidateValid=request.oldestCandidate===null?request.oldestCandidateSlot===null:canonicalSignature(request.oldestCandidate)&&integer(request.oldestCandidateSlot);
 if(!integer(at)||!cursorValid||!lowerBoundValid||!candidateValid||!Array.isArray(rows)||rows.length>TOKEN_CREATION_HISTORY_POLICY.pageLimit)return {kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_MALFORMED',terminal:false};
 if(!rows.length)return request.before&&request.oldestCandidate&&request.oldestCandidateSlot!==null?{kind:'candidate',signature:request.oldestCandidate,slot:request.oldestCandidateSlot}:{kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_EMPTY',terminal:false};
 const seen=new Set<string>();let priorSlot=request.beforeSlot??Infinity;
 for(const row of rows){
  if(!row||!canonicalSignature(row.signature)||seen.has(row.signature)||row.signature===request.before||row.signature===request.until||!integer(row.slot)||row.slot>priorSlot||row.slot<(request.untilSlot??0)||!Object.hasOwn(row,'err')||!(row.blockTime===null||integer(row.blockTime)&&Number.isSafeInteger(row.blockTime*1000)&&row.blockTime*1000<=at))return {kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_MALFORMED',terminal:false};
  seen.add(row.signature);priorSlot=row.slot;
  // A successful finalized transaction older than the permitted token horizon
  // cannot establish young creation. Stop acquisition without fabricating a
  // birthday or changing any stored immutable proof.
  if(row.err===null&&integer(row.blockTime)&&row.blockTime*1000<at-TOKEN_AGE_POLICY.maximumAgeMs)return {kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_PRECEDES_24H',terminal:true};
 }
 const oldest=rows.at(-1)!;
 const candidate=[...rows].reverse().find(row=>row.err===null);
 const signature=candidate?.signature??request.oldestCandidate,slot=candidate?.slot??request.oldestCandidateSlot;
 if(rows.length===TOKEN_CREATION_HISTORY_POLICY.pageLimit)return {kind:'continue',before:oldest.signature,beforeSlot:oldest.slot,oldestCandidate:signature,oldestCandidateSlot:slot};
 return signature&&slot!==null?{kind:'candidate',signature,slot}:{kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_NO_SUCCESSFUL_CANDIDATE',terminal:false};
}
