#!/usr/bin/env python3
"""Reporting-only hotfix. No service control, financial DB open, or secret read.

The running original supervisor retries its existing publisher path. Replace only
that artifact and its startup hash, preserving an exact, recoverable before-image.
"""
import fcntl,grp,hashlib,json,os,pathlib,pwd,stat,subprocess,sys,time

SOURCE='5e55d8b939de99698ddb311a282461931fcbc957'
ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION='2026-10-26T22:07:36.212Z'
OLD='4d80782c1cf6d31aec51c56f088283360f2f90760dd7489d621bbe124cb3df3f'
NEW='2f6e041872681a2dd5c978cfa8addff0fb3619da56e105c94734a8420a6580fa'
OLD_MANIFEST='8a5b08b27a313a5efc8fb8b15f091f43f3dc639cb1ca0155ab36b8a09cc18555'
FINANCIAL='531012e82b6cb86149350ec4478c1f7a7b87b6f35f08f3b1f32447f05cd31eaa'
SUPERVISOR='d90ea175e17ef165afc8a4dcc24ab302204d500aad738bd4554cdc5f32e3d6fb'
REPORTER_SOURCE='5735db2ca8abc6af6f99bb0ad855c19cdebaf864'
RELEASE=pathlib.Path('/opt/poe/releases')/SOURCE
MANIFEST=pathlib.Path('/etc/poe/native-engine.json')
BACKUP=pathlib.Path('/etc/poe/cutovers')/SOURCE/'reporting-credential-v1'
STAGE=pathlib.Path('/var/tmp/poe-original-publisher-credential-v2-20261029')
PUBLIC=pathlib.Path('/var/lib/poe-public')
LEDGER=pathlib.Path('/var/lib/poe/state/ledger.sqlite')
ACTIVE={}
class Guard(RuntimeError):pass
def need(v,code):
 if not v:raise Guard(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def directory(p,uid):
 s=p.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==uid and not s.st_mode&0o022 and p.resolve(strict=True)==p,'SAFE_CANONICAL_DIRECTORY_REQUIRED')
def read(p,uid,maximum=131072):
 directory(p.parent,uid if uid==994 else 0) if p.parent==STAGE else need(p.parent.resolve(strict=True)==p.parent,'CANONICAL_PARENT_REQUIRED')
 f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(f);need(stat.S_ISREG(s.st_mode)and s.st_uid==uid and s.st_nlink==1 and not s.st_mode&0o022 and 0<s.st_size<=maximum,'BOUNDED_OWNER_FILE_REQUIRED');b=os.read(f,s.st_size+1);a=os.fstat(f)
  need(len(b)==s.st_size and(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns),'FILE_CHANGED_DURING_READ');return b
 finally:os.close(f)
def syncdir(p):
 f=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(f)
 finally:os.close(f)
def atomic(p,b,gid=0,mode=0o600):
 need(not os.path.lexists(p)or stat.S_ISREG(p.lstat().st_mode)and p.lstat().st_uid==0 and p.lstat().st_nlink==1,'ROOT_OUTPUT_REQUIRED')
 temp=p.with_name('.'+p.name+'.'+str(os.getpid())+'.pending');f=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  pos=0
  while pos<len(b):pos+=os.write(f,b[pos:])
  os.fchown(f,0,gid);os.fchmod(f,mode);os.fsync(f)
 finally:os.close(f)
 os.replace(temp,p);syncdir(p.parent)
def unit():
 r=subprocess.run(['/usr/bin/systemctl','show','poe-runtime.service','--property=MainPID,NRestarts,User,Group,ActiveState,SubState'],capture_output=True,text=True,timeout=5,check=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});need(len(r.stdout)<=4096,'UNIT_METADATA_BOUND');v=dict(l.split('=',1)for l in r.stdout.splitlines()if'='in l)
 need(v.get('User')=='poe-runtime'and v.get('Group')=='poe-runtime'and v.get('ActiveState')=='active'and v.get('SubState')=='running'and int(v.get('MainPID','0'))>0,'EXISTING_ORIGINAL_NATIVE_SERVICE_REQUIRED');return v
def runtime_owner():
 owner=pwd.getpwnam('poe-runtime');group=grp.getgrnam('poe-runtime')
 need(owner.pw_uid>0 and owner.pw_gid>0 and owner.pw_gid==group.gr_gid and pwd.getpwuid(owner.pw_uid).pw_name=='poe-runtime'and grp.getgrgid(group.gr_gid).gr_name=='poe-runtime','ORIGINAL_NAMED_RUNTIME_IDENTITY_REQUIRED');return owner.pw_uid,owner.pw_gid
