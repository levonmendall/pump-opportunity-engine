#!/usr/bin/env python3
"""Offline package-preparation guards; no bundle, service or financial access."""
import importlib.util,pathlib,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('prepare-adaptive-followthrough-package-20261030.py');s=importlib.util.spec_from_file_location('inert_provider_package',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Guards(unittest.TestCase):
 def test_missing_final_source_pins_fail_before_bundle_or_output_access(self):
  names=['COMMIT','BUNDLE_SHA','METADATA_SHA','CONFIGURATION']
  for missing in names:
   pins={name:None if name==missing else('a'*40 if name=='COMMIT'else'b'*64)for name in names}
   with self.subTest(missing=missing),patch.multiple(m,**pins),patch.object(m.sys,'argv',['prepare','NONEXISTENT_BUNDLE']),patch.object(m.pathlib.Path,'resolve',side_effect=AssertionError('Bundle must not be read before final pins'))as read:
    with self.assertRaisesRegex(AssertionError,'Final independently reviewed source'):m.main()
    read.assert_not_called()
 def test_fixed_prior_package_and_separate_future_namespace(self):
  self.assertEqual(m.OLD.parts[-2:],('provider-protection-recovery-20261030','upgrade-package-final'));self.assertEqual(m.OUTPUT.name,'upgrade-package-final');self.assertNotEqual(m.OLD,m.OUTPUT);self.assertNotIn('upgrade-package-owner-reset',str(m.OLD))
 def test_final_target_is_source_pinned_and_prior567_package_is_preserved(self):
  self.assertEqual(m.COMMIT,'69aa1ef214a8c79524a25a8aca79299ccaad93dc');self.assertEqual(m.BUNDLE_SHA,'bbdd0515089a823600c158c668e6a3f76a0a92525422d63677989d963ae43480')
  self.assertEqual(m.OUTPUT.parts[-2:],('adaptive-followthrough-20261030','upgrade-package-final'));self.assertEqual(m.sha((m.OLD/'service.json').read_bytes()),'3cf20e5a6e8b97e0f5a5e570e5ca96ae4827bf6e62d9ff5529c74cf9c204817c')
if __name__=='__main__':unittest.main()
