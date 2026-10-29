#!/usr/bin/env python3
"""Persistent supervisor for the original authoritative PAPER account.

No provider, ledger or secret contents are read here. The sole financial child
owns recovery and accounting; the independently constrained publisher owns its
original LoadCredential snapshot secret. Lifecycle restarts are actual gaps, never synthetic exits.
"""
import collections,ctypes,fcntl,hashlib,json,os,pathlib,pwd,resource,selectors,signal,stat,subprocess,sys,time,types,datetime,urllib.request
UID=os.getuid()
RUNTIME_USER='poe-runtime'
ROOT=pathlib.Path('/var/lib/poe')
ACCOUNT=ROOT/'native-engine'
LEDGER=ROOT/'state/ledger.sqlite'
SERVICE=ROOT/'service'
MANIFEST=pathlib.Path('/etc/poe/native-engine.json')
PUBLIC=pathlib.Path('/var/lib/poe-public')
RELEASES=pathlib.Path('/opt/poe/releases')
NODE=pathlib.Path('/opt/poe/node/bin/node')
ACCOUNT_ID='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION=1793052456212
INCEPTION_ISO='2026-10-26T22:07:36.212Z'
CONTRACT='confirmed-program-ordinary-flow-paper-v1'
MIB=1024*1024
POLICY={'version':'poe-authoritative-persistent-supervisor-resource-v2','sampleSeconds':15,'statusStaleSeconds':90,'startupStatusSeconds':30,'minimumStartRamMiB':768,'minimumStartDiskMiB':512,'criticalRamMiB':256,'criticalDiskMiB':128,'candidateSourceRssMiB':1536,'resumeSourceRssMiB':1408,'sourceRssMiB':2048,'publisherRssMiB':256,'parentRssMiB':128,'rollingCpuSeconds':60,'cpuUtilizationAdmissionEnforced':False,'sourceCpuCloseCores':None,'sourceCpuResumeCores':None,'publisherCpuRestartCores':None,'resumeHealthySamples':3,'maximumRecoveryBackoffSeconds':60,'gracefulSourceStopSeconds':30,'sourceHeapMiB':1024,'publisherHeapMiB':128,'diagnosticFileBytes':MIB,'diagnosticFiles':4,'resourceFileBytes':2*MIB,'resourceFiles':4}
RELEASE_FILES={'native-paper.mjs':8*MIB,'backup-worker.mjs':MIB,'better_sqlite3.node':4*MIB,'metadata.json':MIB,'snapshot-publisher.mjs':MIB}
class Guard(RuntimeError):pass
def need(v,code):
 if not v:raise Guard(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def integer(v):return type(v)is int and v>=0
def hashed(v,n=64):return isinstance(v,str)and len(v)==n and all(c in'0123456789abcdef'for c in v)
def private_dir(path,uid=UID):
 s=path.lstat();need(stat.S_ISDIR(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_uid==uid and not s.st_mode&0o077 and path.resolve(strict=True)==path,'PRIVATE_DIRECTORY_REQUIRED')
def read_file(path,maximum,uid=UID,private=True,allow_empty=False):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and not s.st_mode&(0o077 if private else 0o022)and (0<=s.st_size if allow_empty else 0<s.st_size)and s.st_size<=maximum,'BOUNDED_OWNER_FILE_REQUIRED');b=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(b)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'INPUT_CHANGED');return b
 finally:os.close(fd)
