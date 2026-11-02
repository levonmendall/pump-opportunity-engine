/** A history page only locates a signature. Finalized Pump create decoding
 * remains the sole source of immutable token birth evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {TOKEN_CREATION_HISTORY_POLICY,selectTokenCreationHistoryPage,type TokenCreationHistoryRequest} from '../src/token-creation-history.js';
const AT=Date.parse('2026-11-02T20:00:00Z');
const signature=(n:number)=>{const bytes=Buffer.alloc(64,17);bytes.writeUInt32BE(n);return bs58.encode(bytes);};
const request:TokenCreationHistoryRequest={mint:bs58.encode(Buffer.alloc(32,3)),before:null,beforeSlot:null,until:null,untilSlot:null,oldestCandidate:null,oldestCandidateSlot:null};
const row=(n:number,slot=n)=>({signature:signature(n),slot,blockTime:AT/1000-3600,err:null});

test('exhausted finalized history chooses its oldest successful transaction without proving age',()=>{
 assert.deepEqual(selectTokenCreationHistoryPage([row(3),{...row(2),err:{InstructionError:[0,'Custom']}},row(1)],request,AT),{kind:'candidate',signature:signature(1),slot:1});
 assert.deepEqual(selectTokenCreationHistoryPage([],request,AT),{kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_EMPTY',terminal:false});
});

test('full pages retain only one cursor and candidate and resume on a later scheduler turn',()=>{
 const rows=Array.from({length:TOKEN_CREATION_HISTORY_POLICY.pageLimit},(_,n)=>row(2000-n));
 const page=selectTokenCreationHistoryPage(rows,request,AT);assert.equal(page.kind,'continue');if(page.kind!=='continue')return;
 assert.equal(page.before,signature(1001));assert.equal(page.oldestCandidate,signature(1001));assert.equal(Object.hasOwn(page,'rows'),false);
 const next={mint:request.mint,until:null,untilSlot:null,...page};
 assert.deepEqual(selectTokenCreationHistoryPage([row(1000),row(999)],next,AT),{kind:'candidate',signature:signature(999),slot:999});
 assert.deepEqual(selectTokenCreationHistoryPage([],next,AT),{kind:'candidate',signature:signature(1001),slot:1001});
});

test('older finalized evidence stops the bounded acquisition horizon without inventing a birthday',()=>{
 const old={...row(1),blockTime:(AT-TOKEN_CREATION_HISTORY_POLICY.maximumHorizonMs)/1000-1};
 assert.deepEqual(selectTokenCreationHistoryPage([old],request,AT),{kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_PRECEDES_24H',terminal:true});
 assert.equal(selectTokenCreationHistoryPage([{...old,blockTime:(AT-TOKEN_CREATION_HISTORY_POLICY.maximumHorizonMs)/1000}],request,AT).kind,'candidate','the existing inclusive 24-hour boundary remains intact');
});

test('malformed, repeated and out-of-order history cannot create a birth request',()=>{
 for(const rows of [null,{},[row(1),row(2)],[row(1),row(1)],[{...row(1),signature:'bad'}],[{...row(1),blockTime:undefined}],[{...row(1),blockTime:AT/1000+1}],[{...row(1),slot:-1}],Array.from({length:1001},(_,n)=>row(2000-n))])assert.deepEqual(selectTokenCreationHistoryPage(rows,request,AT),{kind:'unavailable',reason:'TOKEN_CREATION_HISTORY_MALFORMED',terminal:false});
 const continuation={...request,before:signature(9),beforeSlot:9};
 assert.equal(selectTokenCreationHistoryPage([row(9)],continuation,AT).kind,'unavailable');
 assert.equal(selectTokenCreationHistoryPage([row(10)],continuation,AT).kind,'unavailable');
 assert.equal(selectTokenCreationHistoryPage([],{...continuation,oldestCandidate:'bad',oldestCandidateSlot:1},AT).kind,'unavailable');
 const lowerBound={...request,until:signature(1),untilSlot:1};
 assert.equal(selectTokenCreationHistoryPage([row(1)],lowerBound,AT).kind,'unavailable','provider must honor the exclusive rejected-candidate bound');
 assert.equal(selectTokenCreationHistoryPage([row(0)],lowerBound,AT).kind,'unavailable');
 assert.deepEqual(selectTokenCreationHistoryPage([row(2)],lowerBound,AT),{kind:'candidate',signature:signature(2),slot:2});
});
