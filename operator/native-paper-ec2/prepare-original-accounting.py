#!/usr/bin/env python3
"""Fixed-path, read-only stopped-research accounting handoff for original cutover.

No financial database, credentials, provider, service changes or old-file writes.
The existing financial/market leases are acquired read-only and held through
child settlement. Only a new private /var/tmp handoff directory is created.
"""
import ctypes,errno,fcntl,hashlib,json,os,pathlib,pwd,resource,signal,stat,subprocess,time,types
UID=994
ACCOUNT=pathlib.Path('/home/mm-ec2-runner/.local/share/poe-native-paper/account')
OUTPUT=pathlib.Path('/var/tmp/poe-issue11-accounting')
HELPER=pathlib.Path('operator/native-paper-ec2/prepare-original-accounting.mjs')
SELECTOR=pathlib.Path('scripts/poe/native-candidate-run-bounded.py')
SELECTOR_SHA='23a6a1573bca181041ea9db55164f05197ad929e5a53ace89613f64011b7dd6b'
PHASE='startup'
PHASES=frozenset(['startup','runner-identity','account-directory','reviewed-helper','existing-runner-node','stopped-source-pid','existing-owner-leases','new-output-directory','child-start','child-monitor','child-settlement','result-readback'])
LOCKS=[ACCOUNT/'ledger.sqlite.owner.lock',pathlib.Path('/tmp/poe-public-component-20261027.lock'),pathlib.Path('/tmp/poe-pumpapi-probe.lock')]
MIB=1024*1024
class Guard(RuntimeError):pass
def need(value,code):
 if not value:raise Guard(code)
def identity(s):return(s.st_dev,s.st_ino,s.st_uid,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(path,maximum,owner=UID,mode=0o600):
 need(path.resolve(strict=True)==path.resolve().absolute() and path.parent.resolve(strict=True)==path.parent.absolute(),'CANONICAL_INPUT_REQUIRED')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==owner and stat.S_IMODE(s.st_mode)==mode and s.st_nlink==1 and 0<s.st_size<=maximum,'BOUNDED_OWNER_FILE')
  raw=os.read(fd,s.st_size+1);need(len(raw)==s.st_size and identity(os.fstat(fd))==identity(s),'INPUT_CHANGED');return raw
 finally:os.close(fd)
def lock_existing(paths=LOCKS,owner=UID):
 leases=[]
 try:
  for path in paths:
   fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);leases.append(fd);s=os.fstat(fd)
   need(stat.S_ISREG(s.st_mode)and s.st_uid==owner and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1,'EXISTING_PRIVATE_LEASE_REQUIRED')
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:raise Guard('EXISTING_OWNER_STILL_ACTIVE')
   need(identity(s)==identity(path.lstat()),'EXISTING_LEASE_CHANGED')
  return leases
 except BaseException:
  for fd in leases:os.close(fd)
  raise

def phase(value):
 global PHASE
 need(value in PHASES,'INVALID_DIAGNOSTIC_PHASE');PHASE=value
def safe_failure(error):
 number=getattr(error,'errno',None);number=number if type(number)is int and 0<=number<=4095 else None
 reason=str(error)if isinstance(error,Guard)and len(str(error))<=120 and all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'for c in str(error))else'LOCAL_ACCESS_OR_SETTLEMENT_FAILURE'
 return {'reason':reason,'phase':PHASE if PHASE in PHASES else'unknown','exceptionType':type(error).__name__[:64],'errno':number,'errnoName':errno.errorcode.get(number)}
def existing_runner_node():
 # Execute exactly the previously reviewed selector bytes; call only its narrow
 # existing_node routine. No install, provider or service function is invoked.
 raw=read(SELECTOR,65536,mode=0o644);need(hashlib.sha256(raw).hexdigest()==SELECTOR_SHA,'REVIEWED_NODE_SELECTOR_HASH')
 temp_value=os.environ.get('RUNNER_TEMP');need(isinstance(temp_value,str)and bool(temp_value),'EXISTING_RUNNER_TEMP_REQUIRED')
 temp=pathlib.Path(temp_value);need(temp.is_absolute()and temp.resolve(strict=True)==temp and temp.name=='_temp'and temp.parent.name=='_work','FIXED_RUNNER_TEMP_REQUIRED')
 module=types.ModuleType('poe_existing_reviewed_node_selector');module.__file__=str(SELECTOR.resolve());exec(compile(raw,str(SELECTOR),'exec'),module.__dict__)
 return module.existing_node(temp)

def rss(pid):
 try:return int(next(line.split()[1]for line in pathlib.Path('/proc/'+str(pid)+'/status').read_text().splitlines()if line.startswith('VmRSS:')))*1024
 except FileNotFoundError:return 0

