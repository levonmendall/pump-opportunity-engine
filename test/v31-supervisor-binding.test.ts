/** Pure supervisor validation/argv checks: no service, network or ledger access. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const script=join(process.cwd(),'operator/native-paper-ec2/run-authoritative-service.py');
function python(code:string){return JSON.parse(execFileSync('python3',['-B','-I','-c',`import importlib.util,json,pathlib,copy,sys
spec=importlib.util.spec_from_file_location('supervisor_offline',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
${code}`,script],{encoding:'utf8',timeout:5000,maxBuffer:16384}));}
test('supervisor admits explicitly bound V3.1 with four slots and preserves exact V3 cold-resume behavior',()=>{
 const result=python(`
manifest={'schemaVersion':1,'kind':'poe-authoritative-persistent-service-v1','source':{'commit':'a'*40,'sha256':'b'*64},'configurationSha256':'c'*64,'stage':'two','deepSlots':4,'strategy':m.LIQUIDITY_RESILIENT_V3_1_STRATEGY,'policy':m.POLICY,'files':[{'file':name,'bytes':1,'sha256':'d'*64}for name in m.RELEASE_FILES]}
for version in [m.LIQUIDITY_RESILIENT_STRATEGY,m.LIQUIDITY_RESILIENT_V3_1_STRATEGY]:
 manifest['strategy']=version;assert m.validate_manifest(manifest)==manifest
 args=m.source_args('/fixed/node',pathlib.Path('/fixed/release'),manifest)
 assert args[-2:]==['--strategy',version] and '--service' in args and '--resume' in args
 for field,value in [('deepSlots',3),('stage','three')]:
  bad=copy.deepcopy(manifest);bad[field]=value
  try:m.validate_manifest(bad)
  except m.Guard:pass
  else:raise AssertionError('unreviewed profile accepted')
print(json.dumps({'versions':2,'fourSlotsRequired':True,'sourceArgvBound':True}))`);
 assert.deepEqual(result,{versions:2,fourSlotsRequired:true,sourceArgvBound:true});
});
test('V3.1 source status cannot silently report V3/V2 or funded execution; ownership remains protected',()=>{
 const result=python(`
manifest={'source':{'commit':'a'*40,'sha256':'b'*64},'configurationSha256':'c'*64,'strategy':m.LIQUIDITY_RESILIENT_V3_1_STRATEGY}
status={'accountId':m.ACCOUNT_ID,'inceptionAt':m.INCEPTION,'mode':'paper','authoritative':True,'experimental':False,'financialExecutionAuthorized':True,'liveTradingEnabled':False,'source':manifest['source'],'configurationSha256':manifest['configurationSha256'],'persistent':True,'operatingMode':'persistent-service','managementOnly':False,'strategyVersion':manifest['strategy'],'activeStrategy':manifest['strategy'],'runtimePid':123,'startedAt':100,'generatedAt':200,'running':True,'runId':'native-paper-offline','positions':{str(i):{}for i in range(5)},'pending':{}}
assert m.validate_status(status,manifest,100,123,200)==status
for field,value in [('strategyVersion',m.LIQUIDITY_RESILIENT_STRATEGY),('activeStrategy',m.ADAPTIVE_STRATEGY),('liveTradingEnabled',True),('accountId','other')]:
 bad=copy.deepcopy(status);bad[field]=value
 try:m.validate_status(bad,manifest,100,123,200)
 except m.Guard:pass
 else:raise AssertionError('incorrect binding accepted')
print(json.dumps({'v31Required':True,'paperRequired':True,'retainedHoldingsAccepted':5}))`);
 assert.deepEqual(result,{v31Required:true,paperRequired:true,retainedHoldingsAccepted:5});
});
