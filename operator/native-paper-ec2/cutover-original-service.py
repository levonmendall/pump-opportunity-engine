#!/usr/bin/env python3
"""Owner/root-only, fixed-account POE cutover. Never initializes/restores a ledger.

The root-owned package is prepared/reviewed before this command is used. This
file deliberately provides no sudo installation, remote command, provider,
secret, financial import, or alternate account/path mechanism.
"""
import datetime,fcntl,hashlib,importlib.util,itertools,json,os,pathlib,pwd,sqlite3,stat,subprocess,sys,tempfile,time

HERE=pathlib.Path(__file__).resolve().parent
PACKAGE=pathlib.Path('/var/lib/poe-cutover/issue11')
INCOMING=pathlib.Path('/var/tmp/poe-issue11-staging')
TOOLS=pathlib.Path('/opt/poe/cutover/issue11')
ETC=pathlib.Path('/etc/poe')
RECORDS=ETC/'cutovers'
BACKUPS=pathlib.Path('/var/backups/poe')
ROOT=pathlib.Path('/var/lib/poe')
ACCOUNT=ROOT/'native-engine'
SERVICE=ROOT/'service'
LEDGER=ROOT/'state/ledger.sqlite'
RELEASES=pathlib.Path('/opt/poe/releases')
CURRENT=pathlib.Path('/opt/poe/current')
DROPIN=pathlib.Path('/etc/systemd/system/poe-runtime.service.d/90-native-engine.conf')
MANIFEST=ETC/'native-engine.json'
PUBLIC_STATUS=pathlib.Path('/var/lib/poe-public/status.json')
SERVICE_CGROUP=pathlib.Path('/sys/fs/cgroup/system.slice/poe-runtime.service/cgroup.procs')
ORIGINAL='bce3d22bb434eb429aafacb788a18f39ec189c1b'
ACCOUNT_ID='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION=1793052456212
MIB=1024*1024
EXTRA={'input.json':MIB,'research-baseline.json':512*1024,'service.json':128*1024,'run-authoritative-service.py':128*1024,'poe-runtime-persistent.conf':8192,'original-status.json':4096,'audit-original-account.py':128*1024,'cutover-original-service.py':128*1024}
class Refused(RuntimeError):pass
def need(value,reason):
 if not value:raise Refused(reason)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def hashed(value,length=64):return type(value)is str and len(value)==length and all(c in'0123456789abcdef'for c in value)
def directory(path,uid,private=False):
 s=path.lstat();need(stat.S_ISDIR(s.st_mode)and not stat.S_ISLNK(s.st_mode)and path.resolve(strict=True)==path and s.st_uid==uid and not s.st_mode&(0o077 if private else 0o022),'CANONICAL_OWNER_DIRECTORY_REQUIRED')
def read(path,limit,uid=0):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and not s.st_mode&0o022 and 0<s.st_size<=limit,'BOUNDED_OWNER_FILE_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(raw)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'INPUT_CHANGED_DURING_READ');return raw
 finally:os.close(fd)
