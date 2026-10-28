#!/usr/bin/env python3
"""One read-only HTTP component check using existing reviewed host helpers."""
import fcntl
import ctypes
import hashlib
import importlib.util
import json
import os
import pathlib
import pwd
import resource
import signal
import stat
import subprocess
import time

UID=994
ROOT=pathlib.Path('/home/mm-ec2-runner/.local/share/poe-native-paper')
ACCOUNT=ROOT/'account'
SOURCE={'commit':'c189a54b7978692ef2f7d098d6b3374aea8deb72','sha256':'02d455d81e672bddb08958fc822520aefaaa6241e78b8b9b32ee57146895556c'}
ACCOUNT_ID='poe-pilot-8468add6-f916-48cf-a585-6cd008a81360'
INCEPTION=1793123773252
SELECTOR=pathlib.Path('scripts/poe/native-candidate-run-bounded.py')
SELECTOR_SHA='23a6a1573bca181041ea9db55164f05197ad929e5a53ace89613f64011b7dd6b'
PROBE=pathlib.Path('operator/native-paper-ec2/http-latency-probe.mjs')
PLAN=pathlib.Path('operator/native-paper-ec2/http-latency-plan.json')
MIB=1024*1024

def need(v,reason):
    if not v: raise RuntimeError(reason)

def sha(b): return hashlib.sha256(b).hexdigest()

def read(path,maximum,private=True):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==UID and s.st_nlink==1 and 0<s.st_size<=maximum and not s.st_mode&(0o077 if private else 0o022),'BOUNDED_OWNER_FILE')
        b=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(b)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'FILE_CHANGED');return b
    finally:os.close(fd)

def save(path,value):
    raw=(json.dumps(value,separators=(',',':'))+'\n').encode();need(len(raw)<=1024*1024,'RECEIPT_BOUND')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        n=0
        while n<len(raw):n+=os.write(fd,raw[n:])
        os.fsync(fd)
    finally:os.close(fd)

def flat_stopped(status,settlement,now=None):
    now=int(time.time()*1000) if now is None else now
    need(status.get('accountId')==ACCOUNT_ID and status.get('inceptionAt')==INCEPTION and status.get('mode')=='paper' and status.get('running') is False and status.get('liveTradingEnabled') is False,'FIXED_STOPPED_PAPER_SOURCE')
    need({k:status.get('source',{}).get(k)for k in ['commit','sha256']}==SOURCE and status.get('runId')=='native-paper-20261028210805129','EXACT_COMPLETED_SOURCE')
    need(status.get('positions')=={} and status.get('pending')=={} and settlement.get('physicalSettlementConfirmed') is True and type(settlement.get('positions'))is int and settlement['positions']==0 and type(settlement.get('pending'))is int and settlement['pending']==0 and settlement.get('financialHistoryPreserved') is True,'FLAT_PHYSICAL_SETTLEMENT_REQUIRED')
    generated=status.get('generatedAt');cooldown=status.get('usage',{}).get('rpc',{}).get('cooldownUntil');need(type(generated)is int and 0<generated<=now-60000 and type(cooldown)is int and 0<=cooldown<=now,'PRIOR_ROLLING_WINDOW_AND_COOLDOWN_REQUIRED')
    pid=status.get('runtimePid');need(type(pid)is int and pid>1,'OLD_SOURCE_PID')
    try:os.kill(pid,0)
    except ProcessLookupError:pass
    else:raise RuntimeError('PREVIOUS_SOURCE_STILL_EXISTS')

def launch_probe(args,fd,leases):
    parent_pid=os.getpid()
    def bounds():
        libc=ctypes.CDLL(None,use_errno=True);need(libc.prctl(1,signal.SIGKILL,0,0,0)==0,'PARENT_DEATH_GUARD')
        if os.getppid()!=parent_pid:os.kill(os.getpid(),signal.SIGKILL)
        os.nice(19);resource.setrlimit(resource.RLIMIT_CPU,(8,9));resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));resource.setrlimit(resource.RLIMIT_FSIZE,(MIB,MIB));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    return subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=fd,stderr=fd,env={'PATH':'/usr/bin:/bin'},start_new_session=True,preexec_fn=bounds,close_fds=True,pass_fds=tuple(leases))

