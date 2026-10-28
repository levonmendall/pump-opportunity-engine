/** Bounded, pure projection of the isolated PAPER account. No provider, writer or publisher. */
import {createHash} from 'node:crypto';
import type {LedgerState,Mark,PaperLedger,ReportingHistory,ReportingPoint,UsdPrice} from './ledger.js';
import {validateSnapshot,validateReportingTradeCache,reportingFilledTrade,type ReportingFilledTrade,type ReportingTradeCache,type ReportingIdentity,type Snapshot} from './reporting.js';

type Projection=ReturnType<PaperLedger['projection']>;
type JournalRow={revision:number;action_id:string;at:number;kind:string;detail:string};
type Decision={mint:string;at:number;stage:string;reason:string};
export type PilotPortfolioInput={
 at:number;running:boolean;state:Readonly<LedgerState>;projection:Projection;identity:ReportingIdentity;sequence:string;
 price:UsdPrice|null;marks:Readonly<Record<string,Mark>>;sourceValidUntil?:number;history:ReportingHistory;
 journal:readonly unknown[];actionResults:ReadonlyMap<string,unknown>;tradeCache?:ReportingTradeCache;decisions:readonly Decision[];
 funnel:Snapshot['funnel'];connected:boolean;warming:boolean;usefulProgressAt:number|null;blocker:string|null;
 metrics:{eventLoopLagMs:number|null;processingLagMs:number|null;providerEvents:number;rpcRequests:number;rpcAvailable:boolean};
};
const iso=(at:number)=>new Date(at).toISOString(),micro=(v:string|null)=>v===null?null:Number(BigInt(v))/1e6;
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown,max=128):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
const sol=(v:string)=>{const n=BigInt(v),whole=n/1000000000n,part=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');return whole.toString()+(part?'.'+part:'');};
function priceAt(price:UsdPrice|null,at:number){return price&&uint(price.microUsdPerSol)&&BigInt(price.microUsdPerSol)>0n&&integer(price.at)&&price.at<=at&&at-price.at<=10000&&text(price.source,512)?BigInt(price.microUsdPerSol):null;}
const usd=(lamports:string,price:bigint)=>Number(BigInt(lamports)*price/1000000000n)/1e6;
const shortId=(kind:string,value:string)=>kind+':'+createHash('sha256').update(value).digest('hex').slice(0,32);

/** Add only real reporting observations. A gap marker is conservative absence,
 * not an interpolated price. Inception capital is the existing ledger fact. */
export function pilotReportingPoints(history:ReportingHistory,input:{at:number;inceptionAt:number;running:boolean;reconciled:boolean;tradingMicroUsd:string|null;economicMicroUsd:string|null}):ReportingPoint[]{
 need(integer(input.at)&&integer(input.inceptionAt)&&input.at>=input.inceptionAt,'PILOT_REPORTING_TIME');
 const last=history.points.at(-1);need(!last||last.at<=input.at,'PILOT_REPORTING_TIME_REGRESSION');
 const next:ReportingPoint[]=[];
 if(!last){next.push({at:input.inceptionAt,tradingMicroUsd:'0',economicMicroUsd:null});if(input.at>input.inceptionAt+1)next.push({at:input.inceptionAt+1,tradingMicroUsd:null,economicMicroUsd:null});}
 else if(input.at-last.at>15000&&last.at+1<input.at&&(last.tradingMicroUsd!==null||last.economicMicroUsd!==null))next.push({at:last.at+1,tradingMicroUsd:null,economicMicroUsd:null});
 if(input.at>(next.at(-1)?.at??last?.at??-1))next.push({at:input.at,tradingMicroUsd:input.running&&input.reconciled?input.tradingMicroUsd:null,economicMicroUsd:input.running&&input.reconciled?input.economicMicroUsd:null});
 return next;
}

/** Rows are capped upstream at50. A real fill needs both its durable outcome
 * and its order/attempt payload; absent bounded history is disclosed, not guessed. */
export function projectPilotFilledTrades(input:Pick<PilotPortfolioInput,'journal'|'actionResults'|'state'|'at'>){
 need(input.journal.length<=50,'PILOT_REPORTING_JOURNAL_BOUND');
 const rows:JournalRow[]=input.journal.map(value=>{const r=value as JournalRow;need(r&&integer(r.revision)&&text(r.action_id,160)&&integer(r.at)&&text(r.kind,80)&&typeof r.detail==='string'&&Buffer.byteLength(r.detail)<=65536,'PILOT_REPORTING_JOURNAL');return r;});
 const orders=new Map<string,any>();for(const row of rows)if(row.kind==='order'){const d=JSON.parse(row.detail);if(d.input&&text(d.input.id,128))orders.set(d.input.id,d);}
 const trades:ReportingFilledTrade[]=[];let unresolvedFilledRows=0;
 for(const row of rows){if(row.kind!=='attempt')continue;const result=input.actionResults.get(row.action_id) as {status?:unknown}|undefined;if(result?.status!=='filled')continue;
  const d=JSON.parse(row.detail),trade=reportingFilledTrade(row.action_id,row.at,d,orders.get(d.orderId),result);
  if(!trade||row.at<input.state.inceptionAt||row.at>input.at){unresolvedFilledRows++;continue;}trades.push(trade);
 }
 return {trades:trades.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,50),unresolvedFilledRows};
}

