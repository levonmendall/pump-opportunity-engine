#!/usr/bin/env python3
"""One reviewed same-source original PAPER service change: six deep slots to four.
No source/input/unit/strategy/ledger change. Root-only apply; read-only stage API.
"""
import datetime,fcntl,hashlib,json,os,pathlib,stat,sys,time,types
SOURCE={'commit':'239a00ea9fbc0a25ebcf318631d26618d941c899','sha256':'fa10982125bd77c1586606283a9fabed4daee5434792dcef90be2bd312cc5315'}
SIX='5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344'
FOUR='f6ce54d7594e14d87955f211cca21f594b3d3eb52e20a75fa2245290f22a4857'
BEFORE='6e4549b41db60a4b58d3d61d8eb0becfeb03699071edf34a50b5b0c9e4015779'
AFTER='a1dbed9db61e259f759701d6aae2bd102ec3dc7cb357ef121312d7ddb3e4354b'
BASE_SHA='7e22683f8b170f0d16a6e2f7867e1e995a1661ff99544df3da8fa34c87f79691'
PRIOR_INDEX='7dce6bdd39a16d90453c512b307774f900d3845965e02ec9a52e63b8ba572947'
BASE=pathlib.Path('/var/lib/poe-cutover/forward-'+SOURCE['commit']+'/forward-original-upgrade.py')
STAGE=pathlib.Path('/var/tmp/poe-original-four-slots-239a00e')
FROZEN=pathlib.Path('/var/lib/poe-cutover/deep-four-'+SOURCE['commit'])
UID,GID,RUNNER=988,982,994
SUPERVISOR_SHA='1c993f89ec08c2ec6b8dfa05c5657bd2d572636361c8f32bff3febbeae729a79'
class Refused(RuntimeError):pass
def need(value,code):
 if not value:raise Refused(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,separators=(',',':'))+'\n').encode()
def now():return int(time.time()*1000)
def read(path,maximum,uid,mode=0o600):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==mode and 0<s.st_size<=maximum,'EXACT_BOUNDED_OWNER_FILE_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(raw)==s.st_size and(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns),'INPUT_CHANGED_DURING_READ');return raw
 finally:os.close(fd)
def load_frozen(raw):
 need(sha(raw)==BASE_SHA,'REVIEWED_FROZEN_7E_DRIVER_REQUIRED');f=types.ModuleType('poe_config_four_frozen_driver');f.__file__=str(BASE);exec(compile(raw,str(BASE),'exec'),f.__dict__);f.OLD_SOURCE=dict(SOURCE);f.OLD_MANIFEST=BEFORE;f.PRIOR_RECORD='forward-'+SOURCE['commit'];f.PRIOR_INDEX=PRIOR_INDEX;return f

def validate_target(raw):
 need(sha(raw)==AFTER,'REVIEWED_FOUR_SLOT_MANIFEST_REQUIRED');value=json.loads(raw);need(value.get('source')==SOURCE and value.get('deepSlots')==4 and value.get('configurationSha256')==FOUR,'EXACT_SAME_SOURCE_FOUR_SLOT_TARGET_REQUIRED');old=dict(value);old.update(deepSlots=6,configurationSha256=SIX);need(sha((json.dumps(old,indent=2)+'\n').encode())==BEFORE,'ONLY_TWO_REVIEWED_MANIFEST_FIELDS_MAY_CHANGE');return value

def stage_preflight(frozen_bytes,target_bytes):
 """Inert UID994 preflight: exact bytes and actual unit/process metadata only."""
 need(os.getuid()==RUNNER,'EXISTING_STAGE_RUNNER_REQUIRED');f=load_frozen(frozen_bytes);target=validate_target(target_bytes);unit=f.unit()
 if unit['ActiveState']=='active':f.process_owner(unit)
 return{'kind':'POE_ORIGINAL_FOUR_SLOT_STAGE_PREFLIGHT','source':SOURCE,'configurationSha256':target['configurationSha256'],'deepSlots':4,'manifestSha256':AFTER,'baseDriverSha256':BASE_SHA,'actualUnit':unit,'protectedArtifactVerificationDeferredToRoot':True,'financialDatabaseOpened':False,'credentialReads':0,'serviceChanges':0,'providerRequests':0}

