import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SelectionRejections,isPoolRejection} from '../src/selection-rejections.js';

const scope={mint:'91RBVuoCLvikHs4qeUGczABotGLd1Tjo84DMfpFUpump',pool:'4dgUjYxeCnq7ZSqrNu14FWXmDiJrWmmw7wigL7VRHFsW'};
const make=()=>{const directory=mkdtempSync(join(tmpdir(),'poe-reject-fixture-'));return {path:join(directory,'history.json'),clean:()=>rmSync(directory,{recursive:true,force:true})};};

test('saturated rejection survives restart, preserves reason and evidence, and expiry only permits fresh revalidation',()=>{
  const f=make();let now=1_000;let store:SelectionRejections|undefined;
  try{
    store=new SelectionRejections({path:f.path,policyVersion:'support-v1',now:()=>now});
    const row=store.reject(scope,'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','fixture:first-capture');
    assert.equal(row.expiresAt,now+86_400_000);assert.equal(row.releaseCondition,'cooldown-elapsed-and-fresh-revalidation');store.close();
    const original=readFileSync(f.path,'utf8');store=new SelectionRejections({path:f.path,policyVersion:'support-v2',now:()=>now});
    // An unrelated support policy version must not erase a time-based capacity guard.
    now+=100;assert.equal(store.lookup(scope).blocked,true);assert.equal(store.lookup(scope).record?.evidenceRef,'fixture:first-capture');
    now=row.expiresAt!;const expired=store.lookup(scope);assert.equal(expired.blocked,false);assert.equal(expired.releaseReason,'cooldown-expired-revalidate');assert.equal(readFileSync(f.path,'utf8'),original);
    assert.equal(store.snapshot().length,1);assert.equal(store.snapshot()[0]?.reason,row.reason);
  }finally{store?.close();f.clean();}
});

test('structural support refusal persists until reviewed support-policy version changes, then still requires fresh validation',()=>{
  const f=make();let store:SelectionRejections|undefined;
  try{
    store=new SelectionRejections({path:f.path,policyVersion:'pump-sdk2.2-extension-policy1',now:()=>1000});
    const row=store.reject(scope,'UNMODELED_BASE_EXTENSION:TransferFeeConfig','fixture:unsupported-extension');
    assert.equal(row.expiresAt,null);assert.equal(store.lookup(scope,1_000_000).blocked,true);store.close();
    store=new SelectionRejections({path:f.path,policyVersion:'pump-sdk2.2-extension-policy2'});
    const next=store.lookup(scope,1_000_000);assert.equal(next.blocked,false);assert.equal(next.releaseReason,'support-policy-changed-revalidate');assert.equal(next.record?.releaseCondition,'support-policy-version-change-and-fresh-revalidation');assert.equal(store.snapshot().length,1);
  }finally{store?.close();f.clean();}
});

test('global throttle, request budgets, aborts and shared context faults cannot be stored as pool cooldowns',()=>{
  const f=make();const store=new SelectionRejections({path:f.path,policyVersion:'support-v1',now:()=>1000});
  try{
    for(const reason of ['RESEARCH_RPC_HTTP_429','RESEARCH_RPC_PROVIDER_BLOCKED','RESEARCH_RPC_ABORTED','RESEARCH_PHASE_REQUEST_CAP','RESEARCH_PACING_PROVIDER_HALTED','RESEARCH_PACING_STORAGE_UNAVAILABLE','RESEARCH_OTHER_SHARED_FAULT','PREFLIGHT_ELAPSED_CAP','TRANSACTION_SIGNATURE_MISMATCH','TRANSACTION_HISTORY_CONTEXT_MISMATCH']){
      assert.equal(isPoolRejection(reason),false);assert.throws(()=>store.reject(scope,reason,'fixture'),/INVALID_RECORD/);
    }
    assert.deepEqual(store.snapshot(),[]);
  }finally{store.close();f.clean();}
});

