/** Isolated bookkeeping and synthetic stress only; no source, ledger or provider
 * is opened. Exact retained-forward replay is separately labeled in evidence. */
import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {NativeTransactionRetention,type NativeSeenTransaction} from '../src/native-transaction-retention.js';
const hash=(id:number)=>createHash('sha256').update('synthetic-'+id).digest('hex');
const row=(id:number,at:number,mints=['mega'],scopes=['mega','peer']):NativeSeenTransaction=>({slot:id,hash:hash(id),at,mints:[...mints],scopes:[...scopes],protocolFramesObserved:id%3});

test('retired actual ownership compacts exact correction fingerprints and frees active capacity without dropping other owners',()=>{
 const c=new NativeTransactionRetention(16);for(let i=0;i<16;i++)c.set('s'+i,row(i,1000+i,i===0?['mega','peer']:['mega']));assert.equal(c.usage().activeRecords,16);assert.throws(()=>c.admit('new',1017),/TRANSACTION_CACHE_LIMIT/);c.releaseScope('mega');assert.equal(c.usage().activeRecords,1);assert.equal(c.usage().compactRecords,15);assert.deepEqual(c.get('s1'),{slot:1,hash:hash(1),at:1001,mints:[],scopes:[],protocolFramesObserved:0,correctionScopes:['peer']});assert.deepEqual(c.get('s0'),row(0,1000,['peer'],['peer']));for(let i=16;i<31;i++)c.set('s'+i,row(i,1010+i,['peer']));assert.equal(c.usage().activeRecords,16);assert.equal(c.usage().records,31);assert.equal(c.usage().maximumActiveRecords,16);assert.equal(c.usage().maximumFingerprints,32);
});

test('a compact duplicate has no stale parse certificate and preserves first availability through new-scope reparsing',()=>{
 const c=new NativeTransactionRetention(16),old=row(1,1000);c.set('same',old);c.releaseScope('mega');const prior=c.get('same')!;assert.equal(prior.at,1000);assert.equal(prior.hash,old.hash);assert.equal(['new'].every(m=>prior.scopes.includes(m)),false);c.set('same',{...prior,mints:['new'],scopes:['new'],protocolFramesObserved:2});assert.equal(c.get('same')!.at,1000);assert.equal(c.get('same')!.protocolFramesObserved,2);assert.equal(c.usage().activeRecords,1);assert.equal(c.usage().records,1);
});

test('failed-to-success or changed-slot fingerprints remain known after retirement for the unchanged180s horizon',()=>{
 const c=new NativeTransactionRetention(16),failed=row(1,1000);c.set('failed',failed);c.releaseScope('mega');c.prune(181000);const known=c.get('failed')!;assert.equal(known.hash,failed.hash);assert.equal(known.slot,failed.slot);assert.notEqual(known.hash,hash(2),'a success packet with different err/log bytes remains a correction, not a new transaction');assert.equal(c.usage().records,1);c.prune(181001);assert.equal(c.get('failed'),undefined);assert.equal(c.usage().expiredRecords,1);
});

test('one retired8192-row pool cannot occupy the active16384 budget of five independent peers',()=>{
 const c=new NativeTransactionRetention(16384);for(let i=0;i<8193;i++)c.set('mega'+i,row(i,10000+i,['mega'],['mega','p0','p1','p2','p3','p4']));c.releaseScope('mega');assert.equal(c.usage().activeRecords,0);assert.equal(c.usage().compactRecords,8193);for(let i=0;i<5;i++)for(let j=0;j<1700;j++)c.set('peer'+i+'-'+j,row(10000+i*1700+j,20000+j,['p'+i],['p0','p1','p2','p3','p4']));assert.equal(c.usage().activeRecords,8500);assert.equal(c.usage().records,16693);assert.equal(c.usage().activeCapacityRefusals,0);assert.equal(c.usage().fingerprintCapacityRefusals,0);assert.equal(c.get('mega8192')!.hash,hash(8192));assert.equal(c.get('mega8192')!.at,18192);
});

