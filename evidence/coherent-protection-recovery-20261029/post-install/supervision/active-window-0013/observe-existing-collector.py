#!/usr/bin/env python3
"""Finite local-file analysis; existing detached GET collector/service are untouched."""
from pathlib import Path
import json,time,os,hashlib,datetime
root=Path.cwd();out=Path(__file__).resolve().parent
latest=root/'evidence/coherent-protection-recovery-20261029/post-install/supervision/detached-after-0006/rolling-supervision/latest.json'
started=time.time();end=time.monotonic()+600;last_received=None;last_material=None;last_heartbeat=0;rows=[];events=[]
def iso(ms):return datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc).isoformat() if ms else None
def concise(x):
 i=x.get('intelligence',{});p=i.get('protection',{});q=i.get('quality',{});v=i.get('provider',{});a=i.get('admission',{});r=i.get('resources',{})
 return {'receivedAt':iso(x.get('receivedAt')),'sourceAt':x.get('times',{}).get('generatedAt'),'sequence':x.get('sequence'),'source':x.get('source'),'status':x.get('status'),'protection':p,'provider':{k:v.get(k)for k in ['rpcRequests','httpTimeouts','httpErrors','throttles','rollingStartsPerMinute','primaryCooldownUntil']},'holdingRefusals':[z for z in q.get('limitations',[])if 'refusal' in z.lower()],'quality':{k:q.get(k)for k in ['captureConnected','qualityGaps','auditUnavailable','auditUnusable','decisionDeadlineMisses']},'evidence':{k:a.get(k)for k in ['evidenceAdmissionAllowed','evidencePressureReasonCode','evidenceRefusedRecords','sourceRecoveryGeneration','sourceRecoveryFailures']},'resources':r,'positions':x.get('positions'),'pendingOrders':i.get('pendingOrders'),'funnel':x.get('funnel'),'balances':x.get('balances')}
def material(x):
 i=x.get('intelligence',{});p=i.get('protection',{});q=i.get('quality',{});v=i.get('provider',{});a=i.get('admission',{})
 return {'source':x.get('source'),'status':x.get('status'),'protection':{k:p.get(k)for k in ['state','breaches','unavailableChecks']},'quality':{k:q.get(k)for k in ['captureConnected','qualityGaps','auditUnavailable','auditUnusable','decisionDeadlineMisses']},'provider':{k:v.get(k)for k in ['httpTimeouts','httpErrors','throttles']},'evidence':{k:a.get(k)for k in ['evidenceAdmissionAllowed','evidencePressureReasonCode','evidenceRefusedRecords','sourceRecoveryGeneration','sourceRecoveryFailures']},'holdingRefusals':[z for z in q.get('limitations',[])if 'refusal' in z.lower()],'positions':[(z.get('mint'),z.get('quantity'),z.get('enteredAt'))for z in x.get('positions',[])],'trades':[(z.get('id'),z.get('at'),z.get('side'),z.get('quantity'))for z in x.get('trades',[])]}
try:
 while time.monotonic()<end:
  try:
   x=json.loads(latest.read_text());received=x.get('receivedAt');now=time.time();m=material(x)
   if received!=last_received:
    rows.append(x)
    with (out/'source-observations.ndjson').open('a')as f:f.write(json.dumps(x,separators=(',',':'))+'\n')
    last_received=received
    if m!=last_material:
     event={'kind':'MATERIAL_SOURCE_TRANSITION','detectedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'snapshot':concise(x)};events.append(event)
     with (out/'material-transitions.ndjson').open('a')as f:f.write(json.dumps(event,separators=(',',':'))+'\n')
     print(json.dumps(event,separators=(',',':')),flush=True);last_material=m
   if now-last_heartbeat>=60:
    alive=True
    try:os.kill(195904,0)
    except ProcessLookupError:alive=False
    print(json.dumps({'kind':'PERIODIC_SCORECARD','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'collectorAlive':alive,'observationAgeMs':round(now*1000-(received or 0)),'snapshot':concise(x)},separators=(',',':')),flush=True);last_heartbeat=now
  except Exception as e:print(json.dumps({'kind':'LOCAL_OBSERVATION_UNAVAILABLE','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'errorType':type(e).__name__,'runtimeAvailability':'UNKNOWN'}),flush=True)
  time.sleep(15)
finally:
 summary={'kind':'BOUNDED_LOCAL_ANALYSIS_COMPLETED_EXISTING_COLLECTOR_CONTINUES','startedAt':iso(started*1000),'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observationCount':len(rows),'materialTransitionCount':len(events),'first':concise(rows[0])if rows else None,'last':concise(rows[-1])if rows else None,'serviceStopped':False,'collectorStopped':False,'financialControlsChanged':False,'additionalNetworkRequests':0,'scope':'Only these sampled records; no inference of supervision across unobserved gaps.'}
 (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 files={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in out.iterdir()if p.is_file()and p.name!='receipt.json'}
 (out/'receipt.json').write_text(json.dumps({'frozenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':files},indent=2)+'\n');print(json.dumps({'kind':'WINDOW_COMPLETE','summary':str(out/'summary.json'),'observations':len(rows),'collectorContinues':True}),flush=True)
