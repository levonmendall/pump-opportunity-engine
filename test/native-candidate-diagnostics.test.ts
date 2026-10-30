import{test}from'node:test';import assert from'node:assert/strict';
import{NativeCandidateFailureDiagnostics,NATIVE_CANDIDATE_FAILURE_CODES,NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS,nativeCandidateFailureReason}from'../src/native-candidate-diagnostics.js';
import{projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION}from'../src/operating-intelligence.js';
const at=Date.parse('2026-10-30T03:00:00.000Z'),mint='So11111111111111111111111111111111111111112';
const source=(diagnostics:unknown)=>({accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:at,startedAt:at-600000,runId:'OFFLINE-audit-cause-projection',configurationSha256:'a'.repeat(64),strategyVersion:'adaptive-momentum-v2-paper-v1',persistent:true,positions:{},pending:{},watch:{auditDiagnostics:diagnostics},usage:{},timing:{}} as any);

test('fixed failure occurrences survive ring retirement without changing their source timestamps or becoming unique-window counts',()=>{
 const d=new NativeCandidateFailureDiagnostics(at-600000);
 for(let n=0;n<20;n++)d.observe({at:at-20000+n*100,mint,kind:n%2?'quality-gap':'audit-unusable',reason:'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED',windowEndAt:at-30000,deadlineAt:at-20001,lastDispatchReason:'page-response',logicalHistoryCalls:1,auditResultStatus:'unusable'});
 const s=d.snapshot();assert.equal(s.events,20);assert.equal(s.byReason.NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED,20);assert.deepEqual(s.byKind,{'audit-unusable':10,'quality-gap':10});assert.equal(s.recent.length,NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS.maximumRecentFacts);assert.equal(s.recent[0]!.at,at-18800);assert.equal(s.recent.at(-1)!.at,at-18100);assert.equal(s.recent.at(-1)!.lastDispatchReason,'page-response');
 const i=projectOperatingIntelligence(source(s)),notes=i.quality.limitations.join('\n');assert.match(notes,/counts NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED:20 \(occurrences, not unique windows\)/);assert.match(notes,/Latest quality-gap\/NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED/);assert.ok(notes.includes(mint));validateOperatingIntelligence(i,new Date(at).toISOString());
 s.recent[0]!.reasonCode='OTHER_UNEXPORTED_REASON';s.byReason.NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED=0;assert.equal(d.snapshot().byReason.NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED,20,'snapshot mutation cannot erase source facts');
});

test('transport/node codes retain only bounded numeric facts and unknown errors never leak raw messages',()=>{
 assert.deepEqual(nativeCandidateFailureReason('NATIVE_FLOW_DISCONNECTED_1006'),{reasonCode:'NATIVE_FLOW_DISCONNECTED',transportCloseCode:1006,rpcErrorCode:null});assert.deepEqual(nativeCandidateFailureReason('PILOT_RPC_COMPONENT_RPC_ERROR_-32016'),{reasonCode:'RPC_NODE_ERROR',transportCloseCode:null,rpcErrorCode:-32016});
 const d=new NativeCandidateFailureDiagnostics(at-1000);for(const reason of['https://secret.example?apiKey=DO_NOT_EXPORT','SECRET_PATH_AND_KEY_DO_NOT_EXPORT',Error('DO_NOT_EXPORT'),'NATIVE_FLOW_DISCONNECTED_99999','COMPONENT_RPC_ERROR_999999999999'])d.observe({kind:'audit-unavailable',at:at-100,reason,mint:'DO_NOT_EXPORT'});
 const s=d.snapshot(),i=projectOperatingIntelligence(source(s));assert.equal(s.byReason.OTHER_UNEXPORTED_REASON,5);assert.ok(!JSON.stringify(s).includes('DO_NOT_EXPORT'));assert.ok(!JSON.stringify(i).includes('secret.example'));validateOperatingIntelligence(i,new Date(at).toISOString());
});