def runtime_process(pid,uid,gid):
 p=pathlib.Path('/proc')/str(pid);need(p.stat().st_uid==uid,'ORIGINAL_SUPERVISOR_OWNER_REQUIRED')
 with(p/'status').open('rb')as f:raw=f.read(32769)
 need(len(raw)<=32768,'SUPERVISOR_STATUS_BOUND');values={line.split(':',1)[0]:line.split(':',1)[1].split()for line in raw.decode().splitlines()if line.startswith(('Uid:','Gid:'))}
 need(values.get('Uid')==[str(uid)]*4 and values.get('Gid')==[str(gid)]*4,'ORIGINAL_SUPERVISOR_CREDENTIALS_REQUIRED')
 return{'uid':uid,'gid':gid,'pid':int(pid)}
def reporting_permissions(path,gid):
 s=path.lstat();need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_gid==gid and stat.S_IMODE(s.st_mode)==0o640 and s.st_nlink==1,'ORIGINAL_ROOT_RUNTIME_REPORTING_PERMISSIONS_REQUIRED');return s.st_gid,stat.S_IMODE(s.st_mode)
def build_manifest(original,body):
 need(sha(original)==OLD_MANIFEST and sha(body)==NEW,'EXACT_REPAIR_INPUTS_REQUIRED');v=json.loads(original)
 need(v.get('source')=={'commit':SOURCE,'sha256':FINANCIAL}and v.get('strategy')=='persistent-buying-pilot-v1','FROZEN_FINANCIAL_SOURCE_REQUIRED')
 rows=[r for r in v['files']if r['file']=='snapshot-publisher.mjs'];need(len(rows)==1 and rows[0]=={'file':'snapshot-publisher.mjs','bytes':28874,'sha256':OLD},'EXACT_OLD_REPORTER_ROW_REQUIRED');rows[0].update(bytes=len(body),sha256=NEW)
 return(json.dumps(v,indent=2)+'\n').encode()
def repair_body():
 body=read(BACKUP/'after-publisher.mjs',0,65536)if os.path.lexists(BACKUP/'after-publisher.mjs')else read(STAGE/'snapshot-publisher.mjs',994,65536)
 need(sha(body)==NEW,'PINNED_NEW_REPORTER_REQUIRED');return body
def assert_identity(v):need(v.get('accountId')==ACCOUNT and v.get('inceptionAt')==INCEPTION,'ORIGINAL_ACCOUNT_IDENTITY_REQUIRED')
def selected_diagnostics(uid):
 result={}
 for name,path,keys in[
  ('health',pathlib.Path('/var/lib/poe/service/health.json'),['generatedAt','sourcePid','publisherPid','lastAcceptedSourceAt','matchedSourceAcknowledgements','outputErrors','resource']),
  ('publicStatus',PUBLIC/'status.json',['generatedAt','release','strategy','entriesDisabled','flowVerified','shortlistCount','feedConnected','blocker'])]:
  try:
   v=json.loads(read(path,uid));need(v.get('accountId')==ACCOUNT,'DIAGNOSTIC_ACCOUNT_REQUIRED');result[name]={k:v.get(k)for k in keys}
  except Exception:result[name]={'available':False}
 counts={k:0 for k in['PRIVATE_PUBLISHER_FILE','ORIGINAL_PUBLISHER_CREDENTIAL_FORMAT','EACCES','EPERM','ENOENT','ERR_ACCESS_DENIED','PUBLISHER_STARTUP_UNAVAILABLE']}
 try:
  b=read(pathlib.Path('/var/lib/poe/service/diagnostics/publisher-0.log'),uid,1048576)
  for line in b.splitlines():
   try:v=json.loads(line)
   except ValueError:continue
   if type(v)is dict and v.get('kind')=='POE_ORIGINAL_PUBLISHER_UNAVAILABLE'and v.get('reasonCode')in counts:counts[v['reasonCode']]+=1
  result['publisherFailureCounts']=counts
 except Exception:result['publisherFailureCounts']={'available':False}
 return result
