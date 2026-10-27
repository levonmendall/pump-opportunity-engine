#!/usr/bin/env node
/** Independent reporting-only reader. No ledger, trading, wallet or provider imports. */
import {open,constants} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectPilotStatus} from '../dist/src/pilot-telemetry.js';
const DESTINATION='https://meme-machine-dashboard-staging.onrender.com/api/pilot';
export async function readPrivateFile(path,limit){
 const fd=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await fd.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||s.size>limit)throw Error('Private bounded owner file required');
  const data=Buffer.alloc(Math.min(limit+1,s.size+1));let size=0;for(;;){const r=await fd.read(data,size,data.length-size,size);size+=r.bytesRead;if(size>limit)throw Error('Reporting input limit');if(!r.bytesRead)break;if(size===data.length)throw Error('Reporting input changed while reading');}return data.subarray(0,size).toString('utf8');
 }finally{await fd.close();}
}
export async function publishPilotStatus({file,secret,accountId,inceptionAt,endpoint=DESTINATION,fetcher=fetch}){
 const url=new URL(endpoint);if(url.href!==DESTINATION)throw Error('Only the configured POE reporting receiver is allowed');
 if(typeof secret!=='string'||secret.length<32||secret.length>512||/[\s\u0000-\u001f]/.test(secret))throw Error('Dedicated reporting credential required');
 const snapshot=projectPilotStatus(JSON.parse(await readPrivateFile(file,4*1024*1024)));
 if(snapshot.accountId!==accountId||snapshot.inceptionAt!==inceptionAt)throw Error('Pilot reporting identity mismatch');
 if(snapshot.generatedAt>Date.now()+5000)throw Error('Pilot clock is in the future');
 const r=await fetcher(url,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(5000)});
 if(!r.ok){await r.body?.cancel();throw Error('Pilot reporting receiver unavailable');}
 const reader=r.body?.getReader();if(!reader)throw Error('Reporting acknowledgement unavailable');let size=0;const chunks=[];
 try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>4096){await reader.cancel();throw Error('Reporting response limit');}chunks.push(p.value);}}finally{reader.releaseLock();}
 const result=JSON.parse(Buffer.concat(chunks).toString('utf8')).result;if(!['accepted','duplicate'].includes(result))throw Error('Reporting acknowledgement invalid');
 return {published:true,result,accountId:snapshot.accountId,runId:snapshot.runId,sourceAt:snapshot.generatedAt,running:snapshot.running,sourceAgeMs:Math.max(0,Date.now()-snapshot.generatedAt)};
}
async function main(){
 const args=process.argv.slice(2),i=args.indexOf('--file'),watch=args.includes('--watch');if(i<0||!args[i+1])throw Error('Use --file /absolute/status.json [--watch]');
 const file=resolve(args[i+1]),keyFile=process.env.POE_PILOT_INGEST_SECRET_FILE;
 if(!keyFile)throw Error('Attach the dedicated reporting credential through a private file');
 const secret=(await readPrivateFile(keyFile,4096)).trim(),accountId=process.env.POE_PILOT_ACCOUNT_ID,inceptionAt=Number(process.env.POE_PILOT_INCEPTION_AT);
 if(!/^poe-pilot-[a-z0-9-]+$/.test(accountId??'')||!Number.isSafeInteger(inceptionAt)||inceptionAt<=0)throw Error('Actual pilot identity required');
 let stopped=false,failures=0;const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 do{try{console.log(JSON.stringify(await publishPilotStatus({file,secret,accountId,inceptionAt,endpoint:process.env.POE_PILOT_REPORT_URL??DESTINATION})));failures=0;}catch{failures++;console.error('Pilot reporting unavailable; source timestamps and trading state unchanged.');if(!watch)process.exitCode=1;}
  if(watch&&!stopped)await new Promise(r=>{const done=()=>{clearTimeout(timer);process.removeListener('SIGINT',done);process.removeListener('SIGTERM',done);r();};const timer=setTimeout(done,Math.min(60000,15000*2**Math.min(failures,2)));process.once('SIGINT',done);process.once('SIGTERM',done);});
 }while(watch&&!stopped);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error('Pilot publisher configuration rejected; no trading state changed.');process.exitCode=1;});