test('invalid/corrupt storage fails closed rather than resetting rejection history',()=>{
  const f=make();
  try{
    writeFileSync(f.path,'not JSON',{mode:0o600});const original=readFileSync(f.path,'utf8');assert.throws(()=>new SelectionRejections({path:f.path,policyVersion:'v1'}),/SELECTION_REJECTIONS_CORRUPT/);assert.equal(readFileSync(f.path,'utf8'),original);
    writeFileSync(f.path,JSON.stringify({schemaVersion:1,records:[{...scope,reason:'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN',observedAt:1000,expiresAt:null,evidenceRef:'forged',policyVersion:'v1',releaseCondition:'support-policy-version-change-and-fresh-revalidation'}]}));
    assert.throws(()=>new SelectionRejections({path:f.path,policyVersion:'v2'}),/SELECTION_REJECTIONS_CORRUPT/);
  }finally{f.clean();}
});

test('bounded history never evicts active guards; full store rejects further append without rewriting prior evidence',()=>{
  const f=make();const store=new SelectionRejections({path:f.path,policyVersion:'v1',now:()=>1000});
  try{
    for(let i=0;i<128;i++)store.reject(scope,'BAD_POOL_IDENTITY','f',1000+i);
    const before=readFileSync(f.path,'utf8');assert.throws(()=>store.reject(scope,'BAD_POOL_IDENTITY','f',2000),/RECORD_CAP/);
    assert.equal(readFileSync(f.path,'utf8'),before);assert.equal(store.snapshot().length,128);assert.equal(store.lookup(scope,2000).blocked,true);assert.ok(Buffer.byteLength(before)<=64*1024);
  }finally{store.close();f.clean();}
});

test('clock regression and concurrent leases fail closed without weakening an existing guard',()=>{
  const f=make();const store=new SelectionRejections({path:f.path,policyVersion:'v1',now:()=>1000});
  try{
    store.reject(scope,'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','f');
    assert.throws(()=>store.lookup(scope,999),/CLOCK_REGRESSION/);assert.throws(()=>store.reject(scope,'BAD_POOL_IDENTITY','f',999),/CLOCK_REGRESSION/);
    assert.throws(()=>new SelectionRejections({path:f.path,policyVersion:'v1'}),/OWNED/);assert.equal(store.lookup(scope,1000).blocked,true);
  }finally{store.close();f.clean();}
});

test('a newer short-lived refusal cannot mask an older still-active capacity guard',()=>{
  const f=make();const store=new SelectionRejections({path:f.path,policyVersion:'v1',now:()=>1000});
  try{
    const saturated=store.reject(scope,'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','f',1000);
    store.reject(scope,'SUPPORTED_QUOTE_STALE','f',2000);
    const lookup=store.lookup(scope,100_000);assert.equal(lookup.blocked,true);assert.equal(lookup.record?.reason,saturated.reason);assert.equal(lookup.record?.expiresAt,saturated.expiresAt);
  }finally{store.close();f.clean();}
});

test('stale source, missing state and changed links use a short revalidation cooldown rather than structural policy expiry',()=>{
  const f=make();const store=new SelectionRejections({path:f.path,policyVersion:'v1',now:()=>1000});
  try{
    for(const reason of ['POOL_STATE_NOT_CURRENT_WITHIN_30_SECONDS','MISSING_ACCOUNT','MISSING_POOL_STATE','POOL_LINKS_CHANGED']){
      const row=store.reject(scope,reason,'fixture:replaceable-state',1000);assert.equal(row.expiresAt,61_000);assert.equal(row.releaseCondition,'cooldown-elapsed-and-fresh-revalidation');
    }
    assert.equal(store.lookup(scope,60_999).blocked,true);assert.equal(store.lookup(scope,61_000).blocked,false);
    const structural=store.reject(scope,'UNMODELED_BASE_EXTENSION:TransferFeeConfig','fixture:structural',62_000);assert.equal(structural.expiresAt,null);assert.equal(structural.releaseCondition,'support-policy-version-change-and-fresh-revalidation');assert.equal(store.lookup(scope,100_000_000).blocked,true);
  }finally{store.close();f.clean();}
});
