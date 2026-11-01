#!/usr/bin/env python3
"""Reviewable source authoring only. No EC2, credentials or financial state access."""
from pathlib import Path
import hashlib,subprocess
r=Path.cwd()
BASE='31efee2c44725722e7948165126e6296111f165c'
subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],check=True)
EXPECTED={'src/native-candidate-runner.ts':'4a1db42d95039a5b23c10975654017f1cbf62e21817e203ee34109ba4fb0b2b3','src/operating-intelligence.ts':'27ebaf0719e9f0b80d67a4f8e77724f53e326be6f527b8f27c754ef1550995bb','src/pilot-native-flow.ts':'4c6027945790e39c8883bbc8175cec235ace1ea3d77f97c58e214a00479b3ed7','src/run-native-paper.ts':'7a12cfbc7541153c58920a4ac036b5b320ab12fd352f60d4cf02e9b56edafa99','test/native-candidate-runner.test.ts':'b60a6b92d69bf9eb40c915f249999de5312cb58d78a5c28b4d98869c1b1e384a','test/native-flow-fixture.ts':'3d9c3d7cd0757ba7e8ba4d829cb68f345f14669fe2534b36fc403c6109b83048','test/native-flow-service-policy.test.ts':'f8d996ccd4978316b342929919169fe235ef7552edf5145ca787676f32683030','test/native-managed-cancel-settlement.test.ts':'4ef0b035a1e40fe503ddd321bf7bf0f614aa05fb016ac054967b7a4747f2992c','test/native-settled-recovery.test.ts':'e1b9535e9d93251bd636a7b8400375b4c03477f0d305f7510994a45eef67754f','test/native-startup-integration.test.ts':'245eb02d9c174b056cf9b0cd656ceb05ac780fe6f5cfa4bc7397c1c3741f1a87','test/operating-intelligence.test.ts':'2d8edb854cfb3b5ddc1dc6653c093ab105a9e28c4274d2a477ef713363481e01','test/pilot-native-flow.test.ts':'efa83e12aaa2952b6ff6bfc5e0a8d212c902b70af3fae67553f5f8870275445b'}
for path,digest in EXPECTED.items():
 p=r/path
 if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise RuntimeError('EXACT_SOURCE_REQUIRED:'+path)
if (r/'src/native-evidence-classification.ts').exists():raise RuntimeError('NEW_CLASSIFIER_PATH_REQUIRED')
def rep(s,a,b):
 if s.count(a)!=1:raise RuntimeError('EXACT_ANCHOR_REQUIRED:'+a[:100])
 return s.replace(a,b)
