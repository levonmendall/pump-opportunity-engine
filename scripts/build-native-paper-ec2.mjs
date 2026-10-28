/** Build the separate import-safe native PAPER closure with one pinned SQLite addon.
 * This script does not connect to providers, read credentials or run the test. */
import {createHash} from 'node:crypto';
import {createRequire,builtinModules} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,statSync,lstatSync,realpathSync,copyFileSync,mkdtempSync,rmSync,renameSync,readdirSync} from 'node:fs';
import {dirname,join,resolve,relative,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import * as esbuild from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const cli=process.argv.slice(2);
const output=cli.length===2&&cli[0]==='--output-directory'?resolve(cli[1]):'/tmp/poe-native-paper-output';
const entry=join(root,'src/run-native-paper.ts');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,reason)=>{if(!condition)throw Error(reason);};
need(cli.length===0||cli.length===2&&cli[0]==='--output-directory','BUNDLE_ARGUMENTS');
need(/^\/tmp\/poe-native-paper-output(?:-[a-z0-9-]+)?$/.test(output),'BUNDLE_OUTPUT_SCOPE');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024}).trim();
need(/^v24\./.test(process.version),'BUNDLE_REQUIRES_NODE24');
need(statSync(entry).isFile(),'BUNDLE_ENTRY_REQUIRED');
const sourceCommit=git('rev-parse','HEAD'),sourceStatus=git('status','--porcelain','--untracked-files=all','--','src','scripts','package.json','package-lock.json',':!node_modules');
need(/^[a-f0-9]{40}$/.test(sourceCommit)&&sourceStatus==='','BUNDLE_CLEAN_COMMITTED_SOURCE_REQUIRED');
const lockPath=join(root,'package-lock.json'),lockBytes=readFileSync(lockPath),lock=json(lockPath);
const sdkEntry=require.resolve('@pump-fun/pump-swap-sdk');
const sdkRoot=dirname(dirname(sdkEntry));
const sdkManifestPath=join(sdkRoot,'package.json'),sdkManifest=json(sdkManifestPath);
need(sdkManifest.name==='@pump-fun/pump-swap-sdk'&&sdkManifest.version==='2.2.0','UNREVIEWED_SDK_VERSION');
const wsManifestPath=join(dirname(require.resolve('ws')),'package.json'),wsManifest=json(wsManifestPath);
need(wsManifest.name==='ws'&&wsManifest.version==='8.22.0','UNREVIEWED_WS_VERSION');
need(lock.packages?.['node_modules/@pump-fun/pump-swap-sdk']?.version===sdkManifest.version&&lock.packages?.['node_modules/ws']?.version===wsManifest.version,'PINNED_LOCK_VERSION_MISMATCH');
const idlPath=join(sdkRoot,'src/idl/pump_amm.json'),idlBytes=readFileSync(idlPath);
need(json(idlPath).address==='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA','PINNED_IDL_PROGRAM_MISMATCH');
const bigintPath=require.resolve('bigint-buffer'),bigintBytes=readFileSync(bigintPath),bigintSource=bigintBytes.toString('utf8');
const bigintReplacement='// POE: force the package\'s shipped pure-JS fallback; native path is vulnerable.\nconst converter = undefined;';
const bigintOriginal=`let converter;\n{\n    try {\n        converter = require('bindings')('bigint_buffer');\n    }\n    catch (e) {\n        console.warn('bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)');\n    }\n}`;
need(bigintSource.includes(bigintReplacement)&&hash(bigintSource.replace(bigintReplacement,bigintOriginal))==='6882e3d44987bbb7c47580928fd5e3be126bdae26a448f8a31228cf879a85210','BIGINT_PURE_JS_PATCH_NOT_VERIFIED');
const sqliteRoot=dirname(dirname(require.resolve('better-sqlite3'))),sqliteManifest=json(join(sqliteRoot,'package.json')),sqliteBinding=join(sqliteRoot,'lib/binding.js'),sqliteAddon=join(sqliteRoot,'prebuilds/linux-x64.node'),addonBytes=readFileSync(sqliteAddon);
need(process.platform==='linux'&&process.arch==='x64'&&process.versions.modules==='137'&&process.report.getReport().header.glibcVersionRuntime,'BUNDLE_LINUX_X64_NODE24_ABI137_REQUIRED');
need(sqliteManifest.version==='13.0.3'&&lock.packages?.['node_modules/better-sqlite3']?.version==='13.0.3','UNREVIEWED_SQLITE_VERSION');
need(hash(readFileSync(sqliteBinding))==='4fe0f892facc02af7db0a1770150565d2e944e7da3c6493116d8e2a01a0f9b19'&&hash(addonBytes)==='6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d','UNREVIEWED_SQLITE_BINDING_OR_ADDON');
need(addonBytes.length<=16*1024*1024&&addonBytes.subarray(0,4).toString('hex')==='7f454c46','BOUNDED_ELF_ADDON_REQUIRED');
const transforms=[];
const transformedInputs=new Map(),sourceSnapshots=new Map(),optionalFallbacks=new Map();
const sdkBefore="const sdk=createRequire(import.meta.url)('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');";
const sdkAfter="const sdk=require('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');";
const idlBefore="const require=createRequire(import.meta.url),idlBytes=readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'))";
const idlAfter='const idlBytes=Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64')";
const fullIdlBefore="const require=createRequire(import.meta.url);\nconst idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;";
const fullIdlAfter='const idl=JSON.parse(Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64').toString('utf8')) as Idl;";
const plugin={name:'exact-reviewed-runtime-resolution',setup(build){
  build.onLoad({filter:/[\\/]better-sqlite3[\\/]lib[\\/]binding\.js$/},args=>{
    need(realpathSync(args.path)===realpathSync(sqliteBinding),'UNREVIEWED_SQLITE_BINDING_PATH');const original=readFileSync(args.path),expected=hash(addonBytes);
    const contents=`import fs from 'node:fs';import crypto from 'node:crypto';import url from 'node:url';import {createRequire} from 'node:module';const nativeRequire=createRequire(import.meta.url);let cached;export function getBinding(nativeBinding){if(nativeBinding!=null)throw Error('NATIVE_PAPER_CUSTOM_ADDON_DENIED');if(cached)return cached;const p=url.fileURLToPath(new URL('./better_sqlite3.node',import.meta.url));const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o022)!==0||s.size!==${addonBytes.length})throw Error('NATIVE_PAPER_ADDON_FILE_REFUSED');const b=fs.readFileSync(fd);if(crypto.createHash('sha256').update(b).digest('hex')!==${JSON.stringify(expected)})throw Error('NATIVE_PAPER_ADDON_HASH_MISMATCH');}finally{fs.closeSync(fd);}return cached=nativeRequire(p);}export const getPrebuildPath=()=>null;`;
    transforms.push({path:relative(root,args.path),sourceSha256:hash(original),transformedSha256:hash(contents),operation:'Replace only pinned default addon resolution with same-package pinned linux-x64 addon beside executable; reject override paths and verify exact bytes before loading.'});transformedInputs.set(realpathSync(args.path),hash(original));return {contents,loader:'js',resolveDir:dirname(args.path)};
  });
  build.onLoad({filter:/[\\/]src[\\/]backup\.ts$/},args=>{
    if(args.path!==join(root,'src/backup.ts'))return;const source=readFileSync(args.path,'utf8'),before="new URL(source?'./backup-worker.ts':'./backup-worker.js',import.meta.url)",after="new URL('./backup-worker.mjs',import.meta.url)";need(source.split(before).length===2,'BUNDLE_BACKUP_WORKER_TRANSFORM_NO_LONGER_MATCHES');const contents=source.replace(before,after);transforms.push({path:'src/backup.ts',sourceSha256:hash(source),transformedSha256:hash(contents),operation:'Replace only packaged backup-worker file extension with separately pinned mjs worker; artifact behavior unchanged.'});transformedInputs.set(realpathSync(args.path),hash(source));return {contents,loader:'ts',resolveDir:dirname(args.path)};
  });
  // The installed dependency tree lacks these OPTIONAL packages. Preserve its
  // existing MODULE_NOT_FOUND catch/fallback without runtime npm resolution.
  build.onResolve({filter:/^(supports-color|encoding)$/},args=>{
    need(args.kind==='require-call'&&(args.path==='supports-color'?args.importer.endsWith('/debug/src/node.js'):args.importer.endsWith('/node-fetch/lib/index.js')),'UNREVIEWED_OPTIONAL_DEPENDENCY_IMPORT');
    try{createRequire(args.importer).resolve(args.path);throw Error('OPTIONAL_DEPENDENCY_NOW_INSTALLED_REVIEW_REQUIRED');}catch(error){need(error?.code==='MODULE_NOT_FOUND','OPTIONAL_DEPENDENCY_NOW_INSTALLED_REVIEW_REQUIRED');}
    const contents='const e = new Error('+JSON.stringify('Optional module unavailable in reviewed installation: '+args.path)+'); e.code = "MODULE_NOT_FOUND"; throw e;';
    optionalFallbacks.set('poe-optional-unavailable:'+args.path,{name:args.path,contents,originalImporter:relative(root,args.importer),semantics:'Original optional require is absent; throw MODULE_NOT_FOUND inside the unchanged upstream try/catch, selecting the existing unavailable-module fallback.'});
    return {path:args.path,namespace:'poe-optional-unavailable'};
  });
  build.onLoad({filter:/.*/,namespace:'poe-optional-unavailable'},args=>({contents:optionalFallbacks.get('poe-optional-unavailable:'+args.path).contents,loader:'js'}));
  build.onLoad({filter:/[\\/]src[\\/](?:sdk|program-log-mapping|migration-identity|pumpapi-mapping)\.ts$/},async args=>{
    if(!['src/sdk.ts','src/program-log-mapping.ts','src/migration-identity.ts','src/pumpapi-mapping.ts'].some(path=>args.path===join(root,path)))return;
    const source=readFileSync(args.path,'utf8'),isSdk=basename(args.path)==='sdk.ts';
    const isFull=['migration-identity.ts','pumpapi-mapping.ts'].includes(basename(args.path)),before=isSdk?sdkBefore:isFull?fullIdlBefore:idlBefore,after=isSdk?sdkAfter:isFull?fullIdlAfter:idlAfter;
    need(source.split(before).length===2,'BUNDLE_NARROW_TRANSFORM_NO_LONGER_MATCHES:'+relative(root,args.path));
    const contents=source.replace(before,after);
    const sourceSha256=hash(source),transformedSha256=hash(contents);
    transforms.push({path:relative(root,args.path),sourceSha256,transformedSha256,operation:isSdk?'Replace exactly one runtime createRequire SDK load with a statically bundleable require of the identical pinned CommonJS SDK.':'Replace exactly one IDL file-resolution initializer with the identical pinned IDL bytes encoded as base64; parser logic unchanged.'});
    transformedInputs.set(realpathSync(args.path),sourceSha256);
    return {contents,loader:'ts',resolveDir:dirname(args.path)};
  });
  build.onLoad({filter:/[\\/]src[\\/](?:pilot|run-native-candidates)\.ts$/},args=>{
    if(!['src/pilot.ts','src/run-native-candidates.ts'].some(name=>args.path===join(root,name)))return;const source=readFileSync(args.path,'utf8'),guards=source.split('\n').filter(line=>line.startsWith('if(process.argv[1]&&'));need(guards.length===1&&source.trimEnd().endsWith(guards[0]),'BUNDLE_IMPORTED_CLI_GUARD_CHANGED');const contents=source.replace(guards[0],'// Imported library CLI entry omitted only in this standalone native PAPER bundle.');transforms.push({path:relative(root,args.path),sourceSha256:hash(source),transformedSha256:hash(contents),operation:'Remove only this imported library final CLI guard so the standalone PAPER entry is the sole operating writer; exports and algorithms unchanged.'});transformedInputs.set(realpathSync(args.path),hash(source));return {contents,loader:'ts',resolveDir:dirname(args.path)};
  });
  build.onLoad({filter:/\.ts$/},async args=>{
    if(!args.path.startsWith(root+'/')||args.path.includes('/node_modules/'))return;
    const contents=readFileSync(args.path,'utf8');sourceSnapshots.set(realpathSync(args.path),hash(contents));
    return {contents,loader:'ts',resolveDir:dirname(args.path)};
  });
}};


