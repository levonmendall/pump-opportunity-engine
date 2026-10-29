#!/usr/bin/env python3
"""Hash-pinned forward update of the existing original PAPER financial owner.

API: apply <transport-index-sha256>. The same command resumes interrupted work.
The transport index has schemaVersion, kind, sourceCommit, previousSource,
compatibility and files. Its eight exact files are BOUNDS below. Review and pin
the index and this driver independently before root executes verified bytes.
No bootstrap, account initialization, DB restore, secret access or Render call.
"""
import fcntl,grp,hashlib,json,os,pathlib,pwd,re,shlex,sqlite3,stat,subprocess,sys,time,types

OLD_SOURCE={'commit':'a97799e88e4313ed94d0c6b5d250eeeea5f5fdc5','sha256':'a44243b03673f29061db4030524b326b4f8929ff2a7bf5b057807ec1d0af049d'}
OLD_INDEX='fa616981e2a86aec0f9c2711d0b3c961eb5ab922791f49e2a4e7e372497a84dd'
PRIOR_INDEX='0a98a283f798021cb164048123254046fc560fc32927aabd761c15f93125e44d'
PRIOR_RECORD='forward-'+OLD_SOURCE['commit']
OLD_MANIFEST='e7a0c6b95808151c4e1ebd4d6298fe8903068c0779767390d6e609cbd7a9332b'
# Root-indexed validation helper and current financial release have distinct pins.
INDEXED_SUPERVISOR='d90ea175e17ef165afc8a4dcc24ab302204d500aad738bd4554cdc5f32e3d6fb'
OLD_SUPERVISOR='1c993f89ec08c2ec6b8dfa05c5657bd2d572636361c8f32bff3febbeae729a79'
CORE_SHA='2b1eb71355697fbdc9459b2dd354ed869102aa448a1e500b769b57fa91890fab'
AUDITOR_SHA='08947c651488089e2eb2274404e69132ab54cfb89e30a640255c756746dad2c1'
UNCHANGED={'snapshot-publisher.mjs':'2f6e041872681a2dd5c978cfa8addff0fb3619da56e105c94734a8420a6580fa','backup-worker.mjs':'53700fadf7172fd5f85b9f368256b0b6592abfc3a55adce8481812c0c154ea34','better_sqlite3.node':'6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d'}
COMPATIBILITY={'scope':'native-coherent-entry-quotes-and-admission-telemetry-only','financialSchemaChanged':False,'strategyChanged':False,'riskChanged':False}
TOOLS=pathlib.Path('/opt/poe/cutover/issue11')
PACKAGE=pathlib.Path('/var/lib/poe-cutover/issue11')
STAGE=pathlib.Path('/var/tmp/poe-original-entry-clock-upgrade')
UNITDIR=pathlib.Path('/etc/systemd/system/poe-runtime.service.d')
NATIVE_DROPIN_SHA='02086524f05593a85034bf13626f0c2c0a4caac2379cc4ae76cfa92d93d4b682'
LEGACY_SHA='309bba18b7f3f17b403f6ef950df707587044b5e049f47ff3495c87d8de7d4df'
UID,GID,RUNNER=988,982,994
MIB=1024*1024
BOUNDS={'native-paper.mjs':8*MIB,'backup-worker.mjs':MIB,'better_sqlite3.node':4*MIB,'metadata.json':MIB,'snapshot-publisher.mjs':MIB,'run-authoritative-service.py':128*1024,'forward-original-upgrade.py':128*1024,'service.json':128*1024}
class Refused(RuntimeError):pass
def need(value,code):
 if not value:raise Refused(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def hashed(value,n=64):return type(value)is str and re.fullmatch('[0-9a-f]{'+str(n)+'}',value)is not None
def encoded(value):return(json.dumps(value,separators=(',',':'))+'\n').encode()
def now():return int(time.time()*1000)
def read(path,limit,uid=0,gid=None,mode=None):
 # Keep a descriptor-based read even before the reviewed core is loaded.
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and(gid is None or s.st_gid==gid)and(mode is None or stat.S_IMODE(s.st_mode)==mode)and not s.st_mode&0o022 and 0<s.st_size<=limit,'EXACT_BOUNDED_OWNER_FILE_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(raw)==s.st_size and(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns),'INPUT_CHANGED_DURING_READ');return raw
 finally:os.close(fd)
def reviewed_module(name,path,expected):
 raw=read(path,128*1024);need(sha(raw)==expected,'REVIEWED_ROOT_HELPER_HASH_REQUIRED');module=types.ModuleType(name);module.__file__=str(path);exec(compile(raw,str(path),'exec'),module.__dict__);return module
def load_helpers():
 need(os.getuid()==0,'EXISTING_OWNER_ROOT_ACCESS_REQUIRED')
 for path in[PACKAGE.parent,PACKAGE,TOOLS.parent,TOOLS]:
  s=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'CANONICAL_ROOT_HELPER_DIRECTORY_REQUIRED')
 raw=read(PACKAGE/'index.json',128*1024);need(sha(raw)==OLD_INDEX,'PRESERVED_ORIGINAL_PACKAGE_INDEX_REQUIRED');index=json.loads(raw);pins={r['file']:r for r in index['files']}
 for name,digest in [('cutover-original-service.py',CORE_SHA),('audit-original-account.py',AUDITOR_SHA),('run-authoritative-service.py',INDEXED_SUPERVISOR)]:need(pins[name]['sha256']==digest,'ORIGINAL_HELPER_INDEX_BINDING_REQUIRED')
 m=reviewed_module('poe_forward_pinned_core',TOOLS/'cutover-original-service.py',CORE_SHA);m.HERE=TOOLS
 auditor=reviewed_module('poe_forward_pinned_audit',TOOLS/'audit-original-account.py',AUDITOR_SHA)
 supervisor=reviewed_module('poe_forward_old_supervisor',TOOLS/'run-authoritative-service.py',INDEXED_SUPERVISOR)
 attach_stop_observer(m);return m,auditor,supervisor