type ValuationInput=Pick<PilotPortfolioInput,'at'|'state'|'projection'|'price'|'marks'|'sourceValidUntil'>;
function portfolioValidity(input:ValuationInput){const {state:s,projection:p,at}=input;
 const currentPrice=priceAt(input.price,at),validMark=(mint:string)=>{const m=input.marks[mint],position=s.positions[mint];return !!(m&&position&&m.pricedBaseUnits===position.units&&uint(m.netLamports)&&text(m.evidence,512)&&integer(m.at)&&m.at<=at&&at-m.at<=2000&&integer(input.sourceValidUntil)&&input.sourceValidUntil>=30000&&input.sourceValidUntil>=at&&input.sourceValidUntil<=at+30000);};
 const held=Object.keys(s.positions),markTimes=held.map(mint=>validMark(mint)?input.marks[mint]!.at:0);
 const marksUsable=markTimes.every(t=>t>0);
 const marketAt=!marksUsable?null:markTimes.length?Math.min(...markTimes,input.sourceValidUntil!-30000):currentPrice===null?null:input.price!.at;
 const reconciled=s.daily.day===iso(at).slice(0,10)&&s.daily.reconciledAt>0&&s.daily.reconciledAt<=at&&at-s.daily.reconciledAt<=2000&&p.equityMicroUsd!==null&&!p.unknownMarks&&currentPrice!==null&&marksUsable;
 return {currentPrice,validMark,marksUsable,marketAt,reconciled};
}
export function pilotPortfolioReconciled(input:ValuationInput){return portfolioValidity(input).reconciled;}
export function pilotExperimentalAccounting(input:ValuationInput){const {state:s,projection:p,at}=input,total=portfolioValidity(input).marksUsable?p.totalPnlLamports:null;return {schemaVersion:1 as const,at,totalPnlLamports:total,realizedLamports:s.realizedLamports,unrealizedLamports:total===null?null:(BigInt(total)-BigInt(s.realizedLamports)).toString(),executionCostsLamports:s.executionCosts,lockedDepositLamports:p.lockedDepositLamports};}

