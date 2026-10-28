/** Synthetic request/Clock chronology over retained supported pool bytes.
 * This proves local chapter reservation, not provider reliability or live exit timing. */
import {test}from'node:test';import assert from'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {PublicKey,SYSVAR_CLOCK_PUBKEY}from'@solana/web3.js';
import {PilotRpc}from'../src/pilot-rpc.js';import{ResearchClockPositionPricer}from'../src/research-clock-pricing.js';
import{nativePaperManagementReserve,NATIVE_PAPER_MANAGEMENT_RESERVE as reserve}from'../src/run-native-paper.js';
const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));

test('known44candidate history timeouts preserve actual SDK holding quotes and close candidate work before the chapter reserve',async()=>{
 const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8')),rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x)),state=structuredClone(rows.find(x=>x.kind==='pool-state').data),accounts=new Map<string,unknown>(state.addresses.map((a:string,i:number)=>[a,state.value[i]]));
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-paper-chapter-')),old=join(directory,'prior.json');let at=Date.parse(proof.quote.validatedAt)+600000,actualStarts=0,failed=0,checks=0;const priorAt=at-120000;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:7,lastObservedAt:priorAt,starts:[priorAt],pending:[{id:1,unobservedBytes:2*MIB}]}),{mode:0o600});const oldBytes=readFileSync(old),realNow=Date.now;Date.now=()=>at;
 const fetcher=(async(_url,init)=>{actualStarts++;const request=JSON.parse(String(init?.body));if(request.method==='getSignaturesForAddress'){failed++;return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{at+=1500;reject(Error('SYNTHETIC no-header timeout settled'));},{once:true});});}
  assert.equal(request.method,'getMultipleAccounts');const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(state.context.slot),0);raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);const clock={owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};at+=5;return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{context:state.context,value:(request.params[0] as string[]).map(a=>a===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:accounts.get(a)??null)}}));})as typeof fetch;
 const rpc=new PilotRpc({directory:join(directory,'rpc'),runId:'synthetic-protection-reserve',baselinePaths:[old],priorPhysicalSettled:true,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher,durationMs:1800000,maxUnits:1500,maxResponseBytes:256*MIB,maxChapters:64,maxStartsPer10s:20,profile:reserve.rpcProfile}),pricer=new ResearchClockPositionPricer(rpc,{record(){}}),position={mint:new PublicKey(proof.quote.mint),fullBaseUnits:BigInt(proof.quote.buy.outputBaseUnits)*3n+1n,minSlot:proof.origin.slot},pools=Array.from({length:6},(_,i)=>new PublicKey(new Uint8Array(32).fill(i+20)).toBase58());
 const check=async()=>{const quote=await pricer.quote(position);checks++;assert.equal(quote.sell.inputBaseUnits,position.fullBaseUnits.toString());assert.equal(quote.timeEvidence,'confirmed-bank-clock');assert.ok(at-Date.parse(quote.receivedAt)<=2000);};
 try{
  await check();
  while(nativePaperManagementReserve(rpc.usage()).candidateWorkWithExposureAllowed){
   const index=failed;assert.ok(index<60,'finite synthetic failure chronology');await assert.rejects(rpc.call('getSignaturesForAddress',[pools[index%6],{limit:100,commitment:'confirmed'}],undefined,{queryTimeoutScope:'independent-history',timeoutMs:1}),/PHYSICAL_TIMEOUT/);await turn();await turn();for(let i=0;i<5;i++){at+=2000;await check();}
   if(failed===44){assert.ok(nativePaperManagementReserve(rpc.usage()).remainingChapters>=16);assert.equal(rpc.usage().inFlight,0);assert.equal(rpc.usage().fatal,null);}
  }
  assert.equal(failed,47);assert.equal(rpc.usage().chapter,48);const before=rpc.usage().newUnits,blocked=nativePaperManagementReserve(rpc.usage());assert.equal(blocked.remainingChapters,16);assert.equal(blocked.entryAllowed,false);assert.equal(blocked.candidateWorkWithExposureAllowed,false);assert.equal(rpc.usage().newUnits,before,'declining candidate admission reserves no hidden operation');
  for(let i=0;i<450;i++){at+=2000;await check();}
  const u=rpc.usage();assert.ok(checks>=686);assert.equal(u.newUnits,actualStarts);assert.equal(u.inFlight,0);assert.equal(u.fatal,null);assert.ok(u.chapter<=52,'fifteen-minute healthy management still has reserved chapters');assert.ok(u.uncertainResponseBytes>=48*2*MIB);assert.deepEqual(readFileSync(old),oldBytes);assert.equal(rpc.usage().maximumNewUnits,1500);assert.equal(rpc.usage().maximumNewResponseBytes,256*MIB);
 }finally{rpc.close();Date.now=realNow;rmSync(directory,{recursive:true,force:true});}
});

test('reserve decisions include next source request and never consume protected units, response headroom, or future chapters',()=>{
 const normal={chapter:0,newUnits:0,maximumNewUnits:1500,newAccountedResponseBytes:0,maximumNewResponseBytes:256*MIB};assert.equal(nativePaperManagementReserve(normal).entryAllowed,true);assert.equal(reserve.startsPerMinute,60);assert.equal(reserve.minimumRemainingResponseBytes,52*MIB);
 for(const patch of [{chapter:48},{newUnits:1010},{newAccountedResponseBytes:205*MIB}]){const r=nativePaperManagementReserve({...normal,...patch});assert.equal(r.candidateWorkWithExposureAllowed,false);}
 assert.equal(nativePaperManagementReserve({...normal,chapter:47}).entryAllowed,false);assert.equal(nativePaperManagementReserve({...normal,chapter:46}).entryAllowed,true);const exceeded=nativePaperManagementReserve({...normal,chapter:65});assert.equal(exceeded.remainingChapters,0);assert.equal(exceeded.overrun,true);assert.equal(exceeded.entryAllowed,false);assert.throws(()=>nativePaperManagementReserve({...normal,chapter:NaN}),/RESERVE_VIEW/);
});
