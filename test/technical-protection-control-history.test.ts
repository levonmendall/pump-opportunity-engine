/** Original control lineage, exercised only in disposable offsite ledgers. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,OPERATIONAL_REPORTING_ENTRY_PAUSE,TECHNICAL_PROTECTION_PAUSE_REASONS} from '../src/ledger.js';

const earlier=TECHNICAL_PROTECTION_PAUSE_REASONS[0],current=TECHNICAL_PROTECTION_PAUSE_REASONS[3];
function fixture(t:TestContext){
 const root=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-control-lineage-'));
 const ledger=new DisposableLedger(join(root,'ledger.sqlite'),'fixture-control-lineage');
 let at=Date.parse('2026-11-03T01:00:00Z');
 const price=()=>({at,microUsdPerSol:'100000000',source:'CONTROLLED original USD observation'});
 ledger.initialize(price(),at);ledger.reconcile('initial-reconciliation',at,price(),{});
 assert.equal(ledger.resume('initial-permission',at,price(),{},{version:'CONTROLLED',evidence:'Disposable fixture initial permission',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 const pause=(reason:string,restore=false)=>{at+=10;ledger.pause(`trader:${restore?'restore-hard-pause':'pause'}:${ledger.state().revision}:${at}`,at,reason);return ledger.state().revision;};
 const startup=()=>{at+=10;ledger.pause(`execution-recovery:${ledger.accountId}:${ledger.state().revision}`,at,'execution startup: fresh reconciliation/readiness required');};
 const authority=()=>{const state=ledger.state(),history=ledger.exportJournal(100);const result=ledger.technicalProtectionRecoveryAuthority(at);assert.deepEqual(ledger.state(),state);assert.deepEqual(ledger.exportJournal(100),history);assert.equal(ledger.state().controls.entriesEnabled,false,'authority cannot grant financial permission');return result;};
 return {ledger,pause,startup,authority,get at(){return at;},ownerPause(){at+=10;ledger.pause('owner-explicit-pause',at,'operator paused new entries');},stop(){at+=10;ledger.safeStop('owner-explicit-stop',at);}};
}

test('a technical restoration remains valid after a later independently recorded technical pause',t=>{
 const f=fixture(t);f.pause(earlier);f.startup();f.pause(earlier,true);const origin=f.pause(current);
 const authority=f.authority();assert.equal(authority.verified,true,JSON.stringify(authority));
 if(authority.verified){assert.equal(authority.originRevision,origin);assert.equal(authority.controlReason,current);assert.equal(authority.controlChangedAt,f.at);}
});

test('a historical reporting restoration does not prevent a later original technical recovery',t=>{
 const f=fixture(t);f.pause(OPERATIONAL_REPORTING_ENTRY_PAUSE);f.startup();f.pause(OPERATIONAL_REPORTING_ENTRY_PAUSE,true);const origin=f.pause(current);
 const authority=f.authority();assert.equal(authority.verified,true,JSON.stringify(authority));
 if(authority.verified)assert.equal(authority.originRevision,origin);
});

test('successive startup markers preserve the original technical restoration lineage',t=>{
 const f=fixture(t);const origin=f.pause(current);f.startup();f.startup();f.pause(current,true);
 const authority=f.authority();assert.equal(authority.verified,true,JSON.stringify(authority));
 if(authority.verified)assert.equal(authority.originRevision,origin);
});

test('matching the final current reason cannot authenticate a different historical restoration',t=>{
 const f=fixture(t);f.pause(earlier);f.startup();f.pause(current,true);
 assert.deepEqual(f.authority(),{verified:false,reason:'TECHNICAL_PROTECTION_UNPROVEN_RESTORE'});
});

test('an older matching reason cannot supersede a later different authenticated pause',t=>{
 const f=fixture(t);f.pause(earlier);f.pause(current);f.startup();f.pause(earlier,true);f.pause(current);
 assert.deepEqual(f.authority(),{verified:false,reason:'TECHNICAL_PROTECTION_UNPROVEN_RESTORE'});
});

test('a restore with no original pause remains unproven after a later technical pause',t=>{
 const f=fixture(t);f.startup();f.pause(current,true);f.pause(current);
 assert.deepEqual(f.authority(),{verified:false,reason:'TECHNICAL_PROTECTION_UNPROVEN_RESTORE'});
});

for(const barrier of ['owner','unknown','stop'] as const)test(`later technical evidence cannot erase an earlier ${barrier} control`,t=>{
 const f=fixture(t);f.pause(earlier);
 if(barrier==='owner')f.ownerPause();
 if(barrier==='unknown')f.pause('unrecognized financial safety condition');
 if(barrier==='stop')f.stop();
 f.startup();f.pause(current);
 const authority=f.authority();assert.equal(authority.verified,false);
 if(!authority.verified)assert.equal(authority.reason,barrier==='stop'?'TECHNICAL_PROTECTION_CONTROL_NOT_ELIGIBLE':'TECHNICAL_PROTECTION_OWNER_OR_UNKNOWN_CONTROL');
});
