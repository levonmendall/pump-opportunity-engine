/** Operating expenses only. Trading P&L supplied here already includes modeled execution costs. */
export const COST_CATEGORIES = ['data','rpc','hosting','backup','transfer-networkfee'] as const;
export const COST_CLASSIFICATIONS = ['actual','estimated','allocated'] as const;
export type CostCategory = typeof COST_CATEGORIES[number];
export type CostClassification = typeof COST_CLASSIFICATIONS[number];
export type CostReportClassification = CostClassification|'mixed'|'unavailable';
export type CostValuation = {microUsdPerSol:string;at:number;source:string};
type Identity = {id:string;accountId:string;recordedAt:number;evidence:string};
export type OperatingExpense = Identity & {
  kind:'expense'; category:CostCategory; classification:CostClassification; occurredAt:number;
  amount:{currency:'USD';microUsd:string}|{currency:'SOL';lamports:string};
  valuation?:CostValuation;
};
export type CostCoverage = {
  status:'unknown'|'complete';from:number;through:number;evidence:string;
  classification:CostClassification;
};
export type OperatingCoverageEvent = Identity & {kind:'coverage';category:CostCategory;coverage:CostCoverage};
/** The original expense must be obtained/verified from the authoritative journal.
 * The financial writer supplies original-event authentication and resolution idempotency. */
