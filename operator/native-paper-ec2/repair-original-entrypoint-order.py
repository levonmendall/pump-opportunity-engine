#!/usr/bin/env python3
"""One fixed original-service drop-in ordering repair; no financial migration."""
import fcntl,hashlib,json,os,pathlib,re,shlex,stat,subprocess,sys,time,types

INDEX_SHA='fa616981e2a86aec0f9c2711d0b3c961eb5ab922791f49e2a4e7e372497a84dd'
SOURCE={'commit':'5e55d8b939de99698ddb311a282461931fcbc957','sha256':'531012e82b6cb86149350ec4478c1f7a7b87b6f35f08f3b1f32447f05cd31eaa'}
RESUMER=pathlib.Path('/var/tmp/poe-issue11-resume-93f23cb1/resume-original-service.py')
RESUMER_SHA='93f23cb18b67f72749b34f11c28e8af777195da2832a25b68867d80ea89d8b3e'
PACKAGE=pathlib.Path('/var/lib/poe-cutover/issue11')
TOOLS=pathlib.Path('/opt/poe/cutover/issue11')
UNITDIR=pathlib.Path('/etc/systemd/system/poe-runtime.service.d')
LEGACY=UNITDIR/'entrypoint.conf'
LOWER=UNITDIR/'00-legacy-entrypoint.conf'
LEGACY_BYTES=b'[Service]\nExecStart=\nExecStart=/opt/poe/node/bin/node --preserve-symlinks-main --use-env-proxy /opt/poe/current/dist/src/runtime.js run\nExecStop=\nExecStop=/opt/poe/node/bin/node --preserve-symlinks-main /opt/poe/current/dist/src/runtime.js safe-stop\n'
LEGACY_SHA='309bba18b7f3f17b403f6ef950df707587044b5e049f47ff3495c87d8de7d4df'
NATIVE_ARGV=['/usr/bin/python3','-B','-I','/opt/poe/current/operator/native-paper-ec2/run-authoritative-service.py']
OLD_ARGV=['/opt/poe/node/bin/node','--preserve-symlinks-main','--use-env-proxy','/opt/poe/current/dist/src/runtime.js','run']
ACTIVE_CONTEXT=None
class Guard(RuntimeError):pass
def need(value,code):
 if not value:raise Guard(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path,limit,uid,mode=None):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==uid and s.st_nlink==1 and not s.st_mode&0o022 and(mode is None or stat.S_IMODE(s.st_mode)==mode)and 0<s.st_size<=limit,'BOUNDED_EXACT_OWNER_FILE_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(raw)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'INPUT_CHANGED');return raw
 finally:os.close(fd)
def load_reviewed_helpers():
 raw=read(RESUMER,128*1024,994,0o600);need(sha(raw)==RESUMER_SHA,'REVIEWED_RESUMER_HASH_REQUIRED');m=types.ModuleType('poe_reviewed_resume');m.__file__=str(RESUMER);exec(compile(raw,str(RESUMER),'exec'),m.__dict__);m.HERE=TOOLS;index_raw=read(PACKAGE/'index.json',128*1024,0);need(sha(index_raw)==INDEX_SHA,'ORIGINAL_PACKAGE_INDEX_REQUIRED');index=json.loads(index_raw);rows={r['file']:r for r in index['files']}
 for name in['audit-original-account.py','run-authoritative-service.py','cutover-original-service.py']:
  body=read(TOOLS/name,128*1024,0);need(len(body)==rows[name]['bytes']and sha(body)==rows[name]['sha256'],'UNCHANGED_ROOT_HELPER_REQUIRED')
 auditor=m.module('poe_original_audit',TOOLS/'audit-original-account.py');supervisor=m.module('poe_original_supervisor',TOOLS/'run-authoritative-service.py');return m,auditor,supervisor
def exec_argv(value):
 parts=re.findall(r'argv\[\]=([^;]*);',value)
 return shlex.split(parts[0])if len(parts)==1 else None