mkdirSync(output,{recursive:true,mode:0o700});
need(lstatSync(output).isDirectory()&&!lstatSync(output).isSymbolicLink()&&realpathSync(output)===output&&statSync(output).uid===process.getuid?.()&&(statSync(output).mode&0o077)===0,'UNSAFE_BUNDLE_OUTPUT');
need(readdirSync(output).length===0,'BUNDLE_NEW_EMPTY_OUTPUT_REQUIRED');
const buildOptions={bundle:true,platform:'node',target:'node24',format:'esm',packages:'bundle',mainFields:['main','module'],conditions:['node'],minify:false,sourcemap:false,treeShaking:true,legalComments:'none',charset:'utf8',define:{'process.env.WS_NO_BUFFER_UTIL':'"1"','process.env.WS_NO_UTF_8_VALIDATE':'"1"'},banner:{js:'import { createRequire as __poeCreateRequire } from "node:module"; const require = __poeCreateRequire(import.meta.url);'}};
const builtins=new Set([...builtinModules,...builtinModules.map(x=>'node:'+x)]);
const packages=new Map(),inputs=new Map();
function packageFor(path){let cursor=dirname(realpathSync(path));for(let level=0;level<32;level++){const manifest=join(cursor,'package.json');try{const p=json(manifest);if(p.name&&p.version)return {path:manifest,root:cursor,manifest:p};}catch{}const next=dirname(cursor);if(next===cursor)break;cursor=next;}return null;}
function capture(result){
  const externalImports=Object.values(result.metafile.outputs).flatMap(x=>x.imports).filter(x=>x.external);
  need(externalImports.every(x=>builtins.has(x.path)),'BUNDLE_EXTERNAL_NPM_DEPENDENCY');
  for(const [input,info]of Object.entries(result.metafile.inputs)){
    if(optionalFallbacks.has(input)){const virtual=optionalFallbacks.get(input);inputs.set(input,{path:input,virtual:true,bytes:Buffer.byteLength(virtual.contents),sha256:hash(virtual.contents),esbuildInputBytes:info.bytes});continue;}
    // The finite controlled probe is a virtual entry, not a deployed input.
    if(input==='poe-paper-smoke-entry:probe'||input==='<define:__POE_NATIVE_PAPER_CLOSURE__>')continue;
    const path=resolve(root,input),source=readFileSync(path),actualPath=realpathSync(path),sha256=hash(source);
    need(!transformedInputs.has(actualPath)||transformedInputs.get(actualPath)===sha256,'SOURCE_CHANGED_DURING_BUNDLE:'+input);need(!sourceSnapshots.has(actualPath)||sourceSnapshots.get(actualPath)===sha256,'SOURCE_CHANGED_DURING_BUNDLE:'+input);
    const prior=inputs.get(input);need(!prior||prior.sha256===sha256,'SOURCE_CHANGED_BETWEEN_BUNDLES');inputs.set(input,{path:relative(root,path),bytes:source.length,sha256,esbuildInputBytes:info.bytes});
    const p=packageFor(path);if(p&&p.root!==realpathSync(root)){const key=p.manifest.name+'@'+p.manifest.version,lockEntries=Object.entries(lock.packages??{}).filter(([,value])=>value.version===p.manifest.version).filter(([path])=>path.endsWith('node_modules/'+p.manifest.name));packages.set(key,{name:p.manifest.name,version:p.manifest.version,manifestSha256:hash(readFileSync(p.path)),lockEntries:lockEntries.map(([path,value])=>({path,integrity:value.integrity??null}))});}
  }
  return externalImports.map(x=>x.path).sort();
}
async function bundle(entryPath,name,closure){const result=await esbuild.build({...buildOptions,define:{...buildOptions.define,...(closure?{'__POE_NATIVE_PAPER_CLOSURE__':JSON.stringify(closure)}:{})},absWorkingDir:root,entryPoints:[entryPath],outfile:join(output,name),write:false,metafile:true,plugins:[plugin],logLevel:'silent'});need(result.outputFiles?.length===1&&result.outputFiles[0].contents.length<=16*1024*1024,'BUNDLE_SIZE_OR_OUTPUT_CAP');const body=result.outputFiles[0].contents,externalImports=capture(result);writeFileSync(join(output,name),body,{flag:'wx',mode:0o600});return {file:name,bytes:body.length,sha256:hash(body),externalImports};}
const worker=await bundle(join(root,'src/backup-worker.ts'),'backup-worker.mjs');
const addon={file:'better_sqlite3.node',bytes:addonBytes.length,sha256:hash(addonBytes)};writeFileSync(join(output,addon.file),addonBytes,{flag:'wx',mode:0o600});
const closure={kind:'poe-native-paper-bundle-v1',commit:sourceCommit,platform:'linux',architecture:'x64',nodeMajor:24,nodeAbi:'137',sqliteVersion:'13.0.3',addon,worker:{file:worker.file,bytes:worker.bytes,sha256:worker.sha256},lockSha256:hash(lockBytes)};
const main=await bundle(entry,'native-paper.mjs',closure);
need([...inputs.values()].some(x=>!x.virtual&&realpathSync(resolve(root,x.path))===realpathSync(bigintPath)),'PATCHED_BIGINT_NOT_PRESENT_IN_BUNDLE');
need([...packages.values()].some(p=>p.name==='@pump-fun/pump-swap-sdk'&&p.version==='2.2.0')&&[...packages.values()].some(p=>p.name==='ws'&&p.version==='8.22.0')&&[...packages.values()].some(p=>p.name==='better-sqlite3'&&p.version==='13.0.3'),'PINNED_DEPENDENCIES_NOT_BUNDLED');
const forbidden=['@solana/spl-token/src/instructions','@solana/web3.js/src/transaction'];
// web3 SDK type/transaction definitions may be bundled; real execution is
// absent from POE's owned source closure, not asserted absent from vendor SDK.
need(![...inputs.values()].some(x=>!x.virtual&&x.path.startsWith('src/')&&/signTransaction\s*\(|sendRawTransaction\s*\(|simulateTransaction\s*\(|sendAndConfirmTransaction\s*\(/.test(readFileSync(resolve(root,x.path),'utf8'))),'OWNED_REAL_TRANSACTION_EXECUTION_DENIED');
const metadata={schemaVersion:1,kind:closure.kind,purpose:'Source-pinned isolated PAPER executable and SQLite/backup closure; no financial account embedded.',builtAt:new Date().toISOString(),git:{commit:sourceCommit,branch:git('branch','--show-current')||null,workingTreeStatus:sourceStatus},entry:{path:'src/run-native-paper.ts',sha256:hash(readFileSync(entry))},builder:{path:'scripts/build-native-paper-ec2.mjs',sha256:hash(readFileSync(fileURLToPath(import.meta.url))),node:process.version,esbuild:esbuild.version},closure,packageLock:{path:'package-lock.json',sha256:hash(lockBytes)},pinnedIDL:{package:'@pump-fun/pump-swap-sdk@2.2.0',path:'src/idl/pump_amm.json',bytes:idlBytes.length,sha256:hash(idlBytes)},bigintBuffer:{version:'1.1.5',path:'dist/node.js',sha256:hash(bigintBytes),pureJsFallbackVerified:true},transforms:[...new Map(transforms.map(t=>[t.path,t])).values()].sort((a,b)=>a.path.localeCompare(b.path)),optionalUnavailableFallbacks:[...optionalFallbacks.values()].map(({contents,...value})=>({...value,virtualSourceSha256:hash(contents)})),inputs:[...inputs.values()].sort((a,b)=>a.path.localeCompare(b.path)),dependencies:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version)),externalImports:main.externalImports,bundle:{file:main.file,bytes:main.bytes,sha256:main.sha256},financialMode:'PAPER',liveTradingEnabled:false,credentialsRead:false,financialAccountRead:false,measurementExecuted:false,smoke:null};
writeFileSync(join(output,'metadata.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});
const smokeDir=mkdtempSync(join(tmpdir(),'poe-native-paper-import-'));let smoke;
try{
  for(const name of ['native-paper.mjs','backup-worker.mjs','better_sqlite3.node','metadata.json'])copyFileSync(join(output,name),join(smokeDir,name));
  // Same pinned transforms and library source bytes as the deployed closure.
  // This fixture is built only in an isolated temporary directory and never
  // shipped as a runtime command or connected to a real PAPER account.
  const probe=`import {DisposableLedger} from ${JSON.stringify(join(root,'src/ledger.ts'))};import {FinancialBackupStore} from ${JSON.stringify(join(root,'src/backup.ts'))};import {verifyNativePaperBundleSource} from ${JSON.stringify(join(root,'src/native-paper-bundle.ts'))};import {mkdtempSync,rmSync,chmodSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';const denied=()=>{throw Error('BUNDLE_SMOKE_NETWORK_FORBIDDEN');};globalThis.fetch=denied;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=tls.connect=dns.lookup=denied;syncBuiltinESMExports();
if(process.argv.slice(2).length!==1||process.argv[2]!=='--disposable-smoke')throw Error('EXPLICIT_DISPOSABLE_PACKAGE_SMOKE_REQUIRED');const input=${JSON.stringify({commit:sourceCommit,sha256:main.sha256})};const dir=fileURLToPath(new URL('.',import.meta.url));const proof=verifyNativePaperBundleSource(dir+'native-paper.mjs',input);const module=await import('./native-paper.mjs');if(typeof module.runNativePaper!=='function'||typeof module.parseNativePaperArgs!=='function')throw Error('BUNDLE_ENTRY_EXPORT_MISSING');let refused=false;try{module.parseNativePaperArgs([]);}catch{refused=true;}if(!refused)throw Error('BUNDLE_RESUME_GUARD_MISSING');const fixture=mkdtempSync(join(tmpdir(),'poe-native-paper-package-smoke-'));let ledger,reopened;try{const path=join(fixture,'ledger.sqlite'),at=1793016000000;ledger=new DisposableLedger(path,'fixture-native-paper-package');chmodSync(path,0o600);const usd={at,microUsdPerSol:'100000000',source:'DISPOSABLE offline packaging fixture'};ledger.initialize(usd,at);ledger.reconcile('fixture-reconcile',at,usd,{});const revision=ledger.state().revision;ledger.reconcile('fixture-reconcile',at,usd,{});if(ledger.state().revision!==revision)throw Error('DISPOSABLE_IDEMPOTENCY_FAILURE');const state=JSON.stringify(ledger.state()),identity={accountId:ledger.accountId,mode:'DISPOSABLE_PAPER',inceptionAt:at},store=new FinancialBackupStore({directory:join(fixture,'backups'),sourcePath:path,identity});const backup=await store.create(ledger);ledger.close();reopened=new DisposableLedger(path,identity.accountId);if(JSON.stringify(reopened.state())!==state||reopened.integrity()!=='ok')throw Error('DISPOSABLE_REOPEN_FAILURE');const selected=store.latest();if(!backup||selected.backup?.revision!==revision)throw Error('DISPOSABLE_BACKUP_FAILURE');const sqlite=reopened.sqlite;reopened.close();console.log(JSON.stringify({importOnly:true,networkDisabled:true,nodeModulesPresent:false,disposableFinancialFixture:true,idempotency:true,backupWorker:true,reopen:true,sqlite,closure:proof,node:process.version}));}finally{try{ledger?.close();}catch{}try{reopened?.close();}catch{}rmSync(fixture,{recursive:true,force:true});}`;
  const probePlugin={name:'isolated-finite-disposable-probe',setup(build){build.onResolve({filter:/^poe-paper-smoke-entry$/},()=>({path:'probe',namespace:'poe-paper-smoke-entry'}));build.onLoad({filter:/.*/,namespace:'poe-paper-smoke-entry'},()=>({contents:probe,loader:'js',resolveDir:smokeDir}));}};
  const result=await esbuild.build({...buildOptions,define:{...buildOptions.define,'__POE_NATIVE_PAPER_CLOSURE__':JSON.stringify(closure)},absWorkingDir:root,entryPoints:['poe-paper-smoke-entry'],outfile:join(smokeDir,'probe.mjs'),write:false,metafile:true,plugins:[probePlugin,plugin],external:['./native-paper.mjs'],logLevel:'silent'});need(result.outputFiles?.length===1,'SMOKE_OUTPUT_REQUIRED');const probeBody=result.outputFiles[0].contents;writeFileSync(join(smokeDir,'probe.mjs'),probeBody,{mode:0o600});writeFileSync(join(output,'verify-native-paper-package.mjs'),probeBody,{flag:'wx',mode:0o600});metadata.packageValidation={file:'verify-native-paper-package.mjs',bytes:probeBody.length,sha256:hash(probeBody),mode:'explicit-disposable-smoke-only',arguments:['--disposable-smoke'],fixtureLocation:'new private /tmp directory only; no input ledger path accepted',existingFinancialAccountRead:false};writeFileSync(join(output,'metadata.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600});copyFileSync(join(output,'metadata.json'),join(smokeDir,'metadata.json'));
  const harness=`import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';const denied=()=>{throw Error('BUNDLE_SMOKE_NETWORK_FORBIDDEN');};globalThis.fetch=denied;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=tls.connect=dns.lookup=denied;syncBuiltinESMExports();await import('./probe.mjs');`;
  writeFileSync(join(smokeDir,'network-denied.mjs'),harness.slice(0,harness.indexOf("await import('./probe.mjs')")),{mode:0o600});
  writeFileSync(join(smokeDir,'smoke.mjs'),harness,{mode:0o600});const r=spawnSync(process.execPath,['--max-old-space-size=192',join(smokeDir,'smoke.mjs'),'--disposable-smoke'],{cwd:smokeDir,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C',NODE_PATH:''}});need(r.status===0&&!r.error,'BUNDLE_FINANCIAL_IMPORT_SMOKE_FAILED:'+String(r.stderr).slice(0,4000));const cli=[];for(const trial of [{args:[],expected:'NATIVE_PAPER_EXPLICIT_RESUME_REQUIRED'},{args:['--resume','--directory',join(smokeDir,'missing-account'),'--input',join(smokeDir,'missing-input.json'),'--paper-contract','confirmed-program-ordinary-flow-paper-v1'],expected:'ENOENT'}]){const test=spawnSync(process.execPath,['--max-old-space-size=192','--import',join(smokeDir,'network-denied.mjs'),join(smokeDir,'native-paper.mjs'),...trial.args],{cwd:smokeDir,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C',NODE_PATH:''}});need(test.status===1&&test.stderr.includes(trial.expected)&&!test.stderr.includes('NATIVE_RESEARCH_EXPLICIT_RUN_REQUIRED')&&!test.stderr.includes('PILOT_COMMAND')&&!test.stderr.includes('BUNDLE_SMOKE_NETWORK_FORBIDDEN')&&test.stdout==='','BUNDLE_DIRECT_CLI_GUARD_FAILURE:'+test.stderr.slice(0,2000));cli.push({args:trial.args.length?'explicit-resume-nonexistent-fixture-input':'empty',expectedRefusal:trial.expected,exitStatus:test.status});}
  const probeProof=JSON.parse(r.stdout.trim());probeProof.closure.provisionalMetadataSha256=probeProof.closure.metadataSha256;delete probeProof.closure.metadataSha256;smoke={...probeProof,directCliGuards:cli,stderr:r.stderr,exitStatus:r.status,soleNativeAddon:closure.addon.sha256,temporaryFixtureRemoved:true,networkIsolation:'Common networking APIs stubbed; not an OS network sandbox. No real account paths or provider credentials are supplied.'};
}finally{rmSync(smokeDir,{recursive:true,force:true});}
need(git('rev-parse','HEAD')===sourceCommit&&git('status','--porcelain','--untracked-files=all','--','src','scripts','package.json','package-lock.json',':!node_modules')===sourceStatus,'SOURCE_CHANGED_DURING_PACKAGE');
metadata.smoke=smoke;writeFileSync(join(output,'metadata.json.pending'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600});renameSync(join(output,'metadata.json.pending'),join(output,'metadata.json'));
console.log(JSON.stringify({output,sourceCommit,bundleSha256:main.sha256,bundleBytes:main.bytes,metadataSha256:hash(readFileSync(join(output,'metadata.json'))),backupWorkerSha256:worker.sha256,addonSha256:addon.sha256,inputs:inputs.size,dependencies:packages.size,smokeImport:true,disposableBackupAndReopen:true,measurementExecuted:false,financialAccountRead:false}));
