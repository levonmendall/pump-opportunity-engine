#!/usr/bin/env python3
"""Inert transition and disposable migration-prefix tests; no target access."""
import contextlib,copy,importlib.util,json,pathlib,types,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
f=module('inert_equity_execution_driver','forward-paper-equity-execution-upgrade.py')
p=module('inert_equity_execution_package','prepare-paper-equity-execution-package-20261030.py')
x=module('inert_equity_execution_exporter','export-paper-equity-execution-forensics-20261030.py')
BEFORE=['PRIOR_INDEX','PRIOR_FORWARD_DRIVER_SHA','OLD_MANIFEST','OLD_INPUT_SHA','OLD_SUPERVISOR','OLD_REPORTER','OLD_BACKUP_WORKER_SHA','OLD_CONFIGURATION_SHA','NATIVE_DROPIN_SHA','OLD_POLICY_SHA']
AFTER=['NEW_METADATA_SHA','NEW_CONFIGURATION_SHA','NEW_REPORTER','NEW_BACKUP_WORKER_SHA','NEW_SUPERVISOR','NEW_POLICY_SHA','NEW_NATIVE_DROPIN_SHA','FORENSIC_SHA']
def pins():
 values={name:'2'*64 for name in BEFORE};values.update({name:'4'*64 for name in AFTER});values.update(OLD_SOURCE={'commit':'1'*40,'sha256':'2'*64},PRIOR_RECORD='forward-'+'1'*40,NEW_SOURCE={'commit':'3'*40,'sha256':'4'*64},FORENSIC_RUN='native-paper-20261030040000000');return values
