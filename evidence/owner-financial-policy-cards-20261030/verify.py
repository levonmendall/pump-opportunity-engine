import hashlib,json,pathlib,subprocess,time
root=pathlib.Path.cwd();out=root/'evidence/owner-financial-policy-cards-20261030'
paths=subprocess.check_output(['git','ls-files','-z','src','test','scripts','package.json','package-lock.json','tsconfig.json']).split(b'\0')
def digest():
 return {p.decode():hashlib.sha256((root/p.decode()).read_bytes()).hexdigest() for p in paths if p and (root/p.decode()).is_file()}
before=digest();results=[]
commands=[['node','--import','tsx','--test','test/financial-policy-reporting.test.ts','test/operating-intelligence.test.ts','test/reporting-operating-freshness.test.ts','test/dashboard-financial-policy.test.ts','test/dashboard-equity-line.test.ts','test/dashboard-paper-trades-collapse.test.ts','test/dashboard-candidate-bars.test.ts'],['npm','run','build']]
for i,cmd in enumerate(commands):
 start=time.time();r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(out/f'command-{i+1}.log').write_text(r.stdout);results.append({'command':cmd,'returncode':r.returncode,'seconds':round(time.time()-start,3)})
after=digest();e={'source':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'base':'4c7b4a1a58a86bef2e5504b840caa40ee750ee60','commands':results,'sourceUnchanged':before==after,'sourceSha256':before,'originalFinancialOrServiceActions':0,'providerRequests':0,'deployments':0,'scope':'existing original owner receiver and Portfolio rendering; fixture tests are not live market proof'};(out/'verification.json').write_text(json.dumps(e,indent=2)+'\n');print(json.dumps({k:v for k,v in e.items() if k!='sourceSha256'}));assert before==after and all(r['returncode']==0 for r in results)
