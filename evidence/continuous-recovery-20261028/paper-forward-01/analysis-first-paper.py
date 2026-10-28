#!/usr/bin/env python3
"""Offline analysis of allowlisted first PAPER readback; never opens ledger/raw flow.
python3 evidence/continuous-recovery-20261028/paper-forward-01/analysis-first-paper.py
"""
import collections,datetime,hashlib,json,math,pathlib
ROOT=pathlib.Path('/workspace/poe-pilot/migration-20261028/paper-first-readback/artifact')
OUT=pathlib.Path(__file__).resolve().parent

def read(name):return json.loads((ROOT/name).read_text())
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def quantiles(values):
 v=sorted(x for x in values if isinstance(x,(int,float)))
 return {'count':len(v),'p50':v[math.ceil(.5*len(v))-1] if v else None,'p95':v[math.ceil(.95*len(v))-1] if v else None,'maximum':max(v)if v else None}
def utc(at):return datetime.datetime.fromtimestamp(at/1000,datetime.timezone.utc).isoformat(timespec='milliseconds')
es=[json.loads(l) for l in (ROOT/'segments/0/selected-events.ndjson').read_text().splitlines()]
def rows(k):return [e for e in es if e['kind']==k]
def ref(e):return {'file':e['sourceFile'],'line':e['sourceLine'],'sha256':e['sourceLineSha256']}
status=read('final-status.json');sup=read('supervisor.json');fin=read('ledger-projection-audit.json');summary=read('event-summary.json')[0]
audits=rows('native-candidate-window-audit');assess=rows('native-predictive-assessment');miss=rows('native-predictive-window-expired');gaps=rows('native-candidate-quality-gap')
by_target={(e['data']['mint'],e['data']['result']['target']['endAt']):e for e in audits}
starts={e['data']['id']:e for e in rows('component-physical-start')};settles={e['data']['id']:e for e in rows('component-physical-settled')};timeouts={e['data']['id']:e for e in rows('component-physical-timeout')};http={e['data']['id']:e for e in rows('http-lifecycle-timing')}
start_indices=[(i,e)for i,e in enumerate(es)if e['kind']=='component-physical-start']
batches=[]
for i,e in enumerate(es):
 if e['kind']!='native-candidate-audit-batch-selected':continue
 s=next(s for j,s in start_indices if j>i and s['data']['kind']=={'transport':'http','method':'getSignaturesForAddress'})
 request_id=s['data']['id'];h=http[request_id]['data'];end=settles[request_id]['data'];t=timeouts.get(request_id)
 batches.append({'requestId':request_id,'logicalQueries':e['data']['logicalQueries'],'targetEndAt':e['data']['targetEndAt'],'mints':e['data']['mints'],'timedOut':t is not None,'responseBytes':h['responseBytes'],'httpStatus':h['status'],'headersDelayMs':h['headersDelayMs'],'lastBodyDelayMs':h['lastBodyAt']-h['requestedAt']if h.get('lastBodyAt')else None,'bodyCompleteAt':h['bodyCompleteAt'],'httpElapsedMs':h['elapsedMonotonicMs'],'physicalSettlementAt':end['at'],'timeoutToPhysicalSettlementMs':end['at']-t['data']['at']if t else None,'evidence':ref(e)})
batch_ids={b['requestId']for b in batches};failed_batches=[b for b in batches if b['timedOut']]
miss_cases=[]
for e in miss:
 d=e['data'];a=by_target.get((d['mint'],d['windowEndAt']));reason=a['data']['result']['reason']if a else 'NO_AUDIT_RESULT'
 trace=d.get('dispatchTrace',{});last=trace.get('lastState',{})
 miss_cases.append({'mint':d['mint'],'windowEndAt':d['windowEndAt'],'windowEndUtc':utc(d['windowEndAt']),'cause':reason,'expiredAt':d['at'],'lastDispatchAt':trace.get('lastAt'),'lastDispatchState':last,'dispatchReasonCounts':trace.get('reasonCounts'),'evidence':ref(e)})