def main():
 need(os.getuid()==0 and len(sys.argv)==2 and sys.argv[1]in['apply','rollback-reporting'],'EXACT_ROOT_REPORTING_ACTION_REQUIRED');os.umask(0o077)
 for p in[RELEASE,MANIFEST.parent,BACKUP.parent,PUBLIC]:directory(p,0 if p!=PUBLIC else pwd.getpwnam('poe-runtime').pw_uid)
 need(pathlib.Path('/opt/poe/current').resolve(strict=True)==RELEASE,'CURRENT_FINANCIAL_RELEASE_REQUIRED');uid,gid=runtime_owner()
 lock=os.open(MANIFEST.parent/'cutover.owner.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  ls=os.fstat(lock);need(stat.S_ISREG(ls.st_mode)and ls.st_uid==0 and ls.st_nlink==1 and stat.S_IMODE(ls.st_mode)==0o600,'ROOT_MAINTENANCE_LOCK_REQUIRED');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  before=unit();identity=runtime_process(before['MainPID'],uid,gid);permissions={p:reporting_permissions(p,gid)for p in[RELEASE/'snapshot-publisher.mjs',MANIFEST]};need(sha(read(RELEASE/'operator/native-paper-ec2/run-authoritative-service.py',0))==SUPERVISOR,'UNCHANGED_SUPERVISOR_REQUIRED')
  ledger=LEDGER.lstat();need(stat.S_ISREG(ledger.st_mode)and ledger.st_uid==uid and ledger.st_nlink==1 and stat.S_IMODE(ledger.st_mode)==0o600,'EXISTING_FINANCIAL_LEDGER_REQUIRED');ledger_inode=(ledger.st_dev,ledger.st_ino)
  public=json.loads(read(PUBLIC/'status.json',uid,4096));assert_identity(public);need(public.get('release')==SOURCE,'CURRENT_PUBLIC_SOURCE_REQUIRED')
  original=read(MANIFEST,0);current=read(RELEASE/'snapshot-publisher.mjs',0)
  # Root-owned after-images make both repair resumption and rollback independent
  # of the disposable runner staging directory after the first installation.
  body=repair_body()
  if not BACKUP.exists():
   need(sha(original)==OLD_MANIFEST and sha(current)==OLD,'EXACT_UNMODIFIED_BEFORE_IMAGE_REQUIRED');need(sys.argv[1]=='apply','BACKUP_REQUIRED_FOR_ROLLBACK');space=os.statvfs(BACKUP.parent);need(space.f_bavail*space.f_frsize>=512*1048576,'FINANCIAL_DISK_HEADROOM_REQUIRED');BACKUP.mkdir(mode=0o700);syncdir(BACKUP.parent)
  directory(BACKUP,0)
  for name,b,expected in[('before-service.json',original,OLD_MANIFEST),('before-publisher.mjs',current,OLD)]:
   p=BACKUP/name
   if not p.exists():need(sha(b)==expected,'BEFORE_IMAGE_NOT_RECONSTRUCTABLE');atomic(p,b)
   need(sha(read(p,0))==expected,'RETAINED_BEFORE_IMAGE_CHANGED')
  old_manifest=read(BACKUP/'before-service.json',0);old_body=read(BACKUP/'before-publisher.mjs',0);new_manifest=build_manifest(old_manifest,body)
  driver_path=pathlib.Path(__file__);driver_uid=0 if driver_path==BACKUP/'repair-original-publisher.py'else 994;need(driver_path in[STAGE/'repair-original-publisher.py',BACKUP/'repair-original-publisher.py'],'FIXED_REPAIR_DRIVER_PATH_REQUIRED');driver=read(driver_path,driver_uid);need(sha(driver)==globals().get('__poe_verified_driver_sha256__'),'REVIEWED_REPAIR_DRIVER_REQUIRED')
  for name,b in[('after-publisher.mjs',body),('after-service.json',new_manifest),('repair-original-publisher.py',driver)]:
   p=BACKUP/name
   if not p.exists():atomic(p,b)
   need(read(p,0)==b,'RETAINED_REPAIR_IMAGE_CHANGED')
  need(original in[old_manifest,new_manifest]and sha(current)in[OLD,NEW],'UNREVIEWED_REPORTING_CHANGE_REFUSED')
  for row in json.loads(old_manifest)['files']:
   if row['file']!='snapshot-publisher.mjs':need(sha(read(RELEASE/row['file'],0,8388608))==row['sha256'],'UNCHANGED_FINANCIAL_RELEASE_REQUIRED')
  goal_body,goal_manifest=(body,new_manifest)if sys.argv[1]=='apply'else(old_body,old_manifest)
  at=int(time.time()*1000);record={'kind':'POE_ORIGINAL_REPORTING_ONLY_REPAIR','at':at,'action':sys.argv[1],'financialSource':SOURCE,'reporterSource':REPORTER_SOURCE,'repairDriverSha256':sha(driver),'runtimeIdentity':identity,'beforePublisherSha256':sha(current),'afterPublisherSha256':sha(goal_body),'beforeManifestSha256':sha(original),'afterManifestSha256':sha(goal_manifest),'accountId':ACCOUNT,'inceptionAt':INCEPTION,'serviceBefore':before,'financialDatabaseOpened':False,'financialHistoryReset':False,'serviceControlOperations':0,'credentialContentsRead':False,'phase':'before-images-verified'}
  record_path=BACKUP/('transition-'+str(at)+'.json');ACTIVE.update(record=record,recordPath=str(record_path));save=lambda:atomic(record_path,(json.dumps(record,indent=2)+'\n').encode());save()
  # A crash between these two atomic replacements is recoverable by this same
  # hash-pinned command. Keep the pair adjacent; never roll financial state back.
  need(unit()==before,'SERVICE_CHANGED_BEFORE_REPORTING_REPLACEMENT');runtime_process(before['MainPID'],uid,gid)
  for p,expected in permissions.items():need(reporting_permissions(p,gid)==expected,'REPORTING_PERMISSIONS_CHANGED_BEFORE_REPLACEMENT')
  atomic(RELEASE/'snapshot-publisher.mjs',goal_body,*permissions[RELEASE/'snapshot-publisher.mjs']);record['phase']='reporter-replaced';atomic(MANIFEST,goal_manifest,*permissions[MANIFEST]);record['phase']='reporter-and-future-start-manifest-verified';save()
  for p,expected in permissions.items():need(reporting_permissions(p,gid)==expected,'INSTALLED_REPORTING_PERMISSIONS_CHANGED')
  need(read(MANIFEST,0)==goal_manifest and read(RELEASE/'snapshot-publisher.mjs',0)==goal_body,'INSTALLED_REPORTING_HASH_REQUIRED');need((LEDGER.lstat().st_dev,LEDGER.lstat().st_ino)==ledger_inode,'ORIGINAL_LEDGER_INODE_CHANGED');after=unit();need(after==before,'SERVICE_IDENTITY_CHANGED_DURING_REPORTING_REPAIR');record.update(serviceAfter=after,financialLedgerInodeUnchanged=True,diagnostics=selected_diagnostics(uid));save()
  # No extra publisher is started. The original supervisor's bounded retry owns
  # recovery. Observe two distinct accepted source timestamps for at most 95s.
  accepted={};end=time.monotonic()+(95 if sys.argv[1]=='apply'else 0)
  while time.monotonic()<end:
   try:
    v=json.loads(read(PUBLIC/'accepted-source.json',uid,4096));assert_identity(v)
    if v.get('source',{}).get('commit')==SOURCE and type(v.get('sourceAtMs'))is int and at<=v['sourceAtMs']<=int(time.time()*1000)+5000:accepted[v['sourceAtMs']]={k:v.get(k)for k in['sourceAtMs','sequence','fingerprint','rawSourceSha256','acknowledgedAtMs','acceptedDistinctSourcesThisSupervisor']}
   except Exception:pass
   if len(accepted)>=2:break
   time.sleep(1)
  final_unit=unit();record.update(phase=('reporting-two-source-acknowledgements-verified'if len(accepted)>=2 else'reporting-installed-delivery-not-yet-verified')if sys.argv[1]=='apply'else'reporting-disk-rollback-installed-current-publisher-not-restarted',acceptedSources=list(accepted.values()),diagnostics=selected_diagnostics(uid),serviceAfterObservation=final_unit,sameSupervisor=final_unit['MainPID']==before['MainPID'],operationalAcceptance=False);save()
  public_record=(json.dumps(record,separators=(',',':'))+'\n').encode();need(len(public_record)<=16384,'PUBLIC_REPORTING_RECEIPT_BOUND');atomic(PUBLIC/'reporting-repair.json',public_record,0,0o644);print(public_record.decode(),end='',flush=True)
  need(record['sameSupervisor'],'REPORTING_INSTALLED_SUPERVISOR_CHANGED_DURING_OBSERVATION')
  if sys.argv[1]=='apply':need(len(accepted)>=2,'REPORTING_INSTALLED_TWO_SOURCE_DELIVERY_NOT_YET_VERIFIED')
 finally:os.close(lock)
if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e)if isinstance(e,Guard)else'LOCAL_REPORTING_REPAIR_PRECONDITION_UNAVAILABLE';print(json.dumps({'kind':'POE_ORIGINAL_REPORTING_REPAIR_REFUSED','reasonCode':code,'lastCompletedPhase':ACTIVE.get('record',{}).get('phase'),'durableTransitionRecord':ACTIVE.get('recordPath'),'recovery':'rerun the same hash-verified repair command; preserve financial manager and before-images','financialDatabaseOpened':False,'serviceControlOperations':0,'financialHistoryReset':False}),flush=True);raise SystemExit(1)
