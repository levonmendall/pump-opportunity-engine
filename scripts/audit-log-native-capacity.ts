/** Offline log evidence only. No provider, strategy admission, financial writer or network. */
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import BN from 'bn.js';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import {mapConfirmedPumpSwapEvidence,inspectScopedPumpSwapInstructions,type MappedTradeEvidence} from '../src/pumpapi-mapping.js';

const require=createRequire(import.meta.url),idlPath=join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),idlBytes=readFileSync(idlPath),coder=new BorshCoder(JSON.parse(idlBytes.toString('utf8')) as Idl);
const PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),FEES=['lp_fee','protocol_fee','coin_creator_fee','cashback','buyback_fee','holder_rewards','quote_transfer_fee'];
const LABELS:Record<string,string>={Buy:'buy',BuyExactQuoteIn:'buy_exact_quote_in',BuyV2:'buy_v2',BuyExactQuoteInV2:'buy_exact_quote_in_v2',Sell:'sell',SellV2:'sell_v2'};
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
function need(value:unknown,reason:string):asserts value {if(!value)throw Error('LOG_NATIVE_'+reason);}
const int=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function decimal(value:unknown){need(BN.isBN(value),'INTEGER_MISSING');const s=value.toString(10);need(/^(0|[1-9][0-9]*)$/.test(s),'INTEGER_RANGE');return s;}
function key(value:any){need(value&&typeof value.toBase58==='function','EVENT_KEY');return value.toBase58() as string;}
export type LogScope={mint:string;pool:string;supportedPoolEvidence:string};
export type LogInput={signature:string;slot:number;err:unknown;logs:unknown;commitment:'confirmed'|'finalized';availableAt:number};
export type LogNativeEvidence={
 version:'log-native-offline-v1-unadopted';normalizedForStrategy:false;
 identity:{namespace:'solana-program-log-v1';signature:string;program:string;logArrayIndex:number};identityKey:string;
 pool:string;mint:string;side:'buy'|'sell';trader:string;tokenUnits:string;curveQuoteLamports:string;userQuoteLamports:string;fees:Record<string,string>;
 invocationDepth:number;rootInvocationOrdinal:number;instructionLabel:string;eventIxName:string|null;eventBytesSha256:string;eventByteLength:number;
 slot:number;commitment:'confirmed'|'finalized';availableAt:number;programClockTimestamp:string;chainBlockTime:null;
 transferChecks:null;compiledInstructionIdentity:null;transactionCompleteness:'NOT_ESTABLISHED';
};
/** Parse only declared complete successful transaction log arrays, retaining actual
 * program-log positions. The result deliberately cannot satisfy the current
 * compiled-instruction/TransferChecked evidence contract. */
