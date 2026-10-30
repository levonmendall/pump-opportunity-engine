import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PilotRpc} from '/workspace/poe-live-provider-protection/src/pilot-rpc.ts';
const directory=mkdtempSync(join(tmpdir(),'poe-independent-late-hint-')),old=join(directory,'prior.json');let at=200000,calls=0,release!:(r:Response)=>void,id=0;
writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));const prior=readFileSync(old);
const rpc=new PilotRpc({directory:join(directory,'run'),runId:'independent-late-200-hint',baselinePaths:[old],priorPhysicalSettled:true,now:()=>at,monotonic:()=>at,sleep:async(ms)=>{at+=ms;},fetcher:(async(_u,init)=>{calls++;const req=JSON.parse(String(init?.body));id=req.id;if(calls===1)return new Promise<Response>(resolve=>{release=resolve;});at+=50;return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[]}));})as typeof fetch});
try{
 await assert.rejects(rpc.call('getMultipleAccounts'),/PHYSICAL_TIMEOUT/);assert.equal(rpc.usage().inFlight,1);at+=1000;
 release(new Response(JSON.stringify({jsonrpc:'2.0',id,result:[]}),{headers:{'retry-after':'10'}}));await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(rpc.usage().inFlight,0);
 const before=rpc.usage();let error:string|null=null;try{await rpc.callProtection('getMultipleAccounts');}catch(e){error=String(e);}
 console.log(JSON.stringify({calls,error,at,providerRestrictionUntil:before.protectionRecovery.providerRestrictionUntil,ordinaryCooldownUntil:before.cooldownUntil,expectedRetryAfter:216000,physicalSettledBeforeProbe:true}));
 assert.equal(calls,1,'A late explicit Retry-After hint must prevent a protection probe before it expires');
}finally{rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(directory,{recursive:true,force:true});}
