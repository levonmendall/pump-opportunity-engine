import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePaperWorkState} from '../src/native-paper-work.js';

test('nested financial work restores its still-active candidate caller and then idle',()=>{
 const work=new NativePaperWorkState(),candidate=work.enter('candidate'),protection=work.enter('protection');
 assert.equal(work.current,'protection');assert.equal(protection(),true);assert.equal(work.current,'candidate');assert.equal(candidate(),true);assert.equal(work.current,'idle');
});
test('a canceled candidate cannot be resurrected by its late protection completion',async()=>{
 const work=new NativePaperWorkState();work.set('candidate');
 let complete!:()=>void;const completed=new Promise<void>(r=>complete=r);
 const protection=(async()=>{const restore=work.enter('protection');await completed;return restore();})();
 work.set('idle');complete();assert.equal(await protection,false);assert.equal(work.current,'idle');
});
test('a late restoration cannot overwrite a newer pending financial owner',()=>{
 const work=new NativePaperWorkState();work.set('source');const old=work.enter('protection');work.set('pending');
 assert.equal(old(),false);assert.equal(work.current,'pending');
});
test('a released work lease cannot restore twice',()=>{
 const work=new NativePaperWorkState(),restore=work.enter('protection');assert.equal(restore(),true);assert.equal(restore(),false);assert.equal(work.current,'idle');
});