def current_manifest(f,m):return f.read(m.MANIFEST,128*1024,0,GID,0o640)
def same_inputs(f,m,record_dir):
 need(f.read(m.ACCOUNT/'input.json',1024*1024,UID,GID,0o600)==f.read(record_dir/'before-input.json',1024*1024),'ORIGINAL_INPUT_MUST_REMAIN_UNCHANGED');need(f.read(m.DROPIN,8192,0,0,0o644)==f.read(record_dir/'before-native-dropin.conf',8192),'ORIGINAL_UNIT_MUST_REMAIN_UNCHANGED')
def runtime_process_proof(m,status,record):
 pid=status.get('runtimePid');need(type(pid)is int and pid>1,'ACTUAL_FOUR_SLOT_RUNTIME_PID_REQUIRED');raw=m.SERVICE_CGROUP.read_bytes();need(len(raw)<=8192 and all(v.isdigit()for v in raw.split())and pid in[int(v)for v in raw.split()],'FOUR_SLOT_RUNTIME_CGROUP_MEMBERSHIP_REQUIRED');root=pathlib.Path('/proc')/str(pid);need(root.stat().st_uid==UID,'FOUR_SLOT_RUNTIME_OWNER_REQUIRED');argv=(root/'cmdline').read_bytes();need(len(argv)<=16384 and str(m.RELEASES/SOURCE['commit']/'native-paper.mjs').encode()in argv.split(b'\0'),'FOUR_SLOT_RUNTIME_EXECUTABLE_REQUIRED');previous=(record.get('runtimeBefore')or{}).get('status',{}).get('runtimePid');need(previous is None or type(previous)is int and previous!=pid,'NEW_FOUR_SLOT_RUNTIME_PID_REQUIRED');return{'runtimePid':pid,'inOriginalUnitCgroup':True,'immutableSourceArgumentMatched':True,'ownerUid':UID,'previousRuntimePid':previous,'differentRuntimePidVerified':previous is not None,'observedAt':now()}
def wait_four(f,m,record,maximum=35):
 deadline=time.monotonic()+maximum
 while True:
  try:
   status=json.loads(f.read(m.ACCOUNT/'status.json',4*1024*1024,UID,GID,0o600));source=status.get('source',{});native=status.get('usage',{}).get('native',{});need(status.get('accountId')==m.ACCOUNT_ID and status.get('inceptionAt')==m.INCEPTION and all(source.get(k)==v for k,v in SOURCE.items())and status.get('configurationSha256')==FOUR and status.get('running')is True and status.get('persistent')is True and status.get('authoritative')is True and status.get('experimental')is False and status.get('liveTradingEnabled')is False and type(status.get('startedAt'))is int and record['stopRequestedAt']<=status['startedAt']<=status.get('generatedAt',0)and record['verificationNotBefore']<=status.get('generatedAt',0)<=now()+5000 and now()-status['generatedAt']<=30000 and status.get('watch',{}).get('maximumDeep')==4 and status.get('usage',{}).get('feeds',{}).get('maximumCandidates')==4 and native.get('maximumCandidates')==4 and type(native.get('candidates'))is int and 0<=native['candidates']<=4,'FRESH_ORIGINAL_FOUR_SLOT_RUNTIME_NOT_YET_VISIBLE');process=runtime_process_proof(m,status,record);return{k:status[k]for k in['accountId','inceptionAt','runId','runtimePid','generatedAt','configurationSha256','entriesEnabled']}|{'source':SOURCE,'maximumCandidates':4,'activeCandidates':native['candidates'],'watchMaximumDeep':4,'feedMaximumCandidates':4,'process':process}
  except(OSError,ValueError,TypeError,KeyError,Refused,f.Refused):
   if time.monotonic()>=deadline:raise Refused('FOUR_SLOT_FINANCIAL_MANAGER_RETAINED_VERIFICATION_INCOMPLETE')
  time.sleep(min(.25,max(0,deadline-time.monotonic())))