export function buildPilotPortfolio(input:PilotPortfolioInput):Snapshot {
 const {state:s,projection:p,identity,at}=input;
 need(integer(at)&&s.mode==='PAPER'&&/^poe-pilot-[a-z0-9-]+$/.test(s.accountId)&&p.accountId===s.accountId&&identity.accountId===s.accountId&&identity.inceptionAt===iso(s.inceptionAt)&&p.inceptionAt===s.inceptionAt&&s.initialMicroUsd==='1000000000','PILOT_REPORTING_IDENTITY');
 const {currentPrice,validMark,marksUsable,marketAt,reconciled}=portfolioValidity(input);
 const history=input.history.points.map(point=>({at:iso(point.at),tradingUsd:micro(point.tradingMicroUsd),economicUsd:micro(point.economicMicroUsd)}));
 const projected=projectPilotFilledTrades(input),unresolvedFilledRows=projected.unresolvedFilledRows;
 const cached=input.tradeCache?validateReportingTradeCache(input.tradeCache,s.accountId,s.inceptionAt,at).trades:projected.trades;const trades=cached.map(({actionId,...trade})=>trade);
 const snapshot:Snapshot={project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,schemaVersion:1,
  account:{id:s.accountId,inceptionAt:identity.inceptionAt,initialUsd:1000},sequence:input.sequence,source:{release:identity.release,strategy:identity.strategy},
  times:{generatedAt:iso(at),marketAt:marketAt===null?null:iso(marketAt),reconciledAt:s.daily.reconciledAt?iso(s.daily.reconciledAt):null,usefulProgressAt:input.usefulProgressAt===null?null:iso(input.usefulProgressAt)},
  status:{runtime:input.running?'running':'stopped',market:!input.connected||marketAt===null?'unavailable':input.warming?'warming':'observing',entries:p.entriesEnabled&&reconciled?'enabled':'paused',reconciled,blocker:input.blocker},
  balances:{cashSol:sol(p.cashLamports),reservedSol:sol(p.reservedLamports),equitySol:p.equityLamports===null||!marksUsable?null:sol(p.equityLamports),equityUsd:currentPrice===null||!marksUsable?null:micro(p.equityMicroUsd),realizedUsd:null,unrealizedUsd:null,tradingPnlUsd:currentPrice===null||!marksUsable?null:micro(p.totalPnlMicroUsd),economicPnlUsd:currentPrice===null||!marksUsable?null:micro(p.economicPnlMicroUsd),positionCostUsd:micro(p.positionCostMicroUsd)!,markedExposureUsd:currentPrice===null||!marksUsable||p.positionLiquidationLamports===null?null:usd(p.positionLiquidationLamports,currentPrice),drawdownUsd:null,executionCostsUsd:s.executionCosts==='0'?0:null,operatingCostsUsd:micro(p.operatingCostsMicroUsd),passiveSolEquityUsd:micro(p.passiveSolEquityMicroUsd),solPriceUsd:currentPrice===null?null:Number(currentPrice)/1e6},
  costLabels:{execution:'simulated',operating:p.operatingCostClassification},
  positions:Object.values(s.positions).map(position=>({mint:position.mint,label:position.mint,quantity:position.units,enteredAt:iso(position.enteredAt),entryCostUsd:micro(position.costMicroUsd)!,netLiquidationUsd:currentPrice!==null&&validMark(position.mint)?usd(input.marks[position.mint]!.netLamports,currentPrice):null,executionCostsUsd:Number(BigInt(position.costMicroUsd)*BigInt(position.entryGas)/(BigInt(position.entryGas)+BigInt(position.entryLamports)))/1e6,status:'PAPER held; entry-gas USD allocated (<$0.000001 rounding uncertainty)'})),
  trades,decisions:input.decisions.slice(-50).map(d=>({id:shortId('decision',JSON.stringify([d.at,d.mint,d.stage,d.reason])),mint:d.mint,at:iso(d.at),stage:d.stage,reason:d.reason})),pnl:history,
  history:{windowStartAt:history[0]?.at??null,downsampled:input.history.downsampled,label:`${input.history.windowLimited?'WINDOW LIMITED. ':''}${input.tradeCache?.windowLimited?'TRADE WINDOW LIMITED. ':''}Actual samples; >15s/stopped/unreconciled gaps; max720. Max50 durable fills cached; ${unresolvedFilledRows} recent fills lack order context. Historical USD P&L/gas unverified; portfolio change includes passive SOL/USD.`},
  funnel:{...input.funnel},metrics:{processingLagMs:input.metrics.processingLagMs,eventLoopLagMs:input.metrics.eventLoopLagMs,providerEvents:input.metrics.providerEvents,rpcRequests:input.metrics.rpcRequests,projectedDailyDataSol:null,budgetRemainingSol:null,budgetStatus:input.metrics.rpcAvailable?'available':'degraded',coverage:'Current-run counters; experimental admitted candidates only; raw feed messages and shared physical operation counts. No independent full-market denominator. Held actual-size marks require fresh coherent validated state.',latency:'Held market time is the oldest validated bank Clock, not getBlockTime. No real transaction landing claim.'}};
 return validateSnapshot(snapshot,identity,at);
}
