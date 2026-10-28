/** Offline evidence mechanics. Never production completeness, transport or economic proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {parseLogNativeEvidence,compareLogToFull,type LogInput} from '../scripts/audit-log-native-capacity.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
const records=readFileSync('evidence/dynamic-funnel-20261027/retained-log-events.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line));
const scopeFor=(r:any)=>{const mint=r.data.selectedHints[0].mint;return {mint,pool:'FUKUVc3MffnDK7dq877GT3wa8M5pmF5NNvrWUuXANhbt',supportedPoolEvidence:'retained verified scope; offline only'};};
const inputFor=(r:any):LogInput=>({signature:r.data.hint.signature,slot:r.data.transaction.slot,err:r.data.transaction.meta.err,logs:structuredClone(r.data.transaction.meta.logMessages),commitment:'confirmed',availableAt:r.data.rpcAvailableAt});

test('retained direct Sell and routed Buy/Sell logs match full-mapper integers, event bytes and trader roles',()=>{
 const types=new Set<string>();
 for(const r of records){const scope=scopeFor(r),input=inputFor(r),logs=parseLogNativeEvidence(input,[scope]),full=mapConfirmedPumpSwapEvidence(r.data.transaction,{...scope,signature:input.signature,providerReceivedAt:null,availableAt:input.availableAt});assert.equal(logs.length,1);assert.equal(full.length,1);assert.equal(compareLogToFull(logs[0]!,full[0]!),true);types.add(logs[0]!.side+':'+(logs[0]!.invocationDepth===1?'direct':'routed'));assert.equal(logs[0]!.transferChecks,null);assert.equal(logs[0]!.compiledInstructionIdentity,null);assert.equal(logs[0]!.normalizedForStrategy,false);assert.equal(logs[0]!.chainBlockTime,null);assert.equal(logs[0]!.availableAt,input.availableAt);}
 assert.deepEqual(types,new Set(['buy:routed','sell:direct','sell:routed']));
});

test('repeated notification has the same actual log-index identity, never fabricated compiled indices',()=>{
 const r=records[0],input=inputFor(r),one=parseLogNativeEvidence(input,[scopeFor(r)])[0]!,two=parseLogNativeEvidence({...input,availableAt:input.availableAt+1000},[scopeFor(r)])[0]!;
 assert.equal(one.identityKey,two.identityKey);assert.equal(one.identity.namespace,'solana-program-log-v1');assert.equal(one.eventBytesSha256,two.eventBytesSha256);assert.equal(two.availableAt,input.availableAt+1000);assert.equal(Object.hasOwn(one.identity,'outerInstructionIndex'),false);assert.equal(Object.hasOwn(one.identity,'innerInstructionIndex'),false);
});

test('altered TransferChecked bytes cannot be detected from unchanged event logs or receive sampled transfer proof',()=>{
 const r=structuredClone(records[1]),scope=scopeFor(r),input=inputFor(r),before=parseLogNativeEvidence(input,[scope])[0]!;
 const tx=r.data.transaction,keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])],group=tx.meta.innerInstructions.find((g:any)=>g.index===3);
 const transfer=group.instructions.find((ix:any)=>{const raw=Buffer.from(bs58.decode(ix.data));return raw.length===10&&raw[0]===12&&keys[ix.accounts[1]]===scope.mint;});assert.ok(transfer);
 const raw=Buffer.from(bs58.decode(transfer.data));raw.writeBigUInt64LE(raw.readBigUInt64LE(1)+1n,1);transfer.data=bs58.encode(raw);
 const full=mapConfirmedPumpSwapEvidence(tx,{...scope,signature:input.signature,providerReceivedAt:null,availableAt:input.availableAt})[0]!;
 assert.equal(full.transferChecks.baseTransfer,false);const after=parseLogNativeEvidence({...input,logs:tx.meta.logMessages},[scope])[0]!;assert.deepEqual(after,before);assert.equal(after.transferChecks,null,'log parity never promotes missing transaction-transfer verification');
});

test('malformed stack, failed/truncated/incomplete logs, bad commitment and event suffix cannot create usable evidence',()=>{
 const r=records[0],scope=scopeFor(r),original=inputFor(r);
 for(const edit of [
  (x:LogInput)=>{x.err={InstructionError:[0,'failed']};},
  (x:LogInput)=>{x.commitment='processed' as any;},
  (x:LogInput)=>{(x.logs as string[]).push('Log truncated');},
  (x:LogInput)=>{(x.logs as string[]).pop();},
  (x:LogInput)=>{const logs=x.logs as string[];const at=logs.findIndex(l=>l.includes(' invoke [2]'));logs[at]=logs[at]!.replace('[2]','[4]');},
  (x:LogInput)=>{const logs=x.logs as string[];const at=logs.findIndex(l=>/^Program .* success$/.test(l));logs[at]=logs[at]!.replace(' success',' failed: synthetic caught failure');},
  (x:LogInput)=>{const logs=x.logs as string[];const at=logs.findIndex(l=>l.startsWith('Program data: '));logs[at]='Program data: '+Buffer.concat([Buffer.from(logs[at]!.slice(14),'base64'),Buffer.from([0])]).toString('base64');},
 ]){const input=structuredClone(original);edit(input);assert.throws(()=>parseLogNativeEvidence(input,[scope]));}
});

test('protocol labels cannot be interpreted as an ordinary buyer even when a BuyEvent shape is decodable',()=>{
 const r=records[0],input=inputFor(r),logs=input.logs as string[];
 const at=logs.findIndex(l=>l==='Program log: Instruction: BuyExactQuoteInV2');assert.ok(at>=0);logs[at]='Program log: Instruction: BoostBuyAndBurn';assert.throws(()=>parseLogNativeEvidence(input,[scopeFor(r)]),/UNSUPPORTED_SWAP_LABEL/);
});

test('payload and canonical scope bounds fail closed before parsing large or unrelated input',()=>{
 const r=records[0],input=inputFor(r);assert.throws(()=>parseLogNativeEvidence({...input,logs:Array(4097).fill('x')},[scopeFor(r)]),/ENVELOPE/);assert.throws(()=>parseLogNativeEvidence(input,[{...scopeFor(r),pool:scopeFor(r).mint}]),/SCOPE_BINDING/);assert.throws(()=>parseLogNativeEvidence(input,[]),/SCOPES/);
});