def atomic(path,value,maximum=128*1024):
 raw=(json.dumps(value,separators=(',',':'))+'\n').encode();need(len(raw)<=maximum,'PRIVATE_PROJECTION_BOUND')
 try:s=path.lstat();need(stat.S_ISREG(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_nlink==1 and s.st_uid==os.getuid()and not s.st_mode&0o077,'PRIVATE_OUTPUT_REQUIRED')
 except FileNotFoundError:pass
 temp=path.with_name('.'+path.name+'.'+str(os.getpid())+'.pending');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  pos=0
  while pos<len(raw):pos+=os.write(fd,raw[pos:])
  os.fsync(fd)
 finally:os.close(fd)
 os.replace(temp,path);parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(parent)
 finally:os.close(parent)
def validate_manifest(v):
 need(type(v)is dict and set(v)=={'schemaVersion','kind','source','configurationSha256','stage','deepSlots','strategy','files','policy'},'EXACT_SERVICE_MANIFEST_REQUIRED')
 need(v['schemaVersion']==1 and v['kind']=='poe-authoritative-persistent-service-v1'and v['policy']==POLICY,'REVIEWED_SERVICE_POLICY_REQUIRED')
 need(type(v['source'])is dict and set(v['source'])=={'commit','sha256'}and hashed(v['source']['commit'],40)and hashed(v['source']['sha256']),'PINNED_PAPER_SOURCE_REQUIRED')
 need(hashed(v['configurationSha256']),'PINNED_CONFIG_REQUIRED');need(v['stage']in['single','shadow','two','three']and type(v['deepSlots'])is int and 1<=v['deepSlots']<=6,'SUPPORTED_FROZEN_STAGE_REQUIRED')
 need(type(v['strategy'])is str and 1<=len(v['strategy'])<=128 and all(32<=ord(c)<=126 for c in v['strategy']),'VERSIONED_STRATEGY_REQUIRED')
 need(type(v['files'])is list and len(v['files'])==len(RELEASE_FILES)and{r.get('file')for r in v['files']if type(r)is dict}==set(RELEASE_FILES),'PINNED_IMMUTABLE_RELEASE_REQUIRED')
 for row in v['files']:need(set(row)=={'file','bytes','sha256'}and integer(row['bytes'])and 0<row['bytes']<=RELEASE_FILES[row['file']]and hashed(row['sha256']),'PINNED_RELEASE_FILE_REQUIRED')
 return v

def validate_status(v,manifest,started_at,pid,now):
 need(type(v)is dict and v.get('accountId')==ACCOUNT_ID and v.get('inceptionAt')==INCEPTION and v.get('mode')=='paper'and v.get('authoritative')is True and v.get('experimental')is False and v.get('financialExecutionAuthorized')is True and v.get('liveTradingEnabled')is False,'ORIGINAL_PAPER_IDENTITY_REQUIRED')
 source=v.get('source',{});need(source.get('commit')==manifest['source']['commit']and source.get('sha256')==manifest['source']['sha256']and v.get('configurationSha256')==manifest['configurationSha256'],'FROZEN_SERVICE_SOURCE_REQUIRED')
 need(v.get('persistent')is True and v.get('operatingMode')=='persistent-service'and v.get('managementOnly')is False,'PERSISTENT_SERVICE_MODE_REQUIRED')
 need(integer(v.get('runtimePid'))and v['runtimePid']==pid and integer(v.get('startedAt'))and integer(v.get('generatedAt'))and started_at<=v['startedAt']<=v['generatedAt']<=now+5000 and now-v['generatedAt']<=POLICY['statusStaleSeconds']*1000,'FRESH_ACTUAL_PROCESS_REQUIRED')
 need(v.get('sourceRecovery')is None or type(v.get('sourceRecovery'))is dict,'SOURCE_RECOVERY_SCHEMA_REQUIRED')
 need(type(v.get('running'))is bool and type(v.get('runId'))is str and v['runId'].startswith('native-paper-')and len(v['runId'])<=64,'SOURCE_RUN_REQUIRED')
 need(type(v.get('positions'))is dict and type(v.get('pending'))is dict and len(v['positions'])<=3 and len(v['pending'])<=6,'OWNERSHIP_PROJECTION_REQUIRED');return v

def source_args(node,release,manifest):return[node,'--max-old-space-size='+str(POLICY['sourceHeapMiB']),str(release/'native-paper.mjs'),'--resume','--directory',str(ACCOUNT),'--ledger',str(LEDGER),'--input',str(ACCOUNT/'input.json'),'--paper-contract',CONTRACT,'--stage',manifest['stage'],'--deep-slots',str(manifest['deepSlots']),'--service']
def credential_path():
 value=os.environ.get('CREDENTIALS_DIRECTORY');need(value=='/run/credentials/poe-runtime.service','ORIGINAL_SYSTEMD_CREDENTIAL_REQUIRED');return pathlib.Path(value)/'poe-ingest-secret'
def publisher_args(node,release,manifest,once=False):
 secret=credential_path();args=[node,'--permission','--allow-fs-read='+str(release/'snapshot-publisher.mjs'),'--allow-fs-read='+str(ACCOUNT/'snapshot.json'),'--allow-fs-read='+str(secret),'--max-old-space-size='+str(POLICY['publisherHeapMiB']),'--disable-proto=throw',str(release/'snapshot-publisher.mjs'),'--file',str(ACCOUNT/'snapshot.json'),'--account-id',ACCOUNT_ID,'--inception-at',INCEPTION_ISO,'--release',manifest['source']['commit'],'--strategy',manifest['strategy']]
 args.append('--once'if once else'--watch')
 return args
def spawn(args,publisher=False):
 parent=os.getpid()
 def prepare():
  if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL)!=0 or os.getppid()!=parent:os._exit(1)
  # No cumulative CPU, file-size or elapsed limit. Systemd bounds cgroup memory
  # while CPU utilization is observed, not a reason to stop healthy work.
  resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_NOFILE,(128,128))
 env={'PATH':'/usr/bin:/bin','LANG':'C','TZ':'UTC'}
 if publisher:
  credential=credential_path();env['CREDENTIALS_DIRECTORY']=str(credential.parent);env['POE_PUBLISH_SECRET_FILE']=str(credential)
 p=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,start_new_session=True,preexec_fn=prepare,bufsize=0);os.set_blocking(p.stdout.fileno(),False);return p

def group_members(group,uid=UID):
 out=[]
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if p.stat().st_uid!=uid:continue
   fields=(p/'stat').read_text().rsplit(')',1)[1].split()
   if int(fields[2])==group and fields[0]!='Z':out.append(int(p.name))
  except(FileNotFoundError,ProcessLookupError,PermissionError,ValueError,IndexError):continue
 return out

def stop_child(p,grace=30,uid=UID,drain=None):
 if p is None:return True
 if group_members(p.pid,uid):
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  until=time.monotonic()+grace
  while group_members(p.pid,uid)and time.monotonic()<until:
   if drain:drain()
   time.sleep(.05)
  if group_members(p.pid,uid):
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
 try:p.wait(timeout=2)
 except subprocess.TimeoutExpired:return False
 if drain:drain()
 elif p.stdout is not None:p.stdout.close()
 return not group_members(p.pid,uid)

