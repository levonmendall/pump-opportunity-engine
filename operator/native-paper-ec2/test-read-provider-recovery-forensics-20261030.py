#!/usr/bin/env python3
"""Disposable public-export fixtures. No actual EC2/private/ledger access."""
import copy,hashlib,importlib.util,json,os,pathlib,stat,tempfile,types,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('provider_recovery_reader_test','read-provider-recovery-forensics-20261030.py')
def encoded(v):return(json.dumps(v,separators=(',',':'))+'\n').encode()
def fixture():
 return {'schemaVersion':1,'kind':'POE_CURRENT_RUN_FORENSICS','generatedAt':m.END+1000,'accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'source':m.SOURCE,'configurationSha256':m.CONFIGURATION,'runId':m.RUN,'readerUid':988,'readerGid':982,'financialDatabaseOpened':False,'financialWrites':0,'serviceControlOperations':0,'credentialReads':0,'window':{'fromAt':m.START,'untilAtExclusive':m.END},'priorityWindows':[{'fromAt':a,'untilAtExclusive':b}for a,b in m.PRIORITY_WINDOWS],'currentStatus':{'available':True,'accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'source':m.SOURCE,'configurationSha256':m.CONFIGURATION,'runId':m.RUN,'startedAt':m.STARTED,'generatedAt':m.END+900,'running':True,'entriesEnabled':False,'status':{'code':'UNKNOWN_HASHED','sha256':'a'*64},'diagnostics':{'usage':{'localPhases':{'report-checkpoint':{'count':20,'maximumMs':443.1}},'rpc':{'chapterUsage':{'persistence':{'flushFailures':0,'pendingAgeMs':0}}}},'timing':{'maximumCompletedGapMs':12329,'protectionBreaches':2,'unavailableChecks':4},'financialReadiness':{'derivedEntryReason':{'code':'POE_ENTRY_FINANCIAL_PAUSED','sha256':'b'*64},'safety':{'recoveryComplete':True,'idle':True}}},'missingDiagnostics':[],'fileSha256':'c'*64},'diagnostics':{'files':[{'file':'diagnostic-000000000123.ndjson','available':True,'bytesRead':1234,'sha256':'d'*64,'changedDuringRead':False,'partialTrailingLine':False,'oversizedLines':0,'malformedLines':0}],'facts':[{'kind':'trader-held-evaluation','at':m.START+1000,'data':{'completedAt':m.START+1000,'quoteAt':m.START+900,'usable':True,'reason':{'code':'trailing-profit-protection','sha256':'e'*64}},'runAttribution':'time-correlated-with-verified-current-run'}],'unrecognizedEventKinds':{'f'*64:1},'matchingKindCounts':{'trader-held-evaluation':1},'samplingPolicy':'UNTRUSTED_DIAGNOSTIC_PROSE','bytesRead':1234,'scanBudgetReached':False,'factCapacityReached':False,'selectionUnknown':False,'meaning':'UNTRUSTED_DIAGNOSTIC_PROSE'},'limitations':['UNTRUSTED_DIAGNOSTIC_PROSE']}
def upgrade(raw):
 receipt={'kind':'POE_CURRENT_RUN_FORENSIC_EXPORT_RECEIPT','readerUid':988,'readerGid':982,'financialDatabaseOpened':False,'financialWrites':0,'serviceChanges':0,'credentialReads':0,'path':'/var/lib/poe-public/'+m.NAME,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'source':m.SOURCE,'runId':m.RUN}
 return {'kind':'POE_ORIGINAL_FORWARD_UPGRADE_RESULT','accountId':m.ACCOUNT,'inceptionAt':'2026-10-26T22:07:36.212Z','previousSource':m.SOURCE,'forensicPreflight':{'kind':'POE_CURRENT_RUN_FAILURE_PREFLIGHT','status':'EXPORTED','source':m.SOURCE,'runId':m.RUN,'scriptSha256':'7'*64,'childUid':988,'childGid':982,'financialDatabaseOpened':False,'financialWrites':0,'serviceChanges':0,'credentialReads':0,'receipt':receipt,'rootCopySha256':receipt['sha256']}}
