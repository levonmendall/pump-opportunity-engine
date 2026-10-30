# Existing WATCH filtering: measured attribution

No runtime change is justified by this inspection. The frozen c189 forward interval is untouched; no network request or financial write was performed.

Retained first-PAPER status (`6d894c1`, run `native-paper-20261028195247298`) reports 692,245 WATCH frames, 597 JSON parsing attempts, 590 unverified scheduling hints and 1,209.39 ms total WATCH callback elapsed time over 1,301.225 seconds. Total source CPU was 180,252.709 ms. The JSON-attempt fraction was 0.08624%; 691,648 frames avoided full JSON parsing. No legacy deep enrichment was active in this feed.

`PilotFeeds.observeWatchActivity` already uses a cached mint map and selective decoding. Identity lookup is O(1); UTF-8 conversion and regex scanning remain proportional to frame size. Replacing it with another pre-parser cannot credibly address the CPU stop on current evidence. Even eliminating the measured callback entirely would remove only 1.21 seconds of measured elapsed work, not the remaining whole-runtime demand.

This is **not a whole-feed CPU attribution**. Socket receipt/counters, initial Buffer conversion, WebSocket framing/UTF-8 validation, TLS and garbage collection are not isolated by `watchProcessingMs`. Per-message compression is disabled. The broad stream was intentionally not archived, so selected retained payloads cannot establish a representative full-feed profile. A future bounded whole-runtime CPU profile is the smallest measurement that can locate the remaining cost; this evidence does not prescribe a provider change.

Local filtering saves no already-received bytes. Actual broad receipt remained 1,071,650,829 bytes, about 1.82 MB per unverified hint. Removing the stream would change WATCH prioritization and requires separate coverage evidence. Those hints are never substitutes for complete executed flow or predictive qualification.

Reproduce against the retained private artifact (read-only):

```sh
python3 evidence/watch-cpu-efficiency-20261028/analyze.py /workspace/poe-pilot/migration-20261028/paper-first-readback/artifact/final-status.json
node --import tsx --test test/pilot-feeds.test.ts
```

The 27 existing feed regression tests pass; raw output is retained. Independent review verified the source/status hash and reproduced the arithmetic. The reviewer requested the explicit wall-time/CPU distinction and parsing-attempt terminology used above.
