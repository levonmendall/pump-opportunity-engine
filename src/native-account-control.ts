/** Original-account operator control. Callbacks use the runtime's existing
 * financial owner; this listener never opens a ledger or a TCP endpoint. */
import {chmodSync,existsSync,linkSync,lstatSync,realpathSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createConnection,createServer,type Socket} from 'node:net';
import {dirname,resolve} from 'node:path';
import type {PaperLedger,UsdPrice} from './ledger.js';

export type NativeAccountControlOptions={
  path:string;
  status:()=>Record<string,unknown>;
  pause:()=>Record<string,unknown>;
  resume:()=>Record<string,unknown>;
  safeStop:()=>Record<string,unknown>;
  resetDailyLoss?:(requestId:string)=>Record<string,unknown>;
  onError?:(code:string)=>void;
};

/** A dated owner authorization is not a permanent risk waiver. This function
 * uses only the existing runtime writer, never opens a database, and never
 * arms entries. Expected temporary refusals do not stop market capture. */
export const OWNER_DAILY_LOSS_RESET_REASON='owner directive 2026-10-29: remove current daily loss state; one-time reference reset; preserve original financial history';
export function ownerDailyLossReset(options:{ledger:Pick<PaperLedger,'state'|'resetDailyLoss'|'dailyLossResetReceipt'|'consumeDailyLossResetNoop'>;requestId:string;authorizedDay:string;source:{commit:string;sha256:string};runId:string;price:UsdPrice|null;safety:{idle:boolean;recoveryComplete:boolean;evidenceAvailable:boolean;financialAvailable:boolean;uncertainActions:number;automaticRecoveryAllowed:boolean;newHardPauseObserved:boolean};manualPaused?:boolean;safeStopRequested?:boolean;work:string;pauseForReadiness:()=>void;now:number;clock?:()=>number}):Record<string,unknown>{
 const command='reset-daily-loss',before=options.ledger.state(),expected=`owner-daily-loss-reset-${options.authorizedDay.replaceAll('-','')}`;
 const current=()=>{const s=options.ledger.state();return {day:s.daily.day,baselineMicroUsd:s.daily.baselineMicroUsd,lossPaused:s.daily.lossPaused,paused:s.daily.paused,reconciledAt:s.daily.reconciledAt,entriesEnabled:s.controls.entriesEnabled,stopRequested:s.controls.stopRequested,revision:s.revision};};
 const answer=(ok:boolean,reasonCode:string,retryable:boolean,extra:Record<string,unknown>={})=>({ok,command,requestId:options.requestId,accountId:before.accountId,inceptionAt:before.inceptionAt,source:{commit:options.source.commit,sha256:options.source.sha256},runId:options.runId,reasonCode,retryable,resetApplied:false,alreadyClear:false,replayed:false,receipt:null,...extra,current:current()});
 if(options.requestId!==expected||!/^\d{4}-\d\d-\d\d$/.test(options.authorizedDay)||!/^[a-f0-9]{40}$/.test(options.source.commit))return answer(false,'OWNER_RESET_AUTHORIZATION_MISMATCH',false);
 // A lost reply may be retried after another loss, new exposure, an owner stop
 // or a release upgrade. Retrieve only the original durable authorization,
 // before current observation guards; never pause or mutate on replay.
 try{const receipt=options.ledger.dailyLossResetReceipt(options.requestId,OWNER_DAILY_LOSS_RESET_REASON);if(receipt)return answer(true,'OWNER_RESET_REPLAYED',false,{replayed:true,receipt});}
 catch{return answer(false,'OWNER_RESET_ACTION_UNAVAILABLE',false);}
 if(!Number.isSafeInteger(options.now)||options.now>8640000000000000||options.now<before.lastAt)return answer(false,'OWNER_RESET_CLOCK_UNAVAILABLE',true);
 if(new Date(options.now).toISOString().slice(0,10)!==options.authorizedDay||before.daily.day!==options.authorizedDay)return answer(false,'OWNER_RESET_AUTHORIZATION_DAY_EXPIRED',false);
 const safe=options.safety;
 if(!safe.idle||!safe.recoveryComplete||!safe.evidenceAvailable||!safe.financialAvailable||safe.uncertainActions!==0||!['idle','source'].includes(options.work))return answer(false,'OWNER_RESET_FINANCIAL_WORK_UNAVAILABLE',true);
 if(!before.daily.lossPaused){
  try{const receipt=options.ledger.consumeDailyLossResetNoop(options.requestId,options.now,OWNER_DAILY_LOSS_RESET_REASON);return answer(true,'OWNER_RESET_ALREADY_CLEAR',false,{alreadyClear:true,receipt});}
  catch{return answer(false,'OWNER_RESET_REQUIREMENTS_UNAVAILABLE',true);}
 }
 if(before.controls.entriesEnabled&&(!safe.automaticRecoveryAllowed||safe.newHardPauseObserved||options.manualPaused||options.safeStopRequested||before.controls.stopRequested))return answer(false,'OWNER_RESET_HARD_CONTROL_CONFLICT',false);
 if(Object.keys(before.positions).length||Object.keys(before.pending).length)return answer(false,'OWNER_RESET_OWNED_OBLIGATIONS_ACTIVE',true);
 if(!options.price||options.price.at>options.now||options.now-options.price.at>10000||before.daily.reconciledAt<=0||options.now-before.daily.reconciledAt>2000)return answer(false,'OWNER_RESET_FRESH_RECONCILIATION_REQUIRED',true);
 try{
  // Existing hard/owner stops already have entries disabled and are preserved.
  // A currently enabled control first enters the existing temporary-readiness
  // path, so the reset's deliberately paused daily state can recover normally.
  if(before.controls.entriesEnabled)options.pauseForReadiness();
  const paused=options.ledger.state(),priorRevision=paused.revision,resetAt=options.clock?.()??Math.max(options.now,paused.lastAt);
  if(!Number.isSafeInteger(resetAt)||resetAt<paused.lastAt||resetAt>8640000000000000)return answer(false,'OWNER_RESET_CLOCK_UNAVAILABLE',true);
  if(new Date(resetAt).toISOString().slice(0,10)!==options.authorizedDay)return answer(false,'OWNER_RESET_AUTHORIZATION_DAY_EXPIRED',false);
  const receipt=options.ledger.resetDailyLoss(options.requestId,resetAt,options.price,{},OWNER_DAILY_LOSS_RESET_REASON);
  const after=options.ledger.state();
  if(after.daily.lossPaused)return answer(false,'OWNER_RESET_LOSS_REOCCURRED_AFTER_AUTHORIZATION',false,{receipt});
  return answer(true,'OWNER_RESET_RECORDED_FRESH_READINESS_REQUIRED',false,{resetApplied:after.revision>priorRevision,receipt});
 }catch{return answer(false,'OWNER_RESET_REQUIREMENTS_UNAVAILABLE',true);}
}

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
        need(request!==null&&typeof request==='object'&&!Array.isArray(request)&&typeof request.command==='string','NATIVE_CONTROL_REQUEST');
        if(request.command==='reset-daily-loss')need(Object.keys(request).sort().join('|')==='command|requestId'&&typeof request.requestId==='string'&&/^[a-z0-9-]{1,100}$/.test(request.requestId),'NATIVE_CONTROL_RESET_AUTHORIZATION');
        else need(Object.keys(request).length===1,'NATIVE_CONTROL_REQUEST');
        switch(request.command){
          case 'status':answer=options.status();break;
          case 'pause':answer=options.pause();break;
          case 'resume':answer=options.resume();break;
          case 'safe-stop':answer=options.safeStop();break;
          case 'reset-daily-loss':need(options.resetDailyLoss,'NATIVE_CONTROL_RESET_UNAVAILABLE');answer=options.resetDailyLoss!(request.requestId);break;
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
