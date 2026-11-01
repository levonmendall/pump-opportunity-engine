/** SQL equivalence and query-plan checks use disposable nonfinancial data. */
import{test}from'node:test';import assert from'node:assert/strict';import{MarketRegistry}from'../src/market-registry.js';
const reference="SELECT p.mint,p.signature FROM identity_provenance p JOIN market_tokens t ON t.mint=p.mint\n   LEFT JOIN token_creation_requests r ON r.mint=p.mint AND r.signature=p.signature\n   WHERE p.kind='creation' AND p.source='pumpportal-new-token' AND p.signature!='' AND p.first_seen_at>=? AND p.first_seen_at<=?\n    AND NOT EXISTS(SELECT 1 FROM token_creations c WHERE c.mint=p.mint)\n    AND (r.mint IS NULL OR (r.terminal=0 AND r.next_attempt_at<=?))\n    AND (t.last_activity_at>=? OR EXISTS(SELECT 1 FROM identity_provenance m WHERE m.mint=p.mint AND m.kind='migration' AND m.last_seen_at>=?))\n    AND (EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=p.mint AND w.pool IS NOT NULL AND w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED')) OR EXISTS(SELECT 1 FROM identity_provenance m WHERE m.mint=p.mint AND m.kind='migration'))\n   ORDER BY t.activity_score DESC,p.first_seen_at DESC,p.mint,p.signature LIMIT 1";
test('admission bootstrap: creation selection keeps ordering and cooldown semantics with an active-first plan',()=>{
 const at=1793553252000,r=new MarketRegistry(':memory:',{now:()=>at}),db=(r as any).db;
 try{
  const token=db.prepare('INSERT INTO market_tokens(mint,first_seen_at,last_seen_at,last_activity_at,activity_score,screened_at) VALUES(?,?,?,?,?,?)');
  const provenance=db.prepare('INSERT INTO identity_provenance(mint,source,kind,pool,signature,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?)');
  db.transaction(()=>{for(let i=0;i<5002;i++){const mint='offline-mint-'+i,active=i>=5000;token.run(mint,at-3600000,at,active?at-1000:at-120000,i,at);provenance.run(mint,'pumpportal-new-token','creation','','creation-'+i,at-3600000,at-3600000);provenance.run(mint,'pumpportal-migration','migration','','migration-'+i,at-120000,at-120000);}})();
  const original=(when:number)=>db.prepare(reference).get(Math.max(0,when-86400000),when,when,when-60000,when-60000);
  let sql='',params:unknown[]=[];const statement=(r as any).statement.bind(r);
  (r as any).statement=(text:string)=>{const s=statement(text);if(text.includes('p.signature')&&text.includes('token_creation_requests'))return {get(...values:unknown[]){sql=text;params=values;return s.get(...values);}};return s;};
  for(const when of [at,at+20000,at+60001])assert.deepEqual(r.nextTokenCreationRequest(when),original(when));
  r.deferTokenCreationRequest({mint:'offline-mint-5001',signature:'creation-5001'},at,'OFFLINE_RETRY');
  assert.deepEqual(r.nextTokenCreationRequest(at),original(at));assert.equal(r.nextTokenCreationRequest(at)?.mint,'offline-mint-5000');
  const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map((row:any)=>row.detail).join('\n');
  assert.match(plan,/SEARCH p USING .*\(mint=\? AND source=\? AND kind=\?\)/,'creation provenance is looked up by active mint, not scanned across historical launches');
  assert.doesNotMatch(plan,/SCAN p(?:\s|$)/);
 }finally{r.close();}
});
