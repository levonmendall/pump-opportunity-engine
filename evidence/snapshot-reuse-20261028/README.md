# Same-call snapshot efficiency after sustained resource stop

The frozen d7eab54 run stopped at1088.218s because its cumulative source CPU reached180.243720s, crossing the existing180s candidate reserve. Its382,197,760B maximum source RSS and38,352,431B event accounting remained below their402,653,184B and99,614,720B candidate bounds. This is a self-imposed cumulative CPU stop, not demonstrated provider or host CPU saturation. Average source CPU was16.56% of one core; that is not host utilization. The raw source-indexed check and phase limits are in `live-resource-attribution.json`.

`PilotNativeFlow.snapshot` called `FlowWindow.features(at)` four times synchronously with the same explicit timestamp. The first result now supplies the returned feature object, warming flag and window boundaries. There is no cache across snapshots. Every later mutation, gap, correction, bucket boundary, source-freshness check and actual information timestamp retains its existing behavior. No RPC, strategy or financial rule changes.

The focused89-test native-flow suite, independent96-test native-flow/strategy suite, and TypeScript build passed. The new regression verifies unopened state, exactly one projection, a pending trade excluded from an earlier closed bucket, inclusion in the next bucket, and fresh invalidation after a gap. Snapshot calls start no provider operation.

The synthetic microbenchmark uses seven alternating paired rounds of3000 iterations per scenario. Its synthetic buyer/trade counts approximate the retained audited sample's quiet, p95 and maximum feature projections; the3000-trade/1500-buyer case is stress-only. That retained sample excludes unavailable and unassessed windows. The benchmark times only repeated feature projections plus equal small result objects, **not full snapshots or runtime**.

| Synthetic case | Median CPU before / after,3000 iterations | Projection CPU reduction |
| --- | ---: | ---: |
| Quiet |6709 /1843µs |72.5% |
|260trades /48buyers |18990 /5140µs |72.9% |
|513trades /199buyers |34989 /8382µs |76.0% |
| Stress-only3000trades /1500buyers |119583 /28491µs |76.2% |

Absolute savings in the observed-like cases were approximately1.6–8.9µs per projection. This small equivalent correction does **not** establish a material whole-process gain or repair the180CPU-second operating envelope. Candidate shared-step phase CPU was78.033s, but it includes concurrent callbacks while awaiting work; it cannot be assigned exclusively to feature calculation. A main-thread CPU profile and a new source-versioned forward interval are needed before attributing the remaining cost or claiming sustained capacity.

Reproduce offline from the repository root:

```sh
node --import tsx --test test/pilot-native-flow.test.ts test/strategy.test.ts
npm run build
node --import tsx evidence/snapshot-reuse-20261028/benchmark.ts /tmp/snapshot-reuse-benchmark.json
```

The historical run and financial history remain unchanged. No network, account, ledger, deployment, provider or runtime operation was performed by this repair or benchmark.
