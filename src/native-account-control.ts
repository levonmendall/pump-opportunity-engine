/** Original-account operator control. Callbacks use the runtime's existing
 * financial owner; this listener never opens a ledger or a TCP endpoint. */
import {chmodSync,existsSync,linkSync,lstatSync,realpathSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createConnection,createServer,type Socket} from 'node:net';
import {dirname,resolve} from 'node:path';

export type NativeAccountControlOptions={
  path:string;
  status:()=>Record<string,unknown>;
  pause:()=>Record<string,unknown>;
  resume:()=>Record<string,unknown>;
  safeStop:()=>Record<string,unknown>;
  onError?:(code:string)=>void;
};

const same=(a:{dev:number;ino:number},b:{dev:number;ino:number})=>a.dev===b.dev&&a.ino===b.ino;
const need=(value:unknown,code:string)=>{if(!value)throw Error(code);};

export async function serveNativeAccountControl(options:NativeAccountControlOptions){
  const path=resolve(options.path),parent=dirname(path),uid=process.getuid?.();
  need(path===options.path&&uid!==undefined&&uid!==0,'NATIVE_CONTROL_NONROOT_CANONICAL_PATH');
  const directory=lstatSync(parent);
  need(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===uid&&(directory.mode&0o777)===0o700&&realpathSync(parent)===parent,'NATIVE_CONTROL_PRIVATE_PARENT');
  if(existsSync(path)){
    const old=lstatSync(path);
    need(old.isSocket()&&old.uid===uid&&old.nlink===1,'NATIVE_CONTROL_FOREIGN_PATH');
    const active=await new Promise<boolean>(done=>{
      const socket=createConnection(path);let finished=false;
      const finish=(value:boolean)=>{if(!finished){finished=true;socket.destroy();done(value);}};
      socket.setTimeout(300,()=>finish(true));socket.once('connect',()=>finish(true));
      socket.once('error',error=>finish((error as NodeJS.ErrnoException).code!=='ECONNREFUSED'));
    });
    need(!active,'NATIVE_CONTROL_ALREADY_ACTIVE');
    const current=lstatSync(path);need(current.isSocket()&&current.uid===uid&&same(old,current),'NATIVE_CONTROL_PATH_CHANGED');
    unlinkSync(path);
  }
  const clients=new Set<Socket>();let closing:Promise<void>|null=null;
  const warn=(code:string)=>{try{options.onError?.(code);}catch{/* Control diagnostics cannot become a financial operation. */}};
  const server=createServer(socket=>{
    if(clients.size>=8){socket.destroy();return;}clients.add(socket);
    socket.once('close',()=>clients.delete(socket));socket.on('error',()=>socket.destroy());
    socket.setTimeout(2000,()=>socket.destroy());let input=Buffer.alloc(0),handled=false;
    socket.on('data',chunk=>{
      if(handled)return;
      if(input.length+chunk.length>2048){warn('NATIVE_CONTROL_REQUEST_BOUND');socket.destroy();return;}
      input=Buffer.concat([input,chunk]);if(!input.includes(10))return;handled=true;
      let answer:Record<string,unknown>;
      try{
        const request=JSON.parse(input.toString('utf8').trim());
        need(request!==null&&typeof request==='object'&&!Array.isArray(request)&&Object.keys(request).length===1&&typeof request.command==='string','NATIVE_CONTROL_REQUEST');
        switch(request.command){
          case 'status':answer=options.status();break;
          case 'pause':answer=options.pause();break;
          case 'resume':answer=options.resume();break;
          case 'safe-stop':answer=options.safeStop();break;
          default:throw Error('NATIVE_CONTROL_COMMAND');
        }
        need(answer!==null&&typeof answer==='object'&&!Array.isArray(answer)&&!('then' in answer),'NATIVE_CONTROL_SYNCHRONOUS_OWNER_REQUIRED');
        const body=JSON.stringify(answer)+'\n';need(Buffer.byteLength(body)<=128*1024,'NATIVE_CONTROL_RESPONSE_BOUND');socket.end(body);
      }catch{warn('NATIVE_CONTROL_REQUEST_UNAVAILABLE');socket.end('{"error":"unsupported or unavailable control request"}\n');}
    });
  });
  server.maxConnections=8;
  try{
    await new Promise<void>((done,reject)=>{
      const failed=(error:Error)=>reject(error);server.once('error',failed);
      server.listen(path,()=>{try{chmodSync(path,0o600);server.off('error',failed);done();}catch(error){reject(error);}});
    });
  }catch(error){for(const socket of clients)socket.destroy();server.close();throw error;}
  const own=lstatSync(path);need(own.isSocket()&&own.uid===uid&&(own.mode&0o777)===0o600,'NATIVE_CONTROL_SOCKET_OWNER');
  server.on('error',()=>warn('NATIVE_CONTROL_LISTENER_UNAVAILABLE'));
  return {close(){
    if(closing)return closing;
    for(const socket of clients)socket.destroy();
    // libuv unlinks the bound pathname itself, before the close callback. A
    // post-close inode check alone cannot protect a replacement at that path.
    // Retain its inode first and restore without overwriting a newer pathname.
    let retained:{path:string;identity:{dev:number;ino:number}}|null=null;
    try{
      const current=lstatSync(path);
      if(!same(own,current)&&!current.isDirectory()){
        const recovery=path+'.preserved-'+randomUUID();linkSync(path,recovery);
        const saved=lstatSync(recovery);need(same(current,saved),'NATIVE_CONTROL_REPLACEMENT_CHANGED');
        retained={path:recovery,identity:saved};warn('NATIVE_CONTROL_REPLACEMENT_RETAINED');
      }
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    closing=new Promise<void>((done,reject)=>server.close(error=>{
      if(error){reject(error);return;}
      try{
        if(retained){
          try{linkSync(retained.path,path);}catch(failure){if((failure as NodeJS.ErrnoException).code!=='EEXIST')throw failure;}
          const current=lstatSync(path);if(same(current,retained.identity))unlinkSync(retained.path);else warn('NATIVE_CONTROL_REPLACEMENT_RECOVERY_FILE_RETAINED');
        }else if(existsSync(path)){const current=lstatSync(path);if(current.isSocket()&&current.uid===uid&&same(own,current))unlinkSync(path);}
        done();
      }catch(failure){reject(failure);}
    }));return closing;
  }};
}