export function parseLogNativeEvidence(input:LogInput,scopes:readonly LogScope[]):LogNativeEvidence[]{
 need(input.err===null,'TRANSACTION_NOT_SUCCESSFUL');need(input.commitment==='confirmed'||input.commitment==='finalized','REQUEST_COMMITMENT');
 need(int(input.slot)&&int(input.availableAt),'AVAILABILITY');
 need(typeof input.signature==='string'&&bs58.decode(input.signature).length===64,'SIGNATURE');
 need(Array.isArray(input.logs)&&input.logs.length<=4096&&input.logs.every(s=>typeof s==='string'&&Buffer.byteLength(s)<=32768)&&Buffer.byteLength(JSON.stringify(input.logs))<=512*1024,'LOG_ENVELOPE');
 need(scopes.length>0&&scopes.length<=20,'SCOPES');const scopeMap=new Map<string,LogScope>();
 for(const scope of scopes){need(canonicalPumpPoolPda(new PublicKey(scope.mint)).toBase58()===scope.pool&&typeof scope.supportedPoolEvidence==='string'&&scope.supportedPoolEvidence.length>0&&!scopeMap.has(scope.pool),'VERIFIED_SCOPE_BINDING');scopeMap.set(scope.pool,scope);}
 const stack:Array<{program:string;label:string|null;root:number}>=[],result:LogNativeEvidence[]=[];let rootOrdinal=-1;
 for(let logArrayIndex=0;logArrayIndex<input.logs.length;logArrayIndex++){
  const line=input.logs[logArrayIndex] as string;
  need(!/log.*truncat|truncat.*log/i.test(line),'TRUNCATED');
  const invoke=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
  const end=/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(line);
  if(invoke){const depth=Number(invoke[2]);need(depth===stack.length+1&&depth>=1&&depth<=16,'INVOCATION_STACK');if(depth===1)rootOrdinal++;stack.push({program:invoke[1]!,label:null,root:rootOrdinal});continue;}
  if(end){need(stack.length>0&&stack.at(-1)!.program===end[1],'INVOCATION_END');need(end[2]==='success','FAILED_INVOCATION_UNSUPPORTED');stack.pop();continue;}
  const frame=stack.at(-1);if(frame?.program!==PROGRAM)continue;
  if(line.startsWith('Program log: Instruction: ')){need(frame.label===null,'DUPLICATE_INSTRUCTION_LABEL');frame.label=line.slice('Program log: Instruction: '.length);continue;}
  if(!line.startsWith('Program data: '))continue;
  const encoded=line.slice('Program data: '.length);need(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)&&encoded.length%4===0,'EVENT_BASE64');
  const bytes=Buffer.from(encoded,'base64'),event=coder.events.decode(encoded);need(event,'UNRECOGNIZED_PROGRAM_DATA');
  need(coder.types.encode(event.name,event.data).equals(bytes.subarray(8)),'EVENT_LAYOUT');
  if(!['BuyEvent','SellEvent'].includes(event.name))continue;
  const e=event.data as any,pool=key(e.pool),scope=scopeMap.get(pool);if(!scope)continue;
  const instruction=frame.label===null?undefined:LABELS[frame.label];need(instruction,'UNSUPPORTED_SWAP_LABEL');
  const side=event.name==='BuyEvent'?'buy':'sell';need(side==='buy'?instruction.startsWith('buy'):instruction.startsWith('sell'),'DIRECTION_LABEL');
  // Exact-quote Buy conventions were established using executed transfers. Field
  // names alone suggest the reverse and must not silently select the convention.
  const ixName=typeof e.ix_name==='string'?e.ix_name:null;
  if(side==='buy')need(ixName===instruction,'BUY_VARIANT_AGREEMENT');
  const exact=side==='buy'&&['buy_exact_quote_in','buy_exact_quote_in_v2'].includes(instruction);
  const economics={tokenUnits:decimal(e[side==='buy'?'base_amount_out':'base_amount_in']),curveQuoteLamports:decimal(e[side==='buy'?(exact?'user_quote_amount_in':'quote_amount_in'):'quote_amount_out']),userQuoteLamports:decimal(e[side==='buy'?(exact?'quote_amount_in':'user_quote_amount_in'):'user_quote_amount_out']),fees:Object.fromEntries(FEES.map(n=>[n,decimal(e[n])]))};
  need(BigInt(economics.tokenUnits)>0n&&BigInt(economics.curveQuoteLamports)>0n&&BigInt(economics.userQuoteLamports)>0n,'EMPTY_AMOUNTS');
  const identity={namespace:'solana-program-log-v1' as const,signature:input.signature,program:PROGRAM,logArrayIndex};
  result.push({version:'log-native-offline-v1-unadopted',normalizedForStrategy:false,identity,identityKey:[identity.namespace,input.signature,PROGRAM,logArrayIndex].join(':'),pool,mint:scope.mint,side,trader:key(e.user),...economics,invocationDepth:stack.length,rootInvocationOrdinal:frame.root,instructionLabel:frame.label!,eventIxName:ixName,eventBytesSha256:digest(bytes),eventByteLength:bytes.length,slot:input.slot,commitment:input.commitment,availableAt:input.availableAt,programClockTimestamp:e.timestamp.toString(10),chainBlockTime:null,transferChecks:null,compiledInstructionIdentity:null,transactionCompleteness:'NOT_ESTABLISHED'});
 }
 need(stack.length===0,'INCOMPLETE_LOG_STACK');return result;
}
export function compareLogToFull(log:LogNativeEvidence,full:MappedTradeEvidence){
 const fields=['pool','mint','side','trader','tokenUnits','curveQuoteLamports','userQuoteLamports'] as const;
 return fields.every(k=>log[k]===full[k])&&FEES.every(k=>log.fees[k]===full.fees[k]);
}

