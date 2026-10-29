// Finite read-only verification collector. The persistent EC2 service is independent.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base=new URL('./',import.meta.url);
const input=new URL('../../coherent-entry-forward-20261029/rolling-supervision/latest.json',base);
const expected={source:'f96f02eeccd56dda6ce811bdc4405f237224c54f',configuration:'acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf',account:'poe-3123e352-4581-455b-85db-acd7e825e99e',inception:'2026-10-26T22:07:36.212Z'};
const startedAt=Date.now(),until=startedAt+40*60000;let stopped=false,lastReceipt=null,rows=0,invalid=0;
for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{stopped=true;});
const append=(name,data)=>fs.appendFileSync(new URL(name,base),JSON.stringify(data)+'\n',{mode:0o600});
append('collector-lifecycle.ndjson',{event:'started',at:startedAt,expected,durationMs:40*60000,networkRequests:0,serviceOperations:0});
while(!stopped&&Date.now()<until){
 try{
  const raw=fs.readFileSync(input);if(raw.length>1024*1024)throw Error('SNAPSHOT_BOUND');
  const d=JSON.parse(raw.toString());
  if(d.receivedAt!==lastReceipt){
   lastReceipt=d.receivedAt;
   const matches=d.source?.release===expected.source&&d.intelligence?.run.configurationSha256===expected.configuration&&d.account?.id===expected.account&&d.account?.inceptionAt===expected.inception;
   append('snapshots.ndjson',{...d,verificationCollector:{retainedAt:Date.now(),inputSha256:createHash('sha256').update(raw).digest('hex'),expectedIdentityMatches:matches}});rows++;if(!matches)invalid++;
   if(rows===1||rows%4===0)console.log(JSON.stringify({at:Date.now(),rows,invalid,sourceAt:d.times?.generatedAt,sequence:d.sequence,status:d.status,run:d.intelligence?.run.id,held:d.positions?.length,sourceUnchanged:matches}));
  }
 }catch{append('collector-read-failures.ndjson',{at:Date.now(),reason:'LOCAL_INPUT_UNAVAILABLE_OR_INVALID',networkRequests:0,serviceOperations:0});}
 await new Promise(r=>setTimeout(r,1000));
}
append('collector-lifecycle.ndjson',{event:'stopped',at:Date.now(),startedAt,rows,invalid,networkRequests:0,serviceOperations:0,financialRuntimeStopped:false});
