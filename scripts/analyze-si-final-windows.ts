/** Offline historical diagnostics only. Never supplies a forward feature window. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,basename} from 'node:path';
import {PROVISIONAL_RULE} from '../src/strategy.js';
import {decodeProtocolBuyAndBurns} from './decode-protocol-flow.js';

const root='evidence/opportunity-coverage-20261027';
const read=(name:string)=>JSON.parse(readFileSync(join(root,name),'utf8'));
const hash=(name:string)=>createHash('sha256').update(readFileSync(join(root,name))).digest('hex');
const mint='5fYBASRkQ7GHypQMShaYRWUyXQ74tbwZ51hBfzPXpump',pool='3guuqmtbVjQvY3mTQqMc2M7k33gZG8cyVrHrpYMzixL2';
const history=read('si-history-page-1-20261027232707767.json');
const lifecycle=read('si-local-lifecycle.json'),migrationAt=lifecycle.identity.chainBlockTimeSeconds*1000;
// Freeze before computing any result. These are two diagnostics, not a search.
const shadows=Object.freeze([
  {version:'si-age-shadow-4m-v1',minimumAgeMs:240000,minimumNetBuyLamports:'1000000000',minimumPositiveBuckets:4,minimumBuyers:5,maximumLargestBuyerBps:3500},
  {version:'si-moderate-flow-shadow-v1',minimumAgeMs:300000,minimumNetBuyLamports:'500000000',minimumPositiveBuckets:3,minimumBuyers:3,maximumLargestBuyerBps:5000},
]);
function predicates(f:any,rule:any,decisionAt:number){return {
  entryAgeEligible:decisionAt-migrationAt>=rule.minimumAgeMs&&decisionAt-migrationAt<=PROVISIONAL_RULE.maximumAgeMs,
  netBuying:BigInt(f.netBuyLamports)>=BigInt(rule.minimumNetBuyLamports),
  persistence:f.positiveNetBuckets>=rule.minimumPositiveBuckets,
  buyerAddresses:f.distinctBuyerWallets>=rule.minimumBuyers,
  concentration:f.largestBuyerBps<=rule.maximumLargestBuyerBps,
  priceStructure:f.priceReturnBps!==null&&f.priceReturnBps>=0,
};}
const sourceWindows=[
  {file:'si-historical-window-mapping-20261027233451534.json',start:1793132720},
  {file:'si-historical-window-mapping-20261027234449066.json',start:1793132760},
];
const windows=sourceWindows.map(({file,start})=>{
  const rows=read(file) as any[],denominator=history.filter((r:any)=>r.blockTime>=start&&r.blockTime<start+60),successful=denominator.filter((r:any)=>r.err===null);
  const receiptFile=file.replace('si-historical-window-mapping-','si-history-receipt-'),receipt=read(receiptFile);
  const raw=new Map<string,{tx:any;name:string;requestedAt:number;availableAt:number}>();
  for(const call of receipt.calls.filter((c:any)=>c.method==='getTransaction')){
    const name=basename(call.artifact.file),tx=read(name),signature=call.params[0];
    if(hash(name)!==call.artifact.sha256||tx.transaction?.signatures?.[0]!==signature)throw Error('ORIGINAL_RESPONSE_PROVENANCE_MISMATCH');
    raw.set(signature,{tx,name,requestedAt:call.requestedAt,availableAt:call.availableAt});
  }
  const expected=new Set(successful.map((r:any)=>r.signature));
  if(rows.length!==expected.size||new Set(rows.map(r=>r.signature)).size!==expected.size||rows.some(r=>!expected.has(r.signature)))throw Error('HISTORY_DENOMINATOR_MISMATCH');
  const ordinary=rows.flatMap(row=>(row.mapped??[]).map((trade:any)=>({row,trade,tx:raw.get(row.signature)?.tx})));
  if(ordinary.some(r=>!Number.isSafeInteger(r.tx?.transactionIndex)))throw Error('HISTORICAL_ORDER_UNAVAILABLE');
  ordinary.sort((a,b)=>a.row.slot-b.row.slot||a.tx.transactionIndex-b.tx.transactionIndex||a.trade.identity.outerInstructionIndex-b.trade.identity.outerInstructionIndex||(a.trade.identity.swapInnerInstructionIndex??-1)-(b.trade.identity.swapInnerInstructionIndex??-1)||a.trade.identity.eventInnerInstructionIndex-b.trade.identity.eventInnerInstructionIndex);
  let bought=0n,sold=0n;const bins=Array<bigint>(6).fill(0n),buyers=new Map<string,bigint>();
  for(const {row,trade} of ordinary){const q=BigInt(trade.curveQuoteLamports),buy=trade.side==='buy',bin=Math.floor((row.chainBlockTime-start)/10);if(bin<0||bin>=6)throw Error('OUTSIDE_WINDOW');bins[bin]!+=buy?q:-q;if(buy){bought+=q;buyers.set(trade.trader,(buyers.get(trade.trader)??0n)+q);}else sold+=q;}
  const first=ordinary[0]?.trade,last=ordinary.at(-1)?.trade;
  let returnBps:number|null=null;
  if(first&&last){const numerator=(BigInt(last.curveQuoteLamports)*BigInt(first.tokenUnits)-BigInt(first.curveQuoteLamports)*BigInt(last.tokenUnits))*10000n,denom=BigInt(first.curveQuoteLamports)*BigInt(last.tokenUnits);returnBps=Number(numerator<0n?-((-numerator+denom-1n)/denom):numerator/denom);}
  const largest=[...buyers.values()].reduce((a,b)=>a>b?a:b,0n);
  const subset={amountConvention:'curve',tradeCount:ordinary.length,buys:ordinary.filter(r=>r.trade.side==='buy').length,sells:ordinary.filter(r=>r.trade.side==='sell').length,buyLamports:String(bought),sellLamports:String(sold),netBuyLamports:String(bought-sold),distinctBuyerWallets:buyers.size,largestBuyerBps:bought?Number((largest*10000n+bought-1n)/bought):0,positiveNetBuckets:bins.filter(x=>x>0n).length,netByChainTenSecondBucketLamports:bins.map(String),priceReturnBps:returnBps,firstIdentity:first?.identity,lastIdentity:last?.identity,buyerAddressAmounts:Object.fromEntries([...buyers.entries()].map(([key,value])=>[key,String(value)]))};
  const errors=rows.filter(r=>r.error),protocol=errors.map(row=>{
    if(row.error!=='UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW')throw Error('OTHER_UNRESOLVED_MAPPING');
    const captured=raw.get(row.signature);if(!captured)throw Error('RAW_TRANSACTION_MISSING');
    const evidence=decodeProtocolBuyAndBurns(captured.tx,{signature:row.signature,mint,pool,providerReceivedAt:null,availableAt:captured.availableAt,commitment:'confirmed'});
    if(evidence.length!==1)throw Error('EXPECTED_ONE_TESTED_PROTOCOL_INSTRUCTION');
    const e=evidence[0]!;
    return {signature:row.signature,slot:row.slot,chainBlockTime:row.chainBlockTime,rawFile:captured.name,rawSha256:hash(captured.name),classification:'protocol-buy-and-burn',ordinaryBuyer:false,actor:e.actor,usedQuoteLamports:e.amounts.usedQuoteLamports,burnedBaseUnits:e.amounts.burnedBaseUnits,fees:e.fees,identity:e.identity,identityKey:e.identityKey,originalHistoricalAuditRpcRequestedAt:captured.requestedAt,originalHistoricalAuditRpcAvailableAt:e.recordedRpcAvailableAt,subsequentMappingAvailableAt:row.availableAt,decodeComponentVersion:e.version,fundingProvenance:'NOT_TRACED; boost vault debit verified, fee-only source not established',normalizedForStrategy:false};
  });
  const protocolQuote=protocol.reduce((n,p)=>n+BigInt(p.usedQuoteLamports),0n);
  const rawPredicates=predicates(subset,PROVISIONAL_RULE,(start+60)*1000);
  return {
    windowStartIso:new Date(start*1000).toISOString(),windowEndExclusiveIso:new Date((start+60)*1000).toISOString(),sourceMappingFile:file,sourceMappingSha256:hash(file),
    historicalDenominator:{scope:'pool-address transaction history from one independently bounded page, filtered by chain blockTime; not all-market census',addressTransactions:denominator.length,successfulTransactions:successful.length,failedTransactionsExcluded:denominator.length-successful.length,allSuccessfulTransactionResponsesRetained:true,ordinarySwapTransactions:rows.filter(r=>r.mapped?.length).length,protocolBuyAndBurnTransactions:protocol.length,successfulTransactionsWithoutScopedSupportedSwapOrBoost:rows.filter(r=>!r.error&&!r.mapped?.length).length,nonSwapCompleteness:'No scoped supported-swap/Boost detected by existing inspector; not general transaction semantic proof'},
    informationTime:{interpretation:'Retrospective chain-time diagnostics, NOT replay of forward availability',partitionTime:'RPC blockTime seconds, not original provider receipt',originalAuditRpcAvailableAtMinimum:Math.min(...[...raw.values()].map(r=>r.availableAt)),originalAuditRpcAvailableAtMaximum:Math.max(...[...raw.values()].map(r=>r.availableAt)),recordedMappingAvailableAtMinimum:Math.min(...rows.map(r=>r.availableAt)),recordedMappingAvailableAtMaximum:Math.max(...rows.map(r=>r.availableAt)),mappingTimeCaveat:'Resume remaps retained responses; mapping availability is not their original audit-RPC response time',actualHistoricalForwardReceiptForTheseTransactions:'UNAVAILABLE; none was backdated',sourceReceiptFile:receiptFile,sourceReceiptSha256:hash(receiptFile)},
    ordinarySubset:subset,
    protocolEvidence:protocol,
    protocolEffects:{knownProtocolQuoteAddedLamports:String(protocolQuote),ordinarySubsetNetPlusProtocolQuoteLamports:String(bought-sold+protocolQuote),allObservedProtocolAuthorityPdas:[...new Set(protocol.map(p=>p.actor.authorityPda))],protocolActorIsOrdinaryBuyer:false,buyerAddressUpperBoundIfOneProtocolAuthorityWereCounted:buyers.size+new Set(protocol.map(p=>p.actor.authorityPda)).size,upperBoundIsNotAnApprovedFeatureDefinition:true},
    baseline:{status:'UNAVAILABLE',reason:'Mixed protocol Buy-and-burn activity is refused by frozen baseline; baseline flow/window completeness cannot be claimed',ordinarySubsetOnlyPredicateDiagnostics:rawPredicates,failedOrdinarySubsetPredicates:Object.entries(rawPredicates).filter(([,v])=>!v).map(([k])=>k),notAnActualPredictiveDecision:true},
    offlineShadows:shadows.map(rule=>({rule,status:'UNAVAILABLE',reason:'Unchanged data-validity requirement: mixed protocol activity not integrated; no historical actual-size entry/exit quote or forward information availability',ordinarySubsetOnlyPredicateDiagnostics:predicates(subset,rule,(start+60)*1000),ageEffectInThisWindow:'Both selected window ends already exceed five-minute baseline age; earlier-age shadow has no eligibility effect here'})),
    executionFeasibility:'UNPROVEN; no retained fresh pre-rally pool/mint/vault/fee state and actual-size entry/exit quote pair at these timestamps',
  };
});
const output={schemaVersion:1,classification:'OFFLINE_HISTORICAL_DIAGNOSTICS_NOT_FORWARD_ACCEPTANCE',generatedAt:new Date().toISOString(),mint,pool,networkRequests:0,financialWriterOpened:false,productionTouched:false,baselineRule:PROVISIONAL_RULE,shadowsFrozenBeforeCalculation:shadows,sourceHistory:{file:'si-history-page-1-20261027232707767.json',sha256:hash('si-history-page-1-20261027232707767.json')},windows,conclusion:'The two retained pre-rally chain-time windows contain net ordinary selling, not qualifying ordinary persistent buying. Five protocol Buy-and-burn instructions occur in each window. Frozen v1 cannot evaluate their mixed activity as a complete window; this is not proof of a valid rejection or a missed executable profitable trade.',limitations:['Two predeclared overlapping SI windows are not independent opportunities or a complete pre-rally strategy search.','Historical blockTime/slot/transactionIndex ordering does not recreate original confirmation availability or feed receipt.','Ordinary subset features are diagnostic only; required protocol amount/actor/price semantics remain unadopted.','A changed actor convention cannot be silently adopted to count protocol authority as an ordinary buyer.','Earlier-age thresholds cannot be economically assessed from these two already-age-eligible endpoints.','Price return from observed executed curve ratios is indicative structure, not actual-size liquidation pricing.','No executable P&L, drawdown, fee-complete fill or winner-recall denominator is inferred.']};
writeFileSync(join(root,'si-final-window-assessment.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(windows.map(w=>({windowStart:w.windowStartIso,ordinary:w.ordinarySubset,protocol:w.protocolEffects,baseline:w.baseline,shadows:w.offlineShadows})),null,2));