p=r/'src/pilot-native-flow.ts';s=p.read_text()
s=rep(s,"import {WsReceiptClock} from './ws-receipt-clock.js';","import {WsFrameReceiptClock,WS_FRAME_RECEIPT_POLICY} from './ws-frame-receipt-clock.js';")
s=rep(s,"version:'earliest-safe-native-service-plan-v2',retirementDeferredStartMs:0,retirementDeadlineMs:10000,normalSupportRefreshMs:20000","version:'frame-receipt-bounded-idle-native-service-v3',retirementDeferredStartMs:0,retirementDeadlineMs:10000,normalSupportRefreshMs:20000,persistentIdleGraceMs:15000,receiptPolicy:WS_FRAME_RECEIPT_POLICY.version")
s=rep(s,'chunkAt:number;receiptClock:WsReceiptClock;','chunkAt:number;lastPongReceiptAt:number|null;receiptClock:WsFrameReceiptClock;')
s=rep(s,' private connection:Connection|null=null;',' private idleSince:number|null=null;\n private connection:Connection|null=null;')
s=rep(s,'receiptClock:new WsReceiptClock(()=>c.closed?undefined:(socket as any)._receiver),','lastPongReceiptAt:null,receiptClock:new WsFrameReceiptClock(),')
s=rep(s,"prependListener('data',()=>{try{c.chunkAt=this.now();c.receiptClock.chunk(c.chunkAt);this.sample(c);}","prependListener('data',(bytes:Buffer)=>{try{c.chunkAt=this.now();this.sample(c);c.receiptClock.chunk(bytes,c.chunkAt);}")
s=rep(s,"this.accept(c,JSON.parse(data.toString('utf8')),c.receiptClock.receivedAt(c.chunkAt));","const receipt=c.receiptClock.take('message',this.now());this.accept(c,JSON.parse(data.toString('utf8')),receipt.receivedAt);")
s=rep(s,"socket.on('ping',payload=>{try{this.sample(c);need(this.peerPings.length<2&&payload.length<=125,'NATIVE_FLOW_PEER_CONTROL_LIMIT');this.peerPings.push({payload:Buffer.from(payload),at:this.now()});}catch(e){this.fault(safe(e));}});", "socket.on('ping',payload=>{try{if(c.closed)return;this.sample(c);const receipt=c.receiptClock.take('ping',this.now());need(this.peerPings.length<2&&payload.length<=125,'NATIVE_FLOW_PEER_CONTROL_LIMIT');this.peerPings.push({payload:Buffer.from(payload),at:receipt.receivedAt});}catch(e){this.fault(safe(e));}});\n   // Consume every PONG in protocol order, even unsolicited/nonmatching ones.\n   // Only the separate matching-nonce listener can establish round-trip health.\n   socket.on('pong',()=>{try{if(c.closed)return;this.sample(c);c.lastPongReceiptAt=c.receiptClock.take('pong',this.now()).receivedAt;}catch(e){c.lastPongReceiptAt=null;this.fault(safe(e));}});")
s=rep(s,"if(method==='ping')this.noteRoundTrip(c,'ping',c.receiptClock.receivedAt(c.chunkAt),requestStartedAt);", "if(method==='ping'){need(c.lastPongReceiptAt!==null,'NATIVE_FLOW_PONG_RECEIPT_UNAVAILABLE');this.noteRoundTrip(c,'ping',c.lastPongReceiptAt,requestStartedAt);}")
s=rep(s,"this.record('native-flow-refusal',row);", "this.record('native-flow-refusal',{...row,receiptTimeBasis:WS_FRAME_RECEIPT_POLICY.version,handlerStartedAt:handlerAt,receiptAgeAtHandlerMs:handlerAt-receivedAt,handlerElapsedMs:this.mono()-began});")
s=rep(s,"this.record('native-flow-disconnected',{connection:c.id,at:this.now(),reason,retryAt:this.retryAt,transportSettled:true});", "this.idleSince=null;this.record('native-flow-disconnected',{connection:c.id,at:this.now(),reason,expected:c.expected,selectedScopes:this.candidates.size,receiptTiming:c.receiptClock.usage(),retryAt:this.retryAt,transportSettled:true});")
s=rep(s,"  if(!selected.length){if(connected&&this.subscriptions.size===0&&(policy.allowSetup!==false||![...this.candidates.values()].some(c=>!c.suspended)))actions.push({at:controlAt,domain:'control',action:'close',required:true,deadlineAt:Infinity});}", """  if(selected.length||!connected)this.idleSince=null;
  if(!selected.length){
   if(connected&&this.subscriptions.size===0&&(policy.allowSetup!==false||![...this.candidates.values()].some(c=>!c.suspended))){
    this.idleSince??=at;const closeAt=this.idleSince+(this.options.persistent?NATIVE_SERVICE_POLICY.persistentIdleGraceMs:0);
    actions.push({at:Math.max(controlAt,closeAt),domain:'control',action:'close',required:true,deadlineAt:Infinity});
   }
   // A short, empty handover is not a provider outage. Keep the SAME transport
   // healthy while a replacement obtains its own support and subscription ACK.
   // This does not preserve old observation windows or hide actual failures.
   if(connected&&this.options.persistent)actions.push({at:Math.max(controlAt,this.nextHeartbeatAt),domain:'control',action:'heartbeat',required:true,deadlineAt:this.nextHeartbeatAt});
  }""")
