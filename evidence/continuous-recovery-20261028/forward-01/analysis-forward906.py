"""Read-only retained-evidence analysis. No market network, counter or runtime changes.
Usage: python3 evidence/continuous-recovery-20261028/forward-01/analysis-forward906.py
Requires the verified private readback at the fixed local path below.
"""
import bisect,collections,datetime,hashlib,json,math,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
CAP=pathlib.Path('/workspace/poe-pilot/runs/native-continuous-20261028163000')
D=CAP/'artifact/run'
def read(p):return json.loads(p.read_text())
def utc(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat(timespec='milliseconds')
def quant(a,p):return sorted(a)[max(0,math.ceil(len(a)*p)-1)]if a else None
def stats(a):return {'count':len(a),'p50':quant(a,.5),'p95':quant(a,.95),'maximum':quant(a,1)}
receipt=read(CAP/'readback-receipt.json');assert receipt['wholeArchiveHashVerified']and receipt['allSelectedFilesVerified']
E=[];sources=[]
for p in sorted((D/'events').glob('*.ndjson')):
 raw=p.read_bytes();sources.append({'file':str(p.relative_to(CAP/'artifact')),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 for lineNo,line in enumerate(raw.splitlines(),1):
  e=json.loads(line);e['_file']=str(p.relative_to(CAP/'artifact'));e['_line']=lineNo;E.append(e)
by=collections.defaultdict(list)
for e in E:by[e['kind']].append(e)
s=read(D/'status.json');end=s['logicalObservationCutoffAt'];A=[e['data']for e in by['native-candidate-window-audit']]
G=collections.defaultdict(list)
for e in by['native-candidate-quality-gap']:G[(e['data']['at'],e['data']['reason'])].append(e['data']['mint'])
gaps=[{'at':t,'atUtc':utc(t),'reason':r,'callbacks':len(m),'mints':m,'atOrAfterLogicalCutoff':t>=end}for(t,r),m in G.items()]
# Two adjacent millisecond stamps represent the same six-scope failure, retain original stamps above.
K=collections.Counter(e['data']['reason']for e in by['native-candidate-quality-gap'])
B=collections.defaultdict(list)
for e in by['native-flow-information-available']:B[e['data']['signature']].append(e['data'])
missing=[]
for a in A:
 r=a['result']
 if r['status']!='unusable':continue
 rows=[]
 for h in r['missingNotifications']:
  matches=B[h['signature']];rows.append({'history':h,'retainedInformationMatches':[{'success':n['success'],'slot':n['slot'],'receivedAt':n['receivedAt'],'availableAt':n['availableAt'],'subscriptionMint':n['subscriptionMint'],'connectionId':n['connectionId'],'afterSnapshotBeforeAuditCompletion':r['startedAt']<n['availableAt']<=r['availableAt']}for n in matches]})
 missing.append({'mint':a['mint'],'target':r['target'],'startedAt':r['startedAt'],'availableAt':r['availableAt'],'missing':rows,'allMissingSuccessfulRowsAvailableBeforeCompletion':all(any(r['startedAt']<n['availableAt']<=r['availableAt']for n in B[h['signature']])for h in r['missingSuccessfulNotifications'])})
expired=[]
for e in by['native-predictive-window-expired']:
 d=e['data'];a=[x['result']for x in A if x['mint']==d['mint']and x['result']['target']['endAt']==d['windowEndAt']]
 assert len(a)<=1
 r=a[0]if a else None
 expired.append({**d,'targetEndUtc':utc(d['windowEndAt']),'classification':'undispatched'if r is None else 'audit-timeout'if r['reason']=='PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'else 'audit-boundary-ambiguity'if r['reason']=='NATIVE_AUDIT_TARGET_SLOT_BOUNDARY_AMBIGUOUS'else r['reason'],'audit':None if r is None else{'status':r['status'],'reason':r['reason'],'dispatchDelayMs':r['startedAt']-d['windowEndAt'],'completionDelayMs':r['availableAt']-d['windowEndAt']}})
H=[e['data']for e in by['http-lifecycle-timing']]; pagegroups=collections.defaultdict(list)
for a in A:
 r=a['result']
 for p in r['pages']:
  h=[h for h in H if h['method']=='getSignaturesForAddress'and r['startedAt']-20<=h['requestedAt']<=r['availableAt']+20 and h['jsonDecodedAt']is not None and h['jsonDecodedAt']<=r['availableAt']+20]
  assert len(r['pages'])==len(h)==1,'This run had only single-page completed audits; update mapping if scope changes.'
  pagegroups[p['requestedLimit']].append(h[0])
P=[e['data']for e in by['native-predictive-assessment']]
N=[e['data']['notification']for e in by['native-flow-validated-events']]
starts=sorted(e['data']['at']for e in by['component-physical-start'])
ack=[]
for i,e in enumerate(E):
 k=e['kind'];d=e['data'];t=d.get('at')
 if isinstance(t,int)and k in ['native-flow-subscription-ack','native-candidate-retired','native-flow-disconnected']:ack.append((t,i,k,d))
active={};concurrency=collections.Counter();last=s['startedAt'];six=[];sixstart=None
for t,_,k,d in sorted(ack):
 if t>end:break
 concurrency[len(active)]+=t-last;last=t
 if k=='native-flow-subscription-ack':active[d['mint']]=d['connection']
 elif k=='native-candidate-retired':active.pop(d['mint'],None)
 else:active={m:c for m,c in active.items()if c!=d['connection']}
 if len(active)==6 and sixstart is None:sixstart=t
 if len(active)!=6 and sixstart is not None:six.append({'startAt':sixstart,'endAt':t,'durationMs':t-sixstart});sixstart=None
concurrency[len(active)]+=end-last
if sixstart is not None:six.append({'startAt':sixstart,'endAt':end,'durationMs':end-sixstart})
stream=s['feeds'];rpc=s['usage']['rpc']; ages=[e['data']['availableAt']-e['data']['receivedAt']for e in by['native-flow-information-available']]
result={
 'schemaVersion':1,'classification':'RETAINED_FORWARD_EVIDENCE_ANALYSIS_NOT_ACCEPTANCE','source':s['source'],'runId':s['runId'],'configurationSha256':s['configurationSha256'],'readback':receipt,'eventSegments':sources,
 'observation':{k:s[k]for k in['startedAt','logicalObservationCutoffAt','stopRequestedAt','transportSettledAt','generatedAt','elapsedMs','lastSourceAt','physicalSettlementConfirmed']},
 'counters':s['engine']['counters'],'completedEvaluations':{'uniqueTokens':len({p['mint']for p in P}),'assessments':len(P),'zeroTradeAssessments':sum(p['assessment']['features']['tradeCount']==0 for p in P),'nonzeroTradeAssessments':sum(p['assessment']['features']['tradeCount']>0 for p in P),'notIndependentSamples':'Overlapping 60-second windows are not independent minutes or whole-market recall.','passes':[{'mint':p['mint'],'pool':p['pool'],'at':p['at'],'windowEndAt':p['windowEndAt'],'entryAgeEligible':p['entryAgeEligible'],'ageCohort':p['ageCohort'],'baselineFeatureSemantics':p['baselineFeatureSemantics'],'features':p['assessment']['features'],'financialQualification':False,'executablePricing':'not assessed'}for p in P if p['assessment']['status']=='not-rejected']},
 'qualityGaps':{'callbackCount':sum(K.values()),'preCutoffCallbackCount':sum(g['callbacks']for g in gaps if not g['atOrAfterLogicalCutoff']),'atOrAfterCutoffCallbacks':sum(g['callbacks']for g in gaps if g['atOrAfterLogicalCutoff']),'byReason':dict(K),'episodesByExactTimestamp':gaps,'diagnosis':'Four re-promotion subscription-ID refusals each interrupted six scopes; one logsSubscribe physical timeout interrupted six. No HTTP-cooldown-triggered native teardown. Twelve candidate-local callbacks and six cutoff/shutdown callbacks are separate.'},
 'controlRefusals':[e['data']for e in by['native-flow-control-refused']],
 'audits':{'total':len(A),'byStatus':dict(collections.Counter(a['result']['status']for a in A)),'unavailableByReason':dict(collections.Counter(a['result']['reason']for a in A if a['result']['status']=='unavailable')),'unavailable':[{'mint':a['mint'],'target':a['result']['target'],'startedAt':a['result']['startedAt'],'availableAt':a['result']['availableAt'],'reason':a['result']['reason'],'matchingHttpLifecycle':[h for h in H if h['method']=='getSignaturesForAddress'and a['result']['startedAt']-20<=h['requestedAt']<=a['result']['availableAt']+20]}for a in A if a['result']['status']=='unavailable'],'unusableMissingNotifications':missing,'completedPageMetrics':{str(l):{'count':len(v),'totalResponseBytes':sum(h['responseBytes']for h in v),'elapsedMonotonicMs':stats([h['elapsedMonotonicMs']for h in v]),'headersDelayMs':stats([h['headersDelayMs']for h in v]),'bodyAfterHeadersMs':stats([h['bodyAfterHeadersMs']for h in v]),'jsonDecodeMonotonicMs':stats([h['jsonDecodeMonotonicMs']for h in v])}for l,v in pagegroups.items()},'pageLimitReached':sum(a['result']['reason']=='NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN'for a in A),'missingFailedOnlyVerifiedWindows':sum(a['result']['status']=='verified'and bool(a['result']['missingFailedNotifications'])for a in A),'readyReplacementDeferrals':len(by['native-deep-admission-deferred'])},
 'deadlineMisses':{'total':len(expired),'classifications':dict(collections.Counter(x['classification']for x in expired)),'targets':expired,'interpretation':'Actual missed current-window predictive decisions, not strategy rejections; no proof that they would pass or be executable. Normal initial fence warming separately counted. Seven remaining undispatched targets followed timeout/cooldown, heartbeat/unsubscribe occupancy and conservative 2s-operation admission guard. Replacement setup no longer interposed during those ready batches.'},
 'throughput':{'validatedNotificationRecords':len(N),'validatedSuccess':sum(n['success']for n in N),'validatedFailed':sum(not n['success']for n in N),'availabilityMinusReceiptMs':stats(ages),'peakValidatedReceiptRecords':{str(w):max(i-bisect.bisect_right(t,x-w)+1 for i,x in enumerate(t))for w in[1000,10000,60000]for t in[sorted(n['receivedAt']for n in N)]},'perTransactionEnrichmentRequests':s['engine']['flow']['perTransactionEnrichmentRequests'],'scopedNativeSocketBytes':s['engine']['flow']['socketBytes'],'broadPumpApiSocketBytes':stream['pumpApiSocketBytes'],'discoverySocketBytes':stream['discoverySocketBytes'],'broadFrames':stream['frames'],'deepConcurrencyMs':dict(concurrency),'sixAckedScopeIntervals':six},
 'provider':{'physicalStarts':len(starts),'physicalSettlements':len(by['component-physical-settled']),'peakStarts':{str(w):max(i-bisect.bisect_right(starts,t-w)+1 for i,t in enumerate(starts))for w in[10000,60000]},'startsByMethod':dict(collections.Counter(e['data']['kind']['method']for e in by['component-physical-start'])),'httpLifecycleStatus':dict(collections.Counter(str(h['status'])for h in H)),'newAccountedResponseBytes':rpc['newAccountedResponseBytes'],'newMeasuredResponseBytes':rpc['newAccountedResponseBytes']-(rpc['uncertainResponseBytes']-148111360),'newUncertainResponseBytes':rpc['uncertainResponseBytes']-148111360,'accountingMeaning':'Derived from settled run usage and preserved prior uncertainty148111360; no uncertainty refunded. Public provider entitlement and transfer expenses remain unverified.','derivedStatusPersistence':rpc['persistence'],'providerSaturationClaim':'Not established; all250 received headers were200,18 operations ended before headers. Query-specific repeated audit stalls are not proof of whole-endpoint overload. TCP connection reuse is not instrumented.'},
 'resources':s['resources'],'financial':{'financialWriterOpened':s['financialWriterOpened'],'financialExecutionAuthorized':s['financialExecutionAuthorized'],'portfolio':s['portfolio'],'paperTrades':0,'positionsCreated':0,'profitability':'not measured'},
 'decision':'USEFUL DATA-PATH GAIN; INADEQUATE FOR RELIABLE SIX-SLOT CONTINUOUS QUALIFICATION OR PAPER ACCEPTANCE',
 'nextRepairs':['Safely handle legitimate same-filter retired subscription-ID reuse without treating an old generation as current.','Keep real query failures fail-closed while avoiding unnecessary global HTTP timeout backoff and immediate discretionary retirement overhead displacing ready audits.','Admit actual post-snapshot validated tail for corroboration without changing target features; only one of four unusable results is entirely explained by a stale tail snapshot.','Coalesce duplicate derived status writes while preserving every authoritative charge and physical settlement.'],
 'evidenceContract':{'essential':'Executed ordinary trade identity, direction, integer quantities/fees/user, confirmed availability, supported pool, complete contemporaneous target window and independent bounded history support. Successful unknown rows remain blocking.','diagnostic':'Independently confirmed failed-only missing packets need not count as executed flow. This run had no verified window relying on that exception. Full raw diagnostic/status duplication and whole broad-stream archiving are not needed for financial decisions.','notProven':'No whole-market opportunity denominator, live holding workload, executable quotes, fills, exits, financial accounting or unattended acceptance in this candidate-only run.'}
}
(ROOT/'analysis-forward906.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'written':str(ROOT/'analysis-forward906.json'),'counterChecks':s['engine']['counters'],'deadlineClasses':result['deadlineMisses']['classifications'],'gaps':sum(K.values()),'sixMs':sum(x['durationMs']for x in six),'tailOnlyUnusable':sum(x['allMissingSuccessfulRowsAvailableBeforeCompletion']for x in missing)},indent=2))