def verified_empty_exec_stop():
 # systemctl show omits an empty ExecStop command array even with --all.
 # Absence alone is never accepted: query the fixed typed D-Bus property.
 try:
  r=subprocess.run(['/usr/bin/busctl','--system','--timeout=3s','--json=short','get-property','org.freedesktop.systemd1','/org/freedesktop/systemd1/unit/poe_2druntime_2eservice','org.freedesktop.systemd1.Service','ExecStop'],capture_output=True,text=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False)
 except(OSError,subprocess.TimeoutExpired):raise Guard('TYPED_EXEC_STOP_UNAVAILABLE')
 need(r.returncode==0 and len(r.stdout.encode())<=8192 and len(r.stderr.encode())<=4096,'TYPED_EXEC_STOP_UNAVAILABLE')
 try:value=json.loads(r.stdout)
 except ValueError:raise Guard('TYPED_EXEC_STOP_INVALID')
 need(type(value)is dict and set(value)=={'type','data'}and value['type']=='a(sasbttttuii)'and type(value['data'])is list and not value['data'],'TYPED_EXEC_STOP_NOT_EMPTY')
 return {'source':'fixed-systemd-Service.ExecStop-D-Bus-property','type':value['type'],'entries':0,'responseSha256':sha(r.stdout.encode())}
def merged_unit():
 keys=['LoadState','User','Group','ActiveState','SubState','MainPID','ControlPID','NRestarts','Result','ExecMainCode','ExecMainStatus','ExecStart','ExecStop','DropInPaths'];r=subprocess.run(['/usr/bin/systemctl','show','--all','poe-runtime.service','--property='+','.join(keys)],capture_output=True,text=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False);need(r.returncode==0 and len(r.stdout)<=32768 and len(r.stderr)<=4096,'MERGED_UNIT_METADATA_UNAVAILABLE');v={k:x for line in r.stdout.splitlines()for k,sep,x in[line.partition('=')]if sep and k in keys};need(set(keys)-set(v)<={'ExecStop'},'COMPLETE_MERGED_UNIT_METADATA_REQUIRED');stop_proof=None
 if not v.get('ExecStop'):
  stop_proof=verified_empty_exec_stop();v['ExecStop']=''
 argv=exec_argv(v['ExecStart']);paths=[pathlib.Path(p)for p in shlex.split(v['DropInPaths'])];need(len(paths)<=8 and all(p.is_absolute()and p.parent==UNITDIR and p.resolve(strict=False)==p and(os.path.lexists(p)or p==UNITDIR/'entrypoint.conf'and(UNITDIR/'00-legacy-entrypoint.conf').is_file())for p in paths),'EXACT_CANONICAL_DROPIN_PATHS_REQUIRED');dropins=[p.name for p in paths];return {**{k:v[k]for k in keys if k not in['ExecStart','ExecStop','DropInPaths']},'nativeExecStart':argv==NATIVE_ARGV,'legacyExecStart':argv==OLD_ARGV,'execStopEmpty':v['ExecStop']=='','emptyExecStopProof':stop_proof,'dropInBasenames':dropins,'execStartMetadataSha256':sha(v['ExecStart'].encode())}
def assert_native_merged(value):
 need(value['nativeExecStart']and value['execStopEmpty']and value['User']=='poe-runtime'and value['Group']=='poe-runtime'and value['LoadState']=='loaded'and sorted(value['dropInBasenames'])==['00-legacy-entrypoint.conf','90-native-engine.conf','reporting.conf'],'EXACT_NATIVE_ENTRYPOINT_AND_EMPTY_STOP_REQUIRED')
def reporting_directive_names():
 # Only directive names are interpreted or retained. No credential file or
 # reporting configuration value is used, copied, printed or exported.
 raw=read(UNITDIR/'reporting.conf',8192,0,0o644);keys=[]
 for line in raw.decode('utf8').splitlines():
  text=line.strip()
  if not text or text.startswith(('#',';','[')):continue
  key=text.partition('=')[0].strip();need(key in['LoadCredential','LoadCredentialEncrypted'],'REPORTING_DROPIN_MUST_NOT_OVERRIDE_EXECUTION');keys.append(key)
 need(keys,'ORIGINAL_REPORTING_CREDENTIAL_DIRECTIVE_REQUIRED');return keys
def configuration_state(m,data):
 m.directory(UNITDIR,0);need(stat.S_IMODE(UNITDIR.lstat().st_mode)==0o755,'ROOT_UNIT_DROPIN_DIRECTORY_REQUIRED');need(read(UNITDIR/'90-native-engine.conf',8192,0,0o644)==data['poe-runtime-persistent.conf'],'UNCHANGED_NATIVE_DROPIN_REQUIRED');keys=reporting_directive_names();old=os.path.lexists(LEGACY);lower=os.path.lexists(LOWER);need(old!=lower,'ONE_EXACT_LEGACY_DROPIN_REQUIRED');body=read(LEGACY if old else LOWER,8192,0,0o644);need(body==LEGACY_BYTES and len(body)==250 and sha(body)==LEGACY_SHA,'EXACT_LEGACY_ENTRYPOINT_BYTES_REQUIRED');return old,keys