def apply(f,m,auditor,supervisor,driver_sha,self_bytes,target_bytes):
 target=validate_target(target_bytes);supervisor.validate_manifest(target);unit=f.local_preflight(m,auditor,supervisor);need(m.CURRENT.resolve(strict=True)==m.RELEASES/SOURCE['commit'],'CURRENT_EXECUTABLE_MUST_REMAIN_239A');supervisor.release_verified(target);need(sha(f.read(m.RELEASES/SOURCE['commit']/'operator/native-paper-ec2/run-authoritative-service.py',128*1024,0,GID,0o640))==SUPERVISOR_SHA,'CURRENT_SUPERVISOR_MUST_REMAIN_UNCHANGED')
 prior_dir=m.RECORDS/('forward-'+SOURCE['commit']);prior=json.loads(f.read(prior_dir/'transition.json',128*1024));need(prior.get('kind')=='poe-original-forward-upgrade-v1'and prior.get('source')==SOURCE and prior.get('packageIndexSha256')==PRIOR_INDEX,'VERIFIED_CURRENT_FORWARD_RECORD_REQUIRED');m.verify_live_financial_prefix(auditor,prior['stoppedFinancial'],prior['backup']);inode=m.LEDGER.lstat();identity=(inode.st_dev,inode.st_ino);financial=m.original_audit(auditor,identity);record_dir=m.RECORDS/('configuration-four-'+SOURCE['commit']);current=current_manifest(f,m)
 m.make_dir(FROZEN,0,0,0o700);f.keep_file(m,FROZEN/'reconfigure-original-deep-slots.py',self_bytes);f.keep_file(m,FROZEN/'service.json',target_bytes)
 if os.path.lexists(record_dir/'transition.json'):
  record=json.loads(f.read(record_dir/'transition.json',128*1024));need(record.get('kind')=='poe-original-four-slot-reconfiguration-v1'and record.get('driverSha256')==driver_sha and record.get('source')==SOURCE and record.get('manifestSha256')==AFTER and tuple(record.get('ledgerIdentity',[]))==identity,'EXACT_RETAINED_FOUR_SLOT_TRANSITION_REQUIRED');need(sha(f.read(record_dir/'before-service.json',128*1024))==BEFORE and f.read(record_dir/'after-service.json',128*1024)==target_bytes,'EXACT_RETAINED_MANIFEST_IMAGES_REQUIRED');same_inputs(f,m,record_dir)
 else:
  need(sha(current)==BEFORE and unit['ActiveState']=='active','ORIGINAL_SIX_SLOT_SERVICE_MUST_BE_RUNNING');old=supervisor.validate_manifest(json.loads(current));need({k:v for k,v in old.items()if k not in['deepSlots','configurationSha256']}=={k:v for k,v in target.items()if k not in['deepSlots','configurationSha256']},'ONLY_DEEP_SLOTS_AND_CONFIGURATION_HASH_MAY_CHANGE');m.make_dir(record_dir,0,0,0o700)
  for name,raw in [('before-service.json',current),('after-service.json',target_bytes),('before-input.json',f.read(m.ACCOUNT/'input.json',1024*1024,UID,GID,0o600)),('before-native-dropin.conf',f.read(m.DROPIN,8192,0,0,0o644))]:f.keep_file(m,record_dir/name,raw)
  record={'schemaVersion':1,'kind':'poe-original-four-slot-reconfiguration-v1','source':SOURCE,'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'driverSha256':driver_sha,'baseDriverSha256':BASE_SHA,'manifestSha256':AFTER,'beforeManifestSha256':BEFORE,'fromDeepSlots':6,'toDeepSlots':4,'configurationSha256':FOUR,'ledgerIdentity':list(identity),'unitBefore':unit,'runtimeBefore':f.selected_runtime(m),'beforeFinancial':financial,'at':now(),'phase':'before-and-after-images-retained','financialHistoryReset':False,'backupRestored':False,'codeInputAndUnitUnchanged':True,'operationalAcceptance':False};m.write_json(record_dir/'transition.json',record)
 need(current in[f.read(record_dir/'before-service.json',128*1024),target_bytes],'UNKNOWN_CURRENT_MANIFEST_REFUSED')
 # An observed four-slot manifest may have already started through service recovery.
 # From this point onward six is NEVER restored, even after an uncertain start.
 if current==target_bytes:record['fourMutationPossible']=True
 if record.get('fourMutationPossible')and current==target_bytes:
  record.update(phase='four-slot-manager-retained',startRequestedAt=record.get('startRequestedAt',now()),verificationNotBefore=record.get('verificationNotBefore',now()));m.write_json(record_dir/'transition.json',record);m.systemctl('start','poe-runtime.service')
 else:
  need(not record.get('startRequestedAt'),'FOUR_SLOT_CONFIGURATION_MUST_BE_RETAINED');need(len(list(record_dir.glob('phase-*.json')))<50,'PHASE_RECEIPT_HEADROOM_REQUIRED');attempt=record.get('attempt',0)+1;need(attempt<=10,'BOUNDED_MAINTENANCE_ATTEMPTS_REQUIRED');backup_dir=m.BACKUPS/(record_dir.name+'-'+str(attempt).zfill(2));live_dir=backup_dir.with_name(backup_dir.name+'-live');need(not os.path.lexists(backup_dir)and not os.path.lexists(live_dir),'FRESH_BACKUP_DIRECTORIES_REQUIRED');record.update(attempt=attempt,phase='fresh-backup-attempt',backupDirectory=str(backup_dir));m.write_json(record_dir/'transition.json',record);m.make_dir(backup_dir,0,0,0o700);m.make_dir(live_dir,0,0,0o700);live=m.snapshot_backup(live_dir/'ledger.sqlite',auditor,None);m.verify_live_financial_prefix(auditor,live['financial'],live);record.update(beforeStopBackup=live,stopRequestedAt=now(),phase='live-backup-verified');m.write_json(record_dir/'transition.json',record)
  def retain_manager():
   if record.get('fourMutationPossible'):
    lease=m.lease()
    try:
     need(m.observe_stopped_writer().get('physicalWriterSettled')is True,'FOUR_SLOT_RECOVERY_REQUIRES_FRESH_STOP_PROOF');m.original_audit(auditor,identity);need(current_manifest(f,m)in[f.read(record_dir/'before-service.json',128*1024),target_bytes],'UNKNOWN_CURRENT_MANIFEST_REFUSED');m.atomic(m.MANIFEST,target_bytes,0,GID,0o640);record.update(phase='four-slot-forward-only-recovery',verificationNotBefore=now(),startRequestedAt=record.get('startRequestedAt',now()));m.write_json(record_dir/'transition.json',record)
    finally:os.close(lease)
   m.systemctl('start','poe-runtime.service')
  def install():
   proof=m.observe_stopped_writer();need(proof.get('physicalWriterSettled')is True and f.graceful(proof),'GRACEFUL_PHYSICALLY_SETTLED_FINANCIAL_OWNER_REQUIRED');record['nativeGracefulStop']=f.native_stop_receipt(m,record);same_inputs(f,m,record_dir);m.original_audit(auditor,identity);m.verify_live_financial_prefix(auditor,live['financial'],live);backup=m.snapshot_backup(backup_dir/'ledger.sqlite',auditor,None);need(current_manifest(f,m)==f.read(record_dir/'before-service.json',128*1024),'UNCHANGED_SIX_SLOT_MANIFEST_REQUIRED');record.update(stoppedAt=now(),stopProof=proof,backup=backup,stoppedFinancial=backup['financial'],phase='stopped-backup-verified-four-mutation-intent',fourMutationPossible=True);m.write_json(record_dir/'transition.json',record);m.atomic(m.MANIFEST,target_bytes,0,GID,0o640);record.update(phase='four-slot-manifest-installed');m.write_json(record_dir/'transition.json',record)
  m.stopped_phase(install,retain_manager);record.update(startRequestedAt=now(),verificationNotBefore=now(),phase='four-slot-start-intent');m.write_json(record_dir/'transition.json',record);m.systemctl('start','poe-runtime.service')
 same_inputs(f,m,record_dir);need(current_manifest(f,m)==target_bytes,'FOUR_SLOT_MANIFEST_MUST_BE_RETAINED');need((m.LEDGER.lstat().st_dev,m.LEDGER.lstat().st_ino)==identity,'ORIGINAL_LEDGER_INODE_CHANGED');runtime=wait_four(f,m,record);prefix=m.verify_live_financial_prefix(auditor,record['stoppedFinancial'],record['backup']);after=f.unit();f.process_owner(after);record.update(phase='four-slot-runtime-and-financial-prefix-verified',verifiedAt=now(),runtimeAfter=runtime,postStartFinancial=prefix,unitAfter=after);m.write_json(record_dir/'transition.json',record)
 result={'schemaVersion':1,'kind':'POE_ORIGINAL_FOUR_SLOT_RECONFIGURATION_RESULT','complete':True,'accountId':m.ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','source':SOURCE,'configurationSha256':FOUR,'deepSlots':4,'manifestSha256':AFTER,'runtime':runtime,'financialPrefix':{k:v for k,v in prefix.items()if k!='financial'},'service':after,'financialHistoryReset':False,'backupRestored':False,'codeInputAndUnitUnchanged':True,'continuousCoverageClaimed':False,'operationalAcceptance':False};raw=encoded(result);need(len(raw)<=16384,'PUBLIC_RESULT_BOUND');m.atomic(m.PUBLIC_STATUS.parent/'configuration-four-verification.json',raw,0,0,0o644);print(raw.decode(),end='',flush=True);return result

def main():
 need(os.getuid()==0 and sys.argv[1:]==['apply'],'EXPLICIT_ROOT_CONFIG_APPLY_REQUIRED');driver_sha=globals().get('__poe_verified_config_driver_sha256__');need(type(driver_sha)is str and len(driver_sha)==64,'INDEPENDENT_CONFIG_DRIVER_PIN_REQUIRED');path=pathlib.Path(__file__);owner=0 if path.parent==FROZEN else RUNNER;need(path.parent in[STAGE,FROZEN],'FIXED_CONFIG_DRIVER_LOCATION_REQUIRED');self_bytes=read(path,128*1024,owner);need(sha(self_bytes)==driver_sha,'CONFIG_DRIVER_BYTES_CHANGED');f=load_frozen(read(BASE,128*1024,0));m,auditor,supervisor=f.load_helpers();target_path=(FROZEN if(FROZEN/'service.json').exists()else STAGE)/'service.json';target_bytes=read(target_path,128*1024,0 if target_path.parent==FROZEN else RUNNER);m.directory(m.ETC,0);fd=os.open(m.ETC/'cutover.owner.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600,'EXISTING_ROOT_MAINTENANCE_LOCK_REQUIRED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);apply(f,m,auditor,supervisor,driver_sha,self_bytes,target_bytes)
 finally:os.close(fd)
if __name__=='__main__':
 try:main()
 except Exception as error:
  reason=str(error);reason=reason if reason and len(reason)<=128 and all(c in'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'for c in reason)else'CONFIGURATION_LOCAL_OPERATION_UNAVAILABLE';print(json.dumps({'kind':'POE_ORIGINAL_FOUR_SLOT_RECONFIGURATION_REFUSED','reasonCode':reason,'financialHistoryReset':False,'backupRestored':False,'recovery':'Preserve the current financial manager and ledger. Rerun the same verified configuration command; never restore six after four mutation intent.','operationalAcceptance':False}),flush=True);raise SystemExit(1)
