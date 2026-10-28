#!/usr/bin/env python3
"""Disposable offline key-preparation safety checks; no real account is read."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import signal
import time
import stat
import subprocess
import tempfile
import unittest

ADMIN = pathlib.Path('/workspace/poe-ec2-ws-diagnostic-admin')
HELPER = ADMIN/'operator/native-paper-ec2/prepare-transfer.py'
spec=importlib.util.spec_from_file_location('fixed_transfer_preparation',HELPER)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NODE=shutil.which('node')

class TransferPreparationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.transfer-offline-',dir=ADMIN)
  self.home=pathlib.Path(self.temp.name);(self.home/'.local/share').mkdir(parents=True)
  self.root=self.home/'.local/share/poe-native-paper/account-transfer-20261028'
  self.owner=os.getuid();self.fd=None
 def tearDown(self):
  if self.fd is not None:os.close(self.fd)
  self.temp.cleanup()
 def open(self):
  self.fd=m.open_transfer_root(self.home,self.root,self.owner);return self.fd
 def test_identity_rejects_wrong_uid_runner_and_name(self):
  m.validate_identity(994,'mm-ec2-runner','meme-machine-ec2-admin')
  for values in [(0,'mm-ec2-runner','meme-machine-ec2-admin'),(994,'other','meme-machine-ec2-admin'),(994,'mm-ec2-runner','other')]:
   with self.assertRaises(m.GuardError):m.validate_identity(*values)
 def test_fixed_path_refused_before_directory_creation(self):
  with self.assertRaisesRegex(m.GuardError,'FIXED_TRANSFER_PATH'):m.open_transfer_root(self.home,self.root.parent/'other',self.owner)
  self.assertFalse(self.root.parent.exists())
 def test_directory_symlink_and_insecure_mode_refused_without_chmod(self):
  outside=self.home/'outside';outside.mkdir();(self.home/'.local/share/poe-native-paper').symlink_to(outside,target_is_directory=True)
  with self.assertRaises(OSError):self.open()
  self.assertEqual(list(outside.iterdir()),[])
  (self.home/'.local/share/poe-native-paper').unlink();(self.home/'.local/share/poe-native-paper').mkdir(mode=0o755);(self.home/'.local/share/poe-native-paper').chmod(0o755)
  with self.assertRaisesRegex(m.GuardError,'PRIVATE_TRANSFER_DIRECTORY'):self.open()
  self.assertEqual(stat.S_IMODE((self.home/'.local/share/poe-native-paper').stat().st_mode),0o755)
 def test_manifest_exclusive_and_conflict_never_overwrites(self):
  self.open();data=b'fixed-purpose\n'
  self.assertTrue(m.immutable_at(self.fd,m.MANIFEST,data,self.owner));before=(self.root/m.MANIFEST).stat()
  self.assertFalse(m.immutable_at(self.fd,m.MANIFEST,data,self.owner));self.assertEqual((self.root/m.MANIFEST).stat().st_mtime_ns,before.st_mtime_ns)
  with self.assertRaisesRegex(m.GuardError,'NO_OVERWRITE'):m.immutable_at(self.fd,m.MANIFEST,b'changed',self.owner)
  self.assertEqual((self.root/m.MANIFEST).read_bytes(),data)
 def test_public_symlink_and_fifo_fail_without_following_or_blocking(self):
  self.open();sentinel=self.home/'sentinel';sentinel.write_bytes(b'PRIVATE_SENTINEL_NEVER_OUTPUT')
  (self.root/m.PUBLIC).symlink_to(sentinel)
  with self.assertRaises(OSError):m.immutable_at(self.fd,m.PUBLIC,b'public',self.owner)
  self.assertEqual(sentinel.read_bytes(),b'PRIVATE_SENTINEL_NEVER_OUTPUT')
  (self.root/m.PUBLIC).unlink();os.mkfifo(self.root/m.PUBLIC,0o600)
  with self.assertRaisesRegex(m.GuardError,'PRIVATE_BOUNDED_REGULAR'):m.immutable_at(self.fd,m.PUBLIC,b'public',self.owner)
 def test_rsa3072_public_only_and_same_key_resume(self):
  self.open();first=m.run_node(NODE,self.fd,self.owner)
  private=self.root/m.PRIVATE;original=private.read_bytes();before=private.stat()
  self.assertTrue(first['generated']);self.assertEqual(stat.S_IMODE(before.st_mode),0o600)
  self.assertLessEqual(first['maximumObservedCombinedRssBytes'],m.MAX_RSS)
  self.assertEqual(set(first)-{'maximumObservedCombinedRssBytes'},{'nodeVersion','nodeAbi','platform','architecture','glibc','publicSpkiPem','publicSpkiSha256','privateFileMode','privateFileBytes','generated'})
  output=json.dumps(first).encode();self.assertNotIn(b'PRIVATE KEY',output);self.assertNotIn(original,output)
  m.immutable_at(self.fd,m.PUBLIC,first['publicSpkiPem'].encode(),self.owner)
  second=m.run_node(NODE,self.fd,self.owner)
  self.assertFalse(second['generated']);self.assertEqual(first['publicSpkiPem'],second['publicSpkiPem']);self.assertEqual(first['publicSpkiSha256'],second['publicSpkiSha256'])
  self.assertEqual(private.read_bytes(),original);self.assertEqual(private.stat().st_mtime_ns,before.st_mtime_ns)
  # A public-file conflict refuses instead of rotating/replacing the private key.
  with self.assertRaisesRegex(m.GuardError,'NO_OVERWRITE'):m.immutable_at(self.fd,m.PUBLIC,b'other public key',self.owner)
  self.assertEqual(private.read_bytes(),original)
 def test_private_symlink_rejected_without_private_stdout(self):
  self.open();outside=self.home/'sentinel';outside.write_bytes(b'SECRET_BYTES_NEVER_PUBLISHED');outside.chmod(0o600);(self.root/m.PRIVATE).symlink_to(outside)
  with self.assertRaisesRegex(m.GuardError,'LOCAL_TRANSFER_KEY_VALIDATION_FAILED'):m.run_node(NODE,self.fd,self.owner)
  self.assertEqual(outside.read_bytes(),b'SECRET_BYTES_NEVER_PUBLISHED');self.assertTrue((self.root/m.PRIVATE).is_symlink())
 def test_interrupted_private_is_retained_and_refused_not_reseeded(self):
  self.open();partial=self.root/m.PRIVATE;partial.write_bytes(b'interrupted');partial.chmod(0o600);before=partial.stat()
  with self.assertRaisesRegex(m.GuardError,'LOCAL_TRANSFER_KEY_VALIDATION_FAILED'):m.run_node(NODE,self.fd,self.owner)
  self.assertEqual(partial.read_bytes(),b'interrupted');self.assertEqual(partial.stat().st_mtime_ns,before.st_mtime_ns)
 def test_actual_cli_refuses_wrong_environment_before_mutation_and_sanitizes(self):
  completed=subprocess.run([shutil.which('python3'),'-B','-I',str(HELPER)],capture_output=True,text=True,env={'PATH':'/usr/bin:/bin','ACTUAL_RUNNER':'not-authorized','CREDENTIAL':'SECRET_TEST_VALUE'},timeout=3)
  self.assertEqual(completed.returncode,1);record=json.loads(completed.stdout)
  self.assertEqual(record['reason'],'EXPECTED_NONROOT_RUNNER_REQUIRED');self.assertFalse(record['privateKeyMaterialPublished']);self.assertEqual(completed.stderr,'')
  self.assertNotIn('SECRET_TEST_VALUE',completed.stdout);self.assertNotIn('/home/',completed.stdout)
 def test_parent_death_terminates_only_its_disposable_node_child(self):
  self.open();marker=self.home/'child-pid'
  script="require('node:fs').writeFileSync("+json.dumps(str(marker))+", String(process.pid)); setInterval(()=>{},1000)"
  code="import importlib.util,os; spec=importlib.util.spec_from_file_location('transfer',"+repr(str(HELPER))+");m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.NODE_SCRIPT="+repr(script)+";fd=os.open("+repr(str(self.root))+",os.O_RDONLY|os.O_DIRECTORY);m.run_node("+repr(NODE)+",fd,os.getuid())"
  parent=subprocess.Popen([shutil.which('python3'),'-B','-I','-c',code],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   until=time.monotonic()+3
   while not marker.exists() and time.monotonic()<until:time.sleep(.01)
   self.assertTrue(marker.exists());child=int(marker.read_text())
   self.assertEqual(int(pathlib.Path('/proc/'+str(child)+'/stat').read_text().rsplit(')',1)[1].split()[1]),parent.pid)
   parent.kill();parent.communicate(timeout=2)
   until=time.monotonic()+2
   while time.monotonic()<until:
    try:state=pathlib.Path('/proc/'+str(child)+'/stat').read_text().rsplit(')',1)[1].split()[0]
    except FileNotFoundError:state='gone'
    if state in ['gone','Z']:break
    time.sleep(.01)
   self.assertIn(state,['gone','Z'])
  finally:
   if parent.poll() is None:parent.kill();parent.communicate(timeout=2)
 def test_no_financial_or_provider_or_service_runtime_calls(self):
  source=HELPER.read_text()
  for banned in ['urllib','requests.','http.client','socket.','systemctl','ledger.json','pilot-ingest.secret','killpg','shutil.rmtree','os.unlink']:
   self.assertNotIn(banned,source)
  self.assertEqual(m.PURPOSE['accountId'],'poe-pilot-8468add6-f916-48cf-a585-6cd008a81360');self.assertEqual(m.PURPOSE['inceptionAt'],1793123773252)

if __name__=='__main__':unittest.main(verbosity=2)
