"""One-shot read-only public evidence probe for existing research run40714364745."""
import os,pathlib,stat,json,hashlib,datetime,base64,time
UID=994;SOURCE='640143a5924a7ff7d98039967c2db17957f71f24';TARGET=1793201088374;MAX=192*1024*1024
ROOT=pathlib.Path('/home/mm-ec2-runner/.local/share/poe-native-research/poe-native-candidates-40714364745-1')
def need(v,r):
 if not v:raise RuntimeError(r)
def read(p,cap):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_uid==UID and a.st_nlink==1 and a.st_size<=cap,'BOUNDED_PUBLIC_FILE');b=os.read(fd,a.st_size+1);z=os.fstat(fd);need(len(b)==a.st_size and(a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_size,z.st_mtime_ns,z.st_ctime_ns),'ATOMIC_PUBLIC_READ');return b
 finally:os.close(fd)
need(os.getuid()==UID and ROOT.resolve()==ROOT,'FIXED_OWNER_PATH');st=ROOT.lstat();need(stat.S_ISDIR(st.st_mode)and st.st_uid==UID and stat.S_IMODE(st.st_mode)==0o700,'PRIVATE_RESEARCH_ROOT')
manifest=read(ROOT/'package.json',2*1024*1024);need(hashlib.sha256(manifest).hexdigest()=='2c06e5e7d4fe8be52ae6a35c8df50f0c09b5d12eab73f511c89f96839e638e54','EXACT_RESEARCH_MANIFEST');m=json.loads(manifest);need(m['source']['commit']==SOURCE and m['reportingBinding']['accountId']=='poe-pilot-8468add6-f916-48cf-a585-6cd008a81360','EXACT_SOURCE_ACCOUNT')
executable=read(ROOT/'native-candidates.mjs',8*1024*1024);need(hashlib.sha256(executable).hexdigest()==m['bundle']['sha256'],'EXACT_EXECUTABLE_FILE');
raw=read(ROOT/'run/status.json',8*1024*1024);s=json.loads(raw);need(s['source']==m['source']and s['financialWriterOpened']is False and s['mode']=='candidate-evaluation','CANDIDATE_ONLY_SOURCE')
procs=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  if p.stat().st_uid!=UID:continue
  args=(p/'cmdline').read_bytes().split(b'\0')
  if any(x.startswith(str(ROOT).encode()+b'/')for x in args):procs.append({'pid':int(p.name),'pgid':os.getpgid(int(p.name)),'commandSha256':hashlib.sha256(b'\0'.join(args)).hexdigest()})
 except(ProcessLookupError,FileNotFoundError,PermissionError):pass
