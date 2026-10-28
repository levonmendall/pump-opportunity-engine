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
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
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
type Frame={protocolEvents:FrameEvent[];protocolChildren:ProtocolChild[];otherLabels:string[];program:string;label:string|null;root:number;ordinal:number;eventCredits:number;eventCount:number;swapEvents:number;childSwapEvents:number;selfEventFrame:boolean;childCalls:number};
export const CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW='confirmed-program-activity-v3-shadow' as const;
export type ProtocolPoolEffect={
 version:typeof CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW;kind:'PROTOCOL_POOL_EFFECT';effect:'boost-buy-and-burn';normalizedForStrategy:false;
 identity:{namespace:'solana-program-log-protocol-v1';signature:string;program:string;logArrayIndex:number};identityKey:string;
 pairedBuyLogIndex:number;frameOrdinal:number;framePath:string[];invocationDepth:1;instructionLabel:'BoostBuyAndBurn';
 pool:string;mint:string;quoteMint:string;actor:{address:string;role:'protocol-boost-vault-pda';externalBuyer:false};instructionAuthority:string;
 quoteLamportsIn:string;baseUnitsBurned:string;minimumBaseUnitsBurned:string;ordinaryUserBaseUnitsReceived:null;fees:Record<string,string>;
 reserves:{baseBefore:string;baseAfter:string;quoteBefore:string;quoteAfter:string;boostQuoteBefore:string;boostQuoteAfter:string};
 events:Array<{name:'BuyEvent'|'BoostBuyAndBurnEvent';logArrayIndex:number;eventBase64:string;eventBytesSha256:string}>;
 slot:number;commitment:'confirmed'|'finalized';receivedAt:number|null;availableAt:number;programClockTimestamp:string;chainBlockTime:null;
 rawNotificationSha256:string;transferCrossCheck:'UNAVAILABLE';compiledInstructionIdentity:null;transactionCompleteness:'NOT_ESTABLISHED';fingerprint:string;
};
export type ProgramLogActivity={dataContract:typeof CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW;trades:ProgramLogEvidence[];protocolEffects:ProtocolPoolEffect[];protocolFramesObserved:number;baselineFeatureSemantics:'V2_WITHOUT_PROTOCOL_FRAMES'|'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW';financialQualificationAllowed:false};
type FrameEvent={name:string;data:any;encoded:string;logIndex:number};
type ProtocolChild={program:string;labels:string[];selfEventFrame:boolean;eventCount:number;childCalls:number};

/** This first explicit protocol shape is direct, Token2022 burn + classic
 * WSOL transfer, zero-fee, and exactly the paired official events. Broader
 * variants remain unavailable; event-only evidence never asserts SPL checks. */
