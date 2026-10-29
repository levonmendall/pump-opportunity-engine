#!/usr/bin/env python3
"""Prepare the existing nonroot staging workflow with already-frozen package pins."""
import pathlib,json,shutil,re,sys,hashlib
assert len(sys.argv)==3
root=pathlib.Path(sys.argv[1]);package=pathlib.Path(sys.argv[2]);pins=json.loads((package/'package-pins.json').read_bytes())
transport=package/'transport';raw=(transport/'transport.json').read_bytes();assert hashlib.sha256(raw).hexdigest()==pins['transportSha256'];t=json.loads(raw);assert t['source']==pins['source']
assert len(t['files'])==10 and pins['stage']=='/var/tmp/poe-original-adaptive-v2-upgrade'
assert t['indexSha256']==pins['indexSha256']and t['driverSha256']==pins['driverSha256']
folder=root/'operator/native-paper-ec2/adaptive-v2-upgrade-package'
if folder.exists():
 assert {p.name for p in folder.iterdir()}=={p.name for p in transport.iterdir()}
 assert all((folder/p.name).read_bytes()==p.read_bytes()for p in transport.iterdir())
else:folder.mkdir(parents=True)
for path in transport.iterdir():
 assert path.is_file()and path.name in {'transport.json'}|{r['packedFile']for r in t['files']}
 shutil.copyfile(path,folder/path.name)
p=root/'.github/workflows/poe-original-cutover-resume-stage.yml';s=p.read_text()
s=s.replace('POE original entry arming staging only','POE original active AdaptiveMomentumV2 staging only').replace('entry-arming-upgrade-package','adaptive-v2-upgrade-package').replace('/var/tmp/poe-original-entry-arming-upgrade','/var/tmp/poe-original-adaptive-v2-upgrade')
for field,key in [('transport_sha','transportSha256'),('index_sha','indexSha256'),('driver_sha','driverSha256')]:
 s,n=re.subn(field+"='[a-f0-9]{64}'",field+"='"+pins[key]+"'",s)
 assert n==1,(field,n)
s,n=s.replace(",'export-source-recovery-forensics-20261029.py':65536",""),s.count(",'export-source-recovery-forensics-20261029.py':65536")
assert n==1
p.write_text(s)
print(json.dumps({'workflow':str(p),'source':pins['source'],'indexSha256':pins['indexSha256'],'driverSha256':pins['driverSha256'],'transportSha256':pins['transportSha256'],'transportFiles':len(t['files']),'rootExecuted':False,'workflowDispatched':False}))