export type OperatingValuationEvent = Identity & {kind:'valuation';expense:OperatingExpense;valuation:CostValuation};
export type OperatingCostEvent = OperatingExpense|OperatingCoverageEvent|OperatingValuationEvent;
type Bucket = {knownMicroUsd:string;unvaluedSolLamports:string;unvaluedCount:number};
export type RecentCostEvent = {
  id:string;kind:'expense'|'valuation';expenseId:string;category:CostCategory;classification:CostClassification;
  occurredAt:number;recordedAt:number;currency:'USD'|'SOL';amount:string;valueMicroUsd:string|null;evidence:string;
};
export type OperatingCostState = {
  schemaVersion:1;accountId:string;inceptionAt:number;lastRecordedAt:number;
  totals:Record<CostCategory,Record<CostClassification,Bucket>>;
  coverage:Record<CostCategory,CostCoverage|null>;recent:RecentCostEvent[];
};
const MAX=(1n<<127n)-1n, LAMPORTS_PER_SOL=1_000_000_000n, MAX_PRICE_AGE_MS=10_000;
const text=(value:unknown,max=512):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const time=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=8_640_000_000_000_000;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const keys=(value:unknown,expected:string[])=>record(value)&&Object.keys(value).sort().join('|')===[...expected].sort().join('|');
function uint(value:unknown):bigint {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('unsigned integer cost required');
  const amount=BigInt(value);if(amount>MAX)throw new Error('cost amount exceeds supported bound');return amount;
}
function signed(value:unknown):bigint {
  if(typeof value!=='string'||!/^(-?[1-9][0-9]*|0)$/.test(value))throw new Error('signed integer trading P&L required');
  const amount=BigInt(value);if(amount>MAX||amount< -MAX)throw new Error('trading P&L exceeds supported bound');return amount;
}
function category(value:unknown):asserts value is CostCategory {if(!COST_CATEGORIES.includes(value as CostCategory))throw new Error('unsupported operating cost category');}
function classification(value:unknown):asserts value is CostClassification {if(!COST_CLASSIFICATIONS.includes(value as CostClassification))throw new Error('cost classification required');}
function identity(value:Identity,state:OperatingCostState,now:number){
  if(!record(value)||!text(value.id,128)||!text(value.evidence)||value.accountId!==state.accountId)throw new Error('wrong account or invalid cost identity/evidence');
  if(!time(value.recordedAt)||value.recordedAt<state.inceptionAt||value.recordedAt>now||value.recordedAt<state.lastRecordedAt)throw new Error('invalid/future/backward cost recording time');
}
function valuation(value:CostValuation,occurredAt:number){
  if(!keys(value,['microUsdPerSol','at','source'])||!time(value.at)||value.at>occurredAt||occurredAt-value.at>MAX_PRICE_AGE_MS||!text(value.source)||uint(value.microUsdPerSol)===0n)throw new Error('fresh incurrence-time SOL/USD valuation required');
}
function expense(value:OperatingExpense,state:OperatingCostState,now:number,original=false):string|null{
  if(!keys(value,['kind','id','accountId','recordedAt','evidence','category','classification','occurredAt','amount',...(value.valuation===undefined?[]:['valuation'])])||value.kind!=='expense')throw new Error('operating expense required');
  if(original){
    if(value.accountId!==state.accountId||!text(value.id,128)||!text(value.evidence)||!time(value.recordedAt)||value.recordedAt<state.inceptionAt||value.recordedAt>now)throw new Error('wrong original expense account or identity');
  }else identity(value,state,now);
  category(value.category);classification(value.classification);
  if(!time(value.occurredAt)||value.occurredAt<state.inceptionAt||value.occurredAt>value.recordedAt)throw new Error('invalid/future expense time');
  if(value.amount?.currency==='USD'){
    if(!keys(value.amount,['currency','microUsd'])||value.valuation!==undefined||uint(value.amount.microUsd)===0n)throw new Error('positive exact micro-USD expense required');
    return value.amount.microUsd;
  }
  if(value.amount?.currency!=='SOL'||!keys(value.amount,['currency','lamports'])||uint(value.amount.lamports)===0n)throw new Error('positive native SOL operating expense required');
  if(value.valuation===undefined)return null;
  valuation(value.valuation,value.occurredAt);
  // Explicit conservative micro-USD rounding; a small known fee is never free.
  const amount=(uint(value.amount.lamports)*uint(value.valuation.microUsdPerSol)+LAMPORTS_PER_SOL-1n)/LAMPORTS_PER_SOL;
  if(amount>MAX)throw new Error('converted cost exceeds supported bound');return amount.toString();
}
function coverage(value:CostCoverage,state:OperatingCostState,recordedAt:number){
  if(!keys(value,['status','from','through','evidence','classification'])||!['unknown','complete'].includes(value.status)||!text(value.evidence))throw new Error('bounded explicit cost coverage required');
  classification(value.classification);
  if(!time(value.from)||!time(value.through)||value.from<state.inceptionAt||value.from>value.through||value.through>recordedAt)throw new Error('invalid/future cost coverage interval');
}
export function initializeOperatingCosts(accountId:string,inceptionAt:number):OperatingCostState {
  if(!/^(poe|fixture)-[a-z0-9-]{1,80}$/.test(accountId)||!time(inceptionAt))throw new Error('operating cost account/inception required');
  const totals={} as OperatingCostState['totals'],coverage={} as OperatingCostState['coverage'];
  for(const category of COST_CATEGORIES){
    totals[category]={} as Record<CostClassification,Bucket>;coverage[category]=null;
    for(const classification of COST_CLASSIFICATIONS)totals[category][classification]={knownMicroUsd:'0',unvaluedSolLamports:'0',unvaluedCount:0};
  }
  return {schemaVersion:1,accountId,inceptionAt,lastRecordedAt:inceptionAt,totals,coverage,recent:[]};
}
/** Validate restored JSON rather than treating damaged/missing fields as known zeros. */
export function validateOperatingCosts(state:OperatingCostState):void {
  if(!keys(state,['schemaVersion','accountId','inceptionAt','lastRecordedAt','totals','coverage','recent'])||state.schemaVersion!==1||!/^((poe|fixture)-[a-z0-9-]{1,80})$/.test(state.accountId)||!time(state.inceptionAt)||!time(state.lastRecordedAt)||state.lastRecordedAt<state.inceptionAt)throw new Error('operating cost state identity invariant');
  if(!keys(state.totals,[...COST_CATEGORIES])||!keys(state.coverage,[...COST_CATEGORIES])||!Array.isArray(state.recent)||state.recent.length>50)throw new Error('bounded operating cost state required');
  for(const cat of COST_CATEGORIES){
    if(!keys(state.totals[cat],[...COST_CLASSIFICATIONS]))throw new Error('cost bucket classification invariant');
    for(const cls of COST_CLASSIFICATIONS){
      const bucket=state.totals[cat][cls];
      if(!keys(bucket,['knownMicroUsd','unvaluedSolLamports','unvaluedCount']))throw new Error('cost bucket invariant');
      uint(bucket.knownMicroUsd);const unknown=uint(bucket.unvaluedSolLamports);
      if(!Number.isSafeInteger(bucket.unvaluedCount)||bucket.unvaluedCount<0||(bucket.unvaluedCount===0)!==(unknown===0n))throw new Error('unvalued expense invariant');
    }
    if(state.coverage[cat]!==null)coverage(state.coverage[cat]!,state,state.lastRecordedAt);
  }
  const cachedValues=new Map<string,bigint>(),cachedPending=new Map<string,{lamports:bigint;count:number}>();
  const resolved=new Set(state.recent.filter(row=>row.kind==='valuation').map(row=>row.expenseId));
  let lastRecentAt=state.inceptionAt;
  for(const event of state.recent){
    if(!keys(event,['id','kind','expenseId','category','classification','occurredAt','recordedAt','currency','amount','valueMicroUsd','evidence'])||!text(event.id,128)||!text(event.expenseId,128)||!text(event.evidence)||!['expense','valuation'].includes(event.kind)||!['USD','SOL'].includes(event.currency))throw new Error('recent operating expense invariant');
    category(event.category);classification(event.classification);const amount=uint(event.amount);
    if(amount===0n||event.kind==='expense'&&event.id!==event.expenseId||event.kind==='valuation'&&event.currency!=='SOL'||event.currency==='USD'&&event.valueMicroUsd!==event.amount)throw new Error('recent operating expense value invariant');
    if(event.valueMicroUsd!==null)uint(event.valueMicroUsd);
    if(!time(event.occurredAt)||!time(event.recordedAt)||event.occurredAt<state.inceptionAt||event.occurredAt>event.recordedAt||event.recordedAt>state.lastRecordedAt||event.recordedAt<lastRecentAt)throw new Error('recent expense chronology invariant');
    lastRecentAt=event.recordedAt;
    const key=event.category+':'+event.classification;
    if(event.valueMicroUsd!==null)cachedValues.set(key,(cachedValues.get(key)??0n)+uint(event.valueMicroUsd));
    else if(!resolved.has(event.expenseId)){
      const pending=cachedPending.get(key)??{lamports:0n,count:0};pending.lamports+=amount;pending.count++;cachedPending.set(key,pending);
    }
  }
  for(const cat of COST_CATEGORIES)for(const cls of COST_CLASSIFICATIONS){
    const key=cat+':'+cls,bucket=state.totals[cat][cls],pending=cachedPending.get(key);
    if(uint(bucket.knownMicroUsd)<(cachedValues.get(key)??0n)||pending&&(uint(bucket.unvaluedSolLamports)<pending.lamports||bucket.unvaluedCount<pending.count))throw new Error('cost totals contradict retained source events');
  }
}
/** Caller journals each accepted operation using its existing durable action-ID path.
 * This pure summary intentionally does not introduce another idempotency registry. */
