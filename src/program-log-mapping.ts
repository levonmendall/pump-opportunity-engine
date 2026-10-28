/** Explicit confirmed-program-events-v2 research contract. Program-authored
 * evidence is different from per-transaction compiled/SPL cross-checks. No
 * network, ledger, execution permission or blockchain construction lives here. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import BN from 'bn.js';
import bs58 from 'bs58';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from './sdk.js';
import type {MappedTradeEvidence} from './pumpapi-mapping.js';
import type {NormalizedTrade} from './strategy.js';

export const CONFIRMED_PROGRAM_EVENTS_V2='confirmed-program-events-v2' as const;
const require=createRequire(import.meta.url),idlBytes=readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json')),idl=JSON.parse(idlBytes.toString('utf8')) as Idl,coder=new BorshCoder(idl),PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58();
const FEES=['lp_fee','protocol_fee','coin_creator_fee','cashback','buyback_fee','holder_rewards','quote_transfer_fee'];
const SWAPS:Record<string,string>={Buy:'buy',BuyExactQuoteIn:'buy_exact_quote_in',BuyV2:'buy_v2',BuyExactQuoteInV2:'buy_exact_quote_in_v2',Sell:'sell',SellV2:'sell_v2'};
const NON_SWAPS=new Set(['admin_cto_pool','admin_update_token_incentives','claim_cashback','claim_token_incentives','close_user_volume_accumulator','collect_coin_creator_fee','create_config','create_pool','deposit','disable','extend_account','init_boost','init_user_volume_accumulator','migrate_pool_coin_creator','set_boost_authority','set_coin_creator','set_reserved_fee_recipients','sweep_creator_fee','sweep_protocol_fee','sync_user_volume_accumulator','toggle_boost','toggle_cashback_enabled','toggle_mayhem_mode','transfer_creator_fees_to_pump','transfer_creator_fees_to_pump_v2','update_admin','update_buyback_config','update_creator_fee_config','update_fee_config','withdraw'].map(name=>name.split('_').map(s=>s[0]!.toUpperCase()+s.slice(1)).join('')));
const digest=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
function need(v:unknown,reason:string):asserts v {if(!v)throw Error('LOG_NATIVE_'+reason);}
const integer=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const decimal=(x:unknown)=>{need(BN.isBN(x),'INTEGER_MISSING');const s=x.toString(10);need(/^(0|[1-9][0-9]*)$/.test(s),'INTEGER_RANGE');return s;};
const key=(x:any)=>{need(x&&typeof x.toBase58==='function','EVENT_KEY');return x.toBase58() as string;};
export type ProgramLogScope={mint:string;pool:string;supportedPoolEvidence:string};
export type FreshProgramLogScope=ProgramLogScope&{verifiedAt:number;minimumSlot:number};
export type ProgramLogInput={signature:string;slot:number;err:unknown;logs:unknown;commitment:'confirmed'|'finalized';availableAt:number;receivedAt?:number};
export type ProgramLogEvidence={
 version:typeof CONFIRMED_PROGRAM_EVENTS_V2;normalizedForStrategy:false;
 identity:{namespace:'solana-program-log-v1';signature:string;program:string;logArrayIndex:number};identityKey:string;
 frameOrdinal:number;framePath:string[];rawNotificationSha256:string;eventBase64:string;
 pool:string;mint:string;side:'buy'|'sell';trader:string;tokenUnits:string;curveQuoteLamports:string;userQuoteLamports:string;fees:Record<string,string>;
 invocationDepth:number;rootInvocationOrdinal:number;instructionLabel:string;eventIxName:string|null;eventBytesSha256:string;eventByteLength:number;
 slot:number;commitment:'confirmed'|'finalized';receivedAt:number|null;availableAt:number;programClockTimestamp:string;chainBlockTime:null;
 transferChecks:null;compiledInstructionIdentity:null;transactionCompleteness:'NOT_ESTABLISHED';fingerprint:string;
};
type Frame={program:string;label:string|null;root:number;ordinal:number;eventCredits:number;eventCount:number;swapEvents:number;childSwapEvents:number;selfEventFrame:boolean;childCalls:number};
/** All AMM frames are checked, including unknown zero-event instructions. An
 * unlabeled AMM self-CPI is accepted only as the exact observed event grammar:
 * a known parent has just emitted an exact IDL event, one credit is consumed,
 * and the child emits no instruction/event or further invocation. No compiled
 * instruction index or SPL transfer assertion is inferred from this grammar. */
