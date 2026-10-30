import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readSourceVersion} from '../src/source-version.js';
test('nested evidence output cannot mislabel modified or untracked application source as clean',t=>{
  const root=mkdtempSync(join(tmpdir(),'poe-source-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'src'));mkdirSync(join(root,'evidence','nested'),{recursive:true});writeFileSync(join(root,'src','runtime.ts'),'fixture');
  const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
  git('init');git('add','src');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
  const from=join(root,'evidence','nested'),clean=readSourceVersion(from);assert.match(clean.commit!,/^[a-f0-9]{40}$/);assert.equal(clean.dirty,false);
  writeFileSync(join(root,'evidence','result.json'),'{}');assert.equal(readSourceVersion(from).dirty,false);
  writeFileSync(join(root,'src','runtime.ts'),'modified');assert.deepEqual(readSourceVersion(from),{commit:clean.commit,dirty:true});
  git('checkout','--','src/runtime.ts');writeFileSync(join(root,'src','new-adapter.ts'),'untracked source');assert.equal(readSourceVersion(from).dirty,true);
});
test('missing repository identity fails conservatively instead of inventing a clean release',t=>{
  const directory=mkdtempSync(join(tmpdir(),'poe-no-repo-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));assert.deepEqual(readSourceVersion(directory),{commit:null,dirty:true});
});