def main():
    started=time.monotonic();wall=int(time.time()*1000);os.umask(0o077)
    def cancelled(_signal,_frame):raise KeyboardInterrupt('CANCELLED')
    for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGXCPU]:signal.signal(sig,cancelled)
    need(os.getuid()==UID and pwd.getpwuid(UID).pw_name=='mm-ec2-runner' and os.environ.get('ACTUAL_RUNNER')=='meme-machine-ec2-admin','FIXED_NONROOT_RUNNER')
    raw=read(SELECTOR,65536,False);need(sha(raw)==SELECTOR_SHA,'REVIEWED_EXISTING_HELPER')
    spec=importlib.util.spec_from_file_location('existing_poe_helpers',SELECTOR);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
    probe=read(PROBE,32768,False);plan=read(PLAN,8192,False);need(sha(probe)==os.environ.get('EXPECTED_PROBE_SHA256') and sha(plan)==os.environ.get('EXPECTED_PLAN_SHA256'),'EXACT_REVIEWED_PROBE_PLAN')
    status_raw=read(ACCOUNT/'status.json',4*MIB);s=json.loads(status_raw);settlement_raw=read(ACCOUNT/'runs/native-paper-20261028210805129/settlement.json',16384);flat_stopped(s,json.loads(settlement_raw))
    leases=[]
    try:
        for path in ['/tmp/poe-public-component-20261027.lock','/tmp/poe-pumpapi-probe.lock']:
            fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK);leases.append(fd);v=os.fstat(fd);need(stat.S_ISREG(v.st_mode) and v.st_uid==UID and stat.S_IMODE(v.st_mode)==0o600,'EXISTING_RESEARCH_LEASE_REQUIRED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(read(ACCOUNT/'status.json',4*MIB)==status_raw and read(ACCOUNT/'runs/native-paper-20261028210805129/settlement.json',16384)==settlement_raw,'SOURCE_CHANGED_DURING_ADMISSION')
        host=h.identity();before=h.observer();mem=int(next(x.split()[1]for x in pathlib.Path('/proc/meminfo').read_text().splitlines()if x.startswith('MemAvailable:')))*1024;disk=os.statvfs(ROOT)
        need(mem>=1024*MIB and disk.f_bavail*disk.f_frsize>=256*MIB,'HOST_HEADROOM')
        node,version=h.existing_node(pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True));op=os.environ.get('GITHUB_RUN_ID','')+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','');need(op.count('-')==1 and all(x.isdigit() and 1<=len(x)<=24 for x in op.split('-')),'FIXED_OPERATION')
        root=ROOT/'diagnostics';root.mkdir(mode=0o700,exist_ok=True);v=root.lstat();need(stat.S_ISDIR(v.st_mode) and v.st_uid==UID and not v.st_mode&0o077 and root.resolve()==root,'PRIVATE_DIAGNOSTIC_ROOT');out=root/('http-latency-'+op);out.mkdir(mode=0o700)
        save(out/'before.json',{'kind':'poe-http-latency-preflight-v1','startedAt':wall,'uid':UID,'host':host,'originalObserver':before,'source':SOURCE,'accountId':ACCOUNT_ID,'inceptionAt':INCEPTION,'priorRunId':s['runId'],'financialDatabaseRead':False,'metadataUnits':2,'reservedProviderRequestUnits':9,'reservedResponseBodyBytes':12*MIB+12288,'uncertainResponseReserveBytes':18*MIB,'sourceStatusSha256':sha(status_raw),'settlementSha256':sha(settlement_raw),'nodeVersion':version})
        need(time.monotonic()-started<12,'SETUP_TIME_RESERVE');log=out/'process.log';fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        p=None;settled=False;maximum_rss=0;failure=None
        try:
            p=launch_probe([node,'--max-old-space-size=96',str(PROBE.resolve()),'--run',str(PLAN.resolve()),str(out/'operations.ndjson'),str(out/'before.json')],fd,leases)
            while p.poll() is None:
                rss=h.group_rss(p.pid);maximum_rss=max(maximum_rss,rss)
                if time.monotonic()-started>=37 or rss>192*MIB or log.stat().st_size>=MIB or os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize<128*MIB:
                    failure='TIME_OR_RESOURCE_STOP';break
                time.sleep(.05)
        finally:
            if p is not None:settled=h.terminate(p,grace=.25)
            os.close(fd)
        after=h.observer();unchanged=before['service']==after['service'] and all(before['publicStatus'][k]==after['publicStatus'][k]for k in ['accountId','inceptionAt','release','mode','liveTrading','entriesDisabled'])
        need(read(ACCOUNT/'status.json',4*MIB)==status_raw and read(ACCOUNT/'runs/native-paper-20261028210805129/settlement.json',16384)==settlement_raw,'ACCOUNT_STATUS_CHANGED')
        need(unchanged,'ORIGINAL_OBSERVER_CHANGED');body=read(log,MIB) if log.stat().st_size else b'';result={'kind':'POE_HTTP_LATENCY_HOST_PROBE','sourceSha256':sha(probe),'planSha256':sha(plan),'metadataUnits':2,'elapsedMs':round((time.monotonic()-started)*1000),'sourceGroupSettled':settled,'sourceExit':None if p is None else p.returncode,'maximumSourceGroupRssBytes':maximum_rss,'failure':failure,'originalObserverUnchanged':unchanged,'financialFilesModified':False,'financialDatabaseRead':False,'privateEvidence':str(out),'stdoutBytes':len(body),'stdoutSha256':sha(body),'unresolvedReceiptPolicy':'If child is interrupted, retain every started request and its2MiB uncertainty; no local reservation refund.'};save(out/'host-result.json',result);print(body.decode(),end='');print(json.dumps(result,separators=(',',':')))
        need(settled and failure is None and p is not None and p.returncode==0,'DIAGNOSTIC_NOT_COMPLETE')
    finally:
        for fd in leases:os.close(fd)

if __name__=='__main__':
    try:main()
    except BaseException:
        print(json.dumps({'kind':'POE_HTTP_LATENCY_HOST_REFUSAL','complete':False,'marketOrFinancialSuccessClaimed':False}));raise