unusable=[]
for e in audits:
 d=e['data'];r=d['result']
 if r['status']!='unusable':continue
 unusable.append({'mint':d['mint'],'pool':r['pool'],'target':r['target'],'reason':r['reason'],'historyRangeCovered':r['historyRangeCovered'],'pages':r['pages'],'historyRows':r['historyRows'],'interiorRows':r['interiorRows'],'requiredSignatures':r['requiredSignaturesCount'],'missingFailed':r['missingFailedNotificationsCount'],'missingSuccessful':r['missingSuccessfulNotificationsCount'],'missingSuccessfulSample':r['missingSuccessfulNotificationsDiagnosticSample'],'sampleTruncated':r['missingSuccessfulNotificationsSampleTruncated'],'evidence':ref(e)})
# Sourcegap includes deliberate scope retirement; engine callbacks have distinct semantics.
retire_counts=collections.Counter(e['data']['reason']for e in rows('native-candidate-retired'))
no_session=[m for m in miss_cases if m['cause']=='NO_AUDIT_RESULT']
http_timeout_cases=[]
for rid,e in timeouts.items():
 h=http.get(rid);d=e['data'];end=settles[rid]['data'];hd=h['data']if h else{}
 http_timeout_cases.append({'id':rid,'kind':d['kind'],'batch':rid in batch_ids,'httpStatus':hd.get('status'),'responseBytes':hd.get('responseBytes'),'headersDelayMs':hd.get('headersDelayMs'),'lastBodyDelayMs':hd['lastBodyAt']-hd['requestedAt']if hd.get('lastBodyAt')else None,'jsonDecodedAt':hd.get('jsonDecodedAt'),'outcome':hd.get('outcome'),'settlementDelayAfterTimeoutMs':end['at']-d['at'],'evidence':ref(e)})
for m in no_session:
 begin=m['lastDispatchAt'];end=m['windowEndAt']+9999
 active=[]
 for rid,e in starts.items():
  at=e['data']['at'];s=settles[rid]['data']['at']
  if begin<=at<=end:active.append({'id':rid,'at':at,'settledAt':s,'kind':e['data']['kind']})
 m['physicalWorkAfterLastSelectedBeforeDeadline']=active
start_times=sorted(e['data']['at']for e in starts.values())
def peak(span):
 left=0;result=0
 for i,t in enumerate(start_times):
  while start_times[left]<=t-span:left+=1
  result=max(result,i-left+1)
 return result
scope={};scope_at=status['startedAt'];dwell=collections.Counter();maxscope=0
for e in es:
 if e['kind']not in ['native-flow-subscription-ack','native-candidate-retired']:continue
 at=e['data']['at'];dwell[len(scope)]+=max(0,at-scope_at);scope_at=at
 if e['kind']=='native-flow-subscription-ack':scope[e['data']['mint']]=True
 else:scope.pop(e['data']['mint'],None)
 maxscope=max(maxscope,len(scope))
