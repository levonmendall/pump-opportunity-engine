#!/usr/bin/env python3
import gzip,hashlib,importlib.util,json,os,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('stage',pathlib.Path(__file__).with_name('stage-original-service-package.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_preserves_financial_disk_headroom_before_creating_stage(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'not-created';old=m.available_bytes;m.available_bytes=lambda _:512*m.MIB
   try:
    with self.assertRaisesRegex(m.Guard,'FINANCIAL_DISK_HEADROOM'):m.stage({'index.json':b'new-bytes'},p,os.getuid())
    self.assertFalse(p.exists())
   finally:m.available_bytes=old
 def test_transport_checks_compressed_raw_and_indexed_hashes_before_staging(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d);data={n:b'offline-code-and-config'for n in m.LIMITS if n!='index.json'};h=lambda b:hashlib.sha256(b).hexdigest();source={'commit':'a'*40,'sha256':h(data['native-paper.mjs'])}
   index={'schemaVersion':1,'kind':'poe-original-cutover-package-v1','sourceCommit':source['commit'],'files':[{'file':n,'bytes':len(b),'sha256':h(b)}for n,b in data.items()]};data['index.json']=json.dumps(index).encode();rows=[]
   for n,b in data.items():
    packed=gzip.compress(b,mtime=0);(p/(n+'.gz')).write_bytes(packed);rows.append({'file':n,'bytes':len(b),'sha256':h(b),'packedFile':n+'.gz','packedBytes':len(packed),'packedSha256':h(packed)})
   transport={'schemaVersion':1,'kind':'poe-original-upgrade-transport-v1','source':source,'indexSha256':h(data['index.json']),'files':rows};raw=json.dumps(transport).encode();(p/'transport.json').write_bytes(raw)
   got,bodies=m.prepare(p,h(raw),os.getuid());self.assertEqual(got,transport);self.assertEqual(bodies,data)
   (p/'native-paper.mjs.gz').write_bytes(b'tampered')
   with self.assertRaisesRegex(m.Guard,'PACKED_SOURCE_HASH'):m.prepare(p,h(raw),os.getuid())
 def test_stages_exact_bytes_idempotently_without_overwriting(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'new';data={'index.json':b'index','input.json':b'approved'};self.assertEqual(m.stage(data,p,os.getuid()),list(data));self.assertEqual(m.stage(data,p,os.getuid()),[])
   (p/'input.json').write_bytes(b'changed')
   with self.assertRaisesRegex(m.Guard,'EXISTING_STAGE_BYTES'):m.stage(data,p,os.getuid())
   self.assertEqual((p/'input.json').read_bytes(),b'changed')
 def test_rejects_unrelated_files_and_keeps_them(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'new';p.mkdir(mode=0o700);(p/'retained').write_bytes(b'keep')
   with self.assertRaisesRegex(m.Guard,'UNRELATED_STAGE_FILES'):m.stage({'index.json':b'index'},p,os.getuid())
   self.assertEqual((p/'retained').read_bytes(),b'keep')
 def test_symlink_does_not_replace_or_read_target(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);p=root/'new';p.mkdir(mode=0o700);target=root/'retained';target.write_bytes(b'keep');(p/'index.json').symlink_to(target)
   with self.assertRaises(OSError):m.stage({'index.json':b'index'},p,os.getuid())
   self.assertEqual(target.read_bytes(),b'keep')
if __name__=='__main__':unittest.main()
