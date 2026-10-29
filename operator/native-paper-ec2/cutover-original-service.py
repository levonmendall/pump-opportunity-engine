#!/usr/bin/env python3
"""Owner/root-only, fixed-account POE cutover. Never initializes/restores a ledger.

The root-owned package is prepared/reviewed before this command is used. This
file deliberately provides no sudo installation, remote command, provider,
secret, financial import, or alternate account/path mechanism.
"""
import fcntl,hashlib,importlib.util,json,os,pathlib,pwd,sqlite3,stat,subprocess,sys,time

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
  fs=os.fstat(fd);need((fs.st_dev,fs.st_ino)==identity,'ORIGINAL_LEDGER_OPEN_IDENTITY_CHANGED');db=sqlite3.connect('file:'+str(LEDGER)+'?mode=ro',uri=True,timeout=1)
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
 need(not path.exists()and not path.is_symlink(),'BACKUP_MUST_BE_NEW');created=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);created_stat=os.fstat(created);os.close(created);src=sqlite3.connect('file:'+str(LEDGER)+'?mode=ro',uri=True,timeout=1);dest=sqlite3.connect(path)
 try:
  ds=path.lstat();need(stat.S_ISREG(ds.st_mode)and(ds.st_dev,ds.st_ino)==(created_stat.st_dev,created_stat.st_ino),'BACKUP_INODE_CHANGED');src.backup(dest);dest.commit();observed=auditor.audit_snapshot(dest);need(expected is None or observed==expected,'BACKUP_EXACT_FINANCIAL_STATE_REQUIRED')
 finally:dest.close();src.close()
 os.chmod(path,0o600);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
 syncdir(path.parent);return{'file':str(path),'bytes':path.stat().st_size,'sha256':sha(read(path,128*MIB)),'financial':observed,'restorePerformed':False}
def switch_current(target):
 need(target.parent==RELEASES and target.resolve(strict=True)==target,'EXACT_RELEASE_TARGET_REQUIRED');temporary=CURRENT.with_name('.current-'+str(os.getpid()));need(not temporary.exists()and not temporary.is_symlink(),'NO_PENDING_RELEASE_LINK');temporary.symlink_to(target);os.replace(temporary,CURRENT);syncdir(CURRENT.parent)