def main():
 need(len(os.sys.argv)==1,'NO_ARGUMENTS_OR_ALTERNATE_PATHS');start=time.monotonic();os.umask(0o077)
 phase('runner-identity');need(os.getuid()==UID and pwd.getpwuid(UID).pw_name=='mm-ec2-runner' and os.environ.get('ACTUAL_RUNNER')=='meme-machine-ec2-admin','FIXED_NONROOT_RUNNER')
 phase('account-directory');need(ACCOUNT.resolve(strict=True)==ACCOUNT,'CANONICAL_FIXED_ACCOUNT');s=ACCOUNT.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==UID and stat.S_IMODE(s.st_mode)==0o700,'PRIVATE_FIXED_ACCOUNT')
 phase('reviewed-helper');helper=read(HELPER,512*1024,mode=0o644);need(hashlib.sha256(helper).hexdigest()==os.environ.get('EXPECTED_PREPARE_ACCOUNTING_SHA256'),'REVIEWED_HELPER_HASH')
 phase('existing-runner-node');node,node_version=existing_runner_node()
 phase('stopped-source-pid');source=json.loads(read(ACCOUNT/'status.json',4*MIB));pid=source.get('runtimePid');need(type(pid)is int and pid>1,'OLD_RUNTIME_PID')
 try:os.kill(pid,0)
 except ProcessLookupError:pass
 except PermissionError:raise Guard('OLD_RUNTIME_PID_UNVERIFIABLE')
 else:raise Guard('OLD_RUNTIME_STILL_EXISTS')
 phase('existing-owner-leases');leases=lock_existing();p=None;logfd=None;failure=None;maximum_rss=0;settled=False
 try:
  phase('new-output-directory');OUTPUT.mkdir(mode=0o700) # Exclusive: a partial/completed preparation is never replaced.
  d=os.open(OUTPUT.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
  log=OUTPUT/'process.log';logfd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  parent=os.getpid()
  def bounds():
   libc=ctypes.CDLL(None,use_errno=True);need(libc.prctl(1,signal.SIGKILL,0,0,0)==0,'PARENT_DEATH_GUARD')
   if os.getppid()!=parent:os.kill(os.getpid(),signal.SIGKILL)
   os.nice(19);resource.setrlimit(resource.RLIMIT_CPU,(20,21));resource.setrlimit(resource.RLIMIT_NOFILE,(128,128));resource.setrlimit(resource.RLIMIT_FSIZE,(MIB,MIB));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  env={'PATH':'/usr/bin:/bin','POE_ACCOUNTING_PREP_LEASE_FDS':','.join(str(fd)for fd in leases),'POE_ORIGINAL_RUNTIME_UID':str(pwd.getpwnam('poe-runtime').pw_uid)}
  phase('child-start');p=subprocess.Popen([str(node),'--max-old-space-size=96',str(HELPER.resolve())],stdin=subprocess.DEVNULL,stdout=logfd,stderr=logfd,env=env,start_new_session=True,preexec_fn=bounds,close_fds=True,pass_fds=tuple(leases))
  phase('child-monitor')
  while p.poll()is None:
   maximum_rss=max(maximum_rss,rss(p.pid))
   if time.monotonic()-start>=85 or maximum_rss>256*MIB or log.stat().st_size>=MIB or os.statvfs(OUTPUT).f_bavail*os.statvfs(OUTPUT).f_frsize<128*MIB:
    failure='TIME_MEMORY_DISK_OR_OUTPUT_LIMIT';p.terminate();break
   time.sleep(.05)
  phase('child-settlement')
  try:p.wait(timeout=3)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=1)
  settled=p.poll()is not None
  os.close(logfd);logfd=None
  phase('result-readback');raw=read(log,MIB)if log.stat().st_size else b''
  # Output contains only allowlisted public-status/accounting artifacts encoded by
  # the reviewed helper. Preserve refusal logs in-place, never rewrite outputs.
  if raw:print(raw.decode('utf8'),end='')
  print(json.dumps({'kind':'POE_ORIGINAL_ACCOUNTING_PREP_WRAPPER','complete':settled and p.returncode==0 and failure is None,'elapsedMs':round((time.monotonic()-start)*1000),'maximumRssBytes':maximum_rss,'childSettled':settled,'childExit':p.returncode,'failure':failure,'helperSha256':hashlib.sha256(helper).hexdigest(),'nodeVersion':node_version,'nodeSelection':'existing-reviewed-runner-node-only','processLogBytes':len(raw),'processLogSha256':hashlib.sha256(raw).hexdigest(),'financialDatabaseOpened':False,'providerRequests':0,'serviceChanges':0,'oldFilesModified':False},separators=(',',':')),flush=True)
  need(settled and p.returncode==0 and failure is None and time.monotonic()-start<=90,'PREPARATION_INCOMPLETE')
 finally:
  if p is not None and p.poll()is None:p.kill();p.wait(timeout=2)
  if logfd is not None:os.close(logfd)
  for fd in leases:os.close(fd)
if __name__=='__main__':
 try:main()
 except BaseException as error:
  print(json.dumps({'kind':'POE_ORIGINAL_ACCOUNTING_PREP_WRAPPER_REFUSED','complete':False,**safe_failure(error),'financialDatabaseOpened':False,'providerRequests':0,'serviceChanges':0},separators=(',',':')),flush=True);raise SystemExit(1)
