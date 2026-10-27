import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {PumpApiProbe,PUMPAPI_STREAM,PUMPAPI_SCHEMA_LIMITS,PUMPAPI_CAPTURE_LIMITS,pumpApiChildArguments} from '../src/pumpapi-probe.js';
const MINT='2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',OTHER='11111111111111111111111111111111';
function fixture(extra:Partial<Parameters<typeof create>[0]>={}){return create(extra);}
function create(extra:{evidence?:number;duration?:number;writeFailure?:boolean}={}){
  let now=1_000_000,mono=0,wire=0;const lines:string[]=[];
  const probe=new PumpApiProbe({trackedMints:[MINT],limits:{...PUMPAPI_CAPTURE_LIMITS,evidenceBytes:extra.evidence??1_000_000,durationMs:extra.duration??80_000},now:()=>now,monotonic:()=>mono,write:line=>{if(extra.writeFailure)throw new Error('disposable disk pressure');lines.push(line);}});
  const event=(mint=MINT,signature='same-public-signature')=>({mint,signature,action:'buy',poolId:'public-pool',quoteMint:OTHER,pool:'pump-amm',tokenAmount:1.25,quoteAmount:0.01,breakdown:[{action:'buy',trader:'public-wallet',tokenAmount:1.25,quoteAmount:0.01}],timestamp:1,block:9});
  const receive=(data:unknown)=>{const raw=typeof data==='string'?data:JSON.stringify(data);wire+=Buffer.byteLength(raw)+6;probe.receive(raw,wire);};
  return {probe,lines,event,receive,advance:(ms:number)=>{now+=ms;mono+=ms;},wall:(ms:number)=>{now+=ms;},mono:(ms:number)=>{mono+=ms;},open:()=>probe.opened(),tick:()=>probe.tick({rssBytes:32_000_000,cpuMs:10,eventLoopLagMs:0},wire),rows:()=>lines.map(x=>JSON.parse(x)),snapshot:()=>probe.snapshot()};
}

test('data-only contract is exact endpoint, unverified and never emits invented normalized identity/amounts',()=>{
  const f=fixture();f.open();f.receive(f.event());f.tick();const s=f.snapshot();
  assert.equal(PUMPAPI_STREAM,'wss://stream.pumpapi.io/');assert.equal(s.normalizedTradesProduced,0);assert.equal(s.qualificationEnabled,false);assert.equal(s.entriesEnabled,false);assert.equal(s.fieldContract,'UNVERIFIED');
  const row=f.rows().find(x=>x.kind==='selected-observation');assert.equal(JSON.parse(row.data.payload).quoteAmount,0.01);assert.equal('instructionIndex' in row.data,false);assert.equal(row.data.providerTimestampClaim,1);assert.ok(s.applicationBytes>0);assert.ok(s.observedSocketBytes>s.applicationBytes);
});

test('all bytes and broad schema are counted before mint filtering without retaining unrelated payloads',()=>{
  const f=fixture();f.open();const e={...f.event(OTHER),unrelatedMetadata:'DO-NOT-PERSIST-BROAD-PAYLOAD'};f.receive(e);f.receive(f.event());f.tick();
  const s=f.snapshot();assert.equal(s.frames,2);assert.equal(s.selectedFrames,1);assert.equal(s.selectedPersisted,1);assert.equal(s.inventory.quoteAmount!.number,2);assert.equal(f.lines.join('').includes('DO-NOT-PERSIST-BROAD-PAYLOAD'),false);assert.equal(s.sourceAgeMs,0);
});

test('same signature may carry multiple events; identical-payload references retain receipt counts',()=>{
  const f=fixture();f.open();const e=f.event();f.receive(e);f.receive({...e,quoteAmount:0.02});f.receive(e);f.tick();
  assert.equal(f.snapshot().selectedFrames,3);assert.equal(f.snapshot().selectedPersisted,3);assert.equal(f.snapshot().repeatedSignatures,2);assert.equal(f.snapshot().identicalSelectedPayloads,1);assert.equal(f.snapshot().signatureDedupApplied,false);assert.equal(f.rows().filter(x=>x.kind==='selected-observation').length,2);
});

test('malformed, unsupported batches, missing fields and oversized frames cannot fabricate usable flow',()=>{
  const f=fixture();f.open();f.receive('{bad');f.receive([]);f.receive({mint:MINT,signature:'no-fields'});f.tick();
  assert.equal(f.snapshot().malformedFrames,1);assert.equal(f.snapshot().unsupportedArrayFrames,1);assert.ok(f.snapshot().missingSelectedFields>0);assert.equal(f.snapshot().qualificationEnabled,false);
  f.receive('x'.repeat(65_537));assert.equal(f.snapshot().stopReason,'payload-limit');assert.equal(f.snapshot().oversizeFrames,1);assert.equal(f.snapshot().transportWindowReady,false);
});

test('queue/storage limits stop collection with explicit unpersisted evidence and no growing backlog',()=>{
  const f=fixture();f.open();for(let i=0;i<17;i++)f.receive({...f.event(),block:i});
  assert.equal(f.snapshot().stopReason,'selected-queue-cap');assert.ok(f.snapshot().queueHighWater<=16);assert.equal(f.snapshot().sourceGaps,1);assert.equal(f.snapshot().qualificationEnabled,false);
  const disk=fixture({writeFailure:true});assert.equal(disk.snapshot().stopReason,'storage-unavailable');assert.equal(disk.snapshot().failedWrites,1);assert.equal(disk.snapshot().transportWindowReady,false);
  const cap=fixture({evidence:2000});cap.open();cap.receive({...cap.event(),metadata:'x'.repeat(5000)});cap.tick();assert.equal(cap.snapshot().stopReason,'evidence-cap');assert.equal(cap.snapshot().pendingSelected,1);assert.ok(cap.snapshot().evidenceBytes<=2000);
});