s=rep(s,"receiptTimeMeaning:'Conservative earliest application-transport chunk of an undrained receiver batch; message availability remains separate. Not an exact wire timestamp.'", "receiptTimeMeaning:'First plaintext frame byte of each message; fragmented messages retain their first fragment. Handler availability is separate; not a kernel/network timestamp.',receiptTiming:this.connection?.receiptClock.usage()??null,idleTransportSince:this.idleSince")
s=rep(s,'connected:!!this.connection?.opened&&!this.connection.closed,physicalTransportsSettled:','connected:!!this.connection?.opened&&!this.connection.closed,selectedCaptureConnected:!!this.connection?.opened&&!this.connection.closed&&[...this.candidates.values()].some(c=>c.subscription!==null&&!c.gap&&!c.suspended&&this.supportFresh(c)),physicalTransportsSettled:')
p.write_text(s)
# Durability classifications are preserved, not weakened or cached.
p=r/'src/run-native-paper.ts';s=p.read_text();start=s.index('export function nativePaperEssentialEvidence(');end=s.index('\n/** Recover only the suffix',start);original=s[start:end]
new=original+"""
/** Lazy ownership is an optimization of classification, never a cached
 * financial permission. Both possible classifications must agree before a
 * ledger read can be omitted; ownership-dependent records read current state. */
export function nativePaperEssentialEvidenceLazy(kind:string,work:string,readOwned:()=>boolean,data?:unknown){
 const withoutOwnership=nativePaperEssentialEvidence(kind,work,false,data),withOwnership=nativePaperEssentialEvidence(kind,work,true,data);
 return withoutOwnership===withOwnership?withoutOwnership:(readOwned()?withOwnership:withoutOwnership);
}
"""
(r/'src/native-evidence-classification.ts').write_text(new)
s=s[:start]+"export {nativePaperEssentialEvidence,nativePaperEssentialEvidenceLazy} from './native-evidence-classification.js';\n"+s[end:]
s="import {nativePaperEssentialEvidenceLazy} from './native-evidence-classification.js';\n"+s
s=rep(s,"const owned=!!ledger&&(Object.keys(ledger.state().positions).length>0||Object.keys(ledger.state().pending).length>0),essential=nativePaperEssentialEvidence(kind,workOwner.current,owned,data);", "const essential=nativePaperEssentialEvidenceLazy(kind,workOwner.current,()=>{if(!ledger)return false;const state=ledger.state();return Object.keys(state.positions).length>0||Object.keys(state.pending).length>0;},data);")
s=rep(s,'candidateDiagnostic(()=>engine?.onGap(row),undefined)','candidateDiagnostic(()=>engine?.onGap(row,{deferRegistryWrites:true}),undefined)')
p.write_text(s)
# In-memory invalidation is immediate; only nonfinancial retirement I/O moves.
p=r/'src/native-candidate-runner.ts';s=p.read_text()
s=rep(s,' onGap(row:{mint?:string;at:number;reason:string}){',' onGap(row:{mint?:string;at:number;reason:string},options:{deferRegistryWrites?:boolean}={}){')
s=rep(s,'  this.pendingGapRetirements.push({row:{...row},targets,contentionReported:false});this.drainGapRetirements();', '''  for(const target of targets)this.certificates.delete(target.mint);
  this.pendingGapRetirements.push({row:{...row},targets,contentionReported:false});
  // The native scope is already unusable and financial gap handling remains
  // immediate. The regular coordinator step owns the bounded SQLite mutation.
  if(!options.deferRegistryWrites)this.drainGapRetirements();''')
