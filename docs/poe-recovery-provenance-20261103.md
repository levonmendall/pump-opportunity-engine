# POE recovery after the authorized PAPER close

## Established operating defect

The exact H2 package (`c92a2b95b1c175bf67b65cbe072c9e5f5080303d`) was installed and its source, configuration, financial prefix, original account and registry continuity were verified. The deployment admission marker was subsequently released. POE remained flat and reconciled but could not begin normal technical-protection recovery.

The read-only administrator capture [41720510364](https://github.com/levonmendall/meme-machine-admin/actions/runs/41720510364), produced at 2026-11-03T21:19:11.351Z, retained the complete post-resume control chain: eight pause records, no safe stops, no denied resumes, no omitted rows. Its original diagnostic SHA-256 is `a420aa2c53d9347ad59f2b9427c91b55bdf5b1721e31f9974e5ac8c6b96c0a96`. The SQL read took 7.954 ms and made no content writes or recovery calls.

The last successful resume was revision 347894. An ordinary technical pause followed at 347982. During the requested PAPER sale, the authorized close helper preserved that existing pause at revision 348004 under `manual-hard:788f82d8b8a774f9d479574c8c1313ce7f5474faf1ed0c19866eb6c11ade77de`. The action ID is derived exactly from the authenticated close order and preceding revision 348003. The sealed sale receipt, helper source and bundle all agree. Later runtime startups retained the same technical reason.

H2's recovery code recognizes ordinary trader pauses, trader restorations and execution startup records. It does not recognize the close helper's preservation identity, so the authority loop rejects that record as `TECHNICAL_PROTECTION_OWNER_OR_UNKNOWN_CONTROL`. The outer readiness diagnostic had hidden this distinction behind `OPERATING_READINESS_OWNER_OR_HARD_CONTROL`.

The complete ledger implementation is identical between predecessor `356083fd8f0e69297c8470d4493077a175d2bad1` and H2. The retained successful resume contains a valid prior technical-recovery proof. Independent offsite checks validated that original resume and the eight original control records. The diagnostic itself does not invoke runtime authority or re-export every prerequisite of older fixed historical repair validators.

## Repairs in this source

- Recognize only the reviewed preservation record, bound to the exact original account, full epoch, resume anchor, active technical origin, immediate startup, action identity, timestamps and original payload/result hashes. Every other manual, owner, unknown and safe-stop control retains its existing refusal behavior.
- Check each historical restoration against its preceding authenticated pause across startup markers. A later technical reason cannot invalidate an earlier legitimate restoration, and matching the final reason cannot authenticate a historically mismatched restoration.
- Report the actual technical-control refusal already computed by readiness, retaining its original observation time and revision. Publication performs no additional ledger traversal.
- Preserve request-timing reporting when the flat persistent service has an unbounded protection cutoff outside the JavaScript Date range. Only that optional diagnostic becomes null. Original raw scheduling evidence, actual caller/certificate deadlines, negative remaining time, local-refusal classification and physical-request counts remain unchanged.

The reviewed preservation recognizer performs no I/O and grants no financial permission. Normal recovery still requires new, original-timestamp financial/source evidence over the existing 60-second interval, with the unchanged protection and reconciliation boundaries. No ledger row, epoch, capital, obligation, trade or lifetime history is rewritten. Entry/exit economics, sizing, four-slot capacity, strategy, providers and PAPER execution remain unchanged.

## Validation and release boundary

Regression tests first reproduced the live provenance classification, historical restoration mismatch, incorrect acceptance of a different restored reason, and loss of timing diagnostics. Focused tests also retain owner/unknown/stop barriers, require the exact epoch and original evidence, and exercise the existing 60-second held and flat recovery paths. The release workflow runs all application/reporting tests, the retained-registry publication benchmark and the isolated immutable PAPER package smoke checks away from EC2.

The successor must be built from an exact clean source commit, preserve measured configuration `f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28`, and use the existing administrator deployment safeguards against the actual H2 predecessor. Source and financial-continuity verification precede sustained operating acceptance. Passing these tests, recognizing the historical record, or merely running the service is not operating acceptance. No forced entry is part of verification.
