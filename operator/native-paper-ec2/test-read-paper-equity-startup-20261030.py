import importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('read-paper-equity-startup-20261030.py');spec=importlib.util.spec_from_file_location('startup_reader',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_all_uppercase_launcher_codes_and_no_raw_unknown_text(self):
  self.assertEqual(m.source_line(b'NATIVE_PAPER_PRIOR_SETTLEMENT_BINDING')['reasonCode'],'NATIVE_PAPER_PRIOR_SETTLEMENT_BINDING')
  for raw in [b'https://private.invalid/?secret=TOKEN',b'OWNER_NEW_UNKNOWN_CODE',b'Cannot read properties of undefined',b'\x1b[31msecret token mint\x1b[0m']:
   row=m.source_line(raw);self.assertIsNone(row['reasonCode']);self.assertEqual(row['lineSha256'],m.digest(raw));self.assertNotIn(raw.decode(errors='replace'),json.dumps(row))
 def test_generated_research_component_and_ledger_catalogue(self):
  for code in ['RESEARCH_BASELINE_CHECKPOINT_SOURCE_HANDOFF','RESEARCH_BASELINE_CHAIN_CONFLICT','RESEARCH_BASELINE_INVALID_CLOCK','COMPONENT_STORAGE_UNAVAILABLE']:
   self.assertEqual(m.source_line(code.encode())['reasonCode'],code)
  message='operating cost metadata missing from recorded history; recovery required';row=m.source_line(message.encode());self.assertEqual(row['staticMessage'],message);self.assertTrue(row['reasonCode'].startswith('SOURCE_LITERAL_'))
 def test_compact_summary_is_last_bounded_static_reason(self):
  facts=[m.source_line(b'RESEARCH_BASELINE_CHECKPOINT_SOURCE_HANDOFF'),m.source_line(b'PRIVATE https://unknown.invalid/secret')];result={'binding':{'financialPrefixVerified':True},'health':{'sourcePid':None,'resource':{'healthy':True}},'logs':[{'available':True,'file':'source-1.log','mtimeNs':1,'facts':facts}]};raw=m.compact_summary(result);self.assertLessEqual(len(raw.encode()),2048);self.assertIn('RESEARCH_BASELINE_CHECKPOINT_SOURCE_HANDOFF',raw);self.assertNotIn('https:',raw)
 def test_malformed_health_resource_fails_closed(self):
  value={'kind':'poe-persistent-paper-supervisor-health','accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'source':m.SOURCE,'resource':'PRIVATE'}
  with patch.object(m,'secure_read',return_value=(json.dumps(value).encode(),{})):
   self.assertFalse(m.health_view()['available'])
 def test_exact_static_classification(self):
  self.assertEqual(m.source_line(b'Error: NATIVE_PAPER_PRIVATE_BOUNDED_FILE')['reasonCode'],'NATIVE_PAPER_PRIVATE_BOUNDED_FILE');self.assertEqual(m.source_line(b'EACCES: hidden path and credentials')['reasonCode'],'EACCES')
 def test_only_exact_bundle_location(self):
  row=m.source_line((' at '+str(m.NATIVE)+':123:45) https://private.invalid').encode());self.assertEqual(row['locations'],[{'file':'native-paper.mjs','line':123,'column':45}]);self.assertNotIn('https:',json.dumps(row));self.assertEqual(m.source_line(b' at /tmp/secret.js:23:4)')['locations'],[])
 def test_supervisor_schema_drops_private_unknown_fields(self):
  value={'at':123,'kind':'source-transport-process-settlement','data':{'settled':True,'reason':'source exited; retained-obligation restart','secret':'PRIVATE'}};row=m.supervisor_line(json.dumps(value).encode());self.assertEqual(row['reasonCode'],'SOURCE_EXITED');self.assertNotIn('PRIVATE',json.dumps(row));self.assertIsNone(m.supervisor_line(b'{bad'));self.assertIsNone(m.supervisor_line(b'{"at":1,"kind":"UNKNOWN","data":{}}'))
 def test_secure_read_metadata_symlink_hardlink_mode_and_tail(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'fixed';p.write_bytes(b'abcdef');p.chmod(0o600);raw,meta=m.secure_read(p,10,os.getuid(),0o600,tail=3);self.assertEqual(raw,b'def');self.assertEqual(meta['tailOffset'],3)
   for bound in [5]:
    with self.assertRaises(m.Refused):m.secure_read(p,bound,os.getuid(),0o600)
   p.chmod(0o644)
   with self.assertRaises(m.Refused):m.secure_read(p,10,os.getuid(),0o600)
   p.chmod(0o600);link=pathlib.Path(d)/'link';link.symlink_to(p)
   with self.assertRaises(m.Refused):m.secure_read(link,10,os.getuid(),0o600)
   link.unlink();os.link(p,link)
   with self.assertRaises(m.Refused):m.secure_read(p,10,os.getuid(),0o600)
 def test_identity_requires_exact_root_receipt_and_target_bytes(self):
  verification={'source':m.SOURCE,'configurationSha256':m.CONFIG,'financialManagementStopped':False,'financialDatabaseWrites':0,'backupRestored':False,'financialVerification':{'journalAndActionPrefixPreserved':True},'errors':['NEW_ORIGINAL_PUBLIC_STATUS_NOT_VERIFIED_WITHIN_30_SECONDS']};receipt={'kind':'POE_ORIGINAL_FORWARD_UPGRADE_RESULT','accountId':m.ACCOUNT,'inceptionAt':'2026-10-26T22:07:36.212Z','source':m.SOURCE,'phase':'new-source-retained-post-start-verification-incomplete','verification':verification};manifest=json.dumps({'source':m.SOURCE,'configurationSha256':m.CONFIG}).encode();native=b'x'*5392932
  def read(p,*a,**k):return (manifest if p==m.MANIFEST else native if p==m.NATIVE else json.dumps(receipt).encode()),{}
  real=m.digest
  def digest(raw):return m.MANIFEST_SHA if raw is manifest else m.SOURCE['sha256'] if raw is native else real(raw)
  with patch.object(m,'secure_read',side_effect=read),patch.object(m,'digest',side_effect=digest):
   self.assertTrue(m.bound_identity()['financialPrefixVerified']);self.assertTrue(m.bound_identity()['postcheckPublicTimeout']);receipt['source']={'commit':'bad','sha256':'bad'}
   with self.assertRaises(m.Refused):m.bound_identity()
 def test_log_retains_bounded_facts_and_no_raw_url(self):
  raw=(b'https://private.invalid/secret\n'*300)+b'NATIVE_PAPER_STAGE\n'
  with patch.object(m,'secure_read',return_value=(raw,{'bytes':len(raw),'readBytes':len(raw),'tailOffset':1,'mtimeNs':1,'readSha256':m.digest(raw)})):
   v=m.log_view(pathlib.Path('/fixed/source-0.log'),'source');self.assertEqual(len(v['facts']),16);self.assertEqual(v['facts'][-1]['reasonCode'],'NATIVE_PAPER_STAGE');self.assertNotIn('https:',json.dumps(v))
 def test_missing_log_is_unknown_not_empty_success(self):
  with patch.object(m,'secure_read',side_effect=PermissionError('secret path')):
   v=m.log_view(pathlib.Path('/fixed/source-0.log'),'source');self.assertFalse(v['available']);self.assertNotIn('secret',json.dumps(v))
 def test_collector_fixed_paths_and_never_reads_database(self):
  with patch.object(m,'bound_identity',return_value={}),patch.object(m,'directory_guard'),patch.object(m,'health_view',return_value={}),patch.object(m,'log_view',return_value={})as logs:
   result=m.collect();paths=[str(x.args[0])for x in logs.call_args_list];self.assertEqual(len(paths),8);self.assertEqual(paths,[str(m.DIAGNOSTICS/(p+'-'+str(i)+'.log'))for p in['source','supervisor']for i in range(4)]);self.assertFalse(result['financialDatabaseOpened']);self.assertEqual(result['serviceControlOperations'],0)
if __name__=='__main__':unittest.main()
