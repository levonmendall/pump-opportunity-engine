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

// These two successful historical transaction payloads were preserved before the
// decoder repair. They establish narrowly observed compatibility, not new flow.
const baselineAudit=JSON.parse(readFileSync('evidence/high-activity-20261028/log-native-offline-audit.json','utf8'));
const legacyBuys=baselineAudit.refusedTransactionFixtures.filter((r:any)=>r.fullMapperRefusalAtAuditVersion==='RELEVANT_AMM_INSTRUCTION_UNSUPPORTED'&&baselineAudit.rows.find((row:any)=>row.signature===r.signature).unsupportedInstructions.some((i:any)=>i.idlDiscriminatorName==='buy'&&i.actualByteLength===24));

test('retained exact24-byte ordinary Buy compatibility preserves actual amounts, roles, fees and absent-volume truth',async()=>{
 const {decodePumpSwapInstruction,inspectScopedPumpSwapInstructions}=await import('../src/pumpapi-mapping.js');
 assert.equal(legacyBuys.length,2);
 for(const r of legacyBuys){
  const checks=inspectScopedPumpSwapInstructions(r.transaction,r);assert.equal(checks.supportedSwapInstructions,1);
  const check=checks.checks.find(c=>c.instructionName==='buy')!;assert.equal(check.instructionLayout,'observed-buy-two-u64');assert.equal(check.trackVolumeAvailable,false);
  const ix=check.innerInstructionIndex===null?r.transaction.transaction.message.instructions[check.outerInstructionIndex]:r.transaction.meta.innerInstructions.find((g:any)=>g.index===check.outerInstructionIndex).instructions[check.innerInstructionIndex];
  const raw=Buffer.from(bs58.decode(ix.data)),decoded=decodePumpSwapInstruction(raw);assert.equal(raw.length,24);assert.equal(Object.hasOwn(decoded.data,'track_volume'),false);assert.equal((decoded.data.base_amount_out as any).toString(10),raw.readBigUInt64LE(8).toString());assert.equal((decoded.data.max_quote_amount_in as any).toString(10),raw.readBigUInt64LE(16).toString());
  const mapped=mapConfirmedPumpSwapEvidence(r.transaction,{...r,providerReceivedAt:null,availableAt:r.rpcAvailableAt});assert.equal(mapped.length,1);const m=mapped[0]!;assert.equal(m.side,'buy');assert.deepEqual(m.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
  const log=parseLogNativeEvidence({signature:r.signature,slot:r.transaction.slot,err:null,logs:r.transaction.meta.logMessages,commitment:'confirmed',availableAt:r.rpcAvailableAt},[{mint:r.mint,pool:r.pool,supportedPoolEvidence:'retained historical validated source'}])[0]!;
  assert.equal(compareLogToFull(log,m),true);assert.equal(m.normalizedForStrategy,false);assert.equal(m.availableAt,r.rpcAvailableAt);assert.ok(Object.values(m.fees).every(f=>/^(0|[1-9][0-9]*)$/.test(f)));
 }
});

test('legacy24-byte Buy role/event/transfer corruption and unverified26-byte tails retain strict refusals',async()=>{
 const {decodePumpSwapInstruction,toResearchNormalizedTrade,inspectScopedPumpSwapInstructions}=await import('../src/pumpapi-mapping.js');
 for(const fixture of legacyBuys){const r=structuredClone(fixture),tx=r.transaction,input={...r,providerReceivedAt:null,availableAt:r.rpcAvailableAt},check=inspectScopedPumpSwapInstructions(tx,r).checks.find(c=>c.instructionName==='buy')!;
  const group=tx.meta.innerInstructions.find((g:any)=>g.index===check.outerInstructionIndex),ix=check.innerInstructionIndex===null?tx.transaction.message.instructions[check.outerInstructionIndex]:group.instructions[check.innerInstructionIndex],bytes=Buffer.from(bs58.decode(ix.data));
  assert.throws(()=>decodePumpSwapInstruction(bytes.subarray(0,23)));assert.throws(()=>decodePumpSwapInstruction(Buffer.concat([bytes,Buffer.from([1,1])])),/LAYOUT/);assert.throws(()=>decodePumpSwapInstruction(Buffer.concat([bytes,Buffer.from([0,0,0])])),/LAYOUT/);
  const roles=structuredClone(tx),badIx=check.innerInstructionIndex===null?roles.transaction.message.instructions[check.outerInstructionIndex]:roles.meta.innerInstructions.find((g:any)=>g.index===check.outerInstructionIndex).instructions[check.innerInstructionIndex];badIx.accounts[1]=badIx.accounts[2];assert.throws(()=>mapConfirmedPumpSwapEvidence(roles,input),/TRADER_ROLE/);
  const original=mapConfirmedPumpSwapEvidence(tx,input)[0]!,event=group.instructions[original.identity.eventInnerInstructionIndex],encoded=Buffer.from(bs58.decode(event.data));event.data=bs58.encode(encoded.subarray(0,-8));assert.throws(()=>mapConfirmedPumpSwapEvidence(tx,input),/EVENT_LAYOUT/);
  const transferTx=structuredClone(fixture.transaction),keys=[...transferTx.transaction.message.accountKeys,...(transferTx.meta.loadedAddresses?.writable??[]),...(transferTx.meta.loadedAddresses?.readonly??[])],transfers=transferTx.meta.innerInstructions.find((g:any)=>g.index===check.outerInstructionIndex).instructions;
  const transfer=transfers.find((x:any)=>{const b=Buffer.from(bs58.decode(x.data));return b.length===10&&b[0]===12&&keys[x.accounts[1]]===r.mint;});assert.ok(transfer);const b=Buffer.from(bs58.decode(transfer.data));b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);transfer.data=bs58.encode(b);const changed=mapConfirmedPumpSwapEvidence(transferTx,input)[0]!;assert.equal(changed.transferChecks.baseTransfer,false);assert.throws(()=>toResearchNormalizedTrade(changed,'curve','retained scope'),/UNVERIFIED_EXECUTED_TRANSFERS/);
 }
 const unverified26=baselineAudit.refusedTransactionFixtures.filter((r:any)=>baselineAudit.rows.find((row:any)=>row.signature===r.signature).unsupportedInstructions.some((i:any)=>i.actualByteLength===26));assert.equal(unverified26.length,3);for(const r of unverified26)assert.throws(()=>mapConfirmedPumpSwapEvidence(r.transaction,{...r,providerReceivedAt:null,availableAt:r.rpcAvailableAt}),/RELEVANT_AMM_INSTRUCTION_UNSUPPORTED/);
});
