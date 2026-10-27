import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {ActivePipeline} from '../src/active-pipeline.js';

const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:raw.transaction.slot,supportedPoolEvidence:'retained canonical proof; hypothetical research only'};
const base=Math.ceil(Date.parse(raw.fetchedAt)/10_000)*10_000;
const payload=(signature=raw.signature)=>({pool:'pump-amm',poolId:scope.pool,mint:scope.mint,signature,action:'sell',tokenAmount:123,quoteAmount:1,txSigner:'not-an-attributed-trader'});
const quote=(sourceAt:number,gross='1000000')=>({mint:scope.mint,slot:scope.minSlot,commitment:'confirmed',receivedAt:new Date(sourceAt).toISOString(),marketBlockTime:Math.floor(sourceAt/1000),sell:{inputBaseUnits:scope.baseUnits,outputLamports:gross}});
function fixture(){let now=base;const records:Array<{kind:string;data:any}>=[];const core=new ActivePipeline({scope,now:()=>now,record:(kind,data)=>records.push({kind,data})});core.open(base);return {core,records,set:(at:number)=>{now=at;}};}

test('actual retained Sell enriches once at actual availability, and a signature hint never supplies UI amounts',()=>{
  const {core,records}=fixture();assert.equal(core.observe(payload(),base+100),'queued');assert.equal(core.observe(payload(),base+200),'duplicate');assert.equal(core.nextHint(base+1099),null);
  const hint=core.nextHint(base+1100)!;assert.ok(hint);assert.equal(core.nextHint(base+1101),null);const events=core.completeHint(hint,raw.transaction,base+1500);
  assert.equal(events.length,1);const rows=records.filter(r=>r.kind==='research-normalized-trade');assert.equal(rows.length,1);assert.equal(rows[0]!.data.curve.trade.receivedAt,base+1500);assert.equal(rows[0]!.data.curve.trade.quoteLamports,'1481514');assert.equal(rows[0]!.data.user.trade.quoteLamports,'1462993');assert.equal(rows[0]!.data.curve.trade.wallet,'BwJigd5taT26gAhNcv1DMrC7epkedHBjcgbWVbEMP8Q');
  assert.deepEqual(rows[0]!.data.curve.trade.identity,{signature:raw.signature,instructionIndex:2,eventIndex:5});const s=core.snapshot(base+1600);assert.equal(s.normalizedSells,1);assert.equal(s.uniqueEnrichmentAttempts,1);assert.equal(s.duplicateSignatureHints,1);assert.equal(s.pending,0);assert.equal(s.verifiedUsableFeatureWindowSeconds,0);
});

test('closed receive bins warm only after sufficient observation and are not a completeness or strategy pass',()=>{
  const {core}=fixture();core.observe(payload(),base+10);const hint=core.nextHint(base+1010)!;core.completeHint(hint,raw.transaction,base+1200);
  core.tick(base+59_000);assert.equal(core.snapshot(base+59_000).featureRows.at(-1)!.curve.sufficientlyObserved,false);
  core.tick(base+60_000);core.tick(base+61_000);const s=core.snapshot(base+61_000);
  assert.equal(s.featureRows.at(-1)!.curve.sufficientlyObserved,true);assert.equal(s.featureRows.at(-1)!.curve.tradeCount,1);assert.equal(s.enrichedFeatureWarmSeconds,1);assert.equal(s.noPendingFeatureWarmSeconds,1);assert.equal(s.verifiedUsableFeatureWindowSeconds,0);
});

test('pending enrichment stops fully-enriched warm duration at the actual admission boundary',()=>{
  const {core}=fixture();core.observe(payload(),base+10);core.completeHint(core.nextHint(base+1010)!,raw.transaction,base+1200);
  core.tick(base+60_000);core.tick(base+61_000);
  core.observe(payload(bs58.encode(Buffer.alloc(64,45))),base+61_100);
  const s=core.snapshot(base+62_000);assert.equal(s.noPendingFeatureWarmSeconds,1.1);assert.equal(s.enrichedFeatureWarmSeconds,2);assert.equal(s.pending,1);
});

