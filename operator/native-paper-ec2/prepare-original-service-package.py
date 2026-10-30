#!/usr/bin/env python3
"""Assemble reviewed public code/config/usage bytes; no ledger or network access."""
import argparse,importlib.util,json,os,pathlib,shlex
HERE=pathlib.Path(__file__).resolve().parent
def load(name):
 path=HERE/name;spec=importlib.util.spec_from_file_location(name.replace('-','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def need(value,reason):
 if not value:raise ValueError(reason)
def main():
 p=argparse.ArgumentParser();p.add_argument('--bundle',required=True,type=pathlib.Path);p.add_argument('--service-manifest',required=True,type=pathlib.Path);p.add_argument('--input',required=True,type=pathlib.Path);p.add_argument('--baseline',required=True,type=pathlib.Path);p.add_argument('--original-status',required=True,type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path);a=p.parse_args();need(os.getuid()!=0,'PREPARATION_MUST_BE_NONROOT');os.umask(0o077)
 m=load('cutover-original-service.py');s=load('run-authoritative-service.py');bounds={**s.RELEASE_FILES,**m.EXTRA};need(a.bundle.resolve(strict=True)==a.bundle and a.output.is_absolute()and not a.output.exists(),'CANONICAL_FROZEN_BUNDLE_AND_NEW_OUTPUT_REQUIRED')
 paths={name:a.bundle/name for name in s.RELEASE_FILES};paths.update({'service.json':a.service_manifest,'input.json':a.input,'research-baseline.json':a.baseline,'original-status.json':a.original_status});paths.update({name:HERE/name for name in['cutover-original-service.py','run-authoritative-service.py','audit-original-account.py','poe-runtime-persistent.conf']});need(set(paths)==set(bounds),'EXACT_PREPARATION_FILES_REQUIRED');data={name:m.read(path,bounds[name],os.getuid())for name,path in paths.items()};manifest=s.validate_manifest(json.loads(data['service.json']));m.validate_input(json.loads(data['input.json']),manifest,data['research-baseline.json']);need(m.sha(data['original-status.json'])==json.loads(data['input.json'])['reportingBinding']['sourceStatusSha256'],'ORIGINAL_STATUS_PROOF_HASH_REQUIRED')
 for row in manifest['files']:need(row['bytes']==len(data[row['file']])and row['sha256']==m.sha(data[row['file']]),'EXACT_FROZEN_RELEASE_HASH_REQUIRED')
 metadata=json.loads(data['metadata.json']);need(metadata.get('git',{}).get('commit')==manifest['source']['commit']and metadata.get('liveTradingEnabled')is False and metadata.get('financialMode')=='PAPER','PAPER_ONLY_FROZEN_PACKAGE_REQUIRED')
 a.output.mkdir(mode=0o700);uid=os.getuid();gid=os.getgid()
 for name,raw in data.items():m.atomic(a.output/name,raw,uid,gid)
 index={'schemaVersion':1,'kind':'poe-original-cutover-package-v1','sourceCommit':manifest['source']['commit'],'files':[{'file':name,'bytes':len(raw),'sha256':m.sha(raw)}for name,raw in sorted(data.items())]};raw=(json.dumps(index,separators=(',',':'))+'\n').encode();m.atomic(a.output/'index.json',raw,uid,gid)
 index_hash=m.sha(raw);driver_hash=m.sha(data['cutover-original-service.py']);driver_path='/var/tmp/poe-issue11-staging/cutover-original-service.py';code="import os,stat,hashlib,sys; p="+repr(driver_path)+"; f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK); s=os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==994 and not s.st_mode&0o022 and 0<s.st_size<=131072; b=os.read(f,s.st_size+1); os.close(f); assert len(b)==s.st_size and hashlib.sha256(b).hexdigest()=="+repr(driver_hash)+"; sys.argv=[p,'bootstrap',"+repr(index_hash)+"]; exec(compile(b,p,'exec'),{'__name__':'__main__','__file__':p})";owner_command='sudo /usr/bin/python3 -B -I -c '+shlex.quote(code)
 print(json.dumps({'kind':'POE_ORIGINAL_PACKAGE_PREPARED_NOT_DEPLOYED','directory':str(a.output),'source':manifest['source'],'indexSha256':index_hash,'driverSha256':driver_hash,'files':len(data),'bytes':sum(map(len,data.values())),'financialAccountOpened':False,'providerRequests':0,'hostDeployment':False,'ownerOnlyOneTimeCommandAfterVerifiedHostStaging':owner_command},separators=(',',':')))
if __name__=='__main__':main()
