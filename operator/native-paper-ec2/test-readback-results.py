"""Generated disposable metadata/SQLite fixtures; no real account or network."""
import base64,contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,random,sqlite3,tarfile,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).with_name('readback-results.py');spec=importlib.util.spec_from_file_location('paper_results',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RUN='40750000001';ATTEMPT='1';SOURCE={'commit':'a'*40,'sha256':'b'*64};RID='native-paper-20261028123456789';SECRET=b'SYNTHETIC_PRIVATE_METADATA_MUST_NOT_EXPORT'
def put(path,value):
 raw=value if type(value)is bytes else m.encode(value);path.write_bytes(raw);path.chmod(0o600);return raw
def mkdir(path):path.mkdir(parents=True,exist_ok=True,mode=0o700);path.chmod(0o700)
@contextlib.contextmanager
def fixture():
 with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-results-')as tmp:
  base=pathlib.Path(tmp);root=base/'supervision'/('poe-native-paper-'+RUN+'-'+ATTEMPT);account=base/'account';r=account/'runs'/RID;mkdir(root);mkdir(r);uid=os.getuid();at=m.INCEPTION+10000
  state={'schemaVersion':1,'accountId':m.ACCOUNT,'mode':'PAPER','inceptionAt':m.INCEPTION,'initialMicroUsd':'1000000000','revision':1,'lamports':'49999993000','gasReserve':'5000000','realizedLamports':'-7000','executionCosts':'7000','positions':{},'pending':{},'lockedDeposits':{},'inceptionPrice':{'microUsdPerSol':'20000000'},'controls':{'entriesEnabled':False,'stopRequested':True,'changedAt':at},'daily':{'paused':False,'lossPaused':False,'reconciledAt':at},'lastAt':at}
  fields={'revision':1,'cashLamports':'49999993000','reservedLamports':'0','lockedDepositLamports':'0','realizedLamports':'-7000','executionCostsLamports':'7000','openPositions':0,'pendingActions':0,'equityLamports':'49999993000','totalPnlLamports':'-7000','controls':state['controls'],'daily':state['daily']}
  src={'accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'mode':'paper','financialExecutionAuthorized':True,'liveTradingEnabled':False,'source':SOURCE,'runId':RID,'startedAt':at-5000,'generatedAt':at,'running':False,'positions':{},'pending':{},'financial':fields,'timing':{'lastCompletedProtectionAt':None}}
  raw=put(r/'result.json',src);put(account/'status.json',raw);put(r/'settlement.json',{'physicalSettlementConfirmed':True,'positions':0,'pending':0});put(r/'events-001.ndjson',m.encode({'kind':'research-clock-pool-state','data':{'SYNTHETIC_PRIVATE':SECRET.decode()}})+m.encode({'kind':'trader-execution','receivedAt':'2026-10-28T12:34:56.789Z','data':{'orderId':'fixture-only-order','status':'failed','reason':'controlled fixture','at':at,'side':'buy','unknownPrivate':SECRET.decode()}}))
  put(account/'ledger.sqlite.owner.lock',b'')
  db=sqlite3.connect(account/'ledger.sqlite');db.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT);CREATE TABLE actions(id TEXT PRIMARY KEY,payload_hash TEXT,result TEXT);CREATE TABLE journal(revision INTEGER PRIMARY KEY,action_id TEXT UNIQUE,at INTEGER,kind TEXT,detail TEXT);CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);');db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps(state),));db.execute('INSERT INTO actions VALUES(?,?,?)',('action1','hash','{}'));db.executemany('INSERT INTO journal VALUES(?,?,?,?,?)',[(0,'initial',at,'initialize','{}'),(1,'action1',at,'reconcile','{}')]);db.execute('INSERT INTO metadata VALUES(?,?)',('SECRET_SENTINEL',SECRET.decode()));db.commit();db.close();(account/'ledger.sqlite').chmod(0o600)
  segment={'sourceGroupSettled':True,'sourcePid':999999999,'sourceRunId':RID,'finalStatusSha256':m.digest(raw)};supervisor={'kind':'POE_NATIVE_PAPER_BOUNDED_SUPERVISION','accountId':m.ACCOUNT,'inceptionAt':m.INCEPTION,'realTradingEnabled':False,'source':SOURCE,'segments':[segment],'publisherGroupSettled':True};package=put(root/'package.json',{'source':SOURCE});supervisor['packageSha256']=m.digest(package);put(root/'supervisor.json',supervisor);put(root/'segment-0.json',segment)
  witness={'kind':'poe-exact-accepted-source-witness-v1','rows':[]}
  for name in ['accepted-source-first-1.json','accepted-source-first-2.json','accepted-source-last-1.json','accepted-source-last-2.json']:
   put(root/name,raw);witness['rows'].append({'file':name,'runId':RID,'sourceAt':at,'sourceBytes':len(raw),'sourceSha256':m.digest(raw),'publisherAcknowledgement':{'published':True,'result':'accepted','accountId':m.ACCOUNT,'runId':RID,'sourceAt':at,'running':False}})
  put(root/'accepted-source-witness.json',witness);fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:yield {'base':base,'root':root,'account':account,'run':r,'fd':fd,'uid':uid,'source':src,'state':state,'supervisor':supervisor,'segment':segment,'witness':witness}
  finally:os.close(fd)