def bundle(path,uid,expected,driver_sha,supervisor):
 raw=read(path/'index.json',128*1024,uid);need(hashed(expected)and sha(raw)==expected,'REVIEWED_FORWARD_INDEX_PIN_REQUIRED');index=json.loads(raw)
 need(type(index)is dict and set(index)=={'schemaVersion','kind','sourceCommit','previousSource','compatibility','files'}and index['schemaVersion']==1 and index['kind']=='poe-original-forward-upgrade-package-v1'and hashed(index['sourceCommit'],40)and index['sourceCommit']!=OLD_SOURCE['commit']and index['previousSource']==OLD_SOURCE and index['compatibility']==COMPATIBILITY,'EXACT_FORWARD_PACKAGE_IDENTITY_REQUIRED')
 rows=index['files'];need(type(rows)is list and len(rows)==len(BOUNDS)and{r.get('file')for r in rows if type(r)is dict}==set(BOUNDS),'EXACT_FORWARD_PACKAGE_FILES_REQUIRED');data={}
 for row in rows:
  name=row['file'];need(set(row)=={'file','bytes','sha256'}and type(row['bytes'])is int and 0<row['bytes']<=BOUNDS[name]and hashed(row['sha256']),'BOUNDED_FORWARD_FILE_PIN_REQUIRED');body=read(path/name,BOUNDS[name],uid);need(len(body)==row['bytes']and sha(body)==row['sha256'],'FORWARD_PACKAGE_FILE_HASH_REQUIRED');data[name]=body
 need(hashed(driver_sha)and sha(data['forward-original-upgrade.py'])==driver_sha,'INDEPENDENT_VERIFIED_FORWARD_DRIVER_REQUIRED')
 for name,digest in UNCHANGED.items():need(sha(data[name])==digest,'PRESERVED_REPORTER_WORKER_AND_SQLITE_ABI_REQUIRED')
 manifest=supervisor.validate_manifest(json.loads(data['service.json']));need(manifest['source']=={'commit':index['sourceCommit'],'sha256':sha(data['native-paper.mjs'])},'COMPILED_FORWARD_SOURCE_REQUIRED')
 rows={r['file']:r for r in manifest['files']}
 need(set(rows)==set(supervisor.RELEASE_FILES)and all(rows[name]=={'file':name,'bytes':len(data[name]),'sha256':sha(data[name])}for name in rows),'EXACT_NEW_RELEASE_MANIFEST_REQUIRED')
 metadata=json.loads(data['metadata.json']);need(metadata.get('git',{}).get('commit')==index['sourceCommit']and metadata.get('financialMode')=='PAPER'and metadata.get('liveTradingEnabled')is False,'COMPILED_PAPER_METADATA_REQUIRED')
 return index,manifest,data,raw
def preserved_manifest(old,new):
 need(old.get('source')==OLD_SOURCE,'EXACT_OLD_FINANCIAL_SOURCE_REQUIRED')
 need({k:v for k,v in old.items()if k not in['source','files']}=={k:v for k,v in new.items()if k not in['source','files']},'OPERATING_MANIFEST_MUST_BE_PRESERVED')
 for name,digest in UNCHANGED.items():need(next((r['sha256']for r in old['files']if r['file']==name),None)==digest,'CURRENT_REPORTER_HOTFIX_AND_ABI_REQUIRED')
def source_input(raw,old,new,baseline,m):
 value=m.validate_input(json.loads(raw),old,baseline);changed=dict(value);changed['source']=dict(new['source']);need({k:v for k,v in changed.items()if k!='source'}=={k:v for k,v in value.items()if k!='source'},'ONLY_INPUT_SOURCE_MAY_CHANGE');result=encoded(changed);m.validate_input(json.loads(result),new,baseline);return result
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
def attach_stop_observer(m):
 # The indexed 2b1 core predates physical-stop observations. Reuse the exact
 # reviewed 93f continuation routines above with the pinned core globals.
 m.SERVICE_CGROUP=pathlib.Path('/sys/fs/cgroup/system.slice/poe-runtime.service/cgroup.procs')
 for function in[unit_stop_fields,observe_stopped_writer]:setattr(m,function.__name__,types.FunctionType(function.__code__,m.__dict__,function.__name__,function.__defaults__))