s=rep(s,'if(this.candidates.get(mint)!==c||this.retirementRequests.has(mint))return false;','if(this.candidates.get(mint)!==c||this.retirementRequests.has(mint)||this.pendingGapRetirements.some(p=>p.targets.some(t=>t.mint===mint&&t.candidate===c)))return false;')
p.write_text(s)
p=r/'src/operating-intelligence.ts';s=p.read_text();s=rep(s,'captureConnected:boolean(native.connected)',"captureConnected:boolean(Object.hasOwn(native,'selectedCaptureConnected')?native.selectedCaptureConnected:native.connected)");p.write_text(s)
# Offline mock sockets must provide genuine framing to the receipt observer.
for name in ['native-flow-fixture.ts','native-settled-recovery.test.ts','native-startup-integration.test.ts','native-managed-cancel-settlement.test.ts','pilot-native-flow.test.ts']:
 p=r/'test'/name;s=p.read_text();s="import {wsWire} from './ws-wire-fixture.js';\n"+s
 s=s.replace("_socket.emit('data',raw)","_socket.emit('data',wsWire(raw))").replace("_socket.emit('data',data)","_socket.emit('data',wsWire(data))")
 if name in ['native-flow-fixture.ts','native-settled-recovery.test.ts']:
  s=rep(s,"this._socket.emit('data',Buffer.alloc(0));this.emit('pong'", "this._socket.emit('data',wsWire(payload,10));this.emit('pong'")
 if name=='native-flow-fixture.ts':
  s=rep(s,'  send(data:string,',"  controlFrame(kind:'ping'|'pong',payload:Buffer){this._socket.bytesRead+=payload.length+2;this._socket.emit('data',wsWire(payload,kind==='ping'?9:10));this.emit(kind,payload);}\n  send(data:string,")
 if name=='native-startup-integration.test.ts':
  s=rep(s,"queueMicrotask(()=>this.emit('pong',payload));", "queueMicrotask(()=>{this._socket.bytesRead+=payload.length+2;this._socket.emit('data',wsWire(payload,10));this.emit('pong',payload);});")
 p.write_text(s)
for name in ['pilot-native-flow.test.ts','native-flow-service-policy.test.ts']:
 p=r/'test'/name;s=p.read_text();s=s.replace("socket.emit('ping',", "socket.controlFrame('ping',").replace("socket.emit('pong',", "socket.controlFrame('pong',");p.write_text(s)