out={'schemaVersion':1,'sourceRun':40714364745,'source':m['source'],'readAt':int(time.time()*1000),'targetSourceAt':TARGET,'statusSha256':hashlib.sha256(raw).hexdigest(),'currentSource':{k:s.get(k)for k in('runId','generatedAt','running','stopReason','physicalSettlementConfirmed','transportSettledAt','resources','unmanagedControlUnits','configurationSha256')},'currentCounters':s.get('engine',{}).get('counters'),'ownedResearchProcesses':procs,'records':[],'readOnly':True,'financialLedgerRead':False,'credentialsRead':False,'networkRequests':0,'rawEvidenceModified':False}
keep={'component-physical-start','component-physical-settled','component-physical-timeout','http-headers','pilot-rpc-unavailable','pilot-data-control-unavailable','native-flow-control-refused','native-flow-suppressed-library-control','native-flow-subscription-ack','native-flow-subscription-retired','native-flow-disconnected','native-flow-socket-error','native-flow-upgrade-refused','native-flow-refusal','native-candidate-quality-gap','native-candidate-retired','native-candidate-observation-open','native-candidate-audit-session-open','native-candidate-window-audit','native-candidate-window-audit-unavailable','native-predictive-window-expired','native-predictive-unavailable','native-independent-audit-warming','native-independent-audit-fence-warming','native-shared-audit-ceiling-requested','native-candidate-work-unavailable','native-candidate-feature-view','native-candidate-audit-cancelled-after-page-return','native-candidate-audit-cancelled-diagnostic'}
total=0;done=False;counts={};files=[];lastTime=0
for file in sorted((ROOT/'run/events').glob('events-[0-9][0-9][0-9].ndjson')):
 need(file.parent.resolve()==ROOT/'run/events','PUBLIC_EVENT_PATH');b=read(file,8*1024*1024);total+=len(b);need(total<=MAX,'TOTAL_PUBLIC_READ_BOUND');files.append({'file':str(file.relative_to(ROOT)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
 for lineNo,line in enumerate(b.splitlines(),1):
  if not line.strip():continue
  try:r=json.loads(line)
  except ValueError:need(file==sorted((ROOT/'run/events').glob('events-[0-9][0-9][0-9].ndjson'))[-1]and not b.endswith(b'\n'),'UNEXPECTED_PARTIAL_EVENT');break
  at=int(datetime.datetime.fromisoformat(r['receivedAt'].replace('Z','+00:00')).timestamp()*1000);need(at>=lastTime,'EVENT_CLOCK_ORDER');lastTime=at
  if at>TARGET:done=True;break
  k=r['kind'];counts[k]=counts.get(k,0)+1
  if k not in keep:continue
  d=r['data'];record={'kind':k,'recordedAt':at,'evidence':{'file':str(file.relative_to(ROOT)),'line':lineNo,'sha256':hashlib.sha256(line+b'\n').hexdigest()}}
  if k=='native-candidate-window-audit':
   a=d['result'];record['data']={key:d.get(key)for key in('mint','availableAt','notBackdated')};record['data']['result']={key:a.get(key)for key in('status','reason','complete','pool','target','startedAt','availableAt','requestAttempts','pages','historyRows','interiorRows','historyRangeCovered','retryAt','anchorKind','strictInteriorSlots','contextFences')};record['data']['result']['requiredSignatureCount']=len(a.get('requiredSignatures',[]));record['data']['result']['missingNotifications']=a.get('missingNotifications',[]);record['data']['result']['unconfirmedCapturedSignatures']=a.get('unconfirmedCapturedSignatures',[]);record['fullDataSha256']=hashlib.sha256(json.dumps(d,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  elif k=='native-candidate-feature-view':record['data']={key:d.get(key)for key in('mint','at','auditVerified','financialQualification')};record['data']['features']={key:d.get('features',{}).get(key)for key in('windowStartAt','windowEndAt','sufficientlyObserved','qualityReason','tradeCount','netBuyLamports','distinctBuyerWallets','positiveNetBuckets')}
  else:record['data']=d
  out['records'].append(record);need(len(out['records'])<=6000,'DIAGNOSTIC_RECORD_BOUND')
 if done:break
out['eventCountsThroughTarget']=counts;out['inputFiles']=files;out['inputBytes']=total;out['targetPrefixComplete']=done;out['classification']='ACTUAL_SOURCE_PREFIX_DIAGNOSTICS_NOT_ENTIRE_SOURCE_ARCHIVE';payload=(json.dumps(out,separators=(',',':'))+'\n').encode();need(len(payload)<=2*1024*1024,'DIAGNOSTIC_OUTPUT_BOUND');digest=hashlib.sha256(payload).hexdigest();print(json.dumps({'kind':'diagnostic-header','sourceRun':40714364745,'bytes':len(payload),'sha256':digest,'chunks':(len(payload)+39999)//40000}))
for i in range(0,len(payload),40000):print(json.dumps({'kind':'diagnostic-data','index':i//40000,'offset':i,'bytes':len(payload[i:i+40000]),'base64':base64.b64encode(payload[i:i+40000]).decode()}))
print(json.dumps({'kind':'diagnostic-footer','complete':True,'bytes':len(payload),'sha256':digest}))
