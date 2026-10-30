/** Synthetic fixture keys/tokens only; never the real reporting token or host. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,timingSafeEqual} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,chmodSync,symlinkSync,linkSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {REPORTING_DELIVERY,publicReceipt,validateReceipt,validateNonce,validateSourceContext,canonicalTokenBytes,sealTokenBytes,unsealTokenBytes,readOwnerFile,installTokenFile,ensureOwnedParentComponents} from './reporting-token-transfer.mjs';
const T=1793158000000,nonce='1234567890abcdef1234567890abcdef',sourceStatusSha256='1'.repeat(64);
const fixture=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const receipt=()=>publicReceipt(nonce,fixture.publicKey,T,sourceStatusSha256);
const token=()=>Buffer.from('DISPOSABLE-REPORTING-FIXTURE-'+ 'x'.repeat(40));
function directory(t){const p=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-reporting-delivery-'));chmodSync(p,0o700);t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}

test('RSA3072 OAEP-SHA256 delivers only a384-byte cipher and binds exact public reporting context',()=>{
 const bytes=token(),r=receipt(),cipher=sealTokenBytes(bytes,r,T+1);assert.equal(cipher.length,384);assert.equal(cipher.includes(bytes),false);const restored=unsealTokenBytes(cipher,fixture.privateKey,r,T+2);assert.equal(timingSafeEqual(restored,bytes),true);
 for(const changed of [publicReceipt('a'.repeat(32),fixture.publicKey,T,sourceStatusSha256),publicReceipt(nonce,fixture.publicKey,T,'2'.repeat(64))])assert.throws(()=>unsealTokenBytes(cipher,fixture.privateKey,changed,T+2));
 const corrupt=Buffer.from(cipher);corrupt[10]^=1;assert.throws(()=>unsealTokenBytes(corrupt,fixture.privateKey,r,T+2));assert.throws(()=>unsealTokenBytes(cipher.subarray(1),fixture.privateKey,r,T+2),/CIPHERTEXT_LENGTH/);assert.equal(bytes.equals(token()),true,'caller fixture bytes are not rewritten');restored.fill(0);bytes.fill(0);
});

test('public receipt rejects wrong identity, provenance, age, key metadata and extra fields',()=>{
 const r=receipt();assert.equal(validateReceipt(r,T+1).publicKey,r.publicKey);assert.equal(r.publicKeySha256.length,64);
 for(const patch of [{purpose:'wallet'},{uid:0},{instanceId:'another-instance'},{awsAccountId:'000000000000'},{region:'another-region'},{accountId:'another-account'},{inceptionAt:1},{sourceStatusSha256:'bad'},{publicKeySha256:'0'.repeat(64)},{extra:'untrusted'}])assert.throws(()=>validateReceipt({...r,...patch},T+1));
 assert.throws(()=>validateReceipt(r,T-1),/EXPIRED_OR_FUTURE/);assert.throws(()=>validateReceipt(r,r.expiresAt),/EXPIRED_OR_FUTURE/);
 for(const n of ['../escape','a'.repeat(31),'z'.repeat(32)])assert.throws(()=>validateNonce(n));
 const context={accountId:REPORTING_DELIVERY.accountId,inceptionAt:REPORTING_DELIVERY.inceptionAt,sourceStatusSha256};assert.deepEqual(validateSourceContext(context),context);assert.throws(()=>validateSourceContext({...context,extra:true}));assert.throws(()=>validateSourceContext({...context,accountId:'poe-pilot-unrelated'}));
});

test('credential format retains the existing trim convention without accepting binary, short or oversized secrets',()=>{
 const original=token();assert.equal(timingSafeEqual(canonicalTokenBytes(Buffer.concat([Buffer.from('\n'),original,Buffer.from('\r\n')])),original),true);
 for(const bytes of [Buffer.alloc(31,97),Buffer.alloc(257,97),Buffer.from('a'.repeat(40)+' '+ 'b'.repeat(40)),Buffer.alloc(40,0),Buffer.alloc(40,255)])assert.throws(()=>canonicalTokenBytes(bytes));
});

test('owner reads reject symlinks, hardlinks, unsafe permissions, wrong owner and oversized inputs',t=>{
 const p=directory(t),file=join(p,'fixture.secret');writeFileSync(file,token(),{mode:0o600});assert.equal(readOwnerFile(file,256).equals(token()),true);
 chmodSync(file,0o644);assert.throws(()=>readOwnerFile(file,256),/OWNER_FILE/);chmodSync(file,0o600);assert.throws(()=>readOwnerFile(file,256,{uid:process.getuid()+1}),/OWNER_FILE/);assert.throws(()=>readOwnerFile(file,8),/OWNER_FILE/);
 symlinkSync(file,join(p,'symlink'));assert.throws(()=>readOwnerFile(join(p,'symlink'),256));linkSync(file,join(p,'hardlink'));assert.throws(()=>readOwnerFile(file,256),/OWNER_FILE/);unlinkSync(join(p,'hardlink'));assert.equal(readOwnerFile(file,256).equals(token()),true);
});

test('installation is private and idempotent, preserves differing existing data and rejects unrelated destinations',t=>{
 const p=directory(t),bytes=token(),file=join(p,'pilot-ingest.secret');assert.deepEqual(installTokenFile(p,'pilot-ingest.secret',bytes),{installed:true,existingMatched:false});assert.equal(lstatSync(file).mode&0o777,0o600);assert.equal(readFileSync(file).equals(bytes),true);assert.deepEqual(installTokenFile(p,'pilot-ingest.secret',bytes),{installed:true,existingMatched:true});
 const before=readFileSync(file);assert.throws(()=>installTokenFile(p,'pilot-ingest.secret',Buffer.from('DISPOSABLE-DIFFERENT-'+ 'y'.repeat(50))),/EXISTING_REPORTING_CREDENTIAL_DIFFERS/);assert.equal(readFileSync(file).equals(before),true);for(const name of ['wallet.json','../secret','..'])assert.throws(()=>installTokenFile(p,name,bytes),/INVALID_REPORTING_FILENAME/);
 chmodSync(p,0o755);assert.throws(()=>installTokenFile(p,'pilot-ingest.secret',bytes),/PRIVATE_OWNER_DIRECTORY/);
});

test('stale temporary files and destination symlinks fail without clobbering recovery data',t=>{
 const p=directory(t),temp=join(p,'.pilot-ingest.secret.delivery.tmp'),bytes=token();writeFileSync(temp,'DISPOSABLE interrupted file',{mode:0o600});assert.throws(()=>installTokenFile(p,'pilot-ingest.secret',bytes));assert.equal(readFileSync(temp,'utf8'),'DISPOSABLE interrupted file');unlinkSync(temp);
 const unrelated=join(p,'unrelated');writeFileSync(unrelated,'DISPOSABLE unrelated',{mode:0o600});symlinkSync(unrelated,join(p,'pilot-ingest.secret'));assert.throws(()=>installTokenFile(p,'pilot-ingest.secret',bytes));assert.equal(readFileSync(unrelated,'utf8'),'DISPOSABLE unrelated');
});

test('CLI rejects arbitrary file sources and host operations outside UID994 without emitting material',t=>{
 const p=directory(t);for(const args of [['host-prepare',nonce,join(p,'missing-context')],['cloud-seal','--secret-file','/arbitrary/key'],['unknown','DISPOSABLE_SECRET_SENTINEL']]){
  const result=spawnSync(process.execPath,['operator/reporting-delivery/reporting-token-transfer.mjs',...args],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'POE reporting-only delivery refused; no credential value disclosed.\n');assert.equal(result.stderr.includes('PRIVATE KEY'),false);
 }
});


test('missing owner parent components are created0700 sequentially without altering existing safe modes',t=>{
 const home=directory(t);ensureOwnedParentComponents(home);assert.equal(lstatSync(join(home,'.local')).mode&0o777,0o700);assert.equal(lstatSync(join(home,'.local/share')).mode&0o777,0o700);
 chmodSync(join(home,'.local'),0o755);chmodSync(join(home,'.local/share'),0o711);ensureOwnedParentComponents(home);assert.equal(lstatSync(join(home,'.local')).mode&0o777,0o755);assert.equal(lstatSync(join(home,'.local/share')).mode&0o777,0o711);
 const wrong=directory(t);assert.throws(()=>ensureOwnedParentComponents(wrong,process.getuid()+1),/UNSAFE_HOST_PARENT/);
 const unsafe=directory(t);mkdirSync(join(unsafe,'.local'),{mode:0o770});chmodSync(join(unsafe,'.local'),0o770);assert.throws(()=>ensureOwnedParentComponents(unsafe),/UNSAFE_HOST_PARENT/);assert.equal(lstatSync(join(unsafe,'.local')).mode&0o777,0o770);assert.throws(()=>lstatSync(join(unsafe,'.local/share')),/ENOENT/);
 const linked=directory(t),unrelated=directory(t);symlinkSync(unrelated,join(linked,'.local'));assert.throws(()=>ensureOwnedParentComponents(linked),/UNSAFE_HOST_PARENT/);assert.equal(lstatSync(join(linked,'.local')).isSymbolicLink(),true);
});
