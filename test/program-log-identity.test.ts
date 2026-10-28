/** Explicitly synthetic identity/feature parity. No provider or forward signal. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bs58 from 'bs58';
import {FlowWindow,eventIdentity,copyEventIdentity,type ProgramLogEventIdentity,type NormalizedTrade} from '../src/strategy.js';
import {PaperTrader} from '../src/trader.js';
import {DisposableLedger} from '../src/ledger.js';
const T=36_000_000,PROGRAM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',MINT='SYNTHETIC-identity-mint';
const signature=(i:number)=>bs58.encode(Buffer.alloc(64,i+1));
const logIdentity=(i=0):ProgramLogEventIdentity=>({kind:'program-log',signature:signature(i),program:PROGRAM,logIndex:10+i,frameOrdinal:1+i});
const trade=(i:number,logs:boolean):NormalizedTrade=>({identity:logs?logIdentity(i):{signature:signature(i),instructionIndex:1,eventIndex:i},mint:MINT,wallet:'SYNTHETIC-wallet-'+i%6,side:i%4===3?'sell':'buy',quoteLamports:i%4===3?'50000000':'300000000',tokenUnits:String(300000-i*5000),receivedAt:T+i*5000+100,commitment:'confirmed',slot:100+i});

test('new program-log identity has an explicit namespace while legacy keys stay unchanged',()=>{
 const legacy={signature:'legacy-fixture:with-colons',instructionIndex:2,eventIndex:3};assert.equal(eventIdentity(legacy),'legacy-fixture:with-colons:2:3');assert.deepEqual(copyEventIdentity(legacy),legacy);
 const log=logIdentity(),key=eventIdentity(log);assert.match(key,/^program-log-v1:\[/);assert.deepEqual(copyEventIdentity(log),log);assert.notEqual(eventIdentity({signature:log.signature,instructionIndex:log.logIndex,eventIndex:log.frameOrdinal}),key);
 const collisionAttempt={signature:'program-log-v1:[namespace-lookalike]',instructionIndex:log.logIndex,eventIndex:log.frameOrdinal};
 // Even a legacy signature crafted to resemble the namespace ends with its
 // numeric indices; log identities end with the explicit JSON tuple boundary.
 assert.notEqual(eventIdentity(collisionAttempt),key);assert.match(eventIdentity(collisionAttempt),/:\d+:\d+$/);assert.match(key,/\]$/);
});

test('identical chronological trade fields produce identical baseline features for legacy and log identities',()=>{
 const legacy=new FlowWindow(MINT,T),logs=new FlowWindow(MINT,T);
 for(let i=0;i<12;i++){assert.equal(legacy.ingest(trade(i,false)),'accepted');assert.equal(logs.ingest(trade(i,true)),'accepted');}
 assert.deepEqual(logs.features(T+60000),legacy.features(T+60000));assert.equal(logs.features(T+60000).tradeCount,12);
 const sameSignature=new FlowWindow(MINT,T),a=trade(0,false),b={...trade(0,true),receivedAt:T+101};assert.equal(sameSignature.ingest(a),'accepted');assert.equal(sameSignature.ingest(b),'accepted');assert.equal(sameSignature.features(T+60000).tradeCount,2,'distinct identity namespaces never deduplicate each other');
});

test('log duplicates, confirmations, corrections and reversals preserve legacy invalidation behavior',()=>{
 const legacy=new FlowWindow(MINT,T),logs=new FlowWindow(MINT,T);
 for(const [w,isLog] of [[legacy,false],[logs,true]] as const){const first=trade(0,isLog);assert.equal(w.ingest({...first,commitment:'processed'}),'accepted');assert.equal(w.ingest({...first,receivedAt:T+101}),'confirmed');assert.equal(w.ingest({...first,receivedAt:T+102}),'duplicate');assert.equal(w.features(T+60000).tradeCount,1);assert.equal(w.ingest({...first,receivedAt:T+60001,quoteLamports:'300000001'}),'invalidated');assert.equal(w.features(T+60002).qualityReason,'correction');w.reverse(first.identity,T+60003);assert.equal(w.features(T+60003).qualityReason,'reversal');assert.equal(w.ingest({...first,receivedAt:T+60004}),'duplicate');assert.equal(w.features(T+60004).tradeCount,0);}
 assert.deepEqual(logs.features(T+60004),legacy.features(T+60004));
});

test('malformed or mixed program-log identities cannot invent positions or accept incomplete keys',()=>{
 const original=logIdentity();
 for(const changed of [
  {...original,signature:'not-a-signature'}, {...original,signature:bs58.encode(Buffer.alloc(63,1))},
  {...original,program:'invalid-public-key'}, {...original,program:bs58.encode(Buffer.alloc(31,1))},
  {...original,logIndex:-1}, {...original,logIndex:1.5}, {...original,logIndex:4096}, {...original,logIndex:NaN},
  {...original,frameOrdinal:-1}, {...original,frameOrdinal:4096}, {...original,kind:'unknown'},
  {...original,instructionIndex:0}, {...original,eventIndex:0},
 ])assert.throws(()=>eventIdentity(changed as never),/identity required/);
 assert.throws(()=>eventIdentity({signature:original.signature,logIndex:1,frameOrdinal:1} as never),/identity required/);
 assert.deepEqual(copyEventIdentity({...original,untrusted:'MUST_NOT_PROPAGATE'} as never),original);
});

function traderFixture(t:TestContext){const directory=mkdtempSync(join(tmpdir(),'poe-SYNTHETIC-log-identity-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-log-identity');let at=T;ledger.initialize({microUsdPerSol:'100000000',at,source:'SYNTHETIC only'},at);const records:Array<{kind:string;data:any}>=[];const trader=new PaperTrader({ledger,now:()=>at,context:async()=>({price:null,marks:{}}),quote:async()=>null,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'SYNTHETIC no execution'},recorder:{record(kind,data){records.push({kind,data});}},flowVerification:{verified:true,evidence:'SYNTHETIC identity behavior only'}});trader.start();trader.admit({mint:MINT,migrationAt:T-300000,migrationVerified:true,supportedPool:true,evidence:'SYNTHETIC no market support claim'});trader.activateFlow(MINT,'SYNTHETIC collection');t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});return {trader,ledger,records,setTime(value:number){at=value;}};}

test('trader ingestion and reversal record the actual log identity without fabricated compiled indices',t=>{
 const f=traderFixture(t),input=trade(0,true),expected=structuredClone(input.identity);f.setTime(input.receivedAt);assert.equal(f.trader.ingest(input),'accepted');const row=f.records.find(r=>r.kind==='trader-input'&&r.data.kind==='trade')!;assert.deepEqual(row.data.trade.identity,expected);assert.notEqual(row.data.trade.identity,input.identity);assert.equal(Object.hasOwn(row.data.trade.identity,'instructionIndex'),false);assert.equal(Object.hasOwn(row.data.trade.identity,'eventIndex'),false);
 (input.identity as ProgramLogEventIdentity).logIndex=999;assert.deepEqual(row.data.trade.identity,expected,'later caller mutation cannot alter recorded identity');
 const reversed=structuredClone(expected);f.setTime(T+200);f.trader.reverse(MINT,reversed);const reversal=f.records.find(r=>r.kind==='trader-input'&&r.data.kind==='reversal')!;assert.deepEqual(reversal.data.identity,expected);assert.notEqual(reversal.data.identity,reversed);assert.equal(Object.hasOwn(reversal.data.identity,'eventIndex'),false);(reversed as ProgramLogEventIdentity).frameOrdinal=999;assert.deepEqual(reversal.data.identity,expected);
 assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'0');
});