test('future and invalid diagnostic detail stays unavailable, and a new instance never claims earlier failure causes',()=>{
 const d=new NativeCandidateFailureDiagnostics(at-1000);d.observe({kind:'decision-expired',at:at-2000,reason:'DECISION_DEADLINE_EXPIRED',mint});let s=d.snapshot();assert.equal(s.events,1);assert.equal(s.omittedDetails,1);assert.equal(s.recent.length,0);assert.match(projectOperatingIntelligence(source(s)).quality.limitations.join('\n'),/Latest outcome detail unavailable/);
 d.observe({kind:'decision-expired',at:at+1,reason:'DECISION_DEADLINE_EXPIRED',mint});s=d.snapshot();assert.ok(!projectOperatingIntelligence(source(s)).quality.limitations.some(note=>note.includes(new Date(at+1).toISOString())));
 for(const patch of[{startedAt:at+1},{startedAt:at-600001},{scope:'WHOLE_SERVICE_HISTORY'},{version:'other'},{events:null}]){const i=projectOperatingIntelligence(source({...s,...patch}));assert.match(i.quality.limitations.join('\n'),/diagnostic detail unavailable; retained failure totals are unchanged/);validateOperatingIntelligence(i,new Date(at).toISOString());}
 const restarted=new NativeCandidateFailureDiagnostics(at-1).snapshot();assert.equal(restarted.events,0);assert.deepEqual(restarted.recent,[]);assert.ok(!projectOperatingIntelligence(source(restarted)).quality.limitations.some(note=>note.startsWith('Candidate instance')));
});

test('one worst-case source diagnostic note fits beside three held strategies and financial failure evidence',()=>{
 const d=new NativeCandidateFailureDiagnostics(at-500000),reason='NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN';d.observe({kind:'predictive-unavailable',at:at-1,mint,reason,windowEndAt:at-10000,deadlineAt:at,lastDispatchReason:'native-service-dispatch',logicalHistoryCalls:6,auditResultStatus:'unavailable'});const snapshot=d.snapshot();for(const code of NATIVE_CANDIDATE_FAILURE_CODES)snapshot.byReason[code]=Number.MAX_SAFE_INTEGER;
 const raw=source(snapshot),maximum=Number.MAX_SAFE_INTEGER,stages=['provider-restriction','protection-retry-paced','uninvoked-quota-or-spacing','physical-settlement-wait','physical-timeout','caller-cancel-before-physical','caller-cancel-during-physical','transport-or-node-response','local-admission'];
 raw.reporting={protectionHistory:{scope:'known-lower-bound',historyUnavailable:false}};raw.timing={lastCompletedProtectionAt:at-100,maximumCompletedGapMs:89426,protectionBreaches:73,currentRunMaximumCompletedGapMs:8877,currentRunMaximumQuoteAgeAtUseMs:65};raw.observationReportingMeaning=Array(10).fill('Original source meaning');raw.usage={rpc:{startedAt:at-500000,protectionRecovery:{calls:maximum,logicalAttempts:maximum,rapidProbes:maximum,successesAfterRetry:maximum,refusals:maximum,rolling10SecondStarts:maximum,rolling60SecondStarts:maximum,providerRestrictionUntil:0,failureStages:Object.fromEntries(stages.map(stage=>[stage,maximum])),lastFailure:{at:at-1000,stage:'caller-cancel-before-physical',physicalInFlight:true}}},market:{holdingDiagnostics:{contextFailureCounts:{HELD_PRICING_BUSY:maximum},lastContext:{state:'unavailable',at:at-1000,reasonCode:'HELD_PRICING_BANK_CLOCK_UNAVAILABLE'}}}};
 for(const key of['A','B','C'].map(v=>v.repeat(96)))raw.positions[key]={enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'9'.repeat(38),highWaterAt:at-1000}};
 const i=projectOperatingIntelligence(raw);assert.equal(i.quality.limitations.length,10);assert.ok(i.quality.limitations.every(note=>note.length<=512));assert.ok(i.quality.limitations.some(note=>note.startsWith('Candidate instance')));assert.ok(!i.quality.limitations.some(note=>note.startsWith('Holding RPC current instance since')),'only optional call summary yields at full note capacity');assert.equal(i.quality.limitations.filter(note=>note.includes('Adaptive Momentum')).length,3);assert.equal(i.protection.maximumCompletedGapMs,89426);assert.equal(i.protection.breaches,73);validateOperatingIntelligence(i,new Date(at).toISOString());
});


test('noncanonical wire signatures retain their exact source-quality reason without an arbitrary error string',()=>{
 const d=new NativeCandidateFailureDiagnostics(at-1000);d.observe({at,mint,kind:'quality-gap',reason:'NATIVE_FLOW_NONCANONICAL_SIGNATURE'});
 assert.equal(d.snapshot().recent[0]!.reasonCode,'NATIVE_FLOW_NONCANONICAL_SIGNATURE');assert.equal(d.snapshot().byReason.NATIVE_FLOW_NONCANONICAL_SIGNATURE,1);
});
