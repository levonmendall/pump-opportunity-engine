import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';
import {verifyNativePaperBundleSource} from '../src/native-paper-bundle.js';
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
test('unbundled helper cannot grant compiled PAPER provenance',()=>assert.throws(()=>verifyNativePaperBundleSource('/tmp/native-paper.mjs',{commit:'a'.repeat(40),sha256:'b'.repeat(64)}),/VERIFIED_BUNDLE_CLOSURE_REQUIRED/));
test('compiled PAPER provenance pins executable worker addon source and exact input without initializing account',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-native-paper-closure-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const main='export const inert=true;\n',worker='// fixture worker inert\n',addon='fixture-addon-bytes-never-loaded',commit='a'.repeat(40),input={commit,sha256:sha(main)};
 const closure={kind:'poe-native-paper-bundle-v1',commit,platform:'linux',architecture:'x64',nodeMajor:24,nodeAbi:'137',sqliteVersion:'13.0.3',addon:{file:'better_sqlite3.node',bytes:Buffer.byteLength(addon),sha256:sha(addon)},worker:{file:'backup-worker.mjs',bytes:Buffer.byteLength(worker),sha256:sha(worker)},lockSha256:'b'.repeat(64)};
 const metadata={schemaVersion:1,kind:closure.kind,git:{commit,workingTreeStatus:''},liveTradingEnabled:false,financialMode:'PAPER',closure,bundle:{file:'native-paper.mjs',bytes:Buffer.byteLength(main),sha256:sha(main)}};
 const save=(name:string,body:string|Buffer)=>writeFileSync(join(dir,name),body,{mode:0o600});save('native-paper.mjs',main);save('backup-worker.mjs',worker);save('better_sqlite3.node',addon);save('metadata.json',JSON.stringify(metadata));
 await esbuild.build({entryPoints:[join(process.cwd(),'src/native-paper-bundle.ts')],outfile:join(dir,'verifier.mjs'),platform:'node',format:'esm',target:'node24',bundle:true,define:{__POE_NATIVE_PAPER_CLOSURE__:JSON.stringify(closure)},logLevel:'silent'});
 const verifier=await import(pathToFileURL(join(dir,'verifier.mjs')).href),proof=verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),input);assert.equal(proof.commit,commit);assert.equal(proof.sha256,input.sha256);assert.equal(proof.addonSha256,closure.addon.sha256);assert.ok(Object.isFrozen(proof));
 assert.throws(()=>verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),{...input,commit:'c'.repeat(40)}),/INPUT_IDENTITY/);
 assert.throws(()=>verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),{...input,sha256:'d'.repeat(64)}),/EXECUTABLE_HASH/);
 save('native-paper.mjs',main+'// changed');assert.throws(()=>verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),input),/EXECUTABLE_HASH/);save('native-paper.mjs',main);
 for(const [name,original]of ([['backup-worker.mjs',worker],['better_sqlite3.node',addon]] as const)){save(name,original+'changed');assert.throws(()=>verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),input),/CLOSURE_HASH/);save(name,original);}
 save('metadata.json',JSON.stringify({...metadata,liveTradingEnabled:true}));assert.throws(()=>verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),input),/METADATA_IDENTITY/);save('metadata.json',JSON.stringify(metadata));
 const bytes=readFileSync(join(dir,'better_sqlite3.node'));rmSync(join(dir,'better_sqlite3.node'));save('other-addon.node',bytes);symlinkSync(join(dir,'other-addon.node'),join(dir,'better_sqlite3.node'));assert.throws(()=>verifier.verifyNativePaperBundleSource(join(dir,'native-paper.mjs'),input));
});
