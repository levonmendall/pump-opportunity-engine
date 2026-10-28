/** Explicit finite candidate-only resource extension. No networking, finance or
 * default mutation. These ceilings are not provider entitlement or evidence of
 * two-hour/six-scope capacity. Callers must opt in and preserve physical gates. */
const MIB=1024*1024;
export const NATIVE_TWO_HOUR_RESEARCH_PROFILE=Object.freeze({
 version:'candidate-native-two-hour-research-v1' as const,
 mode:'candidate-evaluation' as const,financialExecutionAuthorized:false as const,
 durationMs:7200000,maximumDurationMs:7200000,shutdownReserveMs:10000,
 statusSnapshotArchive:Object.freeze({initialFullSnapshots:4,minimumLaterIntervalMs:3600000}),
 maximumDeep:6,maximumUnits:7500,maximumChapters:64,maximumBaselinePaths:192,maximumTotalBaselinePaths:256,
 maximumComponentBookBytes:512*1024,maximumBaselineBytes:32*MIB,maximumRpcMetadataBytes:2*MIB,
 relatedResponseBytes:2304*MIB,nativeSocketBytes:2048*MIB,nativeRecordedBytes:896*MIB,
 broadWatchBytes:8192*MIB,discoveryBytes:40*MIB,feedRecordedBytes:64*MIB,
 retainedEvidenceBytes:1024*MIB,evidenceSegmentBytes:8*MIB,
 maximumRssBytes:384*MIB,maximumCpuMicros:1920000000,
 startupDiskHeadroom:1344*MIB,additionalDiskReserveBytes:64*MIB,minimumDiskHeadroom:256*MIB,maximumDiscoveryQueue:256,
 physical:Object.freeze({startsPerMinute:60,startsPer10s:20,spacingMs:250,inFlight:1,getTransactionStartsPer10s:8}),
 dataValidity:Object.freeze({supportAgeMs:30000,heartbeatIntervalMs:10000,physicalTimeoutMs:1500,watchdogIntervalMs:100,completeWindowMs:60000,bucketMs:10000}),
 classification:'PROVISIONAL FINITE RESEARCH CEILINGS; NOT TWO-HOUR CAPACITY OR PROVIDER ENTITLEMENT' as const,
 infrastructureCost:'Existing compute and transfer allowance/cost unverified; zero API purchase is not zero total cost.' as const,
});
export type NativeResearchProfile=typeof NATIVE_TWO_HOUR_RESEARCH_PROFILE;
/** Undefined means existing defaults. No string, duration or slot count silently
 * selects a larger resource envelope. */
export function resolveNativeResearchProfile(value:unknown):NativeResearchProfile|null {
 if(value===undefined)return null;
 if(value!==NATIVE_TWO_HOUR_RESEARCH_PROFILE.version)throw Error('NATIVE_RESEARCH_UNKNOWN_PROFILE');
 return NATIVE_TWO_HOUR_RESEARCH_PROFILE;
}
/** Retained observations justify a finite experiment, not an operating promise.
 * Linear six-pool figures intentionally remain projections. The broad-stream
 * lower-bound interval includes setup and an explicitly closed observation tail. */
export const NATIVE_TWO_HOUR_PROFILE_BASIS=Object.freeze({
 native:Object.freeze({source:'evidence/high-activity-20261028/ec2-native-40619930479/analysis-summary.json',elapsedMs:85644,selectedPools:1,socketBytes:1302385,retainedEventBytes:1285604,cpuMicros:3661097,maximumRssBytes:133754880,
  limitations:'One active pool for85.644s, including setup/audit; no concurrent broad WATCH stream. Six-pool/two-hour linear scaling is not measured.'}),
 broad:Object.freeze({source:'evidence/dynamic-funnel-20261027/11-candidate-only-settled-analysis.json',elapsedMs:895303,socketBytes:919065591,candidateObservationClosedAfterMs:783377,
  limitations:'Broad receipt/full-run rate is a lower bound on active transport rate; setup and a111.926s candidate-closed tail are included. Different source/runtime/workload; not a matched native/broad capacity trial.'}),
 derivation:'The85.644s active one-pool measurement projects626.51MiB native receipt,618.44MiB retained events and1846.71CPU seconds under explicitly unverified six-pool/two-hour linear scaling. Native2048MiB and retained1024MiB provide finite traffic/evidence headroom; CPU1920seconds has only about4% headroom in that projection. Related2304MiB reserves256MiB above native receipt. Historical broad receipt/full-run timing projects about7.05GiB as a LOWER BOUND;8GiB is a stop ceiling, not a demonstrated2h requirement. Full source-status snapshots add separate evidence overhead, not included in the618.44MiB event projection. The two-hour profile archives the first4status snapshots, then at most hourly and the actual final; the replaceable status file still updates every15s. A bounded2,018,836-byte synthetic status projects at most7full archived records,14,131,852bytes, rather than973,078,952bytes for482records. These are storage projections, not measured live status sizes. Disk admission requires1GiB evidence+256MiB ongoing free-space low-water+64MiB separate reserve:64counterbooks×512KiB=32MiB,2metadata files×2MiB=4MiB,status/receipt/checkpoint/atomic-pending allowance24MiB,and logs4MiB. Irrelevant broad frames are not archived.',
 remainingEvidence:'Read the current900s six-scope host measurements and verify free disk/CPU/network headroom before execution. Busy traffic can hit a resource stop early; no automatic extension, paid overage or successful2h interval is implied.',
});
