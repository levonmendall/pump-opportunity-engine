#!/usr/bin/env python3
"""Local-only deterministic package assembly; no privileged or runtime operation."""
import ast,copy,gzip,hashlib,importlib.util,io,json,os,pathlib,re,shlex,shutil,subprocess,sys,types
ROOT=pathlib.Path('/workspace/poe-original-two-position-upgrade')
OLD=ROOT/'evidence/issue11-consolidation-20261028/entry-readiness-recovery-20261029/arming-v2/upgrade-package'
OUTPUT=ROOT/'evidence/issue11-consolidation-20261028/adaptive-momentum-v2-20261029/upgrade-package'
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return(json.dumps(v,separators=(',',':'))+'\n').encode()
def module(name,path):
 raw=path.read_bytes();m=types.ModuleType(name);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m
assert len(sys.argv)==4
bundle=pathlib.Path(sys.argv[1]);commit=sys.argv[2];configuration=sys.argv[3]
assert re.fullmatch('[a-f0-9]{40}',commit)and re.fullmatch('[a-f0-9]{64}',configuration)
f=module('poe_local_entry_upgrade',ROOT/'operator/native-paper-ec2/forward-original-upgrade.py')
assert f.NEW_CONFIGURATION_SHA==configuration and f.hashed(f.NEW_REPORTER)and f.hashed(f.NEW_BACKUP_WORKER_SHA)and f.hashed(f.NEW_SUPERVISOR)
assert not OUTPUT.exists(),'Never overwrite a frozen package'
old_raw=(OLD/'service.json').read_bytes();assert sha(old_raw)==f.OLD_MANIFEST
old=json.loads(old_raw);assert old['source']==f.OLD_SOURCE and old['configurationSha256']==f.OLD_CONFIGURATION_SHA
metadata=json.loads((bundle/'metadata.json').read_bytes());assert metadata['git']['commit']==commit and metadata['financialMode']=='PAPER'and metadata['liveTradingEnabled']is False
OUTPUT.mkdir(parents=True,mode=0o700)
data={}
for name in ['native-paper.mjs','backup-worker.mjs','better_sqlite3.node','metadata.json','snapshot-publisher.mjs']:data[name]=(bundle/name).read_bytes()
data['run-authoritative-service.py']=(ROOT/'operator/native-paper-ec2/run-authoritative-service.py').read_bytes()
data['poe-runtime-persistent.conf']=(OLD/'poe-runtime-persistent.conf').read_bytes()
assert sha(data['run-authoritative-service.py'])==f.NEW_SUPERVISOR
assert sha((OLD/'run-authoritative-service.py').read_bytes())==f.OLD_SUPERVISOR
data['forward-original-upgrade.py']=(ROOT/'operator/native-paper-ec2/forward-original-upgrade.py').read_bytes()
assert sha(data['native-paper.mjs'])!=f.OLD_SOURCE['sha256']
for name,digest in f.UNCHANGED.items():assert sha(data[name])==digest,name
assert sha(data['backup-worker.mjs'])==f.NEW_BACKUP_WORKER_SHA
assert next(r['sha256']for r in old['files']if r['file']=='backup-worker.mjs')==f.OLD_BACKUP_WORKER_SHA
assert sha(data['snapshot-publisher.mjs'])==f.NEW_REPORTER
assert next(r['sha256']for r in old['files']if r['file']=='snapshot-publisher.mjs')==f.OLD_REPORTER
assert sha(data['poe-runtime-persistent.conf'])==f.NEW_NATIVE_DROPIN_SHA
manifest=copy.deepcopy(old);manifest['source']={'commit':commit,'sha256':sha(data['native-paper.mjs'])};manifest['configurationSha256']=configuration;manifest['stage']=f.NEW_STAGE;manifest['strategy']=f.NEW_STRATEGY
for row in manifest['files']:row.update(bytes=len(data[row['file']]),sha256=sha(data[row['file']]))
f.preserved_manifest(old,manifest);data['service.json']=encoded(manifest)
assert set(data)==set(f.BOUNDS)
for name,b in data.items():assert 0<len(b)<=f.BOUNDS[name]
index={'schemaVersion':1,'kind':'poe-original-forward-upgrade-package-v1','sourceCommit':commit,'previousSource':f.OLD_SOURCE,'compatibility':f.COMPATIBILITY,'files':[{'file':name,'bytes':len(body),'sha256':sha(body)}for name,body in data.items()]}
index_raw=encoded(index);driver_sha=sha(data['forward-original-upgrade.py']);index_sha=sha(index_raw)
for name,b in {**data,'index.json':index_raw}.items():p=OUTPUT/name;p.write_bytes(b);p.chmod(0o600)
sup=f.release_supervisor(data);actual=f.bundle(OUTPUT,os.getuid(),index_sha,driver_sha,sup);assert actual[1]==manifest
transport_dir=OUTPUT/'transport';transport_dir.mkdir(mode=0o700);transport={'schemaVersion':1,'kind':'poe-original-forward-transport-v1','source':manifest['source'],'indexSha256':index_sha,'driverSha256':driver_sha,'files':[]}
for name,b in {**data,'index.json':index_raw}.items():
 mem=io.BytesIO()
 with gzip.GzipFile(filename='',fileobj=mem,mode='wb',mtime=0)as z:z.write(b)
 packed=mem.getvalue();assert gzip.decompress(packed)==b;p=transport_dir/(name+'.gz');p.write_bytes(packed);p.chmod(0o600)
 transport['files'].append({'file':name,'bytes':len(b),'sha256':sha(b),'packedFile':name+'.gz','packedBytes':len(packed),'packedSha256':sha(packed)})