p=r/'test/native-flow-service-policy.test.ts';p.write_text(p.read_text()+'''

test('persistent empty handover reuses one healthy transport but requires fresh pool support and ACK',async()=>{
 const f=setup({persistent:true}),socket=await f.open(),priorOpen=f.flow.snapshot(scope.mint)!.openedAt;
 f.flow.removeCandidate(scope.mint,'OFFLINE_HANDOVER');assert.equal((await f.flow.service()).kind,'unsubscribe');
 assert.equal(f.flow.usage().connected,true);assert.equal(f.flow.usage().selectedCaptureConnected,false);
 assert.equal((await f.flow.service()).kind,'idle');assert.equal(socket.controls.includes('close'),false);
 await f.advance(1000);const replacement=second();await f.open(replacement);
 assert.equal(f.sockets.length,1);assert.equal(f.flow.snapshot(replacement.mint)!.connected,true);
 assert.equal(f.flow.snapshot(replacement.mint)!.warm,false);assert.ok(f.flow.snapshot(replacement.mint)!.openedAt!>priorOpen!);
 assert.equal(f.flow.usage().selectedCaptureConnected,true);assert.equal(f.flow.snapshot(scope.mint),null);await f.flow.stop();
});
test('persistent idle transport services heartbeat then closes at bounded grace without claiming capture',async()=>{
 const f=setup({persistent:true}),socket=await f.open();f.flow.removeCandidate(scope.mint,'OFFLINE_EMPTY');await f.flow.service();
 const plan=f.flow.servicePlans().find(p=>p.action==='close')!;assert.equal(plan.at,f.now+NATIVE_SERVICE_POLICY.persistentIdleGraceMs);
 assert.equal(f.flow.usage().selectedCaptureConnected,false);await f.advance(10000);assert.equal((await f.flow.service()).kind,'ping');
 await f.advance(5000);assert.equal((await f.flow.service()).kind,'close');await settle();assert.equal(f.flow.usage().connected,false);
 assert.equal(socket.controls.filter(x=>x==='close').length,1);const record=f.records.find(r=>r.kind==='native-flow-disconnected')!;
 assert.equal(record.data.expected,true);assert.equal(record.data.reason,'NATIVE_FLOW_TRANSPORT_CLOSED');await f.flow.stop();
});
test('actual disconnect during persistent idle grace still settles and keeps normal failure backoff',async()=>{
 const f=setup({persistent:true}),socket=await f.open();f.flow.removeCandidate(scope.mint,'OFFLINE_EMPTY');await f.flow.service();f.flow.servicePlans();
 socket.drop(1006);await settle();assert.equal(f.flow.usage().connected,false);assert.equal(f.flow.usage().retryAt,f.now+2000);
 assert.equal(f.records.find(r=>r.kind==='native-flow-disconnected')!.data.expected,false);await f.flow.stop();
});
''')
p=r/'test/native-candidate-runner.test.ts';p.write_text(p.read_text()+'''

test('deferred socket gap invalidates its certificate and membership before any registry transaction',async()=>{
 const registry=new MarketRegistry(':memory:'),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(202);
 try{
  await f.steps(3);const candidate=(f.runner as any).candidates.get(mint);assert.ok(candidate);
  (f.runner as any).certificates.set(mint,{mint,admittedAt:f.now,deadlineAt:f.now+1000});
  const original=registry.transaction;let calls=0;registry.transaction=(()=>{calls++;throw Error('SOCKET_CALLBACK_MUST_NOT_WRITE');}) as typeof original;
  try{
   assert.doesNotThrow(()=>f.runner.onGap({mint,at:f.now,reason:'NATIVE_FLOW_PROCESSING_DEADLINE'},{deferRegistryWrites:true}));
   assert.doesNotThrow(()=>f.runner.onGap({mint,at:f.now,reason:'NATIVE_FLOW_PROCESSING_DEADLINE'},{deferRegistryWrites:true}));
   assert.equal(calls,0);assert.equal(f.runner.currentAuditCertificate(mint,f.now),null);
   assert.equal((f.runner as any).observationMember(candidate,f.now),false);
   assert.equal(f.removed.includes(mint),false,'logical retirement waits for its authoritative write, never fabricated settlement');
  }finally{registry.transaction=original;}
  await f.steps(1);assert.equal(f.removed.includes(mint),true);assert.equal(f.runner.status().counters.qualityGaps,1);
 }finally{await f.runner.stop();registry.close();}
});
test('deferred socket gap survives a real refused writer lease and never regains admission while queued',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-gap-callback-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true}),locker=new Database(path),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(203);
 try{
  await f.steps(3);const candidate=(f.runner as any).candidates.get(mint);assert.ok(candidate);locker.exec('BEGIN IMMEDIATE');
  f.runner.onGap({mint,at:f.now,reason:'NATIVE_FLOW_PROCESSING_DEADLINE'},{deferRegistryWrites:true});
  assert.equal(await f.runner.step(),'wait');assert.equal((f.runner as any).observationMember(candidate,f.now),false);
  assert.equal(f.removed.length,0);locker.exec('ROLLBACK');await f.steps(2);assert.equal(f.removed.includes(mint),true);
  assert.equal(f.runner.status().counters.qualityGaps,1);
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');await f.runner.stop();locker.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});
''')
p=r/'test/operating-intelligence.test.ts';p.write_text(p.read_text()+'''

test('idle transport is not reported as usable selected capture and legacy snapshots retain their semantics',()=>{
 const s=status() as any;assert.equal(projectOperatingIntelligence(s).quality.captureConnected,true);
 s.usage.native.selectedCaptureConnected=false;assert.equal(projectOperatingIntelligence(s).quality.captureConnected,false);
 s.usage.native.selectedCaptureConnected=true;assert.equal(projectOperatingIntelligence(s).quality.captureConnected,true);
 s.usage.native.selectedCaptureConnected=null;assert.equal(projectOperatingIntelligence(s).quality.captureConnected,null);
});
''')
subprocess.run(['git','diff','--check'],check=True)
print('Materialized capture stability source and regression edits; no runtime or financial state changed.')
