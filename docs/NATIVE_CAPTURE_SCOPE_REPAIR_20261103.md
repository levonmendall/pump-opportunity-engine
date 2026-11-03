# Native capture and audit scope investigation

## Reproduced internal refusal and repair

The native source already validates transactions delivered through one selected
pool's subscription against the events of every currently supported selected
pool. It records an independently bound copy in the affected pool's ledger.
That copy correctly preserves the original delivery subscription and identifies
the observed target with `observedForMint` and validated program-frame evidence.

The immutable audit snapshot accepted these scoped copies, but the later
post-snapshot corroboration path required every packet to have been delivered
on the target subscription itself. A valid late cross-scope event therefore
failed with `NATIVE_AUDIT_TAIL_NOTIFICATION_GENERATION`. This was reproduced
offline using the retained audit-tail fixtures before the code change.

The source now attaches the target's exact mint, pool, ACK time, connection and
subscription when it creates a validated cross-scope event copy. The auditor
accepts that copy only when all five fields match its captured generation,
the distinct original delivery is identified, and the copy contains validated
trade or protocol-effect evidence. A bare mint label, an unbound nontrade,
failed transaction, old ACK, different connection or incomplete binding still
refuses. Direct-subscription checks remain intact. Actual receipt and availability
times, original target features, fences, deadlines, missing successful signatures
and the provider budget are unchanged. The added audit diagnostic preserves the
delivery and target bindings separately; it does not claim a second delivery.

## Current-host missing-history evidence

The inspected exports identify runtime commit
`356083fd8f0e69297c8470d4493077a175d2bad1` and run
`native-paper-20261103113905509`. The selected diagnostic exports were
`current-host-41650375330/sample-0.json` and
`current-host-41651677346/sample-0.json`. Both are bounded, filtered exports,
not a complete source-packet archive.

The first export contains one unusable audit with two missing successful
signatures in pool `2Yx74Z677vrMWJn4QNm9AQThbxQi1DSXRYSiFk4RSMmA`, both at
slot 464924586:

- `U6dxjsRF5jau3ExvRW4EawNE2Bj12yzH3R5vVFCgmQ4r5YGUfpbGi7enhPEjFBr4kiwggd8kFm7kwu8ycNeaSYZ`
- `567k7UY95XMNAjXBU9SoWEJXaP2VrYJ2D3YjR678bjZaszApdvXCYHgW1yP72PrzGxwm1MP5py4jm5T2h3fkspHH`

The history request covered 309 strict-interior rows. The immutable notification
snapshot contained 301 rows; ten actual post-snapshot packets corroborated none
of those missing signatures. Eight missing independently finalized failed
transactions were separate diagnostics and did not themselves invalidate the
executed-flow audit.

The later export contains six distinct missing successful signatures across
three pools, with the final signature repeated in two adjacent target windows:

| Pool | Slot | Missing successful signature |
| --- | ---: | --- |
| BYnsNqwwfCDcyXFYzz52cSSGFidCmL61QaxB5itEQAjb | 464927138 | 2jKYpyFRTnQMxiowEEWhbU4ZNAFu9Kcx6FXyFN1YSK4orK1WxgK1CaLN32CJuGA8QovpJpkn9i4kU8ZFc2QsRu47 |
| BYnsNqwwfCDcyXFYzz52cSSGFidCmL61QaxB5itEQAjb | 464927138 | 5ebw27WMS2q2FqW3Mpa7AkUi595XXPD4WD1Rp8zaxfM7epmiA9Vz2tSQyYuw7JWB7a8MvNA3zyLo7XjfEzwLHVyy |
| BYnsNqwwfCDcyXFYzz52cSSGFidCmL61QaxB5itEQAjb | 464927110 | 4sX62RboW9AoEwZzZt2iaA8kwn9Yrika3X3JZcPpfmpQzeXBgEYRFX8SCuaRNs8Nx57PABCemGyVJn1y4DDZaD6A |
| BYnsNqwwfCDcyXFYzz52cSSGFidCmL61QaxB5itEQAjb | 464927110 | 5jwf9CxeCS76rt9aN9RmdK5WPvjizFvABQ8v6hMTXDHV2a57ds6cRT7C7sixdzDsa9FkaxSnBAeDJfat2aspPUyo |
| 5v8F6FvFd5ovASijRHvveJVEWm4gw1a2NUR5XyGptPzN | 464927170 | 3f3TnZ7aDXv7AvFa1rRwKDyAqrvieosXehz8ShkaSDaRX6tDBRvGRyCzE2tZRTYyvBZmtutoojJ1QVcg8oHzznYu |
| HeY4J6q71ictDoezvdZezbf86hL2ChAHhaxuGgiGk2xR | 464927714 | jAz7HwaWv8MgbKjVsrhKbK6A9dFeNKA6mew7gpbsPrGg6NoFCu69zNMjitSE6HJryMojDekr5yFSi8yJ2H3CGne |

Every relevant result reports history-range coverage, and no captured/history
status disagreement. These records establish missing corroboration in the
audited source view. They do **not** establish whether the provider omitted a
packet or the application failed to retain it: the exact input packets and
complete disposition trail for those signatures are absent from the export.
They also do not establish that the cross-scope tail defect caused these
particular failures; that defect has its own offline reproduction.

Both exports carry the same bounded refusal file hash
`aed018bf3d67e1387f2d74be3cd0a039d7712447658d9402eb7cba11153baf54`.
Its records are earlier examples, including an expired support packet and a
default/noncanonical signature. Two other refusal reasons are exported only
as hashes. This file is explicitly not a census of the later audit window.

## Local support-admission investigation

The persistent V3.1 adapter directly binds
`ResearchClockPositionPricer.validateObservationMany`. Its admission and
common freshness checks throw outside the per-pool structural-decoding catch;
the source therefore does not turn those local admission failures into a
returned per-pool unsupported-state result. `PilotNativeFlow.service` already
preserves capture when the thrown error identifies admission closure, expired
dispatch, physical-slot occupation or coded cancellation. The supplied later export
contains a getMultipleAccounts caller-admission refusal with
`transportStarted:false`; this is not evidence of a pool-state invalidation.

No support-failure exemption was added. Structural unsupported pool results
still invalidate their own scope, and actual source expiry still invalidates
the old window at its original deadline. Successful persistent V3 packets
already omit supplementary raw examples and redundant empty validated-event
envelopes; required event bytes and notification identity remain retained.