test('compact fingerprint exhaustion is explicit and does not erase or mutate any already-known correction evidence',()=>{
 const c=new NativeTransactionRetention(16);for(let batch=0;batch<2;batch++){for(let i=0;i<16;i++)c.set('s'+(batch*16+i),row(batch*16+i,1000+batch*16+i,['batch'+batch]));c.releaseScope('batch'+batch);}const before=Array.from({length:32},(_,i)=>c.get('s'+i));assert.equal(c.usage().activeRecords,0);assert.equal(c.usage().records,32);assert.throws(()=>c.admit('new',2000),/TRANSACTION_FINGERPRINT_LIMIT/);assert.deepEqual(Array.from({length:32},(_,i)=>c.get('s'+i)),before);c.admit('s0',2000);c.set('s0',{...c.get('s0')!,mints:['new'],scopes:['new']});assert.equal(c.usage().records,32);assert.equal(c.usage().activeRecords,1);assert.equal(c.get('s0')!.at,1000);c.prune(181032);assert.equal(c.usage().records,0);assert.equal(c.usage().activeRecords,0);
});


test('compaction retains a parsed peer correction obligation without granting it a duplicate parse certificate',()=>{
 const c=new NativeTransactionRetention(16);c.set('failed',row(1,1000,['mega'],['mega','peer']));c.releaseScope('mega');const compact=c.get('failed')!;assert.deepEqual(compact.scopes,[]);assert.deepEqual(compact.correctionScopes,['peer']);assert.equal(['peer'].every(mint=>compact.scopes.includes(mint)),false);compact.correctionScopes!.push('mutated-copy');assert.deepEqual(c.get('failed')!.correctionScopes,['peer']);
 // A temporarily unparsed peer remains a correction obligation until an
 // explicit gap/retirement; active reparsing cannot silently discard it.
 c.set('failed',{...compact,correctionScopes:[],mints:['other'],scopes:['other'],at:3000});assert.equal(c.get('failed')!.at,1000);assert.deepEqual(c.get('failed')!.correctionScopes,['peer']);c.releaseScope('peer');assert.deepEqual(c.get('failed')!.correctionScopes,[]);c.releaseScope('other');assert.deepEqual(c.get('failed')!.correctionScopes,[]);assert.equal(c.usage().correctionScopeIdentities,0);
});

test('scope bits release independently and recycle without unbounded identity growth',()=>{
 const c=new NativeTransactionRetention(16);for(let round=0;round<100;round++){for(let i=0;i<16;i++)c.set('s'+round+'-'+i,row(i,round*181000+i,['owner'],['owner','peer']));c.releaseScope('owner');assert.equal(c.usage().correctionScopeIdentities,1);c.releaseScope('peer');assert.equal(c.usage().correctionScopeIdentities,0);c.prune((round+1)*181000);assert.equal(c.usage().records,0);}assert.equal(c.usage().peakCorrectionScopeIdentities,2);
});


test('scope bit reuse cannot alias a retired obligation and a seventh simultaneous identity refuses atomically',()=>{
 const c=new NativeTransactionRetention(16),names=['a','b','c','d','e','f'];c.set('old',row(1,1000,['a'],names));c.releaseScope('a');const old=c.get('old')!;assert.deepEqual(old.correctionScopes,names.slice(1));c.set('new',row(2,1001,['g'],['g']));assert.deepEqual(c.get('old')!.correctionScopes,names.slice(1));const before=c.usage();assert.throws(()=>c.set('extra',row(3,1002,['h'],['h'])),/RETENTION_SCOPE_LIMIT/);assert.deepEqual(c.usage(),before);assert.equal(c.get('extra'),undefined);c.releaseScope('b');c.set('extra',row(3,1002,['h'],['h']));assert.deepEqual(c.get('old')!.correctionScopes,['c','d','e','f']);assert.equal(c.get('old')!.at,1000);
});