class Tests(unittest.TestCase):
 def read(self,value=None,manifest=None,raw=None):
  raw=encoded(fixture()if value is None else value)if raw is None else raw;u=upgrade(raw)if manifest is None else manifest;reads=[]
  def fixed(name,maximum,uid,gid):
   reads.append((name,maximum,uid,gid));return encoded(u)if name=='upgrade-verification.json'else raw
  with patch.object(m,'SCRIPT_SHA','7'*64),patch.object(m,'fixed',side_effect=fixed):result=m.read()
  return result,reads
 def test_original_source_bound_current_run_failure_is_available(self):
  result,reads=self.read();self.assertTrue(result['available']);self.assertEqual(result['value']['currentStatus']['diagnostics']['timing']['maximumCompletedGapMs'],12329);self.assertEqual(len(reads),2);self.assertNotIn('UNTRUSTED_DIAGNOSTIC_PROSE',json.dumps(result));self.assertEqual(result['value']['diagnostics']['facts'][0]['runAttribution'],'time-correlated-with-verified-current-run')
 def test_missing_or_wrong_current_run_root_proof_never_reads_artifact(self):
  for mutate in [lambda u:u.update(previousSource={'commit':'0'*40,'sha256':'0'*64}),lambda u:u['forensicPreflight'].update(status='UNKNOWN'),lambda u:u['forensicPreflight'].update(scriptSha256='0'*64),lambda u:u['forensicPreflight'].update(runId='wrong'),lambda u:u['forensicPreflight']['receipt'].update(path='/tmp/secret')]:
   u=upgrade(encoded(fixture()));mutate(u);result,reads=self.read(manifest=u);self.assertFalse(result['available']);self.assertEqual(len(reads),1)
 def test_hash_length_and_root_copy_mismatches_are_unknown(self):
  for mutate in [lambda u:u['forensicPreflight']['receipt'].update(sha256='0'*64),lambda u:u['forensicPreflight']['receipt'].update(bytes=1),lambda u:u['forensicPreflight'].update(rootCopySha256='0'*64)]:
   u=upgrade(encoded(fixture()));mutate(u);result,_=self.read(manifest=u);self.assertFalse(result['available']);self.assertNotIn('value',result)
 def test_source_config_identity_and_window_are_exact(self):
  for key,x in [('source',{'commit':'0'*40,'sha256':'0'*64}),('configurationSha256','0'*64),('runId','other'),('accountId','other'),('window',{'fromAt':0,'untilAtExclusive':1}),('credentialReads',1)]:
   v=fixture();v[key]=x;result,_=self.read(v);self.assertFalse(result['available'])
 def test_secret_canary_unknown_keys_messages_and_types_never_leave_reader(self):
  for mutate in [lambda v:v.update(secret='SECRET_CANARY'),lambda v:v['currentStatus']['diagnostics']['usage'].update(secret='SECRET_CANARY'),lambda v:v['diagnostics']['facts'][0]['data']['reason'].update(code='SECRET_CANARY'),lambda v:v['currentStatus'].update(status='SECRET_CANARY'),lambda v:v['diagnostics']['facts'][0].update(payload='SECRET_CANARY'),lambda v:v['diagnostics']['files'][0].update(file='../../SECRET_CANARY')]:
   v=fixture();mutate(v);result,_=self.read(v);self.assertFalse(result['available']);self.assertNotIn('SECRET_CANARY',json.dumps(result))
 def test_negative_measured_deadline_slack_is_retained_without_fabrication(self):
  v=fixture();v['diagnostics']['facts'][0]['data'].update(remainingDecisionMs=-1400,nativeServiceSlackMs=-123.5);result,_=self.read(v);self.assertTrue(result['available']);self.assertEqual(result['value']['diagnostics']['facts'][0]['data']['remainingDecisionMs'],-1400)
 def test_unknown_and_rotated_diagnostics_remain_explicitly_unavailable(self):
  v=fixture();v['currentStatus']={'available':False,'reasonCode':'CURRENT_STATUS_UNAVAILABLE_OR_IDENTITY_UNKNOWN'};v['diagnostics']={'available':False,'reasonCode':'EVIDENCE_NAMESPACE_UNAVAILABLE_OR_BOUND','facts':[]};result,_=self.read(v);self.assertTrue(result['available']);self.assertFalse(result['value']['currentStatus']['available']);self.assertFalse(result['value']['diagnostics']['available'])
 def test_bounds_and_nonfinite_values_fail_closed(self):
  for mutate in [lambda v:v['diagnostics']['facts'].extend(v['diagnostics']['facts']*193),lambda v:v['currentStatus']['diagnostics']['timing'].update(maximumCompletedGapMs=float('nan')),lambda v:v['diagnostics']['unrecognizedEventKinds'].update({'0'*63:1})]:
   v=fixture();mutate(v);result,_=self.read(v);self.assertFalse(result['available'])
 def test_inert_script_pin_stops_before_public_io(self):
  with patch.object(m,'SCRIPT_SHA',None),patch.object(m,'fixed')as io:self.assertFalse(m.read()['available']);io.assert_not_called()
 def test_fixed_file_owners_modes_hardlinks_bounds_and_changes_are_enforced(self):
  raw=b'{}\n'
  def meta(**changes):return types.SimpleNamespace(**({'st_mode':stat.S_IFREG|0o644,'st_nlink':1,'st_uid':988,'st_gid':982,'st_size':len(raw),'st_dev':3,'st_ino':4,'st_mtime_ns':5,'st_ctime_ns':6}|changes))
  with patch.object(pathlib.Path,'resolve',side_effect=lambda strict=True:pathlib.Path('/var/lib/poe-public')),patch.object(m.os,'open',return_value=10)as op,patch.object(m.os,'close'),patch.object(m.os,'read',return_value=raw),patch.object(m.os,'fstat',return_value=meta()):
   self.assertEqual(m.fixed(m.NAME,131072,988,982),raw);self.assertEqual(op.call_args.args[1],m.os.O_RDONLY|m.os.O_NOFOLLOW|m.os.O_NONBLOCK)
   for change in [{'st_uid':994},{'st_gid':994},{'st_nlink':2},{'st_mode':stat.S_IFREG|0o666},{'st_size':131073}]:
    with patch.object(m.os,'fstat',return_value=meta(**change)),self.assertRaises(AssertionError):m.fixed(m.NAME,131072,988,982)
   with patch.object(m.os,'fstat',side_effect=[meta(),meta(st_mtime_ns=999)]),self.assertRaises(AssertionError):m.fixed(m.NAME,131072,988,982)
 def test_two_priority_windows_and_per_window_bounds_are_exact(self):
  for change in [lambda v:v.update(priorityWindows=[]),lambda v:v['priorityWindows'][0].update(fromAt=m.START-1),lambda v:v['diagnostics']['facts'][0].update(at=m.PRIORITY_WINDOWS[0][1]+1)]:
   v=fixture();change(v);result,_=self.read(v);self.assertFalse(result['available'])
  v=fixture();v['diagnostics']['facts']=[copy.deepcopy(v['diagnostics']['facts'][0])for _ in range(65)];result,_=self.read(v);self.assertFalse(result['available'])
 def test_actual_new_exporter_output_roundtrips_with_current_refusals_and_no_private_values(self):
  e=load('provider_recovery_actual_exporter','export-provider-recovery-forensics-20261030.py');uid=os.getuid();canary='PRIVATE_PROVIDER_VALUE_DO_NOT_EXPORT'
  with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-provider-reader-')as directory:
   root=pathlib.Path(directory);root.chmod(0o700);evidence=root/'service-evidence';evidence.mkdir(mode=0o700)
   def write(path,value):path.write_text(json.dumps(value)+'\n');path.chmod(0o600)
   write(root/'status.json',{'accountId':e.ACCOUNT,'inceptionAt':e.INCEPTION,'runId':e.RUN,'startedAt':e.STARTED,'generatedAt':e.END+1000,'source':e.SOURCE,'configurationSha256':e.CONFIGURATION,'mode':'paper','liveTradingEnabled':False,'running':True,'entriesEnabled':False,'status':canary,'usage':{'market':{'holdingDiagnostics':{'contextFailureCounts':{'HELD_PRICING_PROVIDER_TIMEOUT':3},'lastContext':{'at':e.END+900,'reason':canary}}},'rpc':{'httpTimeouts':602,'endpoint':canary}},'timing':{'protectionBreaches':46},'financial':{'controls':{'reason':canary}},'positions':canary})
   file='diagnostic-000000000001.ndjson';write(evidence/'state.json',{'version':'poe-owned-rotating-evidence-v1','diagnostics':[{'file':file,'startedAt':e.START-1,'endedAt':e.END+1}]});write(evidence/file,{'kind':'component-physical-timeout','runId':e.RUN,'data':{'at':e.PRIORITY_WINDOWS[1][0]+100,'requestedTimeoutMs':1000,'physicalSettled':True,'endpoint':canary}})
   with patch.object(e.os,'getuid',return_value=988),patch.object(e.os,'getgid',return_value=982):value=e.collect(root,uid)
   projected=m.validate(value);self.assertEqual(projected['currentStatus']['diagnostics']['usage']['market']['holdingDiagnostics']['contextFailureCounts']['HELD_PRICING_PROVIDER_TIMEOUT'],3);self.assertEqual(len(projected['diagnostics']['facts']),1);self.assertEqual(projected['diagnostics']['facts'][0]['at'],e.PRIORITY_WINDOWS[1][0]+100);self.assertNotIn(canary,json.dumps(projected));self.assertEqual(projected['priorityWindows'],[{'fromAt':a,'untilAtExclusive':b}for a,b in e.PRIORITY_WINDOWS])
 def test_old_ba33_export_cannot_satisfy_new93_receipt(self):
  v=fixture();v['source']={'commit':'ba33ee535ad1703da36905a5e2f44088ae19a43d','sha256':'870ac98a2377fefde564b9a3a252a7cc7cb3a561582abd48bda22ee18a14bee7'};result,_=self.read(v);self.assertFalse(result['available']);self.assertEqual(m.NAME,'provider-recovery-forensics-20261030.json');self.assertIsNone(m.SCRIPT_SHA)
if __name__=='__main__':unittest.main()
