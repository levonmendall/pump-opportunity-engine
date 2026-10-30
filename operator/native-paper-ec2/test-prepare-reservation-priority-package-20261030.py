#!/usr/bin/env python3
"""Offline package-preparation guards; no bundle, service or financial access."""
import importlib.util,pathlib,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('prepare-reservation-priority-package-20261030.py');s=importlib.util.spec_from_file_location('inert_provider_package',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Guards(unittest.TestCase):
 def test_missing_final_source_pins_fail_before_bundle_or_output_access(self):
  names=['COMMIT','BUNDLE_SHA','METADATA_SHA','CONFIGURATION']
  for missing in names:
   pins={name:None if name==missing else('a'*40 if name=='COMMIT'else'b'*64)for name in names}
   with self.subTest(missing=missing),patch.multiple(m,**pins),patch.object(m.sys,'argv',['prepare','NONEXISTENT_BUNDLE']),patch.object(m.pathlib.Path,'resolve',side_effect=AssertionError('Bundle must not be read before final pins'))as read:
    with self.assertRaisesRegex(AssertionError,'Final independently reviewed source'):m.main()
    read.assert_not_called()
 def test_fixed_prior_package_and_separate_future_namespace(self):
  self.assertEqual(m.OLD.parts[-2:],('adaptive-followthrough-20261030','upgrade-package-final'));self.assertEqual(m.OUTPUT.name,'upgrade-package-final');self.assertNotEqual(m.OLD,m.OUTPUT);self.assertNotIn('upgrade-package-owner-reset',str(m.OLD))
 def test_final_target_remains_inert_and_current69_package_is_preserved(self):
  self.assertEqual(m.COMMIT,'a1c16c7510ddcc09aa6a9962a70d24ea94b8a12a');self.assertEqual(m.BUNDLE_SHA,'d7c1bde2a08d1e805302671639c8d2a56223e0a52470035443c6880fdbe80bce')
  self.assertEqual(m.OUTPUT.parts[-2:],('reservation-priority-20261030','upgrade-package-final'));self.assertEqual(m.sha((m.OLD/'service.json').read_bytes()),'37dca9aa8d2accf83e3970d8c991d9212b6e23bea5ab9f233b4fcc0ca721558a')
if __name__=='__main__':unittest.main()