def unit():
 keys=['LoadState','User','Group','ActiveState','SubState','MainPID','ControlPID','ExecStart','ExecStop','DropInPaths','KillMode','Restart','NoNewPrivileges','PrivateTmp','ProtectSystem','ProtectHome','ReadWritePaths','UMask','TimeoutStopUSec']
 r=subprocess.run(['/usr/bin/systemctl','show','--all','poe-runtime.service','--property='+','.join(keys)],capture_output=True,text=True,timeout=5,check=False,env={'PATH':'/usr/bin:/bin','LANG':'C'});need(r.returncode==0 and len(r.stdout)<=32768 and len(r.stderr)<=4096,'MERGED_ORIGINAL_UNIT_UNAVAILABLE');v={k:text for line in r.stdout.splitlines()for k,sep,text in[line.partition('=')]if sep and k in keys};need(set(keys)-set(v)<={'ExecStop'},'COMPLETE_MERGED_UNIT_REQUIRED')
 if not v.get('ExecStop'):
  r=subprocess.run(['/usr/bin/busctl','--system','--timeout=3s','--json=short','get-property','org.freedesktop.systemd1','/org/freedesktop/systemd1/unit/poe_2druntime_2eservice','org.freedesktop.systemd1.Service','ExecStop'],capture_output=True,text=True,timeout=5,check=False,env={'PATH':'/usr/bin:/bin','LANG':'C'});need(r.returncode==0 and len(r.stdout)<=8192 and len(r.stderr)<=4096,'TYPED_EMPTY_EXEC_STOP_UNAVAILABLE');typed=json.loads(r.stdout);need(typed=={'type':'a(sasbttttuii)','data':[]},'TYPED_EMPTY_EXEC_STOP_REQUIRED');v['ExecStop']=''
 argv=re.findall(r'argv\[\]=([^;]*);',v['ExecStart']);need(len(argv)==1 and shlex.split(argv[0])==['/usr/bin/python3','-B','-I','/opt/poe/current/operator/native-paper-ec2/run-authoritative-service.py']and v['ExecStop']=='','SAME_NATIVE_ENTRYPOINT_AND_EMPTY_STOP_REQUIRED')
 expected={'LoadState':'loaded','User':'poe-runtime','Group':'poe-runtime','KillMode':'mixed','Restart':'always','NoNewPrivileges':'yes','PrivateTmp':'yes','ProtectSystem':'strict','ProtectHome':'yes','UMask':'0077','TimeoutStopUSec':'1min'};need(all(v.get(k)==text for k,text in expected.items()),'PRESERVED_ORIGINAL_SANDBOX_REQUIRED')
 need(set(shlex.split(v['ReadWritePaths']))=={'/var/lib/poe','/run/poe','-/var/lib/poe-public'},'FIXED_ORIGINAL_WRITABLE_PATHS_REQUIRED');need(shlex.split(v['DropInPaths'])==[str(UNITDIR/name)for name in['00-legacy-entrypoint.conf','90-native-engine.conf','reporting.conf']],'EXACT_ORDERED_ORIGINAL_DROPINS_REQUIRED')
 return{k:v[k]for k in keys if k not in['ExecStart','ExecStop','ReadWritePaths','DropInPaths']}
def local_preflight(m,auditor,supervisor):
 owner=pwd.getpwnam('poe-runtime');need((owner.pw_uid,owner.pw_gid)==(UID,GID)and grp.getgrnam('poe-runtime').gr_gid==GID and pwd.getpwuid(UID).pw_name=='poe-runtime'and grp.getgrgid(GID).gr_name=='poe-runtime','EXACT_EXISTING_UID_988_GID_982_REQUIRED')
 # The pinned existing host verifier makes only its two local IMDS identity
 # requests; there is no market/provider RPC or Render request in this helper.
 uid,gid,_=m.validate_host(auditor,supervisor);need((uid,gid)==(UID,GID),'EXACT_ORIGINAL_RUNTIME_OWNER_REQUIRED')
 for path in[m.ACCOUNT,m.SERVICE]:m.directory(path,UID,True);need(path.lstat().st_gid==GID,'EXISTING_ACCOUNT_DIRECTORY_GROUP_REQUIRED')
 m.directory(UNITDIR,0);need(sha(read(m.DROPIN,8192,0,0,0o644))==NATIVE_DROPIN_SHA and sha(read(UNITDIR/'00-legacy-entrypoint.conf',8192,0,0,0o644))==LEGACY_SHA,'UNCHANGED_NATIVE_AND_LEGACY_DROPINS_REQUIRED')
 reporting=read(UNITDIR/'reporting.conf',8192,0,0,0o644);directives=[]
 for line in reporting.decode().splitlines():
  text=line.strip()
  if text and not text.startswith(('#',';','[')):directives.append(text.partition('=')[0].strip())
 need(directives and all(k in['LoadCredential','LoadCredentialEncrypted']for k in directives),'REPORTING_DROPIN_EXECUTION_OVERRIDE_REFUSED')
 merged=unit()
 if merged['ActiveState']=='active':
  process_owner(merged)
 else:need((merged['ActiveState'],merged['SubState'])in[('inactive','dead'),('failed','failed')],'KNOWN_ORIGINAL_TERMINAL_STATE_REQUIRED')
 for suffix in['','-wal','-shm','-journal','.owner.lock']:
  path=pathlib.Path(str(m.LEDGER)+suffix)
  if os.path.lexists(path):need(path.resolve(strict=True)==path and path.lstat().st_gid==GID,'ORIGINAL_LEDGER_AUXILIARY_GROUP_REQUIRED');auditor.file_metadata(path,UID,True)
 return merged
