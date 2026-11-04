# Private selection competition evidence

The existing priority receipt described the selected opportunity and the
economic leader, but could not establish which other rows actually competed
at that selection. This change adds a bounded competition witness to the
existing `pilot-watch-opportunity-priority` diagnostic receipt.

The same ranked CTE returns its exact row count and the top eight scalar peers.
Each peer records its rank, mint, pool, economic merit, bounded fairness bonus,
selection priority and presence of current economic evidence. The witness uses
the original query reference time and explicitly identifies preparation versus
allocation selection (including waiting-peer probes), prepared-mint versus age-scoped or caller-filtered selection,
the ranked-watch-row population unit, and omitted peer count. It includes the
selected row. It explicitly claims no actual allocation, whole-market coverage
or financial permission; actual promotion and ACK receipts remain separate.

The query keeps every eligibility, exclusion, scoring, age, fairness and tie
predicate. It executes the same existing preflight and ranked statements.
Only the winner's full WatchRow body is fetched; other peers use already ranked
scalars. No financial, observation-generation or registry state is changed.
`competition` is optional in the exported hint type so retained older hints
remain compatible; every new successful durable selection emits it.

Validation:

- Typecheck and 130 affected watch/selection/pool-progress tests passed, with
  zero failures or skips. Existing frozen selector parity tests compare every
  former field unchanged, stripping only the newly added witness.
- Four new tests cover exact population/top-eight/omissions, gates and caller
  exclusions, prepared scope/preparation purpose, and fairness changing the
  selected winner while preserving the original economic leader.
- A separately frozen exact `65994a4` weighted selector (method SHA256
  `124b8871de105ef442d14305b1b2ad425d5c547a2af7e5c6c32d9614e62b0fbe`)
  supplies a paired performance baseline without changing indexes.
- On a synthetic local registry with 16,385 retained rows, 1,024 eligible rows
  and 4,096 activity rows, seven interleaved samples per variant measured global
  median 24.996→26.595 ms and prepared-four median 1.813→2.139 ms. The benchmark
  asserts two SQL statements, at most eight scalar peers and one winner body.
- Independent review passed 32 focused tests, typecheck and diff checks. Its
  paired benchmark measured global median 24.513→27.672 ms and prepared-four
  2.103→2.325 ms. No ranking, admission, policy or write-authority change was
  found.

These are offsite engineering results. Native deployment, EC2 cost, holding
protection and fresh operating receipt capture remain separate verification.
