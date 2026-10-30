# Exact 9307 / 9310 entry-readiness correlation

These are retained authenticated original `/api/snapshot` GET results, not a new replayed market interval or private ledger inspection. No original account, process, financial data, or provider was changed.

| Fact | Snapshot 9307 | Snapshot 9310 |
| --- | --- | --- |
| Render receipt | 17:47:05.682 UTC | 17:47:51.004 UTC |
| Source generated | 17:46:40.848 UTC | 17:47:26.469 UTC |
| Source entry permission | enabled | paused |
| Last reconciliation | 17:46:40.794 UTC | 17:47:21.419 UTC |
| Reconciliation age **at source generation** | 54 ms | **5,050 ms** |
| SOL/USD price age at source generation | 2,825 ms | 3,249 ms |
| Held positions / pending orders | 0 / 0 | 0 / 0 |
| Native / discovery / watch connected | true / true / true | true / true / true |
| HTTP timeout / error / throttle totals | 285 / 0 / 0 | 285 / 0 / 0 |
| Quality-gap / unavailable-audit / deadline-miss totals | 962 / 40 / 52 | 962 / 40 / 52 |
| Resource / required-evidence admission | healthy / allowed | healthy / allowed |

The user's timestamps describe **Render receipt**, roughly 24.5–24.8 seconds after these source snapshots were generated. Financial readiness is evaluated by the engine at the source decision time; a later dashboard receipt is not authorization to execute using older prices.

Because the account is flat in both snapshots, `marketAt` is exactly the SOL/USD observation timestamp in installed `pilot-reporting.ts`. Both prices remain valid under the unchanged 10-second price rule. There is no new public provider failure, active cooldown, financial obligation, source recovery, resource pressure or evidence refusal in this pair.

The 5,050 ms reconciliation age is independently sufficient to explain 9310's paused state: both the original financial projection and execution admission require reconciliation age at most 2,000 ms. The installed source runs flat financial maintenance only at least 5,000 ms apart, behind discretionary source work. **That cadence cannot continuously satisfy the existing freshness guard.** The guard correctly rejects stale reconciliation; scheduling must be repaired.

The 11 unique bracket snapshots, sequences 9304–9314, contain seven paused states. All seven have reconciliation ages above 2,000 ms; all 11 prices are younger than 10 seconds. Reconciliation counts generally increase three times per 15-second reporting period, consistent with the five-second flat schedule. There are no conflicting source snapshots among the preserved duplicate observations.

`status.entries` is **derived** from the financial projection and portfolio validity; it is not a direct export of `state.controls.entriesEnabled`. In the paused frame, the displayed blocker `explicit verified runtime readiness` is copied from `state.controls.reason`, a label set by successful resume. That text does not prove that a new durable pause occurred. Snapshot 9307's enabled result establishes that all effective entry guards passed then, but the exact later durable controls/daily-loss state and any pause/resume journal records were not directly read. Do not report a private ledger transition as verified from this public pair alone.

`snapshots.ndjson` freezes the 11 original public rows. `correlation.json` records their precise original file/line locations, hashes, source code pins, computed ages and all readiness/provider/resource fields. `analyze.py` verifies every archived input against the original recovery manifest before reproducing these artifacts. It reads only the frozen `../cloud-recovery-1756/` archive and immutable Git source `cdba9d4`.

This proves a reconciliation cadence mismatch. It does not prove that this pair suffered a sticky durable pause, missed a qualified opportunity, or lost market capture. The separate code path where actual technical pauses await candidate-triggered resume requires its own controlled verification and protected journal evidence where available.