test('queue capacity, invalid selected fields and expired requests invalidate rather than silently omit selected evidence',()=>{
  const {core}=fixture();for(let i=0;i<16;i++)assert.equal(core.observe(payload(bs58.encode(Buffer.alloc(64,i+1))),base+i),'queued');
  assert.equal(core.observe(payload(bs58.encode(Buffer.alloc(64,80))),base+20),'invalid');const s=core.snapshot(base+21);assert.equal(s.queueHighWater,16);assert.equal(s.historicalWindowInvalidated,true);assert.equal(s.qualityGaps.at(-1)!.reason,'selected-enrichment-capacity');
  assert.equal(core.nextHint(base+5100),null);assert.equal(core.snapshot(base+5101).failedTransactions,1);
  assert.equal(core.observe({...payload(),signature:'missing'},base+5200),'invalid');assert.equal(core.snapshot(base+5201).qualityGaps.at(-1)!.reason,'selected-essential-fields-unavailable');
});

test('failed and excessively delayed confirmed responses cannot manufacture usable flow',()=>{
  const {core}=fixture();core.observe(payload(),base+100);const hint=core.nextHint(base+1100)!;assert.deepEqual(core.completeHint(hint,null,base+1500),[]);const s=core.snapshot(base+1600);assert.equal(s.normalizedDuringObservation,0);assert.equal(s.historicalWindowInvalidated,true);
  const other=fixture();other.core.observe(payload(),base+100);const late=other.core.nextHint(base+1100)!;assert.deepEqual(other.core.completeHint(late,raw.transaction,base+5200),[]);assert.equal(other.core.snapshot(base+5201).qualityGaps.at(-1)!.reason,'selected-enrichment-completed-too-late');
});

test('observation end freezes warming while bounded late confirmations remain labeled late',()=>{
  const {core}=fixture();core.observe(payload(),base+58_500);const hint=core.nextHint(base+59_500)!;core.endObservation(base+60_000,'duration-limit');
  core.completeHint(hint,raw.transaction,base+60_500);core.tick(base+64_000);core.close(base+64_001);
  const s=core.snapshot(base+65_000);assert.equal(s.observationMs,60_000);assert.equal(s.normalizedDuringObservation,0);assert.equal(s.normalizedAfterObservation,1);assert.equal(s.enrichedFeatureWarmSeconds,0);assert.equal(s.featureRows.at(-1)!.at,base+60_000);
  const pending=fixture();pending.core.observe(payload(),base+100);pending.core.endObservation(base+200);pending.core.close(base+5200);assert.equal(pending.core.snapshot(base+5201).qualityGaps.at(-1)!.reason,'unresolved-enrichment-at-final-close');
});

test('actual-size pricing uses original coherent-batch age, counts modeled gas once and preserves a fixed hypothetical baseline',()=>{
  const {core}=fixture();const first=core.price(quote(base+100),base+200)!;assert.equal(first.netLamports,'993000');assert.equal(first.hypotheticalBaseline!.cost,'993000');
  core.tick(base+2200);let s=core.snapshot(base+2200);assert.equal(s.prices.freshCacheMs,1900);assert.equal(s.prices.staleCacheMs,300);
  assert.equal(core.price(quote(base+100),base+2300),null);assert.equal(core.snapshot(base+2300).prices.rejected,1);
  const changed=core.price(quote(base+2400,'800000'),base+2500)!;assert.equal(changed.hypotheticalBaseline!.cost,'993000');assert.equal(changed.decision.action,'request-exit');
  s=core.snapshot(base+2600);assert.equal(s.prices.changes,1);assert.equal(s.prices.triggerEvents.length,1);assert.equal(s.prices.triggerEvents[0]!.recognitionAfterBatchReceiveMs,100);assert.equal(s.prices.triggerEvents[0]!.chainCrossingTime,'UNKNOWN_BETWEEN_SAMPLED_STATES');assert.equal(s.naturalPaperTrades,0);
});

test('audit duplicates are harmless but transfer quality corrections invalidate the historical experiment window',()=>{
  const {core}=fixture();core.observe(payload(),base+100);const hint=core.nextHint(base+1100)!;core.completeHint(hint,raw.transaction,base+1500);core.endObservation(base+60_000);
  core.audit(hint,raw.transaction,base+60_100);assert.equal(core.snapshot(base+60_101).duplicateExecutedEvents,1);
  const changed=structuredClone(raw.transaction),ix=changed.meta.innerInstructions[0].instructions[1],encoded=Buffer.from(bs58.decode(ix.data));encoded.writeBigUInt64LE(encoded.readBigUInt64LE(1)+1n,1);ix.data=bs58.encode(encoded);
  core.audit(hint,changed,base+60_200);const s=core.snapshot(base+60_201);assert.equal(s.corrections,1);assert.equal(s.historicalWindowInvalidated,true);assert.equal(s.qualityGaps.at(-1)!.reason,'confirmed-executed-evidence-correction');
});