def process_owner(merged):
 need(merged['ActiveState']=='active'and merged['SubState']=='running'and merged['MainPID'].isdigit()and int(merged['MainPID'])>0,'KNOWN_ORIGINAL_RUNNING_STATE_REQUIRED');proc=pathlib.Path('/proc')/merged['MainPID'];need(proc.stat().st_uid==UID,'ORIGINAL_SUPERVISOR_PROCESS_OWNER_REQUIRED')
 with(proc/'status').open('rb')as handle:raw=handle.read(32769)
 need(len(raw)<=32768,'SUPERVISOR_CREDENTIALS_BOUND');v={line.partition(':')[0]:line.partition(':')[2].split()for line in raw.decode().splitlines()if line.startswith(('Uid:','Gid:'))};need(v.get('Uid')==[str(UID)]*4 and v.get('Gid')==[str(GID)]*4,'ORIGINAL_SUPERVISOR_UID_GID_REQUIRED')
def keep_file(m,path,raw,uid=0,gid=0,mode=0o600):
 if os.path.lexists(path):need(read(path,max(len(raw),1),uid,gid,mode)==raw,'RETAINED_FORWARD_IMAGE_CHANGED')
 else:m.atomic(path,raw,uid,gid,mode)
def freeze(m,directory,index_raw,data):
 m.make_dir(directory,0,0,0o700)
 need(set(p.name for p in directory.iterdir())<=set(BOUNDS)|{'index.json'},'UNKNOWN_FORWARD_PACKAGE_FILES_REFUSED')
 for name,raw in data.items():keep_file(m,directory/name,raw)
 keep_file(m,directory/'index.json',index_raw)
def release(m,target,data,manifest,supervisor):
 m.make_dir(target,0,GID,0o750)
 need(set(p.name for p in target.iterdir())<=set(supervisor.RELEASE_FILES)|{'operator'},'UNKNOWN_PARTIAL_RELEASE_FILES_REFUSED')
 for name in supervisor.RELEASE_FILES:keep_file(m,target/name,data[name],0,GID,0o640)
 m.make_dir(target/'operator',0,GID,0o750);m.make_dir(target/'operator/native-paper-ec2',0,GID,0o750)
 for path in[target,target/'operator',target/'operator/native-paper-ec2']:
  st=path.lstat();need(st.st_gid==GID and stat.S_IMODE(st.st_mode)==0o750,'EXACT_RELEASE_DIRECTORY_GROUP_AND_MODE_REQUIRED')
 keep_file(m,target/'operator/native-paper-ec2/run-authoritative-service.py',data['run-authoritative-service.py'],0,GID,0o640);supervisor.release_verified(manifest)
def copy_records(m,source,target):
 """Preserve the existing root records; never follow symlinks or copy secrets."""
 m.make_dir(target,0,0,0o700);rows=[];total=0
 for path in sorted(source.rglob('*')):
  need(len(rows)<256 and path.resolve(strict=True)==path,'BOUNDED_CANONICAL_ROOT_RECORDS_REQUIRED');relative=path.relative_to(source);dest=target/relative
  if path.is_dir():m.directory(path,0,True);m.make_dir(dest,0,0,0o700);continue
  body=read(path,2*MIB);total+=len(body);need(total<=32*MIB,'ROOT_RECORDS_BACKUP_BOUND');keep_file(m,dest,body);rows.append({'file':str(relative),'bytes':len(body),'sha256':sha(body)})
 keep_file(m,target/'retained-record-index.json',encoded(rows));return rows
def graceful(proof):
 v=proof.get('unitAfter')or{};return proof.get('physicalWriterSettled')is True and v.get('ActiveState')=='inactive'and v.get('SubState')=='dead'and v.get('Result')=='success'and v.get('ExecMainCode')=='1'and v.get('ExecMainStatus')=='0'
def native_stop_receipt(m,record):
 value=json.loads(read(m.ACCOUNT/'status.json',4*MIB,UID,GID,0o600));source=value.get('source');source_pin={k:source.get(k)for k in['commit','sha256']}if type(source)is dict else None;need(value.get('accountId')==m.ACCOUNT_ID and value.get('inceptionAt')==m.INCEPTION and source_pin in[OLD_SOURCE,record['source']]and value.get('running')is False and type(value.get('generatedAt'))is int and record['stopRequestedAt']<=value['generatedAt']<=now()+5000 and value.get('status')=='graceful service stop; exposure and obligations retained','NATIVE_GRACEFUL_FINAL_CHECKPOINT_REQUIRED')
 run=value.get('runId');need(type(run)is str and re.fullmatch('native-paper-[0-9]{17}',run)is not None,'ACTUAL_STOPPED_NATIVE_RUN_REQUIRED');settlement=json.loads(read(m.ACCOUNT/'runs'/run/'settlement.json',4096,UID,GID,0o600));need(settlement.get('physicalSettlementConfirmed')is True and settlement.get('financialHistoryPreserved')is True and type(settlement.get('at'))is int and record['stopRequestedAt']<=settlement['at']<=now()+5000 and all(type(settlement.get(k))is int and settlement[k]>=0 for k in['positions','pending']),'NATIVE_PHYSICAL_TRANSPORT_SETTLEMENT_REQUIRED')
 return{**{k:value[k]for k in['accountId','inceptionAt','runId','running','generatedAt','status']},'source':source_pin,'settlement':settlement}
def operating_image(m):
 body=read(m.ACCOUNT/'operating.json',8*MIB,UID,GID,0o600);value=json.loads(body);need(value.get('schemaVersion')==1 and value.get('accountId')==m.ACCOUNT_ID and value.get('inceptionAt')==m.INCEPTION and value.get('authoritative')is True and value.get('experimental')is False and type(value.get('runs'))is list,'EXISTING_OPERATING_HISTORY_REQUIRED');return body
