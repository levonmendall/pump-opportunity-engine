import hashlib,importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('resources',pathlib.Path(__file__).with_name('analyze-sustained-resources.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def fixture(self):
  index={'classification':'paper-public-projection-evidence','source':{'commit':'a'*40,'sha256':'b'*64},'accountId':'fixture','inceptionAt':1};rows=[]
  for i in range(4):
   cpu=[10,11.5,.5,3.5][i];delta=[None,1.5,None,3][i];fraction=[None,.1,None,.2][i];process={'liveProcesses':1,'membershipSha256':('1'if i<2 else'2')*64,'cpuSeconds':cpu,'rssBytes':100*(i+1),'cpuDeltaSeconds':delta,'oneCoreFraction':fraction};snap=[1000,16000,16000,46000][i]
   rows.append({'schemaVersion':1,'kind':'poe-paper-resource-sample-v1','source':index['source'],'accountId':'fixture','inceptionAt':1,'ordinal':0,'managementOnly':False,'at':1000+i*15000,'elapsedMs':i*15000,'intervalMs':None if not i else 15000,'collectionMs':1,'collectionCpuMicros':1000,'reason':'fixture','sourceRunId':'fixture-run','sourceSnapshotAt':snap,'processes':{'source':process,'publisher':None,'supervisor':None},'availableDiskBytes':1000-i*150,'availableMemoryBytes':2000,'sourceReportedUsage':{'rpc':{'newUnits':[1,16,16,46][i]}}})
  raw=b'\n'.join(json.dumps(r).encode()for r in rows)+b'\n';meta={'sourceRunId':'fixture-run','startedAt':1000,'stoppedAt':47000,'resourceTimeline':{'bytes':len(raw),'sha256':m.sha(raw),'samples':4}};files={'segments/0/supervision.json':json.dumps(meta).encode(),'segments/0/resource-samples.ndjson':raw};index['files']=[{'file':k,'bytes':len(v),'sha256':m.sha(v)}for k,v in files.items()];return index,files
 def test_stable_cpu_unknown_membership_and_snapshot_rates(self):
  index,files=self.fixture();s=m.analyze(index,files)['segments'][0];self.assertEqual(s['sampledElapsedSeconds'],45);self.assertEqual(s['processes']['source']['stableMembershipObservedCpuSeconds'],4.5);self.assertEqual(s['processes']['source']['stableMembershipCoveredSeconds'],30);self.assertEqual(s['processes']['source']['membershipChanges'],1);self.assertEqual(len(s['processes']['source']['unknownIntervals']),2);self.assertAlmostEqual(s['processes']['source']['intervalOneCoreFraction']['p95'],.195);self.assertAlmostEqual(s['headroom']['availableDiskBytes']['linearSlopePerSecond'],-10);self.assertEqual(s['sourceCounters']['rpc.newUnits']['samples'],3);self.assertAlmostEqual(s['sourceCounters']['rpc.newUnits']['linearSlopePerSecond'],1);self.assertEqual(s['timestampedSnapshots'][2]['snapshotLagMs'],15000)
 def test_index_integrity_is_required(self):
  index,files=self.fixture()
  with tempfile.TemporaryDirectory()as temp:
   p=pathlib.Path(temp)
   for k,v in files.items():(p/k).parent.mkdir(parents=True,exist_ok=True);(p/k).write_bytes(v)
   (p/'index.json').write_text(json.dumps(index));i,f=m.load(p);self.assertEqual(m.analyze(i,f)['segments'][0]['samples'],4);(p/'segments/0/resource-samples.ndjson').write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'integrity'):m.load(p)
 def test_fixed_startup_cutoff_keeps_warmup_jump_out_of_steady_plateau(self):
  import copy
  index,files=self.fixture();base=json.loads(files['segments/0/resource-samples.ndjson'].splitlines()[0]);rows=[];times=[0,100,200,299,300,315,330,345]
  for i,t in enumerate(times):
   r=copy.deepcopy(base);r.update(at=1000+t*1000,elapsedMs=t*1000,intervalMs=None if not i else (t-times[i-1])*1000,sourceSnapshotAt=1000+t*1000,availableDiskBytes=100000-t*10)
   process=r['processes']['source'];process.update(membershipSha256='1'*64,cpuSeconds=t*.1,rssBytes=100+t if t<300 else 500,cpuDeltaSeconds=None if not i else (t-times[i-1])*.1,oneCoreFraction=None if not i else .1);r['sourceReportedUsage']={'rpc':{'newUnits':t}};rows.append(r)
  raw=b'\n'.join(json.dumps(r).encode()for r in rows)+b'\n';meta=json.loads(files['segments/0/supervision.json']);meta['resourceTimeline'].update(bytes=len(raw),sha256=m.sha(raw),samples=len(rows));files['segments/0/supervision.json']=json.dumps(meta).encode();files['segments/0/resource-samples.ndjson']=raw
  result=m.analyze(index,files)['segments'][0];self.assertEqual(result['phasePolicy']['cutoffSeconds'],300);self.assertGreater(result['processes']['source']['rssBytes']['linearSlopePerSecond'],0);startup=result['phases']['startup'];steady=result['phases']['steady'];self.assertEqual(startup['samples'],4);self.assertEqual(steady['samples'],4);self.assertEqual(steady['firstElapsedSeconds'],300);self.assertEqual(startup['metrics']['processes']['source']['rssBytes']['linearSlopePerSecond'],1);self.assertEqual(steady['metrics']['processes']['source']['rssBytes']['linearSlopePerSecond'],0);self.assertAlmostEqual(steady['metrics']['processes']['source']['stableMembershipObservedCpuSeconds'],4.5);self.assertEqual(steady['metrics']['processes']['source']['stableMembershipCoveredSeconds'],45);self.assertEqual(len(steady['metrics']['processes']['source']['unknownIntervals']),1)
  short_rows=rows[:6];short_raw=b'\n'.join(json.dumps(r).encode()for r in short_rows)+b'\n';meta['resourceTimeline'].update(bytes=len(short_raw),sha256=m.sha(short_raw),samples=len(short_rows));files['segments/0/supervision.json']=json.dumps(meta).encode();files['segments/0/resource-samples.ndjson']=short_raw;short=m.analyze(index,files)['segments'][0]['phases']['steady'];self.assertEqual(short['status'],'UNKNOWN / INSUFFICIENT EVIDENCE');self.assertIsNone(short['metrics']);self.assertEqual(short['sampledElapsedSeconds'],15)
 def test_absent_timeline_reports_unavailable(self):
  index,files=self.fixture();files={'segments/0/supervision.json':b'{}'};s=m.analyze(index,files)['segments'][0];self.assertEqual(s['timelineStatus'],'UNAVAILABLE');self.assertNotIn('processes',s)
if __name__=='__main__':unittest.main()