def validate_host(auditor,supervisor):
 need(os.getuid()==0,'EXISTING_OWNER_ROOT_ACCESS_REQUIRED');os.umask(0o077);uid=pwd.getpwnam('poe-runtime').pw_uid;gid=pwd.getpwnam('poe-runtime').pw_gid;need(uid!=0,'ORIGINAL_NONROOT_OWNER_REQUIRED')
 supervisor.verify_host()
 for p in[ETC,RELEASES,CURRENT.parent]:directory(p,0)
 for p in[ROOT,LEDGER.parent]:directory(p,uid,True)
 for p in[HERE/'audit-original-account.py',HERE/'run-authoritative-service.py',pathlib.Path('/usr/bin/flock')]:need(p.lstat().st_uid==0 and not p.lstat().st_mode&0o022,'REVIEWED_ROOT_CODE_AND_EXISTING_FLOCK_REQUIRED')
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
def upgrade(expected_hash,auditor,supervisor):
 uid,gid,status=validate_host(auditor,supervisor);index,manifest,data=package(expected_hash,supervisor);commit=index['sourceCommit'];target=RELEASES/commit
 need(CURRENT.resolve(strict=True)==RELEASES/ORIGINAL and status.get('ActiveState')=='active'and not DROPIN.exists()and not MANIFEST.exists()and not ACCOUNT.exists()and not SERVICE.exists(),'INITIAL_SAME_ACCOUNT_CUTOVER_ONLY')
 need(not target.exists(),'NEW_RELEASE_DIRECTORY_REQUIRED');inode=LEDGER.lstat();expected_inode=(inode.st_dev,inode.st_ino);before=original_audit(auditor,expected_inode);need(before['flatAtSnapshot']and before['lockedDepositLamports']=='0','ORIGINAL_EXPOSURE_REQUIRES_MANAGEMENT_HANDOFF_NOT_OBSERVER_CUTOVER')
 archived=data['original-status.json'];need(sha(archived)==json.loads(data['input.json'])['reportingBinding']['sourceStatusSha256'],'ARCHIVED_ORIGINAL_STATUS_BINDING_MISMATCH');prior=json.loads(archived);public=json.loads(read(pathlib.Path('/var/lib/poe-public/status.json'),4096,uid))
 for view in[prior,public]:need(view.get('accountId')==ACCOUNT_ID and view.get('inceptionAt')=='2026-10-26T22:07:36.212Z'and view.get('release')==ORIGINAL,'ORIGINAL_PUBLIC_SOURCE_IDENTITY_REQUIRED')
 need(os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize>=1024*MIB,'CUTOVER_DISK_HEADROOM_REQUIRED')
 make_dir(RECORDS,0,0,0o700);record_dir=RECORDS/commit;make_dir(record_dir,0,0,0o700);need(not(record_dir/'transition.json').exists(),'NO_PREVIOUS_TRANSITION_TO_OVERWRITE');make_dir(BACKUPS.parent,0,0,0o755);make_dir(BACKUPS,0,0,0o700);backup_dir=BACKUPS/commit;make_dir(backup_dir,0,0,0o700)
 prestop_backup=snapshot_backup(backup_dir/'before-stop.sqlite',auditor,None);need(financial_rollback_equivalent(before,prestop_backup['financial']),'FINANCIAL_STATE_CHANGED_DURING_PREFLIGHT')
 transition={'schemaVersion':1,'kind':'poe-original-account-cutover','accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'source':manifest['source'],'packageIndexSha256':expected_hash,'previousRelease':ORIGINAL,'at':int(time.time()*1000),'phase':'preflight-verified','before':before,'beforeStopVerifiedBackup':prestop_backup,'originalLedgerPathUnchanged':str(LEDGER),'financialImport':False,'capitalInitialized':False,'secretChanged':False};write_json(record_dir/'transition.json',transition)
 # Only immutable code is staged while the original observer still operates.
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
  stopped=auditor.service_status();need(stopped.get('ActiveState')=='inactive'and stopped.get('MainPID')=='0','ORIGINAL_WRITER_MUST_BE_SETTLED');stable=original_audit(auditor,expected_inode);need(stable['flatAtSnapshot']and stable['lockedDepositLamports']=='0','EXPOSURE_APPEARED_BEFORE_CUTOVER');actual_stopped_at=int(time.time()*1000);installed_input,input_receipt=transition_input(data['input.json'],actual_stopped_at);backup=snapshot_backup(backup_dir/'ledger.sqlite',auditor,stable);transition.update(phase='original-stopped-backup-verified',stoppedAt=actual_stopped_at,stoppedFinancial=stable,backup=backup,inputTransition=input_receipt);write_json(record_dir/'transition.json',transition)
  make_dir(ACCOUNT,uid,gid,0o700);make_dir(SERVICE,uid,gid,0o700);atomic(ACCOUNT/'input.json',installed_input,uid,gid);atomic(ACCOUNT/'research-baseline.json',data['research-baseline.json'],uid,gid);atomic(MANIFEST,data['service.json'],0,gid,0o640)
  make_dir(DROPIN.parent,0,0,0o755);atomic(DROPIN,data['poe-runtime-persistent.conf'],0,0,0o644);switch_current(target);systemctl('daemon-reload');transition.update(phase='new-source-installed-not-started',installedAt=int(time.time()*1000));write_json(record_dir/'transition.json',transition)
 stopped_phase(stopped_install,recover_original_before_new_start)
 # The sole runtime acquires the unchanged original DB owner lease itself.
 systemctl('start','poe-runtime.service');transition.update(phase='new-service-start-requested-runtime-and-render-verification-required',startRequestedAt=int(time.time()*1000));write_json(record_dir/'transition.json',transition);print(json.dumps(transition,separators=(',',':')))
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
 need(os.getuid()==0,'EXISTING_OWNER_ROOT_ACCESS_REQUIRED');os.umask(0o077);directory(ETC,0)
 need(len(sys.argv)==3 and sys.argv[1]in['bootstrap','upgrade','rollback'],'EXPLICIT_OPERATION_WITH_PIN_REQUIRED')
 op=os.open(ETC/'cutover.owner.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  ls=os.fstat(op);need(stat.S_ISREG(ls.st_mode)and ls.st_nlink==1 and ls.st_uid==0 and stat.S_IMODE(ls.st_mode)==0o600,'ROOT_CUTOVER_OWNER_LOCK_REQUIRED');fcntl.flock(op,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if sys.argv[1]=='bootstrap':bootstrap(sys.argv[2])
  directory(HERE,0);expected=sys.argv[2]
  if sys.argv[1]=='rollback':
   need(hashed(expected,40),'EXACT_ROLLBACK_SOURCE_REQUIRED');expected=json.loads(read(RECORDS/expected/'transition.json',128*1024))['packageIndexSha256']
  index_bytes=read(PACKAGE/'index.json',128*1024);need(hashed(expected)and sha(index_bytes)==expected,'REVIEWED_HELPER_INDEX_PIN_REQUIRED');index=json.loads(index_bytes);need(type(index)is dict and type(index.get('files'))is list,'REVIEWED_HELPER_INDEX_REQUIRED');rows={r['file']:r for r in index['files']if type(r)is dict and type(r.get('file'))is str}
  for name in['audit-original-account.py','run-authoritative-service.py','cutover-original-service.py']:
   raw=read(HERE/name,128*1024);need(name in rows and sha(raw)==rows[name].get('sha256')and len(raw)==rows[name].get('bytes'),'REVIEWED_ROOT_HELPER_HASH_REQUIRED')
  auditor=module('poe_original_audit',HERE/'audit-original-account.py');supervisor=module('poe_original_supervisor',HERE/'run-authoritative-service.py')
  if sys.argv[1]in['bootstrap','upgrade']:upgrade(sys.argv[2],auditor,supervisor)
  else:rollback(sys.argv[2],auditor,supervisor)
 finally:os.close(op)
if __name__=='__main__':
 try:main()
 except(Refused,OSError,ValueError,sqlite3.Error,subprocess.SubprocessError)as e:print(json.dumps({'kind':'POE_ORIGINAL_CUTOVER_REFUSED','reason':str(e)if isinstance(e,Refused)else'HOST_PRECONDITION_OR_OPERATION_UNAVAILABLE','financialHistoryReset':False,'backupRestored':False,'ownerActionMayBeRequired':True}),flush=True);raise SystemExit(1)
