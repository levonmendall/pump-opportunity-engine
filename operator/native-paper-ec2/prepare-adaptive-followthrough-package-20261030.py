#!/usr/bin/env python3
"""Local-only final package assembly. No service, financial account or provider access."""
import ast,copy,gzip,hashlib,io,json,os,pathlib,re,shlex,subprocess,sys,types

ROOT=pathlib.Path(__file__).resolve().parents[2]
OLD=ROOT/'evidence/provider-protection-recovery-20261030/upgrade-package-final'
OUTPUT=ROOT/'evidence/adaptive-followthrough-20261030/upgrade-package-final'
COMMIT='69aa1ef214a8c79524a25a8aca79299ccaad93dc'
BUNDLE_SHA='bbdd0515089a823600c158c668e6a3f76a0a92525422d63677989d963ae43480'
METADATA_SHA='e64fb548f2ffdee50898b67432a05f20710160039b9291bfc731f3379f209042'
CONFIGURATION='ac4a5f288a46b19b605eb5ee53a3f8df34d08b361d5c00346f7c45021f51f8db'
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return(json.dumps(v,separators=(',',':'))+'\n').encode()
def module(name,path):
 raw=path.read_bytes();m=types.ModuleType(name);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def main():
 assert len(sys.argv)==2
 assert type(COMMIT)is str and re.fullmatch('[a-f0-9]{40}',COMMIT)and all(type(v)is str and re.fullmatch('[a-f0-9]{64}',v)for v in[BUNDLE_SHA,METADATA_SHA,CONFIGURATION]),'Final independently reviewed source, artifact and configuration pins required before package creation'
 bundle=pathlib.Path(sys.argv[1]).resolve(strict=True)
 f=module('poe_local_frozen_protection_driver',ROOT/'operator/native-paper-ec2/forward-original-upgrade.py')
 assert f.NEW_CONFIGURATION_SHA==CONFIGURATION
 assert not OUTPUT.exists(),'Never overwrite a frozen package'
 old_raw=(OLD/'service.json').read_bytes();assert sha(old_raw)==f.OLD_MANIFEST
 old=json.loads(old_raw);assert old['source']==f.OLD_SOURCE and old['configurationSha256']==f.OLD_CONFIGURATION_SHA
 assert sha((bundle/'native-paper.mjs').read_bytes())==BUNDLE_SHA
 assert sha((bundle/'metadata.json').read_bytes())==METADATA_SHA
 metadata=json.loads((bundle/'metadata.json').read_bytes());assert metadata['git']['commit']==COMMIT and metadata['financialMode']=='PAPER'and metadata['liveTradingEnabled']is False
 data={name:(bundle/name).read_bytes()for name in['native-paper.mjs','backup-worker.mjs','better_sqlite3.node','metadata.json','snapshot-publisher.mjs']}
 for name in['run-authoritative-service.py','forward-original-upgrade.py',f.FORENSIC_FILE]:data[name]=(ROOT/'operator/native-paper-ec2'/name).read_bytes()
 data['poe-runtime-persistent.conf']=(OLD/'poe-runtime-persistent.conf').read_bytes()
 assert sha(data['run-authoritative-service.py'])==f.NEW_SUPERVISOR
 assert sha((OLD/'run-authoritative-service.py').read_bytes())==f.OLD_SUPERVISOR
 for name,digest in f.UNCHANGED.items():assert sha(data[name])==digest,name
 assert sha(data['backup-worker.mjs'])==f.NEW_BACKUP_WORKER_SHA
 assert sha(data['snapshot-publisher.mjs'])==f.NEW_REPORTER
 assert sha(data['poe-runtime-persistent.conf'])==f.NEW_NATIVE_DROPIN_SHA
 assert sha(data[f.FORENSIC_FILE])==f.FORENSIC_SHA
 manifest=copy.deepcopy(old);manifest['source']={'commit':COMMIT,'sha256':BUNDLE_SHA};manifest['configurationSha256']=CONFIGURATION
 manifest['stage']=f.NEW_STAGE;manifest['strategy']=f.NEW_STRATEGY
 for row in manifest['files']:row.update(bytes=len(data[row['file']]),sha256=sha(data[row['file']]))
 f.preserved_manifest(old,manifest);data['service.json']=encoded(manifest)
 assert set(data)==set(f.BOUNDS)
 for name,b in data.items():assert 0<len(b)<=f.BOUNDS[name],name
 index={'schemaVersion':1,'kind':'poe-original-forward-upgrade-package-v1','sourceCommit':COMMIT,'previousSource':f.OLD_SOURCE,'compatibility':f.COMPATIBILITY,'files':[{'file':name,'bytes':len(body),'sha256':sha(body)}for name,body in data.items()]}
 index_raw=encoded(index);driver_sha=sha(data['forward-original-upgrade.py']);index_sha=sha(index_raw)
 OUTPUT.mkdir(parents=True,mode=0o700)
 for name,b in {**data,'index.json':index_raw}.items():p=OUTPUT/name;p.write_bytes(b);p.chmod(0o600)
 sup=f.release_supervisor(data);actual=f.bundle(OUTPUT,os.getuid(),index_sha,driver_sha,sup);assert actual[1]==manifest
 transport_dir=OUTPUT/'transport';transport_dir.mkdir(mode=0o700)
 transport={'schemaVersion':1,'kind':'poe-original-forward-transport-v1','source':manifest['source'],'indexSha256':index_sha,'driverSha256':driver_sha,'files':[]}
 for name,b in {**data,'index.json':index_raw}.items():
  mem=io.BytesIO()
  with gzip.GzipFile(filename='',fileobj=mem,mode='wb',mtime=0)as z:z.write(b)
  packed=mem.getvalue();assert gzip.decompress(packed)==b;p=transport_dir/(name+'.gz');p.write_bytes(packed);p.chmod(0o600)
  transport['files'].append({'file':name,'bytes':len(b),'sha256':sha(b),'packedFile':name+'.gz','packedBytes':len(packed),'packedSha256':sha(packed)})
 transport_raw=encoded(transport);(transport_dir/'transport.json').write_bytes(transport_raw);(transport_dir/'transport.json').chmod(0o600)
 code='; '.join(['import os,stat,hashlib,sys','r='+json.dumps('/var/lib/poe-cutover/forward-'+COMMIT+'/forward-original-upgrade.py'),'p=r if os.path.lexists(r) else '+json.dumps(str(f.STAGE/'forward-original-upgrade.py')),'f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)','s=os.fstat(f)','assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==(0 if p==r else 994) and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=131072','b=os.read(f,s.st_size+1)','os.close(f)','h=hashlib.sha256(b).hexdigest()','assert len(b)==s.st_size and h=='+json.dumps(driver_sha),'sys.argv=[p,"apply",'+json.dumps(index_sha)+']','exec(compile(b,p,"exec"),{"__name__":"__main__","__file__":p,"__poe_verified_driver_sha256__":h})'])
 ast.parse(code);owner='sudo /usr/bin/python3 -B -I -c '+shlex.quote(code)+'\n';assert shlex.split(owner)[-1]==code
 (OUTPUT/'OWNER_APPLY.txt').write_text(owner)
 pins={'kind':'poe-original-adaptive-followthrough-upgrade-pins-v1','source':manifest['source'],'previousSource':f.OLD_SOURCE,'configurationSha256':CONFIGURATION,'previousConfigurationSha256':f.OLD_CONFIGURATION_SHA,'driverSha256':driver_sha,'indexSha256':index_sha,'manifestSha256':sha(data['service.json']),'transportSha256':sha(transport_raw),'ownerCommandSha256':sha(owner.encode()),'stage':str(f.STAGE),'strategyVersion':f.NEW_STRATEGY,'previousStrategyVersion':f.OLD_STRATEGY,'deepSlots':4,'financialPositionLimit':2,'strategyChanged':f.COMPATIBILITY['strategyChanged'],'strategyBehaviorChanged':f.COMPATIBILITY['strategyBehaviorChanged'],'adaptiveExitInputChanged':f.COMPATIBILITY['adaptiveExitInputChanged'],'entryAcquisitionOrderingChanged':f.COMPATIBILITY['entryAcquisitionOrderingChanged'],'riskChanged':f.COMPATIBILITY['riskChanged'],'hardFinancialControlsClearedByInstaller':False,'ownerDailyLossResetInvoked':False,'forensicPreflight':{'scriptSha256':f.FORENSIC_SHA,'source':f.OLD_SOURCE,'runId':f.FORENSIC_RUN,'beforeFirstStop':True,'readerUid':988,'readerGid':982,'financialDatabaseOpened':False},'postStartExecutableRollbackAllowed':False,'providerCounterbooksRestored':False,'files':index['files']}
 (OUTPUT/'package-pins.json').write_text(json.dumps(pins,indent=2)+'\n');(OUTPUT/'transport-pins.json').write_text(json.dumps(transport,indent=2)+'\n')
 script='import assert from "node:assert/strict";import{pathToFileURL}from"node:url";const m=await import(pathToFileURL('+json.dumps(str(OUTPUT/'native-paper.mjs'))+').href);const actual=m.nativePaperConfigurationSha256({service:true,stage:"two",deepSlots:4,strategy:"adaptive-momentum-v2"});assert.equal(actual,'+json.dumps(CONFIGURATION)+');console.log(JSON.stringify({source:'+json.dumps(COMMIT)+',configurationSha256:actual,measurementExecuted:false,financialAccountRead:false}));'
 r=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,capture_output=True,text=True,check=True,timeout=30)
 (OUTPUT/'frozen-configuration-import.json').write_text(r.stdout);(OUTPUT/'frozen-configuration-import.stderr.txt').write_text(r.stderr)
 (OUTPUT/'validation.json').write_text(json.dumps({'kind':'poe-original-adaptive-followthrough-offline-validation-v1','offlineBundleValidation':'PASS strict actual bundle/manifest validation','exactCurrentManifestSha256':sha(old_raw),'fourSlotsPreserved':True,'twoPositionStagePreserved':True,'strategyVersion':f.NEW_STRATEGY,'metadataCommit':COMMIT,'supervisorAndUnitAndResourcePolicyUnchanged':True,'backupWorkerChanged':f.OLD_BACKUP_WORKER_SHA!=f.NEW_BACKUP_WORKER_SHA,'newDiagnosticExportRequired':True,'hardFinancialControlsClearedByInstaller':False,'ownerDailyLossResetInvoked':False,'postStartExecutableRollbackAllowed':False,'ownerCommandPythonSyntaxAndShellRoundTrip':'PASS','packageFileCount':len(data),'transportFileCount':len(transport['files']),'transportSha256':sha(transport_raw),'rootCommandExecuted':False,'serviceControlled':False,'financialDatabaseOpened':False,'deployed':False,'ownerCommandSha256':sha(owner.encode())},indent=2)+'\n')
 print(json.dumps(pins,indent=2))

if __name__=='__main__':main()
