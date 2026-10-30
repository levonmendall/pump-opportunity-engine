#!/usr/bin/env python3
"""Disposable sanitized diagnostic fixtures; never touches EC2 or the ledger."""
import contextlib,hashlib,importlib.util,io,json,os,pathlib,tempfile,unittest
from datetime import datetime
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('export-provider-recovery-forensics-20261030.py');s=importlib.util.spec_from_file_location('provider_recovery_forensics',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
LEAK='SECRET_PROVIDER_URL_WALLET_FINANCIAL_VALUE_DO_NOT_EXPORT'
class Fixtures(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='poe-OFFLINE-provider-forensics-');self.root=pathlib.Path(self.tmp.name);self.root.chmod(0o700);self.uid=os.getuid()
 def tearDown(self):self.tmp.cleanup()
 def write(self,p,value):p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_bytes(value if type(value)is bytes else(json.dumps(value)+'\n').encode());p.chmod(0o600)
 def status(self):return {'accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'runId':m.RUN,'startedAt':m.STARTED,'generatedAt':m.END+1000,'source':dict(m.SOURCE),'configurationSha256':m.CONFIGURATION,'mode':'paper','liveTradingEnabled':False,'entriesEnabled':False,'running':True,'status':LEAK,'financial':LEAK,'positions':LEAK,'pending':LEAK,'financialReadiness':{'safety':{'idle':True,'uncertainActions':0,'reason':LEAK,'financial':LEAK}},'usage':{'rpc':{'chapterUsage':{'persistence':{'attempts':100,'totalMs':1000,'maximumMs':123},'durationsMs':[1,2,3000],'endpoint':LEAK}},'localPhases':{'report-checkpoint':{'count':2,'maximumMs':11,'overruns':1,'url':LEAK}}},'reporting':{'maximumProjectionMs':11,'lastDeferral':LEAK},'timing':{'maximumCompletedGapMs':12329,'protectionBreaches':2,'unavailableChecks':4},'evidenceRetention':{'candidateAdmissionAllowed':True,'refusedRecords':0,'path':LEAK}}
 def namespace(self):
  self.write(self.root/'status.json',self.status());d=self.root/'service-evidence';d.mkdir(mode=0o700);self.write(d/'state.json',{'version':'poe-owned-rotating-evidence-v1','diagnostics':[{'file':'diagnostic-000000000001.ndjson','startedAt':m.START-1,'endedAt':m.END+1}],'activeDiagnostic':None,'activeEssential':None});return d
 def event(self,kind='trader-held-evaluation',at=m.START+1,data=None):return {'schemaVersion':1,'receivedAt':'2026-10-29T23:59:25.001Z','kind':kind,'data':{'at':at,'usable':False,'quoteAt':at-9000,'reason':LEAK,'units':LEAK,'mint':LEAK,**(data or{})}}
 def test_exact_current_identity_and_useful_diagnostic_scalars(self):
  r=m.status_fact(self.status());raw=json.dumps(r);self.assertNotIn(LEAK,raw);self.assertEqual(r['diagnostics']['timing']['maximumCompletedGapMs'],12329);self.assertEqual(r['diagnostics']['usage']['rpc']['chapterUsage']['persistence']['maximumMs'],123);self.assertEqual(r['diagnostics']['usage']['localPhases']['report-checkpoint']['count'],2);self.assertNotIn('positions',r);self.assertNotIn('pending',r);self.assertNotIn('financial',r['diagnostics'])
 def test_each_identity_component_required(self):
  for key,v in [('accountId','wrong'),('inceptionAt',1),('runId','other'),('startedAt',1),('source',{}),('configurationSha256','0'*64),('mode','LIVE'),('liveTradingEnabled',True)]:
   d=self.status();d[key]=v
   with self.subTest(key=key),self.assertRaises(m.Refused):m.status_fact(d)
 def test_immutable_source_metadata_is_bound_by_pins_without_leaking_metadata(self):
  d=self.status();d['source']={**m.SOURCE,'builtAt':LEAK,'dirty':False,'version':LEAK,'dependencyLockSha256':LEAK};r=m.status_fact(d);self.assertTrue(r['available']);self.assertEqual(r['source'],m.SOURCE);self.assertNotIn(LEAK,json.dumps(r));d['source']['sha256']='0'*64
  with self.assertRaises(m.Refused):m.status_fact(d)
  e=self.event();e['source']={**m.SOURCE,'builtAt':LEAK};self.assertIsNotNone(m.event_fact(e));e['data']['source']={**m.SOURCE,'version':LEAK};self.assertIsNotNone(m.event_fact(e));e['data']['source']['commit']='0'*40;self.assertIsNone(m.event_fact(e))
 def test_actual93_rpc_http_and_audit_event_literals_preserve_measured_fields(self):
  for kind in['pilot-rpc-unavailable','pilot-data-control-unavailable','pilot-derived-status-flush-unavailable','trader-pilot-execution-quote','native-audit-dispatch-state','native-candidate-window-audit-unavailable','http-response-timing','http-lifecycle-timing']:
   r=m.event_fact(self.event(kind,data={'headersDelayMs':1300,'bodyAfterHeadersMs':20,'jsonDecodeMonotonicMs':1,'undiciHeadersDispatchDelayMs':40,'physicalSettled':True,'reservationsRetained':0,'remainingDecisionMs':-10,'endpoint':LEAK}));self.assertIsNotNone(r);self.assertEqual(r['data']['headersDelayMs'],1300);self.assertEqual(r['data']['remainingDecisionMs'],-10);self.assertNotIn(LEAK,json.dumps(r))
 def test_unknown_strings_hashed_and_cannot_smuggle_known_prefix(self):
  r=m.string_fact('COMPONENT_PHYSICAL_TIMEOUT '+LEAK);self.assertEqual(r['code'],'UNKNOWN_HASHED');self.assertNotIn(LEAK,json.dumps(r));self.assertEqual(r['sha256'],hashlib.sha256(('COMPONENT_PHYSICAL_TIMEOUT '+LEAK).encode()).hexdigest());self.assertEqual(m.string_fact('COMPONENT_PHYSICAL_TIMEOUT')['code'],'COMPONENT_PHYSICAL_TIMEOUT')
 def test_event_window_exact_bounds_and_attribution_honest(self):
  self.assertIsNone(m.event_fact(self.event(at=m.START-1)));self.assertIsNone(m.event_fact(self.event(at=m.END)));r=m.event_fact(self.event());self.assertEqual(r['runAttribution'],'time-correlated-with-verified-current-run');self.assertNotIn(LEAK,json.dumps(r));e=self.event();e['runId']=m.RUN;self.assertEqual(m.event_fact(e)['runAttribution'],'explicit-run-field');e['runId']='wrong';self.assertIsNone(m.event_fact(e))
 def test_foreign_source_or_data_run_dropped(self):
  e=self.event();e['source']={'commit':'wrong'};self.assertIsNone(m.event_fact(e));e=self.event(data={'runId':'wrong'});self.assertIsNone(m.event_fact(e))
 def test_event_iso_requires_explicit_utc_when_data_at_absent(self):
  e=self.event();e['data'].pop('at');self.assertIsNotNone(m.event_fact(e));e['receivedAt']='2026-10-29T23:59:25.001';self.assertIsNone(m.event_fact(e));e['receivedAt']=LEAK;self.assertIsNone(m.event_fact(e))
 def test_only_allowlisted_names_can_be_opened(self):
  self.assertTrue(m.valid_segment('diagnostic-000000000001.ndjson'));self.assertTrue(m.valid_segment('essential-000000000002.ndjson'))
  for n in['../ledger.sqlite','diagnostic-000000000001.ndjson/secret','diagnostic-000000000001Xndjson','provider-'+LEAK]:self.assertFalse(m.valid_segment(n))
 def test_collect_retained_facts_unknown_counts_and_no_financial_open(self):
  d=self.namespace();a=self.event();b=self.event('component-physical-timeout',data={'requestedTimeoutMs':1500,'elapsedMonotonicMs':2700,'callbackLatenessMs':1200,'kind':{'transport':'http','method':'getMultipleAccounts'}});unknown=self.event(LEAK);self.write(d/'diagnostic-000000000001.ndjson',b'\n'.join(json.dumps(x).encode()for x in[a,b,unknown])+b'\n');before={p:p.read_bytes()for p in[d/'state.json',d/'diagnostic-000000000001.ndjson',self.root/'status.json']};r=m.collect(self.root,self.uid);self.assertTrue(r['currentStatus']['available']);self.assertEqual(len(r['diagnostics']['facts']),2);self.assertEqual(r['diagnostics']['facts'][1]['data']['requestedTimeoutMs'],1500);self.assertNotIn(LEAK,json.dumps(r));self.assertEqual(len(r['diagnostics']['unrecognizedEventKinds']),1);self.assertFalse(r['financialDatabaseOpened']);self.assertEqual(before,{p:p.read_bytes()for p in before});self.assertLess(len(json.dumps(r).encode()),m.MAX_OUTPUT)
 def test_wrong_current_run_does_not_associate_events(self):
  d=self.namespace();s=self.status();s['runId']='wrong';self.write(self.root/'status.json',s);self.write(d/'diagnostic-000000000001.ndjson',json.dumps(self.event()).encode()+b'\n');r=m.collect(self.root,self.uid);self.assertFalse(r['currentStatus']['available']);self.assertEqual(r['diagnostics']['facts'],[]);self.assertEqual(r['diagnostics']['reasonCode'],'VERIFIED_CURRENT_STATUS_REQUIRED')
 def test_sealed_essential_segment_is_considered_without_state_entry(self):
  d=self.namespace();self.write(d/'essential-000000000123.ndjson',json.dumps(self.event()).encode()+b'\n');r=m.collect(self.root,self.uid);self.assertEqual(len(r['diagnostics']['facts']),1)
 def test_missing_and_corrupt_metadata_remains_unknown(self):
  d=self.namespace();self.write(d/'state.json',b'not-json');r=m.collect(self.root,self.uid);self.assertTrue(r['diagnostics']['selectionUnknown']);self.assertEqual(r['diagnostics']['facts'],[]);self.assertIn('UNKNOWN',r['diagnostics']['meaning'])
 def test_oversized_partial_malformed_line_and_foreign_event_do_not_create_facts(self):
  d=self.namespace();e=json.dumps(self.event()).encode();self.write(d/'diagnostic-000000000001.ndjson',b'x'*(m.MAX_LINE+1)+e+b'\n'+b'bad\n'+e);r=m.collect(self.root,self.uid);f=r['diagnostics']['files'][0];self.assertEqual(f['oversizedLines'],1);self.assertEqual(f['malformedLines'],1);self.assertTrue(f['partialTrailingLine']);self.assertEqual(r['diagnostics']['facts'],[])
 def test_symlink_hardlink_mode_and_size_guard_before_read(self):
  p=self.root/'private';self.write(p,{});link=self.root/'link';link.symlink_to(p)
  with self.assertRaises(m.Refused):m.read(link,m.MAX_STATUS,self.uid)
  link.unlink();os.link(p,link)
  with self.assertRaises(m.Refused):m.read(p,m.MAX_STATUS,self.uid)
  link.unlink();p.chmod(0o644)
  with self.assertRaises(m.Refused):m.read(p,m.MAX_STATUS,self.uid)
  p.chmod(0o600)
  with self.assertRaises(m.Refused):m.read(p,1,self.uid)
 def test_budget_and_fact_bounds_are_reported(self):
  d=self.namespace();self.write(d/'diagnostic-000000000001.ndjson',(json.dumps(self.event())+'\n').encode()*5)
  with patch.object(m,'MAX_FACTS',2):r=m.collect(self.root,self.uid)
  self.assertTrue(r['diagnostics']['factCapacityReached']);self.assertEqual(len(r['diagnostics']['facts']),2)
  r=m.evidence_facts(d,{'available':True},self.uid,budget_seconds=0);self.assertTrue(r['scanBudgetReached']);self.assertEqual(r['facts'],[])
 def test_dense_early_trace_cannot_hide_later_held_failure(self):
  d=self.namespace();rows=[self.event('native-audit-dispatch-state',at=m.START+i)for i in range(10)]+[self.event('trader-held-evaluation',at=m.START+1000,data={'usable':False})];self.write(d/'diagnostic-000000000001.ndjson',b'\n'.join(json.dumps(x).encode()for x in rows)+b'\n')
  with patch.object(m,'MAX_FACTS',2):r=m.collect(self.root,self.uid)
  self.assertTrue(r['diagnostics']['factCapacityReached']);self.assertTrue(any(f['kind']=='trader-held-evaluation'for f in r['diagnostics']['facts']));self.assertEqual(r['diagnostics']['matchingKindCounts']['native-audit-dispatch-state'],10)
 def test_publication_atomic_bounded_and_existing_symlink_never_followed(self):
  p=self.root/'public';p.mkdir(mode=0o755);out=p/'export.json';r=m.publish(out,{'safe':True},self.uid);self.assertEqual(r['sha256'],hashlib.sha256(out.read_bytes()).hexdigest());self.assertEqual(out.stat().st_mode&0o777,0o644);out.unlink();target=self.root/'target';target.write_text('UNCHANGED');out.symlink_to(target)
  with self.assertRaises(m.Refused):m.publish(out,{},self.uid)
  self.assertEqual(target.read_text(),'UNCHANGED');out.unlink()
  with self.assertRaises(m.Refused):m.publish(out,{'huge':'a'*m.MAX_OUTPUT},self.uid)
 def test_main_is_fixed_path_drops_before_reads_and_receipt_flags(self):
  dropped=[]
  def drop():dropped.append(True)
  def collect():self.assertEqual(dropped,[True]);return {}
  b=io.StringIO()
  with patch.object(m.sys,'argv',['fixed']),patch.object(m,'drop_original_identity',drop),patch.object(m,'collect',collect),patch.object(m,'publish',lambda *_:{'path':str(m.OUTPUT),'bytes':5,'sha256':'a'*64}),contextlib.redirect_stdout(b):m.main()
  r=json.loads(b.getvalue());self.assertEqual(r['kind'],'POE_CURRENT_RUN_FORENSIC_EXPORT_RECEIPT');self.assertEqual(r['source'],m.SOURCE);self.assertEqual(r['runId'],m.RUN);self.assertFalse(r['financialDatabaseOpened']);self.assertEqual(r['financialWrites'],0);self.assertEqual(r['credentialReads'],0)
  with patch.object(m.sys,'argv',['fixed','--other-path']):
   with self.assertRaises(m.Refused):m.main()
 def test_permanent_identity_drop_clears_groups_fds_saved_ids(self):
  events=[];ids={'u':(0,0,0),'g':(0,0,0)}
  def gid(*v):events.append('gid');ids['g']=v
  def uid(*v):events.append('uid');ids['u']=v
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'closerange',lambda *_:events.append('fds')),patch.object(m.os,'setgroups',lambda *_:events.append('groups')),patch.object(m.os,'setresgid',gid),patch.object(m.os,'setresuid',uid),patch.object(m.os,'getresuid',lambda:ids['u']),patch.object(m.os,'getresgid',lambda:ids['g']):m.drop_original_identity()
  self.assertEqual(events,['fds','groups','gid','uid']);self.assertEqual(ids['u'],(m.UID,)*3);self.assertEqual(ids['g'],(m.GID,)*3)
 def test_exact93_source_cross_midnight_windows_and_distinct_output(self):
  self.assertEqual(m.SOURCE,{'commit':'93bf0b5d6a3f1258a74ac696798fb4e0ec6147a2','sha256':'8a0f001a3ae0c6acedaae6fb8a0370e02293a8b0c35142d74daf19086a41203c'})
  self.assertEqual(m.CONFIGURATION,'44b82455003f04f75eb1ad7a3dc21555406c1d4d0c7626386d3d21661fdb47c9')
  self.assertEqual(m.STARTED,int(datetime.fromisoformat('2026-10-29T23:48:56.700+00:00').timestamp()*1000))
  exact=[('2026-10-29T23:59:25+00:00','2026-10-30T00:01:35+00:00'),('2026-10-30T00:11:15+00:00','2026-10-30T00:12:30+00:00')]
  self.assertEqual(m.PRIORITY_WINDOWS,tuple(tuple(int(datetime.fromisoformat(v).timestamp()*1000)for v in row)for row in exact))
  self.assertEqual(str(m.OUTPUT),'/var/lib/poe-public/provider-recovery-forensics-20261030.json')
  self.assertNotEqual(m.OUTPUT.name,'current-run-forensics-20261029.json')
 def test_unsampled_middle_and_exact_each_window_boundaries(self):
  for start,end in m.PRIORITY_WINDOWS:
   self.assertIsNotNone(m.event_fact(self.event(at=start)))
   self.assertIsNotNone(m.event_fact(self.event(at=end-1)))
   self.assertIsNone(m.event_fact(self.event(at=end)))
  self.assertIsNone(m.event_fact(self.event(at=m.PRIORITY_WINDOWS[0][1]+1000)))
 def test_status_preserves93_holding_refusals_and_rpc_plan_without_market_payloads(self):
  d=self.status();d['usage']['market']={'registeredPools':4,'held':{'networkCalls':30,'linkCacheHits':22,'highestVerifiedSlot':12345,'cachedPoolSlots':{LEAK:1}},'holdingDiagnostics':{'lastContext':{'at':m.END,'state':'unavailable','reasonCode':'HELD_PRICING_PROVIDER_COOLDOWN','heldPositions':1,'units':LEAK},'contextFailureCounts':{'HELD_PRICING_PROVIDER_TIMEOUT':6,'HELD_PRICING_ABORTED':6,'HELD_PRICING_PROVIDER_COOLDOWN':22,LEAK:999}},'entryPricing':{'networkCalls':7},'rpc':{'requestLimits':{'maxStartsPerMinute':90,'maxStartsPer10s':20,'minSpacingMs':250,'physicalInFlight':1,'endpoint':LEAK}}}
  r=m.status_fact(d)['diagnostics']['usage']['market'];self.assertEqual(r['held']['networkCalls'],30);self.assertEqual(r['holdingDiagnostics']['contextFailureCounts']['HELD_PRICING_PROVIDER_COOLDOWN'],22);self.assertEqual(r['holdingDiagnostics']['lastContext']['reasonCode']['code'],'HELD_PRICING_PROVIDER_COOLDOWN');self.assertEqual(r['rpc']['requestLimits']['physicalInFlight'],1);self.assertNotIn(LEAK,json.dumps(r))
 def test_actual93_backoff_late_header_and_link_events_are_sanitized(self):
  kinds=['pilot-rpc-provider-backoff-observed','pilot-job-admission-refused','research-clock-cache-invalidation','research-held-market-invalidation','research-held-market-context','research-clock-pool-state','native-paper-early-protection-for-audit']
  for kind in kinds:
   r=m.event_fact(self.event(kind,data={'physicalGateUnchanged':True,'observedAfterLogicalCompletion':True,'primaryRpcCooldownUntil':m.START+3000,'slot':123,'sourceSlot':123,'context':{'slot':123},'addresses':[LEAK],'value':LEAK,'contextFailureCounts':{'HELD_PRICING_PROVIDER_TIMEOUT':1}}));self.assertIsNotNone(r);self.assertTrue(r['data']['physicalGateUnchanged']);self.assertEqual(r['data']['context']['slot'],123);self.assertNotIn(LEAK,json.dumps(r))
  h=m.event_fact(self.event('http-headers',data={'retryAfter':'120 '+LEAK,'httpStatus':200}));self.assertEqual(h['data']['retryAfter']['code'],'UNKNOWN_HASHED');self.assertNotIn(LEAK,json.dumps(h));self.assertEqual(h['data']['httpStatus'],200)
 def test_two_window_quotas_preserve_latest_physical_evidence_and_earlier_failure(self):
  d=self.namespace();rows=[self.event('native-audit-dispatch-state',at=m.START+i)for i in range(100)]+[self.event('trader-held-evaluation',at=m.START+10000,data={'usable':False})]
  latest=m.PRIORITY_WINDOWS[1][0];rows.extend(self.event('native-audit-dispatch-state',at=latest+i)for i in range(200));rows.extend([self.event('component-physical-start',at=latest+1000,data={'id':1,'kind':{'transport':'http','method':'getMultipleAccounts'}}),self.event('component-physical-timeout',at=latest+2000,data={'id':1,'requestedTimeoutMs':1000}),self.event('component-physical-settled',at=latest+2001,data={'id':1,'responseComplete':False})])
  self.write(d/'diagnostic-000000000001.ndjson',b'\n'.join(json.dumps(x).encode()for x in rows)+b'\n');s=json.loads((d/'state.json').read_text());s['diagnostics'][0]['endedAt']=m.END+1;self.write(d/'state.json',s);r=m.collect(self.root,self.uid);f=r['diagnostics']['facts']
  self.assertTrue(r['diagnostics']['factCapacityReached']);self.assertLessEqual(len(f),192);self.assertLessEqual(len(json.dumps(f,separators=(',',':')).encode()),85000)
  self.assertTrue(any(x['kind']=='trader-held-evaluation'and x['at']<m.PRIORITY_WINDOWS[0][1]for x in f))
  for kind in ['component-physical-start','component-physical-timeout','component-physical-settled']:self.assertTrue(any(x['kind']==kind and x['at']>=latest for x in f))
  self.assertLessEqual(sum(x['at']<m.PRIORITY_WINDOWS[0][1]for x in f),64);self.assertLessEqual(sum(x['at']>=latest for x in f),128)
 def test_collection_exposes_explicit_noncontinuous_priority_windows(self):
  self.namespace();r=m.collect(self.root,self.uid);self.assertEqual(r['priorityWindows'],[{'fromAt':s,'untilAtExclusive':e}for s,e in m.PRIORITY_WINDOWS]);self.assertEqual(r['window'],{'fromAt':m.START,'untilAtExclusive':m.END});self.assertTrue(any('not continuous coverage'in x for x in r['limitations']))
 def test_diagnostic_file_order_prioritizes_latest_retained_interval(self):
  d=self.namespace();latest=m.PRIORITY_WINDOWS[1][0];first='diagnostic-000000000001.ndjson';second='diagnostic-000000000002.ndjson';self.write(d/first,json.dumps(self.event()).encode()+b'\n');self.write(d/second,json.dumps(self.event('component-physical-timeout',at=latest+1)).encode()+b'\n');self.write(d/'state.json',{'version':'poe-owned-rotating-evidence-v1','diagnostics':[{'file':first,'startedAt':m.START-1,'endedAt':m.PRIORITY_WINDOWS[0][1]},{'file':second,'startedAt':latest-1,'endedAt':m.END}],'activeDiagnostic':None,'activeEssential':None})
  with patch.object(m,'MAX_FILES',1):r=m.collect(self.root,self.uid)
  self.assertEqual(r['diagnostics']['files'][0]['file'],second);self.assertTrue(r['diagnostics']['scanBudgetReached']);self.assertEqual(r['diagnostics']['facts'][0]['kind'],'component-physical-timeout')
 def test_old_forensic_program_remains_hash_identical(self):
  old=P.with_name('export-current-run-forensics-20261029.py');self.assertEqual(hashlib.sha256(old.read_bytes()).hexdigest(),'1c684b1c88c95c75488f056ad00a8ea756c906e45dcb0f4f8725f5e75b193c59')
if __name__=='__main__':unittest.main()