class RotatingDiagnostic:
 """Only duplicate logs/telemetry rotate; authoritative account files are excluded."""
 def __init__(self,directory,prefix,maximum=MIB,files=4):
  need(isinstance(prefix,str)and 1<=len(prefix)<=32 and prefix.replace('-','').isalnum(),'FIXED_DIAGNOSTIC_PREFIX')
  self.directory,self.prefix,self.maximum,self.files=directory,prefix,maximum,files;self.total=0;self.evicted=0;self.chain='0'*64;self.fd=None;self.size=0;self.sequence=0;self.rotations=0
  self.open()
 def open(self):
  p=self.directory/(self.prefix+'-'+str(self.sequence%self.files)+'.log')
  try:
   old=read_file(p,self.maximum,os.getuid(),allow_empty=True);self.evicted+=len(old);self.chain=sha(bytes.fromhex(self.chain)+hashlib.sha256(old).digest());self.rotations+=1
  except FileNotFoundError:pass
  temp=p.with_name('.'+p.name+'.'+str(os.getpid())+'.pending');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.replace(temp,p);self.fd=fd;self.size=0
 def write(self,raw):
  need(type(raw)is bytes,'DIAGNOSTIC_BYTES_REQUIRED')
  offset=0
  while offset<len(raw):
   if self.size==self.maximum:os.close(self.fd);self.fd=None;self.sequence+=1;self.open()
   part=raw[offset:offset+self.maximum-self.size];written=os.write(self.fd,part);need(written>0,'DIAGNOSTIC_WRITE_UNAVAILABLE');self.size+=written;self.total+=written;offset+=written
 def status(self):return{'receivedBytes':self.total,'evictedDiagnosticBytes':self.evicted,'evictedFileHashChain':self.chain,'rotations':self.rotations,'maximumFileBytes':self.maximum,'retainedFiles':self.files,'retainedMeaning':'Duplicate process logs/host telemetry only; no financial ledger or market proof deletion.'}
 def close(self):
  if self.fd is not None:os.close(self.fd);self.fd=None

class RollingCpu:
 def __init__(self,seconds=60):self.seconds=seconds;self.samples=collections.deque()
 def observe(self,at,cpu,membership):
  if not isinstance(cpu,(int,float))or cpu<0:self.samples.clear();return None
  self.samples.append((at,cpu,membership))
  while len(self.samples)>1 and at-self.samples[1][0]>=self.seconds:self.samples.popleft()
  old=self.samples[0]
  if at-old[0]<self.seconds or old[2]!=membership or cpu<old[1]:return None
  return(cpu-old[1])/(at-old[0])

def recovery_delay(failures):return[2,5,10,20,40,60][min(max(failures-1,0),5)]
def resource_state(views,ram,disk,parent_rss,source_cpu,publisher_cpu,source_expected=True,publisher_expected=True):
 source=views.get('source')or{};pub=views.get('publisher')or{}
 measured=not(source_expected and not views.get('source')or publisher_expected and not views.get('publisher'))
 memory_known=integer(ram);disk_known=integer(disk);measured=measured and memory_known and disk_known
 critical=source.get('rssBytes',0)>POLICY['sourceRssMiB']*MIB or parent_rss>POLICY['parentRssMiB']*MIB or memory_known and ram<POLICY['criticalRamMiB']*MIB or disk_known and disk<POLICY['criticalDiskMiB']*MIB
 pressure=not measured or source.get('rssBytes',0)>POLICY['candidateSourceRssMiB']*MIB or ram<POLICY['minimumStartRamMiB']*MIB or disk<POLICY['minimumStartDiskMiB']*MIB
 healthy=measured and source.get('rssBytes',0)<=POLICY['resumeSourceRssMiB']*MIB and ram>=POLICY['minimumStartRamMiB']*MIB and disk>=POLICY['minimumStartDiskMiB']*MIB
 return{'critical':critical,'resourceMeasurementsAvailable':measured,'newRiskPressure':pressure,'healthy':healthy,'publisherRestart':pub.get('rssBytes',0)>POLICY['publisherRssMiB']*MIB,'cpuUtilizationAdmissionEnforced':False}

def admission(source,ack,resources,healthy_samples,now):
 if source is None:return True,'source status unavailable'
 if not source.get('running'):return True,'source is stopped; recovery pending'
 if resources.get('critical')or resources.get('newRiskPressure'):return True,'rolling resource pressure; financial management retained'
 if not resources.get('healthy')or healthy_samples<POLICY['resumeHealthySamples']:return True,'resource recovery hysteresis; financial management retained'
 if not ack or not integer(ack.get('sourceAtMs'))or ack['sourceAtMs']<source['startedAt']or ack['sourceAtMs']>source['generatedAt']or not 0<=now-ack['sourceAtMs']<=POLICY['statusStaleSeconds']*1000:return True,'reporting source acceptance unavailable; financial management retained'
 return False,'fresh current-run reporting and rolling resource headroom verified'

