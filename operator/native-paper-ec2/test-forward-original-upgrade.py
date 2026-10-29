#!/usr/bin/env python3
"""Offline disposable-account tests; never reaches host systemd or providers."""
import contextlib,copy,importlib.util,io,json,os,pathlib,sqlite3,subprocess,tempfile,types,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
def pinned_core():
 path=pathlib.Path('/tmp/poe-original-service-package-20261029/cutover-original-service.py')
 raw=path.read_bytes()if path.exists()else subprocess.run(['git','show','cd43ecf:operator/native-paper-ec2/cutover-original-service.py'],cwd=HERE,capture_output=True,check=True).stdout
 assert f.sha(raw)==f.CORE_SHA,'Tests require the actual indexed 2b1 core, never the current checkout'
 value=types.ModuleType('forward_test_pinned_core');value.__file__=str(path);exec(compile(raw,str(path),'exec'),value.__dict__);f.attach_stop_observer(value);return value
def pinned_old_supervisor():
 raw=subprocess.run(['git','show','cd43ecf:operator/native-paper-ec2/run-authoritative-service.py'],cwd=HERE,capture_output=True,check=True).stdout;assert f.sha(raw)==f.INDEXED_SUPERVISOR,'Tests require the original d90 policy validator';value=types.ModuleType('forward_test_legacy_supervisor');value.__file__=str(HERE/'indexed-v1-supervisor.py');exec(compile(raw,value.__file__,'exec'),value.__dict__);return value
