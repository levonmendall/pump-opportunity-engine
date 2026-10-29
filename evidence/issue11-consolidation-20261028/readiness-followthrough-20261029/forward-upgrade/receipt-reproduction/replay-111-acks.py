import contextlib,hashlib,importlib.util,json,os,pathlib,runpy,subprocess,tempfile,types
from unittest.mock import patch
repo=pathlib.Path.cwd();target=repo/'operator/native-paper-ec2/run-authoritative-service.py'
old=subprocess.check_output(['git','show','HEAD:operator/native-paper-ec2/run-authoritative-service.py']);new=target.read_bytes();fixtures=runpy.run_path(str(repo/'operator/native-paper-ec2/test-authoritative-service.py'))
results=[]
for label,body in [('before',old),('after',new)]:
 module=types.ModuleType('independent_receipt_'+label);module.__file__=str(target);exec(compile(body,str(target),'exec'),module.__dict__)
 c=module.Supervisor(fixtures['manifest'](),None,{k:fixtures['Log']() for k in ['source','publisher','supervisor']})
 with tempfile.TemporaryDirectory(prefix='poe-TEST-ONLY-provenance-review-') as t:
  root=pathlib.Path(t);private=root/'private';private.mkdir(mode=0o700);public=root/'public';public.mkdir(mode=0o755);public.chmod(0o755)
  with patch.object(module,'ACCOUNT',private),patch.object(module,'SERVICE',private),patch.object(module,'PUBLIC',public):
   for i in range(1,112):
    at=module.INCEPTION+100000+i*15000;source=fixtures['status'](at);source['source']={**fixtures['SOURCE'],'kind':'immutable-startup-native-paper-bundle-closure','metadataSha256':'c'*64,'sqliteVersion':'13.0.3','addonSha256':'d'*64,'backupWorkerSha256':'e'*64,'packageLockSha256':'f'*64};c.last_source=module.validate_status(source,fixtures['manifest'](),at-2000,123,at)
    raw=(json.dumps(fixtures['snapshot'](at,str(i)),separators=(',',':'))+'\n').encode();snapshot=private/'snapshot.json';snapshot.write_bytes(raw);snapshot.chmod(0o600);a=fixtures['ack'](at,str(i),fingerprint=f'{i:064x}',raw_source_sha256=module.sha(raw));c.pending_acks.append(a);c.cache_source_snapshot(at+100)
   row={'version':label,'supervisorSha256':hashlib.sha256(body).hexdigest(),'matchedSourceAcknowledgements':c.accepted_source_count,'outputErrors':c.output_errors,'publicReceiptExists':(public/'accepted-source.json').exists(),'privateLatestExists':(private/'accepted-source-latest.json').exists(),'lastAckUnchanged':c.last_ack==a}
   if row['publicReceiptExists']:
    receipt=json.loads((public/'accepted-source.json').read_bytes());row.update(publicSourcePin=receipt['source'],lastSequence=receipt['sequence'],receiptMode=oct((public/'accepted-source.json').stat().st_mode&0o777))
   results.append(row)
 c.selector.close()
print(json.dumps({'offline':True,'temporaryFixturesOnly':True,'iterations':111,'results':results},separators=(',',':')))