def marker(manifest,source,suspended,reason,now):return{'schemaVersion':1,'owner':'poe-runtime-service-supervisor','accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'source':manifest['source'],'runId':source['runId']if source else None,'generatedAt':now,'suspended':suspended,'reason':reason[:200]}

def parse_ack(line,now,release):
 try:v=json.loads(line)
 except(ValueError,UnicodeDecodeError):return None
 if type(v)is dict and v.get('published')is True and v.get('result')in['accepted','duplicate']and v.get('accountId')==ACCOUNT_ID and v.get('inceptionAt')==INCEPTION_ISO and v.get('release')==release and integer(v.get('sourceAtMs'))and INCEPTION<=v['sourceAtMs']<=now+5000 and integer(v.get('acknowledgedAtMs'))and v['sourceAtMs']<=v['acknowledgedAtMs']<=now+5000 and hashed(v.get('fingerprint'))and hashed(v.get('rawSourceSha256'))and isinstance(v.get('sequence'),str)and v['sequence'].isdigit()and 1<=len(v['sequence'])<=40:return v
 return None

def publish_public_ack(manifest,source,ack,raw_body,accepted_count,now):
 """A bounded duplicate DELIVERY receipt, never a snapshot or financial writer."""
 need(type(raw_body)is bytes and 0<len(raw_body)<=128*1024 and sha(raw_body)==ack.get('rawSourceSha256'),'MATCHED_RAW_SOURCE_REQUIRED')
 need(type(source)is dict and source.get('accountId')==ACCOUNT_ID and source.get('inceptionAt')==INCEPTION and type(source.get('source'))is dict and all(source['source'].get(k)==manifest['source'][k]for k in['commit','sha256'])and parse_ack(json.dumps(ack),now,manifest['source']['commit'])==ack and source['startedAt']<=ack['sourceAtMs']<=source['generatedAt']and integer(accepted_count)and accepted_count>0,'CURRENT_ORIGINAL_ACK_WITNESS_REQUIRED')
 value={'schemaVersion':1,'kind':'poe-original-snapshot-delivery-receipt-v1','accountId':ACCOUNT_ID,'inceptionAt':INCEPTION_ISO,'source':manifest['source'],'runId':source['runId'],'sourceAtMs':ack['sourceAtMs'],'sequence':ack['sequence'],'fingerprint':ack['fingerprint'],'rawSourceSha256':ack['rawSourceSha256'],'acknowledgedAtMs':ack['acknowledgedAtMs'],'observedBySupervisorAtMs':now,'acceptedDistinctSourcesThisSupervisor':accepted_count,'meaning':'Duplicate metadata of an already matched original-channel Render acknowledgement; source timestamp is unchanged. No financial or market evidence is replaced.'}
 raw=(json.dumps(value,separators=(',',':'))+'\n').encode();need(len(raw)<=4096,'PUBLIC_ACK_METADATA_BOUND');directory=PUBLIC.lstat();need(stat.S_ISDIR(directory.st_mode)and not stat.S_ISLNK(directory.st_mode)and directory.st_uid==os.getuid()and stat.S_IMODE(directory.st_mode)==0o755 and PUBLIC.resolve(strict=True)==PUBLIC,'ORIGINAL_PUBLIC_STATUS_DIRECTORY_REQUIRED');path=PUBLIC/'accepted-source.json'
 try:
  old=path.lstat();need(stat.S_ISREG(old.st_mode)and not stat.S_ISLNK(old.st_mode)and old.st_uid==os.getuid()and old.st_nlink==1 and stat.S_IMODE(old.st_mode)==0o644 and old.st_size<=4096,'OWNED_PUBLIC_ACK_FILE_REQUIRED')
 except FileNotFoundError:pass
 temporary=PUBLIC/('.accepted-source-'+str(os.getpid())+'-'+str(time.time_ns())+'.pending');fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);created=os.fstat(fd)
 try:
  offset=0
  while offset<len(raw):
   written=os.write(fd,raw[offset:]);need(written>0,'PUBLIC_ACK_WRITE_UNAVAILABLE');offset+=written
  os.fchmod(fd,0o644);os.fsync(fd);os.replace(temporary,path);parent=os.open(PUBLIC,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(parent)
  finally:os.close(parent)
 except BaseException:
  # Only the inode created by THIS call may be removed. A successful rename
  # leaves no temporary path; never remove the accepted target on later error.
  try:
   current=temporary.lstat()
   if(current.st_dev,current.st_ino)==(created.st_dev,created.st_ino)and current.st_uid==os.getuid()and stat.S_ISREG(current.st_mode)and current.st_nlink==1:temporary.unlink()
  except OSError:pass
  raise
 finally:os.close(fd)
 return value

class Supervisor:
 def __init__(self,manifest,helpers,logs):
  self.manifest,self.helpers,self.logs=manifest,helpers,logs;self.selector=selectors.DefaultSelector();self.source=None;self.publisher=None;self.source_started=0;self.started=time.monotonic();self.last_source=None;self.last_ack=None;self.stopping=False;self.source_failures=0;self.publisher_failures=0;self.next_source=0;self.next_publisher=0;self.last_sample=-float('inf');self.healthy_samples=0;self.last_marker=0;self.resource={'critical':False,'newRiskPressure':False,'healthy':False,'publisherRestart':False};self.cpu={'source':RollingCpu(POLICY['rollingCpuSeconds']),'publisher':RollingCpu(POLICY['rollingCpuSeconds'])};self.source_status_unavailable_since=None;self.source_group_unsettled=False;self.buffers={'source':b'','publisher':b''};self.restart_history=collections.deque(maxlen=32);self.bytes={'source':0,'publisher':0};self.output_errors=0;self.last_health=0;self.source_had_status=False;self.snapshot_cache=collections.OrderedDict();self.pending_acks=collections.deque(maxlen=4);self.accepted_source_count=0;self.last_accepted_fingerprint=None;self.snapshot_at=None;self.source_began_mono=0;self.publisher_began_mono=0
 def record(self,kind,data):
  try:self.logs['supervisor'].write((json.dumps({'at':int(time.time()*1000),'kind':kind,'data':data},separators=(',',':'))+'\n').encode())
  except OSError:self.output_errors+=1
 def register(self,name,p):self.selector.register(p.stdout,selectors.EVENT_READ,name)
 def drain(self):
  for key,_ in self.selector.select(0):
   name=key.data
   try:raw=os.read(key.fileobj.fileno(),131072)
   except BlockingIOError:continue
   if not raw:
    try:self.selector.unregister(key.fileobj)
    except KeyError:pass
    key.fileobj.close()
    continue
   self.bytes[name]+=len(raw)
   try:self.logs[name].write(raw)
   except OSError:self.output_errors+=1
   if name=='publisher':
    buf=self.buffers[name]+raw
    if len(buf)>16384:self.buffers[name]=b'';continue
    parts=buf.split(b'\n');self.buffers[name]=parts.pop()
    for line in parts:
     ack=parse_ack(line,int(time.time()*1000),self.manifest['source']['commit'])
     if ack:self.pending_acks.append(ack)
 def cache_source_snapshot(self,now):
  if self.last_source is None:return
  try:
   if self.snapshot_at==self.last_source['generatedAt']:raise FileExistsError('snapshot already cached')
   raw=read_file(ACCOUNT/'snapshot.json',128*1024);v=json.loads(raw);at=int(datetime.datetime.fromisoformat(v['times']['generatedAt'].replace('Z','+00:00')).timestamp()*1000);sequence=v['sequence']
   need(v['account']['id']==ACCOUNT_ID and v['account']['inceptionAt']==INCEPTION_ISO and v['source']['release']==self.manifest['source']['commit']and v['source']['strategy']==self.manifest['strategy']and self.last_source['startedAt']<=at<=self.last_source['generatedAt']and at<=now+5000 and isinstance(sequence,str)and sequence.isdigit(),'CURRENT_SOURCE_SNAPSHOT_REQUIRED')
   body=raw;raw_source_sha256=sha(body);self.snapshot_at=self.last_source['generatedAt'];key=(at,sequence,raw_source_sha256);self.snapshot_cache[key]=body;self.snapshot_cache.move_to_end(key)
   while len(self.snapshot_cache)>4:self.snapshot_cache.popitem(last=False)
  except FileExistsError:pass
  except(OSError,ValueError,KeyError,TypeError,Guard):return
  for _ in range(len(self.pending_acks)):
   ack=self.pending_acks.popleft();key=(ack['sourceAtMs'],ack['sequence'],ack['rawSourceSha256']);body=self.snapshot_cache.get(key)
   if body is None:self.pending_acks.append(ack);continue
   self.last_ack=ack
   if ack['fingerprint']==self.last_accepted_fingerprint:continue
   self.last_accepted_fingerprint=ack['fingerprint'];self.accepted_source_count+=1
   try:
    # Four rotating duplicate public snapshots only. The financial journal and
    # decision evidence remain authoritative and are never deleted here.
    slot=(self.accepted_source_count-1)%4;path=SERVICE/('accepted-source-'+str(slot)+'.json');atomic(path,json.loads(body),256*1024);atomic(SERVICE/'accepted-source-latest.json',{'schemaVersion':1,'accountId':ACCOUNT_ID,'inceptionAt':INCEPTION_ISO,'source':self.manifest['source'],'sourceAtMs':ack['sourceAtMs'],'sequence':ack['sequence'],'fingerprint':ack['fingerprint'],'rawSourceSha256':ack['rawSourceSha256'],'acknowledgedAtMs':ack['acknowledgedAtMs'],'sourceFile':path.name,'acceptedDistinctSourcesThisSupervisor':self.accepted_source_count,'cacheFiles':4,'cacheMeaning':'Bounded duplicate public source evidence; eviction does not remove financial records or original market proofs.'})
   except(OSError,Guard):self.output_errors+=1
   try:publish_public_ack(self.manifest,self.last_source,ack,body,self.accepted_source_count,now)
   except(OSError,ValueError,KeyError,TypeError,Guard):self.output_errors+=1
 def source_stop(self,reason):
  self.record('source-stop-request',{'reason':reason,'positions':None if self.last_source is None else len(self.last_source['positions']),'pending':None if self.last_source is None else len(self.last_source['pending']),'financialFlatnessInferred':False})
  settled=stop_child(self.source,POLICY['gracefulSourceStopSeconds'],drain=self.drain);self.source_group_unsettled=not settled
  self.record('source-transport-process-settlement',{'settled':settled,'reason':reason,'monitoringInterruption':True,'financialHistoryPreserved':True});self.source=None if settled else self.source;return settled
 def write_marker(self,now):
  suspended,reason=admission(self.last_source,self.last_ack,self.resource,self.healthy_samples,now)
  if self.stopping:suspended,reason=True,'service stop requested; financial obligations retained'
  try:atomic(ACCOUNT/'service-admission.json',marker(self.manifest,self.last_source,suspended,reason,now));self.last_marker=now
  except(OSError,Guard):self.record('service-admission-write-unavailable',{'newRiskMustRemainClosed':True,'financialManagementContinues':True})
 def sample(self,mono,now):
  views=self.helpers.resource_process_views(self.source.pid if self.source else None,self.publisher.pid if self.publisher else None);ram=self.helpers.available_memory();disk=os.statvfs(ACCOUNT).f_bavail*os.statvfs(ACCOUNT).f_frsize;parent=self.helpers.self_rss();rates={}
  for name in['source','publisher']:
   value=views.get(name);rates[name]=self.cpu[name].observe(mono,value.get('cpuSeconds')if value else None,value.get('membershipSha256')if value else None)
  self.resource=resource_state(views,ram,disk,parent,rates['source'],rates['publisher'],source_expected=self.source is not None,publisher_expected=self.publisher is not None);self.healthy_samples=self.healthy_samples+1 if self.resource['healthy']else 0
  self.record('rolling-resource-sample',{'sourceRunId':self.last_source.get('runId')if self.last_source else None,'sourceSnapshotAt':self.last_source.get('generatedAt')if self.last_source else None,'processes':views,'availableMemoryBytes':ram,'availableDiskBytes':disk,'parentRssBytes':parent,'rollingCpuCores':rates,'resource':self.resource,'healthySamples':self.healthy_samples,'elapsedSeconds':mono-self.started})
  self.last_sample=mono
 def step(self,mono=None,now=None):
  mono=time.monotonic()if mono is None else mono;now=int(time.time()*1000)if now is None else now;self.drain()
  if mono-self.last_sample>=POLICY['sampleSeconds']:self.sample(mono,now)
  if self.source:
   try:self.last_source=validate_status(json.loads(read_file(ACCOUNT/'status.json',4*MIB)),self.manifest,self.source_started,self.source.pid,now);self.source_status_unavailable_since=None;self.source_had_status=True;self.cache_source_snapshot(now)
   except(OSError,ValueError,Guard):
    self.last_source=None
    if self.source_status_unavailable_since is None:self.source_status_unavailable_since=mono
   if self.source.poll()is not None:
    if self.source_stop('source exited; retained-obligation restart'):
     self.source_failures+=1;self.next_source=mono+recovery_delay(self.source_failures);self.restart_history.append({'at':now,'reason':'source-exit','restartNotBeforeAt':now+int(recovery_delay(self.source_failures)*1000)});self.last_source=None;self.healthy_samples=0
   elif self.resource['critical']or self.last_source is not None and(self.last_source.get('sourceRecovery')or{}).get('restartRequired')is True or self.source_status_unavailable_since is not None and mono-self.source_status_unavailable_since>(POLICY['statusStaleSeconds']if self.source_had_status else POLICY['startupStatusSeconds']):
    if self.source_stop('critical resource or stale runtime; durable recovery required'):self.source_failures+=1;self.next_source=mono+recovery_delay(self.source_failures);self.last_source=None;self.healthy_samples=0
  if self.publisher and(self.publisher.poll()is not None or self.resource['publisherRestart']):
   if stop_child(self.publisher,5,drain=self.drain):self.publisher=None;self.publisher_failures+=1;self.next_publisher=mono+recovery_delay(self.publisher_failures);self.last_ack=None;self.buffers['publisher']=b''
  if self.source and self.last_source is not None and mono-self.source_began_mono>=300:self.source_failures=0
  if self.publisher and self.last_ack is not None and mono-self.publisher_began_mono>=300:self.publisher_failures=0
  if self.stopping:return
  if not self.source and not self.source_group_unsettled and mono>=self.next_source and not self.resource['critical']and self.resource['healthy']:
   self.write_marker(now);self.source_started=now;self.source_began_mono=mono;self.source=spawn(source_args(str(NODE),RELEASES/self.manifest['source']['commit'],self.manifest));self.register('source',self.source);self.source_status_unavailable_since=mono;self.source_had_status=False;self.last_source=None;self.last_ack=None;self.snapshot_cache.clear();self.pending_acks.clear();self.snapshot_at=None;self.record('source-started',{'pid':self.source.pid,'source':self.manifest['source'],'previousFinancialWriterSettled':True,'accountReset':False,'financialRecoveryOwnedByRuntime':True})
  if not self.publisher and mono>=self.next_publisher:
   self.publisher_began_mono=mono;self.publisher=spawn(publisher_args(str(NODE),RELEASES/self.manifest['source']['commit'],self.manifest),publisher=True);self.register('publisher',self.publisher);self.record('publisher-started',{'pid':self.publisher.pid,'financialSourceRestarted':False})
  if now-self.last_marker>=15000:self.write_marker(now)
  health={'schemaVersion':1,'kind':'poe-persistent-paper-supervisor-health','generatedAt':now,'accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'source':self.manifest['source'],'sourcePid':self.source.pid if self.source else None,'publisherPid':self.publisher.pid if self.publisher else None,'sourceRunId':self.last_source.get('runId')if self.last_source else None,'lastSourceAt':self.last_source.get('generatedAt')if self.last_source else None,'lastAcceptedSourceAt':self.last_ack.get('sourceAtMs')if self.last_ack else None,'resource':self.resource,'sourceGroupUnsettled':self.source_group_unsettled,'recentRestarts':list(self.restart_history),'diagnostics':{k:v.status()for k,v in self.logs.items()},'outputErrors':self.output_errors,'continuousCoverageClaimed':False,'financialDatabaseRead':False,'lifetimeStopBudgets':None,'matchedSourceAcknowledgements':self.accepted_source_count}
  if now-self.last_health>=5000:
   try:atomic(SERVICE/'health.json',health);self.last_health=now
   except(OSError,Guard):self.output_errors+=1
 def run(self):
  try:
   while not self.stopping:self.step();time.sleep(.5)
  finally:
   self.write_marker(int(time.time()*1000));settled=self.source_stop('service stop requested; financial checkpoint and honest interruption');stop_child(self.publisher,5,drain=self.drain);self.publisher=None;self.drain()
   if settled:
    try:
     p=spawn(publisher_args(str(NODE),RELEASES/self.manifest['source']['commit'],self.manifest,once=True),publisher=True);self.publisher=p;self.register('publisher',p);until=time.monotonic()+7
     while p.poll()is None and time.monotonic()<until:self.drain();time.sleep(.05)
     stop_child(p,1,drain=self.drain);self.drain();self.record('final-publication-settled',{'financialWriterSettledBeforePublication':True,'sourceTimestampUnchanged':True})
    except(OSError,Guard):self.record('final-publication-unavailable',{'financialHistoryPreserved':True,'receiverMustUseSourceStaleness':True})
   for log in self.logs.values():log.close()
   for key in list(self.selector.get_map().values()):key.fileobj.close()
   self.selector.close()

def available_memory():
 # This is actual kernel headroom, not a guessed host allocation. Missing or
 # malformed telemetry closes new-risk admission without inventing an outage.
 try:
  fd=os.open('/proc/meminfo',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:raw=os.read(fd,16385)
  finally:os.close(fd)
  need(len(raw)<=16384,'HOST_MEMORY_METADATA_BOUND')
  for row in raw.decode('ascii').splitlines():
   if row.startswith('MemAvailable:'):
    values=row.split();need(len(values)==3 and values[1].isdigit()and values[2]=='kB','HOST_MEMORY_METADATA_FORMAT');return int(values[1])*1024
 except(OSError,ValueError,Guard):pass
 return None
def self_rss():return int(pathlib.Path('/proc/self/statm').read_text().split()[1])*os.sysconf('SC_PAGE_SIZE')

def resource_process_views(source_group, publisher_group):
    """Live own-UID /proc counters only, including Node's worker threads.

    Group sums omit already exited members. A changed membership cannot produce
    a valid interval delta; the sampler reports that interval as unknown.
    """
    wanted = {'source': source_group, 'publisher': publisher_group}
    members = {name: [] for name in wanted}
    parent = None
    scanned = 0
    try:
        for path in pathlib.Path('/proc').iterdir():
            if not path.name.isdigit():
                continue
            scanned += 1
            if scanned > 4096:
                raise ValueError('PROCESS_CENSUS_BOUND')
            try:
                if path.stat().st_uid != os.getuid():
                    continue
                fields = (path/'stat').read_text().rsplit(')', 1)[1].split()
                pid, group = int(path.name), int(fields[2])
                if pid != os.getpid() and group not in wanted.values():
                    continue
                if path.stat().st_uid != os.getuid():
                    continue
                item = (pid, int(fields[19]), (int(fields[11])+int(fields[12]))/os.sysconf('SC_CLK_TCK'), int(fields[21])*os.sysconf('SC_PAGE_SIZE'))
                if pid == os.getpid():
                    parent = item
                for name, wanted_group in wanted.items():
                    if wanted_group is not None and group == wanted_group:
                        members[name].append(item)
            except (OSError, ValueError, IndexError):
                # A process may exit during the census. No inaccessible values
                # are invented and no command line/environment is read.
                continue
    except (OSError, ValueError):
        return {name: None for name in ['source', 'publisher', 'supervisor']}
    def view(rows):
        if not rows or len(rows) > 64:
            return None
        rows.sort()
        return {'liveProcesses': len(rows), 'membershipSha256': sha(json.dumps([(r[0], r[1]) for r in rows]).encode()), 'cpuSeconds': sum(r[2] for r in rows), 'rssBytes': sum(r[3] for r in rows)}
    return {**{name: view(rows) for name, rows in members.items()}, 'supervisor': view([parent]) if parent is not None else None}

def verify_host():
 http=urllib.request.build_opener(urllib.request.ProxyHandler({}));request=urllib.request.Request('http://169.254.169.254/latest/api/token',method='PUT',headers={'X-aws-ec2-metadata-token-ttl-seconds':'60'})
 with http.open(request,timeout=3)as response:token=response.read(4096).decode()
 request=urllib.request.Request('http://169.254.169.254/latest/dynamic/instance-identity/document',headers={'X-aws-ec2-metadata-token':token})
 with http.open(request,timeout=3)as response:raw=response.read(8193)
 need(len(raw)<=8192,'HOST_METADATA_BOUND');v=json.loads(raw);need(tuple(v.get(k)for k in['accountId','region','instanceId'])==('133857166104','us-west-2','i-00044d4ea1471b957'),'ORIGINAL_EC2_HOST_REQUIRED');return{k:v[k]for k in['accountId','region','instanceId']}

def release_verified(manifest):
 release=RELEASES/manifest['source']['commit'];need(release.resolve(strict=True)==release,'CANONICAL_RELEASE_REQUIRED')
 root=release.lstat();need(stat.S_ISDIR(root.st_mode)and root.st_uid==0 and not root.st_mode&0o022,'ROOT_OWNED_IMMUTABLE_RELEASE_REQUIRED')
 for row in manifest['files']:
  raw=read_file(release/row['file'],RELEASE_FILES[row['file']],uid=0,private=False);need(len(raw)==row['bytes']and sha(raw)==row['sha256'],'IMMUTABLE_RELEASE_HASH_REQUIRED')
 need(next(r['sha256']for r in manifest['files']if r['file']=='native-paper.mjs')==manifest['source']['sha256'],'NATIVE_EXECUTABLE_HASH_REQUIRED');return release

def main():
 need(len(sys.argv)==1 and os.getuid()!=0 and pwd.getpwuid(os.getuid()).pw_name==RUNTIME_USER,'ORIGINAL_NONROOT_SERVICE_USER_REQUIRED');os.umask(0o077);private_dir(SERVICE);private_dir(ACCOUNT)
 need(resource.getrlimit(resource.RLIMIT_CPU)[1]==resource.RLIM_INFINITY and resource.getrlimit(resource.RLIMIT_FSIZE)[1]==resource.RLIM_INFINITY,'SERVICE_MUST_NOT_INHERIT_CUMULATIVE_RESEARCH_LIMITS')
 host=verify_host();manifest=validate_manifest(json.loads(read_file(MANIFEST,128*1024,uid=0,private=False)));release=release_verified(manifest);node=NODE.resolve(strict=True);ns=node.stat();need(node==NODE and stat.S_ISREG(ns.st_mode)and ns.st_uid==0 and not ns.st_mode&0o022 and os.access(node,os.X_OK),'ORIGINAL_ROOT_OWNED_NODE_REQUIRED')
 version=subprocess.run([str(node),'--version'],capture_output=True,text=True,timeout=3,env={'PATH':'/usr/bin:/bin'},check=True).stdout.strip();need(version.startswith('v24.')and int(version.split('.')[1])>=19,'EXISTING_NODE24_REQUIRED');credential_path()
 lease=os.open(SERVICE/'supervisor.owner.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);ls=os.fstat(lease);need(stat.S_ISREG(ls.st_mode)and ls.st_uid==UID and ls.st_nlink==1 and stat.S_IMODE(ls.st_mode)==0o600,'PRIVATE_SUPERVISOR_LEASE_REQUIRED');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
 # The reviewed root cutover owns initial audit/backup/source input publication.
 # This process never initializes, imports, reseeds or opens the original DB.
 ds=LEDGER.lstat();need(stat.S_ISREG(ds.st_mode)and ds.st_uid==UID and ds.st_nlink==1 and stat.S_IMODE(ds.st_mode)==0o600 and LEDGER.resolve(strict=True)==LEDGER,'ORIGINAL_EXISTING_LEDGER_REQUIRED')
 helpers=types.SimpleNamespace(resource_process_views=resource_process_views,available_memory=available_memory,self_rss=self_rss)
 logsdir=SERVICE/'diagnostics'
 if not logsdir.exists():logsdir.mkdir(mode=0o700)
 private_dir(logsdir);logs={name:RotatingDiagnostic(logsdir,name,POLICY['resourceFileBytes']if name=='supervisor'else POLICY['diagnosticFileBytes'],POLICY['resourceFiles']if name=='supervisor'else POLICY['diagnosticFiles'])for name in['source','publisher','supervisor']};controller=Supervisor(manifest,helpers,logs)
 def stop(_signal,_frame):controller.stopping=True
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 atomic(SERVICE/'startup.json',{'at':int(time.time()*1000),'source':manifest['source'],'nodeVersion':version,'host':host,'localMetadataRequests':2,'accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'financialDatabaseRead':False,'providerRequests':0,'lifetimeStopBudgets':None})
 try:controller.run()
 finally:os.close(lease)
if __name__=='__main__':
 try:main()
 except(Guard,OSError,ValueError,subprocess.SubprocessError):print(json.dumps({'kind':'POE_AUTHORITATIVE_SERVICE_UNAVAILABLE','reason':'configuration, resource or recovery precondition unavailable','financialDatabaseRead':False,'financialHistoryReset':False}),flush=True);raise SystemExit(1)
