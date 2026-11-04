import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync,readFileSync,chmodSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMarketIntakeSpool} from '../src/native-market-intake-spool.js';
import {spawnSync} from 'node:child_process';

test('shutdown spool refuses financial names, aliases, hardlinks and public files without changing their contents',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-tail-path-')),target=join(dir,'ledger.sqlite'),path=join(dir,'market-intake-tail.json');writeFileSync(target,'financial-sentinel',{mode:0o600});
 try{assert.throws(()=>new NativeMarketIntakeSpool(target),/SPOOL_PATH/);const spool=new NativeMarketIntakeSpool(path);symlinkSync(target,path);await assert.rejects(spool.load());await assert.rejects(spool.save([]));assert.equal(readFileSync(target,'utf8'),'financial-sentinel');rmSync(path);linkSync(target,path);await assert.rejects(spool.load(),/SPOOL_FILE/);await assert.rejects(spool.clear(),/SPOOL_FILE/);rmSync(path);writeFileSync(path,'private-sentinel',{mode:0o600});chmodSync(path,0o644);await assert.rejects(spool.save([]),/SPOOL_FILE/);await assert.rejects(spool.clear(),/SPOOL_FILE/);assert.equal(readFileSync(path,'utf8'),'private-sentinel');chmodSync(path,0o600);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('shutdown spool rejects duplicate IDs and malformed rows while preserving the recovery file',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-tail-content-')),path=join(dir,'market-intake-tail.json'),spool=new NativeMarketIntakeSpool(path),message={kind:'intake' as const,id:1,operation:'migration' as const,value:{signature:'original',receivedAt:1000}};
 try{for(const rows of [[{message,queuedAt:1000},{message,queuedAt:1000}],[{message:{...message,id:0},queuedAt:1000}],[{message,queuedAt:-1}]]){const original=JSON.stringify({version:'native-market-intake-shutdown-tail-v1',rows});writeFileSync(path,original,{mode:0o600});await assert.rejects(spool.load(),/SPOOL_CONTENT/);assert.equal(readFileSync(path,'utf8'),original);}}finally{rmSync(dir,{recursive:true,force:true});}
});

test('an owned private FIFO is rejected without waiting for a writer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-tail-fifo-')),path=join(dir,'market-intake-tail.json');try{assert.equal(spawnSync('mkfifo',['-m','600',path]).status,0);await assert.rejects(new NativeMarketIntakeSpool(path).load(),/SPOOL_FILE/);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('a syntactically shaped but invalid normalized receipt is retained and refused before a worker can restart on it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-tail-normalized-')),path=join(dir,'market-intake-tail.json');try{const original=JSON.stringify({version:'native-market-intake-shutdown-tail-v1',rows:[{message:{kind:'intake',id:1,operation:'activity',value:{mint:'valid-looking-mint'}},queuedAt:1000}]});writeFileSync(path,original,{mode:0o600});await assert.rejects(new NativeMarketIntakeSpool(path).load(),/SPOOL_CONTENT/);assert.equal(readFileSync(path,'utf8'),original);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('invalid save cannot replace the last readable shutdown handoff',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-tail-save-schema-')),path=join(dir,'market-intake-tail.json'),spool=new NativeMarketIntakeSpool(path);try{await spool.save([{message:{kind:'intake',id:1,operation:'migration',value:{signature:'original',receivedAt:1000}},queuedAt:1000}]);const original=readFileSync(path,'utf8');await assert.rejects(spool.save([{message:{kind:'intake',id:2,operation:'migration',value:{signature:'',receivedAt:1000}},queuedAt:1000}]),/SPOOL_CONTENT/);assert.equal(readFileSync(path,'utf8'),original);assert.equal((await spool.load())[0]!.message.id,1);}finally{rmSync(dir,{recursive:true,force:true});}
});
