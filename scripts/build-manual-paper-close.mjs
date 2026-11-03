/** Build the separately authorized one-use PAPER close helper with pinned SQLite.
 * Reuses the reviewed native builder's exact dependency transforms; the only
 * addon path adaptation is the exact root-owned one-use action directory.
 * No account, credential, provider, service, or activation is accessed. */
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
const output=cli.length===2&&cli[0]==='--output-directory'?resolve(cli[1]):'/tmp/poe-manual-close-output';
const entry=join(root,'operator/manual-close/manual-close-cli.ts');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,reason)=>{if(!condition)throw Error(reason);};
need(cli.length===0||cli.length===2&&cli[0]==='--output-directory','BUNDLE_ARGUMENTS');
need(/^\/tmp\/poe-manual-close-output(?:-[a-z0-9-]+)?$/.test(output),'BUNDLE_OUTPUT_SCOPE');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024}).trim();
need(/^v24\./.test(process.version),'BUNDLE_REQUIRES_NODE24');
need(statSync(entry).isFile(),'BUNDLE_ENTRY_REQUIRED');
const sourceCommit=git('rev-parse','HEAD'),sourceStatus=git('status','--porcelain','--untracked-files=all','--','src','scripts','operator/manual-close','package.json','package-lock.json',':!node_modules');
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
const unsignedSdkBefore="const SDK=createRequire(import.meta.url)('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');";
const unsignedSdkAfter="const SDK=require('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');";
const idlBefore="const require=createRequire(import.meta.url),idlBytes=readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'))";
const idlAfter='const idlBytes=Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64')";
const fullIdlBefore="const require=createRequire(import.meta.url);\nconst idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;";
const fullIdlAfter='const idl=JSON.parse(Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64').toString('utf8')) as Idl;";
// The narrowly verified cleanup proof becomes reachable from the native flow.
// Bind its identical pinned IDL bytes; preserve every proof check unchanged.
const cleanupIdlBefore="const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);";
const cleanupIdlAfter='const idl=JSON.parse(Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64').toString('utf8')) as Idl,coder=new BorshCoder(idl);";
const plugin={name:'exact-reviewed-runtime-resolution',setup(build){
  build.onLoad({filter:/[\\/]better-sqlite3[\\/]lib[\\/]binding\.js$/},args=>{
    need(realpathSync(args.path)===realpathSync(sqliteBinding),'UNREVIEWED_SQLITE_BINDING_PATH');const original=readFileSync(args.path),expected=hash(addonBytes);
    const contents=`import fs from 'node:fs';import crypto from 'node:crypto';import url from 'node:url';import {createRequire} from 'node:module';const nativeRequire=createRequire(import.meta.url);let cached;export function getBinding(nativeBinding){if(nativeBinding!=null)throw Error('NATIVE_PAPER_CUSTOM_ADDON_DENIED');if(cached)return cached;const p=url.fileURLToPath(new URL('./better_sqlite3.node',import.meta.url));const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);const codeParent=fs.lstatSync(url.fileURLToPath(new URL('.',import.meta.url)));const rootReleasePath=/^\\/opt\\/poe\\/owner-actions\\/owner-forced-paper-close-20261103-v1\\/better_sqlite3\\.node$/.test(p);const rootRelease=rootReleasePath&&s.uid===0&&codeParent.uid===0&&(codeParent.mode&0o022)===0&&fs.realpathSync(p)===p;if(!s.isFile()||s.nlink!==1||(rootReleasePath?!rootRelease:s.uid!==process.getuid())||(s.mode&0o022)!==0||s.size!==${addonBytes.length})throw Error('NATIVE_PAPER_ADDON_FILE_REFUSED');const b=fs.readFileSync(fd);if(crypto.createHash('sha256').update(b).digest('hex')!==${JSON.stringify(expected)})throw Error('NATIVE_PAPER_ADDON_HASH_MISMATCH');}finally{fs.closeSync(fd);}return cached=nativeRequire(p);}export const getPrebuildPath=()=>null;`;
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
  build.onLoad({filter:/[\\/]src[\\/](?:sdk|paper-unsigned-pumpswap|program-log-mapping|migration-identity|pumpapi-mapping|protocol-pool-effects)\.ts$/},async args=>{
    if(!['src/sdk.ts','src/paper-unsigned-pumpswap.ts','src/program-log-mapping.ts','src/migration-identity.ts','src/pumpapi-mapping.ts','src/protocol-pool-effects.ts'].some(path=>args.path===join(root,path)))return;
    const source=readFileSync(args.path,'utf8'),isSdk=basename(args.path)==='sdk.ts',isUnsignedSdk=basename(args.path)==='paper-unsigned-pumpswap.ts';
    const isFull=['migration-identity.ts','pumpapi-mapping.ts'].includes(basename(args.path)),isCleanup=basename(args.path)==='protocol-pool-effects.ts',before=isSdk?sdkBefore:isUnsignedSdk?unsignedSdkBefore:isCleanup?cleanupIdlBefore:isFull?fullIdlBefore:idlBefore,after=isSdk?sdkAfter:isUnsignedSdk?unsignedSdkAfter:isCleanup?cleanupIdlAfter:isFull?fullIdlAfter:idlAfter;
    need(source.split(before).length===2,'BUNDLE_NARROW_TRANSFORM_NO_LONGER_MATCHES:'+relative(root,args.path));
    const contents=source.replace(before,after);
    const sourceSha256=hash(source),transformedSha256=hash(contents);
    transforms.push({path:relative(root,args.path),sourceSha256,transformedSha256,operation:isSdk||isUnsignedSdk?'Replace exactly one runtime createRequire SDK load with a statically bundleable require of the identical pinned CommonJS SDK.':'Replace exactly one IDL file-resolution initializer with the identical pinned IDL bytes encoded as base64; parser logic unchanged.'});
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
const installedSource='356083fd8f0e69297c8470d4493077a175d2bad1',executionSource='c92a2b95b1c175bf67b65cbe072c9e5f5080303d';
need(git('diff','--name-only',executionSource,'--','src','package.json','package-lock.json')==='','PUBLISHED_EXECUTION_SOURCE_CHANGED');
const gitBytes=(commit,path)=>execFileSync('git',['show',commit+':'+path],{cwd:root,timeout:5000,maxBuffer:4*1024*1024});
const unchangedFinancialModules=['src/ledger.ts','src/execution.ts','src/research-held-market.ts','src/research-clock-pricing.ts','src/pool.ts','src/execution-realism.ts','src/paper-unsigned-pumpswap.ts','src/sdk.ts','src/rpc-market.ts'].map(path=>{const old=gitBytes(installedSource,path),published=gitBytes(executionSource,path),actual=readFileSync(join(root,path));need(old.equals(published)&&published.equals(actual),'FINANCIAL_MODULE_CHANGED:'+path);return {path,installedSourceSha256:hash(old),executionSourceSha256:hash(published),actualSha256:hash(actual),byteIdentical:true};});
// PilotMarket also contains entry-only preparation repairs in H2. Identify the
// actual unchanged exit methods, without claiming the whole file is identical.
const pilotPath='src/pilot-market.ts',oldPilot=gitBytes(installedSource,pilotPath).toString(),newPilot=readFileSync(join(root,pilotPath),'utf8');
const ranges=[['construct','  private async construct(', '  private rememberQuoteRent('],['quote-rent','  private rememberQuoteRent(', '  /** No provider work.'],['execution-plan','  executionPlan(', '  private refusedPlan('],['context-and-sell-quotes','  readonly context=', '  usage(){']];
const unchangedExitMethods=ranges.map(([name,start,end])=>{const part=s=>{const a=s.indexOf(start),b=s.indexOf(end,a+start.length);need(a>=0&&b>a,'SELL_SOURCE_RANGE_MISSING:'+name);return s.slice(a,b);};const old=part(oldPilot),current=part(newPilot);need(old===current,'SELL_EXECUTION_METHOD_CHANGED:'+name);return {name,sha256:hash(old),byteIdentical:true};});
const main=await bundle(entry,'manual-close.mjs');need(main.bytes<=8*1024*1024,'MANUAL_HELPER_SIZE_BOUND');
writeFileSync(join(output,'better_sqlite3.node'),addonBytes,{flag:'wx',mode:0o600});
need([...inputs.values()].some(x=>!x.virtual&&realpathSync(resolve(root,x.path))===realpathSync(bigintPath)),'PATCHED_BIGINT_NOT_PRESENT');
need(![...inputs.values()].some(x=>!x.virtual&&(x.path.startsWith('src/')||x.path.startsWith('operator/manual-close/'))&&/signTransaction\s*\(|sendRawTransaction\s*\(|simulateTransaction\s*\(|sendAndConfirmTransaction\s*\(/.test(readFileSync(resolve(root,x.path),'utf8'))),'OWNED_LIVE_EXECUTION_DENIED');
const smokeDir=mkdtempSync(join(tmpdir(),'poe-manual-close-import-'));let smoke;
try{
 for(const name of ['manual-close.mjs','better_sqlite3.node'])copyFileSync(join(output,name),join(smokeDir,name));
 // Same pinned addon transform, exercised without touching a file/account.
 const probe=await esbuild.build({...buildOptions,absWorkingDir:root,stdin:{contents:"import Database from 'better-sqlite3';const db=new Database(':memory:');export const sqlite=db.prepare('SELECT sqlite_version() version').get();db.close();",resolveDir:root,sourcefile:'OFFLINE-manual-close-sqlite-probe.ts',loader:'ts'},outfile:join(smokeDir,'sqlite-probe.mjs'),write:false,plugins:[plugin],logLevel:'silent'});need(probe.outputFiles?.length===1,'SQLITE_PROBE_OUTPUT');writeFileSync(join(smokeDir,'sqlite-probe.mjs'),probe.outputFiles[0].contents,{flag:'wx',mode:0o600});
 writeFileSync(join(smokeDir,'network-denied.mjs'),"import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https';const denied=()=>{throw Error('OFFLINE_NETWORK_DENIED');};globalThis.fetch=denied;net.connect=denied;net.createConnection=denied;tls.connect=denied;http.request=denied;http.get=denied;https.request=denied;https.get=denied;\n",{mode:0o600});
 writeFileSync(join(smokeDir,'import-smoke.mjs'),"import assert from 'node:assert/strict';const m=await import('./manual-close.mjs');assert.equal(typeof m.runManualCloseCli,'function');assert.equal(typeof m.parseManualCloseArguments,'function');assert.throws(()=>m.parseManualCloseArguments([]),/MANUAL_CLOSE_EXACT_ARGUMENTS/);const {sqlite}=await import('./sqlite-probe.mjs');assert.match(sqlite.version,/^3\\.(5[1-9]|[6-9][0-9])\\./);console.log(JSON.stringify({importSafe:true,networkDenied:true,financialAccountOpened:false,invalidInvocationRefused:true,pinnedAddonLoaded:true,inMemorySqlite:sqlite.version}));\n",{mode:0o600});
 const run=spawnSync(process.execPath,['--import',join(smokeDir,'network-denied.mjs'),join(smokeDir,'import-smoke.mjs')],{cwd:smokeDir,env:{PATH:process.env.PATH,WS_NO_BUFFER_UTIL:'1',WS_NO_UTF_8_VALIDATE:'1'},encoding:'utf8',timeout:20000,maxBuffer:1024*1024});need(run.status===0,'IMPORT_SAFE_OFFLINE_SMOKE_FAILED:'+String(run.stderr).slice(0,300));smoke=JSON.parse(run.stdout.trim());
}finally{rmSync(smokeDir,{recursive:true,force:true});}
const metadata={schemaVersion:1,kind:'poe-authorized-manual-paper-close-bundle-v1',builtAt:new Date().toISOString(),sourceCommit,installedSource,executionSource,executionTree:git('rev-parse',executionSource+'^{tree}'),financialMode:'PAPER',liveTradingEnabled:false,accountInitialized:false,sourceModulesChanged:false,entry:{path:'operator/manual-close/manual-close-cli.ts',sha256:hash(readFileSync(entry))},builder:{path:'scripts/build-manual-paper-close.mjs',sha256:hash(readFileSync(fileURLToPath(import.meta.url))),node:process.version,esbuild:esbuild.version},unchangedFinancialModules,pilotMarket:{path:pilotPath,installedFileSha256:hash(oldPilot),executionFileSha256:hash(newPilot),wholeFileByteIdentical:oldPilot===newPilot,unchangedExitMethods},packageLockSha256:hash(lockBytes),bundle:main,addon:{file:'better_sqlite3.node',bytes:addonBytes.length,sha256:hash(addonBytes),nodeAbi:'137'},pinnedIDL:{sha256:hash(idlBytes),bytes:idlBytes.length},transforms:[...new Map(transforms.map(t=>[t.path,t])).values()].sort((a,b)=>a.path.localeCompare(b.path)),inputs:[...inputs.values()].sort((a,b)=>a.path.localeCompare(b.path)),dependencies:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)),smoke};
writeFileSync(join(output,'metadata.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});
need(git('rev-parse','HEAD')===sourceCommit&&git('status','--porcelain','--untracked-files=all','--','src','scripts','operator/manual-close','package.json','package-lock.json',':!node_modules')===sourceStatus,'SOURCE_CHANGED_DURING_BUILD');
console.log(JSON.stringify({output,sourceCommit,installedSource,executionSource,bundle:main,addon:metadata.addon,metadataSha256:hash(readFileSync(join(output,'metadata.json'))),unchangedFinancialModules:unchangedFinancialModules.length,unchangedExitMethods:unchangedExitMethods.length,smoke}));
