#!/usr/bin/env python3
"""Disposable-only cutover invariants; never calls host systemd/provider."""
import contextlib,copy,datetime,fcntl,importlib.util,json,os,pathlib,sqlite3,tempfile,time,types,unittest
from unittest.mock import patch
p=pathlib.Path(__file__).with_name('cutover-original-service.py');s=importlib.util.spec_from_file_location('cutover_original',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
a=importlib.util.spec_from_file_location('audit_original',p.with_name('audit-original-account.py'));auditor=importlib.util.module_from_spec(a);a.loader.exec_module(auditor)
t=importlib.util.spec_from_file_location('audit_fixture',p.with_name('test-audit-original-account.py'));fixture=importlib.util.module_from_spec(t);t.loader.exec_module(fixture)
class Tests(unittest.TestCase):
 def post_start_fixture(self,d):
  db=d/'TEST_ONLY-live.sqlite';writer,state=fixture.Tests().fixture(db);writer.execute('PRAGMA journal_mode=WAL');writer.executescript('ALTER TABLE actions ADD COLUMN payload_hash TEXT;ALTER TABLE actions ADD COLUMN result TEXT;ALTER TABLE journal ADD COLUMN at INTEGER;ALTER TABLE journal ADD COLUMN kind TEXT;ALTER TABLE journal ADD COLUMN detail TEXT;');writer.execute('UPDATE journal SET at=?,kind=?,detail=? WHERE revision=0',(m.INCEPTION,'inception','ORIGINAL_INCEPTION_DETAIL'));state['revision']=1;writer.execute('UPDATE financial_state SET body=?',(json.dumps(state),));writer.execute('INSERT INTO actions VALUES(?,?,?)',('old-action','ORIGINAL_HASH','ORIGINAL_RESULT'));writer.execute('INSERT INTO journal VALUES(?,?,?,?,?)',(1,'old-action',m.INCEPTION+1,'pause','ORIGINAL_DETAIL'));db.chmod(0o600);reader=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);stopped=auditor.audit_snapshot(reader);reader.close();backups=d/'backups';folder=backups/('a'*40);folder.mkdir(parents=True);backup=folder/'ledger.sqlite';destination=sqlite3.connect(backup);writer.backup(destination);destination.close();backup.chmod(0o600);descriptor={'file':str(backup),'sha256':m.sha(backup.read_bytes()),'bytes':backup.stat().st_size};return db,writer,state,stopped,backups,descriptor
 def test_post_start_prefix_allows_new_reconciliation_rows_preserving_every_prior_column(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-post-start-prefix-')as t:
   d=pathlib.Path(t);db,writer,state,stopped,backups,backup=self.post_start_fixture(d);state['revision']=2;writer.execute('UPDATE financial_state SET body=?',(json.dumps(state),));writer.execute('INSERT INTO actions VALUES(?,?,?)',('new-action','NEW_HASH','NEW_RESULT'));writer.execute('INSERT INTO journal VALUES(?,?,?,?,?)',(2,'new-action',m.INCEPTION+2,'reconcile','NEW_DETAIL'));original_read=m.read
   with patch.object(m,'LEDGER',db),patch.object(m,'BACKUPS',backups),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(m,'read',side_effect=lambda path,limit,uid=0:original_read(path,limit,os.getuid())):proof=m.verify_live_financial_prefix(auditor,stopped,backup)
   self.assertTrue(proof['journalAndActionPrefixPreserved']);self.assertEqual(proof['currentRevision'],2);self.assertEqual(proof['prefix']['actions'],{'priorRows':1,'exactPriorRowsRetained':True,'currentRows':2});self.assertEqual(proof['prefix']['journal']['priorRows'],2);self.assertFalse(proof['backupRestored']);writer.close()
 def test_post_start_prefix_rejects_mutated_historical_payloads_despite_unchanged_counts(self):
  for statement in["UPDATE journal SET detail='MUTATED_DETAIL' WHERE revision=1","UPDATE actions SET result='MUTATED_RESULT' WHERE id='old-action'","UPDATE actions SET payload_hash='MUTATED_HASH' WHERE id='old-action'"]:
   with self.subTest(statement=statement),tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-post-start-mutation-')as t:
    d=pathlib.Path(t);db,writer,state,stopped,backups,backup=self.post_start_fixture(d);writer.execute(statement);original_read=m.read
    with patch.object(m,'LEDGER',db),patch.object(m,'BACKUPS',backups),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(m,'read',side_effect=lambda path,limit,uid=0:original_read(path,limit,os.getuid())),self.assertRaisesRegex(m.Refused,'OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED'):m.verify_live_financial_prefix(auditor,stopped,backup)
    writer.close()
 def test_preinitialized_private_backup_cursor_needs_no_path_access_during_owner_read(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-private-backup-cursor-')as t:
   d=pathlib.Path(t);db,writer,state,stopped,backups,backup=self.post_start_fixture(d);folder=pathlib.Path(backup['file']).parent;original_read=m.read
   @contextlib.contextmanager
   def inaccessible_backup_during_owner_read(uid,gid):
    folder.chmod(0)
    try:yield
    finally:folder.chmod(0o700)
   with patch.object(m,'LEDGER',db),patch.object(m,'BACKUPS',backups),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(m,'read',side_effect=lambda path,limit,uid=0:original_read(path,limit,os.getuid())),patch.object(auditor,'original_owner',side_effect=inaccessible_backup_during_owner_read):proof=m.verify_live_financial_prefix(auditor,stopped,backup)
   self.assertTrue(proof['journalAndActionPrefixPreserved']);self.assertEqual(proof['comparison'],'whole-column-ordered-exact-prefix');writer.close()
 def test_public_source_wait_checks_new_actual_account_release_and_timestamp(self):
  now=int(time.time()*1000);at=datetime.datetime.fromtimestamp(now/1000,datetime.timezone.utc).isoformat().replace('+00:00','Z');value={'accountId':m.ACCOUNT_ID,'inceptionAt':'2026-10-26T22:07:36.212Z','release':'a'*40,'mode':'PAPER','liveTrading':False,'generatedAt':at}
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-new-public-status-')as t:
   path=pathlib.Path(t)/'status.json';path.write_text(json.dumps(value));path.chmod(0o644)
   with patch.object(m,'PUBLIC_STATUS',path):self.assertTrue(m.wait_for_new_public_status('a'*40,os.getuid(),now-1,0)['available']);self.assertFalse(m.wait_for_new_public_status('b'*40,os.getuid(),now-1,0)['available']);self.assertFalse(m.wait_for_new_public_status('a'*40,os.getuid(),now+1000,0)['available'])
 def test_post_start_status_timeout_keeps_financial_manager_and_existing_automatic_recovery(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-post-start-timeout-')as t:
   account=pathlib.Path(t);manifest={'source':{'commit':'a'*40,'sha256':'b'*64},'configurationSha256':'c'*64};transition={'startRequestedAt':m.INCEPTION,'stoppedFinancial':{},'backup':{},'inputTransition':{'installedInputSha256':'d'*64}};proof={'journalAndActionPrefixPreserved':True,'financial':{'PRIVATE_STATE':'NEVER_PUBLIC'}}
   with patch.object(m,'ACCOUNT',account),patch.object(m,'wait_for_new_public_status',return_value={'available':False,'reason':'NEW_ORIGINAL_PUBLIC_STATUS_NOT_VERIFIED_WITHIN_30_SECONDS'}),patch.object(m,'verify_live_financial_prefix',return_value=proof),patch.object(m,'systemctl',side_effect=AssertionError('must not stop/downgrade or restart new manager')):receipt,private=m.post_start_verification(manifest,transition,None,os.getuid(),os.getgid(),maximum_status_wait=0)
   self.assertFalse(receipt['complete']);self.assertFalse(receipt['financialManagementStopped']);self.assertFalse(receipt['newAdmissionsSuspended']);self.assertFalse((account/'admission-suspension.request').exists());self.assertEqual(receipt['admissionPolicy'],'existing-supervisor-fresh-reporting-and-financial-validity-gates');self.assertNotIn('PRIVATE_STATE',json.dumps(receipt));self.assertEqual(private,proof)
 def test_post_start_success_is_read_only_and_does_not_claim_operational_acceptance(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-post-start-success-')as t:
   manifest={'source':{'commit':'a'*40,'sha256':'b'*64},'configurationSha256':'c'*64};transition={'startRequestedAt':m.INCEPTION,'stoppedFinancial':{},'backup':{},'inputTransition':{'installedInputSha256':'d'*64}};proof={'journalAndActionPrefixPreserved':True,'financial':{'PRIVATE_STATE':'NEVER_PUBLIC'}}
   with patch.object(m,'ACCOUNT',pathlib.Path(t)),patch.object(m,'wait_for_new_public_status',return_value={'available':True,'sourceTimestamp':'2026-10-29T01:00:00Z'}),patch.object(m,'verify_live_financial_prefix',return_value=proof),patch.object(m,'systemctl',side_effect=AssertionError('no service action during verification')):receipt,private=m.post_start_verification(manifest,transition,None,os.getuid(),os.getgid())
   self.assertTrue(receipt['complete']);self.assertFalse(receipt['operationalAcceptance']);self.assertEqual(receipt['financialDatabaseWrites'],0);self.assertFalse((pathlib.Path(t)/'admission-suspension.request').exists());self.assertNotIn('PRIVATE_STATE',json.dumps(receipt))
 def test_post_start_mutation_refusal_only_closes_new_admission_not_the_financial_manager(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-post-start-refusal-')as t:
   manifest={'source':{'commit':'a'*40,'sha256':'b'*64},'configurationSha256':'c'*64};transition={'startRequestedAt':m.INCEPTION,'stoppedFinancial':{},'backup':{},'inputTransition':{'installedInputSha256':'d'*64}}
   with patch.object(m,'ACCOUNT',pathlib.Path(t)),patch.object(m,'wait_for_new_public_status',return_value={'available':True}),patch.object(m,'verify_live_financial_prefix',side_effect=m.Refused('OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED')),patch.object(m,'systemctl',side_effect=AssertionError('must retain new financial manager')):receipt,proof=m.post_start_verification(manifest,transition,None,os.getuid(),os.getgid())
   self.assertFalse(receipt['complete']);self.assertTrue(receipt['newAdmissionsSuspended']);self.assertFalse(receipt['financialManagementStopped']);self.assertIsNone(proof);self.assertFalse(receipt['backupRestored'])
 def test_separate_read_only_auditor_refusal_is_contained_and_named_without_manager_restart(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-post-start-auditor-refusal-')as t:
   manifest={'source':{'commit':'a'*40,'sha256':'b'*64},'configurationSha256':'c'*64};transition={'startRequestedAt':m.INCEPTION,'stoppedFinancial':{},'backup':{},'inputTransition':{'installedInputSha256':'d'*64}}
   with patch.object(m,'ACCOUNT',pathlib.Path(t)),patch.object(m,'wait_for_new_public_status',return_value={'available':True}),patch.object(m,'verify_live_financial_prefix',side_effect=auditor.Refused('EXACT_ORIGINAL_ACCOUNT_REQUIRED')),patch.object(m,'systemctl',side_effect=AssertionError('retain financial manager')):receipt,proof=m.post_start_verification(manifest,transition,auditor,os.getuid(),os.getgid())
   self.assertFalse(receipt['complete']);self.assertIn('EXACT_ORIGINAL_ACCOUNT_REQUIRED',receipt['errors']);self.assertTrue(receipt['newAdmissionsSuspended']);self.assertFalse(receipt['financialManagementStopped'])
 def test_financial_rollback_requires_flat_unchanged_money_and_all_obligations(self):
  db,_=fixture.Tests().fixture();before=auditor.audit_snapshot(db);db.close();self.assertTrue(m.financial_rollback_equivalent(before,copy.deepcopy(before)))
  for key,value in[('openPositions',1),('pendingActions',1),('lockedDepositLamports','1'),('cashLamports','9999999999'),('executionCostsLamports','1'),('realizedLamports','1'),('flatAtSnapshot',False),('inceptionAt',0)]:
   changed=copy.deepcopy(before);changed[key]=value
   with self.subTest(key=key):self.assertFalse(m.financial_rollback_equivalent(before,changed))
  revised=copy.deepcopy(before);revised['revision']+=10;self.assertTrue(m.financial_rollback_equivalent(before,revised))
 def test_stopped_phase_releases_owner_before_restarting_the_same_financial_source(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-cutover-phase-')as t:
   f=pathlib.Path(t)/'TEST_ONLY.lock';f.touch(mode=0o600);fd=os.open(f,os.O_RDONLY);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);events=[]
   def recover():
    probe=os.open(f,os.O_RDONLY)
    try:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB);events.append('same-financial-source-resumed')
    finally:os.close(probe)
   def failed():events.append('exposure-race-found');raise m.Refused('OBSERVER_ROLLBACK_UNSAFE_FINANCIAL_STATE_CHANGED')
   with patch.object(m,'systemctl',side_effect=lambda *args:events.append(args)),patch.object(m,'lease',return_value=fd),self.assertRaisesRegex(m.Refused,'UNSAFE_FINANCIAL'):
    m.stopped_phase(failed,recover)
   self.assertEqual(events,[('stop','poe-runtime.service'),'exposure-race-found','same-financial-source-resumed'])
 def test_backup_or_install_failure_resumes_previous_source_without_restoring_database(self):
  for reason in['BACKUP_FAILED','INSTALL_FAILED']:
   events=[]
   def fail():raise m.Refused(reason)
   with self.subTest(reason=reason),tempfile.TemporaryFile()as lock,patch.object(m,'systemctl',side_effect=lambda *args:events.append(args)),patch.object(m,'lease',side_effect=lambda:os.dup(lock.fileno())),self.assertRaisesRegex(m.Refused,reason):m.stopped_phase(fail,lambda:events.append('previous-source-start'))
   self.assertEqual(events,[('stop','poe-runtime.service'),'previous-source-start'])
 def test_success_settles_lease_without_unnecessary_recovery(self):
  with tempfile.TemporaryFile()as lock,patch.object(m,'systemctl')as ctl,patch.object(m,'lease',side_effect=lambda:os.dup(lock.fileno())):
   self.assertEqual(m.stopped_phase(lambda:'installed',lambda:self.fail('unnecessary recovery')),'installed');ctl.assert_called_once_with('stop','poe-runtime.service')
 def test_actual_rollback_exposure_race_resumes_new_financial_release_and_preserves_history(self):
  db,_=fixture.Tests().fixture();before=auditor.audit_snapshot(db);db.close();after=copy.deepcopy(before);after.update(openPositions=1,flatAtSnapshot=False);commit='a'*40
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-rollback-race-')as t,tempfile.TemporaryFile()as lock:
   d=pathlib.Path(t);releases=d/'releases';releases.mkdir();(releases/commit).mkdir();(releases/m.ORIGINAL).mkdir();current=d/'current';current.symlink_to(releases/commit);records=d/'records';record_dir=records/commit;record_dir.mkdir(parents=True);drop=d/'dropin.conf';drop.write_bytes(b'NEW_FINANCIAL_DROPIN');manifest=d/'manifest.json';manifest.write_bytes(b'NEW_FINANCIAL_MANIFEST');transition={'source':{'commit':commit},'previousRelease':m.ORIGINAL,'stoppedFinancial':before};(record_dir/'transition.json').write_text(json.dumps(transition));events=[];original_read=m.read
   def safe_atomic(path,raw,*_args,**_kw):path.write_bytes(raw)
   with patch.object(m,'RELEASES',releases),patch.object(m,'CURRENT',current),patch.object(m,'RECORDS',records),patch.object(m,'DROPIN',drop),patch.object(m,'MANIFEST',manifest),patch.object(m,'validate_host',return_value=(os.getuid(),os.getgid(),{})),patch.object(m,'directory'),patch.object(m,'read',side_effect=lambda path,limit,uid=0:original_read(path,limit,os.getuid())),patch.object(m,'atomic',side_effect=safe_atomic),patch.object(m,'original_audit',side_effect=[before,after]),patch.object(m,'lease',side_effect=lambda:os.dup(lock.fileno())),patch.object(m,'systemctl',side_effect=lambda *args:events.append(args)),self.assertRaisesRegex(m.Refused,'UNSAFE_FINANCIAL_STATE_CHANGED'):
    m.rollback(commit,None,None)
   self.assertEqual(current.resolve(),releases/commit);self.assertEqual(drop.read_bytes(),b'NEW_FINANCIAL_DROPIN');self.assertEqual(manifest.read_bytes(),b'NEW_FINANCIAL_MANIFEST');self.assertEqual(events,[('stop','poe-runtime.service'),('daemon-reload',),('start','poe-runtime.service')]);self.assertEqual(json.loads((record_dir/'transition.json').read_text())['phase'],'observer-rollback-refused-current-financial-source-resumed');self.assertFalse((record_dir/'retired-dropin.conf').exists())
 def test_current_ledger_symlink_and_foreign_lock_are_refused(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-cutover-files-')as t:
   d=pathlib.Path(t);db=d/'TEST_ONLY.sqlite';writer,_=fixture.Tests().fixture(db);writer.close();db.chmod(0o600);db.with_name(db.name+'.owner.lock').touch(mode=0o600);owner=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())
   with patch.object(m,'LEDGER',db),patch.object(m.pwd,'getpwnam',return_value=owner):
    self.assertEqual(m.original_audit(auditor)['accountId'],m.ACCOUNT_ID);fd=m.lease();os.close(fd);db.with_name(db.name+'.owner.lock').chmod(0o644)
    with self.assertRaisesRegex(m.Refused,'FINANCIAL_OWNER_LEASE'):m.lease()
   link=d/'TEST_ONLY-link.sqlite';link.symlink_to(db)
   with patch.object(m,'LEDGER',link),patch.object(m.pwd,'getpwnam',return_value=owner),self.assertRaisesRegex(m.Refused,'CANONICAL_ORIGINAL'):m.original_audit(auditor)
 def test_backup_is_exact_current_wal_state_and_does_not_reseed_or_touch_source(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-original-backup-')as t:
   d=pathlib.Path(t);db=d/'TEST_ONLY.sqlite';writer,state=fixture.Tests().fixture(db);writer.execute('PRAGMA journal_mode=WAL');state['revision']=1;writer.execute('UPDATE financial_state SET body=?',(json.dumps(state),));writer.execute('INSERT INTO actions VALUES(?)',('fixture',));writer.execute('INSERT INTO journal VALUES(1,?)',('fixture',));reader=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);expected=auditor.audit_snapshot(reader);reader.close();dest=d/'TEST_ONLY-backup.sqlite';original_read=m.read
   with patch.object(m,'LEDGER',db),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(m,'read',side_effect=lambda path,limit,uid=0:original_read(path,limit,os.getuid())):result=m.snapshot_backup(dest,auditor,expected)
   check=sqlite3.connect(dest);self.assertEqual(auditor.audit_snapshot(check),expected);check.close();self.assertEqual(result['financial']['revision'],1);self.assertFalse(result['restorePerformed']);self.assertEqual(state['initialMicroUsd'],'1000000000');self.assertEqual(writer.execute('SELECT count(*) FROM journal').fetchone(),(2,));writer.close()
 def test_every_original_sqlite_open_occurs_inside_owner_context_and_auxiliaries_keep_owner(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-owner-sqlite-')as t:
   d=pathlib.Path(t);path=d/'TEST_ONLY.sqlite';writer,state=fixture.Tests().fixture(path);writer.execute('PRAGMA journal_mode=WAL');writer.close();path.chmod(0o600);active={'value':False};owner=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid());real_connect=sqlite3.connect
   @contextlib.contextmanager
   def witness(uid,gid):
    self.assertEqual((uid,gid),(os.getuid(),os.getgid()));active['value']=True
    try:yield
    finally:active['value']=False
   def connect(name,*args,**kwargs):
    if str(path)in str(name):self.assertTrue(active['value'],'original SQLite opened outside owner context')
    return real_connect(name,*args,**kwargs)
   with patch.object(m,'LEDGER',path),patch.object(m.pwd,'getpwnam',return_value=owner),patch.object(auditor,'original_owner',side_effect=witness),patch.object(m.sqlite3,'connect',side_effect=connect):result=m.original_audit(auditor)
   self.assertEqual(result['accountId'],m.ACCOUNT_ID)
   for suffix in['-wal','-shm']:
    auxiliary=pathlib.Path(str(path)+suffix)
    if auxiliary.exists():self.assertEqual(auxiliary.stat().st_uid,os.getuid())
 def test_dangling_backup_symlink_is_refused_without_creating_target(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-backup-link-')as t:
   d=pathlib.Path(t);target=d/'DO_NOT_CREATE.sqlite';link=d/'TEST_ONLY-backup.sqlite';link.symlink_to(target)
   with self.assertRaisesRegex(m.Refused,'BACKUP_MUST_BE_NEW'):m.snapshot_backup(link,None,{})
   self.assertFalse(target.exists())
 def test_initial_cooldown_is_derived_from_actual_flat_stop_without_changing_source_or_account(self):
  at=m.INCEPTION+100000;prepared=json.dumps({'priorCooldownUntil':at-10000,'source':{'commit':'a'*40},'reportingBinding':{'accountId':m.ACCOUNT_ID}}).encode();raw,receipt=m.transition_input(prepared,at);value=json.loads(raw);self.assertEqual(value['priorCooldownUntil'],at+60000);self.assertEqual(value['source'],json.loads(prepared)['source']);self.assertEqual(value['reportingBinding'],json.loads(prepared)['reportingBinding']);self.assertEqual(receipt['installedInputSha256'],m.sha(raw));self.assertEqual(receipt['preparedInputSha256'],m.sha(prepared))
  raw,_=m.transition_input(json.dumps({'priorCooldownUntil':at+120000}).encode(),at);self.assertEqual(json.loads(raw)['priorCooldownUntil'],at+120000)
 def test_input_requires_original_identity_and_same_owned_sealed_accounting_anchor(self):
  baseline=json.dumps({'schemaVersion':1,'kind':'poe-research-baseline-checkpoint','physicalSettlement':{'physicalTransportsSettled':True}}).encode();manifest={'source':{'commit':'a'*40,'sha256':'b'*64}};v={'schemaVersion':1,'source':manifest['source'],'dataContract':'confirmed-program-activity-v3-shadow','baselinePaths':[str(m.ACCOUNT/'research-baseline.json')],'baselineCheckpointSha256':m.sha(baseline),'priorPhysicalSettled':True,'priorCooldownUntil':0,'origins':[],'reportingBinding':{'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'sourceStatusSha256':'c'*64}};self.assertEqual(m.validate_input(v,manifest,baseline),v)
  for key,value in[('baselinePaths',['/home/mm-ec2-runner/PRIVATE']),('baselineCheckpointSha256','d'*64),('priorPhysicalSettled',False),('reportingBinding',{'accountId':'poe-pilot-NO'})]:
   changed=copy.deepcopy(v);changed[key]=value
   with self.subTest(key=key),self.assertRaises(m.Refused):m.validate_input(changed,manifest,baseline)
if __name__=='__main__':unittest.main()
