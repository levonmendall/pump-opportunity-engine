/** Explicit experimental PAPER evidence contract. Pure bounded readiness only:
 * no provider request, financial writer, entry permission or execution lives here.
 * Historical V2 and V3-shadow contracts remain distinct and unchanged. */
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import type {FlowFeatures} from './strategy.js';

export const NATIVE_PAPER_DATA_CONTRACT_VERSION='confirmed-program-ordinary-flow-paper-v1' as const;
export const NATIVE_PAPER_CONTRACT=Object.freeze({
 schemaVersion:1,version:NATIVE_PAPER_DATA_CONTRACT_VERSION,experimental:true,mode:'PAPER',liveTradingEnabled:false,
 authority:'successful-confirmed-or-finalized-pump-amm-program-authored-events',
 sources:Object.freeze(['confirmed-program-events-v2','confirmed-program-activity-v3-shadow'] as const),
 strategy:Object.freeze({baseline:'persistent-buying-v0-unfrozen',pilotBaseContractSha256:'665b28e6cdc326b20cd5e921fbddbaf9fdfd786ce80cbd2286d98a00a8fef2a9',thresholdChanges:false,windowMs:60000,bucketMs:10000,entryAgeCheckedSeparately:true}),
 identity:'signature/program/log-array-index/frame-ordinal; no invented compiled index',
 trader:'program-event user role; neither fee-payer substitution nor independent-person attribution',
 amounts:'executed integer ordinary buy/sell curve amounts and pinned-event fee conventions',
 protocol:'validated protocol pool effects are not ordinary buyers/trades; each effect advances pricing slot floors',
 integrity:'fresh canonical support, current ACK generation, exact closed window, independent executed-flow audit, actual availability and unchanged refusal checks',
 unavailableAssertions:Object.freeze(['per-transaction SPL transfer cross-check','compiled account/instruction roles','RPC block timestamp from program Clock'] as const),
 qualification:'evidence readiness alone grants no prediction, entry-age eligibility, executable quote, financial permission or fill',
});
export const NATIVE_PAPER_CONTRACT_SHA256='f23ea927f0bc8bdc0e96d8d8fb774f110fc94de7d68d0927038db83d296fcc3b';
if(createHash('sha256').update(JSON.stringify(NATIVE_PAPER_CONTRACT)).digest('hex')!==NATIVE_PAPER_CONTRACT_SHA256)throw Error('NATIVE_PAPER_CONTRACT_HASH');

export type NativePaperAuditCertificate={schemaVersion:1;mint:string;pool:string;dataContract:string;openedAt:number;connectionId:number;subscriptionId:number;windowStartAt:number;windowEndAt:number;auditAvailableAt:number;admittedAt:number;deadlineAt:number;notificationCompletenessVerified:boolean;executedFlowCompletenessVerified:boolean;featuresSha256:string};
export type NativePaperEvidenceInput={contractVersion:unknown;certificate:unknown;at:number;mint:string;pool:string;dataContract:string;openedAt:number|null;connectionId:number|null;subscriptionId:number|null;features:unknown;connected:boolean;sourceSupportFresh:boolean;hasQualityLoss:boolean};
const FEATURE_KEYS=['mint','asOf','windowStartAt','windowEndAt','sufficientlyObserved','qualityReason','buyLamports','sellLamports','netBuyLamports','tradeCount','provisionalTradeCount','distinctBuyerWallets','largestBuyerBps','positiveNetBuckets','priceReturnBps','firstPrice','lastPrice'] as const;
const CERTIFICATE_KEYS=['schemaVersion','mint','pool','dataContract','openedAt','connectionId','subscriptionId','windowStartAt','windowEndAt','auditAvailableAt','admittedAt','deadlineAt','notificationCompletenessVerified','executedFlowCompletenessVerified','featuresSha256'] as const;
const int=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const signed=(v:unknown):v is number=>Number.isSafeInteger(v);
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const amount=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,63})$/.test(v);
const key=(v:unknown)=>{try{return typeof v==='string'&&v.length<=44&&bs58.decode(v).length===32;}catch{return false;}};
function need(v:unknown):asserts v{if(!v)throw Error('NATIVE_PAPER_INVALID_FEATURES');}
function price(v:unknown){if(v===null)return null;need(plain(v)&&exact(v,['quoteLamports','tokenUnits'])&&amount(v.quoteLamports)&&amount(v.tokenUnits)&&BigInt(v.quoteLamports)>0n&&BigInt(v.tokenUnits)>0n);return {quoteLamports:v.quoteLamports,tokenUnits:v.tokenUnits};}
function checkedFeatures(value:unknown):FlowFeatures{
 need(plain(value)&&exact(value,FEATURE_KEYS));const f=value;
 need(key(f.mint)&&int(f.asOf)&&int(f.windowStartAt)&&int(f.windowEndAt)&&f.windowEndAt-f.windowStartAt===60000&&f.windowEndAt%10000===0&&f.asOf>=f.windowEndAt&&f.asOf<f.windowEndAt+10000);
 need(typeof f.sufficientlyObserved==='boolean'&&(f.qualityReason===null||typeof f.qualityReason==='string'&&f.qualityReason.length>0&&f.qualityReason.length<=128&&!/[\u0000-\u001f]/.test(f.qualityReason)));
 need(amount(f.buyLamports)&&amount(f.sellLamports)&&typeof f.netBuyLamports==='string'&&/^-?(0|[1-9][0-9]{0,63})$/.test(f.netBuyLamports)&&BigInt(f.buyLamports)-BigInt(f.sellLamports)===BigInt(f.netBuyLamports));
 need(int(f.tradeCount)&&f.tradeCount<=4096&&int(f.provisionalTradeCount)&&f.provisionalTradeCount<=f.tradeCount&&int(f.distinctBuyerWallets)&&f.distinctBuyerWallets<=f.tradeCount&&int(f.largestBuyerBps)&&f.largestBuyerBps<=10000&&int(f.positiveNetBuckets)&&f.positiveNetBuckets<=6&&(f.priceReturnBps===null||signed(f.priceReturnBps)));
 const first=price(f.firstPrice),last=price(f.lastPrice);need((f.tradeCount===0&&first===null&&last===null)||(f.tradeCount>0&&first!==null&&last!==null));
 return {...f,firstPrice:first,lastPrice:last} as FlowFeatures;
}
/** Canonical bounded closed-window fingerprint. `asOf` advances while the same
 * six closed buckets remain unchanged, so it is validated but not hashed. The
 * real window bounds, quality and every predictive feature are retained. */