export function parseProgramLogEvidence(input:ProgramLogInput,scopes:readonly ProgramLogScope[]):ProgramLogEvidence[]{
 need(input.err===null,'TRANSACTION_NOT_SUCCESSFUL');need(input.commitment==='confirmed'||input.commitment==='finalized','REQUEST_COMMITMENT');need(integer(input.slot)&&integer(input.availableAt),'AVAILABILITY');
 need(input.receivedAt===undefined||integer(input.receivedAt)&&input.receivedAt<=input.availableAt,'RECEIPT_AVAILABILITY');
 need(typeof input.signature==='string'&&bs58.decode(input.signature).length===64,'SIGNATURE');
 need(Array.isArray(input.logs)&&input.logs.length<=4096&&input.logs.every(s=>typeof s==='string'&&Buffer.byteLength(s)<=32768)&&Buffer.byteLength(JSON.stringify(input.logs))<=512*1024,'LOG_ENVELOPE');
 need(scopes.length>0&&scopes.length<=20,'SCOPES');const scopeMap=new Map<string,ProgramLogScope>();for(const scope of scopes){need(canonicalPumpPoolPda(new PublicKey(scope.mint)).toBase58()===scope.pool&&typeof scope.supportedPoolEvidence==='string'&&scope.supportedPoolEvidence.length>0&&scope.supportedPoolEvidence.length<=512&&!scopeMap.has(scope.pool),'VERIFIED_SCOPE_BINDING');scopeMap.set(scope.pool,scope);}
 const stack:Frame[]=[],result:ProgramLogEvidence[]=[];let rootOrdinal=-1,frameOrdinal=-1;const rawNotificationSha256=digest(JSON.stringify({signature:input.signature,slot:input.slot,err:input.err,logs:input.logs}));
 for(let logArrayIndex=0;logArrayIndex<input.logs.length;logArrayIndex++){
  const line=input.logs[logArrayIndex] as string;need(!/log.*truncat|truncat.*log/i.test(line),'TRUNCATED');
  const invoke=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line),end=/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(line);
  if(invoke){const depth=Number(invoke[2]);need(depth===stack.length+1&&depth<=16,'INVOCATION_STACK');const parent=stack.at(-1);if(parent){need(!parent.selfEventFrame,'EVENT_SELF_CPI_HAS_CHILD');parent.childCalls++;}if(depth===1)rootOrdinal++;let selfEventFrame=false;
   if(invoke[1]===PROGRAM&&parent?.program===PROGRAM&&parent.eventCredits>0){parent.eventCredits--;selfEventFrame=true;}else if(parent?.program===PROGRAM)parent.eventCredits=0;
   stack.push({program:invoke[1]!,label:null,root:rootOrdinal,ordinal:++frameOrdinal,eventCredits:0,eventCount:0,swapEvents:0,childSwapEvents:0,selfEventFrame,childCalls:0});continue;}
  if(end){const frame=stack.at(-1);need(frame&&frame.program===end[1],'INVOCATION_END');need(end[2]==='success','FAILED_INVOCATION_UNSUPPORTED');
   if(frame.program===PROGRAM){if(frame.selfEventFrame)need(frame.label===null&&frame.eventCount===0&&frame.childCalls===0,'EVENT_SELF_CPI_SHAPE');else{need(frame.label!==null,'AMM_FRAME_LABEL_MISSING');need(frame.label!=='BoostBuyAndBurn','UNSUPPORTED_PROTOCOL_BUY_AND_BURN');const swap=SWAPS[frame.label];need(swap||NON_SWAPS.has(frame.label)||frame.label==='MultiHopSwap','UNKNOWN_AMM_FRAME');if(swap)need(frame.swapEvents===1,'SWAP_FRAME_EVENT_COUNT');if(frame.label==='MultiHopSwap')need(frame.childSwapEvents>0,'EMPTY_SWAP_WRAPPER');}}
   stack.pop();if(frame.swapEvents||frame.childSwapEvents){const parent=stack.at(-1);if(parent)parent.childSwapEvents+=frame.swapEvents+frame.childSwapEvents;}continue;}
  const frame=stack.at(-1);if(frame?.program!==PROGRAM)continue;
  if(line.startsWith('Program log: Instruction: ')){need(!frame.selfEventFrame&&frame.label===null,'DUPLICATE_INSTRUCTION_LABEL');frame.label=line.slice('Program log: Instruction: '.length);continue;}
  if(!line.startsWith('Program data: '))continue;need(!frame.selfEventFrame,'EVENT_SELF_CPI_DATA');const encoded=line.slice('Program data: '.length);need(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)&&encoded.length%4===0,'EVENT_BASE64');const bytes=Buffer.from(encoded,'base64'),event=coder.events.decode(encoded);need(event,'UNRECOGNIZED_PROGRAM_DATA');need(coder.types.encode(event.name,event.data).equals(bytes.subarray(8)),'EVENT_LAYOUT');frame.eventCount++;frame.eventCredits++;
  if(!['BuyEvent','SellEvent'].includes(event.name))continue;frame.swapEvents++;const e=event.data as any,instruction=frame.label===null?undefined:SWAPS[frame.label];need(instruction,'UNSUPPORTED_SWAP_LABEL');const side:'buy'|'sell'=event.name==='BuyEvent'?'buy':'sell';need(side==='buy'?instruction.startsWith('buy'):instruction.startsWith('sell'),'DIRECTION_LABEL');const ixName=typeof e.ix_name==='string'?e.ix_name:null;if(side==='buy')need(ixName===instruction,'BUY_VARIANT_AGREEMENT');const pool=key(e.pool),scope=scopeMap.get(pool);if(!scope)continue;
  const exact=side==='buy'&&['buy_exact_quote_in','buy_exact_quote_in_v2'].includes(instruction),economics={tokenUnits:decimal(e[side==='buy'?'base_amount_out':'base_amount_in']),curveQuoteLamports:decimal(e[side==='buy'?(exact?'user_quote_amount_in':'quote_amount_in'):'quote_amount_out']),userQuoteLamports:decimal(e[side==='buy'?(exact?'quote_amount_in':'user_quote_amount_in'):'user_quote_amount_out']),fees:Object.fromEntries(FEES.map(n=>[n,decimal(e[n])]))};need(BigInt(economics.tokenUnits)>0n&&BigInt(economics.curveQuoteLamports)>0n&&BigInt(economics.userQuoteLamports)>0n,'EMPTY_AMOUNTS');
  const identity={namespace:'solana-program-log-v1' as const,signature:input.signature,program:PROGRAM,logArrayIndex},content={identity,frameOrdinal:frame.ordinal,pool,mint:scope.mint,side,trader:key(e.user),...economics,slot:input.slot};
  result.push({...content,version:CONFIRMED_PROGRAM_EVENTS_V2,normalizedForStrategy:false,identityKey:[identity.namespace,input.signature,PROGRAM,logArrayIndex,frame.ordinal].join(':'),framePath:stack.map(f=>f.program),rawNotificationSha256,eventBase64:encoded,invocationDepth:stack.length,rootInvocationOrdinal:frame.root,instructionLabel:frame.label!,eventIxName:ixName,eventBytesSha256:digest(bytes),eventByteLength:bytes.length,commitment:input.commitment,receivedAt:input.receivedAt??null,availableAt:input.availableAt,programClockTimestamp:e.timestamp.toString(10),chainBlockTime:null,transferChecks:null,compiledInstructionIdentity:null,transactionCompleteness:'NOT_ESTABLISHED',fingerprint:digest(JSON.stringify(content))});
 }
 need(stack.length===0,'INCOMPLETE_LOG_STACK');return result;
}
export function compareLogToFull(log:ProgramLogEvidence,full:MappedTradeEvidence){const fields=['pool','mint','side','trader','tokenUnits','curveQuoteLamports','userQuoteLamports'] as const;return fields.every(k=>log[k]===full[k])&&FEES.every(k=>log.fees[k]===full.fees[k]);}
export function compareProgramLogEvidence(a:ProgramLogEvidence,b:ProgramLogEvidence):'distinct'|'duplicate'|'correction'{return a.identityKey!==b.identityKey?'distinct':a.fingerprint===b.fingerprint?'duplicate':'correction';}
export function toConfirmedProgramTrade(e:ProgramLogEvidence,scope:FreshProgramLogScope,at:number,cutoffAt=Infinity):{dataContract:typeof CONFIRMED_PROGRAM_EVENTS_V2;authority:'confirmed-program-event';transferCrossCheck:'UNAVAILABLE';trade:NormalizedTrade}{
 need(e.version===CONFIRMED_PROGRAM_EVENTS_V2&&scope.mint===e.mint&&scope.pool===e.pool&&typeof scope.supportedPoolEvidence==='string'&&scope.supportedPoolEvidence.length>0,'NORMALIZATION_SCOPE');need(integer(at)&&integer(scope.verifiedAt)&&scope.verifiedAt<=at&&at-scope.verifiedAt<=30000&&integer(scope.minimumSlot)&&e.slot>=scope.minimumSlot,'FRESH_SCOPE_REQUIRED');need(e.commitment==='confirmed'||e.commitment==='finalized','REQUEST_COMMITMENT');need(e.availableAt<=at&&at-e.availableAt<=5000&&at<cutoffAt,'NORMALIZATION_DEADLINE');need(e.receivedAt!==null&&e.receivedAt<=e.availableAt&&at-e.receivedAt<=5000,'RECEIPT_DEADLINE');need(/^(0|[1-9][0-9]{0,12})$/.test(e.programClockTimestamp),'PROGRAM_CLOCK_INVALID');const programAt=BigInt(e.programClockTimestamp)*1000n;need(programAt<=BigInt(at)&&BigInt(at)-programAt<=30000n,'PROGRAM_CLOCK_STALE_OR_FUTURE');
 return {dataContract:CONFIRMED_PROGRAM_EVENTS_V2,authority:'confirmed-program-event',transferCrossCheck:'UNAVAILABLE',trade:{identity:{kind:'program-log',signature:e.identity.signature,program:e.identity.program,logIndex:e.identity.logArrayIndex,frameOrdinal:e.frameOrdinal},mint:e.mint,wallet:e.trader,side:e.side,quoteLamports:e.curveQuoteLamports,tokenUnits:e.tokenUnits,receivedAt:at,commitment:e.commitment,slot:e.slot}};
}
/** A compact replay packet retains every required event, not a sampled trade.
 * Hashes are trace references, not cryptographic proof of provider truth. */
export function compactProgramLogPacket(e:ProgramLogEvidence){return {dataContract:CONFIRMED_PROGRAM_EVENTS_V2,signature:e.identity.signature,program:e.identity.program,slot:e.slot,err:null,commitment:e.commitment,receivedAt:e.receivedAt,availableAt:e.availableAt,eventBase64:e.eventBase64,eventLogIndex:e.identity.logArrayIndex,frameOrdinal:e.frameOrdinal,frameDepth:e.invocationDepth,frameLabel:e.instructionLabel,framePath:e.framePath,rawNotificationSha256:e.rawNotificationSha256,transferCrossCheck:'UNAVAILABLE' as const};}