function protocolEffect(frame:Frame,input:ProgramLogInput,scopes:ReadonlyMap<string,ProgramLogScope>,path:string[],rawHash:string):ProtocolPoolEffect|null{
 need(path.length===1,'PROTOCOL_ROUTED_FRAME_UNSUPPORTED');
 need(frame.eventCount===2&&frame.protocolEvents.length===2&&frame.protocolEvents[0]!.name==='BuyEvent'&&frame.protocolEvents[1]!.name==='BoostBuyAndBurnEvent','PROTOCOL_EVENT_PAIR');
 need(frame.childCalls===4&&frame.protocolChildren.length===4&&frame.eventCredits===0,'PROTOCOL_CHILD_SHAPE');
 const children=frame.protocolChildren;
 need(children[0]!.program===TOKEN_PROGRAM_ID.toBase58()&&children[0]!.labels.length===0&&!children[0]!.selfEventFrame&&children[0]!.eventCount===0&&children[0]!.childCalls===0,'PROTOCOL_QUOTE_TRANSFER_FRAME');
 need(children[1]!.program===TOKEN_2022_PROGRAM_ID.toBase58()&&JSON.stringify(children[1]!.labels)==='["Burn"]'&&!children[1]!.selfEventFrame&&children[1]!.eventCount===0&&children[1]!.childCalls===0,'PROTOCOL_BASE_BURN_FRAME');
 need(children.slice(2).every(c=>c.program===PROGRAM&&c.selfEventFrame&&c.labels.length===0&&c.eventCount===0&&c.childCalls===0),'PROTOCOL_EVENT_CPI_FRAME');
 const buy=frame.protocolEvents[0]!,boost=frame.protocolEvents[1]!,e=buy.data,b=boost.data,pool=key(b.pool),mint=key(b.mint),scope=scopes.get(pool);
 need(canonicalPumpPoolPda(new PublicKey(mint)).toBase58()===pool&&key(e.pool)===pool,'PROTOCOL_CANONICAL_POOL');
 if(scope)need(scope.mint===mint,'PROTOCOL_SCOPE_MINT');
 const actor=PublicKey.findProgramAddressSync([Buffer.from('boost_vault'),new PublicKey(pool).toBuffer()],PUMP_AMM_PROGRAM_ID)[0];
 const vault=getAssociatedTokenAddressSync(NATIVE_MINT,actor,true,TOKEN_PROGRAM_ID).toBase58();
 need(key(e.user)===actor.toBase58()&&key(e.user_quote_token_account)===vault&&key(e.user_base_token_account)===PublicKey.default.toBase58()&&decimal(e.user_base_token_reserves)==='0','PROTOCOL_ACTOR_ROLE');
 need(key(e.protocol_fee_recipient)===PublicKey.default.toBase58()&&key(e.protocol_fee_recipient_token_account)===PublicKey.default.toBase58()&&e.track_volume===false&&e.can_boost===true&&e.ix_name==='buy_exact_quote_in','PROTOCOL_BUY_ROLE_CONVENTION');
 const fees=Object.fromEntries(FEES.map(n=>[n,decimal(e[n])]));
 need(Object.values(fees).every(n=>n==='0')&&['lp_fee_basis_points','protocol_fee_basis_points','coin_creator_fee_basis_points','cashback_fee_basis_points','buyback_fee_basis_points','holder_rewards_bps'].every(n=>decimal(e[n])==='0'),'PROTOCOL_FEE_UNSUPPORTED');
 const quote=decimal(b.quote_amount_in_used),base=decimal(b.base_amount_burned),minimum=decimal(e.min_base_amount_out),timestamp=decimal(e.timestamp);
 need(BigInt(quote)>0n&&BigInt(base)>0n&&BigInt(minimum)>0n&&BigInt(base)>=BigInt(minimum),'PROTOCOL_EXECUTED_AMOUNTS');
 need(decimal(b.quote_amount_in_requested)===quote&&decimal(e.max_quote_amount_in)===quote&&decimal(e.quote_amount_in)===quote&&decimal(e.user_quote_amount_in)===quote&&decimal(e.quote_amount_in_with_lp_fee)===quote&&decimal(e.base_amount_out)===base,'PROTOCOL_AMOUNT_AGREEMENT');
 need(decimal(b.timestamp)===timestamp,'PROTOCOL_EVENT_TIME_AGREEMENT');
 const reserves={baseBefore:decimal(e.pool_base_token_reserves),baseAfter:decimal(b.base_reserves_after),quoteBefore:decimal(e.pool_quote_token_reserves),quoteAfter:decimal(b.real_quote_reserves_after),boostQuoteBefore:decimal(e.user_quote_token_reserves),boostQuoteAfter:decimal(b.boost_vault_remaining)};
 need(BigInt(reserves.baseBefore)-BigInt(reserves.baseAfter)===BigInt(base)&&BigInt(reserves.quoteAfter)-BigInt(reserves.quoteBefore)===BigInt(quote)&&BigInt(reserves.boostQuoteBefore)-BigInt(reserves.boostQuoteAfter)===BigInt(quote),'PROTOCOL_RESERVE_AGREEMENT');
 need(decimal(e.virtual_quote_reserves)===decimal(b.virtual_quote_reserves),'PROTOCOL_VIRTUAL_RESERVES');
 key(b.authority); // program-authored role only; no compiled signer assertion.
 if(!scope)return null;
 const identity={namespace:'solana-program-log-protocol-v1' as const,signature:input.signature,program:PROGRAM,logArrayIndex:boost.logIndex};
 const events=frame.protocolEvents.map(row=>({name:row.name as 'BuyEvent'|'BoostBuyAndBurnEvent',logArrayIndex:row.logIndex,eventBase64:row.encoded,eventBytesSha256:digest(Buffer.from(row.encoded,'base64'))}));
 const content={identity,frameOrdinal:frame.ordinal,pool,mint,quoteMint:NATIVE_MINT.toBase58(),actor:{address:actor.toBase58(),role:'protocol-boost-vault-pda' as const,externalBuyer:false as const},instructionAuthority:key(b.authority),quoteLamportsIn:quote,baseUnitsBurned:base,minimumBaseUnitsBurned:minimum,fees,reserves,events,slot:input.slot,programClockTimestamp:timestamp};
 return {...content,version:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,kind:'PROTOCOL_POOL_EFFECT',effect:'boost-buy-and-burn',normalizedForStrategy:false,identityKey:[identity.namespace,input.signature,PROGRAM,boost.logIndex,frame.ordinal].join(':'),pairedBuyLogIndex:buy.logIndex,framePath:[...path],invocationDepth:1,instructionLabel:'BoostBuyAndBurn',ordinaryUserBaseUnitsReceived:null,commitment:input.commitment,receivedAt:input.receivedAt??null,availableAt:input.availableAt,chainBlockTime:null,rawNotificationSha256:rawHash,transferCrossCheck:'UNAVAILABLE',compiledInstructionIdentity:null,transactionCompleteness:'NOT_ESTABLISHED',fingerprint:digest(JSON.stringify(content))};
}

