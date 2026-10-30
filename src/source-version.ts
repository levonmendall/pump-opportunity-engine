import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Identify the code's repository, independent of the evidence output cwd. */
export function readSourceVersion(from=dirname(fileURLToPath(import.meta.url))):{commit:string|null;dirty:boolean}{
  const run=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000,maxBuffer:2_000_000}).trim();
  try{
    const root=run(['-C',from,'rev-parse','--show-toplevel']);
    const commit=run(['-C',root,'rev-parse','HEAD']);
    if(!/^[a-f0-9]{40}$/.test(commit))return {commit:null,dirty:true};
    const status=run(['--no-optional-locks','-C',root,'status','--porcelain','--','src','package.json','package-lock.json','scripts/patch-bigint-buffer.mjs']);
    return {commit,dirty:status.length>0};
  }catch{return {commit:null,dirty:true};}
}