def selected_runtime(m):
 result={}
 for name,path,maximum,keys in[('status',m.ACCOUNT/'status.json',4*MIB,['accountId','inceptionAt','generatedAt','runtimePid','startedAt','running','configurationSha256','inputFileSha256','entriesEnabled']),('health',m.SERVICE/'health.json',128*1024,['generatedAt','sourcePid','publisherPid','lastSourceAt','lastAcceptedSourceAt','matchedSourceAcknowledgements','outputErrors'])]:
  try:
   value=json.loads(read(path,maximum,UID,GID,0o600));row={k:value[k]for k in keys if k in value and(type(value[k])in[int,bool]or value[k]is None or type(value[k])is str and len(value[k])<=128)}
   if name=='status':
    need(value.get('accountId')==m.ACCOUNT_ID and value.get('inceptionAt')==m.INCEPTION,'CURRENT_ORIGINAL_STATUS_REQUIRED');row['source']={k:value['source'][k]for k in['commit','sha256']if hashed(value.get('source',{}).get(k),40 if k=='commit'else 64)}
    for group in['sourceRecovery','serviceSupervision','reporting','sourceTimes','timing','independentPredictive','funnel','refusals']:
     if type(value.get(group))is dict:row[group]={k:v for k,v in value[group].items()if type(v)in[int,bool,float]or v is None}
   result[name]={'available':True,**row}
  except Exception:result[name]={'available':False,'reasonCode':'BOUNDED_CURRENT_RUNTIME_PROJECTION_UNAVAILABLE'}
 return result
def install_images(m,record_dir,new):
 prefix='after-'if new else'before-';m.atomic(m.ACCOUNT/'input.json',read(record_dir/(prefix+'input.json'),MIB),UID,GID);m.atomic(m.MANIFEST,read(record_dir/(prefix+'service.json'),128*1024),0,GID,0o640)
def known_images(m,record_dir):
 for path,name,limit,uid,gid,mode in[(m.MANIFEST,'service.json',128*1024,0,GID,0o640),(m.ACCOUNT/'input.json','input.json',MIB,UID,GID,0o600)]:
  body=read(path,limit,uid,gid,mode);need(body in[read(record_dir/('before-'+name),limit),read(record_dir/('after-'+name),limit)],'UNKNOWN_CURRENT_CONFIGURATION_REFUSED')
def recover_old(m,auditor,supervisor,record_dir,record,expected_inode):
 need(not record.get('startRequestedAt')and not record.get('possibleNewSourceStart'),'NEW_SOURCE_MAY_HAVE_RUN_RETAIN_NEW_FINANCIAL_MANAGER');known_images(m,record_dir)
 current=m.CURRENT.resolve(strict=True);need(current in[m.RELEASES/OLD_SOURCE['commit'],m.RELEASES/record['source']['commit']],'UNKNOWN_CURRENT_RELEASE_REFUSED')
 # This recovery is used only within an attempt which has not requested a new
 # start. stopped_phase has already released the DB lease before entering it.
 old=json.loads(read(record_dir/'before-service.json',128*1024));supervisor.release_verified(old);need(sha(read(m.RELEASES/OLD_SOURCE['commit']/'operator/native-paper-ec2/run-authoritative-service.py',128*1024,0,GID,0o640))==OLD_SUPERVISOR,'OLD_FINANCIAL_SUPERVISOR_REQUIRED')
 if record.get('configurationMutationIntent'):
  # stopped_phase releases its lease before recover(). Acquire a fresh lease
  # and physical proof here; a prior proof cannot authorize current writes.
  owner=m.lease()
  try:
   proof=m.observe_stopped_writer();need(proof.get('physicalWriterSettled')is True,'RECOVERY_REQUIRES_FRESH_PHYSICAL_STOP');record['recoveryStopProof']=proof;m.original_audit(auditor,expected_inode);install_images(m,record_dir,False);m.switch_current(m.RELEASES/OLD_SOURCE['commit']);m.systemctl('daemon-reload')
  finally:os.close(owner)
 need(m.CURRENT.resolve(strict=True)==m.RELEASES/OLD_SOURCE['commit']and read(m.MANIFEST,128*1024,0,GID,0o640)==read(record_dir/'before-service.json',128*1024)and read(m.ACCOUNT/'input.json',MIB,UID,GID,0o600)==read(record_dir/'before-input.json',MIB),'OLD_FINANCIAL_RECOVERY_IMAGES_MUST_BE_EXACT');m.original_audit(auditor,expected_inode);unit();m.systemctl('start','poe-runtime.service');record.update(phase='old-financial-source-resumed-before-new-start',recoveredAt=now(),oldFinancialSource=OLD_SOURCE,reporterHotfixPreserved=True);m.write_json(record_dir/'transition.json',record)
