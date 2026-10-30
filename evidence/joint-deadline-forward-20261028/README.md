# Joined audit/deadline analysis for the coherent forward interval

This offline tool is prepared for the frozen `d7eab54` application interval. It
changes no runtime, route, provider allowance or account. Run it only after the
existing readback has verified the settled archive and extracted its allowlisted
metadata. It repeats every indexed file hash check.

```bash
python3 -B -I evidence/joint-deadline-forward-20261028/test_analyze.py
python3 -B -I evidence/joint-deadline-forward-20261028/analyze.py \
  --input /path/to/verified-artifact \
  --output /path/to/new-interval-analysis.json
```

The output path must be new. There is no RPC, credential, raw financial file or
live account access. A separate resource analyzer owns CPU/RSS/disk/traffic trend
analysis; this tool owns audit targets and their observed physical request path.

For each target it reports eligibility, original deadline, actual admitted pages,
request enqueue/start/settlement, HTTP/Undici stages, independent audit outcome,
predictive result and the linked expiration. Competing physical occupancy before
the first page is an observed overlap, not proof of exclusive causation. HTTP
requests are grouped by the endpoint actually retained in their lifecycle event.
Old sources lacking that field remain `not-recorded`; an assumed URL does not
become direct evidence.

Page attribution uses retained page-admission to physical-start events in source
file/line order. Recorder sequences restart per bounded file. Merely overlapping
session start/end times cannot assign a peer's request to a multipage audit.
Coalesced transitions or missing admission events remain explicit unknowns.

## Offline verification and historical control

Seven deterministic tests pass: interleaved multipage peers, Recorder sequence
reset, expiration as a subset of unavailable targets, missing page admission, and
indexed file modification, terminal clearing of uninvoked admissions, and indexed
source status/duplicate physical IDs. These test analysis mechanics, not trading capacity.

The existing verified c189 metadata reproduces 60 unique target windows:
38 predictive failures,20 unavailable audits,2 unusable audits;14 expirations are
a subset of the20 unavailable audits. It reproduces560 physical starts and23
timeouts.61 of62 audit physical pages link directly; one successful25XY target's
page admission was among4 omitted dispatch transitions. That target remains a
valid historical assessment, but exact physical-page attribution is unavailable.
The other unlinked history starts are not relabeled audits without evidence.

The first development attempt incorrectly assumed Recorder sequence numbers were
global and failed on the historical control. File/line ordering corrected that
analysis defect; it was not a runtime failure or a revised market outcome.

The current forward result is **not yet analyzed**. No throughput, protection,
profitability, market recall or sustained provider-capacity claim follows from
this prepared tool or its historical regression.
