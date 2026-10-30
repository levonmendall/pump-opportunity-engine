#!/usr/bin/env python3
import importlib.util,json,os,pathlib,sqlite3,tempfile,unittest
from unittest.mock import patch
p=pathlib.Path(__file__).with_name('audit-original-account.py');s=importlib.util.spec_from_file_location('audit_original',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_root_privilege_drop_restores_effective_identity_and_groups_after_exception(self):
  current={'uid':0,'gid':0,'groups':[0,7]};events=[]
  def set_uid(v):events.append(('uid',v));current['uid']=v
  def set_gid(v):events.append(('gid',v));current['gid']=v
  def set_groups(v):events.append(('groups',list(v)));current['groups']=list(v)
  with patch.object(m.os,'geteuid',side_effect=lambda:current['uid']),patch.object(m.os,'getegid',side_effect=lambda:current['gid']),patch.object(m.os,'getgroups',side_effect=lambda:list(current['groups'])),patch.object(m.os,'seteuid',side_effect=set_uid),patch.object(m.os,'setegid',side_effect=set_gid),patch.object(m.os,'setgroups',side_effect=set_groups):
   with self.assertRaisesRegex(RuntimeError,'injected read failure'):
    with m.original_owner(1234,5678):self.assertEqual(current,{'uid':1234,'gid':5678,'groups':[]});raise RuntimeError('injected read failure')
  self.assertEqual(current,{'uid':0,'gid':0,'groups':[0,7]});self.assertEqual(events,[('groups',[]),('gid',5678),('uid',1234),('uid',0),('gid',0),('groups',[0,7])])
 def test_same_nonroot_reader_needs_no_privileged_operations(self):
  with patch.object(m.os,'geteuid',return_value=1234),patch.object(m.os,'getegid',return_value=5678),patch.object(m.os,'setgroups',side_effect=AssertionError('no privilege changes')),patch.object(m.os,'seteuid',side_effect=AssertionError('no privilege changes')),patch.object(m.os,'setegid',side_effect=AssertionError('no privilege changes')):
   with m.original_owner(1234,5678):pass
   with self.assertRaisesRegex(m.Refused,'OWNER_ACCESS_REQUIRED'):
    with m.original_owner(9999,5678):pass
 def fixture(self,path=':memory:'):
  db=sqlite3.connect(path,isolation_level=None);db.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT);CREATE TABLE actions(id TEXT PRIMARY KEY);CREATE TABLE journal(revision INTEGER,action_id TEXT);CREATE TABLE metadata(key TEXT,value TEXT);')
  state={'schemaVersion':1,'accountId':m.ACCOUNT,'mode':'PAPER','inceptionAt':m.INCEPTION,'initialMicroUsd':'1000000000','revision':0,'positions':{},'pending':{},'lockedDeposits':{},'lamports':'10000000000','inceptionPrice':{'at':m.INCEPTION-1000,'microUsdPerSol':'100000000'},'roundingResidualMicroUsd':'0','controls':{'entriesEnabled':False,'stopRequested':False,'changedAt':m.INCEPTION,'readinessVersion':None,'reason':'SECRET_SENTINEL'},'daily':{'day':'2026-10-26','paused':True,'lossPaused':False,'reconciledAt':0},'realizedLamports':'0','executionCosts':'0','gasReserve':'1000000'}
  db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps(state),));db.execute('INSERT INTO journal VALUES(0,NULL)');db.execute('INSERT INTO metadata VALUES(?,?)',('PRIVATE_METADATA','SECRET_SENTINEL'));return db,state
 def change(self,db,state,**updates):state.update(updates);db.execute('UPDATE financial_state SET body=?',(json.dumps(state),))
 def test_read_only_snapshot_checks_original_inception_and_preserves_all_rows(self):
  db,state=self.fixture();before=db.total_changes;r=m.audit_snapshot(db);self.assertEqual(r['revision'],0);self.assertEqual(r['cashLamports'],'10000000000');self.assertEqual(db.total_changes,before);self.assertNotIn('SECRET_SENTINEL',json.dumps(r));self.assertTrue(r['flatAtSnapshot']);self.assertEqual(db.execute('SELECT value FROM metadata').fetchone(),('SECRET_SENTINEL',))
  with self.assertRaises(sqlite3.OperationalError):db.execute('DELETE FROM financial_state')
  db.close()
 def test_existing_read_only_transaction_remains_open_for_same_snapshot_prefix_comparison(self):
  db,state=self.fixture();db.execute('PRAGMA query_only=ON');db.execute('BEGIN');revision=m.audit_snapshot(db,existing_transaction=True)['revision'];self.assertEqual(revision,0);self.assertTrue(db.in_transaction)
  with self.assertRaises(sqlite3.OperationalError):db.execute('DELETE FROM financial_state')
  self.assertEqual(db.execute('SELECT count(*) FROM financial_state').fetchone(),(1,));db.execute('ROLLBACK');db.close()
 def test_wrong_account_inception_and_second_funding_are_refused(self):
  for values in[{'accountId':'poe-pilot-TEST_ONLY'},{'inceptionAt':m.INCEPTION+1},{'initialMicroUsd':'2000000000'}]:
   db,state=self.fixture();self.change(db,state,**values)
   with self.assertRaisesRegex(m.Refused,'EXACT_ORIGINAL_ACCOUNT_REQUIRED'):m.audit_snapshot(db)
   db.close()
 def test_unlinked_or_missing_financial_journal_is_refused(self):
  db,state=self.fixture();self.change(db,state,revision=1);db.execute('INSERT INTO actions VALUES(?)',('a',));db.execute('INSERT INTO journal VALUES(2,?)',('a',))
  with self.assertRaisesRegex(m.Refused,'FINANCIAL_JOURNAL_RANGE_MISMATCH'):m.audit_snapshot(db)
  db.close()
 def test_reservations_and_initial_price_arithmetic_are_not_assumed(self):
  db,state=self.fixture();self.change(db,state,pending={'TEST_ONLY':{'reserved':'10000000001'}})
  with self.assertRaisesRegex(m.Refused,'RESERVATIONS_EXCEED_CASH'):m.audit_snapshot(db)
  db.close();db,state=self.fixture();self.change(db,state,roundingResidualMicroUsd='1')
  with self.assertRaisesRegex(m.Refused,'INCEPTION_VALUE_REWRITTEN'):m.audit_snapshot(db)
  db.close()
 def test_ro_connection_includes_committed_wal_instead_of_using_immutable_main_file(self):
  with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-original-audit-')as t:
   path=pathlib.Path(t)/'TEST_ONLY.sqlite';writer,state=self.fixture(path);writer.execute('PRAGMA journal_mode=WAL');self.change(writer,state,revision=1);writer.execute('INSERT INTO actions VALUES(?)',('a',));writer.execute('INSERT INTO journal VALUES(1,?)',('a',));self.assertTrue(path.with_name(path.name+'-wal').exists());reader=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,isolation_level=None);r=m.audit_snapshot(reader);self.assertEqual(r['revision'],1);self.assertEqual(r['tableCounts']['journal'],2);reader.close();writer.close()
if __name__=='__main__':unittest.main()
