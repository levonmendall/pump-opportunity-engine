import json,pathlib,time,datetime,hashlib,os
D=pathlib.Path(__file__).resolve().parent
INPUT=D.parents[2]/'issue11-consolidation-20261028/coherent-entry-forward-20261029/rolling-supervision/latest.json'
# All input is the existing root sampler's retained public response. This script
# issues no HTTP/RPC, touches no ledger and cannot affect service lifetime.
TARGET='ba33ee535ad1703da36905a5e2f44088ae19a43d'
START=time.time(); END=START+12*60; seen=None; rows=[]; material=[]; previous=None; rawBytes=0; digest=hashlib.sha256(); last=None

def atom(name,v):
 p=D/name;t=p.with_suffix(p.suffix+'.pending');t.write_text(json.dumps(v,indent=2)+'\n');t.replace(p)
def iso(x):return datetime.datetime.fromtimestamp(x/1000,datetime.timezone.utc).isoformat() if isinstance(x,(int,float)) else None

def summary(complete=False):
 target=[r for r in rows if r.get('release')==TARGET];first=target[0] if target else None;tail=target[-1] if target else None
 def delta(group,key):
  if first is None:return None
  a=first.get(group,{}).get(key);b=tail.get(group,{}).get(key)
  return b-a if isinstance(a,(int,float)) and isinstance(b,(int,float)) and b>=a else None
 atom('summary.json',{'kind':'retained-public-forward-analysis','analysisStartedAt':iso(START*1000),'lastExaminedAt':iso(time.time()*1000),'complete':complete,'measurementEndsAt':iso(END*1000),'sourceCommit':TARGET,'networkRequestsByAnalyzer':0,'ledgerWritesByAnalyzer':0,'serviceControlsByAnalyzer':0,'publicRowsExamined':len(rows),'targetRows':len(target),'first':first,'latest':tail,'materialTransitions':material,'deltas':{'completeWindows':delta('candidates','completeWindows'),'auditedWindows':delta('candidates','auditedWindows'),'predictiveAssessments':delta('candidates','predictiveAssessments'),'predictivePasses':delta('candidates','predictivePasses'),'qualityGaps':delta('quality','qualityGaps'),'auditUnavailable':delta('quality','auditUnavailable'),'auditUnusable':delta('quality','auditUnusable'),'decisionDeadlineMisses':delta('quality','decisionDeadlineMisses'),'httpTimeouts':delta('provider','httpTimeouts'),'rpcRequests':delta('provider','rpcRequests'),'rpcResponseBytes':delta('provider','rpcResponseBytes'),'nativeStreamBytes':delta('provider','nativeStreamBytes')},'rawBytesRetained':rawBytes,'rawSha256':digest.hexdigest(),'limits':['Public data does not expose per-request physical start/completion latency; causal attribution remains unknown without native evidence.','Configured/predictive passes are not executable qualification or PAPER fills.','Flat state is not evidence of two-held protection reliability.','Analyzer interval does not bound the persistent EC2 service.']})

while time.time()<END:
 try:
  raw=INPUT.read_bytes();r=json.loads(raw)
  if r.get('receivedAt')==seen:time.sleep(2);continue
  seen=r.get('receivedAt');s=r.get('source')or{};i=r.get('intelligence')or{};run=i.get('run')or{};at=(r.get('times')or{}).get('generatedAt')
  row={'observedAt':iso(r.get('receivedAt')),'sourceAt':at,'release':s.get('release'),'strategy':s.get('strategy'),'sequence':r.get('sequence'),'unavailable':r.get('unavailable',False),'unavailableReason':r.get('reason'),'status':r.get('status'),'run':run,'candidates':i.get('candidates',{}),'quality':i.get('quality',{}),'provider':i.get('provider',{}),'resources':i.get('resources',{}),'protection':i.get('protection',{}),'admission':i.get('admission',{}),'positions':r.get('positions',[]),'pendingOrders':i.get('pendingOrders',[]),'decisions':i.get('decisions',[]),'trades':r.get('trades',[]),'balances':r.get('balances',{})}
  rows.append(row)
  with (D/'observations.ndjson').open('a') as f:f.write(json.dumps(row,separators=(',',':'))+'\n')
  sig=json.dumps({'release':row['release'],'status':row['status'],'unavailable':row['unavailable'],'capture':row['quality'].get('captureConnected'),'positionMints':[x.get('mint') for x in row['positions']],'pendingIds':[x.get('id') for x in row['pendingOrders']],'tradeIds':[x.get('id') for x in row['trades']],'recovery':row['admission'].get('sourceRecoveryReasonCode')},sort_keys=True)
  if sig!=previous:
   material.append({'observedAt':row['observedAt'],'sourceAt':at,'release':row['release'],'sequence':row['sequence'],'status':row['status'],'unavailable':row['unavailable'],'capture':row['quality'].get('captureConnected'),'positions':len(row['positions']),'pending':len(row['pendingOrders']),'tradeFills':len(row['trades'])});previous=sig
   print(json.dumps(material[-1]),flush=True)
   if rawBytes+len(raw)<=20*1024*1024:
    with (D/'material-public-frames.ndjson').open('ab') as f:f.write(raw)
    rawBytes+=len(raw);digest.update(raw)
   else:
    with (D/'raw-omission-receipts.ndjson').open('a') as f:f.write(json.dumps({'at':row['observedAt'],'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'reason':'Diagnostic analyzer20MiB raw-bound; original root samples remain separately retained.'})+'\n')
  summary()
 except (OSError,ValueError,KeyError) as e:
  with (D/'read-errors.ndjson').open('a') as f:f.write(json.dumps({'at':iso(time.time()*1000),'errorClass':type(e).__name__})+'\n')
 time.sleep(2)
summary(True)
print(json.dumps({'complete':True,'observations':len(rows),'finishedAt':iso(time.time()*1000)}),flush=True)