transport_raw=encoded(transport);(transport_dir/'transport.json').write_bytes(transport_raw);(transport_dir/'transport.json').chmod(0o600)
code='; '.join(['import os,stat,hashlib,sys','r='+json.dumps('/var/lib/poe-cutover/forward-'+commit+'/forward-original-upgrade.py'),'p=r if os.path.lexists(r) else '+json.dumps(str(f.STAGE/'forward-original-upgrade.py')),'f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)','s=os.fstat(f)','assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==(0 if p==r else 994) and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=131072','b=os.read(f,s.st_size+1)','os.close(f)','h=hashlib.sha256(b).hexdigest()','assert len(b)==s.st_size and h=='+json.dumps(driver_sha),'sys.argv=[p,"apply",'+json.dumps(index_sha)+']','exec(compile(b,p,"exec"),{"__name__":"__main__","__file__":p,"__poe_verified_driver_sha256__":h})'])
ast.parse(code);owner='sudo /usr/bin/python3 -B -I -c '+shlex.quote(code)+'\n';assert shlex.split(owner)[-1]==code
(OUTPUT/'OWNER_APPLY.txt').write_text(owner)
pins={'kind':'poe-original-active-adaptive-v2-upgrade-pins-v1','source':manifest['source'],'previousSource':f.OLD_SOURCE,'configurationSha256':configuration,'previousConfigurationSha256':f.OLD_CONFIGURATION_SHA,'driverSha256':driver_sha,'indexSha256':index_sha,'manifestSha256':sha(data['service.json']),'transportSha256':sha(transport_raw),'ownerCommandSha256':sha(owner.encode()),'stage':str(f.STAGE),'strategyVersion':f.NEW_STRATEGY,'previousStrategyVersion':f.OLD_STRATEGY,'deepSlots':4,'financialPositionLimit':2,'strategyChanged':True,'baselineEntryExitThresholdsPreserved':False,'completeRelevantTradingEvidencePreserved':True,'supervisorTransition':{'oldSha256':f.OLD_SUPERVISOR,'newSha256':f.NEW_SUPERVISOR,'oldNativeReceivesStrategyFlag':False},'historicalForensicReuse':{'artifactSha256':f.FORENSIC_ARTIFACT_SHA,'artifactBytes':f.FORENSIC_ARTIFACT_BYTES,'previousRootProofRequired':True,'newExporterExecuted':False},'files':index['files']}
(OUTPUT/'package-pins.json').write_text(json.dumps(pins,indent=2)+'\n');(OUTPUT/'transport-pins.json').write_text(json.dumps(transport,indent=2)+'\n')
script='import assert from "node:assert/strict";import{pathToFileURL}from"node:url";const m=await import(pathToFileURL('+json.dumps(str(OUTPUT/'native-paper.mjs'))+').href);const actual=m.nativePaperConfigurationSha256({service:true,stage:"two",deepSlots:4,strategy:"adaptive-momentum-v2"});assert.equal(actual,'+json.dumps(configuration)+');console.log(JSON.stringify({source:'+json.dumps(commit)+',configurationSha256:actual,measurementExecuted:false,financialAccountRead:false}));'
r=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,capture_output=True,text=True,check=True,timeout=30);(OUTPUT/'frozen-configuration-import.json').write_text(r.stdout);(OUTPUT/'frozen-configuration-import.stderr.txt').write_text(r.stderr)
(OUTPUT/'validation.json').write_text(json.dumps({'kind':'poe-original-active-adaptive-v2-offline-validation-v1','offlineBundleValidation':'PASS actual inert bundle/old025abb-to-active-profile supervisor transition','exactCurrentManifestSha256':sha(old_raw),'fourSlotsPreserved':True,'singleToTwoPositionStageVerified':True,'strategyVersion':f.NEW_STRATEGY,'exactPreservedManifestValidation':'PASS','metadataCommit':commit,'unchangedAddonUnit':True,'supervisorTransitionSeparatelyPinned':{'oldSha256':f.OLD_SUPERVISOR,'newSha256':f.NEW_SUPERVISOR},'oldAndNewReportersSeparatelyPinned':{'oldSha256':f.OLD_REPORTER,'newSha256':f.NEW_REPORTER},'oldAndNewCompiledBackupWorkerPins':{'previousSha256':f.OLD_BACKUP_WORKER_SHA,'newSha256':f.NEW_BACKUP_WORKER_SHA},'unitAndPolicyUnchanged':True,'ownerCommandPythonSyntaxAndShellRoundTrip':'PASS','historicalForensicProofOnly':True,'newDiagnosticExportRequired':False,'packageFileCount':len(data),'transportFileCount':len(transport['files']),'transportSha256':sha(transport_raw),'rootCommandExecuted':False,'serviceControlled':False,'financialDatabaseOpened':False,'deployed':False,'ownerCommandSha256':sha(owner.encode())},indent=2)+'\n')
print(json.dumps(pins,indent=2))