def atomic(path,raw,uid,gid,mode=0o600):
 need(type(raw)is bytes and len(raw)<=16*MIB,'BOUNDED_ATOMIC_BYTES_REQUIRED')
 try:
  s=path.lstat();need(stat.S_ISREG(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_nlink==1 and s.st_uid==uid,'OWNED_OUTPUT_REQUIRED')
 except FileNotFoundError:pass
 tmp=path.with_name('.'+path.name+'.'+str(os.getpid())+'.pending');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  os.fchown(fd,uid,gid);os.fchmod(fd,mode);pos=0
  while pos<len(raw):pos+=os.write(fd,raw[pos:])
  os.fsync(fd)
 finally:os.close(fd)
 os.replace(tmp,path);syncdir(path.parent)
def syncdir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def write_json(path,value):
 raw=(json.dumps(value,separators=(',',':'))+'\n').encode()
 if path.name=='transition.json':
  rows=list(path.parent.glob('phase-*.json'));need(len(rows)<64,'CUTOVER_PHASE_RECORD_BOUND');receipt=path.with_name('phase-'+str(len(rows)).zfill(2)+'-'+sha(raw)[:16]+'.json');need(not receipt.exists(),'APPEND_ONLY_PHASE_RECEIPT_REQUIRED');atomic(receipt,raw,0,0)
 atomic(path,raw,0,0)
def make_dir(path,uid,gid,mode):
 if not path.exists():path.mkdir(mode=mode);os.chown(path,uid,gid);os.chmod(path,mode);syncdir(path.parent)
 directory(path,uid,private=mode==0o700)
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
def systemctl(*args):
 r=subprocess.run(['/usr/bin/systemctl',*args],capture_output=True,text=True,timeout=75,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False);need(len(r.stdout)<=16384 and len(r.stderr)<=16384,'SYSTEMD_RESPONSE_BOUND');need(r.returncode==0,'ORIGINAL_SYSTEMD_OPERATION_FAILED');return r.stdout
def original_audit(auditor,expected_inode=None):
 uid=pwd.getpwnam('poe-runtime').pw_uid;need(LEDGER.resolve(strict=True)==LEDGER,'CANONICAL_ORIGINAL_LEDGER_REQUIRED');meta=auditor.file_metadata(LEDGER,uid,True);need(meta['exists'],'EXISTING_ORIGINAL_LEDGER_REQUIRED');identity=(meta['device'],meta['inode']);need(expected_inode is None or identity==expected_inode,'ORIGINAL_LEDGER_INODE_CHANGED')
 for suffix in['-wal','-shm','-journal']:auditor.file_metadata(pathlib.Path(str(LEDGER)+suffix),uid,True)
 fd=os.open(LEDGER,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  fs=os.fstat(fd);need((fs.st_dev,fs.st_ino)==identity,'ORIGINAL_LEDGER_OPEN_IDENTITY_CHANGED')
  with auditor.original_owner(uid,pwd.getpwnam('poe-runtime').pw_gid):
   db=sqlite3.connect('file:'+str(LEDGER)+'?mode=ro',uri=True,timeout=1)
   try:result=auditor.audit_snapshot(db)
   finally:db.close()
  after=LEDGER.lstat();need((after.st_dev,after.st_ino)==identity,'ORIGINAL_LEDGER_INODE_CHANGED');return result
 finally:os.close(fd)
def financial_rollback_equivalent(before,after):
 # Controls, reconciliation revision and metadata may advance. Any changed
 # money/cost/realization/exposure forbids the observer-only management rollback.
 keys=['accountId','inceptionAt','initialMicroUsd','inceptionPriceSha256','inceptionLamports','roundingResidualMicroUsd','cashLamports','reservedLamports','lockedDepositLamports','openPositions','pendingActions','positionsStateSha256','pendingStateSha256','realizedLamports','executionCostsLamports','gasReserveLamports']
 return before.get('flatAtSnapshot')is True and after.get('flatAtSnapshot')is True and before.get('lockedDepositLamports')=='0'and after.get('lockedDepositLamports')=='0' and all(before.get(k)==after.get(k)for k in keys)
def validate_input(value,manifest,baseline):
 need(type(value)is dict and value.get('schemaVersion')==1 and value.get('source')==manifest['source']and value.get('dataContract')=='confirmed-program-activity-v3-shadow','PINNED_NATIVE_INPUT_REQUIRED')
 need(value.get('baselinePaths')==[str(ACCOUNT/'research-baseline.json')]and value.get('baselineCheckpointSha256')==sha(baseline)and value.get('priorPhysicalSettled')is True,'ORIGINAL_UID_SEALED_ACCOUNTING_ANCHOR_REQUIRED')
 binding=value.get('reportingBinding');need(type(binding)is dict and binding.get('accountId')==ACCOUNT_ID and binding.get('inceptionAt')==INCEPTION and hashed(binding.get('sourceStatusSha256')),'ORIGINAL_STATUS_BINDING_REQUIRED')
 need(type(value.get('priorCooldownUntil'))is int and value['priorCooldownUntil']>=0 and type(value.get('origins'))is list and len(value['origins'])<=174,'BOUNDED_ORIGIN_INPUT_REQUIRED')
 cp=json.loads(baseline);need(cp.get('kind')=='poe-research-baseline-checkpoint'and cp.get('schemaVersion')==1 and cp.get('physicalSettlement',{}).get('physicalTransportsSettled')is True,'SEALED_BASELINE_REQUIRED')
 return value
def package(expected_hash,supervisor):
 directory(PACKAGE,0,True);raw=read(PACKAGE/'index.json',128*1024);need(hashed(expected_hash)and sha(raw)==expected_hash,'REVIEWED_PACKAGE_INDEX_HASH_REQUIRED');index=json.loads(raw)
 need(type(index)is dict and set(index)=={'schemaVersion','kind','sourceCommit','files'}and index['schemaVersion']==1 and index['kind']=='poe-original-cutover-package-v1'and hashed(index['sourceCommit'],40),'CUTOVER_PACKAGE_IDENTITY_REQUIRED')
 maximum={**supervisor.RELEASE_FILES,**EXTRA};rows=index['files'];need(type(rows)is list and len(rows)==len(maximum)and{r.get('file')for r in rows if type(r)is dict}==set(maximum),'EXACT_PACKAGE_FILES_REQUIRED');data={}
 for row in rows:
  name=row['file'];need(set(row)=={'file','bytes','sha256'}and type(row['bytes'])is int and 0<row['bytes']<=maximum[name]and hashed(row['sha256']),'BOUNDED_PACKAGE_ROW_REQUIRED');body=read(PACKAGE/name,maximum[name]);need(len(body)==row['bytes']and sha(body)==row['sha256'],'PACKAGE_FILE_HASH_REQUIRED');data[name]=body
 manifest=supervisor.validate_manifest(json.loads(data['service.json']));need(manifest['source']['commit']==index['sourceCommit'],'ONE_RELEASE_IDENTITY_REQUIRED')
 for row in manifest['files']:need(row['bytes']==len(data[row['file']])and row['sha256']==sha(data[row['file']]),'SERVICE_RELEASE_HASH_REQUIRED')
 validate_input(json.loads(data['input.json']),manifest,data['research-baseline.json']);metadata=json.loads(data['metadata.json']);need(metadata.get('git',{}).get('commit')==index['sourceCommit']and metadata.get('financialMode')=='PAPER'and metadata.get('liveTradingEnabled')is False,'PAPER_METADATA_REQUIRED');return index,manifest,data
def lease():
 path=pathlib.Path(str(LEDGER)+'.owner.lock');uid=pwd.getpwnam('poe-runtime').pw_uid;need(path.resolve(strict=True)==path,'CANONICAL_OWNER_LEASE_REQUIRED');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);named=path.lstat();need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o600 and(s.st_dev,s.st_ino)==(named.st_dev,named.st_ino),'ORIGINAL_FINANCIAL_OWNER_LEASE_REQUIRED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BaseException:os.close(fd);raise
 return fd
def snapshot_backup(path,auditor,expected):
 need(not path.exists()and not path.is_symlink(),'BACKUP_MUST_BE_NEW');owner=pwd.getpwnam('poe-runtime');temporary=None
 # Every SQLite operation against the original source runs as its legitimate
 # owner. A new same-owner temporary backup is validated/closed before root
 # freezes exact bytes; root never creates the original ledger's WAL/SHM.
 with auditor.original_owner(owner.pw_uid,owner.pw_gid):
  temporary=pathlib.Path(tempfile.mkdtemp(prefix='poe-original-backup-'));os.chmod(temporary,0o700);copied=temporary/'ledger.sqlite';src=sqlite3.connect('file:'+str(LEDGER)+'?mode=ro',uri=True,timeout=1);dest=sqlite3.connect(copied)
  try:
   src.backup(dest);dest.commit();need(dest.execute('PRAGMA journal_mode=DELETE').fetchone()==('delete',),'SINGLE_FILE_RECOVERY_BACKUP_REQUIRED');observed=auditor.audit_snapshot(dest);need(expected is None or observed==expected,'BACKUP_EXACT_FINANCIAL_STATE_REQUIRED')
  finally:dest.close();src.close()
  os.chmod(copied,0o600)
 raw=read(copied,128*MIB,owner.pw_uid);created=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  offset=0
  while offset<len(raw):
   count=os.write(created,raw[offset:]);need(count>0,'FROZEN_BACKUP_WRITE_UNAVAILABLE');offset+=count
  os.fsync(created)
 finally:os.close(created)
 syncdir(path.parent);need(read(path,128*MIB)==raw,'FROZEN_BACKUP_BYTES_CHANGED')
 with auditor.original_owner(owner.pw_uid,owner.pw_gid):
  need(list(temporary.iterdir())==[copied],'TEMPORARY_BACKUP_AUXILIARY_UNSETTLED');copied.unlink();temporary.rmdir()
 return{'file':str(path),'bytes':len(raw),'sha256':sha(raw),'financial':observed,'restorePerformed':False,'sourceSqliteOwnerUid':owner.pw_uid,'temporaryCopyFrozen':True}
def switch_current(target):
 need(target.parent==RELEASES and target.resolve(strict=True)==target,'EXACT_RELEASE_TARGET_REQUIRED');temporary=CURRENT.with_name('.current-'+str(os.getpid()));need(not temporary.exists()and not temporary.is_symlink(),'NO_PENDING_RELEASE_LINK');temporary.symlink_to(target);os.replace(temporary,CURRENT);syncdir(CURRENT.parent)
def validate_host(auditor,supervisor):
 need(os.getuid()==0,'EXISTING_OWNER_ROOT_ACCESS_REQUIRED');os.umask(0o077);uid=pwd.getpwnam('poe-runtime').pw_uid;gid=pwd.getpwnam('poe-runtime').pw_gid;need(uid!=0,'ORIGINAL_NONROOT_OWNER_REQUIRED')
 supervisor.verify_host()
 for p in[ETC,RELEASES,CURRENT.parent]:directory(p,0)
 for p in[ROOT,LEDGER.parent]:directory(p,uid,True)
 for p in[HERE/'audit-original-account.py',HERE/'run-authoritative-service.py',pathlib.Path('/usr/bin/flock')]:need(stat.S_ISREG(p.lstat().st_mode)and p.lstat().st_uid==0 and not p.lstat().st_mode&0o022,'REVIEWED_ROOT_CODE_AND_EXISTING_FLOCK_REQUIRED')
 need(os.access('/usr/bin/flock',os.X_OK),'EXISTING_FLOCK_EXECUTABLE_REQUIRED');node=pathlib.Path('/opt/poe/node/bin/node')
 for folder in[node.parent,node.parent.parent]:directory(folder,0)
 ns=node.lstat();need(stat.S_ISREG(ns.st_mode)and ns.st_uid==0 and ns.st_nlink==1 and not ns.st_mode&0o022 and node.resolve(strict=True)==node and os.access(node,os.X_OK),'EXISTING_IMMUTABLE_NODE_REQUIRED')
 version=subprocess.run([str(node),'--print','JSON.stringify({version:process.version,modules:process.versions.modules})'],capture_output=True,text=True,timeout=5,check=True,user=uid,group=gid,extra_groups=[],env={'PATH':'/usr/bin:/bin','LANG':'C'});need(len(version.stdout)<=256 and len(version.stderr)<=256,'NODE_VERSION_RESPONSE_BOUND');nv=json.loads(version.stdout);need(nv.get('version')=='v24.19.0'and nv.get('modules')=='137','EXISTING_NODE24_ABI137_REQUIRED')
 need(CURRENT.is_symlink()and CURRENT.resolve(strict=True).parent==RELEASES,'EXISTING_RELEASE_LINK_REQUIRED');status=auditor.service_status();need(status.get('User')=='poe-runtime','EXISTING_ORIGINAL_SERVICE_REQUIRED');return uid,gid,status
def transition_input(prepared,stopped_at):
 need(type(stopped_at)is int and stopped_at>=INCEPTION,'ACTUAL_STOP_TIMESTAMP_REQUIRED');value=json.loads(prepared);before=value['priorCooldownUntil'];need(type(before)is int and before>=0,'PREPARED_PROVIDER_COOLDOWN_REQUIRED');value['priorCooldownUntil']=max(before,stopped_at+60000);raw=(json.dumps(value,separators=(',',':'))+'\n').encode();return raw,{'preparedInputSha256':sha(prepared),'installedInputSha256':sha(raw),'field':'priorCooldownUntil','preparedValue':before,'installedValue':value['priorCooldownUntil'],'actualOriginalStopVerifiedAt':stopped_at,'reason':'Original observer physical RPC starts are unknown; preserve one conservative rolling minute after its verified flat stop. No existing exposure is delayed.'}
def stopped_phase(operation,recover):
 """Release the DB lease before restarting the preserved financial owner."""
 owner=None
 try:
  systemctl('stop','poe-runtime.service');owner=lease();return operation()
 except BaseException:
  if owner is not None:os.close(owner);owner=None
  recover();raise
 finally:
  if owner is not None:os.close(owner)
def unit_stop_fields():
 fields={'LoadState','ActiveState','SubState','MainPID','ControlPID','ControlGroup','Job','Result','ExecMainCode','ExecMainStatus'};r=subprocess.run(['/usr/bin/systemctl','show','--all','poe-runtime.service','--property='+','.join(sorted(fields))],capture_output=True,text=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False);need(r.returncode==0 and len(r.stdout)<=8192 and len(r.stderr)<=4096,'FIXED_UNIT_STOP_METADATA_UNAVAILABLE');value={key:text for line in r.stdout.splitlines()for key,sep,text in[line.partition('=')]if sep and key in fields};need(set(value)==fields,'COMPLETE_UNIT_STOP_METADATA_REQUIRED');return value
def observe_stopped_writer():
 """Terminal unit state is distinct from physical financial-owner settlement."""
 evidence={'metadataAvailable':False,'financialOwnerLeaseHeldByCaller':True,'physicalWriterSettled':False,'gracefulStopClaimed':False}
 try:
  first=unit_stop_fields();evidence['unitBefore']=first
  try:
   fd=os.open(SERVICE_CGROUP,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:raw=os.read(fd,8193)
   finally:os.close(fd)
   need(len(raw)<=8192,'SERVICE_CGROUP_RESPONSE_BOUND');parts=raw.decode('ascii').split();need(all(p.isdigit()and int(p)>0 for p in parts)and len(parts)<=256,'SERVICE_CGROUP_PID_BOUND');pids=[int(p)for p in parts];group={'state':'present','pidCount':len(pids),'pids':pids[:32],'pidListTruncated':len(pids)>32}
  except FileNotFoundError:group={'state':'absent','pidCount':0,'pids':[],'pidListTruncated':False}
  second=unit_stop_fields();critical=['LoadState','ActiveState','SubState','MainPID','ControlPID','ControlGroup','Job'];stable=all(first[k]==second[k]for k in critical);terminal=(second['ActiveState'],second['SubState'])in[('inactive','dead'),('failed','failed')];valid_group=second['ControlGroup']in['','/system.slice/poe-runtime.service'];settled=stable and second['LoadState']=='loaded'and terminal and second['MainPID']=='0'and second['ControlPID']=='0'and second['Job']in['','0']and valid_group and group['pidCount']==0;evidence.update(metadataAvailable=True,unitAfter=second,cgroup=group,stable=stable,physicalWriterSettled=settled,terminalStateAccepted=terminal,meaning='A terminal failed unit can be physically settled; this does not certify a graceful shutdown. The same financial owner lease remains held and a fresh same-inode financial audit is still required.')
 except(OSError,ValueError,Refused,subprocess.SubprocessError):evidence['reason']='STOP_METADATA_OR_CGROUP_NOT_VERIFIED'
 return evidence
def historical_pid1_lifecycle(at):
 """Bounded manager-only prior lifecycle evidence; never required for cutover."""
 try:
  need(type(at)is int and at>=INCEPTION,'PRIOR_TRANSITION_TIMESTAMP_REQUIRED');r=subprocess.run(['/usr/bin/journalctl','--no-pager','--output=json','-n','40','--since','@'+str((at-120000)//1000),'--until','@'+str((at+300000)//1000),'-u','poe-runtime.service','_PID=1'],capture_output=True,text=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False);need(r.returncode==0 and len(r.stdout.encode())<=65536,'PRIOR_PID1_JOURNAL_UNAVAILABLE');rows=[]
  for line in r.stdout.splitlines():
   if not line or len(line)>8192:continue
   v=json.loads(line)
   if v.get('_PID')!='1':continue
   message=v.get('MESSAGE');unit=v.get('UNIT')or v.get('OBJECT_SYSTEMD_UNIT');
   if type(message)is not str or unit!='poe-runtime.service'and'poe-runtime.service'not in message:continue
   rows.append({'pid':1,'unit':'poe-runtime.service','timestamp':str(v.get('__REALTIME_TIMESTAMP',''))[:32],'message':message[:1000]})
  return{'available':True,'pid1Only':True,'rows':rows,'coverage':'At most 40 retained manager events in the bounded prior-attempt interval; absence is not proof that an event did not occur.'}
 except(OSError,ValueError,Refused,subprocess.SubprocessError):return{'available':False,'pid1Only':True,'reason':'PRIOR_MANAGER_JOURNAL_UNAVAILABLE','coverage':'Exact prior failure state remains unverified; fresh physical settlement and financial proof remain mandatory.'}
def publish_stop_observation(manifest,transition,proof,uid):
 value={'schemaVersion':1,'kind':'poe-original-upgrade-stop-observation-v1','accountId':ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','targetSource':manifest['source'],'previousRelease':ORIGINAL,'observedAt':int(time.time()*1000),'attempt':transition.get('retryNumber',0),'stopProof':proof,'complete':False,'operationalAcceptance':False};print(json.dumps(value,separators=(',',':')),flush=True)
 try:
  folder=PUBLIC_STATUS.parent;directory(folder,uid);need(stat.S_IMODE(folder.lstat().st_mode)==0o755,'EXISTING_PUBLIC_STATUS_DIRECTORY_REQUIRED');raw=(json.dumps(value,separators=(',',':'))+'\n').encode();need(len(raw)<=4096,'PUBLIC_STOP_PROOF_BOUND');atomic(folder/'upgrade-verification.json',raw,0,0,0o644)
 except(OSError,Refused):pass
def upgrade(expected_hash,auditor,supervisor,resume=False,repair_sha=None):
 uid,gid,status=validate_host(auditor,supervisor);index,manifest,data=package(expected_hash,supervisor);commit=index['sourceCommit'];target=RELEASES/commit
 need(CURRENT.resolve(strict=True)==RELEASES/ORIGINAL and status.get('ActiveState')=='active'and not any(os.path.lexists(p)for p in[DROPIN,MANIFEST,ACCOUNT,SERVICE]),'INITIAL_SAME_ACCOUNT_CUTOVER_ONLY')
 prior_transition=None
 if resume:
  need(hashed(repair_sha),'VERIFIED_IN_MEMORY_REPAIR_DRIVER_REQUIRED');prior_dir=RECORDS/commit;directory(prior_dir,0,True);prior_raw=read(prior_dir/'transition.json',128*1024);prior_transition=json.loads(prior_raw);need(prior_transition.get('phase')=='cutover-failed-original-source-resumed-before-new-start'and prior_transition.get('packageIndexSha256')==expected_hash and prior_transition.get('source')==manifest['source']and prior_transition.get('accountId')==ACCOUNT_ID and prior_transition.get('inceptionAt')==INCEPTION and not prior_transition.get('startRequestedAt'),'KNOWN_PRE_START_REFUSAL_REQUIRED');supervisor.release_verified(manifest);need(read(target/'operator/native-paper-ec2/run-authoritative-service.py',128*1024)==data['run-authoritative-service.py'],'UNCHANGED_PREPARED_SUPERVISOR_REQUIRED')
 else:need(not target.exists(),'NEW_RELEASE_DIRECTORY_REQUIRED')
 inode=LEDGER.lstat();expected_inode=(inode.st_dev,inode.st_ino);before=original_audit(auditor,expected_inode);need(before['flatAtSnapshot']and before['lockedDepositLamports']=='0','ORIGINAL_EXPOSURE_REQUIRES_MANAGEMENT_HANDOFF_NOT_OBSERVER_CUTOVER')
 if resume:
  need(financial_rollback_equivalent(prior_transition['before'],before),'PREPARED_REFUSAL_FINANCIAL_STATE_CHANGED');prior_prefix=verify_live_financial_prefix(auditor,prior_transition['beforeStopVerifiedBackup']['financial'],prior_transition['beforeStopVerifiedBackup'])
 archived=data['original-status.json'];need(sha(archived)==json.loads(data['input.json'])['reportingBinding']['sourceStatusSha256'],'ARCHIVED_ORIGINAL_STATUS_BINDING_MISMATCH');prior=json.loads(archived);public=json.loads(read(PUBLIC_STATUS,4096,uid))
 for view in[prior,public]:need(view.get('accountId')==ACCOUNT_ID and view.get('inceptionAt')=='2026-10-26T22:07:36.212Z'and view.get('release')==ORIGINAL,'ORIGINAL_PUBLIC_SOURCE_IDENTITY_REQUIRED')
 need(os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize>=1024*MIB,'CUTOVER_DISK_HEADROOM_REQUIRED')
 make_dir(RECORDS,0,0,0o700);record_dir=RECORDS/commit;make_dir(record_dir,0,0,0o700);make_dir(BACKUPS.parent,0,0,0o755);make_dir(BACKUPS,0,0,0o700)
 if resume:
  retry=prior_transition.get('retryNumber',0)+1;need(type(retry)is int and retry>0,'VALID_RETRY_SEQUENCE_REQUIRED');backup_dir=BACKUPS/(commit+'-retry-'+str(retry).zfill(2));need(not backup_dir.exists(),'NEW_RETRY_BACKUP_DIRECTORY_REQUIRED');transition=dict(prior_transition);transition.update(retryNumber=retry,phase='resume-preflight-verified',administrativeRepair={'verifiedInMemoryDriverSha256':repair_sha,'unchangedPackageIndexSha256':expected_hash,'priorTransitionSha256':sha(prior_raw),'priorFailureState':'Exact first-attempt state was not recorded; fresh physical proof is mandatory.'},priorPid1Lifecycle=historical_pid1_lifecycle(prior_transition['at']),priorFinancialPrefixVerified=prior_prefix)
 else:
  need(not(record_dir/'transition.json').exists(),'NO_PREVIOUS_TRANSITION_TO_OVERWRITE');backup_dir=BACKUPS/commit;transition={'schemaVersion':1,'kind':'poe-original-account-cutover','accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'source':manifest['source'],'packageIndexSha256':expected_hash,'previousRelease':ORIGINAL,'at':int(time.time()*1000),'phase':'preflight-verified','before':before,'originalLedgerPathUnchanged':str(LEDGER),'financialImport':False,'capitalInitialized':False,'secretChanged':False}
 make_dir(backup_dir,0,0,0o700);prestop_backup=snapshot_backup(backup_dir/'before-stop.sqlite',auditor,None);need(financial_rollback_equivalent(before,prestop_backup['financial']),'FINANCIAL_STATE_CHANGED_DURING_PREFLIGHT')
 if resume:transition['retryBeforeStopVerifiedBackup']=prestop_backup
 else:transition['beforeStopVerifiedBackup']=prestop_backup
 write_json(record_dir/'transition.json',transition)
 # Reuse a prior immutable preparation only after exact source closure checks.
 if not resume:
  make_dir(target,0,gid,0o750)
  for row in manifest['files']:atomic(target/row['file'],data[row['file']],0,gid,0o640)
  op=target/'operator';make_dir(op,0,gid,0o750);op=op/'native-paper-ec2';make_dir(op,0,gid,0o750);atomic(op/'run-authoritative-service.py',data['run-authoritative-service.py'],0,gid,0o640);syncdir(target)
 def recover_original_before_new_start():
  # No new source has been started yet. Remove only this exact package's
  # configuration, restore the existing release, then resume its writer.
  for path,expected in[(DROPIN,data['poe-runtime-persistent.conf']),(MANIFEST,data['service.json'])]:
   if path.exists():need(read(path,128*1024)==expected,'RECOVERY_CONFIGURATION_CHANGED');path.unlink();syncdir(path.parent)
  if CURRENT.resolve(strict=True)==target:switch_current(RELEASES/ORIGINAL)
  need(CURRENT.resolve(strict=True)==RELEASES/ORIGINAL,'RECOVERY_RELEASE_CHANGED');systemctl('daemon-reload');systemctl('start','poe-runtime.service');transition.update(phase='cutover-failed-original-source-resumed-before-new-start',recoveredAt=int(time.time()*1000));write_json(record_dir/'transition.json',transition)
 def stopped_install():
  stopped=observe_stopped_writer();transition.update(phase='writer-stop-observed',lastStopProof=stopped);write_json(record_dir/'transition.json',transition);publish_stop_observation(manifest,transition,stopped,uid);need(stopped['physicalWriterSettled'],'ORIGINAL_WRITER_MUST_BE_SETTLED');stable=original_audit(auditor,expected_inode);need(stable['flatAtSnapshot']and stable['lockedDepositLamports']=='0','EXPOSURE_APPEARED_BEFORE_CUTOVER');actual_stopped_at=int(time.time()*1000);installed_input,input_receipt=transition_input(data['input.json'],actual_stopped_at);backup=snapshot_backup(backup_dir/'ledger.sqlite',auditor,stable);transition.update(phase='original-stopped-backup-verified',stoppedAt=actual_stopped_at,stoppedFinancial=stable,backup=backup,inputTransition=input_receipt);write_json(record_dir/'transition.json',transition)
  make_dir(ACCOUNT,uid,gid,0o700);make_dir(SERVICE,uid,gid,0o700);atomic(ACCOUNT/'input.json',installed_input,uid,gid);atomic(ACCOUNT/'research-baseline.json',data['research-baseline.json'],uid,gid);atomic(MANIFEST,data['service.json'],0,gid,0o640)
  make_dir(DROPIN.parent,0,0,0o755);atomic(DROPIN,data['poe-runtime-persistent.conf'],0,0,0o644);switch_current(target);systemctl('daemon-reload');transition.update(phase='new-source-installed-not-started',installedAt=int(time.time()*1000));write_json(record_dir/'transition.json',transition)
 stopped_phase(stopped_install,recover_original_before_new_start)
 # The sole runtime acquires the unchanged original DB owner lease itself.
 transition.update(phase='new-service-start-requested-runtime-and-render-verification-required',startRequestedAt=int(time.time()*1000));write_json(record_dir/'transition.json',transition);systemctl('start','poe-runtime.service');verification,financial_proof=post_start_verification(manifest,transition,auditor,uid,gid);transition.update(phase='post-start-read-only-verified-render-and-operation-still-unverified'if verification['complete']else'post-start-verification-incomplete-new-financial-source-retained',postStartVerification=verification,postStartFinancial=financial_proof);write_json(record_dir/'transition.json',transition);public_dir=PUBLIC_STATUS.parent;directory(public_dir,uid);need(stat.S_IMODE(public_dir.lstat().st_mode)==0o755,'EXISTING_PUBLIC_STATUS_DIRECTORY_REQUIRED');atomic(public_dir/'upgrade-verification.json',(json.dumps(verification,separators=(',',':'))+'\n').encode(),0,0,0o644);print(json.dumps(verification,separators=(',',':')))
 need(verification['complete'],'POST_START_VERIFICATION_INCOMPLETE_NEW_FINANCIAL_SOURCE_RETAINED')
def verify_live_financial_prefix(auditor,stopped,backup,deadline_seconds=5):
 """Exact whole-column prefix streams; all original SQLite access is owner UID."""
 backup_path=pathlib.Path(backup['file']);need(backup_path.resolve(strict=True)==backup_path and backup_path.parent.parent==BACKUPS and backup_path.name in['ledger.sqlite','before-stop.sqlite'],'EXACT_STOPPED_BACKUP_PATH_REQUIRED');raw=read(backup_path,128*MIB);need(sha(raw)==backup['sha256']and len(raw)==backup['bytes'],'VERIFIED_STOPPED_BACKUP_CHANGED')
 owner=pwd.getpwnam('poe-runtime');uid=owner.pw_uid;need(LEDGER.resolve(strict=True)==LEDGER,'CANONICAL_ORIGINAL_LEDGER_REQUIRED');meta=auditor.file_metadata(LEDGER,uid,True);need(meta['exists'],'EXISTING_ORIGINAL_LEDGER_REQUIRED');identity=(meta['device'],meta['inode']);fd=os.open(LEDGER,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);prior=None;deadline=time.monotonic()+deadline_seconds
 try:
  need((os.fstat(fd).st_dev,os.fstat(fd).st_ino)==identity,'ORIGINAL_LEDGER_OPEN_IDENTITY_CHANGED')
  # Root opens/initializes ONLY the private frozen backup, never the original.
  # Its established read transaction and FDs remain usable during owner drop.
  prior=sqlite3.connect('file:'+str(backup_path)+'?mode=ro',uri=True,timeout=1);prior.execute('PRAGMA query_only=ON');prior.execute('PRAGMA trusted_schema=OFF');prior.execute('PRAGMA cache_size=-8192');prior.execute('PRAGMA temp_store=MEMORY');prior.execute('PRAGMA hard_heap_limit=67108864');prior.set_progress_handler(lambda:1 if time.monotonic()>deadline else 0,1000);prior.execute('BEGIN');old_counts={name:prior.execute('SELECT count(*) FROM '+name).fetchone()[0]for name in['actions','journal']};old_columns={name:prior.execute('PRAGMA table_info('+name+')').fetchall()for name in old_counts}
  with auditor.original_owner(uid,owner.pw_gid):
   db=sqlite3.connect('file:'+str(LEDGER)+'?mode=ro',uri=True,timeout=1)
   try:
    db.execute('PRAGMA query_only=ON');db.execute('PRAGMA trusted_schema=OFF');db.execute('PRAGMA cache_size=-8192');db.execute('PRAGMA temp_store=MEMORY');db.set_progress_handler(lambda:1 if time.monotonic()>deadline else 0,1000);db.execute('BEGIN');current=auditor.audit_snapshot(db,existing_transaction=True);unchanged=['accountId','inceptionAt','initialMicroUsd','inceptionPriceSha256','inceptionLamports','roundingResidualMicroUsd'];need(all(current[k]==stopped[k]for k in unchanged)and current['revision']>=stopped['revision'],'ORIGINAL_FUNDING_INCEPTION_OR_REVISION_CHANGED');prefix={}
    for table in['actions','journal']:
     columns=db.execute('PRAGMA table_info('+table+')').fetchall();need(columns==old_columns[table]and len(columns)>0,'FINANCIAL_PREFIX_SCHEMA_CHANGED');count=old_counts[table];need(count==stopped['tableCounts'][table],'STOPPED_BACKUP_ROW_COUNT_CHANGED')
     query='SELECT * FROM journal WHERE revision<=? ORDER BY revision'if table=='journal'else'SELECT a.* FROM actions a JOIN journal j ON j.action_id=a.id WHERE j.revision>0 AND j.revision<=? ORDER BY a.id';old_query='SELECT * FROM '+table+' ORDER BY '+('revision'if table=='journal'else'id');sentinel=object();checked=0
     for old_row,current_row in itertools.zip_longest(prior.execute(old_query),db.execute(query,(stopped['revision'],)),fillvalue=sentinel):
      need(old_row is not sentinel and current_row is not sentinel and old_row==current_row,'OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED');checked+=1;need(time.monotonic()<=deadline,'FINANCIAL_PREFIX_VERIFICATION_DEADLINE')
     need(checked==count,'FINANCIAL_PREFIX_ROW_COUNT_CHANGED');prefix[table]={'priorRows':count,'exactPriorRowsRetained':True,'currentRows':current['tableCounts'][table]}
    need(db.total_changes==0 and prior.total_changes==0 and db.execute('PRAGMA query_only').fetchone()==(1,)and prior.execute('PRAGMA query_only').fetchone()==(1,),'READ_ONLY_FINANCIAL_VERIFICATION_REQUIRED');named=LEDGER.lstat();need((named.st_dev,named.st_ino)==identity,'ORIGINAL_LEDGER_INODE_CHANGED');return {'identityAndInceptionPreserved':True,'initialFundingAndRoundingPreserved':True,'journalAndActionPrefixPreserved':True,'priorRevision':stopped['revision'],'currentRevision':current['revision'],'currentStateBodySha256':current['stateBodySha256'],'prefix':prefix,'comparison':'whole-column-ordered-exact-prefix','originalSqliteOwnerUid':uid,'financialDatabaseWrites':0,'backupRestored':False,'financial':current}
   finally:
    if db.in_transaction:db.execute('ROLLBACK')
    db.close()
 finally:
  if prior is not None:
   if prior.in_transaction:prior.execute('ROLLBACK')
   prior.close()
  os.close(fd)
def wait_for_new_public_status(commit,uid,not_before,maximum_seconds=30):
 deadline=time.monotonic()+maximum_seconds
 while True:
  try:
   path=PUBLIC_STATUS;s=path.lstat();need(stat.S_IMODE(s.st_mode)==0o644,'PUBLIC_STATUS_MODE_REQUIRED');raw=read(path,4096,uid);value=json.loads(raw);at=int(datetime.datetime.fromisoformat(value['generatedAt'].replace('Z','+00:00')).timestamp()*1000);now=int(time.time()*1000)
   need(value.get('accountId')==ACCOUNT_ID and value.get('inceptionAt')=='2026-10-26T22:07:36.212Z'and value.get('release')==commit and value.get('mode')=='PAPER'and value.get('liveTrading')is False and not_before<=at<=now+5000 and now-at<=30000,'NEW_ORIGINAL_SOURCE_NOT_YET_VISIBLE');return {'available':True,'sourceTimestamp':value['generatedAt'],'statusSha256':sha(raw),'observedAt':now,'accountId':ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','release':commit}
  except(OSError,ValueError,KeyError,TypeError,Refused):
   if time.monotonic()>=deadline:return {'available':False,'reason':'NEW_ORIGINAL_PUBLIC_STATUS_NOT_VERIFIED_WITHIN_30_SECONDS'}
  time.sleep(min(.25,max(0,deadline-time.monotonic())))
def post_start_verification(manifest,transition,auditor,uid,gid,maximum_status_wait=30):
 started=time.monotonic();proof=None;errors=[];public=wait_for_new_public_status(manifest['source']['commit'],uid,transition['startRequestedAt'],maximum_status_wait)
 if not public['available']:errors.append(public['reason'])
 try:proof=verify_live_financial_prefix(auditor,transition['stoppedFinancial'],transition['backup'])
 except Exception as error:
  code=str(error);errors.append(code if code and len(code)<=128 and all(c in'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'for c in code)else'READ_ONLY_FINANCIAL_IDENTITY_OR_PREFIX_NOT_VERIFIED')
 complete=not errors;admission_suspended=False
 if proof is None:
  # Use the EXISTING candidate-admission marker ONLY when financial identity
  # or historical prefix cannot be verified. A public-status startup delay
  # must retain ordinary supervised freshness gates and automatic recovery.
  # Never pause financial management, change the ledger, downgrade code or manufacture an exit.
  try:
   gate=ACCOUNT/'admission-suspension.request'
   if not gate.exists():atomic(gate,(json.dumps({'schemaVersion':1,'owner':'poe-original-cutover-postcheck','accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'source':manifest['source'],'at':int(time.time()*1000),'reason':'post-start original-account verification unavailable; preserve exposure; new entries suspended'},separators=(',',':'))+'\n').encode(),uid,gid)
   admission_suspended=gate.exists()
  except(OSError,Refused):pass
 public_proof=None if proof is None else{k:v for k,v in proof.items()if k!='financial'}
 return {'schemaVersion':1,'kind':'poe-original-upgrade-verification-v1','accountId':ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','source':manifest['source'],'configurationSha256':manifest['configurationSha256'],'installedInputSha256':transition['inputTransition']['installedInputSha256'],'verifiedAt':int(time.time()*1000),'complete':complete,'newPublicSource':public,'financialVerification':public_proof,'errors':errors,'elapsedMs':round((time.monotonic()-started)*1000),'newAdmissionsSuspended':admission_suspended,'admissionPolicy':'existing-supervisor-fresh-reporting-and-financial-validity-gates'if proof is not None else'financial-verification-unavailable-existing-candidate-pause','financialManagementStopped':False,'financialDatabaseWrites':0,'backupRestored':False,'operationalAcceptance':False,'meaning':'One bounded read-only post-start identity and historical-prefix check. Not trading, protection, Render parity, profitability or sustained-operation acceptance.'},proof
def rollback(commit,auditor,supervisor):
 uid,gid,status=validate_host(auditor,supervisor);need(hashed(commit,40),'EXACT_ROLLBACK_SOURCE_REQUIRED');record_dir=RECORDS/commit;directory(record_dir,0,True);transition=json.loads(read(record_dir/'transition.json',128*1024));need(transition.get('source',{}).get('commit')==commit and transition.get('previousRelease')==ORIGINAL and CURRENT.resolve(strict=True)==RELEASES/commit,'RECORDED_ORIGINAL_CUTOVER_REQUIRED')
 # Never restore a backup over current financial history. Old observer cannot
 # manage new exposure; refuse while any financial effect remains.
 current=original_audit(auditor);need(financial_rollback_equivalent(transition['stoppedFinancial'],current),'OBSERVER_ROLLBACK_UNSAFE_FINANCIAL_STATE_CHANGED');need(DROPIN.exists()and MANIFEST.exists(),'KNOWN_CUTOVER_CONFIGURATION_REQUIRED');new_dropin=read(DROPIN,8192);new_manifest=read(MANIFEST,128*1024)
 def recover_financial_source():
  # A position may have opened after the first flat audit. On any stopped-phase
  # refusal, resume the SAME financial-capable release, never the observer.
  atomic(MANIFEST,new_manifest,0,gid,0o640);atomic(DROPIN,new_dropin,0,0,0o644);switch_current(RELEASES/commit);systemctl('daemon-reload');systemctl('start','poe-runtime.service');transition.update(phase='observer-rollback-refused-current-financial-source-resumed',recoveredAt=int(time.time()*1000));write_json(record_dir/'transition.json',transition)
 def stopped_rollback():
  current=original_audit(auditor);need(financial_rollback_equivalent(transition['stoppedFinancial'],current),'OBSERVER_ROLLBACK_UNSAFE_FINANCIAL_STATE_CHANGED');atomic(record_dir/'retired-dropin.conf',new_dropin,0,0);DROPIN.unlink();syncdir(DROPIN.parent);atomic(record_dir/'retired-service-manifest.json',new_manifest,0,0);MANIFEST.unlink();syncdir(MANIFEST.parent);switch_current(RELEASES/ORIGINAL);systemctl('daemon-reload');transition.update(phase='observer-code-rollback-financial-history-preserved',rollbackAt=int(time.time()*1000),rollbackFinancial=current);write_json(record_dir/'transition.json',transition)
 stopped_phase(stopped_rollback,recover_financial_source)
 systemctl('start','poe-runtime.service');print(json.dumps({'phase':transition['phase'],'accountId':ACCOUNT_ID,'ledgerRestored':False,'capitalReset':False,'observerOnly':True},separators=(',',':')))

def bootstrap(expected_hash):
 """Promote only owner-reviewed indexed bytes, not a mutable checkout import."""
 global HERE
 need(os.getuid()==0 and hashed(expected_hash),'EXISTING_OWNER_ROOT_AND_INDEX_PIN_REQUIRED');directory(INCOMING,994,True);raw=read(INCOMING/'index.json',128*1024,994);need(sha(raw)==expected_hash,'REVIEWED_PACKAGE_INDEX_HASH_REQUIRED');index=json.loads(raw)
 bounds={'native-paper.mjs':8*MIB,'backup-worker.mjs':MIB,'better_sqlite3.node':4*MIB,'metadata.json':MIB,'snapshot-publisher.mjs':MIB,**EXTRA};need(type(index)is dict and set(index)=={'schemaVersion','kind','sourceCommit','files'}and index['schemaVersion']==1 and index['kind']=='poe-original-cutover-package-v1'and hashed(index['sourceCommit'],40),'CUTOVER_PACKAGE_IDENTITY_REQUIRED');rows=index['files'];need(type(rows)is list and len(rows)==len(bounds)and{r.get('file')for r in rows if type(r)is dict}==set(bounds),'EXACT_PACKAGE_FILES_REQUIRED');data={}
 for row in rows:
  name=row['file'];need(set(row)=={'file','bytes','sha256'}and type(row['bytes'])is int and 0<row['bytes']<=bounds[name]and hashed(row['sha256']),'BOUNDED_PACKAGE_ROW_REQUIRED');body=read(INCOMING/name,bounds[name],994);need(len(body)==row['bytes']and sha(body)==row['sha256'],'PACKAGE_FILE_HASH_REQUIRED');data[name]=body
 # No UID994 source is imported or executed by root. The operator's outer
 # command executes an independently hash-verified in-memory driver first.
 for parent in[PACKAGE.parent,TOOLS.parent]:
  need(parent.parent.exists(),'EXISTING_POE_PARENT_REQUIRED');directory(parent.parent,0);make_dir(parent,0,0,0o700)
 need(not PACKAGE.exists()and not TOOLS.exists(),'ROOT_PACKAGE_ALREADY_PREPARED_PRESERVE_IT');make_dir(PACKAGE,0,0,0o700);make_dir(TOOLS,0,0,0o700)
 for name,body in data.items():atomic(PACKAGE/name,body,0,0)
 atomic(PACKAGE/'index.json',raw,0,0)
 for name in['audit-original-account.py','run-authoritative-service.py','cutover-original-service.py']:atomic(TOOLS/name,data[name],0,0)
 HERE=TOOLS
def main():
 global HERE
 need(os.getuid()==0,'EXISTING_OWNER_ROOT_ACCESS_REQUIRED');os.umask(0o077);directory(ETC,0)
 need(len(sys.argv)==3 and sys.argv[1]in['bootstrap','upgrade','rollback','resume'],'EXPLICIT_OPERATION_WITH_PIN_REQUIRED')
 op=os.open(ETC/'cutover.owner.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  ls=os.fstat(op);need(stat.S_ISREG(ls.st_mode)and ls.st_nlink==1 and ls.st_uid==0 and stat.S_IMODE(ls.st_mode)==0o600,'ROOT_CUTOVER_OWNER_LOCK_REQUIRED');fcntl.flock(op,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if sys.argv[1]=='bootstrap':bootstrap(sys.argv[2])
  if sys.argv[1]=='resume':need(hashed(globals().get('__poe_verified_driver_sha256__')),'VERIFIED_IN_MEMORY_REPAIR_DRIVER_REQUIRED');HERE=TOOLS
  directory(HERE,0);expected=sys.argv[2]
  if sys.argv[1]=='rollback':
   need(hashed(expected,40),'EXACT_ROLLBACK_SOURCE_REQUIRED');expected=json.loads(read(RECORDS/expected/'transition.json',128*1024))['packageIndexSha256']
  index_bytes=read(PACKAGE/'index.json',128*1024);need(hashed(expected)and sha(index_bytes)==expected,'REVIEWED_HELPER_INDEX_PIN_REQUIRED');index=json.loads(index_bytes);need(type(index)is dict and type(index.get('files'))is list,'REVIEWED_HELPER_INDEX_REQUIRED');rows={r['file']:r for r in index['files']if type(r)is dict and type(r.get('file'))is str}
  for name in['audit-original-account.py','run-authoritative-service.py','cutover-original-service.py']:
   raw=read(HERE/name,128*1024);need(name in rows and sha(raw)==rows[name].get('sha256')and len(raw)==rows[name].get('bytes'),'REVIEWED_ROOT_HELPER_HASH_REQUIRED')
  auditor=module('poe_original_audit',HERE/'audit-original-account.py');supervisor=module('poe_original_supervisor',HERE/'run-authoritative-service.py')
  if sys.argv[1]in['bootstrap','upgrade','resume']:upgrade(sys.argv[2],auditor,supervisor,resume=sys.argv[1]=='resume',repair_sha=globals().get('__poe_verified_driver_sha256__'))
  else:rollback(sys.argv[2],auditor,supervisor)
 finally:os.close(op)
if __name__=='__main__':
 try:main()
 except(RuntimeError,OSError,ValueError,sqlite3.Error,subprocess.SubprocessError)as e:print(json.dumps({'kind':'POE_ORIGINAL_CUTOVER_REFUSED','reason':str(e)if isinstance(e,Refused)else'HOST_PRECONDITION_OR_OPERATION_UNAVAILABLE','financialHistoryReset':False,'backupRestored':False,'ownerActionMayBeRequired':True}),flush=True);raise SystemExit(1)