/** All AMM frames are checked, including unknown zero-event instructions. An
 * unlabeled AMM self-CPI is accepted only as the exact observed event grammar:
 * a known parent has just emitted an exact IDL event, one credit is consumed,
 * and the child emits no instruction/event or further invocation. No compiled
 * instruction index or SPL transfer assertion is inferred from this grammar. */
export function parseProgramLogEvidence(input:ProgramLogInput,scopes:readonly ProgramLogScope[]):ProgramLogEvidence[]{return parseProgramActivity(input,scopes,false).trades;}
/** Explicit shadow contract only. No caller can accidentally enable this by
 * changing a strategy threshold or passing an unknown option. */
export function parseProgramLogActivity(input:ProgramLogInput,scopes:readonly ProgramLogScope[],options:{dataContract:typeof CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}):ProgramLogActivity{need(options&&Object.keys(options).length===1&&options.dataContract===CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,'PROTOCOL_EXPLICIT_OPT_IN_REQUIRED');return parseProgramActivity(input,scopes,true);}
function parseProgramActivity(input:ProgramLogInput,scopes:readonly ProgramLogScope[],protocolOptIn:boolean):ProgramLogActivity{
 need(input.err===null,'TRANSACTION_NOT_SUCCESSFUL');need(input.commitment==='confirmed'||input.commitment==='finalized','REQUEST_COMMITMENT');need(integer(input.slot)&&integer(input.availableAt),'AVAILABILITY');
 need(input.receivedAt===undefined||integer(input.receivedAt)&&input.receivedAt<=input.availableAt,'RECEIPT_AVAILABILITY');
 need(typeof input.signature==='string'&&bs58.decode(input.signature).length===64,'SIGNATURE');
 need(Array.isArray(input.logs)&&input.logs.length<=4096&&input.logs.every(s=>typeof s==='string'&&Buffer.byteLength(s)<=32768)&&Buffer.byteLength(JSON.stringify(input.logs))<=512*1024,'LOG_ENVELOPE');
 need(scopes.length>0&&scopes.length<=20,'SCOPES');const scopeMap=new Map<string,ProgramLogScope>();for(const scope of scopes){need(canonicalPumpPoolPda(new PublicKey(scope.mint)).toBase58()===scope.pool&&typeof scope.supportedPoolEvidence==='string'&&scope.supportedPoolEvidence.length>0&&scope.supportedPoolEvidence.length<=512&&!scopeMap.has(scope.pool),'VERIFIED_SCOPE_BINDING');scopeMap.set(scope.pool,scope);}
 const stack:Frame[]=[],result:ProgramLogEvidence[]=[],protocolEffects:ProtocolPoolEffect[]=[];let rootOrdinal=-1,frameOrdinal=-1,protocolFramesObserved=0;const rawNotificationSha256=digest(JSON.stringify({signature:input.signature,slot:input.slot,err:input.err,logs:input.logs}));
 for(let logArrayIndex=0;logArrayIndex<input.logs.length;logArrayIndex++){
  const line=input.logs[logArrayIndex] as string;need(!/log.*truncat|truncat.*log/i.test(line),'TRUNCATED');
  const invoke=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line),end=/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(line);
  if(invoke){const depth=Number(invoke[2]);need(depth===stack.length+1&&depth<=16,'INVOCATION_STACK');const parent=stack.at(-1);if(parent){need(!parent.selfEventFrame,'EVENT_SELF_CPI_HAS_CHILD');parent.childCalls++;}if(depth===1)rootOrdinal++;let selfEventFrame=false;
   if(invoke[1]===PROGRAM&&parent?.program===PROGRAM&&parent.eventCredits>0){parent.eventCredits--;selfEventFrame=true;}else if(parent?.program===PROGRAM)parent.eventCredits=0;
   stack.push({protocolEvents:[],protocolChildren:[],otherLabels:[],program:invoke[1]!,label:null,root:rootOrdinal,ordinal:++frameOrdinal,eventCredits:0,eventCount:0,swapEvents:0,childSwapEvents:0,selfEventFrame,childCalls:0});continue;}
  if(end){const frame=stack.at(-1);need(frame&&frame.program===end[1],'INVOCATION_END');need(end[2]==='success','FAILED_INVOCATION_UNSUPPORTED');
   if(frame.program===PROGRAM){if(frame.selfEventFrame)need(frame.label===null&&frame.eventCount===0&&frame.childCalls===0,'EVENT_SELF_CPI_SHAPE');else{need(frame.label!==null,'AMM_FRAME_LABEL_MISSING');if(frame.label==='BoostBuyAndBurn'&&protocolOptIn){const effect=protocolEffect(frame,input,scopeMap,stack.map(f=>f.program),rawNotificationSha256);protocolFramesObserved++;if(effect)protocolEffects.push(effect);}else{need(frame.label!=='BoostBuyAndBurn','UNSUPPORTED_PROTOCOL_BUY_AND_BURN');const swap=SWAPS[frame.label];need(swap||NON_SWAPS.has(frame.label)||frame.label==='MultiHopSwap','UNKNOWN_AMM_FRAME');if(swap)need(frame.swapEvents===1,'SWAP_FRAME_EVENT_COUNT');if(frame.label==='MultiHopSwap')need(frame.childSwapEvents>0,'EMPTY_SWAP_WRAPPER');}}}
   stack.pop();const protocolParent=stack.at(-1);if(protocolOptIn&&protocolParent?.label==='BoostBuyAndBurn')protocolParent.protocolChildren.push({program:frame.program,labels:[...frame.otherLabels],selfEventFrame:frame.selfEventFrame,eventCount:frame.eventCount,childCalls:frame.childCalls});if(frame.swapEvents||frame.childSwapEvents){const parent=stack.at(-1);if(parent)parent.childSwapEvents+=frame.swapEvents+frame.childSwapEvents;}continue;}
  const frame=stack.at(-1);if(frame?.program!==PROGRAM){if(protocolOptIn&&frame&&stack.at(-2)?.label==='BoostBuyAndBurn'&&line.startsWith('Program log: Instruction: '))frame.otherLabels.push(line.slice('Program log: Instruction: '.length));continue;}
  if(line.startsWith('Program log: Instruction: ')){need(!frame.selfEventFrame&&frame.label===null,'DUPLICATE_INSTRUCTION_LABEL');frame.label=line.slice('Program log: Instruction: '.length);continue;}
  if(!line.startsWith('Program data: '))continue;need(!frame.selfEventFrame,'EVENT_SELF_CPI_DATA');const encoded=line.slice('Program data: '.length);need(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)&&encoded.length%4===0,'EVENT_BASE64');const bytes=Buffer.from(encoded,'base64'),event=coder.events.decode(encoded);need(event,'UNRECOGNIZED_PROGRAM_DATA');need(coder.types.encode(event.name,event.data).equals(bytes.subarray(8)),'EVENT_LAYOUT');frame.eventCount++;frame.eventCredits++;
  if(protocolOptIn&&frame.label==='BoostBuyAndBurn'){frame.protocolEvents.push({name:event.name,data:event.data,encoded,logIndex:logArrayIndex});continue;}
  if(!['BuyEvent','SellEvent'].includes(event.name))continue;frame.swapEvents++;const e=event.data as any,instruction=frame.label===null?undefined:SWAPS[frame.label];need(instruction,'UNSUPPORTED_SWAP_LABEL');const side:'buy'|'sell'=event.name==='BuyEvent'?'buy':'sell';need(side==='buy'?instruction.startsWith('buy'):instruction.startsWith('sell'),'DIRECTION_LABEL');const ixName=typeof e.ix_name==='string'?e.ix_name:null;if(side==='buy')need(ixName===instruction,'BUY_VARIANT_AGREEMENT');const pool=key(e.pool),scope=scopeMap.get(pool);if(!scope)continue;
  const exact=side==='buy'&&['buy_exact_quote_in','buy_exact_quote_in_v2'].includes(instruction),economics={tokenUnits:decimal(e[side==='buy'?'base_amount_out':'base_amount_in']),curveQuoteLamports:decimal(e[side==='buy'?(exact?'user_quote_amount_in':'quote_amount_in'):'quote_amount_out']),userQuoteLamports:decimal(e[side==='buy'?(exact?'quote_amount_in':'user_quote_amount_in'):'user_quote_amount_out']),fees:Object.fromEntries(FEES.map(n=>[n,decimal(e[n])]))};need(BigInt(economics.tokenUnits)>0n&&BigInt(economics.curveQuoteLamports)>0n&&BigInt(economics.userQuoteLamports)>0n,'EMPTY_AMOUNTS');
  const identity={namespace:'solana-program-log-v1' as const,signature:input.signature,program:PROGRAM,logArrayIndex},content={identity,frameOrdinal:frame.ordinal,pool,mint:scope.mint,side,trader:key(e.user),...economics,slot:input.slot};
  result.push({...content,version:CONFIRMED_PROGRAM_EVENTS_V2,normalizedForStrategy:false,identityKey:[identity.namespace,input.signature,PROGRAM,logArrayIndex,frame.ordinal].join(':'),framePath:stack.map(f=>f.program),rawNotificationSha256,eventBase64:encoded,invocationDepth:stack.length,rootInvocationOrdinal:frame.root,instructionLabel:frame.label!,eventIxName:ixName,eventBytesSha256:digest(bytes),eventByteLength:bytes.length,commitment:input.commitment,receivedAt:input.receivedAt??null,availableAt:input.availableAt,programClockTimestamp:e.timestamp.toString(10),chainBlockTime:null,transferChecks:null,compiledInstructionIdentity:null,transactionCompleteness:'NOT_ESTABLISHED',fingerprint:digest(JSON.stringify(content))});
 }
 need(stack.length===0,'INCOMPLETE_LOG_STACK');return {dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,trades:result,protocolEffects,protocolFramesObserved,baselineFeatureSemantics:protocolFramesObserved?'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW':'V2_WITHOUT_PROTOCOL_FRAMES',financialQualificationAllowed:false};
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

