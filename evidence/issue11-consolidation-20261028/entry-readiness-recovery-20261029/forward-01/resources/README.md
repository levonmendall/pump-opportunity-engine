# Post-upgrade resources: sourcef96, original account

Actual read-only metadata receipts verify the owner-applied f96/acbe original-service upgrade, exact prior49,066action/49,067journal financial prefix, unchanged identity/inception/funding, zero verifier writes and no history reset or database restore. Stop/settlement/start timestamps preserve the real transition gap. See `post-start-validation.json` for the precise evidence boundary; this collector never opens private backup/financial files.

The first18:39receipt contains the new service/source but an old cdba publisher acknowledgment. It is intentionally not paired. The18:42and18:45receipts bind the same new supervisor2465804/native2465812/run native-paper-20261029183807362 and new-source Render acknowledgments; their197.136second interval is the first strict resource pair. No old/new cgroup or run counters are mixed.

Run `python3 -B analyze-resource-series.py` to reproduce all pairs from the retained JSON. Raw GitHub logs accompany each receipt. CPU/I/O counters cover the service cgroup; source RSS is separately measured. Host available memory, free disk and network include unrelated applications. Cgroup writes include all service evidence/accounting/backup/filesystem effects and do not separately attribute journal cost.

Initial valid pair:0.1506one CPUcore, zero throttling, approximately821,751writtenB/s and192,857readB/s; nativeRSS389.5→395.0MB, cgroupRAM455.0→500.7MB (peak540.3MB/3GiB). Market conditions differ from the old baseline, so this is not a causal efficiency claim.

Source reconciliation ages at observed source generation are729ms,4ms and231ms. The reported entry blocker remains POE_ENTRY_SAFE_STOP; it is not explained as stale reconciliation. No automatic hard-stop clearing, new trade, profitability, complete market coverage or24-hour operational acceptance is established by these resource samples.

## Frozen initial resource window

Four actual host receipts are retained through18:49:46.549UTC. Two strict new-run pairs span18:42:33.110–18:49:46.549 (433.439seconds); the earlier old-ACK pairing is excluded. Their weighted serviceCPU is0.1502onecore, writes average approximately785,106B/s, and throttled time remainszero. NativeRSS389.5→395.5MB; finalcgroupRAM514.9MB, peak567.7MB/3GiB. Observed source reconciliation ages are729/4/231/254ms, allwithin the unchanged2s guard; SAFE_STOP remains the explicit entryrestriction. `frozen-resource-series-4samples.json` and `frozen-resource-window-summary.json` preserve this initial measurement if later samples extend the rolling analysis.
