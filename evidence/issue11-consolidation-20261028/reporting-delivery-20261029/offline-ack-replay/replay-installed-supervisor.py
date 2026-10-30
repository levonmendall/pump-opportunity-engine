import contextlib,datetime,hashlib,json,os,pathlib,subprocess,types
from unittest.mock import patch
ROOT=pathlib.Path('/workspace/pump-opportunity-engine')
OUT=pathlib.Path('/tmp/poe-ack-replay-20261029')
CODE=(ROOT/'operator/native-paper-ec2/run-authoritative-service.py').read_bytes()
m=types.ModuleType('frozen_authoritative_service');m.__file__='/tmp/poe-ack-replay-20261029/frozen-supervisor.py';exec(compile(CODE,m.__file__,'exec'),m.__dict__)
manifest=json.loads((ROOT/'evidence/issue11-consolidation-20261028/prepared-original-upgrade/service.json').read_text())
class Log:
 def __init__(self):self.lines=[]
 def write(self,b):self.lines.append(b)
 def close(self):pass
 def status(self):return {}
rows=[]
for d in sorted(OUT.glob('render-*.json')):
 if not d.is_dir():continue
 public=d/'public';public.mkdir(exist_ok=True,mode=0o755);public.chmod(0o755);raw=(d/'snapshot.json').read_bytes();snapshot=json.loads(raw);ack=json.loads((d/'ack.json').read_bytes());at=ack['sourceAtMs'];now=ack['acknowledgedAtMs'];run=snapshot['intelligence']['run'];started=int(datetime.datetime.fromisoformat(run['startedAt'].replace('Z','+00:00')).timestamp()*1000)
 status={'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'mode':'paper','authoritative':True,'experimental':False,'financialExecutionAuthorized':True,'liveTradingEnabled':False,'source':manifest['source'],'configurationSha256':manifest['configurationSha256'],'persistent':True,'operatingMode':'persistent-service','managementOnly':False,'runtimePid':2440527,'startedAt':started,'generatedAt':at,'running':True,'runId':run['id'],'positions':{},'pending':{}}
 logs={k:Log()for k in['source','publisher','supervisor']};c=m.Supervisor(manifest,None,logs)
 c.last_source=m.validate_status(status,manifest,started-500,2440527,now)
 read_fd,write_fd=os.pipe();os.set_blocking(read_fd,False);publisher=types.SimpleNamespace(stdout=os.fdopen(read_fd,'rb',buffering=0));c.register('publisher',publisher)
 line=(json.dumps(ack,separators=(',',':'))+'\n').encode();os.write(write_fd,line)
 with patch.object(m.time,'time',return_value=now/1000),patch.object(m,'ACCOUNT',d),patch.object(m,'SERVICE',d),patch.object(m,'PUBLIC',d/'public'):
  c.drain();pending_before=len(c.pending_acks);c.cache_source_snapshot(now)
  matched=c.last_ack==ack; healthy={'critical':False,'newRiskPressure':False,'healthy':True};suspended,reason=m.admission(c.last_source,c.last_ack,healthy,3,now)
  rows.append({'file':d.name,'sourceAtMs':at,'sequence':ack['sequence'],'rawBytes':len(raw),'rawSha256':m.sha(raw),'ackParsedThroughDrain':pending_before==1,'cachedKey':list(next(iter(c.snapshot_cache))), 'matched':matched,'acceptedCount':c.accepted_source_count,'errors':c.output_errors,'publicReceipt':(d/'public'/'accepted-source.json').is_file(),'pendingAfter':len(c.pending_acks),'admissionSuspended':suspended,'reason':reason})
 os.close(write_fd);c.selector.unregister(publisher.stdout);publisher.stdout.close();c.selector.close()
# Four-entry cache is keyed by distinct source report, not loop iteration.
d=next(p for p in sorted(OUT.glob('render-*.json'))if p.is_dir());base=json.loads((d/'snapshot.json').read_bytes());base_ack=json.loads((d/'ack.json').read_bytes());at=base_ack['sourceAtMs'];c=m.Supervisor(manifest,None,{k:Log()for k in['source','publisher','supervisor']});cadence=[]
with patch.object(m,'ACCOUNT',d),patch.object(m,'SERVICE',d),patch.object(m,'PUBLIC',d/'public'):
 for i in range(6):
  v=json.loads(json.dumps(base));timestamp=at+15000*i;v['times']['generatedAt']=datetime.datetime.fromtimestamp(timestamp/1000,datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z');v['sequence']=str(int(base['sequence'])+i)
  raw=(json.dumps(v,separators=(',',':'))+'\n').encode();(d/'snapshot.json').write_bytes(raw);c.last_source={**status,'startedAt':at-100000,'generatedAt':timestamp}
  c.cache_source_snapshot(timestamp)
  a={**base_ack,'sourceAtMs':timestamp,'sequence':v['sequence'],'rawSourceSha256':m.sha(raw),'fingerprint':hashlib.sha256(str(i).encode()).hexdigest(),'acknowledgedAtMs':timestamp+19000};c.pending_acks.append(m.parse_ack(json.dumps(a),timestamp+19000,manifest['source']['commit']));c.cache_source_snapshot(timestamp+19000)
  for _ in range(40):c.cache_source_snapshot(timestamp+20000)
  cadence.append({'ordinal':i,'cacheEntries':len(c.snapshot_cache),'acceptedCount':c.accepted_source_count,'latestMatched':c.last_ack==a,'pending':len(c.pending_acks),'errors':c.output_errors})
result={'frozenSupervisorSha256':hashlib.sha256(CODE).hexdigest(),'manifestRead':'retained nonsecret service manifest','rawSourceMeaning':'JSON.stringify(snapshot)+newline reconstructed from retained Render accepted JSON; actual host bytes not read','normalReplays':rows,'cadence19SecondAcknowledgements':cadence,'noNetwork':True,'noCredentialReads':True,'noFinancialDatabaseRead':True}
(OUT/'supervisor-installed-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