/** Protocol effects never become NormalizedTrade. Freshness/context checks
 * mirror source validity, while ordinary buyer-feature semantics stay blocked. */
export function admitProtocolPoolEffect(effect:ProtocolPoolEffect,scope:FreshProgramLogScope,at:number,cutoffAt=Infinity){
 need(effect.version===CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW&&effect.kind==='PROTOCOL_POOL_EFFECT'&&scope.mint===effect.mint&&scope.pool===effect.pool&&typeof scope.supportedPoolEvidence==='string'&&scope.supportedPoolEvidence.length>0,'PROTOCOL_NORMALIZATION_SCOPE');
 need(integer(at)&&integer(scope.verifiedAt)&&scope.verifiedAt<=at&&at-scope.verifiedAt<=30000&&integer(scope.minimumSlot)&&effect.slot>=scope.minimumSlot,'PROTOCOL_FRESH_SCOPE_REQUIRED');
 need(effect.commitment==='confirmed'||effect.commitment==='finalized','REQUEST_COMMITMENT');need(effect.availableAt<=at&&at-effect.availableAt<=5000&&at<cutoffAt,'PROTOCOL_ADMISSION_DEADLINE');need(effect.receivedAt!==null&&effect.receivedAt<=effect.availableAt&&at-effect.receivedAt<=5000,'PROTOCOL_RECEIPT_DEADLINE');
 need(/^(0|[1-9][0-9]{0,12})$/.test(effect.programClockTimestamp),'PROTOCOL_CLOCK_INVALID');const sourceAt=BigInt(effect.programClockTimestamp)*1000n;need(sourceAt<=BigInt(at)&&BigInt(at)-sourceAt<=30000n,'PROTOCOL_CLOCK_STALE_OR_FUTURE');return {effect:structuredClone(effect),validatedAt:at,dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,baselineFeatureSemantics:'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW' as const,financialQualificationAllowed:false as const,transferCrossCheck:'UNAVAILABLE' as const};
}
export function compareProtocolPoolEffects(a:ProtocolPoolEffect,b:ProtocolPoolEffect):'distinct'|'duplicate'|'correction'{return a.identityKey!==b.identityKey?'distinct':a.fingerprint===b.fingerprint?'duplicate':'correction';}
