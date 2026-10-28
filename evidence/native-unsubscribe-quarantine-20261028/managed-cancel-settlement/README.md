# Managed cancellation settlement correction

The retained9a trace records a managed unsubscribe timeout, a later queued boolean ACK and physical request settlement before the transport-close record. That chronology alone does not quantify the true socket-close instant, but it exposed an untested ordering in the adapter.

The isolated regression proves that current5df code finishes a cancelled managed request when an ACK queued before transport close reaches its handler. The existing PING helper already refuses that ordering. The correction retains the ACK owner and first error until the actual connection-close callback. Normal successful ACK handling is unchanged; no timeout, quote validity or strategy rule changes.

Bounded request-start/write-callback/abort/ACK-handler and conservative transport-receipt times are retained for future failures. Safe boolean ACK results are recorded; no raw payload or credential is added. These fields do not manufacture a wire timestamp.

VERIFIED OFFLINE: baseline test fails as expected; repaired test passes; nine pure-default control/cancellation/PING regressions and TypeScript build pass; independent review GO with five tests rerun. No network, account or active runtime was touched. This is separate from the optional dual-lane prototype and does not itself prevent peer gaps after a genuine control timeout.
