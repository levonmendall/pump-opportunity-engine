#!/usr/bin/env python3
"""Isolated configuration-repair fixtures. Never contacts systemd, RPC or a real ledger."""
import contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,subprocess,tempfile,types,unittest
from unittest.mock import patch
path=pathlib.Path(__file__).with_name('repair-original-entrypoint-order.py')
spec=importlib.util.spec_from_file_location('repair_order',path);r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
UID=os.getuid()
class Tests(unittest.TestCase):
 @contextlib.contextmanager
 def fixture(self,lower=False,cached=False,settled=True,wrong_merged=False,reload_failure=False,complete=True,stopped_native=False):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-entrypoint-order-')as tmp:
   base=pathlib.Path(tmp);unitdir=base/'unit.d';unitdir.mkdir(mode=0o755);unitdir.chmod(0o755);legacy=unitdir/'entrypoint.conf';renamed=unitdir/'00-legacy-entrypoint.conf';(renamed if lower else legacy).write_bytes(r.LEGACY_BYTES);(renamed if lower else legacy).chmod(0o644);native=path.with_name('poe-runtime-persistent.conf').read_bytes();(unitdir/'90-native-engine.conf').write_bytes(native);(unitdir/'90-native-engine.conf').chmod(0o644);(unitdir/'reporting.conf').write_bytes(b'[Service]\nLoadCredential=poe-ingest-secret:/etc/poe/secrets/ingest-secret\n');(unitdir/'reporting.conf').chmod(0o644)
   releases=base/'releases';target=releases/r.SOURCE['commit'];op=target/'operator/native-paper-ec2';op.mkdir(parents=True);(op/'run-authoritative-service.py').write_bytes(b'CONTROLLED_SUPERVISOR');current=base/'current';current.symlink_to(target);manifest={'source':r.SOURCE};manifest_raw=json.dumps(manifest).encode();manifest_path=base/'manifest.json';manifest_path.write_bytes(manifest_raw);ledger=base/'TEST_ONLY-ledger';ledger.write_bytes(b'CONTROLLED_NOT_SQLITE');records=base/'records';parent=records/r.SOURCE['commit'];parent.mkdir(parents=True);prior={'accountId':'poe-3123e352-4581-455b-85db-acd7e825e99e','inceptionAt':1793052456212,'source':r.SOURCE,'packageIndexSha256':r.INDEX_SHA,'stoppedFinancial':{'fixture':True},'backup':{'fixture':True},'startRequestedAt':1,'inputTransition':{'installedInputSha256':'e'*64}};(parent/'transition.json').write_text(json.dumps(prior));events=[];proofs=[];public=[];lease=[None];state={'native':lower and not cached,'reloads':0}
   old_names=['90-native-engine.conf','entrypoint.conf','reporting.conf'];new_names=['00-legacy-entrypoint.conf','90-native-engine.conf','reporting.conf']
   def merged():return {'MainPID':'0'if stopped_native else'42','ControlPID':'0','ActiveState':'inactive'if stopped_native else'active','SubState':'dead'if stopped_native else'running','User':'poe-runtime','Group':'poe-runtime','LoadState':'loaded','nativeExecStart':state['native']and not wrong_merged,'legacyExecStart':not state['native'],'execStopEmpty':state['native']and not wrong_merged,'dropInBasenames':new_names if state['native']else old_names}
   def systemctl(*args):
    events.append(':'.join(args))
    if args==('daemon-reload',):
     state['reloads']+=1
     if reload_failure:raise RuntimeError('CONTROLLED_DAEMON_RELOAD_FAILED')
     state['native']=True
    if args==('start','poe-runtime.service')and lease[0]is not None:
     with self.assertRaises(OSError):os.fstat(lease[0])
   def acquire():
    events.append('lease');lease[0]=os.open(base/'TEST_ONLY-owner.lock',os.O_RDWR|os.O_CREAT,0o600);return lease[0]
   def stopped():events.append('physical-proof');os.fstat(lease[0]);return {'physicalWriterSettled':settled}
   def audit(auditor,inode=None):
    events.append('audit');self.assertEqual(inode,(ledger.stat().st_dev,ledger.stat().st_ino));return {'fixture':True}
   def prefix(*args):events.append('prefix');return {'journalAndActionPrefixPreserved':True}
   def write_json(p,v):p.write_text(json.dumps(v));events.append('record:'+v['phase'])
   def atomic(p,b,*args):p.write_bytes(b);p.chmod(0o600)
   m=types.SimpleNamespace(validate_host=lambda *args:(UID,os.getgid(),{}),package=lambda *args:({},manifest,{'service.json':manifest_raw,'run-authoritative-service.py':b'CONTROLLED_SUPERVISOR','poe-runtime-persistent.conf':native}),CURRENT=current,RELEASES=releases,MANIFEST=manifest_path,LEDGER=ledger,RECORDS=records,ACCOUNT_ID=prior['accountId'],INCEPTION=prior['inceptionAt'],directory=lambda p,*args:None,original_audit=audit,verify_live_financial_prefix=prefix,make_dir=lambda p,*args:p.mkdir(mode=0o700,parents=True),write_json=write_json,atomic=atomic,systemctl=systemctl,lease=acquire,observe_stopped_writer=stopped,syncdir=lambda p:events.append('fsync'),post_start_verification=lambda *args:({'complete':complete,'operationalAcceptance':False,'errors':[]if complete else['CONTROLLED_UNAVAILABLE']},{'fixture':True}))
   supervisor=types.SimpleNamespace(release_verified=lambda v:True);original_read=r.read
   def local_read(p,maximum,uid,mode=None):return original_read(p,maximum,UID,mode)
   with patch.multiple(r,UNITDIR=unitdir,LEGACY=legacy,LOWER=renamed,ACTIVE_CONTEXT=None),patch.object(r,'read',side_effect=local_read),patch.object(r,'merged_unit',side_effect=merged),patch.object(r,'startup_clues',return_value={'fixture':True}),patch.object(r,'publish_receipt',side_effect=lambda m,v,uid:public.append(copy.deepcopy(v))):
    yield types.SimpleNamespace(base=base,legacy=legacy,lower=renamed,unitdir=unitdir,m=m,supervisor=supervisor,events=events,public=public,state=state,lease=lease)
 def test_exact_legacy_documented_body_and_native_reset(self):
  self.assertEqual(len(r.LEGACY_BYTES),250);self.assertEqual(hashlib.sha256(r.LEGACY_BYTES).hexdigest(),r.LEGACY_SHA)
  native=path.with_name('poe-runtime-persistent.conf').read_text();self.assertIn('ExecStart=/usr/bin/python3 -B -I',native);self.assertIn('\nExecStop=\n',native);self.assertLess('00-legacy-entrypoint.conf','90-native-engine.conf');self.assertLess('90-native-engine.conf','entrypoint.conf')
 def test_actual_systemd_argv_shape_and_extra_commands(self):
  value='{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 -B -I /opt/poe/current/operator/native-paper-ec2/run-authoritative-service.py ; ignore_errors=no ; }'
  self.assertEqual(r.exec_argv(value),r.NATIVE_ARGV);self.assertIsNone(r.exec_argv(value+value));self.assertIsNone(r.exec_argv(''))
 def test_full_rename_preserves_bytes_inode_and_releases_owner_before_start(self):
  with self.fixture()as f:
   prior=f.legacy.stat();result=r.repair(f.m,None,f.supervisor,'a'*64);after=f.lower.stat();self.assertEqual((prior.st_ino,prior.st_uid,prior.st_gid,prior.st_mode),(after.st_ino,after.st_uid,after.st_gid,after.st_mode));self.assertEqual(f.lower.read_bytes(),r.LEGACY_BYTES);self.assertFalse(f.legacy.exists());self.assertTrue(result['complete']);self.assertEqual(f.events.count('start:poe-runtime.service'),1)
   for earlier,later in [('stop:poe-runtime.service','lease'),('lease','physical-proof'),('physical-proof','daemon-reload'),('daemon-reload','start:poe-runtime.service')]:self.assertLess(f.events.index(earlier),f.events.index(later))
   self.assertEqual(f.events.count('prefix'),2);self.assertEqual(f.events.count('audit'),2);self.assertEqual(f.public[-1]['verification']['complete'],True)
 def test_failed_physical_settlement_keeps_legacy_and_does_not_start(self):
  with self.fixture(settled=False)as f:
   with self.assertRaisesRegex(r.Guard,'ORIGINAL_WRITER_MUST_BE_SETTLED'):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertTrue(f.legacy.exists());self.assertFalse(f.lower.exists());self.assertNotIn('start:poe-runtime.service',f.events)
 def test_wrong_merged_launch_never_starts_observer(self):
  with self.fixture(wrong_merged=True)as f:
   with self.assertRaisesRegex(r.Guard,'EXACT_NATIVE_ENTRYPOINT'):r.repair(f.m,None,f.supervisor,'a'*64)
   result=r.record_failure(r.Guard('CONTROLLED_MERGED_FAILURE'));self.assertFalse(result['sameNativeSourceRecoveryStartRequested']);self.assertFalse(result['observerReverted']);self.assertNotIn('start:poe-runtime.service',f.events);self.assertEqual(result['inceptionAt'],'2026-10-26T22:07:36.212Z')
 def test_already_renamed_current_native_does_not_restart(self):
  with self.fixture(lower=True)as f:
   self.assertTrue(r.repair(f.m,None,f.supervisor,'a'*64)['complete']);self.assertFalse(any(x.startswith('stop:')or x.startswith('start:')for x in f.events))
 def test_rename_completed_cached_legacy_reloads_after_settlement(self):
  with self.fixture(lower=True,cached=True)as f:
   prior=f.lower.stat().st_ino;self.assertTrue(r.repair(f.m,None,f.supervisor,'a'*64)['complete']);self.assertEqual(f.lower.stat().st_ino,prior);self.assertEqual(f.state['reloads'],1);self.assertIn('physical-proof',f.events);self.assertIn('start:poe-runtime.service',f.events)
 def test_reload_failure_retains_rename_and_never_starts_wrong_command(self):
  with self.fixture(reload_failure=True)as f:
   with self.assertRaisesRegex(RuntimeError,'CONTROLLED_DAEMON_RELOAD_FAILED'):r.repair(f.m,None,f.supervisor,'a'*64)
   result=r.record_failure(r.Guard('CONTROLLED_RELOAD_FAILURE'));self.assertTrue(f.lower.exists());self.assertFalse(result['sameNativeSourceRecoveryStartRequested']);self.assertNotIn('start:poe-runtime.service',f.events)
 def test_incomplete_postcheck_retains_current_native_and_public_diagnostics(self):
  with self.fixture(complete=False)as f:
   with self.assertRaisesRegex(r.Guard,'NATIVE_SOURCE_POST_START_NOT_VERIFIED'):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertEqual(f.events.count('start:poe-runtime.service'),1);self.assertFalse(f.public[-1]['complete']);self.assertFalse(f.public[-1]['backupRestored']);self.assertFalse(f.public[-1]['operationalAcceptance'])
 def test_mutated_legacy_refused_before_stop(self):
  with self.fixture()as f:
   f.legacy.write_bytes(r.LEGACY_BYTES+b'# altered\n')
   with self.assertRaisesRegex(r.Guard,'EXACT_LEGACY_ENTRYPOINT'):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertNotIn('stop:poe-runtime.service',f.events)
 def test_reporting_exec_override_refused_without_exporting_values(self):
  with self.fixture()as f:
   (f.unitdir/'reporting.conf').write_text('[Service]\nLoadCredential=PRIVATE_SENTINEL\nExecStart=/bin/false\n')
   with self.assertRaisesRegex(r.Guard,'REPORTING_DROPIN_MUST_NOT_OVERRIDE'):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertNotIn('stop:poe-runtime.service',f.events)
 def test_ledger_inode_replacement_before_stopped_audit_refused(self):
  with self.fixture()as f:
   original=f.m.observe_stopped_writer
   def changed():
    replacement=f.m.LEDGER.with_name('TEST_ONLY-replacement');replacement.write_bytes(b'OTHER');os.replace(replacement,f.m.LEDGER);return original()
   f.m.observe_stopped_writer=changed
   with self.assertRaises(AssertionError):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertTrue(f.legacy.exists());self.assertNotIn('start:poe-runtime.service',f.events)
 def test_unverified_repair_hash_refused_before_host_work(self):
  with self.fixture()as f:
   with self.assertRaisesRegex(r.Guard,'VERIFIED_REPAIR_DRIVER_SHA_REQUIRED'):r.repair(f.m,None,f.supervisor,None)
   self.assertEqual(f.events,[])
 def test_real_merged_parser_accepts_only_canonical_paths_in_cached_rename_seam(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-merged-unit-')as tmp:
   d=pathlib.Path(tmp);(d/'00-legacy-entrypoint.conf').write_bytes(r.LEGACY_BYTES)
   fields={k:'0'for k in['LoadState','User','Group','ActiveState','SubState','MainPID','ControlPID','NRestarts','Result','ExecMainCode','ExecMainStatus','ExecStart','ExecStop','DropInPaths']};fields.update(LoadState='loaded',User='poe-runtime',Group='poe-runtime',ExecStart='{ path=/opt/poe/node/bin/node ; argv[]='+' '.join(r.OLD_ARGV)+' ; }',ExecStop='',DropInPaths=str(d/'entrypoint.conf'))
   def result():return types.SimpleNamespace(returncode=0,stdout='\n'.join(k+'='+v for k,v in fields.items()),stderr='')
   def dispatch(args,**kwargs):return types.SimpleNamespace(returncode=0,stdout=json.dumps({'type':'a(sasbttttuii)','data':[]})+'\n',stderr='')if args[0]=='/usr/bin/busctl'else result()
   with patch.object(r,'UNITDIR',d),patch.object(r.subprocess,'run',side_effect=dispatch):
    self.assertTrue(r.merged_unit()['legacyExecStart'])
    del fields['ExecStop'];self.assertTrue(r.merged_unit()['emptyExecStopProof']['entries']==0)
    del fields['User']
    with self.assertRaisesRegex(r.Guard,'COMPLETE_MERGED_UNIT_METADATA_REQUIRED'):r.merged_unit()
    fields['User']='poe-runtime'
    fields['DropInPaths']=str(d/'reporting.conf')
    with self.assertRaisesRegex(r.Guard,'EXACT_CANONICAL_DROPIN_PATHS'):r.merged_unit()
    fields['DropInPaths']=str(d/'nested/entrypoint.conf')
    with self.assertRaisesRegex(r.Guard,'EXACT_CANONICAL_DROPIN_PATHS'):r.merged_unit()
    link=d/'symlink.conf';link.symlink_to(d/'00-legacy-entrypoint.conf');fields['DropInPaths']=str(link)
    with self.assertRaisesRegex(r.Guard,'EXACT_CANONICAL_DROPIN_PATHS'):r.merged_unit()
 def test_mutated_native_dropin_refused_before_stop(self):
  with self.fixture()as f:
   (f.unitdir/'90-native-engine.conf').write_bytes(b'[Service]\nExecStart=/bin/false\n')
   with self.assertRaisesRegex(r.Guard,'UNCHANGED_NATIVE_DROPIN_REQUIRED'):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertNotIn('stop:poe-runtime.service',f.events)
 def test_duplicate_legacy_files_refused_before_stop(self):
  with self.fixture()as f:
   f.lower.write_bytes(r.LEGACY_BYTES);f.lower.chmod(0o644)
   with self.assertRaisesRegex(r.Guard,'ONE_EXACT_LEGACY_DROPIN_REQUIRED'):r.repair(f.m,None,f.supervisor,'a'*64)
   self.assertNotIn('stop:poe-runtime.service',f.events)
 def test_typed_empty_command_array_proof_and_rejection_shapes(self):
  good=json.dumps({'type':'a(sasbttttuii)','data':[]})+'\n'
  with patch.object(r.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=good,stderr=''))as call:
   self.assertEqual(r.verified_empty_exec_stop()['entries'],0);self.assertIn('/org/freedesktop/systemd1/unit/poe_2druntime_2eservice',call.call_args.args[0]);self.assertEqual(call.call_args.args[0][-1],'ExecStop')
  for body,code in [(json.dumps({'type':'a(sasbttttuii)','data':[['COMMAND']]}),0),(json.dumps({'type':'s','data':[]}),0),('{bad',0),(good,1),(good+' '*8192,0)]:
   with self.subTest(body=body[:20],exit=code),patch.object(r.subprocess,'run',return_value=types.SimpleNamespace(returncode=code,stdout=body,stderr='')):
    with self.assertRaises(r.Guard):r.verified_empty_exec_stop()
  with patch.object(r.subprocess,'run',side_effect=subprocess.TimeoutExpired('busctl',5)):
   with self.assertRaisesRegex(r.Guard,'TYPED_EXEC_STOP_UNAVAILABLE'):r.verified_empty_exec_stop()
 def test_renamed_native_stopped_service_obtains_lease_and_starts_once(self):
  with self.fixture(lower=True,stopped_native=True)as f:
   inode=f.lower.stat().st_ino;self.assertTrue(r.repair(f.m,None,f.supervisor,'a'*64)['complete']);self.assertEqual(f.lower.stat().st_ino,inode);self.assertEqual(f.events.count('start:poe-runtime.service'),1);self.assertIn('physical-proof',f.events);self.assertLess(f.events.index('lease'),f.events.index('start:poe-runtime.service'))
 def test_private_file_reader_rejects_links(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-link-')as tmp:
   p=pathlib.Path(tmp)/'file';p.write_bytes(b'body');p.chmod(0o600);link=p.with_name('link');link.symlink_to(p)
   with self.assertRaises(OSError):r.read(link,100,UID,0o600)
 def test_recovery_never_uses_old_observer(self):
  with self.fixture()as f:
   r.repair(f.m,None,f.supervisor,'a'*64);record=r.ACTIVE_CONTEXT[2];record.pop('repairStartRequestedAt');record['stopProof']={'physicalWriterSettled':True};record['financialOwnerLeaseReleased']=True
   result=r.record_failure(r.Guard('CONTROLLED_POST_RELOAD_FAILURE'));self.assertTrue(result['sameNativeSourceRecoveryStartRequested']);self.assertFalse(result['observerReverted']);self.assertTrue(all('rollback'not in e for e in f.events))
if __name__=='__main__':unittest.main()
