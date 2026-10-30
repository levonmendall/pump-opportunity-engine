/** Offline mode-transition contract; fixture capital never belongs to a live pilot. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger,type LedgerState} from '../src/ledger.js';
import {PILOT_RUN_MODE,PILOT_MODE_VERSION,resolvePilotRunMode,assertPilotModeState,runPilot} from '../src/pilot.js';

function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-mode-')),ledger=new PaperLedger(join(dir,'fixture.sqlite'),'poe-pilot-offline-mode');
 const at=Date.parse('2026-10-27T12:00:00Z');ledger.initialize({microUsdPerSol:'100000000',at,source:'OFFLINE fixture conversion'},at);
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});return {ledger,at};
}

test('candidate-only remains the default and financial PAPER mode is an explicit versioned selection',()=>{
 assert.equal(PILOT_RUN_MODE,'candidate-evaluation');assert.equal(resolvePilotRunMode(),'candidate-evaluation');
 assert.equal(resolvePilotRunMode('paper'),'paper');assert.equal(PILOT_MODE_VERSION,'isolated-paper-mode-v1');
 for(const bad of [null,'PAPER','live','paper-live','',true,0,{},['paper']])assert.throws(()=>resolvePilotRunMode(bad),/PILOT_UNKNOWN_MODE/);
});

test('selecting PAPER mode preserves the existing account, inception and financial state without enabling permission',t=>{
 const {ledger}=fixture(t),before=ledger.state();assertPilotModeState('candidate-evaluation',before);assertPilotModeState('paper',before);
 assert.deepEqual(ledger.state(),before);assert.equal(ledger.state().controls.entriesEnabled,false);assert.equal(ledger.state().revision,before.revision);
});

test('candidate mode refuses exposure while PAPER mode admits it for recovery without mutating it',t=>{
 const {ledger,at}=fixture(t),state=ledger.state();
 const held:LedgerState={...state,positions:{token:{mint:'token',units:'1000',entryLamports:'497993000',entryGas:'7000',costMicroUsd:'50000000',deposit:'2000000',enteredAt:at}}};
 const pending:LedgerState={...state,pending:{exit:{id:'exit',side:'sell',mint:'token',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',reserved:'7000',decisionEvidence:'OFFLINE pending recovery fixture'}}};
 for(const value of [held,pending,{...state,controls:{...state.controls,entriesEnabled:true}}]){
  const before=structuredClone(value);assert.throws(()=>assertPilotModeState('candidate-evaluation',value),/CANDIDATE_EVALUATION_REQUIRES_CLOSED_EMPTY_FINANCIAL_STATE/);
  assert.doesNotThrow(()=>assertPilotModeState('paper',value));assert.deepEqual(value,before);
 }
 assert.deepEqual(ledger.state(),state,'test state variants were never written to a ledger');
});

test('a mode flag cannot authorize another account or real/disposable financial mode',t=>{
 const {ledger}=fixture(t),state=ledger.state();
 for(const value of [{...state,accountId:'poe-authoritative-owner'},{...state,mode:'DISPOSABLE_PAPER' as const},{...state,accountId:'poe-pilot-INVALID'}])
  for(const mode of ['candidate-evaluation','paper'] as const)assert.throws(()=>assertPilotModeState(mode,value),/PILOT_ISOLATED_PAPER_ACCOUNT_REQUIRED/);
});

test('an invalid run mode fails before directory access, leases, network or financial initialization',async()=>{
 await assert.rejects(runPilot('/does-not-exist',60000,true,'single',undefined,undefined,'live' as never),/PILOT_UNKNOWN_MODE/);
});