class Templates(unittest.TestCase):
 def test_all_current_transition_and_new_artifact_pins_are_unset(self):
  for name in BEFORE+AFTER+['OLD_SOURCE','PRIOR_RECORD','NEW_SOURCE','FORENSIC_RUN']:self.assertIsNone(getattr(f,name),name)
  for name in ['OLD','COMMIT','BUNDLE_SHA','METADATA_SHA','CONFIGURATION']:self.assertIsNone(getattr(p,name),name)
  for name in ['SOURCE','CONFIGURATION','RUN','STARTED','PRIORITY_WINDOWS','START','END']:self.assertIsNone(getattr(x,name),name)
 def test_unfrozen_driver_refuses_before_any_host_read_or_service_mutation(self):
  with patch.object(f,'read')as read,patch.object(f,'local_preflight')as pre,patch.object(f,'load_helpers')as helpers:
   with self.assertRaisesRegex(f.Refused,'FINAL_EXACT_BEFORE_SOURCE_PIN_REQUIRED'):f.apply('a'*64,None,None,None,'b'*64)
   with self.assertRaisesRegex(f.Refused,'FINAL_EXACT_BEFORE_SOURCE_PIN_REQUIRED'):f.main()
   read.assert_not_called();pre.assert_not_called();helpers.assert_not_called()
 def test_each_missing_pin_and_broad_before_source_is_refused(self):
  frozen=pins()
  for key in list(frozen):
   values=copy.deepcopy(frozen);values[key]=None
   with self.subTest(key=key),patch.multiple(f,**values),self.assertRaises(f.Refused):f.reviewed_transition_pins()
  for before in [[{'commit':'1'*40,'sha256':'2'*64},{'commit':'3'*40,'sha256':'4'*64}],{'commit':['1'*40,'3'*40],'sha256':'2'*64}]:
   values={**frozen,'OLD_SOURCE':before}
   with patch.multiple(f,**values),self.assertRaisesRegex(f.Refused,'FINAL_EXACT_BEFORE_SOURCE_PIN_REQUIRED'):f.reviewed_transition_pins()
  with patch.multiple(f,**frozen):f.reviewed_transition_pins()
 def test_configuration_change_is_explicit_and_cannot_be_mislabeled_unchanged(self):
  frozen=pins();frozen['NEW_CONFIGURATION_SHA']=frozen['OLD_CONFIGURATION_SHA']
  with patch.multiple(f,**frozen),self.assertRaisesRegex(f.Refused,'CHANGED_CONFIGURATION'):f.reviewed_transition_pins()
  for key in ['riskChanged','configurationChanged','financialSchemaChanged','financialSemanticsChanged','executionSemanticsChanged']:self.assertIs(f.COMPATIBILITY[key],True)
  self.assertIs(f.COMPATIBILITY['sqliteTableSchemaChanged'],False);self.assertEqual(f.COMPATIBILITY['financialStateSchemaVersion'],1)
  self.assertEqual(f.COMPATIBILITY['authorizedPositionLimit'],{'before':2,'after':2});self.assertEqual(f.COMPATIBILITY['authorizedDeepObservationLimit'],{'before':4,'after':4})
  self.assertEqual(f.COMPATIBILITY['financialMigrationOwner'],'existing-runtime-single-writer-journaled-events-only')
  for key in ['ownerDailyLossResetInvoked','newWaiverCreated','postStartExecutableRollbackAllowed','providerCounterbooksRestored']:self.assertIs(f.COMPATIBILITY[key],False)
 def test_no_post_start_or_possible_start_executable_downgrade(self):
  for marker in ['startRequestedAt','possibleNewSourceStart']:
   with patch.object(f,'known_images')as images,self.assertRaisesRegex(f.Refused,'RETAIN_NEW_FINANCIAL_MANAGER'):f.recover_old(None,None,None,None,{marker:1},None)
   images.assert_not_called()
 def test_package_and_exporter_stay_inert_without_input_or_output_access(self):
  with patch.object(p.sys,'argv',['prepare','NOT_A_BUNDLE']),patch.object(p.pathlib.Path,'resolve')as resolve:
   with self.assertRaisesRegex(AssertionError,'Final independently reviewed source'):p.main()
   resolve.assert_not_called()
  with patch.object(x,'read')as read,patch.object(x,'private_directory')as directory:
   with self.assertRaisesRegex(x.Refused,'FINAL_EXACT_BEFORE_SOURCE_CONFIGURATION_REQUIRED'):x.main()
   read.assert_not_called();directory.assert_not_called()
  self.assertEqual(str(f.STAGE),'/var/tmp/poe-original-paper-equity-execution-upgrade');self.assertEqual(p.OUTPUT.parts[-2:],('paper-equity-execution-20261030','upgrade-package-final'));self.assertFalse(p.OUTPUT.exists())
 def test_frozen_synthetic_transition_uses_the_existing_single_writer_handoff_without_financial_rewrite(self):
  old=module('disposable_equity_execution_handoff','test-forward-original-upgrade.py');baseline=old.f
  frozen={name:getattr(baseline,name)for name in BEFORE+['OLD_SOURCE','PRIOR_RECORD','FORENSIC_RUN']}
  frozen.update(NEW_SOURCE={'commit':'a'*40,'sha256':f.sha(b'NEW_TIMING_SOURCE')},NEW_METADATA_SHA=f.sha(f.encoded({'git':{'commit':'a'*40},'financialMode':'PAPER','liveTradingEnabled':False})),NEW_CONFIGURATION_SHA='f'*64)
  # The fixture supplies synthetic artifact hashes, RO target paths and mocked
  # systemd. No before/source/artifact pin is filled in the actual template.
  with patch.multiple(f,**frozen),patch.object(old,'f',f),old.Tests().prepared(exposure=True)as value:
   body=next(value.writer.execute('SELECT body FROM financial_state'))[0];result=f.apply(value.expected,old.m,old.a,value.supervisor,value.driver_sha)
   self.assertEqual(next(value.writer.execute('SELECT body FROM financial_state'))[0],body);self.assertEqual((value.ledger.stat().st_dev,value.ledger.stat().st_ino),value.inode)
   self.assertEqual(value.events,[('stop','poe-runtime.service'),('daemon-reload',),('start','poe-runtime.service')]);self.assertEqual(value.current.resolve(),value.target)
   record=json.loads((value.record_dir/'transition.json').read_bytes());self.assertTrue(record['compatibility']['riskChanged']);self.assertTrue(record['compatibility']['financialSemanticsChanged']);self.assertFalse(record['financialSemanticsTransition']['entryPermissionGrantedByInstaller']);self.assertFalse(record['financialSemanticsTransition']['newWaiverOrReset'])
   self.assertTrue(record['postStartFinancial']['journalAndActionPrefixPreserved']);self.assertFalse(record['interruption']['continuousCoverageClaimed']);self.assertEqual(result['financialHistoryReset'],False)
 def test_unchanged_whole_column_prefix_accepts_new_additive_state_and_rejects_old_row_mutation(self):
  # Reuse the existing disposable exact-prefix fixture and pinned RO helpers;
  # only this test writer creates a synthetic journal extension, never target DB.
  old=module('disposable_legacy_forward_fixture','test-forward-original-upgrade.py')
  with old.Tests().prepared(exposure=True)as value:
   state=copy.deepcopy(value.state);state['revision']=4;state['lastAt']=1793318400000
   state['equityRisk']={'version':'paper-equity-risk-5-10-v1','activatedAt':state['lastAt'],'activationRevision':4,'daily':{'day':'2026-10-30','highWaterMicroUsd':None,'highWaterAt':None,'lossPaused':False,'historyState':'scanning','historyCoverage':'unavailable','historyCutoffRevision':3,'historyCursorRevision':0,'historyReceipts':0,'historyDigest':'a'*64}}
   state['positions']['KEEP_POSITION']['executionModelVersion']='paper-chain-conditioned-v1';state['positions']['KEEP_POSITION']['allocation']={'version':'paper-equity-risk-5-10-v1','fixtureOnly':True}
   state['pending']['KEEP_PENDING']['executionModel']={'version':'paper-chain-conditioned-v1','fixtureOnly':True};state['pending']['KEEP_PENDING']['temporaryRentLamports']='1234'
   value.writer.execute('UPDATE financial_state SET body=?',(json.dumps(state),));value.writer.execute('INSERT INTO actions VALUES(?,?,?)',('equity-risk-activation','HASH_NEW_EVENT','NEW_EVENT_RESULT'));value.writer.execute('INSERT INTO journal VALUES(?,?,?)',(4,'equity-risk-activation','NEW_ADDITIVE_STATE_EVENT'))
   before=value.writer.total_changes;proof=old.m.verify_live_financial_prefix(old.a,value.financial,json.loads((value.prior_dir/'transition.json').read_bytes())['backup']);self.assertTrue(proof['journalAndActionPrefixPreserved']);self.assertEqual(proof['currentRevision'],4);self.assertEqual(proof['financialDatabaseWrites'],0);self.assertEqual(value.writer.total_changes,before)
   self.assertEqual(next(value.writer.execute('SELECT body FROM financial_state'))[0],json.dumps(state));self.assertEqual((value.ledger.stat().st_dev,value.ledger.stat().st_ino),value.inode)
   value.writer.execute("UPDATE actions SET result='MUTATED_OLD_RESULT' WHERE id='1'")
   with self.assertRaisesRegex(old.m.Refused,'OLD_FINANCIAL_ROWS_MISSING_OR_MUTATED'):old.m.verify_live_financial_prefix(old.a,value.financial,json.loads((value.prior_dir/'transition.json').read_bytes())['backup'])
if __name__=='__main__':unittest.main()
