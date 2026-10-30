"""Offline tests: exact manifest delta and recovery independent of runner files."""
import importlib.util,io,json,pathlib,stat,sys,tempfile,types,unittest
from unittest.mock import patch,MagicMock
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('reporting_repair',ROOT/'repair-original-publisher.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ORIGINAL=(ROOT/'fixture-before-service.json').read_bytes()
BODY=(ROOT/'snapshot-publisher.mjs').read_bytes()
class RepairTests(unittest.TestCase):
 def test_named_runtime_allows_different_uid_and_primary_gid(self):
  owner=types.SimpleNamespace(pw_name='poe-runtime',pw_uid=988,pw_gid=982);group=types.SimpleNamespace(gr_name='poe-runtime',gr_gid=982)
  with patch.object(m.pwd,'getpwnam',return_value=owner),patch.object(m.pwd,'getpwuid',return_value=owner),patch.object(m.grp,'getgrnam',return_value=group),patch.object(m.grp,'getgrgid',return_value=group):self.assertEqual(m.runtime_owner(),(988,982))
 def test_named_group_mismatch_and_root_owner_are_refused(self):
  for uid,gid,group_gid in[(988,982,988),(0,982,982),(988,0,0)]:
   owner=types.SimpleNamespace(pw_name='poe-runtime',pw_uid=uid,pw_gid=gid);group=types.SimpleNamespace(gr_name='poe-runtime',gr_gid=group_gid)
   with patch.object(m.pwd,'getpwnam',return_value=owner),patch.object(m.pwd,'getpwuid',return_value=owner),patch.object(m.grp,'getgrnam',return_value=group),patch.object(m.grp,'getgrgid',return_value=group):
    with self.assertRaises(m.Guard):m.runtime_owner()
 def test_live_supervisor_requires_all_actual_ids_to_match(self):
  for process_uid,gids,ok in[(988,[982]*4,True),(988,[988]*4,False),(988,[982,982,0,982],False),(0,[982]*4,False)]:
   p=MagicMock();p.__truediv__.return_value=p;p.stat.return_value=types.SimpleNamespace(st_uid=process_uid);p.open.return_value=io.BytesIO(('Name:\tpython3\nUid:\t988\t988\t988\t988\nGid:\t'+'\t'.join(map(str,gids))+'\n').encode())
   with patch.object(m.pathlib,'Path',return_value=p):
    if ok:self.assertEqual(m.runtime_process('2437741',988,982),{'uid':988,'gid':982,'pid':2437741})
    else:
     with self.assertRaises(m.Guard):m.runtime_process('2437741',988,982)
 def test_reporting_files_keep_existing_root_runtime_group_permissions(self):
  for uid,gid,mode,links,ok in[(0,982,0o640,1,True),(0,988,0o640,1,False),(988,982,0o640,1,False),(0,982,0o644,1,False),(0,982,0o640,2,False)]:
   p=types.SimpleNamespace(lstat=lambda:types.SimpleNamespace(st_uid=uid,st_gid=gid,st_mode=stat.S_IFREG|mode,st_nlink=links))
   if ok:self.assertEqual(m.reporting_permissions(p,982),(982,0o640))
   else:
    with self.assertRaises(m.Guard):m.reporting_permissions(p,982)
 def test_only_reporter_row_changes_and_rollback_is_exact(self):
  before=json.loads(ORIGINAL);after=json.loads(m.build_manifest(ORIGINAL,BODY));row=next(x for x in after['files']if x['file']=='snapshot-publisher.mjs');self.assertEqual(row,{'file':'snapshot-publisher.mjs','bytes':len(BODY),'sha256':m.NEW});after['files']=[next(x for x in before['files']if x['file']=='snapshot-publisher.mjs')if r['file']=='snapshot-publisher.mjs'else r for r in after['files']];self.assertEqual(after,before);self.assertEqual(m.sha(ORIGINAL),m.OLD_MANIFEST)
 def test_unreviewed_manifest_or_reporter_is_refused(self):
  for before,body in[(ORIGINAL+b' ',BODY),(ORIGINAL,BODY+b' '),(b'{}',BODY)]:
   with self.assertRaises(m.Guard):m.build_manifest(before,body)
 def test_retained_root_bundle_is_used_when_entire_staging_is_gone(self):
  with tempfile.TemporaryDirectory()as tmp:
   backup=pathlib.Path(tmp)/'root-backup';backup.mkdir();(backup/'after-publisher.mjs').write_bytes(BODY)
   def reader(path,uid,maximum):
    self.assertEqual(path,backup/'after-publisher.mjs');self.assertEqual(uid,0);return path.read_bytes()
   with patch.object(m,'BACKUP',backup),patch.object(m,'STAGE',pathlib.Path(tmp)/'nonexistent-stage'),patch.object(m,'read',reader):self.assertEqual(m.repair_body(),BODY)
 def test_corrupted_retained_after_image_is_not_silently_replaced(self):
  with patch.object(m.os.path,'lexists',return_value=True),patch.object(m,'read',return_value=b'CORRUPT'):
   with self.assertRaises(m.Guard):m.repair_body()
 def test_nonroot_execution_refuses_before_host_or_financial_access(self):
  with patch.object(m.os,'getuid',return_value=994),patch.object(sys,'argv',['repair.py','apply']),patch.object(m,'read',side_effect=AssertionError('must not read files')):
   with self.assertRaisesRegex(m.Guard,'EXACT_ROOT'):m.main()
if __name__=='__main__':unittest.main()
