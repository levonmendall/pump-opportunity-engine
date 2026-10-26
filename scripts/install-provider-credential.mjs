import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PublicKey} from '@solana/web3.js';

// Operator-only installation. No HTTP, signer, transaction or secret output.
// Source is a protected provider-created bundle; only the API key reaches runtime.
try {
  const [source,target]=process.argv.slice(2);
  if(!source||!target||process.argv.length!==4)throw new Error();
  const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const input=realpathSync(source),parent=realpathSync(dirname(target)),output=resolve(parent,target.split('/').at(-1));
  const outside=p=>{const r=relative(root,p);return r==='..'||r.startsWith('../');};
  if(!outside(input)||!outside(output)||resolve(target)!==output)throw new Error();
  for(const p of [input,parent]){
    const st=lstatSync(p);if(st.isSymbolicLink()||(st.mode&0o077)!==0||st.uid!==process.getuid())throw new Error();
  }
  const st=lstatSync(input);if(!st.isFile()||st.size>16384)throw new Error();
  const data=JSON.parse(readFileSync(input,'utf8'));
  const address=new PublicKey(data.walletPublicKey).toBase58();
  if(typeof data.apiKey!=='string'||data.apiKey.length<20||data.apiKey.length>8192||/[\r\n\0]/.test(data.apiKey))throw new Error();
  writeFileSync(output,data.apiKey,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({installed:true,address,privateRecoveryKeyInstalled:false}));
}catch{console.error('CREDENTIAL_INSTALL_REFUSED: use protected owner-held files outside the repository and a new target; no secrets printed');process.exitCode=1;}