f=module('forward_test_driver','forward-original-upgrade.py');m=pinned_core();a=module('forward_test_auditor','audit-original-account.py');s=module('forward_test_supervisor','run-authoritative-service.py');fixture=module('forward_test_fixture','test-audit-original-account.py');legacy=pinned_old_supervisor()
class Tests(unittest.TestCase):
 @contextlib.contextmanager
 def prepared(self,exposure=False,rows=3):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-forward-')as directory:
   test_uid=os.getuid();test_gid=os.getgid();root=pathlib.Path(directory);home=root/'state-root';home.mkdir(mode=0o700);(home/'state').mkdir(mode=0o700);account=home/'native-engine';account.mkdir(mode=0o700);service=home/'service';service.mkdir(mode=0o700);ledger=home/'state/ledger.sqlite';writer,state=fixture.Tests().fixture(ledger);writer.execute('PRAGMA journal_mode=WAL');writer.executescript('ALTER TABLE actions ADD COLUMN payload_hash TEXT;ALTER TABLE actions ADD COLUMN result TEXT;ALTER TABLE journal ADD COLUMN detail TEXT;');state['revision']=rows
   if exposure:state.update(positions={'KEEP_POSITION':{'lamports':'123','protection':'KEEP_PROTECTION'}},pending={'KEEP_PENDING':{'reserved':'456'}},lockedDeposits={'KEEP_POSITION':'789'})
   writer.execute('UPDATE financial_state SET body=?',(json.dumps(state),));writer.executemany('INSERT INTO actions VALUES(?,?,?)',[(str(n),'OLD_HASH_'+str(n),'OLD_RESULT_'+str(n))for n in range(1,rows+1)]);writer.executemany('INSERT INTO journal VALUES(?,?,?)',[(n,str(n),'OLD_DETAIL_'+str(n))for n in range(1,rows+1)]);ledger.chmod(0o600);pathlib.Path(str(ledger)+'.owner.lock').touch(mode=0o600)
   reader=sqlite3.connect('file:'+str(ledger)+'?mode=ro',uri=True);financial=a.audit_snapshot(reader);reader.close();before_inode=(ledger.stat().st_dev,ledger.stat().st_ino);backups=root/'backups';prior_backup=backups/'prior';prior_backup.mkdir(parents=True);frozen_backup=prior_backup/'ledger.sqlite';destination=sqlite3.connect(frozen_backup);writer.backup(destination);destination.close();frozen_backup.chmod(0o600);descriptor={'file':str(frozen_backup),'bytes':frozen_backup.stat().st_size,'sha256':f.sha(frozen_backup.read_bytes()),'financial':financial}
   etc=root/'etc';etc.mkdir();records=etc/'cutovers';prior_dir=records/f.PRIOR_RECORD;prior_dir.mkdir(parents=True,mode=0o700);backups.chmod(0o700);prior={'kind':'poe-original-forward-upgrade-v1','accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'source':f.OLD_SOURCE,'driverSha256':f.PRIOR_FORWARD_DRIVER_SHA,'packageIndexSha256':f.PRIOR_INDEX,'phase':'new-source-post-start-prefix-verified-render-gate-pending','postStartVerification':{'complete':True,'source':f.OLD_SOURCE,'configurationSha256':f.OLD_CONFIGURATION_SHA},'stoppedFinancial':financial,'backup':descriptor};(prior_dir/'transition.json').write_bytes(f.encoded(prior));(prior_dir/'phase-00-preserve.json').write_bytes(b'PRESERVE_ORIGINAL_FAILURE');reporting=prior_dir/'reporting-credential-v1';reporting.mkdir(mode=0o700);(reporting/'before-service.json').write_bytes(b'PRESERVE_REPORTER_BEFORE_IMAGE')
   releases=root/'releases';releases.mkdir();old=releases/f.OLD_SOURCE['commit'];old.mkdir();old_op=old/'operator/native-paper-ec2';old_op.mkdir(parents=True);old_supervisor=b'PINNED_UNCHANGED_RESOURCE_V2_SUPERVISOR';(old_op/'run-authoritative-service.py').write_bytes(old_supervisor);(old_op/'run-authoritative-service.py').chmod(0o640);current=root/'current';current.symlink_to(old);unit_dir=root/'unit.d';unit_dir.mkdir();dropin=unit_dir/'90-native-engine.conf';dropin.write_bytes(b'UNCHANGED_REVIEWED_RESOURCE_V2_PROFILE');dropin.chmod(0o644);(unit_dir/'00-legacy-entrypoint.conf').write_bytes(b'UNCHANGED_ORDERED_LEGACY');stage=root/'stage';stage.mkdir(mode=0o700);package_parent=root/'root-packages';package_parent.mkdir();public=root/'public';public.mkdir(mode=0o755);public.chmod(0o755);oldpackage=package_parent/'issue11';oldpackage.mkdir();(oldpackage/'index.json').write_bytes(b'PRESERVE_OLD_ROOT_INDEX')
   bodies={'native-paper.mjs':b'NEW_TIMING_SOURCE','backup-worker.mjs':b'UNCHANGED_BACKUP','better_sqlite3.node':b'UNCHANGED_ADDON','metadata.json':f.encoded({'git':{'commit':'a'*40},'financialMode':'PAPER','liveTradingEnabled':False}),'snapshot-publisher.mjs':b'PRESERVED_CREDENTIAL_HOTFIX','run-authoritative-service.py':old_supervisor,'forward-original-upgrade.py':b'INDEPENDENTLY_PINNED_FORWARD_DRIVER','poe-runtime-persistent.conf':dropin.read_bytes()};unchanged={name:f.sha(bodies[name])for name in f.UNCHANGED};old_bodies={name:(b'OLD_NATIVE'if name=='native-paper.mjs'else b'OLD_METADATA'if name=='metadata.json'else b'PRESERVED_CREDENTIAL_HOTFIX'if name=='snapshot-publisher.mjs'else bodies[name])for name in s.RELEASE_FILES}
   old_manifest={'schemaVersion':1,'kind':'poe-authoritative-persistent-service-v1','source':f.OLD_SOURCE,'configurationSha256':f.OLD_CONFIGURATION_SHA,'stage':'single','deepSlots':4,'strategy':'persistent-buying-pilot-v1','files':[{'file':name,'bytes':len(body),'sha256':f.sha(body)}for name,body in old_bodies.items()],'policy':s.POLICY};new_manifest=copy.deepcopy(old_manifest);new_manifest['policy']=s.POLICY;new_manifest['configurationSha256']=f.NEW_CONFIGURATION_SHA;new_manifest['source']={'commit':'a'*40,'sha256':f.sha(bodies['native-paper.mjs'])};new_manifest['files']=[{'file':name,'bytes':len(bodies[name]),'sha256':f.sha(bodies[name])}for name in s.RELEASE_FILES];old_raw=f.encoded(old_manifest);(prior_dir/'after-service.json').write_bytes(old_raw);(prior_dir/'transition.json').write_bytes(f.encoded(prior));manifest=etc/'native-engine.json';manifest.write_bytes(old_raw);manifest.chmod(0o640)
   for name,body in old_bodies.items():(old/name).write_bytes(body);(old/name).chmod(0o640)
   baseline=f.encoded({'schemaVersion':1,'kind':'poe-research-baseline-checkpoint','physicalSettlement':{'physicalTransportsSettled':True},'counters':{'units':8959,'pendingReservedBytes':519831552}});(account/'research-baseline.json').write_bytes(baseline);(account/'research-baseline.json').chmod(0o600);input_value={'schemaVersion':1,'source':f.OLD_SOURCE,'dataContract':'confirmed-program-activity-v3-shadow','baselinePaths':[str(account/'research-baseline.json')],'baselineCheckpointSha256':f.sha(baseline),'priorPhysicalSettled':True,'reportingBinding':{'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'sourceStatusSha256':'e'*64},'priorCooldownUntil':1793239999999,'origins':[],'unknownFutureField':{'keep':['all','nested',8959]}};before_input=f.encoded(input_value);(account/'input.json').write_bytes(before_input);(account/'input.json').chmod(0o600);(account/'KEEP_COUNTERBOOK.json').write_bytes(b'KEEP_ALL_USAGE_AND_PENDING_OPERATIONS');(account/'operating.json').write_bytes(f.encoded({'schemaVersion':1,'authoritative':True,'experimental':False,'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'runs':['KEEP_OLD_RUN'],'counters':{'units':8959,'pendingBytes':519831552}}));(account/'operating.json').chmod(0o600);(account/'status.json').write_bytes(f.encoded({'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'source':{**f.OLD_SOURCE,'builtAt':'2026-10-29T00:00:00Z','dirty':False,'version':'0.1.0','dependencyLockSha256':'e'*64},'runId':'native-paper-20261029000000000','running':False,'generatedAt':f.now()+2000,'status':'graceful service stop; exposure and obligations retained'}));(account/'status.json').chmod(0o600);run_dir=account/'runs/native-paper-20261029000000000';run_dir.mkdir(parents=True,mode=0o700);(run_dir/'settlement.json').write_bytes(f.encoded({'at':f.now()+2000,'physicalSettlementConfirmed':True,'positions':int(exposure),'pending':int(exposure),'financialHistoryPreserved':True}));(run_dir/'settlement.json').chmod(0o600);bodies['service.json']=f.encoded(new_manifest)
   for name,body in bodies.items():(stage/name).write_bytes(body);(stage/name).chmod(0o600)
   index={'schemaVersion':1,'kind':'poe-original-forward-upgrade-package-v1','sourceCommit':'a'*40,'previousSource':f.OLD_SOURCE,'compatibility':copy.deepcopy(f.COMPATIBILITY),'files':[{'file':name,'bytes':len(body),'sha256':f.sha(body)}for name,body in bodies.items()]};index_raw=f.encoded(index);(stage/'index.json').write_bytes(index_raw);(stage/'index.json').chmod(0o600);expected=f.sha(index_raw);driver_sha=f.sha(bodies['forward-original-upgrade.py']);record_dir=records/('forward-'+'a'*40);events=[];proof={'physicalWriterSettled':True,'unitAfter':{'ActiveState':'inactive','SubState':'dead','Result':'success','ExecMainCode':'1','ExecMainStatus':'0'},'gracefulStopClaimed':False};real_read=f.read;core_read=m.read;real_atomic=m.atomic;real_directory=m.directory;owner=types.SimpleNamespace(pw_uid=test_uid,pw_gid=test_gid);running={'ActiveState':'active','SubState':'running','MainPID':'123',**f.RESOURCE_BEFORE}
   def owner_read(path,limit,uid=0,gid=None,mode=None):return real_read(path,limit,test_uid,None if gid is None else test_gid,mode)
   def create_dir(path,uid,gid,mode):
    if not path.exists():path.mkdir(mode=mode);path.chmod(mode)
    real_directory(path,test_uid,private=mode==0o700)
   def save(path,body,uid,gid,mode=0o600):return real_atomic(path,body,test_uid,test_gid,mode)
   def ctl(*args):
    events.append(args)
    if args[0]=='daemon-reload':running.update(f.RESOURCE_AFTER if dropin.read_bytes()==bodies['poe-runtime-persistent.conf']else f.RESOURCE_BEFORE)
   def effective_unit():return {**running,**(f.RESOURCE_AFTER if dropin.read_bytes()==bodies['poe-runtime-persistent.conf']else f.RESOURCE_BEFORE)}
   def release_verified(value):
    target=releases/value['source']['commit']
    for row in value['files']:f.need(f.sha((target/row['file']).read_bytes())==row['sha256'],'IMMUTABLE_RELEASE_HASH_REQUIRED')
    return target
   fake_supervisor=types.SimpleNamespace(validate_manifest=s.validate_manifest,RELEASE_FILES=s.RELEASE_FILES,release_verified=release_verified);new_supervisor=types.SimpleNamespace(validate_manifest=s.validate_manifest,RELEASE_FILES=s.RELEASE_FILES,release_verified=release_verified)
   with contextlib.ExitStack()as stack:
    stack.enter_context(patch.multiple(m,ROOT=home,ACCOUNT=account,SERVICE=service,LEDGER=ledger,ETC=etc,RECORDS=records,BACKUPS=backups,RELEASES=releases,CURRENT=current,MANIFEST=manifest,DROPIN=dropin,PUBLIC_STATUS=public/'status.json'));stack.enter_context(patch.multiple(f,UID=os.getuid(),GID=os.getgid(),RUNNER=os.getuid(),STAGE=stage,PACKAGE=oldpackage,UNITDIR=unit_dir,OLD_MANIFEST=f.sha(old_raw),OLD_SUPERVISOR=f.sha(old_supervisor),OLD_REPORTER=f.sha(old_bodies['snapshot-publisher.mjs']),NATIVE_DROPIN_SHA=f.sha(dropin.read_bytes()),NEW_NATIVE_DROPIN_SHA=f.sha(bodies['poe-runtime-persistent.conf']),UNCHANGED=unchanged));stack.enter_context(patch.object(f,'current_release_supervisor',return_value=fake_supervisor));stack.enter_context(patch.object(f,'release_supervisor',return_value=new_supervisor));stack.enter_context(patch.object(f,'read',side_effect=owner_read));stack.enter_context(patch.object(f,'local_preflight',side_effect=lambda *args:effective_unit()));stack.enter_context(patch.object(f,'process_owner'));stack.enter_context(patch.object(f,'unit',side_effect=effective_unit));stack.enter_context(patch.object(m,'read',side_effect=lambda path,limit,uid=0:core_read(path,limit,test_uid)));stack.enter_context(patch.object(m,'directory',side_effect=lambda path,uid,private=False:real_directory(path,test_uid,private)));stack.enter_context(patch.object(m,'make_dir',side_effect=create_dir));stack.enter_context(patch.object(m,'atomic',side_effect=save));stack.enter_context(patch.object(m.pwd,'getpwnam',return_value=owner));stack.enter_context(patch.object(m,'systemctl',side_effect=ctl));stack.enter_context(patch.object(m,'observe_stopped_writer',return_value=proof));stack.enter_context(patch.object(m,'wait_for_new_public_status',return_value={'available':True,'observedAt':f.now(),'release':'a'*40}));stack.enter_context(patch.object(f.os,'getuid',return_value=0));stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
    yield types.SimpleNamespace(root=root,home=home,account=account,ledger=ledger,writer=writer,state=state,financial=financial,old=old,current=current,target=releases/('a'*40),record_dir=record_dir,manifest=manifest,old_raw=old_raw,before_input=before_input,bodies=bodies,index=index,expected=expected,driver_sha=driver_sha,events=events,proof=proof,baseline=baseline,prior_dir=prior_dir,oldpackage=oldpackage,stage=stage,backups=backups,inode=before_inode,supervisor=fake_supervisor)
   writer.close()
 def run_apply(self,value):return f.apply(value.expected,m,a,value.supervisor,value.driver_sha)
 def test_same_account_exposure_input_manifest_and_usage_preserved(self):
  with self.prepared(exposure=True)as value:
   result=self.run_apply(value);after_input=json.loads((value.account/'input.json').read_bytes());old_input=json.loads(value.before_input);self.assertEqual({k:v for k,v in after_input.items()if k!='source'},{k:v for k,v in old_input.items()if k!='source'});self.assertEqual(after_input['source']['commit'],'a'*40);self.assertEqual((value.account/'research-baseline.json').read_bytes(),value.baseline);self.assertEqual((value.account/'KEEP_COUNTERBOOK.json').read_bytes(),b'KEEP_ALL_USAGE_AND_PENDING_OPERATIONS');self.assertEqual(value.current.resolve(),value.target);self.assertEqual((value.ledger.stat().st_dev,value.ledger.stat().st_ino),value.inode);self.assertFalse(result['operationalAcceptance']);self.assertFalse(result['backupRestored']);self.assertEqual(json.loads(value.manifest.read_bytes())['policy'],s.POLICY);self.assertEqual((value.root/'unit.d/90-native-engine.conf').read_bytes(),value.bodies['poe-runtime-persistent.conf']);record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertEqual(record['stoppedFinancial']['openPositions'],1);self.assertEqual(record['stoppedFinancial']['pendingActions'],1);self.assertEqual(record['postStartFinancial']['financial']['positionsStateSha256'],value.financial['positionsStateSha256']);self.assertEqual(record['postStartFinancial']['financial']['pendingStateSha256'],value.financial['pendingStateSha256']);self.assertTrue(record['postStartFinancial']['journalAndActionPrefixPreserved']);self.assertEqual(value.events,[('stop','poe-runtime.service'),('daemon-reload',),('start','poe-runtime.service')]);self.assertEqual((value.oldpackage/'index.json').read_bytes(),b'PRESERVE_OLD_ROOT_INDEX');self.assertEqual((value.record_dir/'prior-root-records/phase-00-preserve.json').read_bytes(),b'PRESERVE_ORIGINAL_FAILURE');self.assertEqual((value.record_dir/'prior-root-records/reporting-credential-v1/before-service.json').read_bytes(),b'PRESERVE_REPORTER_BEFORE_IMAGE')
 def test_full_previous_47662_row_prefix_plus_new_rows_verified(self):
  with self.prepared(rows=47662)as value:
   value.state['revision']=47663;value.writer.execute('UPDATE financial_state SET body=?',(json.dumps(value.state),));value.writer.execute('INSERT INTO actions VALUES(?,?,?)',('new-after-native','NEW_HASH','NEW_RESULT'));value.writer.execute('INSERT INTO journal VALUES(?,?,?)',(47663,'new-after-native','NEW_DETAIL'));self.run_apply(value);record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertEqual(record['originalFinancialPrefix']['prefix']['actions']['priorRows'],47662);self.assertEqual(record['originalFinancialPrefix']['prefix']['journal']['priorRows'],47663);self.assertEqual(record['beforeStopVerifiedBackup']['financial']['revision'],47663);self.assertEqual(record['postStartFinancial']['prefix']['actions']['priorRows'],47663)
 def test_prefix_mutation_refuses_before_any_stop_or_root_records(self):
  with self.prepared()as value:
   value.writer.execute("UPDATE actions SET result='MUTATED' WHERE id='1'")
   with self.assertRaisesRegex(m.Refused,'OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED'):self.run_apply(value)
   self.assertEqual(value.events,[]);self.assertFalse(value.record_dir.exists())
 def test_previous_forward_identity_or_index_mismatch_refuses_before_mutation(self):
  for key,value in [('kind','poe-original-cutover-v1'),('driverSha256','0'*64),('packageIndexSha256','0'*64),('postStartVerification',{'complete':False,'source':f.OLD_SOURCE,'configurationSha256':f.OLD_CONFIGURATION_SHA}),('phase','new-source-retained-post-start-verification-incomplete'),('source',{'commit':'5e55d8b939de99698ddb311a282461931fcbc957','sha256':'0'*64})]:
   with self.subTest(key=key),self.prepared()as fixture_value:
    path=fixture_value.prior_dir/'transition.json';prior=json.loads(path.read_bytes());prior[key]=value;path.write_bytes(f.encoded(prior))
    with self.assertRaisesRegex(f.Refused,'VERIFIED_CURRENT_FORWARD_UPGRADE_RECORD_REQUIRED'):self.run_apply(fixture_value)
    self.assertEqual(fixture_value.events,[]);self.assertFalse(fixture_value.record_dir.exists());self.assertFalse(fixture_value.target.exists());self.assertEqual((fixture_value.account/'input.json').read_bytes(),fixture_value.before_input)
 def test_incomplete_or_mismatched_prior_forward_verification_refuses_before_mutation(self):
  for changed in[{'complete':False,'source':f.OLD_SOURCE,'configurationSha256':f.OLD_CONFIGURATION_SHA},{'complete':True,'source':{'commit':'0'*40,'sha256':'0'*64},'configurationSha256':f.OLD_CONFIGURATION_SHA},{'complete':True,'source':f.OLD_SOURCE,'configurationSha256':'0'*64}]:
   with self.subTest(verification=changed),self.prepared()as value:
    path=value.prior_dir/'transition.json';prior=json.loads(path.read_bytes());prior['postStartVerification']=changed;path.write_bytes(f.encoded(prior))
    with self.assertRaisesRegex(f.Refused,'VERIFIED_CURRENT_FORWARD_UPGRADE_RECORD_REQUIRED'):self.run_apply(value)
    self.assertEqual(value.events,[]);self.assertFalse(value.record_dir.exists());self.assertEqual((value.account/'input.json').read_bytes(),value.before_input)
  with self.prepared()as value:
   (value.prior_dir/'after-service.json').write_bytes(b'UNREVIEWED_PREVIOUS_MANIFEST')
   with self.assertRaisesRegex(f.Refused,'VERIFIED_CURRENT_FORWARD_UPGRADE_RECORD_REQUIRED'):self.run_apply(value)
   self.assertEqual(value.events,[]);self.assertFalse(value.record_dir.exists())
 def test_nested_original_root_history_is_preserved_with_previous_forward_records(self):
  with self.prepared()as value:
   intermediate=value.prior_dir/'prior-root-records';intermediate.mkdir(mode=0o700);(intermediate/'transition.json').write_bytes(b'PRESERVE_A977_FORWARD_TRANSITION');original=intermediate/'prior-root-records';original.mkdir(mode=0o700);(original/'transition.json').write_bytes(b'ORIGINAL_5E55_ROOT_TRANSITION');(original/'index.json').write_bytes(b'ORIGINAL_FA_INDEX');self.run_apply(value)
   copied=value.record_dir/'prior-root-records/prior-root-records';self.assertEqual((copied/'transition.json').read_bytes(),b'PRESERVE_A977_FORWARD_TRANSITION');self.assertEqual((copied/'prior-root-records/transition.json').read_bytes(),b'ORIGINAL_5E55_ROOT_TRANSITION');self.assertEqual((copied/'prior-root-records/index.json').read_bytes(),b'ORIGINAL_FA_INDEX');record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertEqual(record['previousSource'],f.OLD_SOURCE);self.assertTrue(any(row['file']=='prior-root-records/prior-root-records/transition.json'for row in record['copiedPriorRootRecords']))
 def test_root_indexed_supervisor_is_distinct_from_current_financial_supervisor(self):
  repository=HERE.parent.parent;index_path=repository/'evidence/issue11-consolidation-20261028/prepared-original-upgrade/index.json';raw=index_path.read_bytes();self.assertEqual(f.sha(raw),f.OLD_INDEX);current=repository/'evidence/issue11-consolidation-20261028/continuous-retention-resource-repair-20261029/upgrade-package/index.json';previous=current.read_bytes();self.assertEqual(f.sha(previous),f.PRIOR_INDEX);rows={row['file']:row for row in json.loads(previous)['files']};self.assertEqual(rows['run-authoritative-service.py']['sha256'],f.OLD_SUPERVISOR);self.assertEqual(rows['snapshot-publisher.mjs']['sha256'],f.OLD_REPORTER);self.assertNotEqual(f.OLD_SUPERVISOR,f.INDEXED_SUPERVISOR)
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-root-helper-pins-')as directory:
   root=pathlib.Path(directory);package=root/'packages/issue11';tools=root/'tools/issue11';package.mkdir(parents=True);tools.mkdir(parents=True);folders={package.parent,package,tools.parent,tools};real_lstat=pathlib.Path.lstat
   def lstat(path):return types.SimpleNamespace(st_mode=0o40700,st_uid=0)if path in folders else real_lstat(path)
   core=types.SimpleNamespace();auditor=types.SimpleNamespace();supervisor=types.SimpleNamespace()
   with patch.multiple(f,PACKAGE=package,TOOLS=tools),patch.object(f.os,'getuid',return_value=0),patch.object(pathlib.Path,'lstat',lstat),patch.object(f,'read',return_value=raw),patch.object(f,'reviewed_module',side_effect=[core,auditor,supervisor])as reviewed,patch.object(f,'attach_stop_observer'):
    self.assertEqual(f.load_helpers(),(core,auditor,supervisor));self.assertEqual(reviewed.call_args_list[-1].args,('poe_forward_old_supervisor',tools/'run-authoritative-service.py',f.INDEXED_SUPERVISOR));self.assertEqual(core.HERE,tools)
 def test_manifest_strategy_risk_or_configuration_changes_refused(self):
  with self.prepared()as value:
   old=json.loads(value.old_raw);new=json.loads(value.bodies['service.json'])
   for key,changed in[('strategy','other')]:
    modified=copy.deepcopy(new);modified[key]=changed
    with self.subTest(key=key),self.assertRaisesRegex(f.Refused,'OPERATING_MANIFEST_MUST_BE_PRESERVED'):f.preserved_manifest(old,modified)
   for key,changed in[('stage','two'),('deepSlots',6)]:
    modified=copy.deepcopy(new);modified[key]=changed
    with self.subTest(key=key),self.assertRaisesRegex(f.Refused,'APPROVED_FOUR_SLOT_CAPACITY_MUST_BE_PRESERVED'):f.preserved_manifest(old,modified)
   for key,changed,code in[('configurationSha256','b'*64,'EXACT_RESOURCE_CONFIGURATION_TRANSITION_REQUIRED'),('policy',{},'EXACT_RESOURCE_POLICY_TRANSITION_REQUIRED')]:
    modified=copy.deepcopy(new);modified[key]=changed
    with self.subTest(key=key),self.assertRaisesRegex(f.Refused,code):f.preserved_manifest(old,modified)
 def test_unreviewed_package_and_replaced_hotfix_refuse(self):
  with self.prepared()as value:
   with self.assertRaisesRegex(f.Refused,'REVIEWED_FORWARD_INDEX_PIN_REQUIRED'):f.bundle(value.stage,os.getuid(),'0'*64,value.driver_sha,s)
   index=copy.deepcopy(value.index);index['compatibility']['riskChanged']=True;(value.stage/'index.json').write_bytes(f.encoded(index))
   with self.assertRaisesRegex(f.Refused,'EXACT_FORWARD_PACKAGE_IDENTITY_REQUIRED'):f.bundle(value.stage,os.getuid(),f.sha(f.encoded(index)),value.driver_sha,s)
 def test_unchanged_reporter_and_current_supervisor_remain_exactly_pinned(self):
  with self.prepared()as value:
   old_reporter=(value.old/'snapshot-publisher.mjs').read_bytes();self.assertEqual(value.bodies['snapshot-publisher.mjs'],old_reporter);_,new,data,_=f.bundle(value.stage,os.getuid(),value.expected,value.driver_sha,s);f.preserved_manifest(json.loads(value.old_raw),new);self.run_apply(value);self.assertEqual((value.target/'snapshot-publisher.mjs').read_bytes(),data['snapshot-publisher.mjs']);self.assertEqual((value.old/'snapshot-publisher.mjs').read_bytes(),old_reporter);self.assertEqual(next(row['sha256']for row in json.loads((value.record_dir/'before-service.json').read_bytes())['files']if row['file']=='snapshot-publisher.mjs'),f.sha(old_reporter))
 def test_tampered_new_reporter_or_unknown_old_reporter_is_refused(self):
  with self.prepared()as value:
   (value.stage/'snapshot-publisher.mjs').write_bytes(b'UNREVIEWED_NEW_REPORTER')
   with self.assertRaisesRegex(f.Refused,'FORWARD_PACKAGE_FILE_HASH_REQUIRED'):f.bundle(value.stage,os.getuid(),value.expected,value.driver_sha,s)
   self.assertEqual(value.events,[]);self.assertFalse(value.record_dir.exists());old=json.loads(value.old_raw);new=json.loads(value.bodies['service.json']);next(row for row in old['files']if row['file']=='snapshot-publisher.mjs')['sha256']='0'*64
   with self.assertRaisesRegex(f.Refused,'CURRENT_REPORTER_HOTFIX_REQUIRED'):f.preserved_manifest(old,new)
 def test_new_reporter_manifest_must_match_exact_approved_file(self):
  with self.prepared()as value:
   body=b'ALTERNATE_REVIEWED_REPORTER';(value.stage/'snapshot-publisher.mjs').write_bytes(body);index=copy.deepcopy(value.index);row=next(row for row in index['files']if row['file']=='snapshot-publisher.mjs');row.update(bytes=len(body),sha256=f.sha(body));raw=f.encoded(index);(value.stage/'index.json').write_bytes(raw)
   with self.assertRaisesRegex(f.Refused,'PRESERVED_OPERATIONAL_HELPERS_AND_SQLITE_ABI_REQUIRED'):f.bundle(value.stage,os.getuid(),f.sha(raw),value.driver_sha,s)
 def test_helpers_and_sqlite_remain_pinned_even_if_new_index_and_manifest_agree(self):
  for name in['backup-worker.mjs','better_sqlite3.node','snapshot-publisher.mjs','run-authoritative-service.py']:
   with self.subTest(file=name),self.prepared()as value:
    body=b'UNAPPROVED_IMMUTABLE_ABI_CHANGE';(value.stage/name).write_bytes(body);manifest=json.loads(value.bodies['service.json']);
    if name!='run-authoritative-service.py':next(row for row in manifest['files']if row['file']==name).update(bytes=len(body),sha256=f.sha(body))
    manifest_raw=f.encoded(manifest);(value.stage/'service.json').write_bytes(manifest_raw);index=copy.deepcopy(value.index)
    for row in index['files']:
     if row['file']==name:row.update(bytes=len(body),sha256=f.sha(body))
     if row['file']=='service.json':row.update(bytes=len(manifest_raw),sha256=f.sha(manifest_raw))
    raw=f.encoded(index);(value.stage/'index.json').write_bytes(raw)
    with self.assertRaisesRegex(f.Refused,'PRESERVED_OPERATIONAL_HELPERS_AND_SQLITE_ABI_REQUIRED'):f.bundle(value.stage,os.getuid(),f.sha(raw),value.driver_sha,s)
 def test_resource_before_after_images_and_effective_profile_are_recorded(self):
  with self.prepared(exposure=True)as value:
   dropin=value.root/'unit.d/90-native-engine.conf';before=dropin.read_bytes();result=self.run_apply(value);record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertEqual((value.record_dir/'before-native-dropin.conf').read_bytes(),before);self.assertEqual((value.record_dir/'after-native-dropin.conf').read_bytes(),value.bodies['poe-runtime-persistent.conf']);self.assertEqual(record['resourceTransition']['effectiveBefore'],f.RESOURCE_BEFORE);self.assertEqual(result['resourceTransition']['effectiveAfter'],f.RESOURCE_AFTER);self.assertEqual(record['unitAfter']['MemoryMax'],'3221225472');self.assertFalse(result['operationalAcceptance'])
 def test_legacy_restricted_resource_profile_refuses_before_any_stop(self):
  with self.prepared()as value:
   legacy_profile={**f.RESOURCE_BEFORE,'CPUQuotaPerSecUSec':'500ms','CPUWeight':'10','Nice':'19','MemoryHigh':'671088640','MemoryMax':'805306368'}
   with patch.object(f,'local_preflight',return_value={'ActiveState':'active','SubState':'running','MainPID':'123',**legacy_profile}),self.assertRaisesRegex(f.Refused,'EXACT_INITIAL_RESOURCE_PROFILE_REQUIRED'):self.run_apply(value)
   self.assertEqual(value.events,[]);self.assertFalse(value.record_dir.exists());self.assertEqual((value.account/'input.json').read_bytes(),value.before_input)
 def test_unapproved_resource_dropin_refuses_even_if_transport_index_agrees(self):
  with self.prepared()as value:
   body=b'[Service]\nExecStart=/bin/false\n';(value.stage/'poe-runtime-persistent.conf').write_bytes(body);index=copy.deepcopy(value.index);next(row for row in index['files']if row['file']=='poe-runtime-persistent.conf').update(bytes=len(body),sha256=f.sha(body));raw=f.encoded(index);(value.stage/'index.json').write_bytes(raw)
   with self.assertRaisesRegex(f.Refused,'REVIEWED_NEW_RESOURCE_DROPIN_REQUIRED'):f.bundle(value.stage,os.getuid(),f.sha(raw),value.driver_sha,s)
   self.assertEqual(value.events,[])
 def test_six_slot_target_is_rejected_even_with_approved_transport_hashes(self):
  with self.prepared()as value:
   manifest=json.loads(value.bodies['service.json']);manifest['deepSlots']=6;body=f.encoded(manifest);(value.stage/'service.json').write_bytes(body);index=copy.deepcopy(value.index);next(row for row in index['files']if row['file']=='service.json').update(bytes=len(body),sha256=f.sha(body));raw=f.encoded(index);(value.stage/'index.json').write_bytes(raw)
   with self.assertRaisesRegex(f.Refused,'APPROVED_FOUR_SLOT_CAPACITY_MUST_BE_PRESERVED'):f.bundle(value.stage,os.getuid(),f.sha(raw),value.driver_sha,s)
   self.assertEqual(value.events,[])
 def test_new_configuration_must_match_approved_resource_profile_during_staging(self):
  with self.prepared()as value:
   manifest=json.loads(value.bodies['service.json']);manifest['configurationSha256']='0'*64;body=f.encoded(manifest);(value.stage/'service.json').write_bytes(body);index=copy.deepcopy(value.index);next(row for row in index['files']if row['file']=='service.json').update(bytes=len(body),sha256=f.sha(body));raw=f.encoded(index);(value.stage/'index.json').write_bytes(raw)
   with self.assertRaisesRegex(f.Refused,'PINNED_RESOURCE_CONFIGURATION_REQUIRED'):f.bundle(value.stage,os.getuid(),f.sha(raw),value.driver_sha,s)
   self.assertEqual(value.events,[])
 def test_resource_profile_reload_failure_restores_old_images_before_new_start(self):
  with self.prepared(exposure=True)as value:
   dropin=value.root/'unit.d/90-native-engine.conf';before=dropin.read_bytes()
   calls={'n':0}
   def failed_profile():
    calls['n']+=1;return {'ActiveState':'active','SubState':'running','MainPID':'123',**f.RESOURCE_BEFORE,**({'CPUQuotaPerSecUSec':'500ms'}if calls['n']==1 else{})}
   with patch.object(f,'unit',side_effect=failed_profile),self.assertRaisesRegex(f.Refused,'NEW_EFFECTIVE_RESOURCE_PROFILE_REQUIRED'):self.run_apply(value)
   self.assertEqual(value.current.resolve(),value.old);self.assertEqual(dropin.read_bytes(),before);self.assertEqual(value.manifest.read_bytes(),value.old_raw);self.assertEqual((value.account/'input.json').read_bytes(),value.before_input);self.assertEqual(value.events,[('stop','poe-runtime.service'),('daemon-reload',),('daemon-reload',),('start','poe-runtime.service')]);self.assertFalse(json.loads((value.record_dir/'transition.json').read_bytes()).get('startRequestedAt'))
 def test_started_new_source_never_rolls_back_resource_profile(self):
  with self.prepared(exposure=True)as value:
   self.run_apply(value);value.events.clear();dropin=value.root/'unit.d/90-native-engine.conf';new=dropin.read_bytes()
   with patch.object(f,'local_preflight',return_value={'ActiveState':'active','SubState':'running','MainPID':'123',**f.RESOURCE_BEFORE,'CPUQuotaPerSecUSec':'500ms'}),self.assertRaisesRegex(f.Refused,'STARTED_RESOURCE_PROFILE_MUST_BE_RETAINED'):self.run_apply(value)
   self.assertEqual(value.events,[]);self.assertEqual(value.current.resolve(),value.target);self.assertEqual(dropin.read_bytes(),new);self.assertEqual(value.manifest.read_bytes(),value.bodies['service.json'])
 def test_bootstrap_v1_and_current_v2_validators_are_separate(self):
  manifest=json.loads((HERE.parent.parent/'evidence/issue11-consolidation-20261028/continuous-retention-resource-repair-20261029/upgrade-package/service.json').read_bytes())
  self.assertEqual(s.validate_manifest(manifest),manifest)
  with self.assertRaisesRegex(legacy.Guard,'REVIEWED_SERVICE_POLICY_REQUIRED'):legacy.validate_manifest(manifest)
  raw=(HERE/'run-authoritative-service.py').read_bytes();self.assertEqual(f.sha(raw),f.OLD_SUPERVISOR);module=f.release_supervisor({'run-authoritative-service.py':raw});self.assertEqual(module.validate_manifest(manifest),manifest);self.assertEqual(f.policy_sha(module.POLICY),f.OLD_POLICY_SHA)
  expected=HERE.parent.parent/'fixture-release'/f.OLD_SOURCE['commit']/'operator/native-paper-ec2/run-authoritative-service.py'
  with patch.object(f,'reviewed_module',return_value=module)as reviewed:
   self.assertEqual(f.current_release_supervisor(types.SimpleNamespace(RELEASES=HERE.parent.parent/'fixture-release')),module)
   self.assertEqual(reviewed.call_args.args,('poe_forward_current_supervisor',expected,f.OLD_SUPERVISOR))
  changed=raw.replace(b"'sourceHeapMiB':1024",b"'sourceHeapMiB':2048");self.assertNotEqual(changed,raw)
  with self.assertRaisesRegex(f.Refused,'EXACT_REVIEWED_NEW_RESOURCE_SUPERVISOR_REQUIRED'):f.release_supervisor({'run-authoritative-service.py':changed})
 def test_current_supervisor_loads_only_exact_pinned_v2_bytes(self):
  raw=(HERE/'run-authoritative-service.py').read_bytes();context=types.SimpleNamespace(RELEASES=HERE.parent.parent/'fixture-releases')
  with patch.object(f,'read',return_value=raw):current=f.current_release_supervisor(context)
  self.assertEqual(current.POLICY,s.POLICY);self.assertEqual(f.policy_sha(current.POLICY),f.OLD_POLICY_SHA)
  with patch.object(f,'read',return_value=raw+b'\n# UNAPPROVED CHANGE\n'),self.assertRaisesRegex(f.Refused,'REVIEWED_ROOT_HELPER_HASH_REQUIRED'):f.current_release_supervisor(context)
 def test_stop_failure_never_mutates_input_manifest_or_link(self):
  with self.prepared()as value:
   def ctl(*args):
    value.events.append(args)
    if args[0]=='stop':raise m.Refused('INJECTED_STOP_FAILURE')
   with patch.object(m,'systemctl',side_effect=ctl),patch.object(m,'observe_stopped_writer',side_effect=AssertionError('no lease or proof after failed stop')),self.assertRaisesRegex(m.Refused,'INJECTED_STOP_FAILURE'):self.run_apply(value)
   self.assertEqual((value.account/'input.json').read_bytes(),value.before_input);self.assertEqual(value.manifest.read_bytes(),value.old_raw);self.assertEqual(value.current.resolve(),value.old);self.assertEqual(value.events,[('stop','poe-runtime.service'),('start','poe-runtime.service')]);self.assertFalse(json.loads((value.record_dir/'transition.json').read_bytes()).get('startRequestedAt'))
 def test_physical_or_ungraceful_stop_refuses_and_resumes_old_financial_owner(self):
  for proof in[{'physicalWriterSettled':False},{'physicalWriterSettled':True,'unitAfter':{'ActiveState':'failed','SubState':'failed','Result':'timeout','ExecMainCode':'2','ExecMainStatus':'9'}}]:
   with self.subTest(proof=proof),self.prepared()as value,patch.object(m,'observe_stopped_writer',return_value=proof):
    with self.assertRaises(f.Refused):self.run_apply(value)
    self.assertEqual(value.current.resolve(),value.old);self.assertEqual(value.manifest.read_bytes(),value.old_raw);self.assertEqual((value.account/'input.json').read_bytes(),value.before_input);self.assertEqual(value.events,[('stop','poe-runtime.service'),('start','poe-runtime.service')])
 def test_partial_install_restores_old_only_with_fresh_lease_and_proof(self):
  with self.prepared(exposure=True)as value:
   real=m.atomic;failed={'value':False};leases=[];real_lease=m.lease
   def save(path,raw,*args,**kwargs):
    if path==value.manifest and raw==value.bodies['service.json']and not failed['value']:failed['value']=True;raise OSError('injected manifest replacement failure')
    return real(path,raw,*args,**kwargs)
   def lease():leases.append('lease');return real_lease()
   with patch.object(m,'atomic',side_effect=save),patch.object(m,'lease',side_effect=lease),self.assertRaises(OSError):self.run_apply(value)
   self.assertEqual(leases,['lease','lease']);self.assertEqual(value.current.resolve(),value.old);self.assertEqual(value.manifest.read_bytes(),value.old_raw);self.assertEqual((value.account/'input.json').read_bytes(),value.before_input);record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertTrue(record['recoveryStopProof']['physicalWriterSettled']);self.assertTrue(record['reporterHotfixPreserved']);self.assertEqual(record['oldFinancialSource'],f.OLD_SOURCE)
 def test_recovery_new_writer_race_forbids_config_restore(self):
  with self.prepared()as value:
   real=m.atomic
   def fail(path,raw,*args,**kwargs):
    if path==value.manifest and raw==value.bodies['service.json']:raise OSError('injected install failure')
    return real(path,raw,*args,**kwargs)
   with patch.object(m,'atomic',side_effect=fail),patch.object(m,'observe_stopped_writer',side_effect=[value.proof,{'physicalWriterSettled':False}]),self.assertRaisesRegex(f.Refused,'RECOVERY_REQUIRES_FRESH_PHYSICAL_STOP'):self.run_apply(value)
   self.assertNotEqual((value.account/'input.json').read_bytes(),value.before_input);self.assertNotIn(('start','poe-runtime.service'),value.events)
 def test_start_timeout_is_durable_and_rerun_keeps_new_manager_without_stop(self):
  with self.prepared(exposure=True)as value:
   def ctl(*args):
    value.events.append(args)
    if args[0]=='start':raise m.Refused('INJECTED_START_TIMEOUT')
   with patch.object(m,'systemctl',side_effect=ctl),self.assertRaisesRegex(m.Refused,'INJECTED_START_TIMEOUT'):self.run_apply(value)
   record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertTrue(record['startRequestedAt']);self.assertEqual(value.current.resolve(),value.target);value.events.clear();self.run_apply(value);self.assertEqual(value.events,[('start','poe-runtime.service')]);self.assertEqual(value.current.resolve(),value.target)
 def test_poststart_prefix_failure_retains_new_and_suspends_only_admission(self):
  with self.prepared(exposure=True)as value:
   real=m.verify_live_financial_prefix;count={'n':0}
   def prefix(*args,**kwargs):
    count['n']+=1
    if count['n']==6:raise m.Refused('OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED')
    return real(*args,**kwargs)
   # calls: original, live backup, stopped original, stopped live, post-start.
   def prefix2(*args,**kwargs):
    if value.current.resolve()==value.target:raise m.Refused('OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED')
    return real(*args,**kwargs)
   with patch.object(m,'verify_live_financial_prefix',side_effect=prefix2),self.assertRaisesRegex(f.Refused,'NEW_FINANCIAL_MANAGER_RETAINED'):self.run_apply(value)
   self.assertEqual(value.current.resolve(),value.target);self.assertTrue((value.account/'admission-suspension.request').exists());self.assertEqual(value.events.count(('stop','poe-runtime.service')),1);self.assertEqual(value.events[-1],('start','poe-runtime.service'));self.assertEqual(value.writer.execute('SELECT count(*) FROM actions').fetchone(),(3,))
 def test_stale_stop_proof_cannot_authorize_retry_after_stop_failure(self):
  with self.prepared()as value:
   self.run_apply(value);path=value.record_dir/'transition.json';record=json.loads(path.read_bytes());record.pop('startRequestedAt');record['configurationMutationIntent']=True;record['stopProof']=value.proof;path.write_bytes(f.encoded(record));value.events.clear();before_manifest=value.manifest.read_bytes();before_input=(value.account/'input.json').read_bytes()
   def ctl(*args):
    value.events.append(args)
    if args[0]=='stop':raise m.Refused('INJECTED_STOP_FAILURE')
   with patch.object(m,'systemctl',side_effect=ctl),self.assertRaisesRegex(f.Refused,'POSSIBLE_NEW_MANAGER_STOP_UNPROVED'):self.run_apply(value)
   self.assertEqual(value.events,[('stop','poe-runtime.service')]);self.assertEqual(value.manifest.read_bytes(),before_manifest);self.assertEqual((value.account/'input.json').read_bytes(),before_input);self.assertEqual(value.current.resolve(),value.target)
 def test_after_manifest_with_old_current_also_counts_as_possible_new_start(self):
  with self.prepared()as value:
   self.run_apply(value);path=value.record_dir/'transition.json';record=json.loads(path.read_bytes());record.pop('startRequestedAt');path.write_bytes(f.encoded(record));value.current.unlink();value.current.symlink_to(value.old);value.events.clear()
   def ctl(*args):
    value.events.append(args)
    if args[0]=='stop':raise m.Refused('INJECTED_STOP_FAILURE')
   with patch.object(m,'systemctl',side_effect=ctl),self.assertRaisesRegex(f.Refused,'POSSIBLE_NEW_MANAGER_STOP_UNPROVED'):self.run_apply(value)
   self.assertEqual(value.manifest.read_bytes(),value.bodies['service.json']);self.assertEqual(value.events,[('stop','poe-runtime.service')])
 def test_unknown_permissions_refuse_before_stage_or_service_mutation(self):
  with self.prepared()as value,patch.object(f,'local_preflight',side_effect=f.Refused('EXACT_EXISTING_UID_988_GID_982_REQUIRED')):
   with self.assertRaisesRegex(f.Refused,'EXACT_EXISTING_UID'):self.run_apply(value)
   self.assertFalse(value.record_dir.exists());self.assertEqual(value.events,[]);self.assertFalse(value.target.exists())
 def test_nonroot_command_refuses_before_loading_or_locking(self):
  with patch.object(f.os,'getuid',return_value=994),patch.object(f,'load_helpers',side_effect=AssertionError('no root helper access')),patch.object(f.sys,'argv',['forward-original-upgrade.py','apply','a'*64]),self.assertRaisesRegex(f.Refused,'EXPLICIT_ROOT_FORWARD'):f.main()
 def test_forced_child_kill_cannot_pass_as_native_graceful_stop(self):
  with self.prepared(exposure=True)as value:
   path=value.account/'status.json';status=json.loads(path.read_bytes());status['running']=True;path.write_bytes(f.encoded(status))
   with self.assertRaisesRegex(f.Refused,'NATIVE_GRACEFUL_FINAL_CHECKPOINT_REQUIRED'):self.run_apply(value)
   self.assertEqual(value.current.resolve(),value.old);self.assertEqual(value.manifest.read_bytes(),value.old_raw);self.assertEqual(value.events,[('stop','poe-runtime.service'),('start','poe-runtime.service')])
 def test_interrupted_backup_consumes_attempt_and_retry_preserves_orphan(self):
  with self.prepared()as value:
   real=m.snapshot_backup;failed={'value':False}
   def fail(path,*args,**kwargs):
    if not failed['value']:failed['value']=True;path.write_bytes(b'PRESERVE_INTERRUPTED_BACKUP');raise OSError('injected backup interruption')
    return real(path,*args,**kwargs)
   with patch.object(m,'snapshot_backup',side_effect=fail),self.assertRaises(OSError):self.run_apply(value)
   record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertEqual(record['attempt'],1);orphan=value.backups/(value.record_dir.name+'-01-live/ledger.sqlite');self.assertEqual(orphan.read_bytes(),b'PRESERVE_INTERRUPTED_BACKUP');self.assertEqual(value.events,[]);self.run_apply(value);self.assertEqual(json.loads((value.record_dir/'transition.json').read_bytes())['attempt'],2);self.assertEqual(orphan.read_bytes(),b'PRESERVE_INTERRUPTED_BACKUP')
 def test_frozen_package_resume_does_not_depend_on_mutable_runner_stage(self):
  with self.prepared()as value:
   self.run_apply(value);(value.stage/'index.json').write_bytes(b'CORRUPT_DISPOSABLE_RUNNER_STAGE');value.events.clear();self.run_apply(value);self.assertEqual(value.events,[('start','poe-runtime.service')]);self.assertEqual(value.current.resolve(),value.target)
 def test_phase_receipt_capacity_refuses_before_stopping_manager(self):
  with self.prepared()as value:
   self.run_apply(value);path=value.record_dir/'transition.json';record=json.loads(path.read_bytes());record.pop('startRequestedAt');path.write_bytes(f.encoded(record))
   for n in range(50):(value.record_dir/('phase-capacity-'+str(n)+'.json')).write_bytes(b'PRESERVE_ROOT_HISTORY')
   value.events.clear()
   with self.assertRaisesRegex(f.Refused,'PHASE_RECEIPT_CAPACITY_REQUIRED_BEFORE_STOP'):self.run_apply(value)
   self.assertEqual(value.events,[]);self.assertEqual(value.current.resolve(),value.target)
 def test_final_and_pre_operating_images_are_retained_never_restored(self):
  with self.prepared()as value:
   operating=(value.account/'operating.json').read_bytes();self.run_apply(value);self.assertEqual((value.record_dir/'before-operating.json').read_bytes(),operating);self.assertEqual((value.record_dir/'stopped-operating-01.json').read_bytes(),operating);self.assertEqual((value.account/'operating.json').read_bytes(),operating);receipt=json.loads((value.root/'public/upgrade-verification.json').read_bytes());self.assertEqual(receipt['inceptionAt'],'2026-10-26T22:07:36.212Z');self.assertFalse(receipt['operationalAcceptance']);self.assertEqual((value.root/'public/upgrade-verification.json').stat().st_mode&0o777,0o644)
 def test_reviewed_physical_stop_adapter_runs_against_actual_indexed_core(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-2b1-stop-adapter-')as directory:
   cgroup=pathlib.Path(directory)/'cgroup.procs';cgroup.write_bytes(b'');fields={'LoadState':'loaded','ActiveState':'inactive','SubState':'dead','MainPID':'0','ControlPID':'0','ControlGroup':'/system.slice/poe-runtime.service','Job':'0','Result':'success','ExecMainCode':'1','ExecMainStatus':'0'}
   with patch.object(m,'SERVICE_CGROUP',cgroup),patch.object(m,'unit_stop_fields',return_value=fields):self.assertTrue(m.observe_stopped_writer()['physicalWriterSettled'])
 def test_unit_parser_proves_native_sandbox_and_typed_empty_execstop(self):
  values={**f.RESOURCE_BEFORE,'LoadState':'loaded','User':'poe-runtime','Group':'poe-runtime','ActiveState':'active','SubState':'running','MainPID':'123','ControlPID':'0','ExecStart':'{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 -B -I /opt/poe/current/operator/native-paper-ec2/run-authoritative-service.py ; }','DropInPaths':' '.join(str(f.UNITDIR/name)for name in['00-legacy-entrypoint.conf','90-native-engine.conf','reporting.conf']),'KillMode':'mixed','Restart':'always','NoNewPrivileges':'yes','PrivateTmp':'yes','ProtectSystem':'strict','ProtectHome':'yes','ReadWritePaths':'/var/lib/poe /run/poe -/var/lib/poe-public','UMask':'0077','TimeoutStopUSec':'1min'}
  def response(value):return types.SimpleNamespace(returncode=0,stdout='\n'.join(k+'='+v for k,v in value.items())+'\n',stderr='')
  typed=types.SimpleNamespace(returncode=0,stdout=json.dumps({'type':'a(sasbttttuii)','data':[]}),stderr='')
  with patch.object(f.subprocess,'run',side_effect=[response(values),typed]):self.assertEqual(f.unit()['MainPID'],'123')
  after={**values,**f.RESOURCE_AFTER}
  with patch.object(f.subprocess,'run',side_effect=[response(after),typed]):self.assertEqual(f.resource_profile(f.unit()),f.RESOURCE_AFTER)
  unreviewed={**after,'MemoryMax':'infinity'}
  with patch.object(f.subprocess,'run',side_effect=[response(unreviewed),typed]),self.assertRaisesRegex(f.Refused,'REVIEWED_EFFECTIVE_RESOURCE_PROFILE_REQUIRED'):f.unit()
  changed=dict(values);changed['ProtectSystem']='no'
  with patch.object(f.subprocess,'run',side_effect=[response(changed),typed]),self.assertRaisesRegex(f.Refused,'PRESERVED_ORIGINAL_SANDBOX_REQUIRED'):f.unit()
  occupied=types.SimpleNamespace(returncode=0,stdout=json.dumps({'type':'a(sasbttttuii)','data':[['OLD_EXEC_STOP']]}),stderr='')
  with patch.object(f.subprocess,'run',side_effect=[response(values),occupied]),self.assertRaisesRegex(f.Refused,'TYPED_EMPTY_EXEC_STOP_REQUIRED'):f.unit()
 def test_named_owner_gid_mismatch_refuses_before_host_metadata_or_mutation(self):
  with patch.object(f.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=988,pw_gid=988)),patch.object(f.grp,'getgrnam',return_value=types.SimpleNamespace(gr_gid=982)),patch.object(m,'validate_host',side_effect=AssertionError('no metadata request until named identity matches')),self.assertRaisesRegex(f.Refused,'EXACT_EXISTING_UID_988_GID_982_REQUIRED'):f.local_preflight(m,a,s)
 def test_reader_refuses_symlink_wrong_gid_hardlink_and_writable_input(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-forward-permissions-')as directory:
   root=pathlib.Path(directory);path=root/'file';path.write_bytes(b'PINNED');path.chmod(0o600);self.assertEqual(f.read(path,32,os.getuid(),os.getgid(),0o600),b'PINNED');link=root/'link';link.symlink_to(path)
   with self.assertRaises(OSError):f.read(link,32,os.getuid())
   with self.assertRaisesRegex(f.Refused,'EXACT_BOUNDED_OWNER'):f.read(path,32,os.getuid(),os.getgid()+1)
   path.chmod(0o622)
   with self.assertRaisesRegex(f.Refused,'EXACT_BOUNDED_OWNER'):f.read(path,32,os.getuid())
   path.chmod(0o600);os.link(path,root/'hardlink')
   with self.assertRaisesRegex(f.Refused,'EXACT_BOUNDED_OWNER'):f.read(path,32,os.getuid())
 def test_rollback_helper_targets_never_include_obsolete_observer_or_database_restore(self):
  source=(HERE/'forward-original-upgrade.py').read_text();self.assertNotIn('m.rollback(',source);self.assertNotIn('m.ORIGINAL',source);self.assertNotIn('bce3d22',source);self.assertNotIn('DELETE FROM',source);self.assertNotIn('INSERT INTO',source);self.assertNotIn('VACUUM',source);self.assertNotIn('urllib',source)
if __name__=='__main__':unittest.main()