def apply(expected,m,auditor,supervisor,driver_sha):
 need(os.getuid()==0 and hashed(driver_sha),'INDEPENDENT_OWNER_ROOT_DRIVER_PIN_REQUIRED');merged=local_preflight(m,auditor,supervisor)
 # Read the staged index before choosing the fixed root destination. A frozen
 # copy makes recovery independent of runner files after first preparation.
 choices=[]
 for path in PACKAGE.parent.glob('forward-*'):
  m.directory(path,0,True)
  if os.path.lexists(path/'index.json')and sha(read(path/'index.json',128*1024))==expected:choices.append(path)
 need(len(choices)<=1,'ONE_EXACT_RETAINED_FORWARD_PACKAGE_REQUIRED')
 if choices:index,manifest,data,index_raw=bundle(choices[0],0,expected,driver_sha,supervisor)
 else:m.directory(STAGE,RUNNER,True);index,manifest,data,index_raw=bundle(STAGE,RUNNER,expected,driver_sha,supervisor)
 commit=index['sourceCommit'];target=m.RELEASES/commit;frozen=PACKAGE.parent/('forward-'+commit);record_dir=m.RECORDS/('forward-'+commit);prior_dir=m.RECORDS/PRIOR_RECORD;m.directory(prior_dir,0,True);prior_raw=read(prior_dir/'transition.json',128*1024);prior=json.loads(prior_raw)
 need(prior.get('kind')=='poe-original-forward-upgrade-v1'and prior.get('accountId')==m.ACCOUNT_ID and prior.get('inceptionAt')==m.INCEPTION and prior.get('source')==OLD_SOURCE and prior.get('packageIndexSha256')==PRIOR_INDEX,'PRESERVED_PREVIOUS_FORWARD_RECORD_REQUIRED');inode=m.LEDGER.lstat();expected_inode=(inode.st_dev,inode.st_ino)
 prefix=m.verify_live_financial_prefix(auditor,prior['stoppedFinancial'],prior['backup']);financial=m.original_audit(auditor,expected_inode)
 m.directory(m.BACKUPS,0,True);need(os.statvfs(m.ROOT).f_bavail*os.statvfs(m.ROOT).f_frsize>=1024*MIB,'FORWARD_UPGRADE_DISK_HEADROOM_REQUIRED')
 existing=os.path.lexists(record_dir/'transition.json')
 if existing:
  m.directory(record_dir,0,True);record=json.loads(read(record_dir/'transition.json',128*1024));need(record.get('kind')=='poe-original-forward-upgrade-v1'and record.get('packageIndexSha256')==expected and record.get('driverSha256')==driver_sha and record.get('source')==manifest['source']and tuple(record.get('ledgerIdentity',[]))==expected_inode,'EXACT_RECORDED_FORWARD_UPGRADE_REQUIRED');known_images(m,record_dir);old_raw=read(record_dir/'before-service.json',128*1024);need(sha(old_raw)==OLD_MANIFEST,'PRESERVED_CURRENT_REPORTER_MANIFEST_REQUIRED');old=supervisor.validate_manifest(json.loads(old_raw));preserved_manifest(old,manifest);need(read(record_dir/'after-service.json',128*1024)==data['service.json'],'RETAINED_NEW_MANIFEST_REQUIRED');baseline=read(m.ACCOUNT/'research-baseline.json',512*1024,UID,GID,0o600);need(source_input(read(record_dir/'before-input.json',MIB),old,manifest,baseline,m)==read(record_dir/'after-input.json',MIB),'RETAINED_INPUT_PRESERVATION_REQUIRED')
 else:
  need(m.CURRENT.resolve(strict=True)==m.RELEASES/OLD_SOURCE['commit']and merged['ActiveState']=='active','RUNNING_SAME_ORIGINAL_FINANCIAL_SERVICE_REQUIRED');old_raw=read(m.MANIFEST,128*1024,0,GID,0o640);need(sha(old_raw)==OLD_MANIFEST,'CURRENT_REPORTER_REPAIRED_MANIFEST_PIN_REQUIRED');old=supervisor.validate_manifest(json.loads(old_raw));preserved_manifest(old,manifest);supervisor.release_verified(old)
  for row in old['files']:read(m.RELEASES/OLD_SOURCE['commit']/row['file'],BOUNDS[row['file']],0,GID,0o640)
  need(sha(read(m.RELEASES/OLD_SOURCE['commit']/'operator/native-paper-ec2/run-authoritative-service.py',128*1024,0,GID,0o640))==OLD_SUPERVISOR,'CURRENT_OLD_SUPERVISOR_PIN_REQUIRED');before_input=read(m.ACCOUNT/'input.json',MIB,UID,GID,0o600);baseline=read(m.ACCOUNT/'research-baseline.json',512*1024,UID,GID,0o600);after_input=source_input(before_input,old,manifest,baseline,m)
  # All root before/after images precede every service/configuration mutation.
  m.make_dir(record_dir,0,0,0o700)
  for name,raw in [('before-service.json',old_raw),('after-service.json',data['service.json']),('before-input.json',before_input),('after-input.json',after_input),('before-research-baseline.json',baseline),('before-native-dropin.conf',read(m.DROPIN,8192)),('before-legacy-entrypoint.conf',read(UNITDIR/'00-legacy-entrypoint.conf',8192))]:keep_file(m,record_dir/name,raw)
  before_operating=read(record_dir/'before-operating.json',8*MIB)if os.path.lexists(record_dir/'before-operating.json')else operating_image(m);keep_file(m,record_dir/'before-operating.json',before_operating);copied=copy_records(m,prior_dir,record_dir/'prior-root-records');record={'schemaVersion':1,'kind':'poe-original-forward-upgrade-v1','accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'previousSource':OLD_SOURCE,'source':manifest['source'],'packageIndexSha256':expected,'driverSha256':driver_sha,'at':now(),'phase':'root-before-and-after-images-retained','ledgerIdentity':list(expected_inode),'ledgerPath':str(m.LEDGER),'beforeFinancial':financial,'originalFinancialPrefix':prefix,'priorTransitionSha256':sha(prior_raw),'copiedPriorRootRecords':copied,'unitBefore':merged,'selectedRuntimeBefore':selected_runtime(m),'beforeOperatingSha256':sha(before_operating),'operatingHistoryRestored':False,'compatibility':COMPATIBILITY,'hostIdentityMetadataRequests':2,'providerRequests':0,'financialHistoryReset':False,'backupRestored':False,'capitalInitialized':False,'operationalAcceptance':False,'inputTransition':{'preparedInputSha256':sha(before_input),'installedInputSha256':sha(after_input),'field':'source','allOtherInputFieldsPreserved':True},'subsequentCodexReadinessGate':'Update and verify the SAME Render receiver expected financial source, then prove fresh original-channel acceptance. This helper does not contact Render or certify operations.'};m.write_json(record_dir/'transition.json',record)
 freeze(m,frozen,index_raw,data);release(m,target,data,manifest,supervisor)
 # A durable start intent is never cleared. Even a start timeout can mean that
 # financial effects occurred, so subsequent runs only retain/check new code.
 if record.get('startRequestedAt'):
  need(m.CURRENT.resolve(strict=True)==target and read(m.MANIFEST,128*1024,0,GID,0o640)==data['service.json']and read(m.ACCOUNT/'input.json',MIB,UID,GID,0o600)==read(record_dir/'after-input.json',MIB),'STARTED_NEW_MANAGER_CONFIGURATION_MUST_BE_RETAINED')
  if merged['ActiveState']!='active':record['verificationNotBefore']=now();m.write_json(record_dir/'transition.json',record)
  m.systemctl('start','poe-runtime.service')
 else:
  # A prior process could have died after switching current; a reboot could
  # then have run the new source. Conservatively keep the new manager on error.
  record['possibleNewSourceStart']=record.get('possibleNewSourceStart')is True or m.CURRENT.resolve(strict=True)==target or(existing and(record.get('configurationMutationIntent')is True or read(m.MANIFEST,128*1024,0,GID,0o640)==data['service.json']))
  need(len(list(record_dir.glob('phase-*.json')))<50,'PHASE_RECEIPT_CAPACITY_REQUIRED_BEFORE_STOP');attempt=record.get('attempt',0)+1;need(type(attempt)is int and 1<=attempt<=10,'BOUNDED_FORWARD_ATTEMPTS_REQUIRED');backup_dir=m.BACKUPS/(record_dir.name+'-'+str(attempt).zfill(2));live_backup_dir=backup_dir.with_name(backup_dir.name+'-live');need(not os.path.lexists(backup_dir)and not os.path.lexists(live_backup_dir),'FRESH_FORWARD_BACKUP_DIRECTORY_REQUIRED');record.pop('stopProof',None);record.update(attempt=attempt,configurationMutationIntent=False,phase='fresh-backup-attempt-allocated',backupDirectory=str(backup_dir));m.write_json(record_dir/'transition.json',record);m.make_dir(backup_dir,0,0,0o700);m.make_dir(live_backup_dir,0,0,0o700);prestop=m.snapshot_backup(live_backup_dir/'ledger.sqlite',auditor,None);preproof=m.verify_live_financial_prefix(auditor,prestop['financial'],prestop);record.update(phase='fresh-live-backup-and-full-prefix-verified',beforeStopVerifiedBackup=prestop,beforeStopPrefix=preproof,stopRequestedAt=now());m.write_json(record_dir/'transition.json',record)
  def recover():
   if record.get('possibleNewSourceStart'):
    # Do not downgrade an interrupted/rebooted new financial source. Complete
    # known new images only after this attempt actually proved settlement.
    need(record.get('stopProof',{}).get('physicalWriterSettled')is True,'POSSIBLE_NEW_MANAGER_STOP_UNPROVED_OWNER_ACTION_REQUIRED');owner=m.lease()
    try:
     proof=m.observe_stopped_writer();need(proof.get('physicalWriterSettled')is True,'NEW_MANAGER_RECOVERY_REQUIRES_FRESH_PHYSICAL_STOP');record['recoveryStopProof']=proof;m.original_audit(auditor,expected_inode);m.verify_live_financial_prefix(auditor,prior['stoppedFinancial'],prior['backup']);install_images(m,record_dir,True);m.switch_current(target);m.systemctl('daemon-reload');record.update(phase='interrupted-new-financial-manager-retained',startRequestedAt=now());m.write_json(record_dir/'transition.json',record)
    finally:os.close(owner)
    m.systemctl('start','poe-runtime.service')
   else:recover_old(m,auditor,supervisor,record_dir,record,expected_inode)
  def install():
   proof=m.observe_stopped_writer();record.update(phase='physical-stop-observed',stopProof=proof);m.write_json(record_dir/'transition.json',record);need(proof.get('physicalWriterSettled')is True,'PHYSICAL_ORIGINAL_WRITER_SETTLEMENT_REQUIRED');need(graceful(proof),'GRACEFUL_FINANCIAL_OWNER_STOP_REQUIRED');record['nativeGracefulStop']=native_stop_receipt(m,record);stable=m.original_audit(auditor,expected_inode);m.verify_live_financial_prefix(auditor,prior['stoppedFinancial'],prior['backup']);m.verify_live_financial_prefix(auditor,prestop['financial'],prestop);backup=m.snapshot_backup(backup_dir/'ledger.sqlite',auditor,stable);stopped_operating=operating_image(m);keep_file(m,record_dir/('stopped-operating-'+str(attempt).zfill(2)+'.json'),stopped_operating);record.update(phase='stopped-owner-backup-and-prefix-verified',stoppedAt=now(),stoppedFinancial=stable,backup=backup,stoppedOperatingSha256=sha(stopped_operating),exposureAtHandoff={k:stable[k]for k in['openPositions','pendingActions','lockedDepositLamports','positionsStateSha256','pendingStateSha256']});m.write_json(record_dir/'transition.json',record)
   known_images(m,record_dir);need(read(m.ACCOUNT/'research-baseline.json',512*1024,UID,GID,0o600)==read(record_dir/'before-research-baseline.json',512*1024),'ACCOUNTING_BASELINE_CHANGED');record.update(phase='configuration-install-intent',configurationMutationIntent=True);m.write_json(record_dir/'transition.json',record);install_images(m,record_dir,True);m.switch_current(target);m.systemctl('daemon-reload');unit();record.update(phase='new-source-installed-not-started',installedAt=now());m.write_json(record_dir/'transition.json',record)
  m.stopped_phase(install,recover)
  record.update(phase='new-financial-source-start-intent',startRequestedAt=now());m.write_json(record_dir/'transition.json',record);m.systemctl('start','poe-runtime.service')
 need((m.LEDGER.lstat().st_dev,m.LEDGER.lstat().st_ino)==expected_inode,'ORIGINAL_LEDGER_INODE_CHANGED');post_record=dict(record);post_record['startRequestedAt']=max(record['startRequestedAt'],record.get('verificationNotBefore',0));verification,post=m.post_start_verification(manifest,post_record,auditor,UID,GID);post_unit=unit();process_owner(post_unit);record.update(phase='new-source-post-start-prefix-verified-render-gate-pending'if verification['complete']else'new-source-retained-post-start-verification-incomplete',postStartVerification=verification,postStartFinancial=post,unitAfter=post_unit,selectedRuntimeAfter=selected_runtime(m),verifiedAt=now());record['interruption']={'stopRequestedAt':record.get('stopRequestedAt'),'physicalStopVerifiedAt':record.get('stoppedAt'),'startRequestedAt':record['startRequestedAt'],'localVerificationAt':record['verifiedAt'],'stopToStartMs':None if not record.get('stoppedAt')else record['startRequestedAt']-record['stoppedAt'],'observedNewSource':verification.get('newPublicSource'),'continuousCoverageClaimed':False};m.write_json(record_dir/'transition.json',record)
 result={'schemaVersion':1,'kind':'POE_ORIGINAL_FORWARD_UPGRADE_RESULT','phase':record['phase'],'accountId':m.ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','source':manifest['source'],'previousSource':OLD_SOURCE,'complete':verification['complete'],'verification':verification,'interruption':record['interruption'],'renderReadinessGate':record['subsequentCodexReadinessGate'],'financialHistoryReset':False,'backupRestored':False,'operationalAcceptance':False};raw=encoded(result);need(len(raw)<=16384,'BOUNDED_PUBLIC_FORWARD_RECEIPT_REQUIRED');m.directory(m.PUBLIC_STATUS.parent,UID);need(stat.S_IMODE(m.PUBLIC_STATUS.parent.lstat().st_mode)==0o755,'EXISTING_PUBLIC_STATUS_DIRECTORY_REQUIRED');m.atomic(m.PUBLIC_STATUS.parent/'upgrade-verification.json',raw,0,0,0o644);print(raw.decode(),end='',flush=True);need(verification['complete'],'NEW_FINANCIAL_MANAGER_RETAINED_POST_START_VERIFICATION_INCOMPLETE');return result
def main():
 need(os.getuid()==0 and len(sys.argv)==3 and sys.argv[1]=='apply'and hashed(sys.argv[2]),'EXPLICIT_ROOT_FORWARD_OPERATION_AND_INDEX_PIN_REQUIRED');driver_sha=globals().get('__poe_verified_driver_sha256__');need(hashed(driver_sha),'INDEPENDENT_IN_MEMORY_DRIVER_VERIFICATION_REQUIRED');os.umask(0o077);m,auditor,supervisor=load_helpers();m.directory(m.ETC,0);fd=os.open(m.ETC/'cutover.owner.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600,'EXISTING_ROOT_MAINTENANCE_LOCK_REQUIRED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);apply(sys.argv[2],m,auditor,supervisor,driver_sha)
 finally:os.close(fd)
if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error);code=code if code and len(code)<=128 and all(c in'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'for c in code)else'FORWARD_UPGRADE_LOCAL_PRECONDITION_OR_OPERATION_UNAVAILABLE';print(json.dumps({'kind':'POE_ORIGINAL_FORWARD_UPGRADE_REFUSED','reasonCode':code,'financialHistoryReset':False,'backupRestored':False,'newSourceMayRequireContinuedFinancialManagement':True,'recovery':'Preserve the ledger, root images and current financial manager. Rerun the same verified apply command after the named blocker is resolved; never bootstrap or use observer rollback.','operationalAcceptance':False}),flush=True);raise SystemExit(1)
