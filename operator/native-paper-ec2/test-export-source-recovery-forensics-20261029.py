#!/usr/bin/env python3
"""Disposable files only; never reads production paths or changes identity."""
import contextlib,hashlib,importlib.util,io,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('export-source-recovery-forensics-20261029.py');spec=importlib.util.spec_from_file_location('restart_forensics',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
LEAK='PRIVATE_WALLET_PROVIDER_FINANCIAL_VALUE_MUST_NEVER_APPEAR'
class Fixtures(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='poe-OFFLINE-restart-forensics-');self.root=pathlib.Path(self.tmp.name);self.uid=os.getuid()
 def tearDown(self):self.tmp.cleanup()
 def write(self,p,value):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(value if type(value)is bytes else(json.dumps(value)+'\n').encode());p.chmod(0o600)
 def result(self,run=m.RUNS[0]):return {'accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'runId':run,'source':dict(m.SOURCE),'configurationSha256':m.CONFIGURATION,'mode':'paper','liveTradingEnabled':False,'running':False,'startedAt':m.START-600000,'generatedAt':m.START+10000,'runtimePid':123,'entriesEnabled':False,'status':'runtime failure; financial exposure retained: PILOT_WATCH_WINDOW_REQUIRES_DEEP','positions':LEAK,'pending':LEAK,'financial':LEAK,'snapshot':LEAK,'safety':LEAK,'financialReadiness':{'safety':{'idle':True,'evidenceAvailable':True,'financialAvailable':True,'uncertainActions':0,'secret':LEAK}},'proofPreparation':{'state':'failed','attempts':1,'provider':LEAK},'funnel':{'qualified':0,'attempted':0,'paperFilled':0,'reconciled':100,'wallet':LEAK},'sourceRecovery':{'generation':0,'failures':0,'reason':LEAK}}
 def test_bound_run_result_error_without_financial_payload(self):
  d=self.result();out=m.result_fact(d,m.RUNS[0]);self.assertEqual(out['statusReason']['code'],'PILOT_WATCH_WINDOW_REQUIRES_DEEP');self.assertNotIn(LEAK,json.dumps(out));self.assertEqual(out['proofPreparation']['attempts'],1);self.assertEqual(out['funnel']['reconciled'],100)
 def test_unknown_reason_is_hash_only(self):
  r=m.reason('runtime failure; financial exposure retained: '+LEAK);self.assertEqual(r['code'],'SOURCE_RECOVERY_UNKNOWN');self.assertEqual(r['sha256'],hashlib.sha256(('runtime failure; financial exposure retained: '+LEAK).encode()).hexdigest());self.assertNotIn(LEAK,json.dumps(r))
 def test_all_identity_components_are_required(self):
  for key,value in [('accountId','WRONG'),('inceptionAt',0),('runId',m.RUNS[1]),('source',{'commit':'a'*40,'sha256':'b'*64}),('configurationSha256','c'*64),('mode','LIVE'),('liveTradingEnabled',True)]:
   d=self.result();d[key]=value
   with self.subTest(key=key),self.assertRaises(m.Refused):m.result_fact(d,m.RUNS[0])
 def test_fixed_result_and_settlement_missingness_is_explicit(self):
  p=self.root/m.RUNS[0];self.write(p/'result.json',self.result());self.write(p/'settlement.json',{'at':m.START,'physicalSettlementConfirmed':True,'financialHistoryPreserved':True,'positions':0,'pending':0,'quantity':LEAK});before=(p/'result.json').read_bytes();r=m.run_facts(self.root,self.uid);self.assertTrue(r[0]['result']['available']);self.assertTrue(r[0]['settlement']['available']);self.assertFalse(r[1]['result']['available']);self.assertNotIn(LEAK,json.dumps(r));self.assertEqual(before,(p/'result.json').read_bytes())
 def test_result_symlink_hardlink_mode_and_oversize_refuse(self):
  p=self.root/'a';self.write(p,self.result());q=self.root/'link';q.symlink_to(p)
  with self.assertRaises(m.Refused):m.read(q,m.MAX_STATUS,self.uid)
  q.unlink();os.link(p,q)
  with self.assertRaises(m.Refused):m.read(p,m.MAX_STATUS,self.uid)
  q.unlink();p.chmod(0o644)
  with self.assertRaises(m.Refused):m.read(p,m.MAX_STATUS,self.uid)
  p.chmod(0o600)
  with self.assertRaises(m.Refused):m.read(p,4,self.uid)
 def test_source_console_known_errors_and_unknown_strings_are_safe(self):
  out=m.source_line(b'PAPER_SERVICE_QUALIFICATION_PROOF_INCOMPLETE');self.assertTrue(out['timingUnknown']);self.assertEqual(out['reason']['code'],'PAPER_SERVICE_QUALIFICATION_PROOF_INCOMPLETE')
  self.assertNotIn(LEAK,json.dumps(m.source_line(LEAK.encode())));self.assertIsNone(m.source_line(json.dumps({'financial':LEAK}).encode()))
  row=m.source_line(json.dumps({'runId':m.RUNS[0],'accountId':m.ACCOUNT,'running':False,'financial':LEAK}).encode());self.assertEqual(row,{'kind':'source-final-console','runId':m.RUNS[0],'running':False})
 def test_unsafe_error_prefix_suffix_and_unknown_case_do_not_leak(self):
  for value in ['PAPER_'+LEAK,'PAPER_'+LEAK+'/secret','PILOT_ERROR '+LEAK,'https://provider/'+LEAK,'PAPER_PASSWORD='+LEAK]:self.assertNotIn(LEAK,json.dumps(m.reason(value)))
 def test_supervisor_timestamps_and_safe_scalars_only(self):
  row={'at':m.START+1000,'kind':'source-stop-request','data':{'reason':'source exited; retained-obligation restart','settled':True,'positions':LEAK,'secret':LEAK,'returncode':1}}
  out=m.supervisor_line(json.dumps(row).encode());self.assertEqual(out['reason']['code'],'source exited; retained-obligation restart');self.assertEqual(out['returncode'],1);self.assertNotIn(LEAK,json.dumps(out));row['at']=m.START-1;self.assertIsNone(m.supervisor_line(json.dumps(row).encode()));row['at']=m.END;self.assertIsNone(m.supervisor_line(json.dumps(row).encode()))
 def test_logs_drop_partial_and_oversized_fragments(self):
  d=self.root/'logs';d.mkdir();self.write(d/'source-0.log',b'PAPER_SERVICE_ERROR\n'+b'x'*(m.MAX_LINE+1)+b'\nPAPER_INCOMPLETE_FRAGMENT');self.write(d/'supervisor-0.log',json.dumps({'at':m.START,'kind':'source-started','data':{'pid':123,'secret':LEAK}}).encode()+b'\n')
  r=m.log_facts(d,self.uid);files={x['file']:x for x in r['files']};self.assertEqual(len(r['facts']),2);self.assertEqual(files['source-0.log']['oversizedLines'],1);self.assertTrue(files['source-0.log']['trailingFragmentDiscarded']);self.assertNotIn(LEAK,json.dumps(r));self.assertFalse(files['source-1.log']['available']);self.assertIn('do not establish',r['meaning'])
 def test_log_read_deadline_and_file_bound_are_explicit(self):
  d=self.root/'logs';d.mkdir();self.write(d/'source-0.log',b'x'*(m.MAX_LOG+1));r=m.log_facts(d,self.uid);files={x['file']:x for x in r['files']};self.assertFalse(files['source-0.log']['available']);r=m.log_facts(d,self.uid,budget_seconds=-1);self.assertTrue(all(x['reason']=='LOG_READ_DEADLINE'for x in r['files']))
 def test_supervisor_precedes_noisy_source_and_preserves_known_recovery_reason(self):
  d=self.root/'logs';d.mkdir();self.write(d/'source-0.log',b'PAPER_SERVICE_ERROR\n'*(m.MAX_FACTS+1));self.write(d/'supervisor-0.log',json.dumps({'at':m.START+1000,'kind':'source-stop-request','data':{'reason':'critical resource or stale runtime; durable recovery required'}}).encode()+b'\n');r=m.log_facts(d,self.uid);self.assertEqual(r['facts'][0]['reason']['code'],'critical resource or stale runtime; durable recovery required');self.assertEqual(r['facts'][0]['file'],'supervisor-0.log');self.assertEqual(len(r['facts']),m.MAX_FACTS);self.assertTrue(r['factCapacityReached'])
 def test_publication_is_atomic_and_refuses_symlink(self):
  d=self.root/'public';d.mkdir(mode=0o755);p=d/'out.json';r=m.publish(p,{'safe':True},self.uid);self.assertEqual(p.stat().st_mode&0o777,0o644);self.assertEqual(r['sha256'],hashlib.sha256(p.read_bytes()).hexdigest());p.unlink();outside=self.root/'untouched';outside.write_text(LEAK);p.symlink_to(outside)
  with self.assertRaises(m.Refused):m.publish(p,{'safe':True},self.uid)
  self.assertEqual(outside.read_text(),LEAK)
 def test_main_drops_before_private_read_has_no_path_arguments(self):
  events=[]
  def private(*_):self.assertEqual(events,['drop']);return []
  with patch.object(m.sys,'argv',['fixed']),patch.object(m,'drop_original_identity',lambda:events.append('drop')),patch.object(m,'run_facts',private),patch.object(m,'log_facts',private),patch.object(m,'publish',lambda *_:{'path':str(m.OUTPUT),'bytes':1,'sha256':'a'*64}),contextlib.redirect_stdout(io.StringIO()):m.main()
  with patch.object(m.sys,'argv',['fixed','--elsewhere']),self.assertRaises(m.Refused):m.main()
 def test_permanent_drop_removes_groups_and_saved_privileges(self):
  events=[];ids={'u':(0,0,0),'g':(0,0,0)}
  def gid(*x):events.append('gid');ids['g']=x
  def uid(*x):events.append('uid');ids['u']=x
  with patch.object(m.os,'geteuid',lambda:0),patch.object(m.os,'closerange',lambda *x:events.append('fds')),patch.object(m.os,'setgroups',lambda x:events.append('groups')),patch.object(m.os,'setresgid',gid),patch.object(m.os,'setresuid',uid),patch.object(m.os,'getresuid',lambda:ids['u']),patch.object(m.os,'getresgid',lambda:ids['g']):m.drop_original_identity()
  self.assertEqual(events,['fds','groups','gid','uid']);self.assertEqual(ids,{'u':(988,988,988),'g':(982,982,982)})
if __name__=='__main__':unittest.main()
