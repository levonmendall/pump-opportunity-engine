import copy
import fcntl
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

MODULE=pathlib.Path(__file__).resolve().parents[1]/'operator/native-paper-ec2/http-latency-run.py'
spec=importlib.util.spec_from_file_location('latency_host',MODULE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def read_child_stat(path):
    # The child can disappear before open (ENOENT) or during read (ESRCH).
    # Only these two process-disappearance conditions mean exited. Permission,
    # I/O and other failures remain failures; the separate lease check stays.
    try:return path.read_text()
    except (FileNotFoundError,ProcessLookupError):return None

def wait_child_and_lease(fd,path,deadline):
    # Releasing inherited FDs and becoming absent/zombie are separate kernel
    # observations. Keep our reacquired lease held until BOTH are confirmed;
    # neither observation alone permits the test to report settlement.
    lease_acquired=False;child_stat=None
    while time.monotonic()<deadline:
        if not lease_acquired:
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);lease_acquired=True
            except BlockingIOError:pass
        child_stat=read_child_stat(path)
        child_settled=child_stat is None or child_stat.rsplit(')',1)[1].split()[0]=='Z'
        if lease_acquired and child_settled:return lease_acquired,child_stat
        time.sleep(.01)
    raise TimeoutError('child/lease settlement unverified: leaseAcquired='+str(lease_acquired)+'; childStat='+str(child_stat))

