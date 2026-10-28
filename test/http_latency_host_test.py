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
                    while time.monotonic()<deadline:
                        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                        except BlockingIOError:time.sleep(.01)
                    else:self.fail('child retained lease after parent death')
                    path=pathlib.Path('/proc')/str(child)/'stat'
                    self.assertTrue(not path.exists()or path.read_text().rsplit(')',1)[1].split()[0]=='Z')
                finally:os.close(fd)
            finally:
                if p.poll()is None:p.kill();p.wait(timeout=2)
                p.stdout.close()
                if child:
                    try:os.kill(child,signal.SIGKILL)
                    except ProcessLookupError:pass

if __name__=='__main__':unittest.main()
