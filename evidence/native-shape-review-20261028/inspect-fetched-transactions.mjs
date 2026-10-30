/** Offline only. Reads at most the two predeclared historical RPC responses.
 * No provider client, normalization, account writer or transaction construction. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
const require=createRequire('/workspace/pump-opportunity-engine/package.json');
const {BorshCoder}=require('@coral-xyz/anchor'),bs58=require('bs58').default;
const idl=JSON.parse(fs.readFileSync('/workspace/pump-opportunity-engine/node_modules/@pump-fun/pump-swap-sdk/src/idl/pump_amm.json'));
const coder=new BorshCoder(idl),AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',TOKEN=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const retained=JSON.parse(fs.readFileSync(new URL('./retained-two-shapes.json',import.meta.url)));
const safe=x=>typeof x==='bigint'?x.toString():x?.constructor?.name==='BN'?x.toString(10):x?.toBase58?x.toBase58():Array.isArray(x)?x.map(safe):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,safe(v)])):x;
const argv=process.argv.slice(2);if(argv.length!==2)throw Error('Exactly two explicit response paths required; this script does not fetch them.');
const out={schemaVersion:1,kind:'OFFLINE_TWO_FIXED_HISTORICAL_TRANSACTION_INSPECTION',networkRequests:0,normalizationEnabled:false,cases:[]};
for(const path of argv){
 const bytes=fs.readFileSync(path);if(bytes.length>2*1024*1024)throw Error('Response cap');const raw=JSON.parse(bytes),tx=raw.result??raw,sig=tx.transaction?.signatures?.[0],c=retained.retainedCases[sig];if(!c||tx.meta?.err!==null||!['legacy',0,1].includes(tx.version))throw Error('Unexpected source transaction');
 const packet=c.records['native-flow-raw-refusal'].data;if(tx.slot!==packet.slot||JSON.stringify(tx.meta.logMessages)!==JSON.stringify(packet.logs))throw Error('Retained packet mismatch');
 const msg=tx.transaction.message,keys=[...msg.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];if(keys.length>256||keys.some(k=>typeof k!=='string')||msg.instructions.length>128)throw Error('Key/message bounds');
 const key=i=>{if(!Number.isSafeInteger(i)||i<0||i>=keys.length)throw Error('Index');return keys[i];};
 const rows=[];for(let i=0;i<msg.instructions.length;i++)rows.push({outer:i,inner:null,ix:msg.instructions[i]});
 if(!Array.isArray(tx.meta.innerInstructions)||tx.meta.innerInstructions.length>128)throw Error('Missing inner instructions');
 for(const g of tx.meta.innerInstructions){if(!Number.isSafeInteger(g.index)||g.instructions.length>512)throw Error('Inner bounds');for(let i=0;i<g.instructions.length;i++)rows.push({outer:g.index,inner:i,ix:g.instructions[i]});}
 const amm=[],spl=[];
 for(const {outer,inner,ix}of rows){const program=key(ix.programIdIndex),data=Buffer.from(bs58.decode(ix.data)),accounts=ix.accounts.map(key),id={outerInstructionIndex:outer,innerInstructionIndex:inner,stackHeight:ix.stackHeight??(inner===null?1:null)};
  if(program===AMM){
   if(data.subarray(0,8).toString('hex')==='e445a52e51cb9a1d'){amm.push({...id,eventCpi:true,accounts,discriminatorHex:data.subarray(0,16).toString('hex')});continue;}
   const dec=coder.instruction.decode(data),def=idl.instructions.find(d=>d.name===dec?.name);if(!dec||!def||!coder.instruction.encode(dec.name,dec.data).equals(data))throw Error('Unverified compiled AMM instruction layout');
   const fixed=Object.fromEntries(def.accounts.map((a,i)=>[a.name,accounts[i]]));const remaining=accounts.slice(def.accounts.length);amm.push({...id,instructionName:dec.name,args:safe(dec.data),fixedAccounts:fixed,remainingAccounts:remaining,remainingFiveTuples:dec.name==='multi_hop_swap'&&remaining.length%5===0?Array.from({length:remaining.length/5},(_,j)=>{const a=remaining.slice(j*5,j*5+5);return {baseMint:a[0],quoteMint:a[1],venue:a[2],baseVault:a[3],quoteVault:a[4]};}):null});
  }
  if(TOKEN.has(program)){
   const code=data[0],known={3:'Transfer',8:'Burn',9:'CloseAccount',12:'TransferChecked',15:'BurnChecked'}[code];if(known)spl.push({...id,program,instruction:known,rawOpcode:code,bytes:data.length,accounts,amount:data.length>=9?data.readBigUInt64LE(1).toString():null,decimals:data.length===10?data[9]:null,rawHex:data.toString('hex')});else spl.push({...id,program,instruction:'OTHER_TOKEN_INSTRUCTION',rawOpcode:code,bytes:data.length,accounts,rawHex:data.toString('hex')});
  }
 }
 out.cases.push({signature:sig,slot:tx.slot,version:tx.version,chainBlockTime:tx.blockTime??null,responseBytes:bytes.length,responseSha256:crypto.createHash('sha256').update(bytes).digest('hex'),retainedLogsExactlyMatch:true,feePayer:keys[0],transactionSignerKeys:keys.slice(0,msg.header.numRequiredSignatures),networkFeeLamports:String(tx.meta.fee),ammInstructions:amm,tokenInstructions:spl,preTokenBalances:tx.meta.preTokenBalances??null,postTokenBalances:tx.meta.postTokenBalances??null,ordinaryStrategyNormalization:'NOT_PERFORMED; inspect role/route/transfer proof before changing either mapper.'});
}
console.log(JSON.stringify(out,null,2));