class HostContract(unittest.TestCase):
    def fixture(self):
        return {'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'mode':'paper','running':False,'liveTradingEnabled':False,'source':m.SOURCE.copy(),'runId':'native-paper-20261028210805129','positions':{},'pending':{},'runtimePid':99999999,'generatedAt':100000,'usage':{'rpc':{'cooldownUntil':0}}},{'physicalSettlementConfirmed':True,'positions':0,'pending':0,'financialHistoryPreserved':True}
    def test_exact_flat_stopped_boundary(self):
        s,t=self.fixture()
        with patch.object(m.os,'kill',side_effect=ProcessLookupError):m.flat_stopped(s,t,now=160000)
        for key,value in [('running',True),('liveTradingEnabled',True),('positions',{'token':{}}),('pending',{'order':{}}),('accountId','other'),('source',{})]:
            v=copy.deepcopy(s);v[key]=value
            with self.assertRaises(RuntimeError),patch.object(m.os,'kill',side_effect=ProcessLookupError):m.flat_stopped(v,t,now=160000)
    def test_still_live_pid_is_blocker(self):
        s,t=self.fixture()
        with self.assertRaises(RuntimeError),patch.object(m.os,'kill',return_value=None):m.flat_stopped(s,t,now=160000)
    def test_prior_rolling_and_provider_cooldown_preserved(self):
        s,t=self.fixture()
        for now,cool in [(159999,0),(160000,160001),(160000,None)]:
            v=copy.deepcopy(s);v['usage']['rpc']['cooldownUntil']=cool
            with self.assertRaises(RuntimeError),patch.object(m.os,'kill',side_effect=ProcessLookupError):m.flat_stopped(v,t,now=now)
    def test_unknown_physical_or_financial_state_is_blocker(self):
        s,t=self.fixture()
        for k in ['physicalSettlementConfirmed','financialHistoryPreserved']:
            v=t.copy();v[k]=False
            with self.assertRaises(RuntimeError),patch.object(m.os,'kill',side_effect=ProcessLookupError):m.flat_stopped(s,v,now=160000)
    def test_child_reaped_before_open(self):
        with patch.object(pathlib.Path,'read_text',side_effect=FileNotFoundError):
            self.assertIsNone(read_child_stat(pathlib.Path('/proc/fixture/stat')))
    def test_child_reaped_during_read(self):
        with patch.object(pathlib.Path,'read_text',side_effect=ProcessLookupError):
            self.assertIsNone(read_child_stat(pathlib.Path('/proc/fixture/stat')))
    def test_other_child_observation_failures_are_not_exit(self):
        for error in [PermissionError,OSError]:
            with patch.object(pathlib.Path,'read_text',side_effect=error):
                with self.assertRaises(error):read_child_stat(pathlib.Path('/proc/fixture/stat'))
    def test_existing_child_state_is_not_rewritten(self):
        for state in ['123 (fixture) S 0','123 (fixture) Z 0']:
            with patch.object(pathlib.Path,'read_text',return_value=state):
                self.assertEqual(read_child_stat(pathlib.Path('/proc/fixture/stat')),state)
    def test_released_lease_waits_for_physical_exit_and_remains_held(self):
        with patch.object(fcntl,'flock')as flock,patch(__name__+'.read_child_stat',side_effect=['123 (fixture) R 0','123 (fixture) Z 0']),patch.object(time,'monotonic',side_effect=[0,.01]),patch.object(time,'sleep')as sleep:
            lease,child_stat=wait_child_and_lease(123,pathlib.Path('/proc/fixture/stat'),1)
        self.assertTrue(lease);self.assertEqual(child_stat,'123 (fixture) Z 0')
        flock.assert_called_once_with(123,fcntl.LOCK_EX|fcntl.LOCK_NB);sleep.assert_called_once_with(.01)
    def test_physical_exit_does_not_release_an_unverified_lease(self):
        with patch.object(fcntl,'flock',side_effect=BlockingIOError),patch(__name__+'.read_child_stat',return_value=None),patch.object(time,'monotonic',side_effect=[0,1]),patch.object(time,'sleep'):
            with self.assertRaisesRegex(TimeoutError,'leaseAcquired=False'):wait_child_and_lease(123,pathlib.Path('/proc/fixture/stat'),1)
    def test_lease_release_does_not_certify_a_surviving_child(self):
        with patch.object(fcntl,'flock')as flock,patch(__name__+'.read_child_stat',return_value='123 (fixture) R 0'),patch.object(time,'monotonic',side_effect=[0,1]),patch.object(time,'sleep'):
            with self.assertRaisesRegex(TimeoutError,'leaseAcquired=True; childStat=123'):wait_child_and_lease(123,pathlib.Path('/proc/fixture/stat'),1)
        flock.assert_called_once_with(123,fcntl.LOCK_EX|fcntl.LOCK_NB)
    def test_unknown_child_observation_failure_cannot_certify_settlement(self):
        with patch.object(fcntl,'flock'),patch(__name__+'.read_child_stat',side_effect=PermissionError),patch.object(time,'monotonic',return_value=0):
            with self.assertRaises(PermissionError):wait_child_and_lease(123,pathlib.Path('/proc/fixture/stat'),1)
    def test_launcher_parent_death_closes_child_and_inherited_lease(self):
        with tempfile.TemporaryDirectory(prefix='poe-latency-launch-fixture-')as d:
            lock=pathlib.Path(d)/'lease';lock.write_bytes(b'');os.chmod(lock,0o600)
            code="""import importlib.util,os,fcntl,sys,time
spec=importlib.util.spec_from_file_location('probe',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
lease=os.open(sys.argv[2],os.O_RDWR);fcntl.flock(lease,fcntl.LOCK_EX)
out=os.open(sys.argv[3],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
p=m.launch_probe([sys.executable,'-c','import time;time.sleep(60)'],out,[lease]);print(p.pid,flush=True);p.wait()
"""
            p=subprocess.Popen([sys.executable,'-c',code,str(MODULE),str(lock),str(pathlib.Path(d)/'child.log')],stdout=subprocess.PIPE,text=True)
            child=None
            try:
                child=int(p.stdout.readline().strip());fd=os.open(lock,os.O_RDWR)
                try:
                    with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    os.kill(p.pid,signal.SIGKILL);p.wait(timeout=2)
                    deadline=time.monotonic()+2
                    path=pathlib.Path('/proc')/str(child)/'stat'
                    lease_acquired,child_stat=wait_child_and_lease(fd,path,deadline)
                    self.assertTrue(lease_acquired)
                    self.assertTrue(child_stat is None or child_stat.rsplit(')',1)[1].split()[0]=='Z')
                    contender=os.open(lock,os.O_RDWR)
                    try:
                        with self.assertRaises(BlockingIOError):fcntl.flock(contender,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    finally:os.close(contender)
                finally:os.close(fd)
            finally:
                if p.poll()is None:p.kill();p.wait(timeout=2)
                p.stdout.close()
                if child:
                    try:os.kill(child,signal.SIGKILL)
                    except ProcessLookupError:pass

if __name__=='__main__':unittest.main()
