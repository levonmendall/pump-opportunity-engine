/** Build an import-safe, dependency-contained Node24 research component.
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
const output='/tmp/poe-native-candidate-output';
const entry=join(root,'src/run-native-candidates.ts');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,reason)=>{if(!condition)throw Error(reason);};
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024}).trim();
need(/^v24\./.test(process.version),'BUNDLE_REQUIRES_NODE24');
need(statSync(entry).isFile(),'BUNDLE_ENTRY_REQUIRED');
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
const transforms=[];
const transformedInputs=new Map(),sourceSnapshots=new Map(),optionalFallbacks=new Map();
const sdkBefore="const sdk=createRequire(import.meta.url)('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');";
const sdkAfter="const sdk=require('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');";
const idlBefore="const require=createRequire(import.meta.url),idlBytes=readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'))";
const idlAfter='const idlBytes=Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64')";
const fullIdlBefore="const require=createRequire(import.meta.url);\nconst idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;";
const fullIdlAfter='const idl=JSON.parse(Buffer.from('+JSON.stringify(idlBytes.toString('base64'))+",'base64').toString('utf8')) as Idl;";
const plugin={name:'exact-reviewed-runtime-resolution',setup(build){
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
  build.onLoad({filter:/\.ts$/},async args=>{
    if(!args.path.startsWith(root+'/')||args.path.includes('/node_modules/'))return;
    const contents=readFileSync(args.path,'utf8');sourceSnapshots.set(realpathSync(args.path),hash(contents));
    return {contents,loader:'ts',resolveDir:dirname(args.path)};
  });
}};

mkdirSync(output,{recursive:true,mode:0o700});
need(lstatSync(output).isDirectory()&&!lstatSync(output).isSymbolicLink()&&realpathSync(output)===output&&statSync(output).uid===process.getuid?.()&&(statSync(output).mode&0o077)===0,'UNSAFE_BUNDLE_OUTPUT');
need(readdirSync(output).every(name=>['native-candidates.mjs','metadata.json'].includes(name)),'UNEXPECTED_BUNDLE_OUTPUT_CONTENTS');
const buildOptions={bundle:true,platform:'node',target:'node24',format:'esm',packages:'bundle',mainFields:['main','module'],conditions:['node'],minify:false,sourcemap:false,treeShaking:true,legalComments:'none',charset:'utf8',define:{'process.env.WS_NO_BUFFER_UTIL':'"1"','process.env.WS_NO_UTF_8_VALIDATE':'"1"'},banner:{js:'import { createRequire as __poeCreateRequire } from "node:module"; const require = __poeCreateRequire(import.meta.url);'}};
const result=await esbuild.build({...buildOptions,absWorkingDir:root,entryPoints:[entry],outfile:join(output,'native-candidates.mjs'),write:false,metafile:true,plugins:[plugin],logLevel:'silent'});
need(result.outputFiles?.length===1&&transforms.length===4,'BUNDLE_EXPECTED_OUTPUT_OR_TRANSFORMS_MISSING');
const body=result.outputFiles[0].contents;
need(body.length<=16*1024*1024,'BUNDLE_SIZE_CAP');
const builtins=new Set([...builtinModules,...builtinModules.map(x=>'node:'+x)]);
const externalImports=Object.values(result.metafile.outputs).flatMap(x=>x.imports).filter(x=>x.external);
need(externalImports.every(x=>builtins.has(x.path)),'BUNDLE_EXTERNAL_NPM_DEPENDENCY:'+JSON.stringify(externalImports.filter(x=>!builtins.has(x.path)).map(x=>x.path)));
const packages=new Map(),inputs=[];
function packageFor(path){let cursor=dirname(realpathSync(path));for(let level=0;level<32;level++){const manifest=join(cursor,'package.json');try{const p=json(manifest);if(p.name&&p.version)return {path:manifest,root:cursor,manifest:p};}catch{}const next=dirname(cursor);if(next===cursor)break;cursor=next;}return null;}
for(const [input,info]of Object.entries(result.metafile.inputs)){
  if(optionalFallbacks.has(input)){const virtual=optionalFallbacks.get(input);inputs.push({path:input,virtual:true,bytes:Buffer.byteLength(virtual.contents),sha256:hash(virtual.contents),esbuildInputBytes:info.bytes});continue;}
  const path=resolve(root,input),source=readFileSync(path),actualPath=realpathSync(path),sha256=hash(source);
  need(!transformedInputs.has(actualPath)||transformedInputs.get(actualPath)===sha256,'SOURCE_CHANGED_DURING_BUNDLE:'+input);
  need(!sourceSnapshots.has(actualPath)||sourceSnapshots.get(actualPath)===sha256,'SOURCE_CHANGED_DURING_BUNDLE:'+input);
  inputs.push({path:relative(root,path),bytes:source.length,sha256,esbuildInputBytes:info.bytes});
  const p=packageFor(path);if(p&&p.root!==realpathSync(root)){
    const key=p.manifest.name+'@'+p.manifest.version,lockEntries=Object.entries(lock.packages??{}).filter(([,value])=>value.version===p.manifest.version).filter(([path])=>path.endsWith('node_modules/'+p.manifest.name));
    packages.set(key,{name:p.manifest.name,version:p.manifest.version,manifestSha256:hash(readFileSync(p.path)),lockEntries:lockEntries.map(([path,value])=>({path,integrity:value.integrity??null}))});
  }
}
need(inputs.some(x=>!x.virtual&&realpathSync(resolve(root,x.path))===realpathSync(bigintPath)),'PATCHED_BIGINT_NOT_PRESENT_IN_BUNDLE');
need(!inputs.some(x=>!x.virtual&&/(?:^|\/)(?:ledger|execution|trader|paper-execution)\.ts$|better-sqlite3|\.node$/.test(x.path)),'FINANCIAL_OR_NATIVE_MODULE_BUNDLED');
need([...packages.values()].some(p=>p.name==='@pump-fun/pump-swap-sdk'&&p.version==='2.2.0')&&[...packages.values()].some(p=>p.name==='ws'&&p.version==='8.22.0'),'PINNED_DEPENDENCIES_NOT_BUNDLED');
const bundlePath=join(output,'native-candidates.mjs');writeFileSync(bundlePath+'.pending',body,{mode:0o600});renameSync(bundlePath+'.pending',bundlePath);
const smokeDir=mkdtempSync(join(tmpdir(),'poe-native-import-'));let smoke;
try{
  copyFileSync(bundlePath,join(smokeDir,'native-candidates.mjs'));
  const smokeScript=`import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw Error('BUNDLE_SMOKE_NETWORK_FORBIDDEN');};globalThis.fetch=denied;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=tls.connect=dns.lookup=denied;syncBuiltinESMExports();
const module=await import('./native-candidates.mjs');const names=Object.keys(module);if(!names.some(k=>typeof module[k]==='function'))throw Error('BUNDLE_ENTRY_EXPORT_MISSING');console.log(JSON.stringify({importOnly:true,networkDisabled:true,nodeModulesPresent:false,exports:names,node:process.version}));`;
  writeFileSync(join(smokeDir,'smoke.mjs'),smokeScript,{mode:0o600});
  const r=spawnSync(process.execPath,['--no-addons',join(smokeDir,'smoke.mjs')],{cwd:smokeDir,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C',NODE_PATH:''}});
  need(r.status===0&&!r.error,'BUNDLE_IMPORT_SMOKE_FAILED:'+String(r.stderr).slice(0,4000));
  need(readdirSync(smokeDir).sort().join(',')==='native-candidates.mjs,smoke.mjs','IMPORT_PERFORMED_UNEXPECTED_WRITES');
  smoke={...JSON.parse(r.stdout.trim()),stderr:r.stderr,exitStatus:r.status,noNativeAddons:true,isolatedDirectoryRemoved:true};
}finally{rmSync(smokeDir,{recursive:true,force:true});}
const metadata={schemaVersion:1,purpose:'Reviewable standalone read-only native candidate-evaluation runner; build/import proof, no provider measurement executed.',builtAt:new Date().toISOString(),git:{commit:git('rev-parse','HEAD'),branch:git('branch','--show-current')||null,workingTreeStatus:git('status','--porcelain','--untracked-files=all','--','src','scripts',':!node_modules')},entry:{path:relative(root,entry),sha256:hash(readFileSync(entry))},builder:{path:'scripts/build-native-candidates-ec2.mjs',sha256:hash(readFileSync(fileURLToPath(import.meta.url))),node:process.version,esbuild:esbuild.version,options:buildOptions},packageLock:{path:'package-lock.json',sha256:hash(lockBytes)},pinnedIDL:{package:'@pump-fun/pump-swap-sdk@2.2.0',path:'src/idl/pump_amm.json',bytes:idlBytes.length,sha256:hash(idlBytes)},bigintBuffer:{version:'1.1.5',path:'dist/node.js',sha256:hash(bigintBytes),reviewedOriginalSha256:'6882e3d44987bbb7c47580928fd5e3be126bdae26a448f8a31228cf879a85210',pureJsFallbackVerified:true},transforms:transforms.sort((a,b)=>a.path.localeCompare(b.path)),optionalUnavailableFallbacks:[...optionalFallbacks.values()].map(({contents,...value})=>({...value,virtualSourceSha256:hash(contents)})),inputs:inputs.sort((a,b)=>a.path.localeCompare(b.path)),dependencies:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version)),externalImports:externalImports.map(x=>x.path).sort(),bundle:{file:'native-candidates.mjs',bytes:body.length,sha256:hash(body)},smoke:{...smoke,networkIsolation:'Common networking APIs stubbed; not an OS network sandbox. Entry main/--run guard prevents measurement execution.'},measurementExecuted:false,credentialsRead:false};
writeFileSync(join(output,'metadata.json.pending'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600});renameSync(join(output,'metadata.json.pending'),join(output,'metadata.json'));
console.log(JSON.stringify({output,bundleSha256:metadata.bundle.sha256,bundleBytes:body.length,inputs:inputs.length,dependencies:packages.size,smokeImport:smoke.exitStatus===0,measurementExecuted:false}));
