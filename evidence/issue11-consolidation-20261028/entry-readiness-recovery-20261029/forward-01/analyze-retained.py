#!/usr/bin/env python3
"""Offline analysis of retained original-channel source snapshots. No networking.

Every invocation freezes its selected source rows and produces a separately named
scorecard. Existing frozen rows/scorecards are never replaced. Public permission
is not substituted for the private ledger control state.
"""
import argparse, collections, datetime, hashlib, json, math, os, pathlib, statistics

ROOT=pathlib.Path(__file__).resolve().parents[2]
EXPECTED_SOURCE='f96f02eeccd56dda6ce811bdc4405f237224c54f'
EXPECTED_CONFIG='acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf'
ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION='2026-10-26T22:07:36.212Z'
STRATEGY='persistent-buying-pilot-v1'
DEFAULT_INPUT=ROOT/'coherent-entry-forward-20261029/rolling-supervision'
MAX_FILE=64*1024*1024
MAX_LINE=512*1024
SOURCE_FIELDS=('account','source','sequence','times','status','intelligence','funnel','balances','positions','trades')

def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def stamp(value):
 try:return int(datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000) if isinstance(value,str) else None
 except(ValueError,TypeError,OverflowError):return None
def iso(value):return datetime.datetime.fromtimestamp(value/1000,datetime.timezone.utc).isoformat().replace('+00:00','Z') if isinstance(value,(int,float)) else None
def finite(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
def stats(values):
 a=sorted(v for v in values if finite(v))
 return {'count':len(a),'minimum':a[0] if a else None,'median':statistics.median(a) if a else None,'p95':a[max(0,math.ceil(.95*len(a))-1)] if a else None,'maximum':a[-1] if a else None}
def age(at,value):
 t=stamp(value);return at-t if at is not None and t is not None else None
def field(row,path):
 for part in path.split('.'):
  if not isinstance(row,dict):return None
  row=row.get(part)
 return row
def write_once(path,raw):
 try:
  with path.open('xb') as f:f.write(raw)
 except FileExistsError:
  if path.read_bytes()!=raw:raise ValueError('Existing evidence differs: '+str(path))

def load_rows(paths):
 rows=[];provenance=[];errors=[]
 for path in paths:
  with path.open('rb') as f:
   before=os.fstat(f.fileno())
   if before.st_size>MAX_FILE:raise ValueError('Input exceeds bounded read: '+str(path))
   raw=f.read(before.st_size);after=os.fstat(f.fileno())
  provenance.append({'path':str(path),'bytesRead':len(raw),'sha256OfReadPrefix':sha(raw),'mutableInput':True,'changedDuringRead':(before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns)})
  parts=raw.splitlines()
  for index,line in enumerate(parts,1):
   if len(line)>MAX_LINE:errors.append({'file':str(path),'line':index,'kind':'oversized-line'});continue
   try:row=json.loads(line)
   except(ValueError,TypeError):
    errors.append({'file':str(path),'line':index,'kind':'partial-or-malformed-line'});continue
   if isinstance(row,dict):rows.append(row)
 return rows,provenance,errors

def identity(row):return (field(row,'source.release'),field(row,'intelligence.run.id'),str(row.get('sequence')))
def deduplicate(rows):
 selected={};conflicts=[];transport=[]
 for row in rows:
  if not isinstance(row.get('times'),dict) or not field(row,'times.generatedAt'):
   transport.append({'requestedAt':row.get('requestedAt'),'receivedAt':row.get('receivedAt'),'httpStatus':row.get('httpStatus'),'errorPresent':'error' in row});continue
  key=identity(row);old=selected.get(key)
  digest=sha(encoded({k:row.get(k) for k in SOURCE_FIELDS}))
  if old and old[0]!=digest:conflicts.append({'source':key[0],'run':key[1],'sequence':key[2],'sourceAt':field(row,'times.generatedAt')})
  if old is None or row.get('receivedAt',math.inf)<old[1].get('receivedAt',math.inf):selected[key]=(digest,row)
 return sorted((v[1] for v in selected.values()),key=lambda r:(stamp(field(r,'times.generatedAt')) or 0,str(r.get('sequence')))),conflicts,transport

def episodes(rows,predicate):
 result=[];active=None
 for row in rows:
  at=field(row,'times.generatedAt')
  if predicate(row):
   if active is None:active={'firstObservedAt':at,'firstSequence':row.get('sequence'),'samples':0}
   active['lastObservedAt']=at;active['lastSequence']=row.get('sequence');active['samples']+=1
  elif active is not None:
   active['firstSubsequentHealthySampleAt']=at;result.append(active);active=None
 if active is not None:active['firstSubsequentHealthySampleAt']=None;result.append(active)
 return result

def counter_changes(rows,paths):
 out={};regressions=[]
 for path in paths:
  known=[(r,field(r,path)) for r in rows if finite(field(r,path))]
  if not known:out[path]={'available':False};continue
  first,last=known[0],known[-1];out[path]={'before':first[1],'after':last[1],'delta':last[1]-first[1]}
  for (a,x),(b,y) in zip(known,known[1:]):
   if y<x:regressions.append({'counter':path,'fromAt':field(a,'times.generatedAt'),'toAt':field(b,'times.generatedAt'),'before':x,'after':y})
 return out,regressions

def analyze(rows,source,config):
 selected=[r for r in rows if field(r,'source.release')==source]
 if not selected:return {'state':'NO_EXPECTED_SOURCE_OBSERVED','expectedSource':source,'expectedConfiguration':config,'acceptance':'NOT YET PROVEN','observationCount':0,'otherObservedSources':sorted(set(field(r,'source.release') for r in rows if field(r,'source.release'))),'latestOtherSource':None if not rows else {'source':field(rows[-1],'source.release'),'generatedAt':field(rows[-1],'times.generatedAt'),'runtime':field(rows[-1],'status.runtime')}},[]
 runs=collections.defaultdict(list)
 for r in selected:runs[field(r,'intelligence.run.id')].append(r)
 result={'state':'OBSERVED_SAMPLES_ONLY','expectedSource':source,'expectedConfiguration':config,'acceptance':'NOT YET PROVEN','observationCount':len(selected),'runs':[],'limitations':['Sampled source frames do not prove continuous operation between frames.','Raw ledger controls and cash-maintenance counters are not present in this public projection. Effective permission is not a private ledger pause/resume action.','Overlapping windows are not independent minutes of market coverage. No whole-market recall denominator is available.','Flat marketAt is the original USD timestamp. Held marketAt can be a liquidation/Clock minimum, so held FX age is unavailable here.','Normal RPC slot occupancy is not directly observable. MONITORING_UNAVAILABLE is not counted as a provider incident.','Trading USD values are current/historical source translations as labeled; different-time trade values are not subtracted as exact realized USD profit.']}
 for run_id,rr in runs.items():
  facts=[];integrity=[];sequence_gaps=[];decisions={};trades={};trade_conflicts=[];order_fills=collections.defaultdict(set);order_reservations={};observed_buys=collections.defaultdict(set)
  for r in rr:
   at=stamp(field(r,'times.generatedAt'));held=len(r.get('positions') or []);pending=field(r,'intelligence.pendingOrders') or []
   recon=age(at,field(r,'times.reconciledAt'));valuation=age(at,field(r,'times.marketAt'));fx=valuation if held==0 else None;received=r.get('receivedAt');receiver=stamp(field(r,'freshness.receivedAt'));b=r.get('balances') or {};s=r.get('status') or {};i=r.get('intelligence') or {};a=i.get('admission') or {};q=i.get('quality') or {};p=i.get('provider') or {}
   reason=s.get('blocker');safe_reason=reason if isinstance(reason,str) and reason.startswith('POE_ENTRY_') else None if reason is None else 'OTHER_SOURCE_RESTRICTION'
   source_age=received-at if finite(received) and at is not None else None;receipt_age=received-receiver if finite(received) and receiver is not None else None
   fact={'sequence':r.get('sequence'),'sourceGeneratedAt':field(r,'times.generatedAt'),'observerReceivedAt':iso(received),'renderReceivedAt':field(r,'freshness.receivedAt'),'runtime':s.get('runtime'),'entries':s.get('entries'),'entryBlocker':safe_reason,'rawLedgerControls':'UNKNOWN_FROM_PUBLIC_SNAPSHOT','reconciled':s.get('reconciled'),'reconciliationAgeAtSourceMs':recon,'flatUsdAgeAtSourceMs':fx,'valuationAgeAtSourceMs':valuation,'sourceToObserverAgeMs':source_age,'renderReceiptAgeAtObserverMs':receipt_age,'heldPositions':held,'pendingActions':len(pending),'captureConnected':q.get('captureConnected'),'discoveryConnected':p.get('discoveryConnected'),'watchConnected':p.get('watchConnected'),'usdAvailable':b.get('solPriceUsd') is not None and b.get('equityUsd') is not None,'resourceState':field(r,'intelligence.resources.state'),'financialProjectionReady':a.get('financialProjectionReady'),'evidenceAdmissionAllowed':a.get('evidenceAdmissionAllowed'),'supervisedNewRiskAllowed':a.get('supervisedNewRiskAllowed'),'primaryCooldownActiveAtSource':stamp(p.get('primaryCooldownUntil')) is not None and stamp(p.get('primaryCooldownUntil'))>at,'providerErrorCounters':{k:p.get(k) for k in ('httpTimeouts','httpErrors','throttles')}}
   facts.append(fact)
   invalid=[]
   if field(r,'account.id')!=ACCOUNT or field(r,'account.inceptionAt')!=INCEPTION or field(r,'account.initialUsd')!=1000:invalid.append('ORIGINAL_ACCOUNT_IDENTITY_MISMATCH')
   if field(r,'intelligence.run.configurationSha256')!=config:invalid.append('CONFIGURATION_MISMATCH')
   if field(r,'source.strategy')!=STRATEGY:invalid.append('STRATEGY_MISMATCH')
   if field(r,'intelligence.candidates.deepMaximum')!=4 or (field(r,'intelligence.candidates.deepActive') or 0)>4:invalid.append('FOUR_SLOT_LIMIT_MISMATCH')
   if held>1:invalid.append('ONE_POSITION_LIMIT_EXCEEDED')
   if s.get('entries')=='enabled' and (s.get('runtime')!='running' or s.get('reconciled') is not True or recon is None or recon<0 or recon>2000 or not fact['usdAvailable'] or held>=1):invalid.append('ENABLED_PERMISSION_INCONSISTENT_WITH_REQUIRED_SOURCE_FACTS')
   if s.get('entries')=='enabled' and fx is not None and (fx<0 or fx>10000):invalid.append('ENABLED_WITH_STALE_FLAT_USD')
   if invalid:integrity.append({'sequence':r.get('sequence'),'at':field(r,'times.generatedAt'),'failures':invalid})
   for d in i.get('decisions') or []:
    key=(d.get('mint'),d.get('at'),d.get('stage'),d.get('reason'));decisions[key]=d
   for order in pending:
    key=order.get('id');prior=order_reservations.get(key)
    if prior is not None and prior!=order:integrity.append({'sequence':r.get('sequence'),'failures':['PENDING_ORDER_ID_CHANGED'],'id':key})
    if key:order_reservations[key]=order
   for t in r.get('trades') or []:
    key=t.get('id');prior=trades.get(key)
    if prior is not None and prior!=t:trade_conflicts.append({'id':key,'at':t.get('at')})
    if key:trades[key]=t
  for left,right in zip(rr,rr[1:]):
   try:a=int(left['sequence']);b=int(right['sequence'])
   except(ValueError,KeyError,TypeError):continue
   if b>a+1:sequence_gaps.append({'after':a,'before':b,'unretainedSourceSequences':b-a-1,'meaning':'Not retained by this observer; not proof of a runtime outage.'})
  run_start=stamp(field(rr[0],'intelligence.run.startedAt'));last_at=stamp(field(rr[-1],'times.generatedAt'));new_trades=[t for t in trades.values() if run_start is not None and stamp(t.get('at')) is not None and run_start<=stamp(t['at'])<=last_at]
  for t in trades.values():
   reason=t.get('reason') or '';marker='execution-attempt:';index=reason.find(marker);order_id=reason[index+len(marker):] if index>=0 else None
   if order_id:order_fills[(t.get('mint'),t.get('side'),order_id)].add(t.get('id'))
   if t.get('side')=='buy':observed_buys[t.get('mint')].add(t.get('id'))
  duplicate_order_fills=[{'mint':k[0],'side':k[1],'orderId':k[2],'fillIds':sorted(v)} for k,v in order_fills.items() if len(v)>1]
  reentries=[{'mint':mint,'buyFillIds':sorted(ids)} for mint,ids in observed_buys.items() if len(ids)>1]
  paths=['intelligence.candidates.'+x for x in ('migrationsReceived','verifiedOrigins','promoted','repromoted','completeWindows','auditedWindows','uniqueEvaluated','predictiveAssessments','predictivePasses','predictiveFailures','predictiveUnavailable')]+['intelligence.quality.'+x for x in ('qualityGaps','auditUnavailable','auditUnusable','decisionDeadlineMisses')]+['intelligence.provider.'+x for x in ('rpcRequests','httpTimeouts','httpErrors','throttles','rpcResponseBytes','nativeStreamBytes','broadWatchBytes')]+['funnel.'+x for x in ('qualified','attempted','paperFilled','exited','reconciled')]
  counters,regressions=counter_changes(rr,paths)
  source_gaps=[{'from':field(a,'times.generatedAt'),'to':field(b,'times.generatedAt'),'elapsedMs':stamp(field(b,'times.generatedAt'))-stamp(field(a,'times.generatedAt')),'meaning':'Unobserved source-generation interval; runtime activity between frames is unknown.'} for a,b in zip(rr,rr[1:]) if stamp(field(b,'times.generatedAt'))-stamp(field(a,'times.generatedAt'))>30000]
  stale_flat=[f for f in facts if f['runtime']=='running' and f['heldPositions']==0 and f['pendingActions']==0 and finite(f['flatUsdAgeAtSourceMs']) and 0<=f['flatUsdAgeAtSourceMs']<=10000 and finite(f['reconciliationAgeAtSourceMs']) and f['reconciliationAgeAtSourceMs']>2000]
  healthy_flat=[f for f in facts if f['runtime']=='running' and not f['heldPositions'] and not f['pendingActions'] and f['usdAvailable'] and f['resourceState']=='normal' and f['evidenceAdmissionAllowed'] is True]
  transitions=[]
  for a,b in zip(facts,facts[1:]):
   if a['entries']!=b['entries']:transitions.append({'fromSequence':a['sequence'],'toSequence':b['sequence'],'fromAt':a['sourceGeneratedAt'],'toAt':b['sourceGeneratedAt'],'from':a['entries'],'to':b['entries'],'previousReason':a['entryBlocker'],'currentReason':b['entryBlocker'],'elapsedSampleTimeMs':stamp(b['sourceGeneratedAt'])-stamp(a['sourceGeneratedAt']),'meaning':'Observed effective permission change; not an exact ledger control mutation or duration.'})
  new_decisions=[d for d in decisions.values() if run_start is not None and stamp(d.get('at')) is not None and run_start<=stamp(d['at'])<=last_at]
  distinct_evaluated={d.get('mint') for d in new_decisions if d.get('stage') in ('shadow-predictive-failed','shadow-predictive-not-rejected','predictive-failed','predictive-not-rejected','qualified') and d.get('mint')}
  resources={k:stats(field(r,'intelligence.resources.'+k) for r in rr) for k in ('cpuOneCoreFraction','rssBytes','availableMemoryBytes','availableDiskBytes','eventLoopLagMs')}
  block_counts=dict(collections.Counter(f['entryBlocker'] or 'NONE' for f in facts))
  result['runs'].append({'runId':run_id,'runtimeStartedAt':field(rr[0],'intelligence.run.startedAt'),'firstSourceAt':field(rr[0],'times.generatedAt'),'lastSourceAt':field(rr[-1],'times.generatedAt'),'sampledSpanMs':last_at-stamp(field(rr[0],'times.generatedAt')),'sourceSamples':len(rr),'firstSequence':rr[0].get('sequence'),'lastSequence':rr[-1].get('sequence'),'sourceTimestampGapObservations':source_gaps,'unretainedSourceSequenceRanges':sequence_gaps,'runtimeStateCounts':dict(collections.Counter(f['runtime'] for f in facts)),'entryStateCounts':dict(collections.Counter(f['entries'] for f in facts)),'entryBlockerCounts':block_counts,'sourceToObserverAgeMs':stats(f['sourceToObserverAgeMs'] for f in facts),'renderReceiptAgeMs':stats(f['renderReceiptAgeAtObserverMs'] for f in facts),'sourceOrRenderStaleSamples':[f for f in facts if (f['sourceToObserverAgeMs'] or 0)>90000 or (f['renderReceiptAgeAtObserverMs'] or 0)>90000],'flatReconciliationAgeMs':stats(f['reconciliationAgeAtSourceMs'] for f in facts if not f['heldPositions']),'observablyHealthyFlatReconciliationAgeMs':stats(f['reconciliationAgeAtSourceMs'] for f in healthy_flat),'flatOriginalUsdAgeMs':stats(f['flatUsdAgeAtSourceMs'] for f in facts),'freshFxFlatStaleReconciliationSamples':stale_flat,'staleReconciliationInterpretation':'Investigate with private work/cash-maintenance facts; active financial preparation may legitimately defer the cash callback. A sample alone is not attributed to scheduling.','selectedCaptureInterruptionEpisodes':episodes(rr,lambda r:field(r,'intelligence.quality.captureConnected') is False),'broadDiscoveryInterruptionEpisodes':episodes(rr,lambda r:field(r,'intelligence.provider.discoveryConnected') is False),'watchInterruptionEpisodes':episodes(rr,lambda r:field(r,'intelligence.provider.watchConnected') is False),'permissionTransitions':transitions,'counterChanges':counters,'counterRegressions':regressions,'distinctEvaluatedTokensInRetainedDecisionsLowerBound':len(distinct_evaluated),'distinctQualifiedMintsInRetainedDecisions':sorted({d['mint'] for d in new_decisions if d.get('stage')=='qualified'}),'newRunTrades':new_trades,'newRunBuyFills':sum(t.get('side')=='buy' for t in new_trades),'newRunSellFills':sum(t.get('side')=='sell' for t in new_trades),'historicalFillIdsRetained':len(trades)-len(new_trades),'pendingOrderIdsObserved':sorted(order_reservations),'duplicateOrderFillEvidence':duplicate_order_fills,'reentryEvidence':reentries,'conflictingTradeIds':trade_conflicts,'sourceFactIntegrityFailures':integrity,'resources':resources,'protectionLatest':field(rr[-1],'intelligence.protection'),'latestBalances':rr[-1].get('balances'),'latestPositions':rr[-1].get('positions'),'latestPending':field(rr[-1],'intelligence.pendingOrders'),'sampleFacts':facts})
 return result,selected

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-directory',type=pathlib.Path,default=DEFAULT_INPUT);p.add_argument('--frozen',type=pathlib.Path);p.add_argument('--output-directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--source',default=EXPECTED_SOURCE);p.add_argument('--configuration',default=EXPECTED_CONFIG);p.add_argument('--label',default=None);args=p.parse_args()
 paths=[args.frozen] if args.frozen else sorted(args.input_directory.glob('routine-*.ndjson'))+[args.input_directory/'material-transitions.ndjson',args.input_directory/'latest.json'];paths=[x for x in paths if x and x.is_file()]
 rows,provenance,errors=load_rows(paths);unique,conflicts,transport=deduplicate(rows);report,selected=analyze(unique,args.source,args.configuration);report.update({'evidenceClass':'INDEPENDENT_OFFLINE_ANALYSIS_OF_RETAINED_FORWARD_PUBLIC_SAMPLES','inputProvenance':provenance,'inputParseExceptions':errors,'sourceIdentityConflicts':conflicts,'observerTransportExceptions':transport,'criteria':{'reconciliationMaximumAgeMs':2000,'usdMaximumAgeMs':10000,'sourceAndPublisherStaleAfterMs':90000,'maximumDeepSlots':4,'maximumPaperPositions':1,'wholeMarketRecall':'UNKNOWN_DENOMINATOR','continuousOperation':'Requires corroborating source/feed/protection/reporting and EC2 evidence; sampled uptime alone is insufficient.'}})
 args.output_directory.mkdir(parents=True,exist_ok=True);raw=b''.join(encoded(r)+b'\n' for r in selected);digest=sha(raw);label=args.label or ('samples-'+(str(selected[0]['sequence'])+'-'+str(selected[-1]['sequence']) if selected else 'not-observed')+'-'+sha(encoded(report))[:10]);base=args.output_directory/label
 frozen=pathlib.Path(str(base)+'.snapshots.ndjson');write_once(frozen,raw);report['frozenInput']={'file':frozen.name,'bytes':len(raw),'sha256':digest};summary=pathlib.Path(str(base)+'.scorecard.json');write_once(summary,json.dumps(report,indent=2,allow_nan=False).encode()+b'\n')
 highlights=[{'run':r['runId'],'firstSourceAt':r['firstSourceAt'],'lastSourceAt':r['lastSourceAt'],'sourceSamples':r['sourceSamples'],'maximumFlatReconciliationAgeMs':r['flatReconciliationAgeMs']['maximum'],'freshFxStaleReconciliationSamples':len(r['freshFxFlatStaleReconciliationSamples']),'entryBlockers':r['entryBlockerCounts'],'newBuyFills':r['newRunBuyFills'],'newSellFills':r['newRunSellFills'],'sourceFactIntegrityFailures':len(r['sourceFactIntegrityFailures'])} for r in report.get('runs',[])]
 print(json.dumps({'state':report['state'],'sourceSamples':len(selected),'source':args.source,'summary':str(summary),'frozenInput':str(frozen),'warnings':len(conflicts),'acceptance':report['acceptance'],'highlights':highlights}))

if __name__=='__main__':main()
