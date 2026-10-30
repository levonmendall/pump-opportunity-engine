#!/usr/bin/env python3
"""Fixed read-only original-service lifecycle metadata; no financial/secret access."""
import grp,hashlib,json,os,pathlib,pwd,re,stat,subprocess,time
FIELDS=['LoadState','ActiveState','SubState','MainPID','ControlPID','NRestarts','User','Group','Result','ExecMainPID','ExecMainCode','ExecMainStatus','ExecMainStartTimestamp','ExecMainExitTimestamp','ActiveEnterTimestamp','InactiveEnterTimestamp','StateChangeTimestamp','ControlGroup','TasksCurrent','Job','Restart','RootDirectory','RootImage','PrivateMounts','PrivateTmp','TemporaryFileSystem','BindPaths','BindReadOnlyPaths','ReadWritePaths','ReadOnlyPaths','InaccessiblePaths']
PERFORMANCE_FIELDS=['CPUQuotaPerSecUSec','CPUQuotaPeriodUSec','CPUWeight','Nice','MemoryHigh','MemoryMax','MemorySwapMax','TasksMax','LimitNOFILE','LimitAS','OOMPolicy','IOWeight','CPUAffinity','AllowedCPUs','ProtectSystem','ReadWritePaths']
FIELDS+=[k for k in PERFORMANCE_FIELDS if k not in FIELDS]
def command(args,limit=65536):
 try:r=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,timeout=5,check=False,env={'PATH':'/usr/bin:/bin','LANG':'C'})
 except subprocess.TimeoutExpired:return {'timedOut':True},''
 if len(r.stdout)>limit or len(r.stderr)>8192:raise RuntimeError('METADATA_BOUND')
 return {'exitCode':r.returncode,'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr),'stdoutSha256':hashlib.sha256(r.stdout).hexdigest(),'stderrSha256':hashlib.sha256(r.stderr).hexdigest()},r.stdout.decode('utf8','replace')
def read_public():
 p=pathlib.Path('/var/lib/poe-public/status.json');f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(f);assert stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==pwd.getpwnam('poe-runtime').pw_uid and stat.S_IMODE(s.st_mode)==0o644 and 0<s.st_size<=4096
  raw=os.read(f,s.st_size+1);assert len(raw)==s.st_size;v=json.loads(raw)
  return {'sha256':hashlib.sha256(raw).hexdigest(),**{k:v.get(k)for k in['accountId','inceptionAt','release','strategy','generatedAt','entriesDisabled','flowVerified','mode','liveTrading','blocker','shortlistCount','feedConnected','lastUsefulProgressAt','lastReconciledAt','lastMigrationReceivedAt','reportingConfigured']}}
 finally:os.close(f)
def public_reporting_receipt(name,maximum):
 p=pathlib.Path('/var/lib/poe-public')/name
 try:
  f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   t=os.fstat(f);assert stat.S_ISREG(t.st_mode)and t.st_nlink==1 and t.st_uid in[0,pwd.getpwnam('poe-runtime').pw_uid]and stat.S_IMODE(t.st_mode)==0o644 and 0<t.st_size<=maximum
   raw=os.read(f,t.st_size+1);assert len(raw)==t.st_size
  finally:os.close(f)
  v=json.loads(raw);assert v.get('accountId')=='poe-3123e352-4581-455b-85db-acd7e825e99e'and v.get('inceptionAt')=='2026-10-26T22:07:36.212Z'
  return{'available':True,'sha256':hashlib.sha256(raw).hexdigest(),'value':v}
 except(OSError,ValueError,AssertionError)as error:
  result={'available':False,'errorType':type(error).__name__,'errno':getattr(error,'errno',None)}
  try:
   t=p.lstat();result['metadata']={'uid':t.st_uid,'gid':t.st_gid,'modeOctal':oct(stat.S_IMODE(t.st_mode)),'regular':stat.S_ISREG(t.st_mode),'links':t.st_nlink,'bytes':t.st_size}
  except OSError as stat_error:result['metadataErrno']=stat_error.errno
  return result
FORENSIC_NAME='source-recovery-forensics-20261029.json'
FORENSIC_SCRIPT_SHA='4fab80d8ce4a1a39d33a37a3a3d9570ae841614abe1cfe4dd3a006db538c3986'
FORENSIC_SOURCE={'commit':'f96f02eeccd56dda6ce811bdc4405f237224c54f','sha256':'b3ec5aa43b877a4c5ff44f6217be32a4539766c351deb143d557894ccb118ec9'}
FORENSIC_CONFIG='acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf'
FORENSIC_RUNS=('native-paper-20261029183807362','native-paper-20261029185051115')
FORENSIC_STATIC_REASONS={'source-exit','runtime failure; financial exposure retained','source recovery requested; financial checkpoint preserved','graceful service stop; exposure and obligations retained','graceful research stop; exposure and obligations retained','bounded interval completed; monitoring interruption checkpointed','source exited; retained-obligation restart','critical rolling source resource pressure; exposure retained','critical resource or stale runtime; durable recovery required'}
def forensic_hash(v):return type(v)is str and re.fullmatch('[a-f0-9]{64}',v)is not None
def forensic_number(v):return type(v)in(int,float)and -9007199254740991<=v<=9007199254740991 and v==v and v not in(float('inf'),float('-inf'))
def forensic_fields(v,allowed,required=()):
 assert type(v)is dict and set(required)<=set(v)<=set(allowed)
 return v
def forensic_scalars(v,allowed):
 forensic_fields(v,allowed);assert all(type(x)is bool or forensic_number(x)or x is None for x in v.values());return v
def forensic_reason(v):
 forensic_fields(v,{'code','sha256'},{'code','sha256'});assert(v['code']is None and v['sha256']is None)or(forensic_hash(v['sha256'])and type(v['code'])is str and(v['code']in FORENSIC_STATIC_REASONS or re.fullmatch('[A-Z][A-Z0-9_]{0,127}',v['code'])))
 return v
def validate_forensic_projection(v):
 keys={'schemaVersion','kind','generatedAt','accountId','inceptionAt','source','configurationSha256','readerUid','readerGid','financialDatabaseOpened','financialWrites','serviceControlOperations','credentialReads','window','runs','diagnostics','limitations'}
 forensic_fields(v,keys,keys);assert v['schemaVersion']==1 and v['kind']=='POE_ORIGINAL_SOURCE_RECOVERY_FORENSICS'and v['accountId']=='poe-3123e352-4581-455b-85db-acd7e825e99e'and v['inceptionAt']==1793052456212 and v['source']==FORENSIC_SOURCE and v['configurationSha256']==FORENSIC_CONFIG and v['readerUid']==988 and v['readerGid']==982 and v['financialDatabaseOpened']is False and v['financialWrites']==0 and v['serviceControlOperations']==0 and v['credentialReads']==0 and type(v['generatedAt'])is int and v['generatedAt']>0 and v['window']=={'fromAt':1793299740000,'untilAtExclusive':1793299920000}
 assert type(v['limitations'])is list and len(v['limitations'])<=8 and all(type(x)is str and len(x)<=512 for x in v['limitations'])
 assert type(v['runs'])is list and len(v['runs'])==2
 for row,run in zip(v['runs'],FORENSIC_RUNS):
  forensic_fields(row,{'runId','result','settlement'},{'runId','result','settlement'});assert row['runId']==run
  result=row['result'];assert type(result)is dict and type(result.get('available'))is bool
  if result['available']:
   allowed={'runId','available','source','configurationSha256','runtimePid','startedAt','generatedAt','running','entriesEnabled','statusReason','safety','funnel','proofPreparation','sourceRecovery','fileSha256'};forensic_fields(result,allowed,{'runId','available','source','configurationSha256','statusReason','safety','funnel','proofPreparation','sourceRecovery','fileSha256'});assert result['runId']==run and result['source']==FORENSIC_SOURCE and result['configurationSha256']==FORENSIC_CONFIG and forensic_hash(result['fileSha256']);forensic_scalars({k:result[k]for k in('runtimePid','startedAt','generatedAt','running','entriesEnabled')if k in result},('runtimePid','startedAt','generatedAt','running','entriesEnabled'));forensic_reason(result['statusReason']);forensic_scalars(result['safety'],('recoveryComplete','idle','evidenceAvailable','financialAvailable','uncertainActions','automaticRecoveryAllowed'));forensic_scalars(result['funnel'],('qualified','attempted','paperFilled','exited','reconciled'))
   prep=result['proofPreparation'];forensic_fields(prep,{'attempts','failures','lastCompletedAt','lastFailedAt','state'},{'state'});assert prep['state']in(None,'not-started','pending','running','complete','failed','unavailable');forensic_scalars({k:x for k,x in prep.items()if k!='state'},('attempts','failures','lastCompletedAt','lastFailedAt'))
   recovery=result['sourceRecovery'];forensic_fields(recovery,{'generation','retryAt','failures','closingSettled','restartRequired','reason'},{'reason'});forensic_reason(recovery['reason']);forensic_scalars({k:x for k,x in recovery.items()if k!='reason'},('generation','retryAt','failures','closingSettled','restartRequired'))
  else:assert result=={'available':False,'reason':'RESULT_UNAVAILABLE_OR_BOUND'}
  settlement=row['settlement'];assert type(settlement)is dict and type(settlement.get('available'))is bool
  if settlement['available']:
   forensic_fields(settlement,{'available','fileSha256','at','physicalSettlementConfirmed','financialHistoryPreserved','positions','pending'},{'available','fileSha256','at','physicalSettlementConfirmed','financialHistoryPreserved','positions','pending'});assert forensic_hash(settlement['fileSha256'])and type(settlement['physicalSettlementConfirmed'])is bool and type(settlement['financialHistoryPreserved'])is bool and all(type(settlement[k])is int and 0<=settlement[k]<=9007199254740991 for k in('at','positions','pending'))
  else:assert settlement=={'available':False,'reason':'SETTLEMENT_UNAVAILABLE_OR_BOUND'}
 d=v['diagnostics'];forensic_fields(d,{'files','facts','factCapacityReached','meaning'},{'files','facts','factCapacityReached','meaning'});assert type(d['factCapacityReached'])is bool and type(d['meaning'])is str and len(d['meaning'])<=512 and type(d['files'])is list and len(d['files'])<=8 and type(d['facts'])is list and len(d['facts'])<=256
 filenames={prefix+'-'+str(i)+'.log'for prefix in('source','supervisor')for i in range(4)};seen=set()
 for row in d['files']:
  forensic_fields(row,{'file','available','reason','bytesRead','sha256','lines','oversizedLines','changedDuringRead','trailingFragmentDiscarded','deadlineReached'},{'file','available'});assert row['file']in filenames and row['file']not in seen and type(row['available'])is bool;seen.add(row['file'])
  if row['available']:
   assert forensic_hash(row.get('sha256'))and all(type(row.get(k))is int and 0<=row[k]<=1048576 for k in('bytesRead','lines','oversizedLines'))and all(type(row.get(k))is bool for k in('changedDuringRead','trailingFragmentDiscarded'))and('deadlineReached'not in row or type(row['deadlineReached'])is bool)and 'reason'not in row
  else:assert set(row)=={'file','available','reason'}and row['reason']in('LOG_READ_DEADLINE','LOG_UNAVAILABLE_OR_BOUND')
 sup={'source-stop-request','source-transport-process-settlement','source-started','rolling-resource-sample','source-restart','source-exit','service-admission-write-unavailable'}
 for fact in d['facts']:
  forensic_fields(fact,{'file','line','kind','runId','running','timingUnknown','reason','at','pid','settled','monitoringInterruption','financialHistoryPreserved','financialManagementContinues','newRiskMustRemainClosed','returncode','exitCode','restartNotBeforeAt','sourceSnapshotAt','resource','resources','cpu','processes'},{'file','line','kind'});assert fact['file']in filenames and type(fact['line'])is int and 1<=fact['line']<=1048576
  if fact['kind']=='source-console-line':assert set(fact)=={'file','line','kind','timingUnknown','reason'}and fact['timingUnknown']is True;forensic_reason(fact['reason'])
  elif fact['kind']=='source-final-console':assert set(fact)=={'file','line','kind','runId','running'}and fact['runId']in FORENSIC_RUNS and(fact['running']is None or type(fact['running'])is bool)
  else:
   assert set(fact)<={'file','line','kind','at','runId','reason','pid','settled','monitoringInterruption','financialHistoryPreserved','financialManagementContinues','newRiskMustRemainClosed','returncode','exitCode','restartNotBeforeAt','sourceSnapshotAt','resource','resources','cpu','processes'}
   assert fact['kind']in sup and type(fact.get('at'))is int and 1793299740000<=fact['at']<1793299920000
   if 'runId'in fact:assert fact['runId']in FORENSIC_RUNS
   if 'reason'in fact:forensic_reason(fact['reason'])
   for k in('pid','settled','monitoringInterruption','financialHistoryPreserved','financialManagementContinues','newRiskMustRemainClosed','returncode','exitCode','restartNotBeforeAt','sourceSnapshotAt'):
    if k in fact:assert fact[k]is None or type(fact[k])is bool or forensic_number(fact[k])
   for k,allowed in [('resource',('critical','newRiskPressure','healthy','publisherRestart')),('resources',('availableMemoryBytes','availableDiskBytes','parentRssBytes','healthySamples')),('cpu',('source','publisher'))]:
    if k in fact:forensic_scalars(fact[k],allowed)
   if 'processes'in fact:
    forensic_fields(fact['processes'],('source','publisher'))
    for process in fact['processes'].values():forensic_scalars(process,('rssBytes','cpuSeconds','pid','members'))
 # Long diagnostic prose is not copied. Retain only validated structured facts.
 return {k:x for k,x in v.items()if k not in('diagnostics','limitations')}|{'diagnostics':{k:x for k,x in d.items()if k!='meaning'},'limitations':['Hash-matched sanitized export only; missing bounded records do not establish absence, causal attribution or continuous supervision.']}
def read_source_recovery_forensics():
 try:
  def fixed(name,maximum,uid):
   p=pathlib.Path('/var/lib/poe-public')/name;fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:
    s=os.fstat(fd);assert stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o644 and 0<s.st_size<=maximum
    raw=os.read(fd,s.st_size+1);z=os.fstat(fd);assert len(raw)==s.st_size and(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns);return raw
   finally:os.close(fd)
  upgrade=json.loads(fixed('upgrade-verification.json',16384,0));assert upgrade.get('kind')=='POE_ORIGINAL_FORWARD_UPGRADE_RESULT'and upgrade.get('accountId')=='poe-3123e352-4581-455b-85db-acd7e825e99e'and upgrade.get('inceptionAt')=='2026-10-26T22:07:36.212Z'
  pre=upgrade['forensicPreflight'];assert pre.get('kind')=='POE_SOURCE_RECOVERY_PREFLIGHT'and pre.get('status')=='EXPORTED'and pre.get('scriptSha256')==FORENSIC_SCRIPT_SHA and pre.get('childUid')==988 and pre.get('childGid')==982 and pre.get('financialDatabaseOpened')is False and pre.get('financialWrites')==0 and pre.get('serviceChanges')==0
  receipt=pre['receipt'];forensic_fields(receipt,{'kind','readerUid','readerGid','financialDatabaseOpened','financialWrites','serviceChanges','path','bytes','sha256'},{'kind','readerUid','readerGid','financialDatabaseOpened','financialWrites','serviceChanges','path','bytes','sha256'});assert receipt['kind']=='POE_SOURCE_RECOVERY_EXPORT_RECEIPT'and receipt['readerUid']==988 and receipt['readerGid']==982 and receipt['financialDatabaseOpened']is False and receipt['financialWrites']==0 and receipt['serviceChanges']==0 and receipt['path']=='/var/lib/poe-public/'+FORENSIC_NAME and type(receipt['bytes'])is int and 0<receipt['bytes']<=524288 and forensic_hash(receipt['sha256'])
  raw=fixed(FORENSIC_NAME,524288,988);assert len(raw)==receipt['bytes']and hashlib.sha256(raw).hexdigest()==receipt['sha256'];value=validate_forensic_projection(json.loads(raw))
  return {'available':True,'receiptVerified':True,'sha256':receipt['sha256'],'bytes':len(raw),'scriptSha256':FORENSIC_SCRIPT_SHA,'value':value}
 except(OSError,ValueError,AssertionError,KeyError,TypeError,AttributeError):return {'available':False,'reasonCode':'FORENSIC_EXPORT_OR_ROOT_RECEIPT_NOT_VERIFIED'}
def runtime_identity(main_pid):
 owner=pwd.getpwnam('poe-runtime');group=grp.getgrgid(owner.pw_gid);out={'name':owner.pw_name,'uid':owner.pw_uid,'primaryGid':owner.pw_gid,'primaryGroupName':group.gr_name}
 try:
  p=pathlib.Path('/proc')/main_pid;raw=(p/'status').read_bytes();assert len(raw)<=32768
  values={line.split(':',1)[0]:line.split(':',1)[1].split()for line in raw.decode().splitlines()if line.startswith(('Uid:','Gid:'))}
  out['supervisor']={'pid':int(main_pid),'ownerUid':p.stat().st_uid,'uids':[int(x)for x in values['Uid']],'gids':[int(x)for x in values['Gid']]}
 except(OSError,ValueError,AssertionError,KeyError):out['supervisor']={'available':False}
 out['protectedReportingMetadata']={}
 for label,p in [('publicDirectory',pathlib.Path('/var/lib/poe-public')),('publisher',pathlib.Path('/opt/poe/releases/5e55d8b939de99698ddb311a282461931fcbc957/snapshot-publisher.mjs')),('manifest',pathlib.Path('/etc/poe/native-engine.json'))]:
  try:
   t=p.lstat();out['protectedReportingMetadata'][label]={'uid':t.st_uid,'gid':t.st_gid,'modeOctal':oct(stat.S_IMODE(t.st_mode)),'regular':stat.S_ISREG(t.st_mode),'links':t.st_nlink,'bytes':t.st_size,'contentRead':False}
  except OSError as error:out['protectedReportingMetadata'][label]={'available':False,'errno':error.errno,'contentRead':False}
 return out
def resource_text(path,maximum=8192):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:raw=os.read(fd,maximum+1)
 finally:os.close(fd)
 assert len(raw)<=maximum
 return raw.decode('ascii')
def parse_service_io(text):
 allowed=('rbytes','wbytes','rios','wios','dbytes','dios');rows=[];seen=set()
 assert type(text)is str and len(text.encode('ascii'))<=8192
 lines=text.splitlines();assert len(lines)<=32
 for line in lines:
  fields=line.split();assert 1<=len(fields)<=17 and re.fullmatch(r'[0-9]{1,10}:[0-9]{1,10}',fields[0])and fields[0]not in seen
  device=fields[0];seen.add(device);values={};keys=set()
  for field in fields[1:]:
   key,sep,raw=field.partition('=');assert sep and re.fullmatch(r'[a-z_]{1,24}',key)and key not in keys and re.fullmatch(r'[0-9]{1,20}',raw)and int(raw)<=18446744073709551615
   keys.add(key)
   if key in allowed:values[key]=int(raw)
  rows.append({'device':device,**values})
 totals={k:sum(row[k]for row in rows)for k in allowed if rows and all(k in row for row in rows)}
 return {'available':True,'scope':'poe-runtime.service cgroup only; not host I/O','deviceCount':len(rows),'devices':rows,'totals':totals,'meaning':'Kernel-accounted cumulative I/O; missing fields are not invented and an empty device set does not independently prove no writes.'}
def service_io_usage():
 try:return parse_service_io(resource_text('/sys/fs/cgroup/system.slice/poe-runtime.service/io.stat',8192))
 except(OSError,ValueError,AssertionError):return {'available':False,'scope':'poe-runtime.service cgroup only; not host I/O'}
def host_resource_usage():
 out={'sampleAt':int(time.time()*1000),'hostScope':'HOST-AGGREGATE; includes unrelated applications and administration runner, not POE-attributable','serviceScope':'poe-runtime.service cgroup, including owned children'}
 try:
  text=resource_text('/proc/meminfo');values={k:int(v)*1024 for k,v in re.findall(r'^(MemTotal|MemAvailable):[ \t]+([0-9]+)[ \t]+kB$',text,re.M)};assert set(values)=={'MemTotal','MemAvailable'}
  out['hostMemory']={'available':True,'totalBytes':values['MemTotal'],'availableBytes':values['MemAvailable']}
 except(OSError,ValueError,AssertionError):out['hostMemory']={'available':False}
 try:
  value=os.statvfs('/');out['rootFilesystem']={'available':True,'capacityBytes':value.f_blocks*value.f_frsize,'availableBytes':value.f_bavail*value.f_frsize}
 except OSError:out['rootFilesystem']={'available':False}
 group='/sys/fs/cgroup/system.slice/poe-runtime.service/'
 out['serviceIo']=service_io_usage()
 try:
  text=resource_text(group+'cpu.stat');allowed={'usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec'};values={}
  for line in text.splitlines():
   fields=line.split();assert len(fields)==2 and fields[1].isdigit()
   if fields[0]in allowed:values[fields[0]]=int(fields[1])
  assert 'usage_usec'in values
  out['serviceCpu']={'available':True,**values}
 except(OSError,ValueError,AssertionError):out['serviceCpu']={'available':False}
 out['serviceMemory']={}
 for name in['current','max','peak']:
  try:
   value=resource_text(group+'memory.'+name,64).strip();assert value.isdigit()or(name=='max'and value=='max')
   out['serviceMemory'][name]={'available':True,'bytes':int(value)if value.isdigit()else None,'unlimited':value=='max'}
  except(OSError,ValueError,AssertionError):out['serviceMemory'][name]={'available':False}
 try:
  text=resource_text('/proc/net/dev');rows=[]
  for line in text.splitlines()[2:]:
   interface,separator,rest=line.strip().partition(':');fields=rest.split();assert separator and re.fullmatch(r'[A-Za-z0-9_.-]{1,32}',interface)and len(fields)==16 and all(v.isdigit()for v in fields)
   rows.append({'interface':interface,'receivedBytes':int(fields[0]),'receivedPackets':int(fields[1]),'transmittedBytes':int(fields[8]),'transmittedPackets':int(fields[9])})
  out['hostNetwork']={'available':True,'scope':'HOST-AGGREGATE; not POE-attributable','interfaceCount':len(rows),'truncated':len(rows)>16,'interfaces':rows[:16]}
 except(OSError,ValueError,AssertionError):out['hostNetwork']={'available':False,'scope':'HOST-AGGREGATE; not POE-attributable'}
 return out
def effective_performance_controls(properties):
 out={'sampleAt':int(time.time()*1000),'logicalCpuCount':os.cpu_count(),'systemd':{k:properties.get(k)for k in PERFORMANCE_FIELDS},'systemdMissingProperties':[k for k in PERFORMANCE_FIELDS if k not in properties]}
 group='/sys/fs/cgroup/system.slice/poe-runtime.service/'
 try:
  fields=resource_text(group+'cpu.max',128).split();assert len(fields)==2 and(fields[0]=='max'or fields[0].isdigit())and fields[1].isdigit()and int(fields[1])>0
  out['cgroupCpuMax']={'available':True,'unlimited':fields[0]=='max','quotaUsec':None if fields[0]=='max'else int(fields[0]),'periodUsec':int(fields[1]),'equivalentCpuCores':None if fields[0]=='max'else int(fields[0])/int(fields[1])}
 except(OSError,ValueError,AssertionError):out['cgroupCpuMax']={'available':False}
 try:
  text=resource_text(group+'cpu.weight',64).strip();assert text.isdigit()and 1<=int(text)<=10000
  out['cgroupCpuWeight']={'available':True,'value':int(text)}
 except(OSError,ValueError,AssertionError):out['cgroupCpuWeight']={'available':False}
 out['cgroupMemory']={}
 for name in['high','max']:
  try:
   text=resource_text(group+'memory.'+name,64).strip();assert text.isdigit()or text=='max'
   out['cgroupMemory'][name]={'available':True,'unlimited':text=='max','bytes':None if text=='max'else int(text)}
  except(OSError,ValueError,AssertionError):out['cgroupMemory'][name]={'available':False}
 try:
  rows={};allowed={'low','high','max','oom','oom_kill','oom_group_kill','sock_throttled'}
  for line in resource_text(group+'memory.events',1024).splitlines():
   fields=line.split();assert len(fields)==2 and fields[1].isdigit()
   if fields[0]in allowed:rows[fields[0]]=int(fields[1])
  out['cgroupMemoryEvents']={'available':True,**rows}
 except(OSError,ValueError,AssertionError):out['cgroupMemoryEvents']={'available':False}
 return out
def main():
 assert len(os.sys.argv)==1 and os.getuid()==994 and pwd.getpwuid(994).pw_name=='mm-ec2-runner'and os.environ.get('ACTUAL_RUNNER')=='meme-machine-ec2-admin'
 receipt,text=command(['/usr/bin/systemctl','show','--all','poe-runtime.service','--property='+','.join(FIELDS+['ExecStop','ExecStart','DropInPaths'])]);properties={};stop={};start={};dropins=[]
 for line in text.splitlines():
  key,sep,value=line.partition('=')
  if key in FIELDS and sep and len(value)<=256:properties[key]=value
  if key=='ExecStart':
   path=re.search(r'(?:^|[ ;{])path=([^ ;}]{1,256})',value)
   known_native='/opt/poe/current/operator/native-paper-ec2/run-authoritative-service.py'in value
   old_entry='/opt/poe/current/dist/src/runtime.js'in value
   start={'executable':path.group(1)if path and path.group(1)in['/usr/bin/python3','/opt/poe/node/bin/node']else'OTHER_OR_UNAVAILABLE','nativeSupervisorEntrypoint':known_native,'obsoleteObserverEntrypoint':old_entry,'valueSha256':hashlib.sha256(value.encode()).hexdigest(),'argumentsExported':False}
  if key=='DropInPaths':
   dropins=[pathlib.Path(x).name for x in value.split()if re.fullmatch(r'/etc/systemd/system/poe-runtime[.]service[.]d/[A-Za-z0-9_.-]{1,100}[.]conf',x)]
  if key=='ExecStop':
   for item in re.finditer(r'(?:^|;\s*)(pid|code|status|start_time|stop_time|ignore_errors)=([^;}]{0,128})',value):stop[item.group(1)]=item.group(2).strip()
 repair_keys=['LoadState','User','Group','ActiveState','SubState','MainPID','ControlPID','NRestarts','Result','ExecMainCode','ExecMainStatus','ExecStart','ExecStop','DropInPaths']
 present={line.partition('=')[0]for line in text.splitlines()if '='in line};missing=sorted(set(repair_keys)-present)
 bus_receipt,bus_text=command(['/usr/bin/busctl','--system','--timeout=3s','--json=short','get-property','org.freedesktop.systemd1','/org/freedesktop/systemd1/unit/poe_2druntime_2eservice','org.freedesktop.systemd1.Service','ExecStop'],8192)
 typed_stop={'available':False}
 try:
  value=json.loads(bus_text)
  if bus_receipt.get('exitCode')==0 and type(value)is dict:
   typed_stop={'available':True,'type':value.get('type'),'entries':len(value['data'])if type(value.get('data'))is list else None,'verifiedEmptyCommandArray':value.get('type')=='a(sasbttttuii)'and value.get('data')==[],'argumentsExported':False}
 except ValueError:pass
 try:public=read_public()
 except(OSError,ValueError,AssertionError):public={'available':False}
 try:
  link=os.readlink('/opt/poe/current');current=link if re.fullmatch(r'/opt/poe/releases/[a-f0-9]{40}',link)else'UNEXPORTED_OTHER_TARGET'
 except OSError:current=None
 try:
  p=pathlib.Path('/sys/fs/cgroup/system.slice/poe-runtime.service/cgroup.procs');raw=p.read_bytes();assert len(raw)<=4096;members=[int(x)for x in raw.split()];assert len(members)<=128;cgroup={'available':True,'pids':members}
 except FileNotFoundError:cgroup={'available':False,'absent':True}
 except(OSError,ValueError,AssertionError):cgroup={'available':False,'absent':False}
 process_roles=[]
 for pid in cgroup.get('pids',[])[:16]:
  item={'pid':pid}
  try:
   root=pathlib.Path('/proc')/str(pid);owner=root.stat().st_uid;assert owner==pwd.getpwnam('poe-runtime').pw_uid
   argv=(root/'cmdline').read_bytes();assert len(argv)<=16384
   role='native-source'if b'/native-paper.mjs\0'in argv else'original-publisher'if b'/snapshot-publisher.mjs\0'in argv else'original-supervisor'if b'/run-authoritative-service.py\0'in argv else'other-owned-child'
   fields=(root/'stat').read_text().rsplit(')',1)[1].split();rss=(root/'statm').read_text().split()
   process_nice=int(fields[16]);assert -20<=process_nice<=19
   max_old_space=[];args=argv.split(b'\0')
   for i,arg in enumerate(args):
    match=re.fullmatch(rb'--max-old-space-size=([0-9]{1,7})',arg)
    if match:max_old_space.append(int(match.group(1)))
    elif arg==b'--max-old-space-size'and i+1<len(args)and re.fullmatch(rb'[0-9]{1,7}',args[i+1]):max_old_space.append(int(args[i+1]))
   assert len(max_old_space)<=4
   item.update(role=role,ownerUid=owner,cpuSeconds=(int(fields[11])+int(fields[12]))/os.sysconf('SC_CLK_TCK'),rssBytes=int(rss[1])*os.sysconf('SC_PAGE_SIZE'),nice=process_nice,explicitMaxOldSpaceSizeMiB=max_old_space,argvExported=False)
  except(OSError,ValueError,AssertionError,IndexError):item['metadataAvailable']=False
  process_roles.append(item)
 private_diagnostic_access={}
 for label,p in [('supervisorHealth',pathlib.Path('/var/lib/poe/service/health.json')),('publisherDiagnostic',pathlib.Path('/var/lib/poe/service/diagnostics/publisher-0.log')),('reportingCredentialMetadata',pathlib.Path('/proc')/properties.get('MainPID','0')/'root/run/credentials/poe-runtime.service/poe-ingest-secret')]:
  try:
   t=p.lstat();private_diagnostic_access[label]={'metadataAvailable':True,'ownerUid':t.st_uid,'mode':stat.S_IMODE(t.st_mode),'links':t.st_nlink,'bytes':t.st_size,'regular':stat.S_ISREG(t.st_mode),'contentRead':False}
  except OSError as error:private_diagnostic_access[label]={'metadataAvailable':False,'errno':error.errno,'contentRead':False}
 journal_receipt,journal=command(['/usr/bin/journalctl','--unit=poe-runtime.service','_PID=1','--since=2026-10-29 01:00:00 UTC','--no-pager','-n','64','-o','json'],131072);entries=[]
 for line in journal.splitlines():
  try:v=json.loads(line)
  except ValueError:continue
  message=v.get('MESSAGE')
  if v.get('_PID')=='1'and isinstance(message,str)and 'poe-runtime.service'in message:entries.append({'atMicroseconds':v.get('__REALTIME_TIMESTAMP'),'message':message[:512]})
 print(json.dumps({'kind':'POE_ORIGINAL_CUTOVER_REFUSAL_READ_ONLY','checkedAt':int(time.time()*1000),'service':properties,'runtimeIdentity':runtime_identity(properties.get('MainPID','0')),'reportingRepair':public_reporting_receipt('reporting-repair.json',16384),'acceptedSource':public_reporting_receipt('accepted-source.json',4096),'upgradeVerification':public_reporting_receipt('upgrade-verification.json',16384),'fourSlotVerification':public_reporting_receipt('configuration-four-verification.json',16384),'sourceRecoveryForensics':read_source_recovery_forensics(),'lastExecStop':stop,'effectiveExecStart':start,'dropInBasenames':dropins,'repairMetadataMissingKeys':missing,'execStopTypedProperty':typed_stop,'execStopTypedReceipt':bus_receipt,'serviceReceipt':receipt,'publicStatus':public,'currentReleaseLink':current,'currentCgroup':cgroup,'ownedProcessRoles':process_roles,'hostResourceUsage':host_resource_usage(),'effectivePerformanceControls':effective_performance_controls(properties),'privateDiagnosticAccess':private_diagnostic_access,'managerJournal':entries,'journalReceipt':journal_receipt,'financialDatabaseOpened':False,'credentialReads':0,'serviceChanges':0,'providerRequests':0},separators=(',',':')),flush=True)
if __name__=='__main__':main()
