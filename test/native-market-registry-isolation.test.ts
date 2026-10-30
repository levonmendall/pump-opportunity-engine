import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeMarketRegistryIsolation} from '../src/native-market-registry-isolation.js';
import {projectMarketCoverageReporting} from '../src/market-coverage-reporting.js';
const T=Date.parse('2026-10-30T23:00:00.000Z');
const storageError=(code:string)=>Object.assign(new Error('private storage diagnostic'),{code});

test('a constructor storage refusal preserves management availability and requires a real-store commit before reopening discovery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-isolation-')),facts:unknown[]=[];let unavailable=true,entriesOpen=true;
 const isolation=new NativeMarketRegistryIsolation({now:()=>T,open:()=>{if(unavailable)throw storageError('EACCES');return new MarketRegistry(join(dir,'market.sqlite'),{now:()=>T});},onFailure:fact=>{facts.push(fact);entriesOpen=false;}});
 try{
  assert.equal(entriesOpen,false);assert.equal(isolation.registry.health().available,false);assert.equal(isolation.unavailable(),true);assert.equal(isolation.recover(),false);
  const coverage=projectMarketCoverageReporting({marketCoverage:isolation.coverage(T)},T)!;
  assert.equal(coverage.persistence.state,'unavailable');assert.equal(coverage.lifetime.uniqueTokensDiscovered,null);assert.equal(coverage.active.deepObserving,null);assert.ok(coverage.limitations.includes('REGISTRY_STORAGE_UNAVAILABLE'));assert.doesNotMatch(JSON.stringify(facts),/private storage diagnostic/);
  let protectionChecks=0;const protectExisting=()=>++protectionChecks;protectExisting();assert.equal(protectionChecks,1,'the unavailable discovery store does not own or close existing-position work');
  unavailable=false;assert.equal(isolation.recover(),true);assert.equal(isolation.registry.health().available,true);assert.equal(isolation.registry.getMetadata<any>('runtime-storage-health-probe').at,T);assert.equal(entriesOpen,false,'successful storage recovery alone does not grant financial entry permission');
 }finally{isolation.close();rmSync(dir,{recursive:true,force:true});}
});

test('read failures are identified exactly, unavailable coverage never becomes empty-store coverage, and durable identities survive',()=>{
 const real=new MarketRegistry(':memory:',{now:()=>T});real.observeIdentity({mint:'retained',at:T,source:'fixture'});let failRead=false;
 const fault=storageError('SQLITE_IOERR');
 const isolation=new NativeMarketRegistryIsolation({now:()=>T,open:()=>new Proxy(real,{get:(target,key)=>{if(key==='coverageSnapshot'&&failRead)return ()=>{throw fault;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}),onFailure:()=>{}});
 try{
  assert.equal(isolation.registry.coverageSnapshot(T).lifetime.uniqueTokensDiscovered,1);failRead=true;
  assert.throws(()=>isolation.registry.coverageSnapshot(T),error=>error===fault);assert.equal(isolation.caused(fault),true);assert.equal(isolation.caused(storageError('SQLITE_IOERR')),false,'a financial SQLite error is not reclassified as a discovery failure');
  assert.equal(isolation.coverage(T).lifetime.uniqueTokensDiscovered,null);assert.equal(isolation.registry.health().available,false);
  // Settling old source objects can touch the inert store; those rows must never
  // become recovered discovery history or authorize financial work.
  isolation.registry.observeIdentity({mint:'inert-only',at:T,source:'fixture'});failRead=false;assert.equal(isolation.recover(),true);
  assert.equal(isolation.registry.coverageSnapshot(T).lifetime.uniqueTokensDiscovered,1);assert.equal(isolation.registry.distinctCount('lightweight-screened'),1);
 }finally{isolation.close();}
});

test('a failed durable transaction is rolled back and its callback is never replayed into the inert store',()=>{
 const real=new MarketRegistry(':memory:',{now:()=>T}),fault=storageError('SQLITE_FULL');let calls=0;
 const isolation=new NativeMarketRegistryIsolation({now:()=>T,open:()=>new Proxy(real,{get:(target,key)=>{if(key==='transaction')return (fn:()=>unknown)=>target.transaction(()=>{const result=fn();throw fault;return result;});const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}),onFailure:()=>{}});
 try{
  assert.throws(()=>isolation.registry.transaction(()=>{calls++;real.observeIdentity({mint:'must-rollback',at:T,source:'fixture'});}),error=>error===fault);
  assert.equal(calls,1);assert.equal(real.coverageSnapshot(T).lifetime.uniqueTokensDiscovered,0);assert.equal(isolation.caused(fault),true);
 }finally{isolation.close();}
});

test('invalid application input retains its original error and does not hide behind storage quarantine',()=>{
 const isolation=new NativeMarketRegistryIsolation({now:()=>T,open:()=>new MarketRegistry(':memory:',{now:()=>T}),onFailure:()=>assert.fail('invalid market input is not a storage outage')});
 try{assert.throws(()=>isolation.registry.observeIdentity({mint:'',at:T,source:'fixture'}),/MARKET_REGISTRY_IDENTITY/);assert.equal(isolation.unavailable(),false);}finally{isolation.close();}
});

test('a missing durable checkpoint identity cannot recover through a successful empty-store write',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-binding-')),path=join(dir,'market.sqlite');
 const isolation=new NativeMarketRegistryIsolation({now:()=>T,open:()=>new MarketRegistry(path,{now:()=>T}),onFailure:()=>{}});
 try{
  const failure=new Error('PILOT_WATCH_DURABLE_HISTORY_UNAVAILABLE');isolation.requireHistoryRestore(failure,'original-registry-identity');
  assert.equal(isolation.caused(failure),true);assert.equal(isolation.unavailable(),true);assert.equal(isolation.recover(),false);assert.equal(isolation.registry.health().available,false);
  const restored=new MarketRegistry(path,{now:()=>T});restored.setMetadata('pilot-watch-identity','original-registry-identity');restored.observeIdentity({mint:'owner-restored-history',at:T-1000,source:'fixture'});restored.close();
  assert.equal(isolation.recover(),true);assert.equal(isolation.registry.coverageSnapshot(T).lifetime.uniqueTokensDiscovered,1);
 }finally{isolation.close();rmSync(dir,{recursive:true,force:true});}
});
