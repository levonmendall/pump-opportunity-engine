#!/usr/bin/env python3
"""Offline package-preparation guards; no bundle, service or financial access."""
import importlib.util,pathlib,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('prepare-provider-recovery-package-20261030.py');s=importlib.util.spec_from_file_location('inert_provider_package',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Guards(unittest.TestCase):
 def test_missing_final_source_pins_fail_before_bundle_or_output_access(self):
  names=['COMMIT','BUNDLE_SHA','METADATA_SHA','CONFIGURATION']
  for missing in names:
   pins={name:None if name==missing else('a'*40 if name=='COMMIT'else'b'*64)for name in names}
   with self.subTest(missing=missing),patch.multiple(m,**pins),patch.object(m.sys,'argv',['prepare','NONEXISTENT_BUNDLE']),patch.object(m.pathlib.Path,'resolve',side_effect=AssertionError('Bundle must not be read before final pins'))as read:
    with self.assertRaisesRegex(AssertionError,'Final independently reviewed source'):m.main()
    read.assert_not_called()
 def test_fixed_prior_package_and_separate_future_namespace(self):
  self.assertEqual(m.OLD.name,'upgrade-package-93bf0b5');self.assertEqual(m.OUTPUT.name,'upgrade-package-final');self.assertNotEqual(m.OLD,m.OUTPUT);self.assertNotIn('upgrade-package-owner-reset',str(m.OLD))
if __name__=='__main__':unittest.main()
