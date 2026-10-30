/** Offline CLI regression: synthetic FD metadata models the owner's root0440
 * observation. This proves the executable path, NOT actual host ACL readability. */
import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const root=fileURLToPath(new URL('.',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'poe-offline-credential-'));
try{
 const secret=join(dir,'synthetic-credential'),snapshot=join(dir,'snapshot.json'),hook=join(dir,'synthetic-fd-hook.mjs');writeFileSync(secret,'fixture-only-not-an-actual-credential-012345',{mode:0o600});
 writeFileSync(hook,`import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';const path='/run/credentials/poe-runtime.service/poe-ingest-secret',open=fs.openSync,stat=fs.fstatSync,close=fs.closeSync,fds=new Set();fs.openSync=(p,...args)=>{const fd=open(p===path?${JSON.stringify(secret)}:p,...args);if(p===path)fds.add(fd);return fd;};fs.fstatSync=(fd,...args)=>{const s=stat(fd,...args);if(fds.has(fd)){s.uid=0;s.gid=0;s.mode=0o100000|Number(process.env.FIXTURE_MODE);}return s;};fs.closeSync=(fd)=>{fds.delete(fd);return close(fd);};syncBuiltinESMExports();globalThis.fetch=()=>{throw Error('OFFLINE_NO_NETWORK_ALLOWED');};`,{mode:0o600});
 const bundle=resolve(root,'snapshot-publisher.mjs');const results=[];
 for(const mode of[0o440,0o644]){
  const args=['--permission','--allow-fs-read='+bundle,'--allow-fs-read='+hook,'--allow-fs-read='+secret,'--allow-fs-read='+snapshot,'--import',hook,'--max-old-space-size=64','--disable-proto=throw',bundle,'--watch','--file',snapshot,'--account-id','poe-3123e352-4581-455b-85db-acd7e825e99e','--inception-at','2026-10-26T22:07:36.212Z','--release','5e55d8b939de99698ddb311a282461931fcbc957','--strategy','persistent-buying-pilot-v1'];
  const p=spawn(process.execPath,args,{env:{PATH:'/usr/bin:/bin',CREDENTIALS_DIRECTORY:'/run/credentials/poe-runtime.service',POE_PUBLISH_SECRET_FILE:'/run/credentials/poe-runtime.service/poe-ingest-secret',FIXTURE_MODE:String(mode)},stdio:['ignore','pipe','pipe']});let stdout='',stderr='',ended=false;p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);const settled=new Promise(r=>p.on('close',c=>{ended=true;r(c);}));await new Promise(r=>setTimeout(r,1000));const alive=!ended;if(alive)p.kill('SIGTERM');const code=await settled;
  assert.equal(alive,mode===0o440,stderr);assert.equal(code,mode===0o440?0:1);if(mode===0o440)assert.equal(JSON.parse(stdout).sourceAvailable,false);else assert.match(stderr,/PRIVATE_PUBLISHER_FILE/);results.push({syntheticMode:mode.toString(8),aliveAfterOneSecond:alive,exitCode:code});
 }
 console.log(JSON.stringify({kind:'OFFLINE_SYNTHETIC_FD_METADATA_ONLY',results,actualCredentialRead:false,financialFilesRead:false,networkRequests:0,hostAclReadabilityVerified:false},null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