def selected_private(path,uid,kind):
 result={'exists':os.path.lexists(path)}
 if not result['exists']:return result
 try:
  v=json.loads(read(path,4*1024*1024,uid,0o600));allowed=['generatedAt','runtimePid','startedAt','running','persistent','operatingMode','accountId','inceptionAt','configurationSha256','inputFileSha256']if kind=='status'else['generatedAt','sourcePid','publisherPid','sourceRunId','lastSourceAt','lastAcceptedSourceAt','sourceGroupUnsettled','outputErrors','matchedSourceAcknowledgements'];result.update({k:v[k]for k in allowed if k in v and(type(v[k])in[int,bool]or v[k]is None or type(v[k])is str and len(v[k])<=128)});source=v.get('source');
  if type(source)is dict:result['source']={k:source[k]for k in['commit','sha256']if type(source.get(k))is str and re.fullmatch('[a-f0-9]{40}|[a-f0-9]{64}',source[k])}
  result['readable']=True
 except Exception:result['readable']=False;result['reasonCode']='BOUNDED_PRIVATE_STATUS_UNAVAILABLE'
 return result
def generic_supervisor_messages():
 try:
  r=subprocess.run(['/usr/bin/journalctl','--no-pager','--output=json','-n','12','--since','-5min','-u','poe-runtime.service','_COMM=python3'],capture_output=True,text=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False);need(r.returncode==0 and len(r.stdout.encode())<=32768,'BOUNDED_SUPERVISOR_JOURNAL_UNAVAILABLE');rows=[]
  for line in r.stdout.splitlines():
   v=json.loads(line);text=v.get('MESSAGE');
   if type(text)is not str or not text.startswith('{')or len(text)>2048:continue
   try:value=json.loads(text)
   except ValueError:continue
   if value.get('kind')=='POE_AUTHORITATIVE_SERVICE_UNAVAILABLE':rows.append({'kind':'POE_AUTHORITATIVE_SERVICE_UNAVAILABLE','reasonCode':'CONFIGURATION_RESOURCE_OR_RECOVERY_PRECONDITION_UNAVAILABLE'})
  return{'available':True,'allowlistedGenericMessages':rows}
 except Exception:return{'available':False,'reasonCode':'BOUNDED_SUPERVISOR_JOURNAL_UNAVAILABLE'}
def startup_clues(m,uid):
 try:unit=merged_unit()
 except Exception:unit={'available':False,'reasonCode':'MERGED_UNIT_METADATA_UNAVAILABLE'}
 public={'exists':os.path.lexists(m.PUBLIC_STATUS)}
 try:
  s=m.PUBLIC_STATUS.lstat();public.update(ownerUid=s.st_uid,mode=stat.S_IMODE(s.st_mode),bytes=s.st_size);v=json.loads(read(m.PUBLIC_STATUS,4096,uid));public.update({k:v[k]for k in['accountId','inceptionAt','release','generatedAt']if type(v.get(k))is str and len(v[k])<=128})
 except Exception:public['readable']=False
 return{'unit':unit,'publicStatus':public,'privateStatus':selected_private(m.ACCOUNT/'status.json',uid,'status'),'supervisorHealth':selected_private(m.SERVICE/'health.json',uid,'health'),'supervisorJournal':generic_supervisor_messages()}
def publish_receipt(m,value,uid):
 folder=m.PUBLIC_STATUS.parent;m.directory(folder,uid);need(stat.S_IMODE(folder.lstat().st_mode)==0o755,'EXISTING_PUBLIC_STATUS_DIRECTORY_REQUIRED');raw=(json.dumps(value,separators=(',',':'))+'\n').encode();need(len(raw)<=16384,'BOUNDED_PUBLIC_REPAIR_RECEIPT_REQUIRED');m.atomic(folder/'upgrade-verification.json',raw,0,0,0o644);print(raw.decode(),end='',flush=True)