dwell[len(scope)]+=max(0,status['generatedAt']-scope_at)
all_failed=collections.Counter(e['data']['assessment']['status']for e in assess)
pre_cutoff=[e for e in gaps if e['data']['reason']!='NATIVE_FLOW_INFORMATION_CUTOFF']
result={
 'schemaVersion':1,'classification':'ACTUAL_FIRST_NATIVE_PAPER_FORWARD_NOT_ACCEPTANCE','source':status['source'],'configurationSha256':status['configurationSha256'],'runId':status['runId'],'observation':{'startAt':status['startedAt'],'startUtc':utc(status['startedAt']),'stoppedAt':status['generatedAt'],'stoppedUtc':utc(status['generatedAt']),'elapsedMs':status['generatedAt']-status['startedAt'],'normalTargetReached':False,'stopReason':status['status'],'physicalOperationsSettled':len(starts)==len(settles)==516},
 'candidateEvidence':{'completedAuditedWindows':len(assess),'uniqueEvaluatedTokens':len(set(e['data']['mint']for e in assess)),'predictiveStatusCounts':dict(all_failed),'normalizedTradesActual':status['usage']['native']['normalizedEvents'],'paperFunnelReportedEvaluated':status['funnel']['evaluated'],'summedFeatureTradeCounts':sum(e['data']['assessment']['features']['tradeCount']for e in assess),'summedFeatureTradesAreUnique':False,'maximumAckedScopeConcurrency':maxscope,'ackedScopeTimeMs':dict(dwell),'independentAuditWarmingWindows':len(rows('native-independent-audit-warming')),'auditResultCounts':dict(collections.Counter(e['data']['result']['status']for e in audits)),'unavailableByReason':dict(collections.Counter(e['data']['result']['reason']for e in audits if e['data']['result']['status']=='unavailable')),'unusable':unusable,'unknownSuccessfulSignatures':sum(u['missingSuccessful']for u in unusable),'missingIndependentlyFailedRows':sum(u['missingFailed']for u in unusable),'unknownSuccessfulAreProvenSwaps':False,'verifiedWithMissingFailedDiagnosticRows':sum(e['data']['result']['reason']=='NATIVE_AUDIT_EXECUTED_FLOW_VERIFIED_WITH_MISSING_FAILED_PACKETS'for e in audits)},
 'deadlines':{'misses':len(miss),'causeCounts':dict(collections.Counter(m['cause']for m in miss_cases)),'allCases':miss_cases,'noSessionDespiteSelection':no_session,'classification':'No validated current-window decision in the applicable10s; not warming or strategy rejection. Three selected-without-session cases are demonstrated local failures; exact early-return branch is not instrumented.'},
 'qualityGaps':{'engineCallbacks':len(gaps),'adverseBeforeCutoff':len(pre_cutoff),'reasonCounts':dict(collections.Counter(e['data']['reason']for e in gaps)),'nativeAggregateGaps':status['usage']['native']['gaps'],'retiredScopes':sum(retire_counts.values()),'retirementReasons':dict(retire_counts),'meaning':'Nativeaggregate50 includes deliberate17 fair post-rejection retirements,12 retirements after repeated audit failures and2 orderly segment retirements in addition to19 enginecallbacks. It is not50 independent lost candidate windows. Twelve1006callbacks came from four3-scope disconnects with WS_ERR_INVALID_CLOSE_CODE; noWS physical timeout occurred.'},
 'provider':{'starts':len(starts),'settlements':len(settles),'peakStartsPer10s':peak(10000),'peakStartsPerMinute':peak(60000),'physicalStartMethods':dict(collections.Counter(e['data']['kind']['transport']+':'+e['data']['kind']['method']for e in starts.values())),'physicalTimeouts':len(timeouts),'timeoutMethods':dict(collections.Counter(e['data']['kind']['transport']+':'+e['data']['kind']['method']for e in timeouts.values())),'httpStatusCounts':dict(collections.Counter(str(e['data']['status'])for e in http.values())),'new429or503':False,'timeoutCases':http_timeout_cases,'batch':{'plans':len(batches),'logicalQueries':sum(b['logicalQueries']for b in batches),'physicalHttp':len(batches),'validatedLogicalQueries':status['usage']['rpc']['signatureHistoryBatch']['logicalQueriesValidated'],'unvalidatedLogicalQueries':status['usage']['rpc']['signatureHistoryBatch']['logicalQueriesWithoutValidatedResponse'],'failedPhysicalBatches':len(failed_batches),'failedLogicalQueries':sum(b['logicalQueries']for b in failed_batches),'successfulPhysicalBatches':len(batches)-len(failed_batches),'failedHeadersMs':quantiles(b['headersDelayMs']for b in failed_batches),'failedLastBodyMs':quantiles(b['lastBodyDelayMs']for b in failed_batches),'failedPartialBytes':quantiles(b['responseBytes']for b in failed_batches),'successfulElapsedMs':quantiles(b['httpElapsedMs']for b in batches if not b['timedOut']),'cases':batches,'inference':'Every failed batch gotHTTP200/early partial body but no body completion. This does not identify server computation versus network tail behavior. Connectionreuse uninstrumented. Batch amplification is measured, not evidence to enlarge1.5s deadline.'},'newUnits':status['usage']['rpc']['newUnits'],'newAccountedResponseBytes':status['usage']['rpc']['newAccountedResponseBytes'],'uncertainBytesRemainAccounted':True},
 'resources':{'cpuMicros':sum(status['usage']['cpu'].values()),'sourceRssBytes':status['usage']['maximumRss'],'supervisorSourceGroupRssBytes':sup['segments'][0]['maximumSourceGroupRssBytes'],'eventLoopP95Ms':status['usage']['eventLoopDelayP95Ms'],'retainedSourceEvidenceBytes':status['usage']['eventBytes'],'pumpApiBytes':status['usage']['feeds']['pumpApiSocketBytes'],'nativeWsBytes':status['usage']['native']['socketBytes'],'pumpApiNormalizedTrades':status['usage']['feeds']['normalizedTrades'],'pumpApiMeaning':'Broad feed supplies590 unverified watch activity hints; current selected executed flow came from native notifications. Omitting it would change watch prioritization coverage, not trade-field validation; measure separately.'},
 'financial':{'audit':fin,'entries':0,'fills':0,'positions':0,'pending':0,'exits':0,'netTradingPnlLamports':'0','usdChangeIsTradingProfit':False,'reportedSolValuationEffectMicroUsd':status['financial']['solPriceEffectMicroUsd'],'holdingProtectionProven':False,'noForcedQualification':True},
 'reporting':{'acceptedDistinctSources':sup['segments'][0]['acceptedSourceWitness']['acceptedDistinctSources'],'unmatchedAcknowledgements':sup['segments'][0]['acceptedSourceWitness']['unmatchedAcknowledgements'],'finalStoppedAccepted':sup['finalStoppedReportAccepted'],'reportingCounterDefect':'Source status funnel.evaluated0 and omitted native normalizedEvents misreported candidate work; diagnostic trace proves17assessments/14tokens/2530normalized events. Repair changes reporting only; no qualifications existed tohide.','independentPublicParity':'Not evaluated by this analysis; parent separately reconciles retained accepted-source witnesses and publicsampler.'},
 'recommendation':{'nextMaximumDeepSlots':3,'advanceToSixOrMore':False,'smallestBottleneckRepairs':['Keep public-RPC quiet history batching disabled by default until an explicit transport capability test proves complete envelopes; singles preserve individualfailure scope.','Instrument/correct audit-selected→beginAudit early returns so a ready target gets a logical session or explicit bounded refusal rather than silently waiting out its deadline.','Apply measured reporting projection fixes before next interval; preserve exact ledger/publicsource separation.'],'remainingLimits':['Twenty single history HTTP timeouts received no headers; no provider429/503 or clear request-rate saturation wasobserved. Physical lanes or alternate source changes require isolated evidence.','Three successful-history mismatches remainunadjudicated; metadata cannot establish that every unknown signature was a swap or safely optional.','The actual run stopped at180.25CPU-s/21m41s and broadPumpApi hit1GiB first; boundedresource behaviorworked but continuousduration notproven.','No natural qualification, actual-sizeentry, openholding, liveprotection, exit or financialprofit evidence exists inthisinterval.']},
 'evidenceLimitations':[summary['classification'],summary['observationDiagnostics'],'No raw provider logs or full history pages included here. Unknown successful signature samples can guide later checks but are not independent decoded tradeproof.','Three observed candidate completions with missing failed rows establish appropriate diagnostic/executed-flow separation in thisscope; they do not establish universal feedcompleteness.'],
 'inputs':{n:digest(ROOT/n)for n in ['index.json','event-summary.json','final-status.json','ledger-projection-audit.json','supervisor.json','segments/0/selected-events.ndjson']}}
