#!/usr/bin/env node
/** Build only the deployed, read-only pilot publisher. Never reads credentials. */
import {build,version as esbuildVersion} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const release='9161d3849eae1ffa549a6afa2a1c263b6f3d1185';
const inputs=['scripts/publish-pilot-status.mjs','src/pilot-telemetry.ts','src/reporting.ts'];
const allowedBuiltins=new Set(['node:crypto','node:fs/promises','node:path','node:url']);
const digest=value=>createHash('sha256').update(value).digest('hex');
if(esbuildVersion!=='0.27.7')throw Error('Use the already locked esbuild 0.27.7');
const sources={};
for(const name of inputs){
 const bytes=await readFile(resolve(root,name));
 const pinned=execFileSync('git',['show',release+':'+name],{cwd:root,maxBuffer:1024*1024});
 if(!bytes.equals(pinned))throw Error('Publisher input differs from the reviewed deployed release: '+name);
 sources[name]={bytes:bytes.length,sha256:digest(bytes)};
}
const output=resolve(root,'operator/reporting-delivery/dist/publisher.mjs');
const result=await build({absWorkingDir:root,stdin:{contents:"export {readPrivateFile,publishPilotStatus} from './scripts/publish-pilot-status.mjs';\nexport {projectPilotStatus} from './src/pilot-telemetry.ts';\n",resolveDir:root,sourcefile:'poe-reporting-publisher-entry.mjs',loader:'js'},bundle:true,platform:'node',format:'esm',target:'node24',treeShaking:true,legalComments:'none',sourcemap:false,write:false,outfile:output,metafile:true,plugins:[{name:'deployed-projector-source',setup(api){api.onResolve({filter:/^\.\.\/dist\/src\/pilot-telemetry\.js$/},args=>{if(resolve(args.importer)!==resolve(root,'scripts/publish-pilot-status.mjs'))throw Error('Unexpected publisher importer');return {path:resolve(root,'src/pilot-telemetry.ts')};});}}]});
const actualInputs=Object.keys(result.metafile.inputs).filter(name=>name!=='poe-reporting-publisher-entry.mjs').sort();
if(actualInputs.join('\n')!==[...inputs].sort().join('\n'))throw Error('Unexpected publisher dependency');
const external=result.metafile.outputs[relative(root,output)].imports.map(row=>row.path).sort();
if(external.some(name=>!allowedBuiltins.has(name)))throw Error('Publisher must use approved Node standard libraries only');
const body=Buffer.from(result.outputFiles[0].contents);
if(body.length>128*1024)throw Error('Publisher bundle exceeds bound');
await mkdir(dirname(output),{recursive:true,mode:0o755});
await writeFile(output,body,{mode:0o644});
const manifest={schemaVersion:1,sourceRelease:release,destination:'https://meme-machine-dashboard-staging.onrender.com/api/pilot',sources,bundle:{file:'publisher.mjs',bytes:body.length,sha256:digest(body)},build:{esbuild:esbuildVersion,format:'esm',target:'node24',externalImports:external,thirdPartyRuntimeDependencies:0},execution:{minimumNode:'24.19.0',defaultCadenceMs:15000,maximumBackoffMs:60000,requestTimeoutMs:5000,statusMaximumBytes:4*1024*1024,acknowledgementMaximumBytes:4096,financialWriter:false,walletAccess:false}};
await writeFile(resolve(dirname(output),'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o644});
console.log(JSON.stringify({built:true,sourceRelease:release,bundleBytes:body.length,bundleSha256:manifest.bundle.sha256,thirdPartyRuntimeDependencies:0}));
