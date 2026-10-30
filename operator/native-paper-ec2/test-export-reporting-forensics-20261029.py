#!/usr/bin/env python3
"""Disposable offline fixtures only; never opens production paths or drops UID."""
import contextlib,hashlib,importlib.util,io,json,os,pathlib,sqlite3,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('export-reporting-forensics-20261029.py')
spec=importlib.util.spec_from_file_location('forensics',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
LEAK='NEVER_EXPORT_PROVIDER_WALLET_SECRET_OR_FULL_PAYLOAD'
MINT='AcBX8a8eHbzQghgqMfqXeAz4kQSRbtHWKUSGXvwMpump'
class Fixtures(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='poe-OFFLINE-forensic-');self.root=pathlib.Path(self.tmp.name);self.uid=os.getuid();self.at=m.WINDOWS[0][0]+1000
 def tearDown(self):self.tmp.cleanup()
 def db(self,identity=True):
  p=self.root/'fixture.sqlite';c=sqlite3.connect(p);os.chmod(p,0o600);c.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT);CREATE TABLE journal(revision INTEGER PRIMARY KEY,action_id TEXT UNIQUE,at INTEGER,kind TEXT,detail TEXT);CREATE TABLE actions(id TEXT PRIMARY KEY,payload_hash TEXT,result TEXT);')
  c.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps({'accountId':m.ACCOUNT if identity else 'WRONG','inceptionAt':m.INCEPTION,'mode':'PAPER','revision':7,'lamports':LEAK}),));c.commit();return p,c
 def add(self,c,revision,kind,detail,result=None,at=None,action=None):
  key=action or'fixture:'+str(revision);c.execute('INSERT INTO journal VALUES(?,?,?,?,?)',(revision,key,self.at if at is None else at,kind,json.dumps(detail)));c.execute('INSERT INTO actions VALUES(?,?,?)',(key,'0'*64,json.dumps(result or{})));c.commit()
 def logs(self):p=self.root/'diagnostics';p.mkdir(mode=0o700);return p
 def write(self,p,value):p.write_bytes(value if type(value)is bytes else(json.dumps(value)+'\n').encode());p.chmod(0o600)
 def ack(self):return {'published':True,'accountId':m.ACCOUNT,'inceptionAt':'2026-10-26T22:07:36.212Z','release':'a'*40,'sourceAtMs':self.at-200,'acknowledgedAtMs':self.at,'result':'accepted','wallet':LEAK,'rawSourceSha256':LEAK}
 def test_readonly_journal_sanitizes_and_preserves_idle_database(self):
  p,c=self.db();order={'input':{'id':'order1','mint':MINT,'side':'buy','decidedAt':self.at,'executeAt':self.at+500,'expiresAt':self.at+30000,'maxSpend':LEAK},'price':{'at':self.at-500,'microUsdPerSol':'102350000','source':LEAK},'marks':{MINT:{'at':self.at-100,'netLamports':LEAK}}}
  self.add(c,1,'order',order,{'reserved':LEAK},action='order:order1');self.add(c,2,'attempt',{'orderId':'order1','quote':None,'price':order['price'],'marks':order['marks']},{'status':'failed','reason':'missing/stale first-attempt state; gas charged; no retry','at':self.at})
  self.add(c,3,'pause',{'reason':LEAK},{'paused':True});self.add(c,4,'reconcile',{'price':order['price'],'marks':{}},{'paused':False,'equityMicroUsd':LEAK});self.add(c,5,'resume',{'price':order['price'],'readiness':{'marketAt':self.at-10,'recoveryComplete':True,'candidateWindowsReady':True,'budgetAvailable':True,'evidence':LEAK}},{'enabled':True,'reason':'explicit verified runtime readiness'})
  c.close();before=p.read_bytes();r=m._journal(p,self.uid);self.assertTrue(r['available']);self.assertEqual(r['totalChanges'],0);self.assertTrue(r['queryOnly']);self.assertFalse(r['trustedSchema']);self.assertEqual(len(r['facts']),5);self.assertEqual(p.read_bytes(),before);raw=json.dumps(r);self.assertNotIn(LEAK,raw);self.assertNotIn('maxSpend',raw);self.assertNotIn('equityMicroUsd',raw);self.assertEqual(r['facts'][1]['order']['mint'],MINT);self.assertFalse(r['facts'][1]['attempt']['quotePresent']);self.assertEqual(r['facts'][0]['price']['ageMs'],500);self.assertEqual(r['facts'][2]['reason'],'UNRECOGNIZED_REASON_REDACTED')
 def test_windows_include_second_attempt_and_exclude_unrelated_history(self):
  p,c=self.db();self.add(c,1,'pause',{},at=m.WINDOWS[0][0]-1);self.add(c,2,'attempt',{'orderId':'none'},{'status':'failed','reason':'USD valuation unavailable; entry canceled before attempt'},at=m.WINDOWS[1][0]+1);self.add(c,3,'pause',{},at=m.WINDOWS[1][1]);c.close();r=m._journal(p,self.uid);self.assertEqual([x['revision']for x in r['facts']],[2])
 def test_third_window_includes_exact_entry_flap_and_keeps_original_intervals(self):
  self.assertEqual(m.WINDOWS[:2],((1793286840000,1793287560000),(1793292720000,1793292900000)))
  self.assertEqual(m.WINDOWS[2],(1793295960000,1793296140000));p,c=self.db();self.add(c,1,'reconcile',{'price':{'at':m.ENTRY_SNAPSHOTS[0][1]-2825,'microUsdPerSol':'102350000'},'marks':{}},{'paused':False},at=m.ENTRY_SNAPSHOTS[0][2]);c.close();r=m._journal(p,self.uid);self.assertEqual(len(r['facts']),1);self.assertEqual(r['facts'][0]['at'],1793296000794)
 def test_anchors_distinguish_raw_controls_from_aging_reconciliation_and_current_state(self):
  p,c=self.db();first,second=m.ENTRY_SNAPSHOTS;self.add(c,1,'resume',{'readiness':{'evidence':LEAK}},{'enabled':True},at=first[1]-10000)
  self.add(c,2,'reconcile',{'price':{'at':first[1]-2825,'microUsdPerSol':'102350000'},'marks':{}},{'paused':False},at=first[2]);self.add(c,3,'reconcile',{'price':{'at':second[1]-3249,'microUsdPerSol':'102350000'},'marks':{}},{'paused':False},at=second[2])
  state=json.loads(c.execute('SELECT body FROM financial_state').fetchone()[0]);state['controls']={'entriesEnabled':False,'stopRequested':True,'reason':LEAK};c.execute('UPDATE financial_state SET body=?',(json.dumps(state),));c.commit();c.close();r=m._journal(p,self.uid);a,b=r['entryControlAnchors'];self.assertTrue(a['available']);self.assertTrue(b['available']);self.assertEqual(a['controls'],b['controls']);self.assertTrue(a['controls']['entriesEnabled']);self.assertFalse(a['controls']['stopRequested']);self.assertEqual([x['latestReconciliation']['ageAtSourceMs']for x in(a,b)],[54,5050]);self.assertTrue(all(x['latestReconciliation']['matchesSnapshotTimestamp']for x in(a,b)));self.assertFalse(a['sourceSnapshotRevisionBound']);self.assertNotIn(LEAK,json.dumps(r))
 def test_real_pause_between_sources_changes_durable_control_and_preserves_stop_reset(self):
  p,c=self.db();first,second=m.ENTRY_SNAPSHOTS;self.add(c,1,'resume',{}, {'enabled':True},at=first[1]-1000);self.add(c,2,'pause',{'reason':'current financial reconciliation unavailable; exposure retained'},{'paused':True},at=first[1]+1000);c.close();a,b=m._journal(p,self.uid)['entryControlAnchors'];self.assertTrue(a['controls']['entriesEnabled']);self.assertFalse(b['controls']['entriesEnabled']);self.assertFalse(b['controls']['stopRequested']);self.assertEqual(b['entryControlSetter']['revision'],2);self.assertEqual(b['stopControlSetter']['revision'],1)
 def test_failed_resume_never_clears_safe_stop_or_pause(self):
  p,c=self.db();at=m.ENTRY_SNAPSHOTS[0][1];self.add(c,1,'safe-stop',{}, {'safeToExit':True,'state':'stopped-safe'},at=at-3000);self.add(c,2,'pause',{'reason':'operator paused new entries'},{'paused':True},at=at-2000);self.add(c,3,'resume',{}, {'enabled':False,'reason':'fresh reconciliation or next UTC-day loss reset required'},at=at-1000);c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertTrue(a['available']);self.assertFalse(a['controls']['entriesEnabled']);self.assertTrue(a['controls']['stopRequested']);self.assertEqual(a['entryControlSetter']['revision'],2);self.assertEqual(a['stopControlSetter']['revision'],1)
 def test_inception_can_establish_initial_closed_controls_without_an_actions_row(self):
  p,c=self.db();c.execute('INSERT INTO journal VALUES(0,?,?,?,?)',('inception',m.INCEPTION,'inception',json.dumps({'mode':'PAPER','price':LEAK})));c.commit();c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertTrue(a['available']);self.assertFalse(a['controls']['entriesEnabled']);self.assertFalse(a['controls']['stopRequested']);self.assertEqual(a['controls']['changedAt'],m.INCEPTION)
 def test_control_history_bounds_and_missing_action_results_stay_unknown(self):
  p,c=self.db();at=m.ENTRY_SNAPSHOTS[0][1];self.add(c,1,'resume',{}, {'enabled':True},at=at-3000);self.add(c,2,'pause',{'reason':'operator paused new entries'},{'paused':True},at=at-2000);self.add(c,3,'pause',{'reason':'operator paused new entries'},{'paused':True},at=at-1000);c.close()
  with patch.object(m,'MAX_CONTROL_ROWS',1):a=m._journal(p,self.uid)['entryControlAnchors'][0]
  self.assertFalse(a['available']);self.assertTrue(a['controlHistoryTruncated']);self.assertFalse(a['controls']['entriesEnabled']);self.assertIsNone(a['controls']['stopRequested']);c=sqlite3.connect(p);c.execute('DELETE FROM actions WHERE id=?',('fixture:3',));c.commit();c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertFalse(a['available']);self.assertEqual(a['unavailableControlRows'],1)
 def test_malformed_control_mutations_cannot_be_skipped_to_an_older_enabled_state(self):
  for kind,detail,result in [('pause',{'reason':'operator paused new entries'},{}),('safe-stop',{},{}),('resume',{},{}),('resume',{}, {'enabled':0}),('safe-stop',{}, {'safeToExit':True,'state':'management-required'})]:
   with self.subTest(kind=kind,result=result):
    p,c=self.db();self.add(c,1,'resume',{}, {'enabled':True},at=m.ENTRY_SNAPSHOTS[0][1]-2000);self.add(c,2,kind,detail,result,at=m.ENTRY_SNAPSHOTS[0][1]-1000);c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertFalse(a['available']);self.assertEqual(a['unavailableControlRows'],1);self.assertIsNone(a['controls']['entriesEnabled']);p.unlink()
 def test_same_timestamp_control_action_is_not_exact_snapshot_revision_proof(self):
  p,c=self.db();self.add(c,1,'resume',{}, {'enabled':True},at=m.ENTRY_SNAPSHOTS[0][1]);c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertFalse(a['available']);self.assertTrue(a['ambiguousAtSourceTimestamp']);self.assertTrue(a['controls']['entriesEnabled']);self.assertFalse(a['sourceSnapshotRevisionBound'])
 def test_reconciliation_mismatch_is_explicit_and_not_replaced_with_expected_time(self):
  p,c=self.db();self.add(c,1,'resume',{}, {'enabled':True},at=m.ENTRY_SNAPSHOTS[0][1]-1000);self.add(c,2,'reconcile',{'price':{'at':m.ENTRY_SNAPSHOTS[0][1]-100,'microUsdPerSol':'1'},'marks':{}},{'paused':False},at=m.ENTRY_SNAPSHOTS[0][2]-1);c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertTrue(a['available']);self.assertFalse(a['latestReconciliation']['matchesSnapshotTimestamp']);self.assertEqual(a['latestReconciliation']['ageAtSourceMs'],55)
 def test_unavailable_reconciliation_does_not_erase_independently_established_raw_controls(self):
  p,c=self.db();self.add(c,1,'resume',{}, {'enabled':True},at=m.ENTRY_SNAPSHOTS[0][1]-1000);self.add(c,2,'reconcile',{'price':{'at':m.ENTRY_SNAPSHOTS[0][1]-100,'microUsdPerSol':'1'},'marks':{}},{},at=m.ENTRY_SNAPSHOTS[0][2]);c.close();a=m._journal(p,self.uid)['entryControlAnchors'][0];self.assertTrue(a['available']);self.assertTrue(a['controls']['entriesEnabled']);self.assertFalse(a['latestReconciliation']['available']);self.assertEqual(a['unavailableControlRows'],0)
 def test_identity_oversized_state_and_deadline_fail_closed(self):
  p,c=self.db(False);c.close()
  with self.assertRaises(m.Refused):m._journal(p,self.uid)
  c=sqlite3.connect(p);c.execute('UPDATE financial_state SET body=?',('x'*(2*1024*1024+1),));c.commit();c.close()
  with self.assertRaises(m.Refused):m._journal(p,self.uid)
 def test_detail_row_and_read_deadline_bounds_are_explicit(self):
  p,c=self.db();self.add(c,1,'pause',{'reason':LEAK,'huge':'x'*m.MAX_DETAIL});c.close();r=m._journal(p,self.uid);self.assertEqual(r['unavailableRows'],1);self.assertEqual(r['facts'],[])
  with self.assertRaises((m.Refused,sqlite3.Error)):m._journal(p,self.uid,budget_seconds=0)
 def test_row_limit_and_sql_uri_readonly_are_enforced(self):
  p,c=self.db();self.add(c,1,'pause',{});self.add(c,2,'pause',{});c.close();actual=sqlite3.connect;seen=[]
  def connect(database,**kwargs):seen.append((database,kwargs));return actual(database,**kwargs)
  with patch.object(m,'MAX_ROWS',1),patch.object(m.sqlite3,'connect',connect):r=m._journal(p,self.uid)
  self.assertTrue(r['truncated']);self.assertEqual(len(r['facts']),1);self.assertTrue(seen[0][0].endswith('?mode=ro'));self.assertTrue(seen[0][1]['uri']);self.assertNotIn('immutable',seen[0][0]);self.assertLessEqual(seen[0][1]['timeout'],.025)
 def test_active_wal_reader_includes_committed_wal_and_releases_transaction(self):
  p,c=self.db();c.execute('PRAGMA journal_mode=WAL');self.add(c,1,'reconcile',{'price':{'at':self.at,'microUsdPerSol':'1'},'marks':{}});wal=pathlib.Path(str(p)+'-wal');shm=pathlib.Path(str(p)+'-shm');wal.chmod(0o600);shm.chmod(0o600);before=wal.read_bytes();r=m._journal(p,self.uid);self.assertEqual(len(r['facts']),1);self.assertEqual(wal.read_bytes(),before);self.add(c,2,'pause',{});c.close()
 def test_foreign_wal_sidecar_is_rejected_before_sqlite_open(self):
  p,c=self.db();c.close();outside=self.root/'outside';outside.write_text('DO_NOT_OPEN');os.symlink(outside,str(p)+'-wal')
  with patch.object(m.sqlite3,'connect',side_effect=AssertionError('foreign WAL must be rejected before SQLite opens')):
   with self.assertRaises(m.Refused):m._journal(p,self.uid)
  self.assertEqual(outside.read_text(),'DO_NOT_OPEN')
 def test_symlink_hardlink_and_inode_replacement_are_refused(self):
  p,c=self.db();c.close();link=self.root/'linked';os.symlink(p,link)
  with self.assertRaises(m.Refused):m._journal(link,self.uid)
  hard=self.root/'hard';os.link(p,hard)
  with self.assertRaises(m.Refused):m._journal(p,self.uid)
 def test_only_strict_diagnostic_scalars_are_exported(self):
  d=self.logs();self.write(d/'publisher-0.log',self.ack());self.write(d/'source-0.log',{'at':self.at,'financial':{'secret':LEAK},**self.ack()});self.write(d/'supervisor-0.log',{'at':self.at,'kind':'rolling-resource-sample','data':{'availableMemoryBytes':123,'resource':{'healthy':False,'secret':LEAK},'processes':{'source':{'rssBytes':456,'argv':LEAK}},'provider':LEAK}})
  r=m._logs(d,self.uid);self.assertEqual(len(r['facts']),2);self.assertNotIn(LEAK,json.dumps(r));self.assertEqual(r['facts'][1]['resource'],{'healthy':False});self.assertEqual(r['facts'][1]['processes']['source'],{'rssBytes':456})
 def test_oversized_partial_line_cannot_manufacture_embedded_ack(self):
  d=self.logs();ack=json.dumps(self.ack()).encode();self.write(d/'publisher-0.log',b'x'*(m.MAX_LINE+100)+ack+b'\n'+ack+b'\n');r=m._logs(d,self.uid);self.assertEqual(len(r['facts']),1);self.assertGreater(r['files'][4]['oversizedFragments'],0)
 def test_log_bound_permission_and_missingness_do_not_claim_completeness(self):
  d=self.logs();self.write(d/'source-0.log',b'x'*(m.MAX_LOG+1));self.write(d/'publisher-0.log',b'not-json\npartial');r=m._logs(d,self.uid);self.assertFalse(r['files'][0]['available']);self.assertEqual(r['files'][4]['malformedLines'],1);self.assertGreater(r['files'][4]['trailingFragmentBytes'],0);self.assertIn('not proof',r['meaning'])
 def test_publication_is_atomic_sanitized_and_rejects_symlink_target(self):
  d=self.root/'public';d.mkdir(mode=0o755);out=d/'report.json';r=m._publish(out,{'facts':[]},self.uid);self.assertEqual(out.stat().st_mode&0o777,0o644);self.assertEqual(r['sha256'],hashlib.sha256(out.read_bytes()).hexdigest());out.unlink();target=self.root/'untouched';target.write_text('ORIGINAL');out.symlink_to(target)
  with self.assertRaises(m.Refused):m._publish(out,{},self.uid)
  self.assertEqual(target.read_text(),'ORIGINAL')
 def test_main_drops_before_any_private_read_and_exposes_no_path_arguments(self):
  dropped=[]
  def drop():dropped.append(True)
  def private(*args):self.assertEqual(dropped,[True]);return {'available':False}
  with patch.object(m.sys,'argv',['fixed-driver']),patch.object(m,'drop_original_identity',drop),patch.object(m,'_journal',private),patch.object(m,'_logs',private),patch.object(m,'_publish',lambda *_:{'path':str(m.OUTPUT),'bytes':1,'sha256':'a'*64}),contextlib.redirect_stdout(io.StringIO()):m.main()
  with patch.object(m.sys,'argv',['fixed-driver','--other-path']),patch.object(m,'drop_original_identity',drop):
   with self.assertRaises(m.Refused):m.main()
 def test_permanent_drop_clears_fds_groups_and_all_saved_ids(self):
  events=[];ids={'u':(0,0,0),'g':(0,0,0)}
  def gid(*v):events.append('gid');ids['g']=v
  def uid(*v):events.append('uid');ids['u']=v
  with patch.object(m.os,'geteuid',lambda:ids['u'][1]),patch.object(m.os,'getresuid',lambda:ids['u']),patch.object(m.os,'getresgid',lambda:ids['g']),patch.object(m.os,'closerange',lambda *_:events.append('close-fds')),patch.object(m.os,'setgroups',lambda _:events.append('groups')),patch.object(m.os,'setresgid',gid),patch.object(m.os,'setresuid',uid):m.drop_original_identity()
  self.assertEqual(events,['close-fds','groups','gid','uid']);self.assertEqual(ids,{'u':(988,988,988),'g':(982,982,982)})
if __name__=='__main__':unittest.main(verbosity=2)