test('receive loss and virtual reconnect invalidate the exact closed-window boundary without clearing counts',()=>{
  const f=fixture();f.open();for(let i=0;i<60;i++){f.receive(f.event(OTHER));f.advance(1000);f.tick();}
  assert.equal(f.snapshot().transportWindowReady,true);f.probe.closed();f.open();f.receive(f.event(OTHER));assert.equal(f.snapshot().transportWindowReady,false);assert.equal(f.snapshot().connections,2);assert.ok(f.snapshot().sourceGaps>=2);assert.ok(f.snapshot().frames>=61);
  f.advance(2001);f.tick();assert.equal(f.snapshot().transportWindowReady,false);assert.ok(f.snapshot().sourceGaps>=3);
});

test('first-frame absence, unknown resources, CPU regression and wall-clock jumps cannot claim readiness',()=>{
  const quiet=fixture();quiet.open();quiet.advance(2001);quiet.tick();assert.equal(quiet.snapshot().sourceGaps,1);assert.equal(quiet.snapshot().transportWindowReady,false);
  for(const resources of [{rssBytes:NaN,cpuMs:0,eventLoopLagMs:0},{rssBytes:1,cpuMs:NaN,eventLoopLagMs:0},{rssBytes:1,cpuMs:0,eventLoopLagMs:NaN}]){const f=fixture();f.open();f.probe.tick(resources);assert.equal(f.snapshot().stopReason,'invalid-resource-reading');}
  const cpu=fixture();cpu.open();cpu.tick();cpu.probe.tick({rssBytes:1,cpuMs:9,eventLoopLagMs:0});assert.equal(cpu.snapshot().stopReason,'invalid-resource-reading');
  const jump=fixture();jump.open();jump.receive(jump.event(OTHER));jump.wall(70_000);assert.equal(jump.snapshot().transportWindowReady,false);jump.wall(-70_001);assert.equal(jump.snapshot().stopReason,'clock-regression');
});

test('resource, duration, transport-headroom and counter failures terminate independently',()=>{
  for(const [resources,reason] of [[{rssBytes:300*1024*1024,cpuMs:0,eventLoopLagMs:0},'rss-limit'],[{rssBytes:1,cpuMs:20_000,eventLoopLagMs:0},'cpu-limit'],[{rssBytes:1,cpuMs:0,eventLoopLagMs:501},'event-loop-lag-limit']] as const){const f=fixture();f.open();f.probe.tick(resources);assert.equal(f.snapshot().stopReason,reason);assert.equal(f.snapshot().transportWindowReady,false);}
  const duration=fixture({duration:10_000});duration.open();duration.advance(10_000);duration.tick();assert.equal(duration.snapshot().stopReason,'duration-limit');
  const wire=fixture();wire.open();wire.probe.observeTransport(104*1024*1024);assert.equal(wire.snapshot().stopReason,'transport-byte-headroom');
  const regressed=fixture();regressed.open();regressed.probe.observeTransport(50);regressed.probe.observeTransport(49);assert.equal(regressed.snapshot().stopReason,'transport-counter-unavailable-or-regressed');
  assert.equal(PUMPAPI_SCHEMA_LIMITS.durationMs,10_000);assert.equal(PUMPAPI_CAPTURE_LIMITS.durationMs,80_000);
});

test('connection flock survives supervisor death until the IPC-disconnected socket-owner exits',{timeout:10_000},async t=>{
  // No provider connection: exercise the actual flock/prlimit/Node exec chain
  // with a stub that models delayed socket cleanup after parent IPC loss.
  const dir=mkdtempSync(join(tmpdir(),'poe-pumpapi-supervisor-')),lock=join(dir,'connection.lock'),marker=join(dir,'disconnected'),stub=join(dir,'child.mjs');
  let childPid:number|undefined;t.after(()=>{if(childPid){try{process.kill(childPid,'SIGKILL');}catch{}}rmSync(dir,{recursive:true,force:true});});
  writeFileSync(stub,`import {writeFileSync} from 'node:fs';const timer=setInterval(()=>{},1000);process.send({ready:true,pid:process.pid});process.once('disconnect',()=>{writeFileSync(${JSON.stringify(marker)},'closed');setTimeout(()=>{clearInterval(timer);process.exit(0);},1500);});`);
  const launch=`const {spawn}=require('node:child_process');const child=spawn('flock',JSON.parse(process.argv[1]),{stdio:['ignore','ignore','ignore','ipc']});child.once('message',message=>process.send(message));child.once('exit',()=>process.exit(0));`;
  const parent=spawn(process.execPath,['-e',launch,JSON.stringify(pumpApiChildArguments(lock,stub,PUMPAPI_SCHEMA_LIMITS))],{cwd:process.cwd(),stdio:['ignore','ignore','ignore','ipc']});
  t.after(()=>{try{parent.kill('SIGKILL');}catch{}});
  const [ready]=await once(parent,'message');assert.equal(ready.ready,true);childPid=ready.pid;
  const held=()=>spawnSync('flock',['-n',lock,'true']).status;assert.equal(held(),1);
  const died=once(parent,'exit');parent.kill('SIGKILL');await died;
  for(let i=0;i<20&&!existsSync(marker);i++)await pause(25);
  assert.equal(existsSync(marker),true,'child observes lost supervisor IPC');assert.equal(held(),1,'orphan still owns connection lock during cleanup');
  process.kill(childPid!,'SIGKILL');childPid=undefined;
  for(let i=0;i<20&&held()!==0;i++)await pause(25);
  assert.equal(held(),0,'next probe can acquire only after socket owner has exited');
});