(OUT/'analysis-first-paper.json').write_text(json.dumps(result,indent=2)+'\n')
md=f'''# First native PAPER forward interval — actual result, not acceptance

Frozen source `{status['source']['commit']}`, bundle `{status['source']['sha256']}` ran {utc(status['startedAt'])}–{utc(status['generatedAt'])}: **{(status['generatedAt']-status['startedAt'])/1000:.3f}s**. It ended safely flat at the candidate CPU reserve, before the30-minute target. All516 physical starts settled. The same account/inception and original observer were preserved.

## What was actually evaluated

**17 audited windows over14 unique tokens**, all17 valid predictive failures; **2530 native normalized trades**. Overlapping windows are not independent coverage minutes, and78 summed feature trades are not78 unique trades. The old PAPER reporting projection incorrectly showed0evaluations/0normalized trades. That is a reporting defect, not absence of candidate work or a missed financial permission. No candidate qualified, no order was submitted/filled, and no holding/protection evaluation/exit occurred.

## Why audits and decisions failed

-61 audit results:17 verified,41 unavailable,3 unusable.
-40 unavailable results were physical HTTPtimeouts;1 was slot-boundaryambiguity. There were no dispatch-expired results in thisinterval.
-32 genuine current-window deadline misses:28 timed-out audit targets,1 ambiguity, **3 selected targets that never opened an audit session**. The three all concern9tVNg at20:11:10/30/40. Their last trace showed a free gate,32–38 starts/min and8–9s remaining runway, followed by no history dispatch. This is a demonstrated local service failure; the exact early-return branch was not instrumented. It cannot be blamed on provider saturation or normalwarming.
-Three unusable audits found30 unknown successful signatures and1516 independently failed missing rows. The successful identities are not proven all executed swaps; metadata alone cannot adjudicate their importance. The successful evidence cannot be waived. Three other windows completed despite missing independently failed diagnostic rows, showing that the current contract already separates failed-only metadata from required executed flow.

## Batch transport is the strongest measured bottleneck

17 HTTPbatch envelopes invoked37 logical queries. Only5 envelopes/10 logical queries validated;12 timeouts made27 logical queries unavailable. Every failed batch returnedHTTP200 headers in65–110ms and22,644–46,287 partial bytes. Its last body chunk arrived107–173ms afterstart, then the body did not finish before1.5s. Successful batches completed171–209ms with45–49KB. No parsing-latency explanation is supported; connectionreuse is uninstrumented. These partial-body tails do not prove bandwidth saturation or identify server versus network delay.

All33 physicaltimeouts were HTTP:32history and1getTransaction. The12 batchtimeouts had headers/partialbodies;20 single-history and1getTransaction timeouts had noheaders/0B. Cancellation settled19–25ms afterthe timer. All279 observed HTTPheader statuses were200; no429/503 occurred. Peaks were{peak(10000)}/10s and{peak(60000)}/minute. Average demand does not establish provider entitlement.

## Gap accounting and containment

19 engine quality callbacks comprise12disconnect1006 callbacks in four3-scope incidents,3 historymismatches,2 unsupportedlabels,1 unsupported protocol child and1 explicit cutoff. Eighteen are adverse pre-cutoff callbacks. Four socket errors reported`WS_ERR_INVALID_CLOSE_CODE`; noWS physicaltimeout occurred. Nativeaggregate50 includes the same scope failures plus17 deliberate post-rejection retirements,12 repeated-audit-failure retirements and2 orderly segment retirements; it is not50 independent quality-losswindows. There was no global fingerprint-capacity refusal or candidate metadata-pressure refusal. Failed-packet diagnostic compaction retained the executed-flow obligations.

## Financial and resource result

Read-only auditPASS: revision9451, cash/equity9,920,142,850lamports,0reserved/locked/realized/cost/positions/pending, contiguous9452journal rows and valid actionlinks. Stored source fields matched. Net tradingP&L is0; reportedUSD+22.965131 was passiveSOLvaluation, not tradingprofit. No heldmark was independently repriced because none existed.

CPU180.252709s triggered the intendedcandidate reserve; sourceRSS387,461,120B and supervisor sourcegroup402,427,904B stayed within the existing bounded process/group controls; the observed stop was the CPU reserve, not a demonstrated RSS failure. BroadPumpApi received1,071,650,829B for590 unverified watchhints, while nativeWS received27,692,392B and supplied all2530normalized trades. No broadpayloadarchive was exported. APIfee0 does not establish free infrastructure/transfer.

## Next bounded workload

Keep maximum3deep slots and existingfinancialcapacity. Default off the unreliable public-RPC first-pagebatch path; preserve separate single-page deadlines and physical accounting. Correct/instrument selected-without-session returns and the reportingprojection. Then compare a new source-pinned interval. Do not increase to6–12 or relax deadlines based on thissample. Two-lane scheduling may be investigated separately but does not retroactively explain partial batches. A natural qualification/lifecycle and holdingprotection remain unobserved.

The reproducedJSON contains every deadline case and physical timeout plus exact inputhashes. This is allowlisted metadata, not a complete market-flow archive. Original selected evidence remains privately retained.
'''
(OUT/'analysis-first-paper.md').write_text(md)
print(json.dumps({'output':str(OUT/'analysis-first-paper.json'),'audits':len(audits),'assessments':len(assess),'misses':len(miss),'batchQueries':sum(b['logicalQueries']for b in batches),'failedBatchQueries':sum(b['logicalQueries']for b in failed_batches),'sourceCpuMicros':sum(status['usage']['cpu'].values()),'inputMetadataOnly':True},indent=2))