def prepare(f):return m.prepare_from_base_fd(f['fd'],f['uid'],RUN,ATTEMPT)
def archive_entries(f):
 with tarfile.open(f['root']/'export'/m.ARCHIVE,'r:gz')as archive:return {row.name:archive.extractfile(row).read()for row in archive}

class Results(unittest.TestCase):
 def test_complete_projection_and_four_exact_witnesses_export_no_database_or_private_metadata(self):
  with fixture()as f:
   before=(f['account']/'ledger.sqlite').read_bytes();manifest=prepare(f);entries=archive_entries(f);audit=json.loads(entries['ledger-projection-audit.json']);index=json.loads(entries['index.json']);self.assertTrue(audit['allComparableSourceFieldsMatch']);self.assertTrue(audit['sourceOwnershipMatchesLedger']);self.assertTrue(audit['databaseUnchangedDuringRead']);self.assertEqual(audit['fields']['totalPnlLamports'],'-7000');self.assertFalse(audit['usdPnlIndependentlyVerified']);self.assertGreater(audit['ledgerAuditedAt'],0);self.assertEqual(audit['databaseSha256'],m.digest(before));self.assertEqual(before,(f['account']/'ledger.sqlite').read_bytes());self.assertFalse(any('sqlite'in name or 'secret'in name.lower()for name in entries));self.assertFalse(any(SECRET in raw for raw in entries.values()));self.assertEqual(len([n for n in entries if n.startswith('witness/accepted-source-')and n!='witness/accepted-source-witness.json']),4)
   for row in index['files']:self.assertEqual(row['sha256'],m.digest(entries[row['file']]))
   self.assertEqual(manifest['archive']['sha256'],m.digest((f['root']/'export'/m.ARCHIVE).read_bytes()));self.assertFalse(manifest['rawFinancialFilesIncluded']);self.assertEqual(json.loads(entries['event-summary.json'])[0]['sourceKindCounts']['research-clock-pool-state'],1)
 def test_package_hash_and_exact_supervision_witness_membership_are_required(self):
  with fixture()as f:
   put(f['root']/'package.json',{'source':{'commit':'c'*40,'sha256':'d'*64}})
   with self.assertRaisesRegex(m.Guard,'SUPERVISION_PACKAGE_HASH_MISMATCH'):prepare(f)
  with fixture()as f:
   f['witness']['rows'][0]['runId']='native-paper-20261027000000000';put(f['root']/'accepted-source-witness.json',f['witness'])
   with self.assertRaisesRegex(m.Guard,'WITNESS_OUTSIDE_SUPERVISION'):prepare(f)
 def test_missing_reporting_witness_remains_explicitly_unverified_but_preserves_financial_forensics(self):
  with fixture()as f:
   (f['root']/'accepted-source-witness.json').unlink();prepare(f);entries=archive_entries(f);witness=json.loads(entries['witness/accepted-source-witness.json']);self.assertEqual(witness['rows'],[]);self.assertIn('unavailableReason',witness);self.assertIn('ledger-projection-audit.json',entries)
 def test_archive_ceiling_is_checked_before_extra_compressed_bytes_are_written(self):
  output=io.BytesIO();writer=m.BoundedArchiveWriter(output);writer.written=m.MAX_ARCHIVE-1;self.assertEqual(writer.write(b'x'),1)
  with self.assertRaisesRegex(m.Guard,'ARCHIVE_SIZE_BOUND'):writer.write(b'y')
  self.assertEqual(output.getvalue(),b'x')
 def test_nonfinite_json_numbers_are_refused(self):
  with self.assertRaisesRegex(m.Guard,'INVALID_JSON_NUMBER'):m.parse(b'{"untrusted":1e999}')
 def test_chunk_protocol_exact_reassembly_and_hashes(self):
  with fixture()as f:
   manifest=prepare(f);output=io.StringIO();result=m.stream_from_base_fd(f['fd'],f['uid'],RUN,ATTEMPT,'0',str(4*m.MIB),output);rows=[json.loads(s)for s in output.getvalue().splitlines()];body=b''.join(base64.b64decode(r['base64'],validate=True)for r in rows if r['kind']=='data');self.assertEqual(body,(f['root']/'export'/m.ARCHIVE).read_bytes());self.assertEqual(rows[-1]['chunkSha256'],m.digest(body));self.assertEqual(result['archiveSha256'],manifest['archive']['sha256']);self.assertFalse(rows[-1]['archiveWholeHashVerifiedByThisCall']);self.assertFalse(rows[-1]['financialDatabaseReadByThisCall']);self.assertTrue(all(len(s.encode())<65536 for s in output.getvalue().splitlines()));self.assertNotIn(str(f['base']),output.getvalue())
 def test_four_mib_chunk_does_not_read_or_emit_the_remaining_archive(self):
  with fixture()as f:
   prepare(f);archive=f['root']/'export'/m.ARCHIVE;raw=random.Random(22).randbytes(5*m.MIB);put(archive,raw);p=f['root']/'export'/m.MANIFEST;manifest=json.loads(p.read_text());manifest['archive'].update(bytes=len(raw),sha256=m.digest(raw),stat=m.h.stat_identity(archive.stat()));put(p,manifest);output=io.StringIO();read_bytes=[];original=os.pread
   def counted(fd,n,offset):
    block=original(fd,n,offset);read_bytes.append(len(block));return block
   with patch.object(m.os,'pread',side_effect=counted):m.stream_from_base_fd(f['fd'],f['uid'],RUN,ATTEMPT,'0',str(4*m.MIB),output)
   rows=[json.loads(s)for s in output.getvalue().splitlines()];received=b''.join(base64.b64decode(r['base64'])for r in rows if r['kind']=='data');self.assertEqual(sum(read_bytes),4*m.MIB);self.assertEqual(received,raw[:4*m.MIB]);self.assertEqual(rows[-1]['chunkSha256'],m.digest(received));self.assertFalse(rows[-1]['archiveWholeHashVerifiedByThisCall'])
 def test_owner_lease_prevents_export_while_any_financial_writer_has_the_lock(self):
  with fixture()as f:
   fd=os.open(f['account']/'ledger.sqlite.owner.lock',os.O_RDONLY);m.fcntl.flock(fd,m.fcntl.LOCK_EX|m.fcntl.LOCK_NB)
   try:
    with self.assertRaises(BlockingIOError):prepare(f)
    self.assertFalse((f['root']/'export').exists())
   finally:os.close(fd)
 def test_live_source_pid_stops_before_any_ledger_access(self):
  with fixture()as f:
   f['supervisor']['segments'][0]['sourcePid']=os.getpid();put(f['root']/'supervisor.json',f['supervisor'])
   with patch.object(m,'ledger_audit',side_effect=AssertionError('must not read financial state')),self.assertRaisesRegex(m.Guard,'SOURCE_PID_STILL_PRESENT'):prepare(f)
 def test_no_wal_shm_or_journal_is_opened_or_exported(self):
  for name in ['ledger.sqlite-wal','ledger.sqlite-shm','ledger.sqlite-journal']:
   with fixture()as f:
    put(f['account']/name,SECRET)
    with self.assertRaisesRegex(m.Guard,'FINANCIAL_SIDECAR_PRESENT'):prepare(f)
 def test_wrong_source_identity_and_witness_hash_are_refused(self):
  with fixture()as f:
   f['witness']['rows'][0]['sourceSha256']='c'*64;put(f['root']/'accepted-source-witness.json',f['witness'])
   with self.assertRaisesRegex(m.Guard,'EXACT_WITNESS_MISMATCH'):prepare(f)
  with fixture()as f:
   src=f['source'];src['accountId']='OTHER';raw=put(f['run']/'result.json',src);f['segment']['finalStatusSha256']=m.digest(raw);put(f['root']/'supervisor.json',f['supervisor'])
   with self.assertRaisesRegex(m.Guard,'PAPER_SOURCE_IDENTITY_REQUIRED'):prepare(f)
 def test_wrong_cash_is_reported_as_independent_discrepancy_without_inventing_pnl(self):
  with fixture()as f:
   source=copy.deepcopy(f['source']);source['financial']['cashLamports']='1';account_fd=m.directory(f['fd'],'account',f['uid'])
   try:audit=m.ledger_audit(account_fd,f['uid'],source)
   finally:os.close(account_fd)
   self.assertFalse(audit['allComparableSourceFieldsMatch']);self.assertFalse(audit['sourceFieldComparisons']['cashLamports']);self.assertEqual(audit['fields']['cashLamports'],'49999993000')
 def test_permission_state_divergence_is_detected_without_granting_executable_entry_permission(self):
  with fixture()as f:
   source=copy.deepcopy(f['source']);source['financial']['controls']['entriesEnabled']=True;account_fd=m.directory(f['fd'],'account',f['uid'])
   try:audit=m.ledger_audit(account_fd,f['uid'],source)
   finally:os.close(account_fd)
   self.assertFalse(audit['allComparableSourceFieldsMatch']);self.assertFalse(audit['sourceFieldComparisons']['controls.entriesEnabled']);self.assertFalse(audit['financialPermission']['entriesEnabled']);self.assertTrue(audit['financialPermission']['stopRequested'])
 def test_held_position_has_no_independently_invented_liquidation_value(self):
  with fixture()as f:
   db=sqlite3.connect(f['account']/'ledger.sqlite');state=f['state'];state['positions']={'fixture-token':{'mint':'fixture-token','units':'4'}};db.execute('UPDATE financial_state SET body=?',(json.dumps(state),));db.commit();db.close();source=copy.deepcopy(f['source']);source['positions']=state['positions'];source['financial']['openPositions']=1;account_fd=m.directory(f['fd'],'account',f['uid'])
   try:audit=m.ledger_audit(account_fd,f['uid'],source)
   finally:os.close(account_fd)
   self.assertIsNone(audit['fields']['equityLamports']);self.assertIsNone(audit['fields']['totalPnlLamports']);self.assertFalse(audit['heldValuationIndependentlyRepriced'])
 def test_symbolic_and_hard_links_are_refused(self):
  with fixture()as f:
   p=f['root']/'package.json';p.unlink();p.symlink_to(f['account']/'ledger.sqlite')
   with self.assertRaises(OSError):prepare(f)
  with fixture()as f:
   os.link(f['root']/'package.json',f['root']/'alias')
   with self.assertRaises(m.h.EvidenceReadbackError):prepare(f)
 def test_no_overwrite_of_existing_archive(self):
  with fixture()as f:
   prepare(f);before=(f['root']/'export'/m.ARCHIVE).read_bytes()
   with self.assertRaises(FileExistsError):prepare(f)
   self.assertEqual((f['root']/'export'/m.ARCHIVE).read_bytes(),before)
 def test_readback_denies_raw_financial_classification_and_changed_archive(self):
  with fixture()as f:
   prepare(f);p=f['root']/'export'/m.MANIFEST;manifest=json.loads(p.read_text());manifest['rawFinancialFilesIncluded']=True;put(p,manifest)
   with self.assertRaisesRegex(m.Guard,'PAPER_ARCHIVE_MANIFEST_REQUIRED'):m.stream_from_base_fd(f['fd'],f['uid'],RUN,ATTEMPT,'0','1',io.StringIO())
  with fixture()as f:
   prepare(f);p=f['root']/'export'/m.ARCHIVE;p.write_bytes(p.read_bytes()+b'changed')
   with self.assertRaisesRegex(m.Guard,'ARCHIVE_STAT'):m.stream_from_base_fd(f['fd'],f['uid'],RUN,ATTEMPT,'0','1',io.StringIO())
 def test_cli_rejects_path_and_budget_injection_without_opening_fixed_root(self):
  for extra in [['--run-id','../PRIVATE'],['--base','/PRIVATE'],['--length',str(4*m.MIB+1)],['--offset','-1']]:
   output=io.StringIO()
   with patch.object(m.h,'open_fixed_base',side_effect=AssertionError('no filesystem needed')):self.assertEqual(m.main(['--phase','readback','--run-id',RUN,'--attempt',ATTEMPT]+extra,output),1)
   self.assertNotIn('/PRIVATE',output.getvalue())

