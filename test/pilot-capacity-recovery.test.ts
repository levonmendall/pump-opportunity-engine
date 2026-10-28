/** Offline demand/probe admission. No fresh market data, financial account or provider capacity claim. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pilotCapacityDemand,pilotCapacityProbeContext,pilotTechnicalCapacityReason} from '../src/pilot.js';
import {PilotWatch} from '../src/pilot-watch.js';
const row=(i:number,time:number|null)=>({signature:'fixture-'+i,slot:1000-i,err:null,blockTime:time,confirmationStatus:'confirmed'});

test('signature demand is only a conservative pool-transaction estimate with explicit saturated boundaries',()=>{
 const at=100000,rows=Array.from({length:17},(_,i)=>row(i,99-Math.floor(i/3)));
 assert.deepEqual(pilotCapacityDemand(rows,at),{requests:17,windowMs:10000,observedAt:at,complete:true,source:'confirmed-pool-signatures'});
 assert.equal(pilotCapacityDemand(Array.from({length:100},(_,i)=>row(i,90)),at).complete,false,'same-second page boundary cannot prove completeness');
 assert.equal(pilotCapacityDemand(Array.from({length:100},(_,i)=>row(i,i===99?89:95)),at).complete,true);
 assert.equal(pilotCapacityDemand([row(0,null)],at).complete,false);
 assert.throws(()=>pilotCapacityDemand([row(0,101)],at),/CLOCK/);
 assert.throws(()=>pilotCapacityDemand([row(0,99),row(0,99)],at),/INVALID/);
});

test('shared probe envelope reserves current higher work without creating another provider budget',()=>{
 const input={at:100000,starts:[99000,99250,99500],methodStarts:2,methodMaximum:8,held:1,pending:false,cooldownUntil:0};
 const c=pilotCapacityProbeContext(input);assert.equal(c.freeEnrichmentStarts,5);assert.equal(c.freeSharedStarts,14);assert.equal(c.windowMs,5000);
 assert.equal(pilotCapacityProbeContext({...input,pending:true}).protectionPending,true);
 const full=pilotCapacityProbeContext({...input,starts:Array.from({length:20},(_,i)=>95000+i*250)});assert.equal(full.freeSharedStarts,0);
 assert.equal(pilotCapacityProbeContext({...input,methodStarts:8}).freeEnrichmentStarts,0);
});

test('a high-volume candidate receives only bounded measurement, then fresh-flow eligibility after verified demand falls',()=>{
 let at=1000000;const records:any[]=[];const watch=new PilotWatch({maximumDeep:6,now:()=>at,record:(kind,data)=>records.push({kind,data})});
 watch.discover({signature:'fixture-origin',feedMint:'mint',receivedAt:at-400000});watch.verify('fixture-origin',{mint:'mint',pool:'pool',migrationAt:at-400000,verifiedAt:at});watch.transition('mint','DEEP_OBSERVATION','fixture admission',at);
 watch.deferCapacity('mint','required enrichment cannot fit method rate limit and usefulness deadline',pilotCapacityDemand(Array.from({length:18},(_,i)=>row(i,999)),at),at);
 at+=5000;const context=()=>pilotCapacityProbeContext({at,starts:[],methodStarts:0,methodMaximum:8,held:0,pending:false,cooldownUntil:0});
 assert.equal(watch.next(at,new Set()),null);const probe=watch.reassessCapacity(context())!;assert.equal(probe.kind,'activity-feasibility-probe');assert.equal(watch.next(at,new Set()),null);
 watch.recordCapacityDemand('mint',pilotCapacityDemand([row(0,Math.floor(at/1000)-1)],at),at);at+=5000;
 assert.equal(watch.reassessCapacity(context())!.kind,'deep-readmission-ready');assert.equal(watch.next(at,new Set())!.mint,'mint');
 assert.equal(watch.admitCapacity('mint',context()).allowed,true);
 watch.transition('mint','DEEP_OBSERVATION','fresh current support and new full-window collection still required',at);
 assert.equal(watch.snapshot(at).rows[0]!.completeWindows,0);assert.equal(watch.snapshot(at).summary.capacityAwaiting,0);
 assert.ok(records.some(r=>r.kind==='pilot-watch-capacity-demand'));
});

test('technical capacity is distinct from predictive weakness, missing layouts and provider outages',()=>{
 for(const reason of ['PILOT_AGGREGATE_ENRICHMENT_CAPACITY','required enrichment cannot fit method rate limit and usefulness deadline','independent audit denominator unavailable'])assert.equal(pilotTechnicalCapacityReason(reason),true);
 for(const reason of ['valid-window-predictive-assessment-failed','PILOT_RPC_COMPONENT_HTTP_429','PILOT_RPC_COMPONENT_HTTP_STATUS_503','UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW'])assert.equal(pilotTechnicalCapacityReason(reason),false);
});