export function nativePaperFeaturesSha256(features:unknown):string{
 try{const f=checkedFeatures(features),keys=FEATURE_KEYS.filter(k=>k!=='asOf').slice().sort();const value=Object.fromEntries(keys.map(k=>[k,k==='firstPrice'||k==='lastPrice'?f[k]===null?null:{quoteLamports:f[k]!.quoteLamports,tokenUnits:f[k]!.tokenUnits}:f[k]]));return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
 catch{throw Error('NATIVE_PAPER_INVALID_FEATURES');}
}
/** Synchronous evidence admission. The caller separately applies entry age,
 * prediction, actual-size pricing, own-position protection and ledger risk. */
export function nativePaperEvidenceReady(input:NativePaperEvidenceInput):boolean{
 try{
  if(input.contractVersion!==NATIVE_PAPER_DATA_CONTRACT_VERSION||!int(input.at)||!key(input.mint)||!key(input.pool)||!NATIVE_PAPER_CONTRACT.sources.includes(input.dataContract as never)||input.connected!==true||input.sourceSupportFresh!==true||input.hasQualityLoss!==false)return false;
  const value=input.certificate;if(!plain(value)||!exact(value,CERTIFICATE_KEYS))return false;const c=value as unknown as NativePaperAuditCertificate,f=checkedFeatures(input.features);
  if(c.schemaVersion!==1||c.mint!==input.mint||c.pool!==input.pool||c.dataContract!==input.dataContract||c.openedAt!==input.openedAt||c.connectionId!==input.connectionId||c.subscriptionId!==input.subscriptionId||!int(c.openedAt)||!int(c.connectionId)||!int(c.subscriptionId))return false;
  if(!int(c.windowStartAt)||!int(c.windowEndAt)||c.windowEndAt-c.windowStartAt!==60000||c.windowEndAt%10000!==0||c.openedAt>c.windowStartAt||c.windowStartAt!==f.windowStartAt||c.windowEndAt!==f.windowEndAt||f.mint!==input.mint||f.asOf!==input.at||!f.sufficientlyObserved||f.qualityReason!==null||f.provisionalTradeCount!==0)return false;
  if(!int(c.auditAvailableAt)||!int(c.admittedAt)||!int(c.deadlineAt)||c.auditAvailableAt<c.windowEndAt||c.admittedAt<c.auditAvailableAt||c.deadlineAt!==c.windowEndAt+9999||c.admittedAt>input.at||input.at>c.deadlineAt)return false;
  if(typeof c.notificationCompletenessVerified!=='boolean'||c.executedFlowCompletenessVerified!==true||typeof c.featuresSha256!=='string'||!/^[a-f0-9]{64}$/.test(c.featuresSha256))return false;
  return nativePaperFeaturesSha256(f)===c.featuresSha256;
 }catch{return false;}
}
