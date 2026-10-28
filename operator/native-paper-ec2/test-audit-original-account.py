#!/usr/bin/env python3
import importlib.util,json,pathlib,sqlite3,tempfile,unittest
p=pathlib.Path(__file__).with_name('audit-original-account.py');s=importlib.util.spec_from_file_location('audit_original',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def fixture(self,path=':memory:'):
  db=sqlite3.connect(path,isolation_level=None);db.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT);CREATE TABLE actions(id TEXT PRIMARY KEY);CREATE TABLE journal(revision INTEGER,action_id TEXT);CREATE TABLE metadata(key TEXT,value TEXT);')
  state={'schemaVersion':1,'accountId':m.ACCOUNT,'mode':'PAPER','inceptionAt':m.INCEPTION,'initialMicroUsd':'1000000000','revision':0,'positions':{},'pending':{},'lockedDeposits':{},'lamports':'10000000000','inceptionPrice':{'at':m.INCEPTION-1000,'microUsdPerSol':'100000000'},'roundingResidualMicroUsd':'0','controls':{'entriesEnabled':False,'stopRequested':False,'changedAt':m.INCEPTION,'readinessVersion':None,'reason':'SECRET_SENTINEL'},'daily':{'day':'2026-10-26','paused':True,'lossPaused':False,'reconciledAt':0},'realizedLamports':'0','executionCosts':'0','gasReserve':'1000000'}
  db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps(state),));db.execute('INSERT INTO journal VALUES(0,NULL)');db.execute('INSERT INTO metadata VALUES(?,?)',('PRIVATE_METADATA','SECRET_SENTINEL'));return db,state
 def change(self,db,state,**updates):state.update(updates);db.execute('UPDATE financial_state SET body=?',(json.dumps(state),))
 def test_read_only_snapshot_checks_original_inception_and_preserves_all_rows(self):
  db,state=self.fixture();before=db.total_changes;r=m.audit_snapshot(db);self.assertEqual(r['revision'],0);self.assertEqual(r['cashLamports'],'10000000000');self.assertEqual(db.total_changes,before);self.assertNotIn('SECRET_SENTINEL',json.dumps(r));self.assertTrue(r['flatAtSnapshot']);self.assertEqual(db.execute('SELECT value FROM metadata').fetchone(),('SECRET_SENTINEL',))
  with self.assertRaises(sqlite3.OperationalError):db.execute('DELETE FROM financial_state')
  db.close()
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
