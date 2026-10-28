#!/usr/bin/env python3
"""One finite nonroot diagnostic child; no account, provider, credential or retry logic."""
import ctypes,hashlib,json,os,pathlib,resource,selectors,signal,stat,subprocess,sys,time
MIB=1024*1024
MAX_WALL=35
MAX_RSS=256*MIB
MAX_LOG=65536
MAX_RECEIPT=4*MIB-128*1024

def require(value,reason):
 if not value:raise RuntimeError(reason)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def child_guard(parent):
 require(ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL,0,0,0)==0,'PARENT_DEATH_GUARD');require(os.getppid()==parent,'PARENT_CHANGED')
def supervise(command,log,maximum_wall=MAX_WALL,maximum_rss=MAX_RSS):
 began=time.monotonic();parent=os.getpid();proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=lambda:child_guard(parent));os.set_blocking(proc.stdout.fileno(),False);maximum=0;received=0;retained=0;reason=None;selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ)
 try:
  while proc.poll()is None:
   try:
    text=pathlib.Path('/proc',str(proc.pid),'status').read_text();values=dict(line.split(':',1)for line in text.splitlines()if':'in line);require(int(values['Uid'].split()[0])==os.getuid(),'CHILD_UID_CHANGED');rss=int(values.get('VmRSS','0 kB').split()[0])*1024;maximum=max(maximum,rss)
   except FileNotFoundError:continue
   if rss>maximum_rss:reason='RSS_LIMIT'
   if time.monotonic()-began>maximum_wall:reason='WALL_LIMIT'
   for key,_ in selector.select(0.05):
    try:chunk=os.read(key.fileobj.fileno(),65536)
    except BlockingIOError:continue
    received+=len(chunk)
    if chunk:
     piece=chunk[:MAX_LOG-retained];log.write(piece);retained+=len(piece)
     if received>MAX_LOG:reason='LOG_LIMIT'
   if reason:break
  if reason:
   try:os.killpg(proc.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:proc.wait(timeout=1)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=1)
  else:proc.wait(timeout=1)
  for key,_ in selector.select(0):
   while True:
    try:chunk=os.read(key.fileobj.fileno(),65536)
    except BlockingIOError:break
    if not chunk:break
    received+=len(chunk);piece=chunk[:MAX_LOG-retained];log.write(piece);retained+=len(piece)
    if received>MAX_LOG:reason=reason or'LOG_LIMIT'
  try:os.killpg(proc.pid,0);settled=False
  except ProcessLookupError:settled=True
  if not settled:
   os.killpg(proc.pid,signal.SIGTERM);until=time.monotonic()+1
   while time.monotonic()<until:
    try:os.killpg(proc.pid,0)
    except ProcessLookupError:settled=True;break
    time.sleep(.01)
   if not settled:
    try:os.killpg(proc.pid,signal.SIGKILL)
    except ProcessLookupError:settled=True
  require(settled,'CHILD_GROUP_UNSETTLED')
  return {'sourceExit':proc.returncode,'reason':reason,'elapsedMs':round((time.monotonic()-began)*1000),'maximumSourceRssBytes':maximum,'stdoutReceivedBytes':received,'stdoutRetainedBytes':retained,'physicalProcessGroupSettled':settled,'transportSettlementMeaning':'Use final child result; an outer kill leaves all started/uncertain operations unresolved. No provider retry is authorized by this wrapper.'}
 finally:
  selector.close();proc.stdout.close()
  try:os.killpg(proc.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  if proc.poll()is None:proc.wait(timeout=1)
def main(args):
 require(os.getuid()!=0,'NONROOT_REQUIRED');require(len(args)==4 and args[0]=='--plan'and args[2]=='--output-directory','EXACT_ARGS')
 plan=pathlib.Path(args[1]).absolute();out=pathlib.Path(args[3]).absolute();parent=out.parent;require(not out.exists()and parent.resolve()==parent and parent.is_dir(),'NEW_CANONICAL_OUTPUT');s=parent.stat();require(s.st_uid==os.getuid()and not stat.S_IMODE(s.st_mode)&0o077,'PRIVATE_PARENT_REQUIRED')
 probe=pathlib.Path(__file__).with_name('missing-audit-probe.mjs').resolve();ps=plan.lstat();require(plan.resolve()==plan and stat.S_ISREG(ps.st_mode)and ps.st_uid==os.getuid()and 0<ps.st_size<=32768,'BOUNDED_OWNED_PLAN')
 logpath=parent/(out.name+'.wrapper.log');receiptpath=parent/(out.name+'.wrapper.json');require(not receiptpath.exists(),'NEW_RECEIPT_REQUIRED');fd=os.open(logpath,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb',buffering=0)as log:
  result=supervise(['/usr/bin/nice','-n','19','/usr/bin/prlimit','--cpu=8:9','--nofile=64:128','--fsize='+str(MAX_RECEIPT)+':'+str(MAX_RECEIPT),'--core=0:0','--','node','--use-env-proxy','--max-old-space-size=96',str(probe),'--plan',str(plan),'--output-directory',str(out)],log);os.fsync(log.fileno())
 result.update(schemaVersion=1,classification='bounded-missing-audit-diagnostic-wrapper',uid=os.getuid(),probeSha256=sha(probe),planSha256=sha(plan),wrapperSha256=sha(pathlib.Path(__file__)),stdoutSha256=sha(logpath),limits={'wallSeconds':MAX_WALL,'rssBytes':MAX_RSS,'cpuSoftSeconds':8,'cpuHardSeconds':9,'heapMiB':96,'receiptFileBytes':MAX_RECEIPT,'stdoutBytes':MAX_LOG,'retainedTotalMaximumBytes':4*MIB},providerRequestsMadeByWrapper=0,financialFilesRead=False)
 raw=(json.dumps(result,indent=2)+'\n').encode();require(len(raw)<=32768,'WRAPPER_RECEIPT_LIMIT');fd=os.open(receiptpath,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as receipt:receipt.write(raw);receipt.flush();os.fsync(receipt.fileno())
 print(json.dumps(result));return 0 if result['reason']is None and result['sourceExit']==0 else 1
if __name__=='__main__':
 try:sys.exit(main(sys.argv[1:]))
 except Exception as error:print('MISSING_AUDIT_WRAPPER_REFUSED:'+str(error),file=sys.stderr);sys.exit(2)
