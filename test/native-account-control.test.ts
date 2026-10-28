import assert from 'node:assert/strict';
import {chmodSync,existsSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createConnection,createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {serveNativeAccountControl} from '../src/native-account-control.js';
import {runtimeCommand} from '../src/runtime.js';

function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-owner-control-'));chmodSync(directory,0o700);
 const path=join(directory,'control.sock'),calls:string[]=[],warnings:string[]=[];
 const options={path,status:()=>{calls.push('status');return {accountId:'original-fixture',running:true};},pause:()=>{calls.push('pause');return {entriesEnabled:false};},resume:()=>{calls.push('resume');return {resumeRequested:true,entriesEnabled:false};},safeStop:()=>{calls.push('safe-stop');return {safeToExit:false,positions:1,pending:0};},onError:(code:string)=>warnings.push(code)};
 return {directory,path,calls,warnings,options,remove:()=>rmSync(directory,{recursive:true,force:true})};
}
function raw(path:string,input:string){return new Promise<string>(done=>{const socket=createConnection(path);let result='';socket.on('connect',()=>socket.write(input));socket.on('data',chunk=>result+=chunk.toString());socket.on('error',()=>done(result));socket.on('close',()=>done(result));});}

test('existing runtime control client reaches one owner and safe-stop does not abandon exposure',async()=>{
 const f=fixture(),server=await serveNativeAccountControl(f.options);
 try{
  assert.equal((await runtimeCommand(f.path,'status')).accountId,'original-fixture');
  assert.deepEqual(await runtimeCommand(f.path,'pause'),{entriesEnabled:false});
  assert.deepEqual(await runtimeCommand(f.path,'resume'),{resumeRequested:true,entriesEnabled:false});
  assert.deepEqual(await runtimeCommand(f.path,'safe-stop'),{safeToExit:false,positions:1,pending:0});
  assert.equal((await runtimeCommand(f.path,'status')).running,true);
  assert.deepEqual(f.calls,['status','pause','resume','safe-stop','status']);
  assert.equal(f.warnings.length,0);
 }finally{const closing=server.close();assert.equal(server.close(),closing);await closing;assert.equal(existsSync(f.path),false);f.remove();}
});

test('malformed, expanded, oversized or unsupported requests never dispatch financial callbacks',async()=>{
 const f=fixture(),server=await serveNativeAccountControl(f.options);
 try{
  for(const request of ['{"command":"buy"}\n','{"command":"pause","mint":"ignored"}\n','["pause"]\n','not-json\n','{"command":"pause"}\n{"command":"resume"}\n','x'.repeat(2049)])await raw(f.path,request);
  assert.deepEqual(f.calls,[]);assert.ok(f.warnings.length>=5);
 }finally{await server.close();f.remove();}
});

test('private canonical parent and existing live/foreign paths remain protected',async()=>{
 const f=fixture();
 try{
  chmodSync(f.directory,0o755);await assert.rejects(serveNativeAccountControl(f.options),/PRIVATE_PARENT/);chmodSync(f.directory,0o700);
  writeFileSync(f.path,'retained',{mode:0o600});await assert.rejects(serveNativeAccountControl(f.options),/FOREIGN_PATH/);assert.equal(readFileSync(f.path,'utf8'),'retained');rmSync(f.path);
  symlinkSync('/not-opened',f.path);await assert.rejects(serveNativeAccountControl(f.options));rmSync(f.path);
  const live=createServer(socket=>socket.destroy());await new Promise<void>(done=>live.listen(f.path,done));
  try{await assert.rejects(serveNativeAccountControl(f.options),/ALREADY_ACTIVE/);}finally{await new Promise<void>(done=>live.close(()=>done()));}
 }finally{f.remove();}
});

test('stale owned socket recovery preserves the pathname safety check and supports a restart',async()=>{
 const f=fixture();
 try{
  const child=spawnSync('python3',['-c','import socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.close()',f.path]);assert.equal(child.status,0);assert.equal(existsSync(f.path),true);
  const first=await serveNativeAccountControl(f.options);await first.close();const second=await serveNativeAccountControl(f.options);
  try{assert.equal((await runtimeCommand(f.path,'status')).running,true);}finally{await second.close();}
 }finally{f.remove();}
});

test('owner callback failures disclose neither secrets nor a successful operation',async()=>{
 const f=fixture(),secret='PRIVATE_SENTINEL_MUST_NOT_LEAK';f.options.pause=()=>{throw Error(secret);};
 const server=await serveNativeAccountControl(f.options);
 try{const answer=await raw(f.path,'{"command":"pause"}\n');assert.equal(answer.includes(secret),false);assert.match(answer,/unavailable/);assert.equal(f.warnings.at(-1),'NATIVE_CONTROL_REQUEST_UNAVAILABLE');}
 finally{await server.close();f.remove();}
});
