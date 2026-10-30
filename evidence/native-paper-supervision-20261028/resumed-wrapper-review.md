# Resumed bounded supervisor review

Reviewed against core83652f68231274142276dec5ed16b219dc931e05. This is an
independent review of the parent's runtime work and an offline verification of
the supervisor prepared by the prior worker. No provider, Render, EC2 account
or financial database access occurred in this review.

Result: suitable for one bounded isolated experiment after the parent completes
exact package/account import and single-writer fencing. It is not continuous
operational acceptance.

- Exact source/account/inception/configuration/PID and source age are checked.
- Unknown state never becomes flat. A financial writer must settle physically
  before a management-only successor; publisher health cannot delay that
  transition or fabricate a financial close.
- Synthetic CPU telemetry over real disposable child processes now verifies
  the220s graceful stop, retained exposure, settled first writer, same independent
  publisher and management-only successor. No actual CPU load was generated.
- Reporting startup55s and ongoing90s source-ACK loss suspend new risk through a
  private append-only marker. Accepted timestamps cannot freshen older source.
- Added bounded exact accepted-source witness: first two matched raw payloads
  and latest two with actual ACKs and hashes. Missing payloads and local capture
  pressure are explicit; no source information is reconstructed.
- All16 focused Python tests pass, including cancellation, real child reaping,
  source provenance, reporting recovery, unknown financial state and witness
  rotation/failure cases.

Core83652f6 review found no blocking defect in owned-state startup priority,
management-only operation, actual protection callback timestamps,64chapter/
16chapter/52MiB reserve or160s/180s processing cutoffs. The quote-age2s and
source-age30s contracts and existing strategy remain intact.

Remaining limits: two finite segments cannot establish unattended24h operation;
unknown/nonflat state at the final ceiling is an explicit monitoring interruption
requiring same-ledger management. Resource reserve is not proof of provider
reliability, live exit timing or natural PAPER execution. A future package/code
change must be separately hash-pinned before dispatch. Supervisor helper file
read bound is48KiB to accommodate the witness (not a provider/resource increase).
