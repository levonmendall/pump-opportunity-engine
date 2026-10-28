# PAPER observation-diagnostic readback repair

Offline-only change to the existing post-settlement result helper. Financial
checksum/ownership/settlement guards are unchanged. Additional explicitly
allowlisted metadata lets the lead distinguish candidate-local gaps, shared
control/HTTP incidents, query cooldown, provider backoff, dispatch contention,
audit result availability and actual decision deadline expiry. It does not
reclassify old failures or claim complete market evidence.

24 generated-fixture tests cover original financial privacy/reconciliation and
new nested metadata, exact feature ratios, HTTP phase distinction, physical job
purpose, cooldown domains, array bounds and fail-closed4MiB evidence pressure.
A separate offline projection of the retained source9a event files verifies
that actual595 physical starts/settlements,37 gap callbacks and complete audit
metadata survive this schema. This is not a new forward test. No financial
account, network, host process or credential was accessed by the developer.

Commands:

```bash
python3 -B operator/native-paper-ec2/test-readback-results.py
```

The lead must pin the final helper SHA256 in the existing administration workflow
before dispatch. Existing frozen source/runtime does not change.
