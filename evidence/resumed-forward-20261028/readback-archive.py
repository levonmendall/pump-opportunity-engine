"""Fixed-run bounded readback through the existing administration route."""
import pathlib,json,subprocess,base64,hashlib,datetime,tarfile,os
ROOT=pathlib.Path('/workspace/poe-pilot/runs/native-retention-20261028142017'); EVIDENCE=pathlib.Path('/workspace/pump-opportunity-engine/evidence/resumed-forward-20261028')
RUNS=[(40706469436,0,4194304),(40706554963,4194304,2499268)]
EXPECTED_SHA='94d60ed5e11a88e61eaae7c571c833285abfc09f0d304ec7c8026963873e6fc9';EXPECTED_BYTES=6693572
parts=[];receipts=[]
for run,offset,length in RUNS:
 chunk=ROOT/('chunk-'+str(offset)+'.bin'); receipt=ROOT/('chunk-'+str(offset)+'-receipt.json')
 if chunk.exists() and receipt.exists():
  d=json.loads(receipt.read_text()); assert d['administrationRun']==run and d['footer']['offset']==offset and d['footer']['bytes']==length and hashlib.sha256(chunk.read_bytes()).hexdigest()==d['footer']['chunkSha256'];parts.append(chunk.read_bytes());receipts.append(d);continue
 status=json.loads(subprocess.check_output(['gh','api','repos/levonmendall/meme-machine-admin/actions/runs/'+str(run)],text=True));assert status['status']=='completed' and status['conclusion']=='success','READBACK_JOB_NOT_SUCCESSFULLY_COMPLETE'
 raw=subprocess.check_output(['gh','run','view',str(run),'--repo','levonmendall/meme-machine-admin','--log'],timeout=60);assert len(raw)<12*1024*1024
 records=[]
 for line in raw.decode().splitlines():
  i=line.find('Z {')
  if i<0:continue
  try:r=json.loads(line[i+2:])
  except ValueError:continue
  if r.get('kind') in ('header','data','footer'):records.append(r)
 assert records[0]['kind']=='header' and records[-1]['kind']=='footer'
 header,footer=records[0],records[-1];assert header['githubRunId']=='40704936322' and header['githubRunAttempt']=='1' and header['researchProfile']=='candidate-native-two-hour-90-research-v1'
 assert header['chunk']['sourceBlockMaximumBytes']==48*1024-256
 assert header['archive']['sha256']==EXPECTED_SHA and header['archive']['bytes']==EXPECTED_BYTES and footer['complete'] and footer['descriptorStatsStable']; assert footer['offset']==offset and footer['bytes']==length
 data=bytearray()
 for i,row in enumerate(records[1:-1]):
  assert row['kind']=='data' and row['index']==i and row['offset']==offset+len(data)
  block=base64.b64decode(row['base64'],validate=True);assert len(block)==row['bytes']<=header['chunk']['sourceBlockMaximumBytes'];data.extend(block)
 assert len(data)==length and hashlib.sha256(data).hexdigest()==footer['chunkSha256']
 chunk.write_bytes(data);os.chmod(chunk,0o600);d={'schemaVersion':1,'administrationRun':run,'header':header,'footer':footer,'logBytes':len(raw),'logSha256':hashlib.sha256(raw).hexdigest(),'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};receipt.write_text(json.dumps(d,indent=2)+'\n');parts.append(data);receipts.append(d);print(json.dumps({'verifiedChunkRun':run,'offset':offset,'bytes':len(data)}),flush=True)
archive=ROOT/'selected-evidence.tar.gz';body=b''.join(parts);assert len(body)==EXPECTED_BYTES and hashlib.sha256(body).hexdigest()==EXPECTED_SHA
if archive.exists():assert archive.read_bytes()==body
else:archive.write_bytes(body);os.chmod(archive,0o600)
artifact=ROOT/'artifact';artifact.mkdir(mode=0o700,exist_ok=True);total=0;names=set()
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers();assert len(members)<=256
 for m in members:
  p=pathlib.PurePosixPath(m.name);assert m.isfile() and not m.issym() and not m.islnk() and not p.is_absolute() and '..'not in p.parts and m.name not in names and 0<=m.size<=8*1024*1024
  names.add(m.name);total+=m.size;assert total<=192*1024*1024
  target=artifact/p;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);source=tar.extractfile(m);assert source is not None
  data=source.read(8*1024*1024+1);assert len(data)==m.size
  if target.exists():assert target.is_file() and not target.is_symlink() and target.read_bytes()==data
  else:
   with target.open('xb') as output:output.write(data)
  os.chmod(target,0o600)
index=json.loads((artifact/'index.json').read_text());verified=[]
for row in index['included']:
 p=artifact/row['path'];raw=p.read_bytes();assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];verified.append(row['path'])
assert not index['omittedSelectedEvidence']
result={'schemaVersion':1,'sourceRun':40704936322,'archiveBytes':len(body),'archiveSha256':EXPECTED_SHA,'wholeArchiveHashVerified':True,'indexFileHashesVerified':len(verified),'uncompressedBytes':total,'allSelectedSegmentsRetained':True,'chunks':receipts,'rawHostEvidenceDeletionPerformed':False,'financialFilesRead':False};(ROOT/'readback-receipt.json').write_text(json.dumps(result,indent=2)+'\n');(EVIDENCE/'readback-receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='chunks'}))
