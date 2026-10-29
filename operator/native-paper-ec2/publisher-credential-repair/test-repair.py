"""Offline tests: exact manifest delta and recovery independent of runner files."""
import importlib.util,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('reporting_repair',ROOT/'repair-original-publisher.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ORIGINAL=(ROOT/'fixture-before-service.json').read_bytes()
BODY=(ROOT/'snapshot-publisher.mjs').read_bytes()
class RepairTests(unittest.TestCase):
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