class ObservationDiagnostics(unittest.TestCase):
 def selected(self,kind,data):
  row={'kind':kind,'data':data,'sequence':7,'monotonicMs':12.5,'receivedAt':'2026-10-28T12:34:56.789Z'};raw=m.encode(row);return m.select_event(row,raw,'events-001.ndjson',9)
 def test_http_physical_and_control_metadata_preserve_real_phases_without_provider_payload(self):
  data={'id':11,'requestedAt':1000,'headersAt':1200,'firstBodyAt':1250,'lastBodyAt':2500,'bodyCompleteAt':None,'jsonDecodedAt':None,'httpWorkEndedAt':2501,'responseBytes':226575,'status':200,'outcome':'aborted','aborted':True,'jsonDecodeMonotonicMs':None,'connectionReuse':'not-instrumented; inherited fetch dispatcher retained','responseBody':SECRET.decode(),'url':SECRET.decode(),'headers':{'authorization':SECRET.decode()}}
  row=self.selected('http-lifecycle-timing',data);self.assertEqual(row['data']['responseBytes'],226575);self.assertIsNone(row['data']['bodyCompleteAt']);self.assertEqual(row['sourceSequence'],7);self.assertEqual(row['sourceMonotonicMs'],12.5);self.assertNotIn(SECRET,m.encode(row))
  physical=self.selected('component-physical-start',{'id':11,'at':1000,'enqueuedAt':999,'reservedAt':999,'kind':{'transport':'http','method':'getSignaturesForAddress','params':[SECRET.decode()]},'operationPurpose':'source'})
  self.assertEqual(physical['data']['kind'],{'transport':'http','method':'getSignaturesForAddress'});self.assertNotIn(SECRET,m.encode(physical))
 def test_query_isolation_global_backoff_and_local_refusal_keep_distinct_failure_domains(self):
  cases=[('pilot-job-admission-refused',{'code':'COMPONENT_DISPATCH_EXPIRED','domain':'rpc','physicalSettled':True,'providerCooldownUnchanged':True}),('pilot-data-control-unavailable',{'code':'COMPONENT_PHYSICAL_TIMEOUT','controlCooldownUntil':12000,'publicRpcCooldownUnchanged':True}),('pilot-candidate-batch-unavailable',{'code':'COMPONENT_HISTORY_BATCH_ENVELOPE','httpStatus':200,'globalRpcCooldownUnchanged':True,'globalFailureStreakUnchanged':True}),('pilot-query-timeout-unavailable',{'key':'independent-history:'+'1'*44,'scope':'independent-history','queryCooldownUntil':12000,'queryFailures':2,'automaticRetry':False}),('pilot-query-timeout-escalated',{'distinctTimedOutQueriesLast10s':3,'globalBackoffRequired':True}),('pilot-rpc-provider-backoff-observed',{'status':503,'cooldownUntil':14000,'physicalGateUnchanged':True,'observedAfterLogicalCompletion':False})]
  for kind,data in cases:
   with self.subTest(kind=kind):self.assertEqual(self.selected(kind,{**data,'rawProviderError':SECRET.decode()})['data'],data)
  self.assertEqual(self.selected('component-physical-start',{'operationPurpose':'protection'})['data']['operationPurpose'],'protection')
 def test_audit_trace_and_independent_result_retain_deadlines_waits_denominator_limits_and_labelled_samples(self):
  sig='1'*88;trace={'version':'bounded-native-audit-dispatch-v1','windowEndAt':10000,'decisionDeadlineAt':19999,'firstReadyAt':10012,'lastAt':15000,'reasonCounts':{'eligible':1,'peer-selected':22,'SECRET_SENTINEL':11},'lastState':{'reason':'peer-selected','nextAction':'await-selected-peer-audit-page','context':{'readyOrder':1,'readyCandidates':3,'selectedMint':'1'*44,'inFlight':1,'nextNativeServiceAction':'heartbeat','secret':SECRET.decode()}},'final':False,'unknown':SECRET.decode()}
  result={'status':'unusable','reason':'missing-executed-flow','target':{'startAt':0,'endAt':10000,'secret':SECRET.decode()},'contextFences':{'lower':{'slot':1,'availableAt':500,'secret':SECRET.decode()},'upper':{'slot':10,'bankClockAt':10000,'availableAt':11000}},'requestAttempts':2,'historyRows':1234,'pages':[{'page':1,'requestedLimit':1000,'rows':1000,'receivedAt':12000,'validatedAt':12001,'rawHistory':SECRET.decode()}],'requiredSignatures':[sig]*20,'missingSuccessfulNotifications':[{'signature':sig,'slot':2,'success':True,'private':SECRET.decode()}]*20,'statusDisagreements':[],'raw':SECRET.decode()}
  row=self.selected('native-candidate-window-audit',{'mint':'1'*44,'result':result,'dispatchTrace':trace,'availableAt':15001,'notBackdated':True});v=row['data'];self.assertEqual(v['dispatchTrace']['reasonCounts'],{'eligible':1,'peer-selected':22});self.assertEqual(v['dispatchTrace']['lastState']['context']['inFlight'],1);self.assertEqual(v['result']['requiredSignaturesCount'],20);self.assertEqual(v['result']['missingSuccessfulNotificationsCount'],20);self.assertEqual(len(v['result']['missingSuccessfulNotificationsDiagnosticSample']),16);self.assertTrue(v['result']['missingSuccessfulNotificationsSampleTruncated']);self.assertFalse(v['result']['complete']if'complete'in v['result']else False);self.assertNotIn(SECRET,m.encode(row));self.assertNotIn('SECRET_SENTINEL',m.encode(row).decode())
 def test_prediction_preserves_exact_feature_scalars_prices_and_age_without_becoming_financial_qualification(self):
  row=self.selected('native-predictive-assessment',{'at':12000,'financialQualification':False,'entryAgeEligible':True,'ageCohort':'entry-eligible','assessment':{'status':'failed','reason':'persistent-broad-buying-rule-not-met','qualified':False,'features':{'buyLamports':'100','sellLamports':'80','netBuyLamports':'20','tradeCount':8,'distinctBuyerWallets':3,'largestBuyerBps':7000,'positiveNetBuckets':2,'priceReturnBps':50,'firstPrice':{'quoteLamports':'100','tokenUnits':'8','private':SECRET.decode()},'lastPrice':{'quoteLamports':'101','tokenUnits':'8'},'rawTrades':[SECRET.decode()]},'secret':SECRET.decode()}})
  self.assertEqual(row['data']['assessment']['features']['firstPrice'],{'quoteLamports':'100','tokenUnits':'8'});self.assertFalse(row['data']['financialQualification']);self.assertEqual(row['data']['assessment']['status'],'failed');self.assertNotIn(SECRET,m.encode(row))
 def test_shape_and_storage_pressure_fail_instead_of_silently_truncating_diagnostic_records(self):
  with self.assertRaisesRegex(m.Guard,'AUDIT_PAGE_METADATA_BOUND'):self.selected('native-candidate-window-audit',{'result':{'pages':[{}]*7}})
  with self.assertRaisesRegex(m.Guard,'SCOPED_SUPPORT_METADATA_BOUND'):self.selected('native-flow-support-refresh-deferred',{'scopes':[{}]*7})
  with self.assertRaisesRegex(m.Guard,'EVENT_FIELD_BOUND'):self.selected('http-lifecycle-timing',{'connectionReuse':'x'*4097})
  with fixture()as f:
   raw=m.encode({'kind':'http-lifecycle-timing','data':{'reason':'x'*4096,'method':'getSignaturesForAddress','requestedAt':1,'httpWorkEndedAt':2}});put(f['run']/'events-001.ndjson',raw*1100)
   with self.assertRaisesRegex(m.Guard,'SELECTED_EVENT_TOTAL_BOUND'):prepare(f)
   self.assertFalse((f['root']/'export').exists())
 def test_actual_projection_archive_adds_diagnostics_but_never_raw_market_or_private_financial_data(self):
  with fixture()as f:
   raw=(f['run']/'events-001.ndjson').read_bytes();raw+=m.encode({'kind':'native-candidate-quality-gap','sequence':3,'receivedAt':'2026-10-28T12:34:56.789Z','data':{'mint':'1'*44,'at':1000,'reason':'NATIVE_FLOW_SUPPORT_EXPIRED','rawProviderPayload':SECRET.decode()}});raw+=m.encode({'kind':'http-headers','data':{'id':4,'at':1001,'status':429,'retryAfter':'2','authorization':SECRET.decode()}});put(f['run']/'events-001.ndjson',raw);prepare(f);entries=archive_entries(f);events=[json.loads(v)for v in entries['segments/0/selected-events.ndjson'].splitlines()];kinds=[v['kind']for v in events];self.assertIn('native-candidate-quality-gap',kinds);self.assertIn('http-headers',kinds);summary=json.loads(entries['event-summary.json'])[0];self.assertFalse(summary['completeMarketEvidenceIncluded']);self.assertIn('metadata only',summary['observationDiagnostics']);self.assertFalse(any(SECRET in v for v in entries.values()))

if __name__=='__main__':unittest.main()
