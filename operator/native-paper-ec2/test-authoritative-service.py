#!/usr/bin/env python3
import contextlib,copy,datetime,importlib.util,json,os,pathlib,resource,signal,sys,tempfile,types,unittest
from unittest.mock import patch
p=pathlib.Path(__file__).with_name('run-authoritative-service.py');spec=importlib.util.spec_from_file_location('authoritative_service',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE={'commit':'a'*40,'sha256':'b'*64}
def manifest():
 rows=[{'file':f,'bytes':1,'sha256':SOURCE['sha256']if f=='native-paper.mjs'else'c'*64}for f in m.RELEASE_FILES]
 return {'schemaVersion':1,'kind':'poe-authoritative-persistent-service-v1','source':SOURCE,'configurationSha256':'d'*64,'stage':'single','deepSlots':3,'strategy':'persistent-buying-pilot-v1','files':rows,'policy':m.POLICY}
def status(at,started=None,pid=123):return {'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'mode':'paper','authoritative':True,'experimental':False,'financialExecutionAuthorized':True,'liveTradingEnabled':False,'source':SOURCE,'configurationSha256':'d'*64,'persistent':True,'operatingMode':'persistent-service','managementOnly':False,'runtimePid':pid,'startedAt':started or at-1000,'generatedAt':at,'running':True,'runId':'native-paper-20261029000000000','positions':{},'pending':{}}
def snapshot(at,sequence='1'):
 return {'account':{'id':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION_ISO,'initialUsd':1000},'source':{'release':SOURCE['commit'],'strategy':'persistent-buying-pilot-v1'},'times':{'generatedAt':datetime.datetime.fromtimestamp(at/1000,datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')},'sequence':sequence}
def ack(at,sequence='1',fingerprint='e'*64,raw_source_sha256='f'*64):return {'published':True,'result':'accepted','accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION_ISO,'release':SOURCE['commit'],'sequence':sequence,'sourceAtMs':at,'fingerprint':fingerprint,'rawSourceSha256':raw_source_sha256,'acknowledgedAtMs':at+1}
class Log:
 def __init__(self):self.raw=[]
 def write(self,b):self.raw.append(b)
 def close(self):pass
 def status(self):return {'diagnostic':True}
class FakeProcess:
 def __init__(self,pid=123,exit=None):self.pid=pid;self.exit=exit
 def poll(self):return self.exit
class Tests(unittest.TestCase):
 def controller(self):return m.Supervisor(manifest(),None,{k:Log()for k in['source','publisher','supervisor']})
 def test_original_identity_and_frozen_mode_are_mandatory(self):
  at=m.INCEPTION+100000;v=status(at);self.assertEqual(m.validate_status(v,manifest(),at-2000,123,at),v)
  for key,value in [('accountId','poe-pilot-TEST_ONLY'),('inceptionAt',m.INCEPTION+1),('authoritative',False),('liveTradingEnabled',True),('persistent',False),('configurationSha256','e'*64)]:
   bad=copy.deepcopy(v);bad[key]=value
   with self.subTest(key=key),self.assertRaises(m.Guard):m.validate_status(bad,manifest(),at-2000,123,at)
 def test_manifest_has_no_duration_or_cumulative_allowance_fields(self):
  v=manifest();self.assertEqual(m.validate_manifest(v),v)
  for key,value in [('durationSeconds',1800),('maximumRequests',1500),('maximumCpuSeconds',180),('secret','SECRET_SENTINEL')]:
   bad=copy.deepcopy(v);bad[key]=value
   with self.assertRaisesRegex(m.Guard,'EXACT_SERVICE_MANIFEST'):m.validate_manifest(bad)
 def test_source_command_preserves_actual_original_ledger_and_service_mode(self):
  args=m.source_args('/opt/poe/node/bin/node',pathlib.Path('/opt/poe/releases')/SOURCE['commit'],manifest());self.assertIn('--service',args);self.assertNotIn('--duration-seconds',args);self.assertEqual(args[args.index('--ledger')+1],'/var/lib/poe/state/ledger.sqlite');self.assertEqual(args[args.index('--directory')+1],'/var/lib/poe/native-engine');self.assertFalse(any('poe-pilot'in v for v in args));self.assertNotIn('init',args)
 def test_original_credential_is_only_attached_to_the_original_publisher_channel(self):
  with patch.dict(m.os.environ,{'CREDENTIALS_DIRECTORY':'/run/credentials/poe-runtime.service'},clear=True):
   args=m.publisher_args('/opt/poe/node/bin/node',pathlib.Path('/opt/poe/releases')/SOURCE['commit'],manifest());self.assertIn('--watch',args);self.assertIn(m.ACCOUNT_ID,args);self.assertIn(m.INCEPTION_ISO,args);self.assertTrue(any('poe-ingest-secret'in v for v in args));self.assertFalse(any('pilot-ingest'in v or'/api/pilot'in v for v in args));once=m.publisher_args('/opt/poe/node/bin/node',pathlib.Path('/opt/poe/releases')/SOURCE['commit'],manifest(),once=True);self.assertIn('--once',once);self.assertNotIn('--watch',once)
  with patch.dict(m.os.environ,{'CREDENTIALS_DIRECTORY':'/home/PRIVATE'},clear=True),self.assertRaisesRegex(m.Guard,'ORIGINAL_SYSTEMD_CREDENTIAL'):m.credential_path()
 def test_spawn_has_no_lifetime_cpu_or_file_budget_and_strips_inherited_credentials(self):
  code='import os,resource,json;print(json.dumps({"keys":sorted(os.environ),"cpu":resource.getrlimit(resource.RLIMIT_CPU),"file":resource.getrlimit(resource.RLIMIT_FSIZE)}))'
  with patch.dict(os.environ,{'SECRET_SENTINEL':'NO_EXPORT','NODE_OPTIONS':'--bad','HOME':'/PRIVATE'},clear=False):p=m.spawn([sys.executable,'-c',code]);raw,_=p.communicate(timeout=5)
  v=json.loads(raw);self.assertTrue(set(v['keys'])<={'LANG','LC_CTYPE','PATH','TZ'});self.assertTrue({'LANG','PATH','TZ'}<=set(v['keys']));self.assertEqual(v['cpu'],list(resource.getrlimit(resource.RLIMIT_CPU)));self.assertEqual(v['file'],list(resource.getrlimit(resource.RLIMIT_FSIZE)));self.assertNotIn(b'SECRET_SENTINEL',raw)
 def test_real_process_group_settles_before_any_replacement(self):
  p=m.spawn([sys.executable,'-c','import time;time.sleep(30)']);self.assertTrue(m.stop_child(p,.1,uid=os.getuid()));self.assertIsNotNone(p.poll());self.assertEqual(m.group_members(p.pid,os.getuid()),[]);self.assertTrue(p.stdout.closed)
 def test_eof_closes_old_pipe_and_selector_registration_before_unbounded_restarts(self):
  c=self.controller();p=m.spawn([sys.executable,'-c','print("done")']);c.register('source',p);p.wait(timeout=5)
  import time
  until=time.monotonic()+2
  while c.selector.get_map()and time.monotonic()<until:c.drain();time.sleep(.01)
  self.assertTrue(p.stdout.closed);self.assertEqual(len(c.selector.get_map()),0);c.selector.close()
 def test_rolling_cpu_rejects_membership_resets_and_does_not_care_about_lifetime_total(self):
  r=m.RollingCpu();self.assertIsNone(r.observe(0,1000000,'a'));self.assertAlmostEqual(r.observe(60,1000012,'a'),.2);self.assertIsNone(r.observe(75,1,'b'));self.assertIsNone(r.observe(90,2,'b'));self.assertAlmostEqual(r.observe(135,13,'b'),.2)
 def test_resource_pressure_closes_risk_but_only_critical_headroom_needs_process_recovery(self):
  views={'source':{'rssBytes':300*m.MIB},'publisher':{'rssBytes':80*m.MIB}};r=m.resource_state(views,6*1024*m.MIB,10*1024*m.MIB,50*m.MIB,.7,.001);self.assertTrue(r['newRiskPressure']);self.assertFalse(r['critical']);self.assertFalse(r['publisherRestart']);r=m.resource_state(views,128*m.MIB,10*1024*m.MIB,50*m.MIB,.1,.001);self.assertTrue(r['critical'])
 def test_current_source_acceptance_and_resource_hysteresis_are_both_required(self):
  at=m.INCEPTION+100000;v=status(at);healthy={'critical':False,'newRiskPressure':False,'healthy':True};a=ack(at);self.assertFalse(m.admission(v,a,healthy,3,at+100)[0]);self.assertTrue(m.admission(v,a,healthy,2,at+100)[0]);self.assertTrue(m.admission(v,ack(v['startedAt']-1),healthy,3,at+100)[0]);self.assertTrue(m.admission(v,a,healthy,3,at+91000)[0]);self.assertTrue(m.admission(v,None,healthy,3,at+100)[0])
 def test_ack_identity_order_and_fingerprint_are_validated_without_secret_output(self):
  at=m.INCEPTION+100000;v=ack(at);self.assertEqual(m.parse_ack(json.dumps(v),at+100,SOURCE['commit']),v)
  for key,value in [('accountId','poe-pilot-TEST_ONLY'),('inceptionAt','2026-10-27T00:00:00Z'),('release','f'*40),('fingerprint','bad'),('rawSourceSha256','bad'),('acknowledgedAtMs',at-1)]:
   bad=copy.deepcopy(v);bad[key]=value;self.assertIsNone(m.parse_ack(json.dumps(bad),at+100,SOURCE['commit']))
 def test_reporting_recovery_only_writes_its_own_marker_and_never_clears_manual_pause(self):
  at=m.INCEPTION+100000;c=self.controller();c.last_source=status(at);c.last_ack=ack(at);c.resource={'critical':False,'newRiskPressure':False,'healthy':True};c.healthy_samples=3
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-authoritative-marker-')as t,patch.object(m,'ACCOUNT',pathlib.Path(t)):
   manual=pathlib.Path(t)/'admission-suspension.request';manual.write_text('MANUAL_SENTINEL');manual.chmod(0o600);c.write_marker(at+100);v=json.loads((pathlib.Path(t)/'service-admission.json').read_text());self.assertFalse(v['suspended']);self.assertEqual(v['accountId'],m.ACCOUNT_ID);self.assertEqual(manual.read_text(),'MANUAL_SENTINEL');c.stopping=True;c.write_marker(at+200);self.assertTrue(json.loads((pathlib.Path(t)/'service-admission.json').read_text())['suspended'])
 def test_matched_actual_source_bytes_are_required_before_publisher_ack_is_trusted(self):
  at=m.INCEPTION+100000;c=self.controller();c.last_source=status(at)
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-source-witness-')as t,patch.object(m,'ACCOUNT',pathlib.Path(t)),patch.object(m,'SERVICE',pathlib.Path(t)):
   raw=(json.dumps(snapshot(at),separators=(',',':'))+'\n').encode();p=pathlib.Path(t)/'snapshot.json';p.write_bytes(raw);p.chmod(0o600);c.pending_acks.append(ack(at,fingerprint='f'*64));c.cache_source_snapshot(at+100);self.assertIsNone(c.last_ack);c.pending_acks.append(ack(at,raw_source_sha256=m.sha(raw)));c.cache_source_snapshot(at+101);self.assertEqual(c.last_ack['rawSourceSha256'],m.sha(raw));self.assertEqual(c.last_ack['fingerprint'],'e'*64);self.assertEqual(c.accepted_source_count,1);self.assertTrue((pathlib.Path(t)/'accepted-source-0.json').exists())
 def test_cross_language_marker_fixture_is_generated_by_the_live_marker_function(self):
  fixture=json.loads(p.with_name('fixture-authoritative-marker.json').read_text());actual=m.marker({'source':SOURCE},{'runId':'native-paper-20261029000000000'},False,'fixture verified current-run reporting and resource headroom',1793318400000);self.assertEqual(actual,fixture)
 def test_unknown_active_process_census_closes_risk_without_forcing_restart(self):
  v={'source':None,'publisher':None};r=m.resource_state(v,6*1024*m.MIB,10*1024*m.MIB,50*m.MIB,None,None);self.assertFalse(r['healthy']);self.assertTrue(r['newRiskPressure']);self.assertFalse(r['critical']);self.assertFalse(r['resourceMeasurementsAvailable'])
  start=m.resource_state(v,6*1024*m.MIB,10*1024*m.MIB,50*m.MIB,None,None,source_expected=False,publisher_expected=False);self.assertTrue(start['healthy']);self.assertTrue(start['resourceMeasurementsAvailable'])
 def test_two_matched_acknowledgments_are_consumed_once_even_across_repeated_reads(self):
  at=m.INCEPTION+100000;c=self.controller()
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-source-witness-')as t,patch.object(m,'ACCOUNT',pathlib.Path(t)),patch.object(m,'SERVICE',pathlib.Path(t)):
   p=pathlib.Path(t)/'snapshot.json'
   for i in range(2):
    c.last_source=status(at+i);raw=(json.dumps(snapshot(at+i,str(i+1)),separators=(',',':'))+'\n').encode();p.write_bytes(raw);p.chmod(0o600);c.pending_acks.append(ack(at+i,str(i+1),fingerprint=str(i)*64,raw_source_sha256=m.sha(raw)));c.cache_source_snapshot(at+100)
   self.assertEqual(c.accepted_source_count,2);self.assertEqual(len(c.pending_acks),0)
   for _ in range(10):c.cache_source_snapshot(at+101)
   self.assertEqual(c.accepted_source_count,2)
 def test_diagnostic_rotation_never_terminates_healthy_work_or_touches_financial_files(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-rotation-')as t:
   d=pathlib.Path(t);financial=d/'ledger.sqlite';financial.write_bytes(b'FINANCIAL_SENTINEL');log=m.RotatingDiagnostic(d,'source',16,2);log.write(b'a'*100);self.assertEqual(log.status()['receivedBytes'],100);self.assertGreater(log.status()['evictedDiagnosticBytes'],0);self.assertLessEqual(sum(p.stat().st_size for p in d.glob('source-*.log')),32);log.close();self.assertEqual(financial.read_bytes(),b'FINANCIAL_SENTINEL')
 def test_empty_diagnostic_file_from_crash_is_recoverable(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-empty-log-')as t:
   p=pathlib.Path(t);log=m.RotatingDiagnostic(p,'publisher',16,2);log.close();log=m.RotatingDiagnostic(p,'publisher',16,2);log.write(b'ok');log.close();self.assertEqual((p/'publisher-0.log').read_bytes(),b'ok')
 def test_long_elapsed_and_high_lifetime_cpu_do_not_create_a_shutdown_decision(self):
  at=m.INCEPTION+100000;c=self.controller();c.source=FakeProcess();c.source_started=at-1000;c.last_source=status(at);c.publisher=FakeProcess(124);c.resource={'critical':False,'newRiskPressure':False,'healthy':True,'publisherRestart':False};c.healthy_samples=3;c.last_sample=1000000;c.started=0;c.drain=lambda:None;c.sample=lambda *_:None;c.write_marker=lambda *_:None;c.cache_source_snapshot=lambda *_:None
  with patch.object(m,'read_file',return_value=json.dumps(c.last_source).encode()),patch.object(m,'atomic'),patch.object(m,'stop_child',side_effect=AssertionError('healthy child must not stop')),patch.object(m,'spawn',side_effect=AssertionError('no duplicate child')):c.step(1000001,at)
  self.assertIsNotNone(c.source);self.assertFalse(c.stopping)
 def test_source_restart_waits_for_settlement_and_keeps_publisher_independent(self):
  at=m.INCEPTION+100000;c=self.controller();c.source=FakeProcess(exit=1);c.publisher=FakeProcess(124);c.source_started=at-1000;c.resource={'critical':False,'newRiskPressure':False,'healthy':True,'publisherRestart':False};c.last_sample=10;c.drain=lambda:None;c.write_marker=lambda *_:None;c.cache_source_snapshot=lambda *_:None
  with patch.object(m,'read_file',return_value=json.dumps(status(at)).encode()),patch.object(m,'atomic'),patch.object(m,'stop_child',return_value=False),patch.object(m,'spawn',side_effect=AssertionError('unsettled writer cannot be replaced')):c.step(11,at)
  self.assertTrue(c.source_group_unsettled);self.assertEqual(c.publisher.pid,124);self.assertIsNotNone(c.source)
 def test_resource_sampling_reads_only_own_process_metadata_and_has_no_wallet_environment(self):
  views=m.resource_process_views(None,None);self.assertIsNone(views['source']);self.assertIn('rssBytes',views['supervisor']);self.assertNotIn('environ',str(views));self.assertNotIn('cmdline',str(views))
if __name__=='__main__':unittest.main()
