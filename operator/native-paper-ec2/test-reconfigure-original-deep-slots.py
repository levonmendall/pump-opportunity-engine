#!/usr/bin/env python3
"""Offline disposable fixtures for the precise same-source six-to-four handoff."""
import contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,subprocess,sys,tempfile,types,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('config_four',HERE/'reconfigure-original-deep-slots.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def git_bytes(path,commit):return subprocess.run(['git','show',commit+':'+path],cwd=HERE,capture_output=True,check=True).stdout
base_bytes=git_bytes('operator/native-paper-ec2/forward-original-upgrade.py','3334070');f=c.load_frozen(base_bytes)
legacy_raw=git_bytes('operator/native-paper-ec2/run-authoritative-service.py','cd43ecf');assert c.sha(legacy_raw)==f.INDEXED_SUPERVISOR
legacy=types.ModuleType('config_legacy_supervisor');legacy.__file__=str(HERE/'legacy-supervisor.py');exec(compile(legacy_raw,legacy.__file__,'exec'),legacy.__dict__)
# Reuse the already reviewed disposable WAL/account fixture and actual 2b core.
fixture_raw=git_bytes('operator/native-paper-ec2/test-forward-original-upgrade.py','3334070').decode();fixture_raw=fixture_raw.replace('def module(name,file):\n','def module(name,file):\n if name=="forward_test_driver":return PRELOADED_DRIVER\n if name=="forward_test_supervisor":return PRELOADED_SUPERVISOR\n')
fx=types.ModuleType('config_fixture');fx.__file__=str(HERE/'frozen-test-forward-original-upgrade.py');fx.PRELOADED_DRIVER=f;fx.PRELOADED_SUPERVISOR=legacy;exec(compile(fixture_raw,fx.__file__,'exec'),fx.__dict__);m,a=fx.m,fx.a
class Tests(unittest.TestCase):
 @contextlib.contextmanager
 def prepared(self,exposure=False):
  with fx.Tests().prepared(exposure=exposure)as v:
   (v.root/'unit.d/90-native-engine.conf').chmod(0o644);before=json.loads(v.old_raw);before['configurationSha256']=c.SIX;before_raw=(json.dumps(before,indent=2)+'\n').encode();v.manifest.write_bytes(before_raw);after=copy.deepcopy(before);after.update(deepSlots=4,configurationSha256=c.FOUR);target=(json.dumps(after,indent=2)+'\n').encode();v.old_raw=before_raw;v.target_bytes=target;v.before=before;v.after=after;v.cfg_dir=m.RECORDS/('configuration-four-'+c.SOURCE['commit']);v.self_bytes=b'REVIEWED_CONFIG_HELPER';v.self_sha=c.sha(v.self_bytes)
   runtime={'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'runId':'native-paper-20261029000000001','runtimePid':321,'generatedAt':c.now()+2000,'configurationSha256':c.FOUR,'entriesEnabled':False,'maximumCandidates':4,'activeCandidates':0}
   with patch.multiple(c,BEFORE=c.sha(before_raw),AFTER=c.sha(target),FROZEN=v.root/'config-frozen',SUPERVISOR_SHA=f.OLD_SUPERVISOR),patch.object(c,'wait_four',return_value=runtime):yield v
 def apply(self,v):return c.apply(f,m,a,v.supervisor,v.self_sha,v.self_bytes,v.target_bytes)
 def test_real_target_has_exactly_two_changes_and_unchanged_source(self):
  p=HERE.parent.parent/'evidence/issue11-consolidation-20261028/four-slot-configuration-20261029/package/service.json';raw=p.read_bytes();target=c.validate_target(raw);old=json.loads((HERE.parent.parent/'evidence/issue11-consolidation-20261028/coherent-entry-repair-20261029/upgrade-package/service.json').read_bytes());self.assertEqual([k for k in old if old[k]!=target[k]],['configurationSha256','deepSlots']);self.assertEqual(c.SOURCE,target['source']);self.assertEqual(c.sha(base_bytes),c.BASE_SHA)
 def test_same_source_ledger_input_unit_positions_and_pending_preserved(self):
  with self.prepared(exposure=True)as v:
   unit=(v.root/'unit.d/90-native-engine.conf').read_bytes();result=self.apply(v);self.assertEqual(v.manifest.read_bytes(),v.target_bytes);self.assertEqual(v.current.resolve(),v.old);self.assertEqual((v.account/'input.json').read_bytes(),v.before_input);self.assertEqual((v.root/'unit.d/90-native-engine.conf').read_bytes(),unit);self.assertEqual((v.ledger.stat().st_dev,v.ledger.stat().st_ino),v.inode);self.assertEqual(v.events,[('stop','poe-runtime.service'),('start','poe-runtime.service')]);record=json.loads((v.cfg_dir/'transition.json').read_bytes());self.assertTrue(record['nativeGracefulStop']['settlement']['physicalSettlementConfirmed']);self.assertTrue(record['postStartFinancial']['journalAndActionPrefixPreserved']);self.assertEqual(record['postStartFinancial']['financial']['openPositions'],1);self.assertEqual(record['postStartFinancial']['financial']['pendingActions'],1);self.assertEqual(result['deepSlots'],4);self.assertFalse(result['backupRestored']);self.assertFalse(result['operationalAcceptance'])
 def test_immutable_six_manifest_or_unknown_source_refuses_before_stop(self):
  with self.prepared()as v:
   value=json.loads(v.manifest.read_bytes());value['deepSlots']=5;v.manifest.write_bytes((json.dumps(value,indent=2)+'\n').encode())
   with self.assertRaisesRegex(c.Refused,'ORIGINAL_SIX_SLOT_SERVICE_MUST_BE_RUNNING'):self.apply(v)
   self.assertEqual(v.events,[])
 def test_failed_stop_resumes_unchanged_manager_without_four_intent(self):
  with self.prepared()as v:
   def control(*args):
    v.events.append(args)
    if args[0]=='stop':raise m.Refused('INJECTED_STOP_FAILURE')
   with patch.object(m,'systemctl',side_effect=control),self.assertRaisesRegex(m.Refused,'INJECTED_STOP_FAILURE'):self.apply(v)
   self.assertEqual(v.manifest.read_bytes(),v.old_raw);self.assertEqual(v.events,[('stop','poe-runtime.service'),('start','poe-runtime.service')]);self.assertFalse(json.loads((v.cfg_dir/'transition.json').read_bytes()).get('fourMutationPossible'))
 def test_physical_or_native_settlement_failure_never_mutates_manifest(self):
  with self.prepared(exposure=True)as v,patch.object(m,'observe_stopped_writer',return_value={'physicalWriterSettled':False}):
   with self.assertRaisesRegex(c.Refused,'GRACEFUL_PHYSICALLY_SETTLED'):self.apply(v)
   self.assertEqual(v.manifest.read_bytes(),v.old_raw);self.assertEqual(v.current.resolve(),v.old)
 def test_manifest_write_interruption_recovers_forward_only_to_four(self):
  with self.prepared(exposure=True)as v:
   atomic=m.atomic;failed={'once':False}
   def write(path,raw,*args,**kwargs):
    if path==v.manifest and raw==v.target_bytes and not failed['once']:failed['once']=True;raise OSError('INJECTED_CONFIG_WRITE_FAILURE')
    return atomic(path,raw,*args,**kwargs)
   with patch.object(m,'atomic',side_effect=write),self.assertRaises(OSError):self.apply(v)
   self.assertEqual(v.manifest.read_bytes(),v.target_bytes);record=json.loads((v.cfg_dir/'transition.json').read_bytes());self.assertTrue(record['fourMutationPossible']);self.assertTrue(record['startRequestedAt']);v.events.clear();self.apply(v);self.assertEqual(v.events,[('start','poe-runtime.service')]);self.assertEqual(v.manifest.read_bytes(),v.target_bytes)
 def test_start_timeout_retains_four_and_resumes_without_another_stop(self):
  with self.prepared(exposure=True)as v:
   def control(*args):
    v.events.append(args)
    if args[0]=='start':raise m.Refused('INJECTED_UNCERTAIN_START')
   with patch.object(m,'systemctl',side_effect=control),self.assertRaisesRegex(m.Refused,'INJECTED_UNCERTAIN_START'):self.apply(v)
   self.assertEqual(v.manifest.read_bytes(),v.target_bytes);record=json.loads((v.cfg_dir/'transition.json').read_bytes());self.assertTrue(record['startRequestedAt']);v.events.clear();self.apply(v);self.assertEqual(v.events,[('start','poe-runtime.service')]);self.assertEqual(v.manifest.read_bytes(),v.target_bytes)
 def test_interrupted_backup_allocates_next_attempt_and_retains_orphan(self):
  with self.prepared()as v:
   real=m.snapshot_backup;failed={'once':False}
   def backup(path,*args,**kwargs):
    if not failed['once']:failed['once']=True;path.write_bytes(b'PRESERVE_BACKUP_ORPHAN');raise OSError('INJECTED_BACKUP_FAILURE')
    return real(path,*args,**kwargs)
   with patch.object(m,'snapshot_backup',side_effect=backup),self.assertRaises(OSError):self.apply(v)
   self.assertEqual(v.events,[]);record=json.loads((v.cfg_dir/'transition.json').read_bytes());self.assertEqual(record['attempt'],1);self.apply(v);self.assertEqual(json.loads((v.cfg_dir/'transition.json').read_bytes())['attempt'],2);orphan=v.backups/(v.cfg_dir.name+'-01-live/ledger.sqlite');self.assertEqual(orphan.read_bytes(),b'PRESERVE_BACKUP_ORPHAN')
 def test_mkdir_interruption_consumes_attempt_before_creating_directories(self):
  with self.prepared()as v:
   make=m.make_dir;failed={'once':False}
   def mkdir(path,*args,**kwargs):
    if path.name==v.cfg_dir.name+'-01-live'and not failed['once']:failed['once']=True;raise OSError('INJECTED_MKDIR_INTERRUPTION')
    return make(path,*args,**kwargs)
   with patch.object(m,'make_dir',side_effect=mkdir),self.assertRaises(OSError):self.apply(v)
   record=json.loads((v.cfg_dir/'transition.json').read_bytes());self.assertEqual(record['attempt'],1);self.assertEqual(v.events,[]);orphan=v.backups/(v.cfg_dir.name+'-01');self.assertTrue(orphan.is_dir());self.apply(v);self.assertEqual(json.loads((v.cfg_dir/'transition.json').read_bytes())['attempt'],2);self.assertTrue(orphan.is_dir())
 def wait_status(self):
  at=c.now();return {'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'source':c.SOURCE,'configurationSha256':c.FOUR,'running':True,'persistent':True,'authoritative':True,'experimental':False,'liveTradingEnabled':False,'startedAt':at-100,'generatedAt':at,'runtimePid':222,'runId':'native-paper-20261029000000002','entriesEnabled':False,'watch':{'maximumDeep':4},'usage':{'native':{'maximumCandidates':4,'candidates':4},'feeds':{'maximumCandidates':4}}}
 def test_wait_four_accepts_real_four_shape_and_requires_actual_process_witness(self):
  status=self.wait_status();record={'verificationNotBefore':status['generatedAt']-1000,'stopRequestedAt':status['generatedAt']-2000}
  with patch.object(f,'read',return_value=c.encoded(status)),patch.object(c,'runtime_process_proof',return_value={'inOriginalUnitCgroup':True})as proof:
   result=c.wait_four(f,m,record,maximum=0);self.assertEqual(result['maximumCandidates'],4);self.assertEqual(result['watchMaximumDeep'],4);self.assertEqual(result['feedMaximumCandidates'],4);proof.assert_called_once()
 def test_wait_four_rejects_malformed_watch_feed_stale_or_old_runtime(self):
  base=self.wait_status();record={'verificationNotBefore':base['generatedAt']-1000,'stopRequestedAt':base['generatedAt']-2000}
  variants=[]
  for group in['watch','feeds']:
   status=copy.deepcopy(base)
   if group=='watch':status['watch']['maximumDeep']=6
   else:status['usage']['feeds']['maximumCandidates']=6
   variants.append(status)
  stale=copy.deepcopy(base);stale['generatedAt']=record['verificationNotBefore']-1;variants.append(stale);old=copy.deepcopy(base);old['startedAt']=record['stopRequestedAt']-1;variants.append(old)
  for status in variants:
   with self.subTest(status=status),patch.object(f,'read',return_value=c.encoded(status)),patch.object(c,'runtime_process_proof',side_effect=AssertionError('malformed status is not a process witness')),self.assertRaisesRegex(c.Refused,'FOUR_SLOT_FINANCIAL_MANAGER_RETAINED'):c.wait_four(f,m,record,maximum=0)
  with patch.object(f,'read',return_value=c.encoded(base)),patch.object(c,'runtime_process_proof',side_effect=c.Refused('NEW_FOUR_SLOT_RUNTIME_PID_REQUIRED')),self.assertRaisesRegex(c.Refused,'FOUR_SLOT_FINANCIAL_MANAGER_RETAINED'):c.wait_four(f,m,record,maximum=0)
 def test_real_runtime_process_witness_checks_cgroup_binary_and_previous_pid(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-four-process-')as directory:
   group=pathlib.Path(directory)/'cgroup.procs';group.write_text(str(os.getpid())+'\n');status={'runtimePid':os.getpid()};record={'runtimeBefore':{'status':{'runtimePid':os.getpid()+1}}};real=pathlib.Path.read_bytes;expected=str(m.RELEASES/c.SOURCE['commit']/'native-paper.mjs').encode()
   def read(path):return b'/opt/poe/node/bin/node\0'+expected+b'\0'if path==pathlib.Path('/proc')/str(os.getpid())/'cmdline'else real(path)
   with patch.object(m,'SERVICE_CGROUP',group),patch.object(c,'UID',os.getuid()),patch.object(pathlib.Path,'read_bytes',read):
    proof=c.runtime_process_proof(m,status,record);self.assertTrue(proof['inOriginalUnitCgroup']);self.assertTrue(proof['differentRuntimePidVerified']);record['runtimeBefore']['status']['runtimePid']=os.getpid()
    with self.assertRaisesRegex(c.Refused,'NEW_FOUR_SLOT_RUNTIME_PID_REQUIRED'):c.runtime_process_proof(m,status,record)
    record['runtimeBefore']['status']['runtimePid']=os.getpid()+1;group.write_text('')
    with self.assertRaisesRegex(c.Refused,'FOUR_SLOT_RUNTIME_CGROUP_MEMBERSHIP_REQUIRED'):c.runtime_process_proof(m,status,record)
 def test_post_start_verification_failure_keeps_four_manager_and_all_financial_state(self):
  with self.prepared(exposure=True)as v,patch.object(c,'wait_four',side_effect=c.Refused('FOUR_SLOT_FINANCIAL_MANAGER_RETAINED_VERIFICATION_INCOMPLETE')):
   with self.assertRaisesRegex(c.Refused,'FOUR_SLOT_FINANCIAL_MANAGER_RETAINED'):self.apply(v)
   self.assertEqual(v.manifest.read_bytes(),v.target_bytes);self.assertEqual(v.current.resolve(),v.old);self.assertEqual(v.events,[('stop','poe-runtime.service'),('start','poe-runtime.service')]);self.assertTrue(json.loads((v.cfg_dir/'transition.json').read_bytes())['fourMutationPossible']);self.assertEqual((v.ledger.stat().st_dev,v.ledger.stat().st_ino),v.inode)
 def test_frozen_driver_tampering_is_rejected(self):
  with self.assertRaisesRegex(c.Refused,'REVIEWED_FROZEN_7E_DRIVER_REQUIRED'):c.load_frozen(base_bytes+b'\n')
 def test_nonroot_apply_refuses_before_private_reads(self):
  with patch.object(c.os,'getuid',return_value=994),patch.object(c.sys,'argv',['config.py','apply']),patch.object(c,'read',side_effect=AssertionError('private paths not opened')),self.assertRaisesRegex(c.Refused,'EXPLICIT_ROOT_CONFIG_APPLY_REQUIRED'):c.main()
if __name__=='__main__':unittest.main()