type Captured={signature:string;mint:string;pool:string;availableAt:number;tx:any;sourcePath:string;sourceLine:number;sourceLineSha256:string};
async function loadCorpus(runs:string,max=100){
 const paths=readdirSync(runs).filter(n=>n.startsWith('pilot-')&&!n.startsWith('pilot-si-history-')).sort().map(n=>join(runs,n)).filter(p=>{try{return JSON.parse(readFileSync(join(p,'result.json'),'utf8')).running===false;}catch{return false;}});
 const candidates:Captured[]=[],seen=new Set<string>(),files:Array<{path:string;bytes:number;sha256:string}>=[];let rowsExamined=0,totalRead=0;
 for(const p of paths){const path=join(p,'events.ndjson'),size=statSync(path).size;need(size<=20*1024*1024,'CORPUS_FILE_BOUND');totalRead+=size;need(totalRead<=200*1024*1024,'CORPUS_TOTAL_BOUND');files.push({path,bytes:size,sha256:digest(readFileSync(path))});let lineNo=0;const lines=createInterface({input:createReadStream(path),crlfDelay:Infinity});
  for await(const line of lines){lineNo++;if(!line.startsWith('{"kind":"pilot-confirmed-enrichment"'))continue;rowsExamined++;const d=JSON.parse(line).data;for(const hint of d.selectedHints??[]){const sig=hint.signature,mint=hint.mint;if(typeof sig!=='string'||typeof mint!=='string')continue;const id=sig+':'+mint;if(seen.has(id))continue;seen.add(id);candidates.push({signature:sig,mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),availableAt:d.rpcAvailableAt,tx:d.transaction,sourcePath:path,sourceLine:lineNo,sourceLineSha256:digest(line)});}
  }
 }
 // First accepted example of each actually mapped variant, then chronological
 // remainder, capped at100. Rejected shapes remain independently counted.
 const classified=candidates.map(c=>{try{const mapped=mapConfirmedPumpSwapEvidence(c.tx,{signature:c.signature,mint:c.mint,pool:c.pool,providerReceivedAt:null,availableAt:c.availableAt});return {c,mapped,error:null};}catch(e){return {c,mapped:[] as MappedTradeEvidence[],error:e instanceof Error?e.message:'unknown'};}});
 const selected:typeof classified=[],selectedIds=new Set<string>(),variants=new Set<string>();
 const add=(r:typeof classified[number])=>{const id=r.c.signature+':'+r.c.mint;if(selected.length<max&&!selectedIds.has(id)){selectedIds.add(id);selected.push(r);}};
 for(const r of classified)if(r.mapped.length){const type=r.mapped.map(m=>m.side+':'+(m.identity.swapInnerInstructionIndex===null?'direct':'routed')).join('|');if(!variants.has(type)){variants.add(type);add(r);}}
 for(const r of classified)if(r.error) add(r);
 for(const r of classified)add(r);
 return {files,rowsExamined,uniqueScopedTransactions:candidates.length,uniqueSignatures:new Set(candidates.map(c=>c.signature)).size,wholeCorpusMultipleScopedSwaps:classified.filter(r=>r.mapped.length>1).length,selected,classificationErrors:classified.filter(x=>x.error).reduce((a,x)=>(a[x.error!]=(a[x.error!]??0)+1,a),{} as Record<string,number>)};
}
async function main(){
 const opts=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2){need(process.argv[i]?.startsWith('--')&&process.argv[i+1],'CLI');opts.set(process.argv[i]!,process.argv[i+1]!);}
 const runs=resolve(opts.get('--runs')??'/workspace/poe-pilot/runs'),out=resolve(opts.get('--out')??'evidence/high-activity-20261028/log-native-offline-audit.json'),started=performance.now(),corpus=await loadCorpus(runs),rows:any[]=[];
 const reviewPath=opts.get('--doc-review');let documentationReview:unknown=null;if(reviewPath){const raw=readFileSync(resolve(reviewPath));need(raw.length<=2*1024*1024,'DOC_REVIEW_BOUND');const parsed=JSON.parse(raw.toString('utf8'));documentationReview=parsed.documentationReview??parsed;}
 for(const item of corpus.selected){const {c,mapped,error}=item;let logError:string|null=null,logs:LogNativeEvidence[]=[];const begin=performance.now();try{logs=parseLogNativeEvidence({signature:c.signature,slot:c.tx.slot,err:c.tx.meta.err,logs:c.tx.meta.logMessages,commitment:'confirmed',availableAt:c.availableAt},[{mint:c.mint,pool:c.pool,supportedPoolEvidence:'retained prior validated pool scope; not current account state'}]);}catch(e){logError=e instanceof Error?e.message:'unknown';}
  let unsupportedInstructions:unknown[]= [];if(error){try{inspectScopedPumpSwapInstructions(c.tx,{signature:c.signature,mint:c.mint,pool:c.pool});}catch(e){unsupportedInstructions=((e as any).checks??[]).map((check:any)=>{const ix=check.innerInstructionIndex===null?c.tx.transaction.message.instructions[check.outerInstructionIndex]:c.tx.meta.innerInstructions.find((g:any)=>g.index===check.outerInstructionIndex).instructions[check.innerInstructionIndex],raw=Buffer.from(bs58.decode(ix.data)),definitions=(JSON.parse(idlBytes.toString('utf8')) as Idl).instructions;return {...check,actualByteLength:raw.length,rawHex:raw.toString('hex'),idlDiscriminatorName:definitions.find(i=>Buffer.from(i.discriminator).equals(raw.subarray(0,8)))?.name??null};});}}
  const matches=logs.map(log=>{const candidates=mapped.filter(m=>{const group=c.tx.meta.innerInstructions.find((g:any)=>g.index===m.identity.outerInstructionIndex),ix=group?.instructions[m.identity.eventInnerInstructionIndex];return ix&&digest(Buffer.from(bs58.decode(ix.data)).subarray(8))===log.eventBytesSha256;});return {log,uniqueCpiByteMatches:candidates.length,full:candidates.length===1?candidates[0]:null,economicsMatch:candidates.length===1&&compareLogToFull(log,candidates[0]!),transferProofFromLogs:false};});
  rows.push({signature:c.signature,mint:c.mint,pool:c.pool,slot:c.tx.slot,transactionVersion:c.tx.version,fullMapperError:error,unsupportedInstructions,logError,fullMappedEvents:mapped.length,logMappedEvents:logs.length,processingMs:performance.now()-begin,transactionUtf8Bytes:Buffer.byteLength(JSON.stringify(c.tx)),logUtf8Bytes:Buffer.byteLength(JSON.stringify(c.tx.meta?.logMessages??null)),matches:matches.map(m=>({log:m.log,uniqueCpiByteMatches:m.uniqueCpiByteMatches,economicsMatch:m.economicsMatch,fullIdentity:m.full?.identity??null,fullTransferChecks:m.full?.transferChecks??null,feePayerEqualsEventTrader:c.tx.transaction.message.accountKeys[0]===m.log.trader,programClockEqualsBlockTime:m.log.programClockTimestamp===String(c.tx.blockTime),transferProofFromLogs:false})),input:{path:c.sourcePath,line:c.sourceLine,lineSha256:c.sourceLineSha256,transactionSha256:digest(JSON.stringify(c.tx)),availableAt:c.availableAt,liveLogReceiptAt:null}});
 }
 const matched=rows.filter(r=>!r.fullMapperError&&!r.logError),events=matched.flatMap(r=>r.matches),unacceptedLogEvents=rows.filter(r=>r.fullMapperError).flatMap(r=>r.matches),q=(xs:number[])=>{const a=[...xs].sort((a,b)=>a-b);return {count:a.length,p50:a.length?a[Math.ceil(a.length*.5)-1]:null,p95:a.length?a[Math.ceil(a.length*.95)-1]:null,max:a.at(-1)??null};},counts=(xs:string[])=>xs.reduce((a,x)=>(a[x]=(a[x]??0)+1,a),{} as Record<string,number>);
 const report={schemaVersion:1,classification:'OFFLINE_LOG_NATIVE_CAPACITY_AUDIT',decision:'NOT A DROP-IN REPLACEMENT: sampled economic parity can support a separately versioned log-native evidence contract; current per-transaction transfer/compiled-identity requirements still need full transactions.',generatedAt:new Date().toISOString(),networkRequestsDuringThisAudit:0,documentationReview,ledgerWrites:0,productionTouched:false,source:{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scriptSha256:digest(readFileSync(new URL(import.meta.url))),mapperSha256:digest(readFileSync('src/pumpapi-mapping.ts')),idlSha256:digest(idlBytes),sdk:'@pump-fun/pump-swap-sdk@2.2.0'},selection:{method:'All settled pilot intervals, deduplicate signature+mint, retain first observed direct/routed side combination, then refusal cases, then chronological remainder; maximum100 scoped transactions. Activity-biased transport/field sample, not market coverage/performance.',files:corpus.files,rowsExamined:corpus.rowsExamined,uniqueScopedTransactions:corpus.uniqueScopedTransactions,uniqueTransactionSignatures:corpus.uniqueSignatures,wholeCorpusMultipleSwapsInSameSelectedPool:corpus.wholeCorpusMultipleScopedSwaps,selectedTransactions:rows.length,allCorpusFullMapperRefusals:corpus.classificationErrors},measured:{elapsedMs:performance.now()-started,pairedAcceptedTransactions:matched.length,pairedEvents:events.length,logOnlyEventsInFullMapperRefusedTransactions:unacceptedLogEvents.length,eventShapeCounts:counts(events.map(x=>x.log.side+':'+x.log.instructionLabel+':'+(x.log.invocationDepth===1?'direct':'routed'))),allPairedEventBytesUnique:events.every(x=>x.uniqueCpiByteMatches===1),allPairedEconomicFieldsEqual:events.every(x=>x.economicsMatch),mappedEventDenominatorsEqual:matched.every(x=>x.fullMappedEvents===x.logMappedEvents),multipleSwapTransactions:matched.filter(r=>r.fullMappedEvents>1).length,feePayerDiffers:events.filter(x=>!x.feePayerEqualsEventTrader).length,programClockDiffersFromBlockTime:events.filter(x=>!x.programClockEqualsBlockTime).length,refusalCounts:counts(rows.filter(r=>r.logError).map(r=>r.logError)),parseProcessingMs:q(rows.map(r=>r.processingMs)),capturedTransactionBytes:rows.reduce((n,r)=>n+r.transactionUtf8Bytes,0),capturedLogBytes:rows.reduce((n,r)=>n+r.logUtf8Bytes,0),memory:process.memoryUsage()},capacity:{existingMethodCap:{starts:8,perMs:10000,upperBoundSteadyStatePerMinute:48},burst17:{requiresRpcEnrichments:17,knownLocalCapWithinFiveSecondDeadline:8,atLeastUnservedUnderSameTenSecondCap:9,requiredBurstEquivalentPerMinute:204,warning:'204/min is an instantaneous17/5s demand equivalence, not a sustainable allowance. Actual starts may be fewer because pacing, delay, occupancy, audit/protection share the gate.'},burst18:{requiresRpcEnrichments:18,atLeastUnservedUnderSameTenSecondCap:10},logNativeProjectedEnrichmentRequests:0,logNativeProjectionCondition:'Only after adopting a validated versioned event contract. Subscription management, notification bytes, independent coverage audits, support reads, protection and bounded fallbacks remain; zero enrichment is not zero RPC or verified capacity.',currentAuditBeforeOtherWorkPerMinute:{sixPools:36,twelvePools:72},localRequestLimitPerMinute:60},refusedTransactionFixtures:corpus.selected.filter(r=>r.error).map(r=>({signature:r.c.signature,mint:r.c.mint,pool:r.c.pool,rpcAvailableAt:r.c.availableAt,fullMapperRefusalAtAuditVersion:r.error,transaction:r.c.tx,meaning:'Retained historical payload, rechecked under this source version. Refusal is not a claim of current forward incidence.'})),requiredGaps:[{field:'Executed SPL transfers and compiled roles',status:'UNAVAILABLE_FROM_LOGS',detail:'TransferChecked program labels omit integer amounts and source/destination account keys. Full mapper transfer checks cannot be set true from logs or sampled audit.'},{field:'Compiled outer/inner event identity',status:'UNAVAILABLE_FROM_LOGS',detail:'Actual log-array index is retained in a separate identity namespace. Root invocation ordinal is not compiled outer instruction index; compute-budget/nonlogging instructions make inference unsafe.'},{field:'Block timestamp and information availability',status:'DIFFERENT_EVIDENCE',detail:'A program Clock timestamp is not RPC blockTime. Retained getTransaction availability is recorded; no earlier live logs receipt is fabricated.'},{field:'Transport completeness and recovery',status:'UNTESTED',detail:'No live logsSubscribe receipt, pool filter, gaps, reconnect, fork/correction, duplication or resource headroom is established by this offline audit.'},{field:'Protocol/unknown shapes',status:'REFUSE_OR_VERSIONED_SUPPORT',detail:'Boost buy-and-burn, unknown instruction labels, failed invocations, truncated logs and malformed stack/layout require explicit unavailable state or bounded full-transaction fallback.'}],rows};
 need(Buffer.byteLength(JSON.stringify(report))<=2*1024*1024,'REPORT_BOUND');writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({out,transactions:rows.length,paired:matched.length,events:events.length,equal:report.measured.allPairedEconomicFieldsEqual,refusals:report.measured.refusalCounts,networkRequests:0}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)void main().catch(e=>{console.error(e instanceof Error?e.message:'OFFLINE_AUDIT_FAILED');process.exitCode=1;});
