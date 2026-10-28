/** Offline-only matched-feature audit. Run: node --import tsx scripts/audit-opportunity-counterfactuals.mjs
 * No provider, ledger, quote, account-permission or financial execution calls. */
import {createReadStream,existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';
import {PROVISIONAL_RULE,assessPredictiveBuying} from '../src/strategy.ts';
import {assertPilotBaseline} from '../src/pilot-contract.ts';

// These two small shadows are fixed before reading outcomes. They are an
// exploratory retrospective comparison, not a held-out strategy selection.
const VARIANTS=Object.freeze([
  Object.freeze({id:'earlier-age-240s-v1',minimumAgeMs:240000,minimumNetBuyLamports:'1000000000',minimumPositiveBuckets:4,minimumBuyers:5,maximumLargestBuyerBps:3500}),
  Object.freeze({id:'moderate-buying-v1',minimumAgeMs:300000,minimumNetBuyLamports:'500000000',minimumPositiveBuckets:3,minimumBuyers:3,maximumLargestBuyerBps:5000}),
]);
const MIB=1024*1024,root=resolve(process.argv[2]??'/workspace/poe-pilot');
const output=resolve(process.argv[3]??'evidence/opportunity-coverage-20261027/frozen-threshold-counterfactuals.json');
const digest=value=>createHash('sha256').update(value).digest('hex');
function need(value,reason){if(!value)throw Error(reason);}
assertPilotBaseline();
const baseline={minimumAgeMs:PROVISIONAL_RULE.minimumAgeMs,minimumNetBuyLamports:PROVISIONAL_RULE.minimumNetBuyLamports,minimumPositiveBuckets:PROVISIONAL_RULE.minimumPositiveBuckets,minimumBuyers:PROVISIONAL_RULE.minimumBuyers,maximumLargestBuyerBps:PROVISIONAL_RULE.maximumLargestBuyerBps};
const frozenSettings={baseline,variants:VARIANTS,unchanged:{windowMs:60000,bucketMs:10000,maximumAgeMs:7200000,priceStructure:'first-to-last actual normalized trade ratio return >=0; missing ratio unavailable after buying predicates pass',amountConvention:'curve lamports',sameInformationTimes:true,allSafetyAndDataRequirements:true}};
const manifestBytes=readFileSync(join(root,'pilot.json'));need(manifestBytes.length<=8*MIB,'MANIFEST_BOUND');const manifest=JSON.parse(manifestBytes);
const intervalFile='evidence/opportunity-coverage-20261027/si-local-lifecycle.json';
const intervalBytes=readFileSync(intervalFile),intervals=JSON.parse(intervalBytes).allCompletedExperimentalRunIntervals;
need(Array.isArray(intervals)&&intervals.length<=64,'COMPLETED_INTERVAL_BOUND');
const knownRuns=new Set(readdirSync(join(root,'runs'))),windows=[],unavailable=[],runs=[];
// Pin the nonsecret identity subset in the artifact: the live pilot cache may
// expire identities while an offline audit runs. Reruns reuse this exact subset.
const prior=existsSync(output)?JSON.parse(readFileSync(output,'utf8')):null;
const reuseSnapshot=prior?.settingsSha256===digest(JSON.stringify(frozenSettings))&&prior?.input?.intervalSha256===digest(intervalBytes)&&Array.isArray(prior?.input?.migrationIdentitySnapshot);
const identitySnapshot=reuseSnapshot?prior.input.migrationIdentitySnapshot:Object.values(manifest.pools).map(p=>({baseMint:p.identity.baseMint,pool:p.identity.pool,signature:p.identity.signature,chainBlockTime:p.identity.chainBlockTime,availableAt:p.identity.availableAt}));
const manifestSha256=reuseSnapshot?prior.input.manifestSha256:digest(manifestBytes);
const migrationIdentity=new Map(identitySnapshot.map(identity=>[identity.baseMint,identity]));
const uniqueKey=(mint,end)=>`${mint}:${end}`;
function failures(f,rule){
  return [BigInt(f.netBuyLamports)<BigInt(rule.minimumNetBuyLamports)?'net-buying':null,
    f.positiveNetBuckets<rule.minimumPositiveBuckets?'positive-ten-second-buckets':null,
    f.distinctBuyerWallets<rule.minimumBuyers?'distinct-buyer-wallets':null,
    f.largestBuyerBps>rule.maximumLargestBuyerBps?'buyer-concentration':null,
    f.priceReturnBps!==null&&f.priceReturnBps<0?'negative-price-structure':null].filter(Boolean);
}
function classify(f,rule){
  const failed=failures(f,rule);if(failed.length)return {status:'fail',failedConditions:failed};
  if(f.priceReturnBps===null)return {status:'unavailable',failedConditions:[],reason:'price-structure-unavailable'};
  return {status:'pass',failedConditions:[]};
}
function eligibleAt(mint,at,rule){
  const identity=migrationIdentity.get(mint);
  if(!identity||identity.availableAt>at)return {status:'unavailable',ageMs:null,reason:'retained verified migration identity was unavailable at assessment time'};
  const ageMs=at-identity.chainBlockTime*1000;
  return {status:ageMs>=rule.minimumAgeMs&&ageMs<=PROVISIONAL_RULE.maximumAgeMs?'eligible':'outside-age',ageMs};
}
for(const interval of intervals){
  need(knownRuns.has(interval.runId),'MISSING_COMPLETED_INTERVAL');
  const path=join(root,'runs',interval.runId,'events.ndjson');const bytes=statSync(path).size;need(bytes<=32*MIB,'EVENT_FILE_BOUND');
  const stream=createReadStream(path),hash=createHash('sha256');stream.on('data',chunk=>hash.update(chunk));
  const lines=createInterface({input:stream,crlfDelay:Infinity}),assessments=new Map(),completeFeatureDecisions=new Map();let line=0,start=null;
  for await(const raw of lines){line++;need(Buffer.byteLength(raw)<=MIB,'EVENT_LINE_BOUND');
    if(!raw.includes('"kind":"trader-predictive-assessment"')&&!raw.includes('"kind":"trader-decision"')&&!raw.includes('"kind":"pilot-run-start"'))continue;
    const event=JSON.parse(raw),d=event.data;if(event.kind==='pilot-run-start'){start=d;continue;}
    if(!d?.features)continue;const key=uniqueKey(d.mint,d.features.windowEndAt);
    if(event.kind==='trader-decision'){
      if(d.features.sufficientlyObserved)completeFeatureDecisions.set(key,{mint:d.mint,windowEndAt:d.features.windowEndAt,at:d.at,reason:d.reason});
      continue;
    }
    need(!assessments.has(key),'DUPLICATE_ASSESSMENT_SAME_RUN_WINDOW');
    const f=d.features,recomputed=assessPredictiveBuying(f,f.asOf),at=d.at;
    if(recomputed.status!==d.status||!recomputed.features||!f.sufficientlyObserved||f.qualityReason!==null||f.provisionalTradeCount!==0){
      unavailable.push({runId:interval.runId,mint:d.mint,windowEndAt:f.windowEndAt,reason:'recorded assessment cannot be reproduced from valid confirmed features',recordedStatus:d.status,recomputedStatus:recomputed.status});continue;
    }
    const point={runId:interval.runId,line,mint:d.mint,availableAt:at,windowStartAt:f.windowStartAt,windowEndAt:f.windowEndAt,tradeCount:f.tradeCount,netBuyLamports:f.netBuyLamports,positiveNetBuckets:f.positiveNetBuckets,distinctBuyerWallets:f.distinctBuyerWallets,largestBuyerBps:f.largestBuyerBps,priceReturnBps:f.priceReturnBps,baseline:{...classify(f,baseline),...{eligibility:eligibleAt(d.mint,at,baseline)}},shadows:Object.fromEntries(VARIANTS.map(v=>[v.id,{...classify(f,v),eligibility:eligibleAt(d.mint,at,v)}]))};
    assessments.set(key,point);windows.push(point);
  }
  const noAssessment=[...completeFeatureDecisions.entries()].filter(([key])=>!assessments.has(key)).map(([,value])=>value);
  unavailable.push(...noAssessment.map(value=>({runId:interval.runId,...value,reason:'a sufficiently-observed feature snapshot alone does not prove independent audit/readiness; no accepted independent predictive assessment recorded'})));
  runs.push({runId:interval.runId,source:interval.source,configurationSha256:interval.configurationSha256??start?.configurationSha256??null,strategyVersion:interval.strategyVersion,contractSha256:interval.contractSha256,maximumCandidates:interval.maximumCandidates,startedAt:interval.startedAt,completedAt:interval.completedAt,eventBytes:bytes,eventSha256:hash.digest('hex'),acceptedAssessmentWindows:assessments.size,distinctAssessedTokens:new Set([...assessments.values()].map(x=>x.mint)).size,completeFeatureWindowsWithoutAcceptedAssessment:noAssessment.length});
}
function summary(rows,get){const values=rows.map(get),tokens=status=>new Set(rows.filter((_,i)=>values[i].status===status).map(x=>x.mint)).size;return {windows:rows.length,uniqueTokens:new Set(rows.map(x=>x.mint)).size,pass:values.filter(x=>x.status==='pass').length,fail:values.filter(x=>x.status==='fail').length,unavailable:values.filter(x=>x.status==='unavailable').length,uniqueTokensPassing:tokens('pass'),failedConditions:Object.fromEntries(['net-buying','positive-ten-second-buckets','distinct-buyer-wallets','buyer-concentration','negative-price-structure'].map(reason=>[reason,values.filter(x=>x.failedConditions.includes(reason)).length]))};}
const quiet=windows.filter(x=>x.tradeCount===0),active=windows.filter(x=>x.tradeCount>0),baselineSummary=summary(windows,x=>x.baseline);
const unionByMint=new Map();for(const p of windows){const list=unionByMint.get(p.mint)??[];list.push([p.windowStartAt,p.windowEndAt]);unionByMint.set(p.mint,list);}
let unionMs=0;for(const list of unionByMint.values()){list.sort((a,b)=>a[0]-b[0]);let start=null,end=null;for(const [a,b]of list){if(start===null){start=a;end=b;}else if(a<=end)end=Math.max(end,b);else{unionMs+=end-start;start=a;end=b;}}if(start!==null)unionMs+=end-start;}
const report={schemaVersion:1,classification:'OFFLINE_RECORDED_FEATURE_COUNTERFACTUAL; NOT_EXECUTABLE_OPPORTUNITY_RECALL_OR_STRATEGY_PERFORMANCE',generatedAt:new Date().toISOString(),networkRequests:0,financialWriterOpened:false,productionTouched:false,settingsFrozenBeforeCalculation:true,settingsSha256:digest(JSON.stringify(frozenSettings)),settings:frozenSettings,heldOutData:false,parametersOptimized:false,selection:'all completed run intervals listed in hashed SI lifecycle audit; only actual recorded independent predictive assessments are accepted for baseline/shadow comparison',input:{intervalFile,intervalSha256:digest(intervalBytes),manifestSha256,migrationIdentitySnapshot:identitySnapshot,manifestUse:'immutable migration identity only, only if its retained availableAt <= original assessment time; no later market information'},runs,baseline:baselineSummary,shadows:Object.fromEntries(VARIANTS.map(v=>[v.id,{...summary(windows,x=>x.shadows[v.id]),newPredictivePasses:windows.filter(x=>x.baseline.status!=='pass'&&x.shadows[v.id].status==='pass').map(x=>({runId:x.runId,mint:x.mint,windowEndAt:x.windowEndAt,availableAt:x.availableAt})),newAgeEligibilityObservations:windows.filter(x=>x.baseline.eligibility.status==='outside-age'&&x.shadows[v.id].eligibility.status==='eligible').length,eligibilityUnavailable:windows.filter(x=>x.shadows[v.id].eligibility.status==='unavailable').length}])) ,controls:{definition:'retained assessed population split by zero normalized trades versus nonzero activity; selected controls, not an independent weak/loser market sample',quiet:summary(quiet,x=>x.baseline),active:summary(active,x=>x.baseline),quietShadowPasses:Object.fromEntries(VARIANTS.map(v=>[v.id,quiet.filter(x=>x.shadows[v.id].status==='pass').length])),subsequentExecutableOutcomes:'unavailable; none inferred from silence, OHLC or later peaks'},overlap:{rawAssessmentWindows:windows.length,distinctTokenWindowEnds:new Set(windows.map(x=>uniqueKey(x.mint,x.windowEndAt))).size,nonoverlappingUnionTokenMilliseconds:unionMs,warning:'overlapping 60-second windows and repeated token observations are not independent trials or independent minutes'},unavailableSummary:{completeFeatureWindowsWithoutAcceptedAssessment:unavailable.length,uniqueTokens:new Set(unavailable.map(x=>x.mint)).size,firstRecordedAcceptedAssessmentAt:windows.length?Math.min(...windows.map(x=>x.availableAt)):null,withoutAssessmentBeforeFirstRecordedAcceptedAssessment:unavailable.filter(x=>x.at<Math.min(...windows.map(x=>x.availableAt))).length,reason:'missing independent readiness/audit or invalid feature reproduction; excluded rather than treated as predictive failure',historicalVersionCaveat:'Older versions lacked this independent diagnostic. Its absence is not itself a current implementation defect or proof the historical snapshot was independently verified.'},windows,limitations:['This selected POE population cannot estimate independent whole-market winner recall or false-negative rate.','No historical data is backdated into a decision; every comparison uses the same recorded availability time and ten-second cadence.','Earlier-age shadow cannot recover pre-admission/pre-eligibility flow that POE did not collect. Any unseen four-to-five-minute opportunities remain unassessable.','No additional quote is fetched and no financial, execution, support or risk qualification is inferred from predictive passes.','Quiet assessed controls are not proof of losing or unprofitable tokens; no paired actual-size future execution path is available for economic ranking.','The frozen predicates are evaluated once per accepted token/window/run; overlaps and repeated visits remain correlated.','No parameter search, baseline mutation, production deployment or financial permission change is performed.']};
const bytes=JSON.stringify(report)+'\n';need(Buffer.byteLength(bytes)<=200*1024,'OUTPUT_BOUND');writeFileSync(output,bytes,{mode:0o600});
console.log(JSON.stringify({output,bytes:Buffer.byteLength(bytes),runs:runs.length,baseline:report.baseline,shadows:report.shadows,unavailable:report.unavailableSummary},null,2));
