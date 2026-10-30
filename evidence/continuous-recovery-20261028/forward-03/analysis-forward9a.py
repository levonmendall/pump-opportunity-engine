"""Read-only retained actual source9a analysis. No network, ledger or runtime writes."""
from pathlib import Path
import json,collections,hashlib,math,bisect,datetime
ROOT=Path(__file__).resolve().parent
CAP=Path('/workspace/poe-pilot/runs/native-containment-20261028184000');D=CAP/'artifact/run'
def rd(p):return json.loads(p.read_bytes())
def stats(a):
 s=sorted(a);return {'count':len(s),'p50':s[max(0,math.ceil(len(s)*.5)-1)]if s else None,'p95':s[max(0,math.ceil(len(s)*.95)-1)]if s else None,'maximum':s[-1]if s else None}
def utc(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat(timespec='milliseconds')
by=collections.defaultdict(list);counts=collections.Counter();N=[];segments=[]
skip={'native-flow-raw-representative','native-flow-history-page','pilot-watch-activity','native-flow-raw-refusal','native-candidate-feature-view'}
for p in sorted((D/'events').glob('*.ndjson')):
 h=hashlib.sha256();size=0
 for i,line in enumerate(p.open('rb'),1):
  h.update(line);size+=len(line);e=json.loads(line);k=e['kind'];counts[k]+=1;e['ref']=str(p.relative_to(D))+':'+str(i)
  if k=='native-flow-information-available':N.append({**e['data'],'ref':e['ref']});continue
  if k=='native-flow-validated-events':continue
  if k not in skip:by[k].append(e)
 segments.append({'path':str(p.relative_to(CAP/'artifact')),'bytes':size,'sha256':h.hexdigest()})
s=rd(D/'status.json');sup=rd(CAP/'artifact/supervisor.json');readback=rd(CAP/'readback-receipt.json');u=s['usage']['rpc'];A=[e['data']for e in by['native-candidate-window-audit']];H=[e['data']for e in by['http-lifecycle-timing']];G=[e['data']for e in by['native-candidate-quality-gap']];P=[e['data']for e in by['native-predictive-assessment']]
assert readback['wholeArchiveHashVerified']and readback['allSelectedFilesVerified']
index=rd(CAP/'artifact/index.json');filesBytes=0
for r in index['included']:
 b=(CAP/'artifact'/r['path']).read_bytes();assert len(b)==r['bytes']and hashlib.sha256(b).hexdigest()==r['sha256'];filesBytes+=len(b)
ar=(CAP/'selected-evidence.tar.gz').read_bytes();assert len(ar)==readback['archiveBytes']and hashlib.sha256(ar).hexdigest()==readback['archiveSha256']
gapGroups=[]
for g in G:
 if gapGroups and gapGroups[-1]['reason']==g['reason']and g['at']-gapGroups[-1]['lastAt']<=10:
  gapGroups[-1]['mints'].append(g['mint']);gapGroups[-1]['lastAt']=g['at']
 else:gapGroups.append({'firstAt':g['at'],'lastAt':g['at'],'reason':g['reason'],'mints':[g['mint']]})
for g in gapGroups:
 g['callbacks']=len(g['mints']);g['physicalTimeoutsImmediatelyBefore']=[e['data']for e in by['component-physical-timeout']if 0<=g['firstAt']-e['data']['at']<250]
recoveries=[]
for e in by['native-flow-support-refresh-deferred']:
 d=e['data'];fresh=[a for a in d['scopes']if a['sourceSupportFresh']];out=[]
 for a in fresh:
  later=[x['data']for x in by['research-clock-observation-support']if x['data']['mint']==a['mint']and x['data']['at']>d['at']]
  nxt=later[0]if later else None
  out.append({'mint':a['mint'],'priorSourceExpiresAt':a['sourceExpiresAt'],'headroomMs':a['sourceExpiresAt']-d['at'],'nextFreshValidationAt':nxt['at']if nxt else None,'freshBeforeOriginalExpiry':nxt['at']<a['sourceExpiresAt']if nxt else False})
 recoveries.append({'at':d['at'],'reason':d['reason'],'retryAt':d['retryAt'],'consecutiveFailures':d['consecutiveFailures'],'notificationCapturePreserved':d['notificationCapturePreserved'],'freshnessExtended':d['freshnessExtended'],'freshScopes':len(fresh),'allScopes':len(d['scopes']),'scopes':out,'ref':e['ref']})
expiredSupports=[]
for g in G:
 if g['reason']=='NATIVE_FLOW_SUPPORT_EXPIRED':
  prev=[x for x in by['research-clock-observation-support']if x['data']['mint']==g['mint']and x['data']['at']<g['at']][-1];d=prev['data'];expiredSupports.append({**g,'lastValidationAt':d['at'],'bankClockAt':d['summary']['marketClockUnixSeconds']*1000,'sourceAgeMs':g['at']-d['summary']['marketClockUnixSeconds']*1000,'lastSupportRef':prev['ref']})
def auditSummary(a):
 r=a['result'];return {'mint':a['mint'],'pool':r['pool'],'target':r['target'],'status':r['status'],'reason':r['reason'],'startedAt':r['startedAt'],'availableAt':r['availableAt'],'requiredSignatures':len(r['requiredSignatures']),'pages':r['pages'],'historyRangeCovered':r['historyRangeCovered'],'eventRef':next(e['ref']for e in by['native-candidate-window-audit']if e['data']is a),'rawResultCanonicalSha256':hashlib.sha256(json.dumps(r,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
expired=[]
for e in by['native-predictive-window-expired']:
 d=e['data'];a=[a['result']for a in A if a['mint']==d['mint']and a['result']['target']['endAt']==d['windowEndAt']];trace=[x['data']for x in by['native-audit-dispatch-state']if x['data']['mint']==d['mint']and x['data']['windowEndAt']==d['windowEndAt']]
 expired.append({**d,'classification':a[0]['reason']if a else'undispatched','audit':auditSummary(next(x for x in A if x['result']is a[0]))if a else None,'stateTransitions':trace,'ref':e['ref']})
preDispatch=[]
for e in expired:
 if e['classification']=='PILOT_RPC_COMPONENT_DISPATCH_EXPIRED':
  a=next(x for x in reversed(e['stateTransitions'])if x['reason']=='page-admission');latest=a['context']['latestStartAt'];jobs=[x for x in by['component-job-enqueued']if x['data'].get('latestStartAt')==latest and x['data']['kind']['method']=='getSignaturesForAddress' and 0<=x['data']['at']-a['at']<1000];assert len(jobs)==1;j=jobs[0];preDispatch.append({'mint':e['mint'],'windowEndAt':e['windowEndAt'],'pageAdmissionAt':a['at'],'latestPhysicalStartAt':latest,'actualComponentEnqueueAt':j['data']['at'],'localBeforeEnqueueMs':j['data']['at']-a['at'],'startDeadlineAlreadyExceededMs':j['data']['at']-latest,'remainingDecisionMsAtEnqueue':e['windowEndAt']+9999-j['data']['at'],'admissionRef':next(x['ref']for x in by['native-audit-dispatch-state']if x['data']is a),'enqueueRef':j['ref'],'physicalStartOccurred':False})
timeoutLatency=[]
for a in A:
 r=a['result']
 if r['status']=='unavailable'and r['reason']=='PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT':
  hs=[h for h in H if h['method']=='getSignaturesForAddress'and r['startedAt']-20<=h['requestedAt']<=r['availableAt']+20];assert len(hs)==1;timeoutLatency.append({'audit':auditSummary(a),'httpTiming':hs[0]})
pages=collections.defaultdict(list)
for a in A:
 r=a['result']
 for p in r['pages']:
  candidates=[h for h in H if h['method']=='getSignaturesForAddress'and r['startedAt']-20<=h['requestedAt']<=p['receivedAt']+20 and h['jsonDecodedAt']is not None and h['jsonDecodedAt']<=p['receivedAt']+20]
  assert candidates;pages[p['requestedLimit']].append(max(candidates,key=lambda h:h['jsonDecodedAt']))
starts=sorted(e['data']['at']for e in by['component-physical-start']);ns=sorted(n['receivedAt']for n in N);active={};last=s['startedAt'];conc=collections.Counter();sixstart=None;six=[];trans=[]
for k in ['native-flow-subscription-ack','native-candidate-retired','native-flow-disconnected']:
 for e in by[k]:trans.append((e['data']['at'],k,e['data']))
for t,k,d in sorted(trans,key=lambda x:x[0]):
 if t>s['logicalObservationCutoffAt']:break
 conc[len(active)]+=t-last;last=t
 if k=='native-flow-subscription-ack':active[d['mint']]=d['connection']
 elif k=='native-candidate-retired':active.pop(d['mint'],None)
 else:active={m:c for m,c in active.items()if c!=d['connection']}
 if len(active)==6 and sixstart is None:sixstart=t
 if len(active)!=6 and sixstart is not None:six.append(t-sixstart);sixstart=None
conc[len(active)]+=s['logicalObservationCutoffAt']-last
if sixstart is not None:six.append(s['logicalObservationCutoffAt']-sixstart)
local=[]
for e in by['native-flow-ledger-capacity-refusal']:
 d=e['data'];ack=[x['data']for x in by['native-flow-subscription-ack']if x['data']['mint']==d['mint']and x['data']['at']<d['at']][-1];items=[n for n in N if n['subscriptionMint']==d['mint']and n['availableAt']<=d['at']and n['connectionId']==ack['connection']and n['subscriptionId']==ack['subscription']];local.append({'refusal':d,'scopeAckAt':ack['at'],'observedBeforeRefusal':len(items),'successful':sum(n['success']for n in items),'failed':sum(not n['success']for n in items),'durationFromAckMs':d['at']-ack['at'],'offendingPacket':[x['data']for x in by['native-flow-refusal']if x['data']['subscriptionMint']==d['mint']and x['data']['reason']=='NATIVE_FLOW_NOTIFICATION_LEDGER_LIMIT']})
pubPath=Path('/workspace/pump-opportunity-engine/evidence/continuous-recovery-20261028/forward-03/render-cycles-proxy.ndjson');public=[]
publicBytes=pubPath.read_bytes()[:982987];assert len(publicBytes)==982987 and hashlib.sha256(publicBytes).hexdigest()=='ae24befce28ae39e52d0e9af8e50baf7f8eefa2cfd6a0140477611c60fb3f5cd'
for line in publicBytes.splitlines():
 x=json.loads(line)
 if x.get('receiver',{}).get('snapshot'):public.append(x)
private=[]
for e in by['native-source-status-snapshot']:
 d=e['data'];matches=[x for x in public if x['receiver']['snapshot']['generatedAt']==d['generatedAt']];proof=[]
 for m in matches[:2]:
  snap=m['receiver']['snapshot'];c=d['engine']['counters'];checks={'accountId':snap['accountId']==d['accountId'],'inceptionAt':snap['inceptionAt']==d['inceptionAt'],'runId':snap['runId']==d['runId'],'sourceCommit':snap['source']['release']==d['source']['commit'],'sourceSha256':snap['source']['sha256']==d['source']['sha256'],'generatedAt':snap['generatedAt']==d['generatedAt'],'running':snap['running']==d['running'],'entriesDisabled':snap['entriesEnabled']is False,'financialEmpty':snap['portfolio']is None and d['portfolio']is None,'auditedWindows':snap['funnel']['sufficientlyObserved']==c['auditedWindows'],'evaluations':snap['funnel']['evaluated']==c['predictiveAssessments'],'normalizedTrades':snap['metrics']['normalizedTrades']==c['normalizedEvents'],'rpcRequests':snap['metrics']['rpcRequests']==d['usage']['rpc']['newUnits'],'sourceTimes':snap['sourceTimes']==d['sourceTimes']};proof.append({'publicRequestedAt':m['requestedAt'],'publicReceivedAt':m['receivedAt'],'checks':checks,'allChecksPass':all(checks.values()),'snapshot':snap})
 private.append({'generatedAt':d['generatedAt'],'running':d['running'],'sourceRef':e['ref'],'publicMatchingSamples':len(matches),'proof':proof})
out={'schemaVersion':1,'classification':'ACTUAL_FORWARD_9A_NOT_ACCEPTANCE','source':s['source'],'configurationSha256':s['configurationSha256'],'runId':s['runId'],'readback':readback,'reverification':{'allIndexedFiles':len(index['included']),'indexedBytes':filesBytes,'archiveBytes':len(ar),'archiveSha256':hashlib.sha256(ar).hexdigest()},'segments':segments,'observation':{k:s[k]for k in ['startedAt','generatedAt','lastSourceAt','logicalObservationCutoffAt','stopRequestedAt','transportSettledAt','physicalSettlementConfirmed','elapsedMs']},'counters':s['engine']['counters'],'gapGroups':gapGroups,'gapCounts':dict(collections.Counter(g['reason']for g in G)),'gapCallbacks':len(G),'gapEpisodesWithin10ms':len(gapGroups),'supportRecoveryCases':recoveries,'supportExpiryCases':expiredSupports,'cache':s['engine']['flow']['transactionRetention'],'localLedgerPressure':local,'audits':{'total':len(A),'byStatus':dict(collections.Counter(a['result']['status']for a in A)),'unavailableByReason':dict(collections.Counter(a['result']['reason']for a in A if a['result']['status']=='unavailable')),'unavailable':[auditSummary(a)for a in A if a['result']['status']=='unavailable'],'multiplePages':[auditSummary(a)for a in A if len(a['result']['pages'])>1],'timeoutLatency':timeoutLatency,'pageMetrics':{str(k):{'count':len(v),'bytes':sum(h['responseBytes']for h in v),'elapsedMs':stats([h['elapsedMonotonicMs']for h in v]),'headersDelayMs':stats([h['headersDelayMs']for h in v]),'bodyAfterHeadersMs':stats([h['bodyAfterHeadersMs']for h in v]),'jsonDecodeMs':stats([h['jsonDecodeMonotonicMs']for h in v])}for k,v in pages.items()}},'misses':{'total':len(expired),'byClassification':dict(collections.Counter(e['classification']for e in expired)),'targets':expired,'localPrePhysicalDispatchExpiry':preDispatch},'featureResults':{'uniqueTokens':len({p['mint']for p in P}),'zeroTrade':sum(p['assessment']['features']['tradeCount']==0 for p in P),'nonzeroTrade':sum(p['assessment']['features']['tradeCount']>0 for p in P),'passes':[p for p in P if p['assessment']['status']=='not-rejected']},'provider':{'physicalStarts':len(starts),'physicalSettlements':len(by['component-physical-settled']),'startsByKind':dict(collections.Counter(e['data']['kind']['transport']+':'+e['data']['kind']['method']for e in by['component-physical-start'])),'peakStarts':{str(w):max(i-bisect.bisect_right(starts,t-w)+1 for i,t in enumerate(starts))for w in [10000,60000]},'timeoutsByKind':dict(collections.Counter(e['data']['kind']['transport']+':'+e['data']['kind']['method']for e in by['component-physical-timeout'])),'httpStatuses':dict(collections.Counter(str(h['status'])for h in H)),'newUnits':u['newUnits'],'newAccountedResponseBytes':u['newAccountedResponseBytes'],'cumulativeUnits':u['cumulativeUnits'],'cumulativeAccountedResponseBytes':u['accountedCumulativeResponseBytes'],'cumulativeUncertainResponseBytes':u['uncertainResponseBytes'],'fatal':u['fatal'],'closed':u['closed']},'resources':s['resources'],'supervisorPeakRss':{'runner':sup['maximumRunnerRssBytes'],'publisher':sup['maximumPublisherRssBytes']},'throughput':{'informationRecords':len(N),'successful':sum(n['success']for n in N),'failed':sum(not n['success']for n in N),'receiptToAvailabilityMs':stats([n['availableAt']-n['receivedAt']for n in N]),'peakReceiptRecords':{str(w):max(i-bisect.bisect_right(ns,t-w)+1 for i,t in enumerate(ns))for w in [1000,10000,60000]},'sixAckedScopeMs':sum(six),'sixLongestMs':max(six)if six else 0,'scopeConcurrencyMs':dict(conc)},'feeds':s['feeds'],'nativeFlow':s['engine']['flow'],'reporting':{'supervisor':sup['reportingAvailability'],'finalStoppedAck':sup['finalStoppedReportingAck'],'publicVerifiedPrefix':{'bytes':len(publicBytes),'sha256':hashlib.sha256(publicBytes).hexdigest()},'privatePublicMatches':private,'exactDistinctRunningPrivatePublicMatches':sum(x['running']and bool(x['proof'])for x in private),'exactDistinctStoppedPrivatePublicMatches':sum(not x['running']and bool(x['proof'])for x in private),'limitation':'Corrected public Cloud-proxy sampler starts after retained first four running snapshots; only exact stopped source can be compared. InitialCloudproxyfailures are not Render outages.'},'financial':{'financialWriterOpened':s['financialWriterOpened'],'entriesEnabled':s['entriesEnabled'],'portfolio':s['portfolio'],'fills':0,'positions':0,'pnl':'not measured'},'eventCounts':dict(counts),'decision':'Useful live containment and retention gains; this configuration remains inadequate for reliable busy six-slot current-window qualification. No PAPER execution or acceptance.'}
(ROOT/'analysis-forward9a.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'gaps':out['gapCounts'],'gapEpisodes':len(gapGroups),'auditStatus':out['audits']['byStatus'],'misses':out['misses']['byClassification'],'pages':out['audits']['pageMetrics'],'provider':out['provider'],'passes':[(p['mint'],p['at'],p['entryAgeEligible'])for p in out['featureResults']['passes']],'throughput':out['throughput'],'reportingMatchedStopped':out['reporting']['exactDistinctStoppedPrivatePublicMatches'],'reportingProofPass':[p['allChecksPass']for t in private for p in t['proof']]},indent=2))
