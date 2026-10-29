#!/usr/bin/env python3
"""Offline temporary lock/file fixtures only; never calls fixed host main()."""
import fcntl,importlib.util,os,pathlib,stat,tempfile,unittest
spec=importlib.util.spec_from_file_location('prepare',pathlib.Path(__file__).with_name('prepare-original-accounting.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='poe-OFFLINE-accounting-prep-');self.root=pathlib.Path(self.tmp.name);self.paths=[]
  for name in ['financial-owner.lock','market-rpc.lock','market-watch.lock']:
   p=self.root/name;p.write_bytes(b'');p.chmod(0o600);self.paths.append(p)
 def tearDown(self):self.tmp.cleanup()
 def test_acquires_only_existing_readonly_exclusive_leases_and_releases(self):
  before=[p.stat().st_mtime_ns for p in self.paths];fds=m.lock_existing(self.paths,os.getuid())
  try:
   for fd,p in zip(fds,self.paths):
    self.assertEqual(fcntl.fcntl(fd,fcntl.F_GETFL)&os.O_ACCMODE,os.O_RDONLY)
    competing=os.open(p,os.O_RDONLY)
    try:
     with self.assertRaises(BlockingIOError):fcntl.flock(competing,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally:os.close(competing)
   self.assertEqual([p.stat().st_mtime_ns for p in self.paths],before)
  finally:
   for fd in fds:os.close(fd)
  next_fds=m.lock_existing(self.paths,os.getuid())
  for fd in next_fds:os.close(fd)
 def test_missing_lock_is_not_created_and_prior_lease_is_released(self):
  self.paths[-1].unlink()
  with self.assertRaises(FileNotFoundError):m.lock_existing(self.paths,os.getuid())
  self.assertFalse(self.paths[-1].exists())
  fd=os.open(self.paths[0],os.O_RDONLY)
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  finally:os.close(fd)
 def test_existing_active_owner_blocks_without_replacing_its_lock(self):
  fd=os.open(self.paths[1],os.O_RDONLY);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);inode=self.paths[1].stat().st_ino
  try:
   with self.assertRaisesRegex(m.Guard,'EXISTING_OWNER_STILL_ACTIVE'):m.lock_existing(self.paths,os.getuid())
   self.assertEqual(self.paths[1].stat().st_ino,inode)
  finally:os.close(fd)
 def test_symlinked_or_public_lock_refused_without_touching_target(self):
  target=self.root/'original';target.write_bytes(b'KEEP');self.paths[2].unlink();self.paths[2].symlink_to(target)
  with self.assertRaises(OSError):m.lock_existing(self.paths,os.getuid())
  self.assertEqual(target.read_bytes(),b'KEEP');self.paths[2].unlink();self.paths[2].write_bytes(b'');self.paths[2].chmod(0o644)
  with self.assertRaisesRegex(m.Guard,'EXISTING_PRIVATE_LEASE_REQUIRED'):m.lock_existing(self.paths,os.getuid())
if __name__=='__main__':unittest.main()