def repair(m,auditor,supervisor,driver_sha):
 global ACTIVE_CONTEXT
 need(re.fullmatch('[a-f0-9]{64}',str(driver_sha))is not None,'VERIFIED_REPAIR_DRIVER_SHA_REQUIRED');uid,gid,_=m.validate_host(auditor,supervisor);_,manifest,data=m.package(INDEX_SHA,supervisor);need(manifest['source']==SOURCE and m.CURRENT.resolve(strict=True)==m.RELEASES/SOURCE['commit'],'EXACT_INSTALLED_NATIVE_SOURCE_REQUIRED');supervisor.release_verified(manifest);need(read(m.MANIFEST,128*1024,0)==data['service.json'],'EXACT_INSTALLED_NATIVE_MANIFEST_REQUIRED');need(read(m.RELEASES/SOURCE['commit']/'operator/native-paper-ec2/run-authoritative-service.py',128*1024,0)==data['run-authoritative-service.py'],'UNCHANGED_NATIVE_SUPERVISOR_REQUIRED');old,keys=configuration_state(m,data);unit_before=merged_unit();legacy_set=['90-native-engine.conf','entrypoint.conf','reporting.conf'];native_set=['00-legacy-entrypoint.conf','90-native-engine.conf','reporting.conf'];cached_legacy=unit_before['legacyExecStart']and sorted(unit_before['dropInBasenames'])==legacy_set;current_native=unit_before['nativeExecStart']and sorted(unit_before['dropInBasenames'])==native_set;need(unit_before['User']=='poe-runtime'and unit_before['Group']=='poe-runtime'and(cached_legacy or not old and current_native),'EXACT_ORIGINAL_DROPIN_SET_REQUIRED');need(cached_legacy if old else cached_legacy or current_native,'EXPECTED_ENTRYPOINT_ORDERING_STATE_REQUIRED')
 parent=m.RECORDS/SOURCE['commit'];m.directory(parent,0,True);prior_raw=read(parent/'transition.json',128*1024,0);prior=json.loads(prior_raw);need(prior.get('accountId')==m.ACCOUNT_ID and prior.get('inceptionAt')==m.INCEPTION and prior.get('source')==SOURCE and prior.get('packageIndexSha256')==INDEX_SHA,'ORIGINAL_CUTOVER_RECORD_REQUIRED');inode=m.LEDGER.lstat();expected_inode=(inode.st_dev,inode.st_ino);financial_before=m.original_audit(auditor,expected_inode);prefix=m.verify_live_financial_prefix(auditor,prior['stoppedFinancial'],prior['backup']);now=int(time.time()*1000);record_dir=parent/('entrypoint-order-'+str(now));m.make_dir(record_dir,0,0,0o700);record={'schemaVersion':1,'kind':'poe-original-entrypoint-order-repair-v1','accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'source':SOURCE,'packageIndexSha256':INDEX_SHA,'repairDriverSha256':driver_sha,'previousTransitionSha256':sha(prior_raw),'at':now,'phase':'repair-preflight-verified','unitBefore':unit_before,'legacySha256':LEGACY_SHA,'reportingDirectiveKeys':keys,'preFinancial':financial_before,'priorFinancialPrefix':prefix,'financialHistoryReset':False,'backupRestored':False,'financialOwnerLeaseReleased':True};ACTIVE_CONTEXT=(m,record_dir,record,uid);m.write_json(record_dir/'transition.json',record);m.atomic(record_dir/'legacy-entrypoint.conf',LEGACY_BYTES,0,0)
 native_stopped=current_native and unit_before.get('MainPID')=='0'and unit_before.get('ControlPID')=='0'and(unit_before.get('ActiveState'),unit_before.get('SubState'))in[('inactive','dead'),('failed','failed'),('activating','auto-restart')]
 if old or cached_legacy or native_stopped:
  record['stopRequestedAt']=int(time.time()*1000);m.systemctl('stop','poe-runtime.service');lease=None
  try:
   lease=m.lease();record['financialOwnerLeaseReleased']=False;proof=m.observe_stopped_writer();record.update(phase='physical-stop-observed',stopProof=proof);m.write_json(record_dir/'transition.json',record);need(proof['physicalWriterSettled'],'ORIGINAL_WRITER_MUST_BE_SETTLED');stable=m.original_audit(auditor,expected_inode);m.verify_live_financial_prefix(auditor,prior['stoppedFinancial'],prior['backup']);record['stoppedFinancial']=stable
   if old:
    need(read(LEGACY,8192,0,0o644)==LEGACY_BYTES and not os.path.lexists(LOWER),'LEGACY_RENAME_PRECONDITION_CHANGED');os.rename(LEGACY,LOWER);m.syncdir(UNITDIR)
   else:need(read(LOWER,8192,0,0o644)==LEGACY_BYTES and not os.path.lexists(LEGACY),'RETAINED_LEGACY_RENAME_CHANGED')
   m.systemctl('daemon-reload');merged=merged_unit();assert_native_merged(merged);record.update(phase='exact-native-merged-entrypoint-verified',unitAfterReload=merged);m.write_json(record_dir/'transition.json',record)
  finally:
   if lease is not None:os.close(lease);record['financialOwnerLeaseReleased']=True
  record['repairStartRequestedAt']=int(time.time()*1000);m.systemctl('start','poe-runtime.service')
 else:
  assert_native_merged(unit_before);record['alreadyCorrectNoRestart']=True;record['repairStartRequestedAt']=prior['startRequestedAt']
 need((m.LEDGER.lstat().st_dev,m.LEDGER.lstat().st_ino)==expected_inode,'ORIGINAL_LEDGER_INODE_CHANGED');post=dict(prior);post['startRequestedAt']=record['repairStartRequestedAt'];verification,financial=m.post_start_verification(manifest,post,auditor,uid,gid);need((m.LEDGER.lstat().st_dev,m.LEDGER.lstat().st_ino)==expected_inode,'ORIGINAL_LEDGER_INODE_CHANGED');record.update(phase='repair-post-start-verified'if verification['complete']else'repair-post-start-incomplete-native-manager-retained',verification=verification,postFinancial=financial,startupClues=startup_clues(m,uid));m.write_json(record_dir/'transition.json',record);public={'schemaVersion':1,'kind':'poe-original-entrypoint-repair-result-v1','accountId':m.ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','source':SOURCE,'repairDriverSha256':driver_sha,'phase':record['phase'],'complete':verification['complete'],'verification':verification,'startupClues':record['startupClues'],'financialHistoryReset':False,'backupRestored':False,'operationalAcceptance':False};publish_receipt(m,public,uid);need(verification['complete'],'NATIVE_SOURCE_POST_START_NOT_VERIFIED_MANAGER_RETAINED');return public
def main():
 need(os.getuid()==0 and len(sys.argv)==1,'EXACT_OWNER_ROOT_REPAIR_REQUIRED');os.umask(0o077);m,auditor,supervisor=load_reviewed_helpers();m.directory(m.ETC,0);fd=os.open(m.ETC/'cutover.owner.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'ROOT_CUTOVER_LOCK_REQUIRED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);repair(m,auditor,supervisor,globals().get('__poe_verified_driver_sha256__'))
 finally:os.close(fd)
def record_failure(error):
 code=str(error);code=code if code and len(code)<=128 and all(c in'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'for c in code)else'ENTRYPOINT_REPAIR_LOCAL_OPERATION_UNAVAILABLE';failure={'kind':'POE_ENTRYPOINT_ORDER_REPAIR_REFUSED','reasonCode':code,'financialHistoryReset':False,'backupRestored':False,'observerReverted':False}
 if ACTIVE_CONTEXT is not None:
  m,record_dir,record,uid=ACTIVE_CONTEXT
  if record.get('stopRequestedAt')and not record.get('repairStartRequestedAt')and record.get('financialOwnerLeaseReleased')is True and(record.get('stopProof')or{}).get('physicalWriterSettled')is True:
   try:assert_native_merged(merged_unit());m.systemctl('start','poe-runtime.service');failure['sameNativeSourceRecoveryStartRequested']=True
   except Exception:failure['sameNativeSourceRecoveryStartRequested']=False
  failure.update(failedPhase=record['phase'],startupClues=startup_clues(m,uid),accountId=m.ACCOUNT_ID,inceptionAt='2026-10-26T22:07:36.212Z',source=SOURCE,complete=False,operationalAcceptance=False);record['failure']=failure
  try:m.write_json(record_dir/'transition.json',record);publish_receipt(m,failure,uid)
  except Exception:pass
 print(json.dumps(failure,separators=(',',':')),flush=True);return failure
if __name__=='__main__':
 try:main()
 except Exception as error:record_failure(error);raise SystemExit(1)
