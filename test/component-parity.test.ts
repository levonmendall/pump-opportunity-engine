import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {deriveComponentHypothetical,validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';

function fixture(){
  const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
  const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x)),source=structuredClone(rows.find(x=>x.kind==='pool-state').data);
  const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(source.context.slot),0);raw.writeBigInt64LE(123n,8);raw.writeBigUInt64LE(10n,16);raw.writeBigUInt64LE(11n,24);raw.writeBigInt64LE(BigInt(proof.quote.marketBlockTime),32);
  const snapshot:ComponentSnapshot={...source,addresses:[...source.addresses,SYSVAR_CLOCK_PUBKEY.toBase58()],value:[...source.value,{owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0}]};
  return {proof,snapshot,mint:new PublicKey(proof.quote.mint)};
}

test('same-byte Clock parity preserves all layout fields, established SDK math and native backing without network',async()=>{
  const {proof,snapshot,mint}=fixture(),hypo=deriveComponentHypothetical(snapshot,mint);
  assert.equal(hypo.fullBaseUnits,proof.quote.buy.outputBaseUnits);assert.equal(hypo.entryCostLamports,'10007000');
  assert.equal(hypo.clock.epochStartTimestamp,'123');assert.equal(hypo.clock.epoch,'10');assert.equal(hypo.clock.leaderScheduleEpoch,'11');assert.equal(hypo.nativeVault.sufficientBacking,true);
  let captured:ComponentSnapshot|undefined,calls=0;
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls++;assert.equal(method,'getMultipleAccounts');const addresses=params[0] as string[];return {context:snapshot.context,value:addresses.map(a=>snapshot.value[snapshot.addresses.indexOf(a)])} as T;}};
  const rec={record(kind:string,data:unknown){if(kind==='research-clock-pool-state')captured=data as ComponentSnapshot;}};
  const originalNow=Date.now;Date.now=()=>Date.parse(snapshot.receivedAt);
  try{
    const quote=await new ResearchClockPositionPricer(rpc,rec).quote({mint,fullBaseUnits:BigInt(hypo.fullBaseUnits)});
    assert.equal(calls,2);const result=validateComponentParity(captured!,mint,BigInt(hypo.fullBaseUnits),quote);
    assert.equal(result.matches,true);assert.equal(result.clock.rawBytes,40);assert.deepEqual(result.sell,hypo.sameStateSell);
    const changed=structuredClone(quote);changed.sell.outputLamports=(BigInt(changed.sell.outputLamports)+1n).toString();
    assert.throws(()=>validateComponentParity(captured!,mint,BigInt(hypo.fullBaseUnits),changed),/SELL_MISMATCH/);
    const wrong=structuredClone(quote);wrong.rawQuoteReserve=(BigInt(wrong.rawQuoteReserve)+1n).toString();
    assert.throws(()=>validateComponentParity(captured!,mint,BigInt(hypo.fullBaseUnits),wrong),/STATE_MISMATCH/);
  }finally{Date.now=originalNow;}
});

test('parity refuses incomplete dependency sets, stale original Clock and insufficient native backing',()=>{
  const {snapshot,mint}=fixture();
  const missing=structuredClone(snapshot);missing.value[3]=null;assert.throws(()=>deriveComponentHypothetical(missing,mint),/MISSING_ACCOUNT/);
  const stale=structuredClone(snapshot);stale.receivedAt=new Date(Date.parse(stale.receivedAt)+60000).toISOString();assert.throws(()=>deriveComponentHypothetical(stale,mint),/NOT_CURRENT/);
  const poor=structuredClone(snapshot);poor.value[6]!.lamports=1;assert.throws(()=>deriveComponentHypothetical(poor,mint),/WSOL_BACKING/);
  const duplicate=structuredClone(snapshot);duplicate.addresses[7]=duplicate.addresses[0]!;assert.throws(()=>deriveComponentHypothetical(duplicate,mint),/DEPENDENCIES/);
});

test('historical same-byte decoding uses preserved receipt time and never relabels bank Clock as blockTime',()=>{
  const {snapshot,mint}=fixture(),a=deriveComponentHypothetical(snapshot,mint);assert.equal('marketBlockTime'in a.clock,false);
  assert.equal(a.clock.sourceAgeAtReceiptMs,Date.parse(snapshot.receivedAt)-a.clock.marketClockUnixSeconds*1000);
  const bad=structuredClone(snapshot),raw=Buffer.from(bad.value[7]!.data[0],'base64');raw.writeBigUInt64LE(BigInt(bad.context.slot+1),0);bad.value[7]!.data[0]=raw.toString('base64');
  assert.throws(()=>deriveComponentHypothetical(bad,mint),/CONTEXT_MISMATCH/);
});