export function applyOperatingCostEvent(state:OperatingCostState,event:OperatingCostEvent,now:number):OperatingCostState {
  validateOperatingCosts(state);if(!time(now)||now<state.lastRecordedAt)throw new Error('valid cost processing time required');
  identity(event,state,now);
  const next=structuredClone(state);
  const add=(bucket:Bucket,microUsd:string)=>{const total=uint(bucket.knownMicroUsd)+uint(microUsd);if(total>MAX)throw new Error('aggregate cost exceeds supported bound');bucket.knownMicroUsd=total.toString();};
  if(event.kind==='coverage'){
    if(!keys(event,['kind','id','accountId','recordedAt','evidence','category','coverage']))throw new Error('unexpected coverage fields');
    category(event.category);coverage(event.coverage,state,event.recordedAt);
    // A replacement attestation, not a claim that an unobserved interval is covered.
    next.coverage[event.category]=structuredClone(event.coverage);
  }else if(event.kind==='expense'){
    const value=expense(event,state,now),bucket=next.totals[event.category][event.classification];
    if(value!==null)add(bucket,value);
    else{
      const total=uint(bucket.unvaluedSolLamports)+uint((event.amount as {lamports:string}).lamports);
      if(total>MAX||!Number.isSafeInteger(bucket.unvaluedCount+1))throw new Error('unvalued operating cost capacity');
      bucket.unvaluedSolLamports=total.toString();bucket.unvaluedCount++;
    }
    next.recent.push({id:event.id,kind:'expense',expenseId:event.id,category:event.category,classification:event.classification,occurredAt:event.occurredAt,recordedAt:event.recordedAt,currency:event.amount.currency,amount:event.amount.currency==='USD'?event.amount.microUsd:event.amount.lamports,valueMicroUsd:value,evidence:event.evidence});
  }else if(event.kind==='valuation'){
    if(!keys(event,['kind','id','accountId','recordedAt','evidence','expense','valuation']))throw new Error('unexpected valuation fields');
    const original=event.expense;
    if(expense(original,state,now,true)!==null||original.amount.currency!=='SOL'||original.recordedAt>event.recordedAt)throw new Error('unvalued original SOL expense required');
    valuation(event.valuation,original.occurredAt);
    const bucket=next.totals[original.category][original.classification],lamports=uint(original.amount.lamports);
    const before=uint(bucket.unvaluedSolLamports);
    if(bucket.unvaluedCount<1||before<lamports)throw new Error('unvalued original expense not represented');
    const cached=state.recent.find(row=>row.kind==='expense'&&row.expenseId===original.id);
    if(cached&&(cached.category!==original.category||cached.classification!==original.classification||cached.amount!==original.amount.lamports||cached.occurredAt!==original.occurredAt||cached.valueMicroUsd!==null))throw new Error('original expense does not match cached journal projection');
    const value=expense({...original,valuation:event.valuation},state,now,true)!;
    bucket.unvaluedSolLamports=(before-lamports).toString();bucket.unvaluedCount--;add(bucket,value);
    next.recent.push({id:event.id,kind:'valuation',expenseId:original.id,category:original.category,classification:original.classification,occurredAt:original.occurredAt,recordedAt:event.recordedAt,currency:'SOL',amount:original.amount.lamports,valueMicroUsd:value,evidence:event.evidence});
  }else throw new Error('unsupported operating event; funding/reserves/rent/execution are not operating expenses');
  next.lastRecordedAt=event.recordedAt;next.recent=next.recent.slice(-50);validateOperatingCosts(next);return next;
}
/** Checks applicability without changing state or retaining another event registry. */
export function validateOperatingCostEvent(state:OperatingCostState,event:OperatingCostEvent,now:number):void {
  applyOperatingCostEvent(state,event,now);
}
export function projectOperatingCosts(state:OperatingCostState,options:{asOf:number;now:number;tradingPnlMicroUsd:string|null}){
  validateOperatingCosts(state);
  if(!time(options.asOf)||!time(options.now)||options.asOf<state.inceptionAt||options.asOf>options.now||options.asOf<state.lastRecordedAt)throw new Error('valid nonhistorical operating cost projection time required');
  const trading=options.tradingPnlMicroUsd===null?null:signed(options.tradingPnlMicroUsd);
  let known=0n,unvaluedCount=0,complete=true;
  const labels=new Set<CostClassification>();
  const categories={} as Record<CostCategory,{knownMicroUsd:string;unvaluedCount:number;complete:boolean;coverage:CostCoverage|null}>;
  for(const cat of COST_CATEGORIES){
    let subtotal=0n,count=0;
    for(const cls of COST_CLASSIFICATIONS){
      const bucket=state.totals[cat][cls],amount=uint(bucket.knownMicroUsd);
      subtotal+=amount;count+=bucket.unvaluedCount;
      if(amount>0n)labels.add(cls);
    }
    const fact=state.coverage[cat],covered=!!fact&&fact.status==='complete'&&fact.from===state.inceptionAt&&fact.through>=options.asOf;
    const categoryComplete=covered&&count===0;complete=complete&&categoryComplete;
    if(covered)labels.add(fact!.classification);
    known+=subtotal;unvaluedCount+=count;
    categories[cat]={knownMicroUsd:subtotal.toString(),unvaluedCount:count,complete:categoryComplete,coverage:fact?structuredClone(fact):null};
  }
  if(known>MAX||!Number.isSafeInteger(unvaluedCount))throw new Error('aggregate operating cost projection exceeds supported bound');
  const economic=complete&&trading!==null?trading-known:null;
  if(economic!==null&&(economic>MAX||economic< -MAX))throw new Error('economic P&L exceeds supported bound');
  const label:CostReportClassification=complete?(labels.size===1?[...labels][0]!:'mixed'):'unavailable';
  return {accountId:state.accountId,inceptionAt:state.inceptionAt,asOf:options.asOf,knownSubtotalMicroUsd:known.toString(),unvaluedExpenses:unvaluedCount,coverageComplete:complete,operatingCostsMicroUsd:complete?known.toString():null,economicPnlMicroUsd:economic?.toString()??null,classification:label,categories,recent:structuredClone(state.recent),detail:'bounded last50 expense/valuation operations; full evidence remains in the financial journal'};
}
