/** Disposable files only. Exercise the actual source writers, not a second
 * publication implementation; never open an operating account or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {boundOperatingIntelligence} from '../src/operating-intelligence.js';
import {readSnapshotFileWithProvenance} from '../src/snapshot-publisher.js';
import {SnapshotCache} from '../src/reporting.js';

function writers(options:{failWrite?:()=>boolean}={}){
 const source=ts.createSourceFile('run-native-paper.ts',fs.readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),names=['need','atomic','atomicCurrentReadModel'];
 const helpers=source.statements.filter((s):s is ts.FunctionDeclaration=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text??''));assert.equal(helpers.length,3);
 const calls:{kind:'sync'|'rename';path:string}[]=[],descriptors=new Map<number,string>(),bindings={constants:fs.constants,unlinkSync:fs.unlinkSync,Buffer,MIB:1024*1024,dirname,resolve,randomUUID,process,
  openSync:(...args:Parameters<typeof fs.openSync>)=>{const fd=fs.openSync(...args);descriptors.set(fd,String(args[0]));return fd;},
  closeSync:(fd:number)=>{try{return fs.closeSync(fd);}finally{descriptors.delete(fd);}},
  fsyncSync:(fd:number)=>{calls.push({kind:'sync' as const,path:descriptors.get(fd)??'UNKNOWN_DESCRIPTOR'});return fs.fsyncSync(fd);},
  writeFileSync:(...args:Parameters<typeof fs.writeFileSync>)=>{if(options.failWrite?.())throw Error('OFFLINE_CURRENT_VIEW_WRITE_FAILURE');return fs.writeFileSync(...args);},
  renameSync:(from:fs.PathLike,to:fs.PathLike)=>{calls.push({kind:'rename' as const,path:String(to)});return fs.renameSync(from,to);},
 };
 const body=ts.transpileModule(helpers.map(s=>s.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return {...Function(...Object.keys(bindings),body+';return {atomic,atomicCurrentReadModel};')(...Object.values(bindings)) as {atomic:(path:string,value:unknown,maximum?:number)=>void;atomicCurrentReadModel:(path:string,value:unknown,maximum?:number)=>void},calls};
}

test('only replaceable current views omit barriers; account/checkpoint/result writers stay durable',t=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'poe-OFFLINE-current-views-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const w=writers(),original={generatedAt:123,runId:'original-run',pending:{owned:'retained'}};
 for(const name of ['account.json','watch-checkpoint.json','result.json']){
  w.calls.length=0;w.atomic(join(directory,name),original);assert.ok(w.calls.some(c=>c.kind==='sync'&&c.path.startsWith(join(directory,name+'.pending-'))));assert.ok(w.calls.some(c=>c.kind==='sync'&&c.path===directory));
 }
 for(const name of ['snapshot.json','status.json']){
  w.calls.length=0;w.atomicCurrentReadModel(join(directory,name),original);assert.equal(w.calls.filter(c=>c.kind==='sync').length,0);assert.equal(w.calls.filter(c=>c.kind==='rename').length,1);assert.deepEqual(JSON.parse(fs.readFileSync(join(directory,name),'utf8')),original);assert.equal(fs.statSync(join(directory,name)).mode&0o777,0o600);
 }
 assert.throws(()=>w.atomicCurrentReadModel(join(directory,'account.json'),{}),/CURRENT_READ_MODEL_PATH/);assert.throws(()=>w.atomicCurrentReadModel(join(directory,'snapshot.json'),{value:'oversized'},1),/STATUS_BOUND/);
 assert.equal(fs.readdirSync(directory).filter(name=>name.includes('.pending-')).length,0);
});

test('an interrupted current-view write preserves prior complete bytes and removes only its own staging file',t=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'poe-OFFLINE-interrupted-view-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let fail=false;const w=writers({failWrite:()=>fail}),path=join(directory,'status.json'),prior={generatedAt:111,runId:'prior-real-source'},next={generatedAt:222,runId:'next-real-source'};
 w.atomicCurrentReadModel(path,prior);const bytes=fs.readFileSync(path);fs.writeFileSync(join(directory,'unrelated.pending-owned-elsewhere'),'retain');fail=true;
 assert.throws(()=>w.atomicCurrentReadModel(path,next),/OFFLINE_CURRENT_VIEW_WRITE_FAILURE/);assert.deepEqual(fs.readFileSync(path),bytes);assert.equal(fs.readFileSync(join(directory,'unrelated.pending-owned-elsewhere'),'utf8'),'retain');assert.deepEqual(fs.readdirSync(directory).sort(),['status.json','unrelated.pending-owned-elsewhere']);
});

test('missing or old post-crash views cannot manufacture fresh source identity or original timestamps',t=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'poe-OFFLINE-stale-view-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.chmodSync(directory,0o700);
 const snapshot=JSON.parse(fs.readFileSync(new URL('./fixtures/operating-intelligence-budget/current-snapshot.json',import.meta.url),'utf8'));snapshot.intelligence=boundOperatingIntelligence(snapshot.intelligence);
 const originalTimes=structuredClone(snapshot.times),originalRun=structuredClone(snapshot.intelligence.run),identity={accountId:snapshot.account.id,inceptionAt:snapshot.account.inceptionAt,release:snapshot.source.release,strategy:snapshot.source.strategy},path=join(directory,'snapshot.json'),w=writers(),at=Date.parse(snapshot.times.generatedAt);
 assert.throws(()=>readSnapshotFileWithProvenance(path,identity),{code:'ENOENT'});
 w.atomicCurrentReadModel(path,snapshot);const read=readSnapshotFileWithProvenance(path,identity).snapshot;assert.deepEqual(read.times,originalTimes);assert.deepEqual(read.intelligence!.run,originalRun);
 const cache=new SnapshotCache(identity);cache.accept(read,at);assert.match(cache.status(at+90001).state,/stale|unavailable/);assert.deepEqual(cache.read()!.snapshot.times,originalTimes,'inspection never rewrites stale evidence to now');
 assert.throws(()=>readSnapshotFileWithProvenance(path,{...identity,release:'f'.repeat(40)}),'an old deployed source is not accepted as a different running source');
 fs.unlinkSync(path);assert.throws(()=>readSnapshotFileWithProvenance(path,identity),{code:'ENOENT'});
});

test('checkpoint counters come from one coherent native sample and one feed sample',()=>{
 const source=ts.createSourceFile('run-native-paper.ts',fs.readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),declarations=new Map<string,string>();
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&['nativeCounterKeys','feedCounterKeys','serviceStatistics'].includes(node.name.text))declarations.set(node.name.text,'const '+node.getText(source)+';');ts.forEachChild(node,visit);};visit(source);assert.equal(declarations.size,3);
 let nativeSamples=0,feedSamples=0;const at=123456,bindings={Date:{now:()=>at},serviceGeneration:2,manifest:{accountId:'OFFLINE-original-account',inceptionAt:100},runId:'OFFLINE-original-run',NATIVE_PROTECTION_HISTORY_KIND:'OFFLINE',maxCompletedGap:2500,maxQuoteAge:200,protectionBreaches:3,unavailableChecks:4,
  nativeUsage:()=>{nativeSamples++;return new Proxy({},{get:()=>nativeSamples});},feedUsage:()=>{feedSamples++;return new Proxy({},{get:()=>feedSamples*10});}};
 const code=ts.transpileModule([...declarations.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const sample=Function(...Object.keys(bindings),code+';return serviceStatistics;')(...Object.values(bindings)),engine={counters:{auditedWindows:7}},result=sample(engine);
 assert.equal(nativeSamples,1);assert.equal(feedSamples,1);assert.deepEqual(Object.values(result.native),Array(7).fill(1));assert.deepEqual(Object.values(result.feeds),Array(11).fill(10));assert.equal(result.engine,engine.counters);assert.equal(result.at,at);assert.equal(result.protection.generatedAt,at);assert.equal(result.protection.counters.breaches,3,'historical protection facts remain unchanged');
});
