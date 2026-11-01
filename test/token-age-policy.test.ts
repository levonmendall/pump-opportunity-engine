import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {TOKEN_AGE_POLICY,decodeTokenCreationProof,tokenAgeDecision,validTokenCreationProof,type TokenCreationProof} from '../src/token-age-policy.js';
import {OPPORTUNITY_PRIORITY_POLICY,observationFairnessBonus,observationSelectionPriority} from '../src/opportunity-priority-policy.js';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const AT=Date.parse('2026-10-31T22:00:00Z'),DAY=86_400_000;
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const sig=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
function proof(n=1,createdAt=AT-3600000,availableAt=AT):TokenCreationProof{return {version:TOKEN_AGE_POLICY.version,mint:mint(n),signature:sig(n),slot:1,createdAt,availableAt,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)};}
function creation(name:'create'|'create_v2'='create',nested=false){
 const m=mint(1),curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),new PublicKey(m).toBuffer()],new PublicKey(PUMP))[0].toBase58(),keys=[PUMP,TOKEN,m,mint(2),curve,mint(3)];
 if(name==='create_v2')keys[1]='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
 const create={programIdIndex:0,accounts:[2,3,4],data:bs58.encode(Buffer.concat([createHash('sha256').update('global:'+name).digest().subarray(0,8),Buffer.alloc(50)]))};
 const init={programIdIndex:1,accounts:[2],data:bs58.encode(Buffer.from([20,...Buffer.alloc(34)])),stackHeight:nested?3:2};
 const tx={version:0,slot:123,blockTime:(AT-3600000)/1000,transaction:{signatures:[sig(1)],message:{accountKeys:keys,instructions:[nested?{programIdIndex:5,accounts:[],data:''}:create]}},meta:{err:null,innerInstructions:[{index:0,instructions:nested?[{...create,stackHeight:2},init]:[init]}]}};
 return {tx,input:{mint:m,signature:sig(1),availableAt:AT,commitment:'finalized' as const}};
}

