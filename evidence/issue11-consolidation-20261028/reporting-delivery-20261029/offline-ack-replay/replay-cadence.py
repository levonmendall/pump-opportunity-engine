import datetime,hashlib,json,pathlib,types
from unittest.mock import patch
ROOT=pathlib.Path('/workspace/pump-opportunity-engine');OUT=pathlib.Path('/tmp/poe-ack-replay-20261029');m=types.ModuleType('installed_supervisor');exec(compile((ROOT/'operator/native-paper-ec2/run-authoritative-service.py').read_bytes(),'installed-supervisor','exec'),m.__dict__)
manifest=json.loads((ROOT/'evidence/issue11-consolidation-20261028/prepared-original-upgrade/service.json').read_text());envelope=json.loads((ROOT/'evidence/issue11-consolidation-20261028/reporting-delivery-20261029/render-1793244843405.json').read_text());base=envelope['snapshot'];epoch=datetime.datetime(1970,1,1,tzinfo=datetime.timezone.utc);t0=(datetime.datetime.fromisoformat(base['times']['generatedAt'].replace('Z','+00:00'))-epoch)//datetime.timedelta(milliseconds=1)
class Log:
 def write(self,b):pass
 def close(self):pass
 def status(self):return {}
c=m.Supervisor(manifest,None,{k:Log()for k in['source','publisher','supervisor']});d=OUT/'cadence';d.mkdir(exist_ok=True,mode=0o700);public=d/'public';public.mkdir(exist_ok=True,mode=0o755);public.chmod(0o755)
status={'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'source':manifest['source'],'startedAt':t0-100000,'generatedAt':t0,'running':True,'runId':base['intelligence']['run']['id']};events=[];ack_by_i={}
for i in range(6):
 snapshot=json.loads(json.dumps(base));at=t0+i*15000;snapshot['times']['generatedAt']=(epoch+datetime.timedelta(milliseconds=at)).isoformat(timespec='milliseconds').replace('+00:00','Z');snapshot['sequence']=str(int(base['sequence'])+i);raw=(json.dumps(snapshot,separators=(',',':'))+'\n').encode();a={'published':True,'result':'accepted','accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION_ISO,'release':manifest['source']['commit'],'sequence':snapshot['sequence'],'sourceAtMs':at,'fingerprint':hashlib.sha256(str(i).encode()).hexdigest(),'rawSourceSha256':m.sha(raw),'acknowledgedAtMs':at+19000};events.extend([(at,'report',i,raw),(at+19000,'ack',i,a)])
rows=[]
with patch.object(m,'ACCOUNT',d),patch.object(m,'SERVICE',d),patch.object(m,'PUBLIC',public):
 for at,kind,i,value in sorted(events):
  if kind=='report':(d/'snapshot.json').write_bytes(value);(d/'snapshot.json').chmod(0o600);c.last_source={**status,'generatedAt':at}
  else:c.pending_acks.append(m.parse_ack(json.dumps(value),at,manifest['source']['commit']))
  for _ in range(3):c.cache_source_snapshot(at)
  rows.append({'event':kind,'ordinal':i,'timeMs':at,'currentReportAt':c.last_source['generatedAt'],'cacheKeys':[k[0]for k in c.snapshot_cache],'matchedCount':c.accepted_source_count,'pending':len(c.pending_acks),'outputErrors':c.output_errors})
result={'meaning':'Chronological 15-second reports with ACK delayed19 seconds: newer report is cached before prior ACK arrives','finalMatched':c.accepted_source_count,'events':rows};(OUT/'cadence-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
