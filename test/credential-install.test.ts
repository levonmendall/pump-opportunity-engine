import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('credential installation is exclusive, secret-silent and excludes the recovery key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'poe-credential-fixture-'));chmodSync(dir,0o700);
  const source=join(dir,'bundle.json'),target=join(dir,'api-key');
  const key='fixture-api-key-only-not-real-1234567890',recovery='fixture-recovery-never-runtime';
  writeFileSync(source,JSON.stringify({walletPublicKey:'6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ',apiKey:key,privateKey:recovery}),{mode:0o600});
  const run=(dest=target)=>spawnSync(process.execPath,['scripts/install-provider-credential.mjs',source,dest],{encoding:'utf8'});
  try{
    const ok=run();assert.equal(ok.status,0);assert.equal(readFileSync(target,'utf8'),key);assert.equal(statSync(target).mode&0o777,0o600);
    assert.ok(!ok.stdout.includes(key)&&!ok.stderr.includes(key)&&!ok.stdout.includes(recovery));
    assert.notEqual(run().status,0);assert.equal(readFileSync(target,'utf8'),key);
    chmodSync(source,0o644);const bad=run(join(dir,'another'));
    assert.notEqual(bad.status,0);assert.ok(!bad.stdout.includes(key)&&!bad.stderr.includes(recovery));
  }finally{rmSync(dir,{recursive:true});}
});
