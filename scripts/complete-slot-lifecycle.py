"""Finish reviewed source changes in a disposable validation checkout only."""
from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text();assert s.count(old)==1,(path,old[:80],s.count(old));p.write_text(s.replace(old,new,1))

change('src/native-candidate-runner.ts','.filter(row=>row.deepSince!==null)', '.filter(row=>row.mint&&!this.candidates.has(row.mint)&&this.watch.lookupIdentity(row.mint,this.now())?.deepSince!=null)')
change('src/native-candidate-runner.ts','at+deferMs)});','at+deferMs),releaseObservation:true});')
change('src/native-candidate-runner.ts',"at)});\n    this.productivity.retired", "at),releaseObservation:true});\n    this.productivity.retired")
change('src/pilot-watch.ts','options:{deferUntil?:number}={}):WatchRow{','options:{deferUntil?:number;releaseObservation?:true}={}):WatchRow{')
change('src/pilot-watch.ts','const gated=r.capacityCoverage',"need(!options.releaseObservation||!['DEEP_OBSERVATION','QUALIFIED'].includes(state),'PILOT_WATCH_RELEASE_OBSERVATION_STATE');\n    const releaseObservation=options.releaseObservation;\n    const gated=r.capacityCoverage")
change('src/pilot-watch.ts','if(r.state===state&&r.reason===reason&&r.deferUntil===(options.deferUntil??0))','if(!releaseObservation&&r.state===state&&r.reason===reason&&r.deferUntil===(options.deferUntil??0))')
change('src/pilot-watch.ts',"if(!['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(state))r.deepSince=null;", "if(releaseObservation||!['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(state))r.deepSince=null;")
# This existing contention test must enqueue actual committed work. An empty
# notification is now correctly a read-only no-op, not an exclusive writer.
change('test/native-candidate-runner.test.ts',"const mint=f.seed(1);await f.steps(1);f.runner.onMarketActivityCommitted([{mint,at:f.now,evidence:'OFFLINE committed activity'}]);const before=", "const mint=f.seed(1);await f.steps(1);f.advance(1);registry.observeActivity({mint,signature:sig(765),receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1'});f.runner.onMarketActivityCommitted([{mint,at:f.now,evidence:'OFFLINE committed activity'}]);const before=")
with Path('test/native-candidate-runner.test.ts').open('a') as f:
 f.write('''

test('slot lifecycle: retired pending-entry observation keeps the financial obligation without repeated cleanup writes',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1);await f.steps(2);
 f.ownership.set(mint,'ENTRY_PENDING');f.runner.syncFinancialOwnership(new Set([mint]));
 assert.equal((f.runner as any).retire(mint,'OFFLINE observation lost with pending financial action',f.now,0),true);
 const row=f.runner.watch.lookupIdentity(mint)!;assert.equal(row.state,'ENTRY_PENDING');assert.equal(row.deepSince,null);assert.equal(f.runner.currentAuditCertificate(mint),null);
 const before=f.records.filter(r=>r.kind==='native-candidate-orphan-retired').length;await f.steps(4);
 assert.equal(f.records.filter(r=>r.kind==='native-candidate-orphan-retired').length,before);assert.equal(f.runner.watch.lookupIdentity(mint)!.state,'ENTRY_PENDING');assert.equal(f.states.has(mint),false);await f.runner.stop();
});

test('slot lifecycle: a deep-state change during an awaited audit cannot publish a current certificate',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true,forcePredictiveFeatures:true,scopedNotifications:true}),mint=f.seed(1);await f.steps(2);const call=f.rpc.call.bind(f.rpc);let changed=false;
 f.rpc.call=(async(...args:Parameters<typeof call>)=>{const result=await call(...args);if(!changed){changed=true;f.runner.watch.transition(mint,'DEFERRED','OFFLINE concurrent membership correction',f.now);}return result;}) as typeof f.rpc.call;
 f.advance(70000);f.refresh();await f.steps(6);
 assert.equal(changed,true);assert.equal(f.runner.currentAuditCertificate(mint),null);assert.equal(f.runner.status().counters.auditedWindows,0);
 assert.equal(f.records.some(r=>r.kind==='native-candidate-work-unavailable'&&r.data.reason==='PILOT_WATCH_WINDOW_REQUIRES_DEEP'),false);await f.runner.stop();
});
''')
print('Completed observation-only retirement semantics and real-contention fixtures; no runtime or ledger access.')
