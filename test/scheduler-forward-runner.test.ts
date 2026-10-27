import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ForwardPhaseBudget} from '../scripts/scheduler-forward.js';
const MIB=1024*1024;
const initial={calls:20,bytes:1000,starts:Array.from({length:20},(_,i)=>i),refusal:'RPC_HTTP_429' as const,refusalAt:99000,sha256:'a'.repeat(64)};
function fixture(t:any,baseline=initial,cap=3){const dir=mkdtempSync(join(tmpdir(),'poe-forward-phase-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let now=100000;const abort=new AbortController();const budget=new ForwardPhaseBudget({statePath:join(dir,'rpc-budget.json'),grantId:'isolated-forward-phase',baseline,startedAt:now,now:()=>now,monotonic:()=>now,sleep:async ms=>{now+=ms;}},cap,initial,abort.signal);return {budget,abort};}
test('phase admission uses the existing physical counter and refuses beyond the approved phase allocation',async t=>{
  const f=fixture(t,initial,1);try{await f.budget.operate({transport:'http',method:'getMultipleAccounts'},async c=>{c.completeResponse();});const calls=f.budget.calls;await assert.rejects(f.budget.operate({transport:'ws-upgrade',method:'upgrade'},async c=>{c.completeResponse();}),/PHASE_UNIT_CAP/);assert.equal(f.budget.calls,calls);}finally{f.budget.close();}
});
test('new32MiB related cap includes earlier phase bytes before another physical operation',async t=>{
  const baseline={...initial,bytes:initial.bytes+29*MIB},f=fixture(t,baseline);let invoked=0;
  try{await assert.rejects(f.budget.operate({transport:'http',method:'getMultipleAccounts'},async c=>{invoked++;c.completeResponse();}),/NEW_RESPONSE_RESERVE/);assert.equal(invoked,0);assert.equal(f.budget.newUnits,0);}finally{f.budget.close();}
});
test('the four absolute-headroom units cannot be silently consumed as additional planned work',async t=>{
  const baseline={...initial,calls:93,starts:Array.from({length:93},(_,i)=>i)},f=fixture(t,baseline);
  try{await assert.rejects(f.budget.operate({transport:'http',method:'getTransaction'},async c=>{c.completeResponse();}),/PLANNED_UNIT_CAP/);assert.equal(f.budget.newUnits,0);}finally{f.budget.close();}
});
