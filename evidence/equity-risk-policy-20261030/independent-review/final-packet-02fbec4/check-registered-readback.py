from pathlib import Path
import textwrap,hashlib,types,stat,os,sys,json,io,contextlib,datetime
from unittest.mock import patch
root=Path('/workspace/poe-paper-equity-execution-admin');wf=root/'.github/workflows/poe-original-cutover-refusal.yml';reader=root/'operator/native-paper-ec2/read-paper-equity-execution-forensics-20261030.py';expected='325786179e53b0fcef5bf0428f12e6a4255754c9d735d8595d465550ae49d326'
assert hashlib.sha256(reader.read_bytes()).hexdigest()==expected
code=textwrap.dedent(wf.read_text().split("<<'PYOUTPUT'\n",1)[1].split('          PYOUTPUT',1)[0]);original={'kind':'POE_ORIGINAL_CUTOVER_REFUSAL_READ_ONLY','financialDatabaseOpened':False,'credentialReads':0,'serviceChanges':0,'providerRequests':0,'publicFixture':['x'*3000]*120}
def run(payload,corrupt=False,race=False,overflow=False):
 value=dict(original)
 if overflow:value['publicFixture']=['x'*3000]*160
 raw=(json.dumps(value,indent=2)+'\n').encode();stub=('def read():\n return '+repr(payload)+'\n').encode();digest=hashlib.sha256(stub).hexdigest();copy=code.replace(expected,digest);assert copy!=code
 def metadata(fd,stamp=1):return types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_nlink=1,st_uid=994,st_size=len(raw if fd==7 else stub),st_dev=1,st_ino=fd,st_mtime_ns=stamp,st_ctime_ns=stamp)
 calls={7:0,8:0}
 def fs(fd):calls[fd]+=1;return metadata(fd,2 if race and fd==8 and calls[fd]==2 else 1)
 def rd(fd,n):return raw if fd==7 else (stub[:-1]+b'X' if corrupt else stub)
 stdout=io.StringIO()
 with patch.object(sys,'argv',['workflow','/DISPOSABLE_ONLY_FIXTURE']),patch.object(os,'open',side_effect=[7,8]),patch.object(os,'fstat',side_effect=fs),patch.object(os,'read',side_effect=rd),patch.object(os,'close'),patch.object(os,'getuid',return_value=994),contextlib.redirect_stdout(stdout):
  if corrupt or race or overflow:
   try:exec(compile(copy,str(wf),'exec'),{})
   except AssertionError:pass
   else:raise AssertionError('must reject modified reader or overflow')
   assert stdout.getvalue()==''
  else:
   exec(compile(copy,str(wf),'exec'),{});result=stdout.getvalue();merged=json.loads(result);assert merged['paperEquityExecutionForensics']==payload;assert merged['publicFixture']==value['publicFixture'];assert result.startswith('{\n')and result.endswith('\n')and all(len(x)<=4096 for x in result.splitlines());assert len(result.encode())<=524288
for x in [False,True]:run({'available':x,'reasonCode':'FIXTURE_UNKNOWN'if not x else 'FIXTURE_VERIFIED','value':{'immutableFixture':True}})
run({'available':False},corrupt=True);run({'available':False},race=True);run({'available':True,'value':['y'*3000]*20},overflow=True)
v={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'workflow':str(wf),'workflowSha256':hashlib.sha256(wf.read_bytes()).hexdigest(),'realReaderSha256':expected,'cases':5,'pass':True,'scope':'Execute actual registered PYOUTPUT body against disposable in-memory original snapshot and explicitly substituted diagnostic reader implementation; verified exact real reader separately. Includes unavailable/available merge, changed reader bytes, descriptor race and bounded complete output refusal. No target paths opened.'}
Path(__file__).with_name('registered-readback-verification.json').write_text(json.dumps(v,indent=2)+'\n');print(json.dumps(v,indent=2))
