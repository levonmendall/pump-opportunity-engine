#!/usr/bin/env python3
"""Stage hash-pinned upgrade bytes only. No ledger, provider or service mutation."""
import gzip,hashlib,io,json,os,pathlib,pwd,stat,subprocess,time
UID=994
INPUT=pathlib.Path('operator/native-paper-ec2/original-upgrade-package')
OUTPUT=pathlib.Path('/var/tmp/poe-issue11-staging')
MIB=1024*1024
LIMITS={'native-paper.mjs':8*MIB,'backup-worker.mjs':MIB,'better_sqlite3.node':4*MIB,'metadata.json':MIB,'snapshot-publisher.mjs':MIB,'input.json':MIB,'research-baseline.json':512*1024,'service.json':128*1024,'run-authoritative-service.py':128*1024,'poe-runtime-persistent.conf':8192,'original-status.json':4096,'audit-original-account.py':128*1024,'cutover-original-service.py':128*1024,'index.json':128*1024}
class Guard(RuntimeError):pass
def need(value,code):
 if not value:raise Guard(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def hex64(value):return type(value)is str and len(value)==64 and all(c in'0123456789abcdef'for c in value)
def available_bytes(path):
 s=os.statvfs(path);return s.f_bavail*s.f_frsize
def read(path,maximum,uid,private=False):
 need(path.parent.resolve(strict=True)==path.parent.absolute(),'CANONICAL_PACKAGE_PARENT_REQUIRED')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==uid and s.st_nlink==1 and not s.st_mode&(0o077 if private else 0o022)and 0<s.st_size<=maximum,'BOUNDED_OWNER_FILE_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd)
  need(len(raw)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'PACKAGE_CHANGED_DURING_READ');return raw
 finally:os.close(fd)
def prepare(directory,expected,uid):
 raw=read(directory/'transport.json',128*1024,uid);need(hex64(expected)and sha(raw)==expected,'EXACT_REVIEWED_TRANSPORT_REQUIRED');t=json.loads(raw)
 need(type(t)is dict and set(t)=={'schemaVersion','kind','source','indexSha256','files'}and t['schemaVersion']==1 and t['kind']=='poe-original-upgrade-transport-v1'and hex64(t['indexSha256']),'EXACT_TRANSPORT_SCHEMA_REQUIRED')
 source=t['source'];need(type(source)is dict and set(source)=={'commit','sha256'}and type(source['commit'])is str and len(source['commit'])==40 and all(c in'0123456789abcdef'for c in source['commit'])and hex64(source['sha256']),'PINNED_SOURCE_REQUIRED')
 rows=t['files'];need(type(rows)is list and len(rows)==len(LIMITS)and{r.get('file')for r in rows if type(r)is dict}==set(LIMITS),'EXACT_STAGED_FILE_SET_REQUIRED');data={};packed_total=0
 for r in rows:
  need(set(r)=={'file','bytes','sha256','packedFile','packedBytes','packedSha256'},'EXACT_TRANSPORT_ROW_REQUIRED');name=r['file'];need(type(r['bytes'])is int and 0<r['bytes']<=LIMITS[name]and type(r['packedBytes'])is int and 0<r['packedBytes']<=4*MIB and r['packedFile']==name+'.gz'and hex64(r['sha256'])and hex64(r['packedSha256']),'BOUNDED_TRANSPORT_ROW_REQUIRED')
  packed=read(directory/r['packedFile'],4*MIB,uid);need(len(packed)==r['packedBytes']and sha(packed)==r['packedSha256'],'PACKED_SOURCE_HASH_REQUIRED');packed_total+=len(packed);need(packed_total<=12*MIB,'PACKED_AGGREGATE_BOUND')
  with gzip.GzipFile(fileobj=io.BytesIO(packed),mode='rb')as z:body=z.read(r['bytes']+1)
  need(len(body)==r['bytes']and sha(body)==r['sha256'],'RAW_SOURCE_HASH_REQUIRED');data[name]=body
 need(sum(map(len,data.values()))<=16*MIB and sha(data['index.json'])==t['indexSha256'],'STAGED_AGGREGATE_AND_INDEX_REQUIRED')
 index=json.loads(data['index.json']);need(index.get('schemaVersion')==1 and index.get('kind')=='poe-original-cutover-package-v1'and index.get('sourceCommit')==source['commit'],'CUTOVER_INDEX_BINDING_REQUIRED');indexed=index.get('files');need(type(indexed)is list and len(indexed)==len(LIMITS)-1 and{r.get('file')for r in indexed if type(r)is dict}==set(LIMITS)-{'index.json'},'EXACT_INDEX_FILE_SET_REQUIRED')
 for r in indexed:need(set(r)=={'file','bytes','sha256'}and r['bytes']==len(data[r['file']])and r['sha256']==sha(data[r['file']]),'INDEXED_BYTE_PROOF_REQUIRED')
 need(sha(data['native-paper.mjs'])==source['sha256'],'FROZEN_NATIVE_EXECUTABLE_REQUIRED');return t,data
def stage(data,target,uid):
 need(available_bytes(target.parent)>=512*MIB+sum(map(len,data.values())),'FINANCIAL_DISK_HEADROOM_REQUIRED')
 if not target.exists():target.mkdir(mode=0o700)
 s=target.lstat();need(stat.S_ISDIR(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o700 and target.resolve(strict=True)==target,'PRIVATE_CANONICAL_STAGE_REQUIRED');need(set(p.name for p in target.iterdir())<=set(data),'UNRELATED_STAGE_FILES_PRESERVED_REFUSAL')
 written=[]
 for name,body in data.items():
  p=target/name
  if p.exists()or p.is_symlink():need(read(p,LIMITS[name],uid,True)==body,'EXISTING_STAGE_BYTES_MUST_MATCH');continue
  need(available_bytes(target)>=512*MIB+len(body),'FINANCIAL_DISK_HEADROOM_REQUIRED')
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:
   pos=0
   while pos<len(body):pos+=os.write(fd,body[pos:])
   os.fsync(fd)
  finally:os.close(fd)
  written.append(name)
 need(available_bytes(target)>=512*MIB,'FINANCIAL_DISK_HEADROOM_REQUIRED')
 for name,body in data.items():need(read(target/name,LIMITS[name],uid,True)==body,'STAGED_READBACK_HASH_REQUIRED')
 fd=os.open(target,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
 return written
def observer():
 r=subprocess.run(['/usr/bin/systemctl','show','poe-runtime.service','--property=MainPID,NRestarts,User,ActiveState,SubState'],capture_output=True,text=True,timeout=5,check=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});need(len(r.stdout)<=4096,'ORIGINAL_SERVICE_METADATA_BOUND');v=dict(line.split('=',1)for line in r.stdout.splitlines()if'='in line);need(v.get('User')=='poe-runtime'and v.get('ActiveState')=='active'and v.get('SubState')=='running'and int(v.get('MainPID','0'))>0,'ORIGINAL_SERVICE_MUST_REMAIN_RUNNING');return v
def main():
 need(len(os.sys.argv)==1 and os.getuid()==UID and pwd.getpwuid(UID).pw_name=='mm-ec2-runner'and os.environ.get('ACTUAL_RUNNER')=='meme-machine-ec2-admin','FIXED_NONROOT_STAGING_ONLY');os.umask(0o077);before=observer();t,data=prepare(INPUT,os.environ.get('EXPECTED_ORIGINAL_TRANSPORT_SHA256'),UID);written=stage(data,OUTPUT,UID);after=observer();need(before==after,'ORIGINAL_SERVICE_CHANGED_DURING_STAGING')
 print(json.dumps({'kind':'POE_ORIGINAL_UPGRADE_STAGED_NOT_INSTALLED','stagedAt':int(time.time()*1000),'directory':str(OUTPUT),'source':t['source'],'indexSha256':t['indexSha256'],'transportSha256':os.environ['EXPECTED_ORIGINAL_TRANSPORT_SHA256'],'files':[{'file':n,'bytes':len(b),'sha256':sha(b)}for n,b in sorted(data.items())],'newFilesWritten':written,'serviceBefore':before,'serviceAfter':after,'originalServiceUnchanged':True,'financialDatabaseOpened':False,'originalLedgerAudited':False,'serviceChanged':False,'providerRequests':0,'credentialsRead':False,'executedUpgrade':False},separators=(',',':')),flush=True)
if __name__=='__main__':
 try:main()
 except(Guard,OSError,ValueError,subprocess.SubprocessError)as e:print(json.dumps({'kind':'POE_ORIGINAL_UPGRADE_STAGING_REFUSED','reason':str(e)if isinstance(e,Guard)else'LOCAL_STAGING_PRECONDITION_UNAVAILABLE','executedUpgrade':False,'serviceChanged':False,'financialDatabaseOpened':False}),flush=True);raise SystemExit(1)
