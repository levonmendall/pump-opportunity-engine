#!/usr/bin/env python3
"""One-shot source authoring on the repair branch; never used by the runtime.
Refuse changes relative to the inspected application commit, then materialize
reviewable source/test edits. No host, ledger, provider or credential access.
"""
from pathlib import Path
import subprocess

BASE = '34a397b00cfe6ca9796639e42376a5aa7c02872a'
ROOT = Path.cwd()
PATHS = [
    'src/opportunity-priority-policy.ts', 'src/market-registry.ts',
    'src/pilot-watch.ts', 'src/native-candidate-runner.ts',
    'test/pilot-watch-opportunity-priority.test.ts',
    'test/native-candidate-runner.test.ts', 'test/http_latency_host_test.py',
    'docs/SCHEDULING_AND_TOKEN_AGE_REPAIR.md',
]
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
subprocess.run(['git', 'diff', '--exit-code', BASE, '--', *PATHS], check=True)
outputs = {}
def load(path):
    p = ROOT / path
    if p.is_symlink():
        raise RuntimeError('SOURCE_SYMLINK_REFUSED: ' + path)
    return p.read_text()
def replace(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('EXACT_SOURCE_ANCHOR_REQUIRED: ' + old[:100])
    return text.replace(old, new)
def save(path, text):
    outputs[path] = text

p = PATHS[0]
s = load(p)
s = replace(s, 'fairnessSaturationMs:60_000,missingDimensionMerit:0.5,',
    "fairnessSaturationMs:60_000,missingDimensionMerit:0.5,missingEvidenceWaitBonus:0,\n currentEconomicEvidenceFirst:true,technicalRetryOrder:'same-economic-ranking',\n freshCandidateCompetition:'before-each-vacant-slot',")
save(p, s)

p = PATHS[1]
s = load(p)
s = replace(s, 'priority:number;fairnessBonus:number;', 'priority:number;hasCurrentEconomicEvidence:boolean;fairnessBonus:number;')
s = replace(s, 'economic_merit FROM dimensions\n  ) SELECT *', 'economic_merit,CASE WHEN recent_net IS NULL THEN 0 ELSE 1 END current_evidence FROM dimensions\n  ) SELECT *')
s = replace(s, 'economic_merit+${OPPORTUNITY_PRIORITY_POLICY.fairnessMaximum}*MIN(1.0,serviceable_wait_ms/${OPPORTUNITY_PRIORITY_POLICY.fairnessSaturationMs}.0) selection_priority,', 'economic_merit+CASE WHEN current_evidence=1 THEN ${OPPORTUNITY_PRIORITY_POLICY.fairnessMaximum}*MIN(1.0,serviceable_wait_ms/${OPPORTUNITY_PRIORITY_POLICY.fairnessSaturationMs}.0) ELSE 0 END selection_priority,')
s = replace(s, 'FIRST_VALUE(mint) OVER(ORDER BY economic_merit DESC,waiting_since,first_seen_at,signature) economic_leader_mint,', 'FIRST_VALUE(mint) OVER(ORDER BY current_evidence DESC,economic_merit DESC,waiting_since,first_seen_at,signature) economic_leader_mint,')
s = replace(s, 'MAX(economic_merit) OVER() economic_leader_merit FROM ranked', 'FIRST_VALUE(economic_merit) OVER(ORDER BY current_evidence DESC,economic_merit DESC,waiting_since,first_seen_at,signature) economic_leader_merit FROM ranked')
s = replace(s, 'ORDER BY selection_priority DESC,waiting_since,first_seen_at,signature LIMIT 1', 'ORDER BY current_evidence DESC,selection_priority DESC,waiting_since,first_seen_at,signature LIMIT 1')
s = replace(s, 'selection_priority:number;economic_leader_mint:string;', 'selection_priority:number;current_evidence:number;economic_leader_mint:string;')
s = replace(s, 'priority:row.selection_priority,fairnessBonus:observationFairnessBonus(row.serviceable_wait_ms),', 'priority:row.selection_priority,hasCurrentEconomicEvidence:row.current_evidence===1,fairnessBonus:row.current_evidence===1?observationFairnessBonus(row.serviceable_wait_ms):0,')
save(p, s)

p = PATHS[2]
s = load(p)
s = replace(s, 'w.defer_until<=? AND "+age+this.tokenAgeSql', 'w.defer_until<=? AND (w.technical_state IS NULL OR w.technical_state!=\'WAITING\' OR w.technical_not_before<=?) AND "+age+this.tokenAgeSql')
s = replace(s, 'params:[...(persistent?[at,at]:[at,at,at,this.observationAgePolicy.selectedOlderMaximumAgeMs,this.observationAgePolicy.recentMaximumAgeMs]),', 'params:[...(persistent?[at,at,at]:[at,at,at,at,this.observationAgePolicy.selectedOlderMaximumAgeMs,this.observationAgePolicy.recentMaximumAgeMs]),')
s = replace(s, '''      const technical=this.query(where+" AND w.technical_state='WAITING' AND w.technical_not_before<=? AND w.technical_expires_at>?",[...params,at,at],'w.technical_not_before,w.technical_requested_at,w.signature',1)[0];if(technical)return copy(technical);
      // Available broad-feed economics rank research only. Continuous wait
      // credit prevents starvation; unchanged-pool and financial gates above''', '''      // Unowned technical retries compete on current economics, retaining their
      // not-before and changed-evidence gates. Financial owners are separate.
      // Current broad-feed economics and bounded additive waiting credit rank
      // research only; unchanged-pool and financial gates above''')
save(p, s)

p = PATHS[3]
s = load(p)
s = replace(s, '''   let row=this.watch.next(at,excluded,{requireOrigin:!this.currentPoolObservation});
   if(!row&&this.currentPoolObservation&&this.prepareCurrentObservation(at))row=this.watch.next(at,excluded);''', '''   // One newly evidenced identity joins the same competition per vacant slot.
   // A nonempty old queue must not prevent recent opportunities from competing.
   if(this.currentPoolObservation)this.prepareCurrentObservation(at);
   const row=this.watch.next(at,excluded,{requireOrigin:!this.currentPoolObservation});''')
s = replace(s, "   if(!this.observationAllowed(row,at)){this.watch.transition(row.mint,'EXPIRED'", "   at=this.now(); // Recheck age after local selection work, before admission.\n   if(!this.observationAllowed(row,at)){this.watch.transition(row.mint,'EXPIRED'")
save(p, s)

p = PATHS[4]
s = load(p)
s = replace(s, 'assert.equal(f.priority().fairnessBonus,0.05);assert.equal(f.priority().priority,0.55);', 'assert.equal(f.priority().hasCurrentEconomicEvidence,false);assert.equal(f.priority().fairnessBonus,0);assert.equal(f.priority().priority,0.5);')
s = replace(s, "f.seed('new',AT+60000);assert.equal(f.next()!.mint,'waiting');", "f.seed('new',AT+60000);f.hint('waiting','recent',AT+59000,1);f.hint('new','recent',AT+59000,1);assert.equal(f.next()!.mint,'waiting');")
s += '''

test('unowned technical retries do not bypass stronger current economic candidates',()=>{
 const f=fixture();try{
  f.seed('retry');f.watch.requestTechnicalReevaluation('retry',{reason:'entry-quote-unavailable',failedWindowEndAt:AT-10000},AT);
  f.seed('strong');f.hint('strong','prior',AT-90000,1);f.hint('strong','recent',AT-1000,20);
  assert.equal(f.next()!.mint,'strong');assert.equal(f.priority().hasCurrentEconomicEvidence,true);
  assert.equal(f.watch.next(AT,new Set(['strong']))!.mint,'retry','retry remains eligible, not permanently rejected');
 }finally{f.registry.close();}
});
test('technical retry not-before remains a scheduling prerequisite',()=>{
 const f=fixture();try{
  f.seed('retry');f.watch.requestTechnicalReevaluation('retry',{reason:'entry-quote-unavailable',failedWindowEndAt:AT-10000},AT);
  const row=f.registry.lookup('retry')!;row.technicalReevaluation!.notBefore=AT+1000;f.registry.put(row);
  assert.equal(f.next(),null);f.setAt(AT+1000);assert.equal(f.next()!.mint,'retry');
 }finally{f.registry.close();}
});
'''
save(p, s)

p = PATHS[5]
s = load(p)
s += '''

test('fresh shared-market candidates compete before a nonempty older watch queue is selected',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:1});
 try{
  const older=f.seed(1),fresh=new PublicKey(Buffer.alloc(32,201)).toBase58();
  f.runner.onMarketActivity({mint:fresh,signature:sig(20101),receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'20000000000',evidence:'unverified-provider-activity-hint'});
  (f.runner as any).allocate(f.now);
  assert.equal(f.added[0],fresh);assert.notEqual(f.added[0],older);assert.equal(f.rpcCalls.length,0,'local scheduling adds no provider lookup');
 }finally{await f.runner.stop();}
});
'''
save(p, s)

p = PATHS[6]
s = load(p)
s = replace(s, "                    self.assertTrue(not path.exists()or path.read_text().rsplit(')',1)[1].split()[0]=='Z')", "                    # Read once: the kernel may reap the child between exists()\n                    # and read_text(). Missing /proc state is successful exit,\n                    # not a reason to weaken the separate inherited-lease check.\n                    try:child_stat=path.read_text()\n                    except FileNotFoundError:child_stat=None\n                    self.assertTrue(child_stat is None or child_stat.rsplit(')',1)[1].split()[0]=='Z')")
save(p, s)

p = PATHS[7]
s = load(p)
s = replace(s, 'Missing dimensions remain neutral for exploration; waiting cannot multiply them without bound.', 'Missing dimensions remain neutral for exploration. Candidates with recent measured economic flow rank before those without it; candidates without current evidence receive zero waiting bonus. Waiting cannot multiply missing data without bound.')
s = replace(s, 'Financial/technical retry ordering is otherwise unchanged.', 'Unowned technical retries compete using the same economic ranking while keeping not-before and new-evidence gates. Holding and pending-order financial protection remain separate and higher priority. One newly evidenced, age-eligible identity can join competition before each vacant slot is selected, even when older watch rows remain queued.')
s += '\nThe Linux parent-death regression reads /proc process state once and accepts ENOENT after confirmed lease release; it no longer fails if the kernel reaps a child between an existence check and the read. The actual child-death and inherited-lease assertions remain mandatory.\n'
save(p, s)

for path, text in outputs.items():
    (ROOT / path).write_text(text)
subprocess.run(['git', 'diff', '--check'], check=True)
print('Finalized eight source/test/document files; no runtime or financial state changed.')