test('additive fairness saturates at 0.05; no duration can multiply neutral merit',()=>{
 for(const wait of [0,1,1000,60000,300000,DAY,30*DAY,Number.MAX_SAFE_INTEGER]){
  const bonus=observationFairnessBonus(wait);assert.ok(bonus>=0&&bonus<=0.05);assert.ok(observationSelectionPriority(0.5,wait)<=0.55);assert.ok(observationSelectionPriority(0.9,0)>observationSelectionPriority(0.5,wait));
 }
 assert.equal(observationFairnessBonus(30000),0.025);assert.equal(observationFairnessBonus(60000),0.05);assert.equal(OPPORTUNITY_PRIORITY_POLICY.version,'shared-flow-opportunity-priority-v2');
 assert.throws(()=>observationFairnessBonus(-1));assert.throws(()=>observationSelectionPriority(NaN,1));
});
test('verified token age has inclusive 24h boundary; unknown, future and mismatched proofs refuse',()=>{
 const p=proof(1,AT-DAY,AT-1000);assert.equal(tokenAgeDecision(p.mint,AT,p).allowed,true);assert.equal(tokenAgeDecision(p.mint,AT+1,p).reason,'TOKEN_AGE_EXCEEDS_24H');
 assert.equal(tokenAgeDecision(p.mint,AT,null).reason,'TOKEN_AGE_UNVERIFIED');assert.equal(tokenAgeDecision(mint(2),AT,p).reason,'TOKEN_AGE_INVALID');
 assert.equal(tokenAgeDecision(p.mint,AT,{...p,createdAt:AT+1000}).reason,'TOKEN_AGE_INVALID');assert.equal(tokenAgeDecision(p.mint,AT,{...p,availableAt:AT+1}).reason,'TOKEN_AGE_INVALID');
 for(const fake of [{migrationAt:AT,migrationVerified:true},{firstSeenAt:AT},{verifiedAt:AT,currentPoolProof:true}])assert.equal(tokenAgeDecision(p.mint,AT,fake).allowed,false);
});
test('successful finalized Pump create and create_v2 prove birth for direct and wrapped CPI',()=>{
 for(const name of ['create','create_v2'] as const)for(const nested of [false,true]){
  const f=creation(name,nested),p=decodeTokenCreationProof(f.tx,f.input);assert.ok(p);assert.ok(validTokenCreationProof(p));assert.equal(p.createdAt,AT-3600000);assert.equal(p.instruction,name);assert.equal(p.signature,sig(1));
 }
});
test('lookup-table account keys are resolved without treating their receipt time as token birth',()=>{
 const f=creation();const keys=f.tx.transaction.message.accountKeys;const moved=keys.splice(4,2);(f.tx.meta as any).loadedAddresses={writable:moved,readonly:[]};
 assert.equal(decodeTokenCreationProof(f.tx,f.input)?.createdAt,AT-3600000);
});
test('failed, unrelated, incomplete, wrong-mint and forged-log creation evidence cannot pass',()=>{
 const mutations:Array<(f:ReturnType<typeof creation>)=>void>=[
  f=>{f.tx.meta.err={InstructionError:1} as any;},f=>{f.tx.transaction.signatures[0]=sig(2);},f=>{f.tx.blockTime=AT/1000+1;},
  f=>{f.tx.transaction.message.accountKeys[0]=mint(7);},f=>{f.input.mint=mint(4);},f=>{f.tx.transaction.message.accountKeys[4]=mint(7);},
  f=>{f.tx.transaction.message.instructions[0]!.data=bs58.encode(createHash('sha256').update('global:migrate').digest().subarray(0,8));},
  f=>{f.tx.meta.innerInstructions=[];},f=>{f.tx.meta.innerInstructions[0]!.instructions[0]!.stackHeight=4;},
  f=>{f.tx.meta.innerInstructions[0]!.instructions[0]!.accounts=[3];},f=>{f.tx.meta.innerInstructions[0]!.instructions[0]!.data=bs58.encode(Buffer.from([3,...Buffer.alloc(34)]));},
  f=>{f.input.commitment='confirmed' as any;},
 ];for(const mutate of mutations){const f=creation();mutate(f);assert.equal(decodeTokenCreationProof(f.tx,f.input),null);}
 const f=creation();f.tx.transaction.message.instructions.push({programIdIndex:0,accounts:[],data:''});f.tx.meta.innerInstructions[0]!.index=1;assert.equal(decodeTokenCreationProof(f.tx,f.input),null,'unrelated child mint initialization cannot prove the other creation');
});
function watchFixture(){
 let at=AT;const registry=new MarketRegistry(':memory:',{now:()=>at}),records:any[]=[],options={registry,enforceTokenAge24h:true as const,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:(kind:string,data:unknown)=>records.push({kind,data})},watch=new PilotWatch(options);
 const seed=(n:number,createdAt?:number)=>{const m=mint(n);watch.discover({signature:sig(n),feedMint:m,receivedAt:at});watch.verify(sig(n),{mint:m,pool:mint(n+50),migrationAt:at-300000,verifiedAt:at});if(createdAt!==undefined)registry.putTokenCreationProof(proof(n,createdAt,at));return m;};
 return {registry,watch,seed,records,options,setAt:(next:number)=>{at=next;},now:()=>at};
}
test('age gate precedes allocation and technical retries; migration does not make an old mint young',()=>{
 const f=watchFixture();try{
  const young=f.seed(1,AT-3600000),edge=f.seed(2,AT-DAY),old=f.seed(3,AT-DAY-1000),unknown=f.seed(4);
  assert.equal(f.watch.next(AT,new Set([young,edge])),null);assert.equal(f.watch.next(AT,new Set([young]))!.mint,edge);
  f.watch.requestTechnicalReevaluation(old,{reason:'entry-quote-unavailable',failedWindowEndAt:AT-10000},AT);
  assert.equal(f.watch.next(AT,new Set([young,edge])),null,'retry cannot bypass age');
  assert.throws(()=>f.watch.transition(old,'DEEP_OBSERVATION','out of scope'),/OBSERVATION_AGE/);assert.throws(()=>f.watch.transition(unknown,'DEEP_OBSERVATION','unknown age'),/OBSERVATION_AGE/);
  f.setAt(AT+1);assert.equal(f.watch.next(AT+1,new Set([young])),null);
  assert.equal(f.watch.snapshot(AT+1,'liquidity-resilient-momentum-v3.1').summary.queued,1);assert.equal(f.registry.count(),4,'history and awareness retained');
  assert.equal(f.watch.serviceableBacklog(AT+1).population.eligibleNow,1);assert.equal(f.watch.allocationReadySince(old,AT+1),null);
 }finally{f.registry.close();}
});
test('restart preserves aged held/pending obligations and does not resurrect expired candidates',()=>{
 const f=watchFixture();try{
  const held=f.seed(1,AT-3600000),pending=f.seed(2,AT-3600000),candidate=f.seed(3,AT-3600000);
  f.watch.transition(held,'HELD','fixture owned');f.watch.transition(pending,'ENTRY_PENDING','fixture pending');
  const checkpoint=f.watch.export();f.setAt(AT+DAY);const resumed=new PilotWatch({...f.options,restored:checkpoint});
  assert.equal(resumed.lookupIdentity(held)!.state,'HELD');assert.equal(resumed.lookupIdentity(pending)!.state,'ENTRY_PENDING');assert.equal(resumed.next(f.now(),new Set()),null);assert.equal(resumed.lookupIdentity(candidate)!.state,'WATCH');assert.equal(f.registry.count(),3);
 }finally{f.registry.close();}
});
test('creation proof cannot be refreshed into a later birthday; repeated identical proof is harmless',()=>{
 const f=watchFixture();try{const m=f.seed(1,AT-3600000),p=f.registry.tokenCreationProof(m)!;f.registry.putTokenCreationProof(p);assert.throws(()=>f.registry.putTokenCreationProof({...p,createdAt:AT-1000}),/CONFLICT/);assert.equal(f.registry.tokenCreationProof(m)!.createdAt,AT-3600000);}finally{f.registry.close();}
});
test('age-proof acquisition uses an observed creation signature, only after market relevance, and respects retry persistence',()=>{
 let at=AT;const r=new MarketRegistry(':memory:',{now:()=>at}),m=mint(1),request={mint:m,signature:sig(1)};try{
  r.observeIdentity({...request,at:AT,source:'pumpportal-new-token',kind:'creation'});assert.equal(r.nextTokenCreationRequest(at),undefined,'no per-launch RPC fan-out');
  r.observeIdentity({mint:m,signature:sig(2),at:AT,source:'pumpportal-migration',kind:'migration'});assert.deepEqual(r.nextTokenCreationRequest(at),request);
  r.deferTokenCreationRequest(request,at,'TOKEN_CREATION_NOT_FINALIZED');assert.equal(r.nextTokenCreationRequest(at),undefined);
  at+=60000;r.observeIdentity({mint:m,signature:sig(2),at,source:'pumpportal-migration',kind:'migration'});assert.deepEqual(r.nextTokenCreationRequest(at),request);
  r.putTokenCreationProof(proof(1,AT-3600000,at));assert.equal(r.nextTokenCreationRequest(at),undefined,'verified birth is never fetched again');assert.equal(r.tokenAgeSummary(at).within24h,1);
 }finally{r.close();}
});
test('fairness cannot compensate for a merit deficit greater than 0.05',()=>{
 for(let a=0;a<=100;a++)for(let b=0;b<=100;b++)if(b-a>5)assert.ok(observationSelectionPriority(a/100,DAY)<observationSelectionPriority(b/100,0));
});
