import { createRequire as __poeCreateRequire } from "node:module"; const require = __poeCreateRequire(import.meta.url);

// src/snapshot-publisher.ts
import { constants, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash as createHash2 } from "node:crypto";

// src/reporting.ts
import { createHash } from "node:crypto";

// src/financial-policy-reporting.ts
var FINANCIAL_POLICY_REPORTING_VERSION = "poe-paper-financial-policy-v1";
var EQUITY_RISK_REPORTING_VERSION = "paper-equity-risk-5-10-v1";
var EQUITY_RISK_REASON_CODES = ["EQUITY_RISK_INITIALIZING", "EQUITY_RISK_HISTORY_UNAVAILABLE", "EQUITY_RISK_VALUATION_UNAVAILABLE", "EQUITY_RISK_RECONCILIATION_STALE", "EQUITY_RISK_DAILY_DRAWDOWN", "EQUITY_RISK_POLICY_INVALID"];
var INCEPTION = Date.parse("2026-10-26T22:07:36.212Z");
var MAX = (1n << 127n) - 1n;
var record = (v) => !!v && typeof v === "object" && !Array.isArray(v) ? v : {};
function need(v) {
  if (!v) throw Error("FINANCIAL_POLICY_REPORTING_INVALID");
}
function exact(v, keys) {
  const r = record(v);
  need(Object.keys(r).sort().join(" ") === keys.split(" ").sort().join(" "));
  return r;
}
function amount(v, nullable2 = false) {
  if (nullable2 && v === null) return;
  need(typeof v === "string" && /^(0|[1-9]\d{0,38})$/.test(v) && BigInt(v) <= MAX);
}
function count(v, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= maximum);
}
function time(v, generated, nullable2 = false) {
  if (nullable2 && v === null) return;
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  need(Number.isSafeInteger(n) && n >= INCEPTION && n <= generated && new Date(n).toISOString() === v);
}
function solAmount(v, nullable2 = false) {
  if (nullable2 && v === null) return;
  need(typeof v === "string" && /^(0|[1-9]\d{0,29})\.\d{9}$/.test(v));
  const [whole, part] = v.split(".");
  need(BigInt(whole) * 1000000000n + BigInt(part) <= MAX);
}
function validateFinancialRiskReporting(value, generated) {
  const r = exact(value, "version state reasonCode asOf entry daily");
  need(r.version === EQUITY_RISK_REPORTING_VERSION && ["ready", "unavailable"].includes(r.state));
  time(r.asOf, generated);
  need(r.reasonCode === null || EQUITY_RISK_REASON_CODES.includes(r.reasonCode));
  const e = exact(r.entry, "targetBps targetConsumedCostMicroUsd targetConsumedCostSol unreservedCashSol cashLimitedConsumedCostSol refundableDepositsIncluded executabilityClaimed");
  need(e.targetBps === 500 && e.refundableDepositsIncluded === false && e.executabilityClaimed === false);
  amount(e.targetConsumedCostMicroUsd, true);
  solAmount(e.targetConsumedCostSol, true);
  solAmount(e.unreservedCashSol);
  solAmount(e.cashLimitedConsumedCostSol, true);
  const d = exact(r.daily, "day limitBps highWaterMicroUsd highWaterAt currentEquityMicroUsd drawdownMicroUsd drawdownBps remainingBeforePauseMicroUsd lossPaused historyCoverage basis");
  need(typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && Number.isFinite(Date.parse(d.day + "T00:00:00.000Z")) && (/* @__PURE__ */ new Date(d.day + "T00:00:00.000Z")).toISOString().slice(0, 10) === d.day && d.day >= "2026-10-26" && d.day <= String(r.asOf).slice(0, 10) && d.limitBps === 1e3 && typeof d.lossPaused === "boolean" && ["verified-retained-same-day", "first-complete-observation", "unavailable"].includes(d.historyCoverage) && d.basis === "complete-observed-executable-equity-current-usd");
  for (const key of ["highWaterMicroUsd", "currentEquityMicroUsd", "drawdownMicroUsd", "remainingBeforePauseMicroUsd"]) amount(d[key], true);
  time(d.highWaterAt, Date.parse(r.asOf), true);
  need(d.highWaterMicroUsd === null === (d.highWaterAt === null));
  if (d.highWaterAt !== null) need(d.highWaterAt.slice(0, 10) === d.day);
  if (d.drawdownBps !== null) count(d.drawdownBps, 1e4);
  if (r.state === "ready") need(d.day === r.asOf.slice(0, 10) && e.targetConsumedCostMicroUsd !== null && e.targetConsumedCostSol !== null && e.cashLimitedConsumedCostSol !== null && d.highWaterMicroUsd !== null && d.currentEquityMicroUsd !== null && d.drawdownMicroUsd !== null && d.drawdownBps !== null && d.remainingBeforePauseMicroUsd !== null && d.historyCoverage !== "unavailable" && (r.reasonCode === null || r.reasonCode === "EQUITY_RISK_DAILY_DRAWDOWN"));
  else need(r.reasonCode !== null);
  if (e.cashLimitedConsumedCostSol !== null && e.targetConsumedCostSol !== null) {
    const cash = BigInt(e.cashLimitedConsumedCostSol.replace(".", ""));
    need(cash <= BigInt(e.targetConsumedCostSol.replace(".", "")) && cash <= BigInt(e.unreservedCashSol.replace(".", "")));
  }
  if (e.targetConsumedCostMicroUsd !== null && d.currentEquityMicroUsd !== null) need(BigInt(e.targetConsumedCostMicroUsd) === BigInt(d.currentEquityMicroUsd) * 500n / 10000n);
  if (d.highWaterMicroUsd !== null && d.currentEquityMicroUsd !== null && d.drawdownMicroUsd !== null && d.drawdownBps !== null && d.remainingBeforePauseMicroUsd !== null) {
    const h = BigInt(d.highWaterMicroUsd), c = BigInt(d.currentEquityMicroUsd), dd = h > c ? h - c : 0n, limit = h * 1000n / 10000n, remaining = limit > dd ? limit - dd : 0n;
    need(BigInt(d.drawdownMicroUsd) === dd && d.drawdownBps === (h === 0n ? 0 : Number(dd * 10000n / h)) && BigInt(d.remainingBeforePauseMicroUsd) === remaining);
    if (h > 0n && dd * 10000n >= h * 1000n) need(d.lossPaused === true);
  }
  if (r.state === "ready") need(d.lossPaused ? r.reasonCode === "EQUITY_RISK_DAILY_DRAWDOWN" : r.reasonCode === null);
  return r;
}
function validateFinancialPolicyReporting(value, generated) {
  const p = exact(value, "version risk execution valuation");
  need(p.version === FINANCIAL_POLICY_REPORTING_VERSION);
  if (p.risk !== null) validateFinancialRiskReporting(p.risk, generated);
  if (p.execution !== null) validateFinancialExecutionReporting(p.execution, generated);
  if (p.valuation !== null) validateFinancialValuationReporting(p.valuation, generated);
  need(JSON.stringify(p).length <= 8192);
  return p;
}
var FINANCIAL_EXECUTION_REPORTING_VERSION = "paper-chain-conditioned-v1";
var FINANCIAL_EXECUTION_STAGES = ["planned", "landing-state-supported", "preflight-unsubmitted", "legacy-protection-fallback"];
var FINANCIAL_EXECUTION_REASONS = ["PLAN_PREPARED", "LANDING_STATE_SUPPORTED", "LANDING_STATE_UNAVAILABLE", "UNSIGNED_CONSTRUCTION_UNAVAILABLE", "SIMULATED_ACCOUNT_RENT_UNAVAILABLE", "LEGACY_HELD_ACCOUNT_MODEL", "PLAN_CONSTRUCTION_UNAVAILABLE", "PLAN_DELAY_EXCEEDS_DECISION_LIFETIME", "PLAN_FEE_MISMATCH"];
function validateFinancialExecutionReporting(value, generated) {
  const e = exact(value, "version state scope plans supportedLandingStates preflightUnsubmitted unknownLanding legacyProtectionFallbacks last meaning");
  need(e.version === FINANCIAL_EXECUTION_REPORTING_VERSION && ["active", "unavailable"].includes(e.state) && e.scope === "current-market-instance" && e.meaning === "PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME");
  for (const key of ["plans", "supportedLandingStates", "preflightUnsubmitted", "unknownLanding", "legacyProtectionFallbacks"]) count(e[key]);
  if (e.last !== null) {
    const l = exact(e.last, "at stage reasonCode observedRpcMs modeledDelayMs feeSol sourceSlot");
    time(l.at, generated);
    need(FINANCIAL_EXECUTION_STAGES.includes(l.stage) && FINANCIAL_EXECUTION_REASONS.includes(l.reasonCode));
    const pairs = { planned: ["PLAN_PREPARED"], "landing-state-supported": ["LANDING_STATE_SUPPORTED"], "preflight-unsubmitted": ["LANDING_STATE_UNAVAILABLE", "PLAN_CONSTRUCTION_UNAVAILABLE", "PLAN_DELAY_EXCEEDS_DECISION_LIFETIME", "PLAN_FEE_MISMATCH"], "legacy-protection-fallback": ["UNSIGNED_CONSTRUCTION_UNAVAILABLE", "SIMULATED_ACCOUNT_RENT_UNAVAILABLE", "LEGACY_HELD_ACCOUNT_MODEL"] };
    need(pairs[l.stage].includes(l.reasonCode));
    for (const key of ["observedRpcMs", "modeledDelayMs"]) if (l[key] !== null) need(typeof l[key] === "number" && Number.isFinite(l[key]) && l[key] >= 0 && l[key] <= 864e5);
    if (l.sourceSlot !== null) count(l.sourceSlot);
    solAmount(l.feeSol, true);
  }
  return e;
}
var FINANCIAL_VALUATION_REPORTING_VERSION = "paper-sol-usd-observation-v1";
var FINANCIAL_VALUATION_REASONS = ["USD_PRICE_RECEIVED", "USD_PRICE_HTTP_STATUS", "USD_PRICE_TIMEOUT", "USD_PRICE_TRANSPORT", "USD_PRICE_RESPONSE_TOO_LARGE", "USD_PRICE_EMPTY", "USD_PRICE_INVALID", "USD_PRICE_NONPOSITIVE"];
function validateFinancialValuationReporting(value, generated) {
  const u = exact(value, "version scope failuresByReason lastObservation");
  need(u.version === FINANCIAL_VALUATION_REPORTING_VERSION && u.scope === "current-source-instance");
  const counts = record(u.failuresByReason);
  need(u.failuresByReason && typeof u.failuresByReason === "object" && !Array.isArray(u.failuresByReason));
  for (const [code, n] of Object.entries(counts)) {
    need(code !== "USD_PRICE_RECEIVED" && FINANCIAL_VALUATION_REASONS.includes(code));
    count(n);
  }
  if (u.lastObservation !== null) {
    const l = exact(u.lastObservation, "source startedAt completedAt durationMs outcome reasonCode httpStatus receivedAt publicationTimeKnown");
    time(l.startedAt, generated);
    time(l.completedAt, generated);
    time(l.receivedAt, generated, true);
    need(l.startedAt <= l.completedAt && l.source === "coinbase-public-sol-usd" && l.publicationTimeKnown === false && ["received", "unavailable"].includes(l.outcome) && FINANCIAL_VALUATION_REASONS.includes(l.reasonCode));
    need(typeof l.durationMs === "number" && Number.isFinite(l.durationMs) && l.durationMs >= 0 && l.durationMs <= 864e5);
    if (l.httpStatus !== null) {
      count(l.httpStatus, 599);
      need(l.httpStatus >= 100);
    }
    need(l.outcome === "received" ? l.reasonCode === "USD_PRICE_RECEIVED" && l.receivedAt !== null && l.receivedAt >= l.startedAt && l.receivedAt <= l.completedAt : l.reasonCode !== "USD_PRICE_RECEIVED" && l.receivedAt === null);
  }
  return u;
}

// src/native-candidate-diagnostics.ts
var NATIVE_CANDIDATE_FAILURE_CODES = [
  "AUDIT_COMPLETED_AFTER_DECISION_BUCKET",
  "COMPONENT_RPC_-32005",
  "COMPONENT_RPC_OVERLOAD",
  "COMPONENT_WS_RPC_ERROR",
  "COMPONENT_WS_TRANSPORT",
  "DECISION_DEADLINE_EXPIRED",
  "NATIVE_AUDIT_ADMISSION_CLOSED",
  "NATIVE_AUDIT_BATCH_BINDING",
  "NATIVE_AUDIT_BATCH_ITEM",
  "NATIVE_AUDIT_BATCH_RECEIPT",
  "NATIVE_AUDIT_CANDIDATE_RETIRED",
  "NATIVE_AUDIT_CAPTURED_CORRECTION",
  "NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY",
  "NATIVE_AUDIT_CLOCK_REGRESSION",
  "NATIVE_AUDIT_CONFIRMED_STATUS_DISAGREEMENT",
  "NATIVE_AUDIT_CONTEXT_FENCE_INVALID_OR_STALE",
  "NATIVE_AUDIT_DIAGNOSTIC_BOUND",
  "NATIVE_AUDIT_ELAPSED_LIMIT",
  "NATIVE_AUDIT_HISTORY_CONTEXT",
  "NATIVE_AUDIT_HISTORY_PAGE_PAYLOAD_LIMIT",
  "NATIVE_AUDIT_HISTORY_PAGE_SCHEMA",
  "NATIVE_AUDIT_HISTORY_RANGE_NOT_COVERED",
  "NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED",
  "NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN",
  "NATIVE_AUDIT_INVALID_OPTIONS",
  "NATIVE_AUDIT_INVALID_TARGET",
  "NATIVE_AUDIT_LOWER_CONTEXT_CLOCK_INVALID",
  "NATIVE_AUDIT_NOTIFICATION_BOUND",
  "NATIVE_AUDIT_NOTIFICATION_SCHEMA",
  "NATIVE_AUDIT_NOT_COMPLETED",
  "NATIVE_AUDIT_OWNED_ENTRY_RESOLVED",
  "NATIVE_AUDIT_PAGE_OPERATION_BOUND",
  "NATIVE_AUDIT_POST_SNAPSHOT_CORRECTION",
  "NATIVE_AUDIT_POST_WINDOW_SLOT_FENCE_UNAVAILABLE",
  "NATIVE_AUDIT_PRE_WINDOW_SLOT_FENCE_UNAVAILABLE",
  "NATIVE_AUDIT_SESSION_ABORTED",
  "NATIVE_AUDIT_SESSION_CANCELLED",
  "NATIVE_AUDIT_SESSION_CLOCK",
  "NATIVE_AUDIT_SESSION_DEADLINE",
  "NATIVE_AUDIT_SESSION_DEADLINE_OR_GENERATION",
  "NATIVE_AUDIT_SESSION_INPUT_BOUND",
  "NATIVE_AUDIT_SESSION_PAGE_BOUND",
  "NATIVE_AUDIT_SESSION_PAGE_LIMIT",
  "NATIVE_AUDIT_SESSION_UNAVAILABLE",
  "NATIVE_AUDIT_SOURCE_GENERATION_CHANGED",
  "NATIVE_AUDIT_TAIL_ADMISSION_CLOSED",
  "NATIVE_AUDIT_TAIL_GENERATION",
  "NATIVE_AUDIT_TAIL_NOTIFICATION_BOUND",
  "NATIVE_AUDIT_TAIL_NOTIFICATION_GENERATION",
  "NATIVE_AUDIT_TAIL_NOTIFICATION_SCHEMA",
  "NATIVE_AUDIT_TAIL_OPTIONS",
  "NATIVE_AUDIT_TARGET_SLOT_BOUNDARY_AMBIGUOUS",
  "NATIVE_AUDIT_UNAVAILABLE",
  "NATIVE_AUDIT_UNUSABLE_TARGET_INFORMATION",
  "NATIVE_FLOW_ACK_INVALID",
  "NATIVE_FLOW_CALLBACK_PROCESSING_OVERRUN",
  "NATIVE_FLOW_CANDIDATE_CAPACITY",
  "NATIVE_FLOW_CANDIDATE_RETIRED",
  "NATIVE_FLOW_CANONICAL_SCOPE",
  "NATIVE_FLOW_CLOSED",
  "NATIVE_FLOW_CONFIRMED_CORRECTION",
  "NATIVE_FLOW_CONTROL_CALLBACK_FAILED",
  "NATIVE_FLOW_CONTROL_CANCELLED",
  "NATIVE_FLOW_CONTROL_DIAGNOSTIC_FAILED",
  "NATIVE_FLOW_CONTROL_GUARD_UNAVAILABLE",
  "NATIVE_FLOW_CONTROL_RECORDING_FAILED",
  "NATIVE_FLOW_CROSS_SCOPE_UNAVAILABLE",
  "NATIVE_FLOW_DATA_CONTRACT",
  "NATIVE_FLOW_DISCONNECTED",
  "NATIVE_FLOW_DURATION_LIMIT",
  "NATIVE_FLOW_EVENT_CORRECTION",
  "NATIVE_FLOW_FUTURE_SNAPSHOT",
  "NATIVE_FLOW_GAP_CALLBACK_FAILED",
  "NATIVE_FLOW_INDEPENDENT_AUDIT_GAP",
  "NATIVE_FLOW_INFORMATION_CUTOFF",
  "NATIVE_FLOW_INVALID_LIMITS",
  "NATIVE_FLOW_INVALID_PERSISTENCE",
  "NATIVE_FLOW_MEMORY_PRESSURE",
  "NATIVE_FLOW_NOTIFICATION_LEDGER_LIMIT",
  "NATIVE_FLOW_NOTIFICATION_SCHEMA",
  "NATIVE_FLOW_OPEN_CANCELLED",
  "NATIVE_FLOW_PHYSICAL_SETTLEMENT_UNVERIFIED",
  "NATIVE_FLOW_PAYLOAD_OR_TIME_LIMIT",
  "NATIVE_FLOW_PEER_CONTROL_LIMIT",
  "NATIVE_FLOW_PEER_PONG_DEADLINE",
  "NATIVE_FLOW_PROCESSING_DEADLINE",
  "NATIVE_FLOW_PROTOCOL_EFFECT_CAPACITY",
  "NATIVE_FLOW_PROTOCOL_EFFECT_CORRECTION",
  "NATIVE_FLOW_PROTOCOL_MARKER_CAPACITY",
  "NATIVE_FLOW_REBOUND_GENERATION_AMBIGUOUS",
  "NATIVE_FLOW_REBOUND_SUPPORT_BEFORE_RETIREMENT",
  "NATIVE_FLOW_RECEIPT_LIMIT",
  "NATIVE_FLOW_RESOURCE_LIMIT",
  "NATIVE_FLOW_RETENTION_LIMIT",
  "NATIVE_FLOW_RETIRED_SUBSCRIPTION_LIMIT",
  "NATIVE_FLOW_ROUND_TRIP_CONNECTION",
  "NATIVE_FLOW_ROUND_TRIP_RECEIPT",
  "NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE",
  "NATIVE_FLOW_RPC_ENVELOPE",
  "NATIVE_FLOW_SCOPE_CONFLICT",
  "NATIVE_FLOW_SCOPE_NOT_USABLE",
  "NATIVE_FLOW_SIGNATURE",
  "NATIVE_FLOW_SOCKET_COUNTER",
  "NATIVE_FLOW_STOPPED",
  "NATIVE_FLOW_SUBSCRIPTION_ACK",
  "NATIVE_FLOW_SUBSCRIPTION_ID_REUSED",
  "NATIVE_FLOW_SUPPORT_EXPIRED",
  "NATIVE_FLOW_SUPPORT_EXPIRED_DURING_ACK",
  "NATIVE_FLOW_SUPPORT_UNAVAILABLE",
  "NATIVE_FLOW_TRANSPORT_CLOSED",
  "NATIVE_FLOW_TRANSPORT_SETTLING",
  "NATIVE_FLOW_UNAVAILABLE",
  "NATIVE_FLOW_UNEXPECTED_ACK",
  "NATIVE_FLOW_UNSCHEDULED_CONTROL_SUPPRESSED",
  "NATIVE_FLOW_UNSCOPED_NOTIFICATION",
  "NATIVE_FLOW_UNSUBSCRIBE_ACK",
  "NATIVE_FLOW_VALIDATED_ADMISSION_CLOSED",
  "NATIVE_SOURCE_FINANCIAL_RUNWAY",
  "OTHER_UNEXPORTED_REASON",
  "PILOT_RPC_ABORTED",
  "PILOT_RPC_COMPONENT_ABORTED",
  "PILOT_RPC_COMPONENT_ADMISSION_CLOSED",
  "PILOT_RPC_COMPONENT_DISPATCH_EXPIRED",
  "PILOT_RPC_COMPONENT_HTTP_429",
  "PILOT_RPC_COMPONENT_HTTP_STATUS_502",
  "PILOT_RPC_COMPONENT_HTTP_STATUS_503",
  "PILOT_RPC_COMPONENT_HTTP_STATUS_504",
  "PILOT_RPC_COMPONENT_HTTP_TRANSPORT",
  "PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT",
  "PILOT_RPC_COMPONENT_RPC_ERROR_-32016",
  "PILOT_RPC_COMPONENT_RPC_OVERLOAD",
  "PILOT_RPC_COOLDOWN",
  "PILOT_RPC_PHYSICAL_SLOT_OCCUPIED",
  "PILOT_RPC_QUERY_COOLDOWN",
  "RESEARCH_CLOCK_ADMISSION_CLOSED",
  "RESEARCH_CLOCK_POOL_UNAVAILABLE",
  "RPC_NODE_ERROR"
];
var NATIVE_CANDIDATE_FAILURE_KINDS = ["quality-gap", "audit-unavailable", "audit-unusable", "predictive-unavailable", "decision-expired"];
var NATIVE_AUDIT_DISPATCH_REASONS = ["eligible", "native-service-wait", "native-service-dispatch", "native-service-return", "rpc-gate-wait", "ceiling-backoff", "ceiling-refresh", "prepare-native-runway", "scheduler-wait", "scheduler-refusal", "audit-selected", "peer-selected", "page-admission", "page-response", "page-refusal", "page-deferred", "page-not-exposed", "work-exception"];
var NATIVE_AUDIT_DISPATCH_ACTIONS = ["await-financial-operation-runway", "await-shared-dispatch", "await-selected-peer-audit-page", "await-physical-settlement", "await-shared-gate-recovery", "await-shared-pacing", "await-shared-pacing-or-http-cooldown", "await-history-provider-or-query-cooldown", "await-local-uninvoked-page-retry", "await-primary-support-ceiling", "await-bounded-ceiling-refresh", "refresh-confirmed-bank-ceiling", "await-control-runway-gate", "await-native-service-action", "request-early-support-refresh", "request-early-heartbeat", "perform-required-native-service", "retain-uninvoked-page-for-shared-scheduling", "advance-logical-session", "invoke-shared-rpc", "validate-logical-session", "retain-unavailable-target", "invoke-shared-quiet-batch", "dispatch-audit-page", "dispatch-origin-verification", "retain-refused-target", "await-next-dispatch", "retain-and-recheck-target", "recheck-after-backoff", "recheck-after-busy", "recheck-after-close", "recheck-after-closed", "recheck-after-connect", "recheck-after-deferred", "recheck-after-idle", "recheck-after-ping", "recheck-after-pong", "recheck-after-subscribe", "recheck-after-support", "recheck-after-unavailable", "recheck-after-unsubscribe"];
var NATIVE_AUDIT_SCHEDULER_REASONS = ["physical-operation-or-cancellation-unsettled", "completion-deadline-expired", "shared-physical-pacing", "declared-completion-envelope-exceeds-deadline", "one-other-start-per-protection-cycle", "outside-bounded-admission-window"];
var NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS = Object.freeze({ version: "bounded-native-candidate-failures-v1", scope: "CURRENT_RUNNER_INSTANCE", maximumRecentFacts: 8, meaning: "Actual outcome observations and last local dispatch state, not independent windows, physical-start proof, provider causation or financial qualification. Earlier-instance causes remain unknown." });
var codes = new Set(NATIVE_CANDIDATE_FAILURE_CODES);
var kinds = new Set(NATIVE_CANDIDATE_FAILURE_KINDS);
var dispatches = new Set(NATIVE_AUDIT_DISPATCH_REASONS);
var actions = new Set(NATIVE_AUDIT_DISPATCH_ACTIONS);
var scheduler = new Set(NATIVE_AUDIT_SCHEDULER_REASONS);

// src/operating-intelligence.ts
var candidateFailureCodes = new Set(NATIVE_CANDIDATE_FAILURE_CODES);
var ORIGINAL_POE_ACCOUNT = "poe-3123e352-4581-455b-85db-acd7e825e99e";
var ORIGINAL_POE_INCEPTION = "2026-10-26T22:07:36.212Z";
var OPERATING_INTELLIGENCE_VERSION = "poe-operating-intelligence-v1";
var EVIDENCE_PRESSURE_CODES = ["FILESYSTEM_RESERVE", "RECORD_BOUND", "YOUNG_DIAGNOSTIC_CAPACITY", "YOUNG_SEGMENT_CAPACITY", "DIAGNOSTIC_HEADROOM", "DIAGNOSTIC_SEGMENT_HEADROOM", "INTERRUPTED_ESSENTIAL_PROOF", "CHECKPOINT_UNAVAILABLE", "RECORD_IO_OR_INTEGRITY_FAILURE", "FILESYSTEM_UNAVAILABLE", "RETENTION_IO_OR_INTEGRITY_FAILURE", "RECOVERY_CHECKPOINT_UNAVAILABLE", "OTHER_UNEXPORTED_REASON"];
var RECOVERY_REASON_CODES = ["ROLLING_RESOURCE_OR_EVIDENCE_PRESSURE", "CANDIDATE_PROVIDER_FAILURE", "CANDIDATE_STEP_UNAVAILABLE", "OTHER_UNEXPORTED_REASON"];
var rec = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var count2 = (v) => Number.isSafeInteger(v) && v >= 0 ? v : null;
var finite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
var bounded = (v, maximum = 256) => typeof v === "string" && v.length > 0 && v.length <= maximum && !/[\u0000-\u001f]/.test(v) ? v : null;
function exact2(v, keys) {
  const o = rec(v);
  if (Object.getPrototypeOf(v) !== Object.prototype || Object.keys(o).sort().join("|") !== [...keys].sort().join("|")) throw Error("OPERATING_INTELLIGENCE_FIELDS");
  return o;
}
function validateOperatingIntelligence(value, generatedAt) {
  const s = exact2(value, ["version", "run", "candidates", "quality", "provider", "resources", "protection", "times", "decisions", "refusals", "pendingOrders", ...Object.hasOwn(rec(value), "admission") ? ["admission"] : [], ...Object.hasOwn(rec(value), "financialPolicy") ? ["financialPolicy"] : []]);
  if (s.version !== OPERATING_INTELLIGENCE_VERSION) throw Error("OPERATING_INTELLIGENCE_VERSION");
  const generated = Date.parse(generatedAt), inception = Date.parse(ORIGINAL_POE_INCEPTION);
  const text2 = (v, max = 256) => {
    if (!bounded(v, max)) throw Error("OPERATING_INTELLIGENCE_TEXT");
  };
  const n = (v, whole = true) => {
    if (v !== null && (whole ? count2(v) === null : finite(v) === null)) throw Error("OPERATING_INTELLIGENCE_NUMBER");
  };
  const b = (v) => {
    if (v !== null && typeof v !== "boolean") throw Error("OPERATING_INTELLIGENCE_BOOLEAN");
  };
  const t = (v, nullable2 = true, future = false) => {
    if (v === null && nullable2) return;
    const at = typeof v === "string" ? Date.parse(v) : NaN;
    if (!Number.isSafeInteger(at) || new Date(at).toISOString() !== v || at < inception || !future && at > generated) throw Error("OPERATING_INTELLIGENCE_TIME");
  };
  if (Object.hasOwn(s, "admission")) {
    const a = exact2(s.admission, "financialProjectionReady supervisedNewRiskAllowed candidateResourceAdmissionAllowed evidenceAdmissionAllowed evidencePressureReasonCode evidenceDiagnosticBytes evidenceDiagnosticLimitBytes evidenceRequiresCriticalRecovery evidenceRefusedRecords sourceRecoveryGeneration sourceRecoveryFailures sourceRecoveryReasonCode sourceRecoveryRetryAt sourceRecoveryClosingSettled sourceRestartRequired proofPreparationState".split(" "));
    for (const k of ["financialProjectionReady", "supervisedNewRiskAllowed", "candidateResourceAdmissionAllowed", "evidenceAdmissionAllowed", "evidenceRequiresCriticalRecovery", "sourceRecoveryClosingSettled", "sourceRestartRequired"]) b(a[k]);
    for (const k of ["evidenceDiagnosticBytes", "evidenceDiagnosticLimitBytes", "evidenceRefusedRecords", "sourceRecoveryGeneration", "sourceRecoveryFailures"]) n(a[k]);
    if (a.evidencePressureReasonCode !== null && !EVIDENCE_PRESSURE_CODES.includes(a.evidencePressureReasonCode)) throw Error("OPERATING_EVIDENCE_PRESSURE_CODE");
    if (a.sourceRecoveryReasonCode !== null && !RECOVERY_REASON_CODES.includes(a.sourceRecoveryReasonCode)) throw Error("OPERATING_RECOVERY_REASON_CODE");
    t(a.sourceRecoveryRetryAt, true, true);
    if (a.proofPreparationState !== null && !["not-started", "pending", "complete", "failed"].includes(a.proofPreparationState)) throw Error("OPERATING_PROOF_PREPARATION_STATE");
  }
  if (Object.hasOwn(s, "financialPolicy")) validateFinancialPolicyReporting(s.financialPolicy, generated);
  const run = exact2(s.run, ["id", "startedAt", "mode", "configurationSha256", "strategyVersion"]);
  text2(run.id, 128);
  text2(run.strategyVersion, 128);
  t(run.startedAt, false);
  if (!["persistent-paper", "bounded-verification", "maintenance"].includes(run.mode) || typeof run.configurationSha256 !== "string" || !/^[a-f0-9]{64}$/.test(run.configurationSha256)) throw Error("OPERATING_INTELLIGENCE_RUN");
  const c = exact2(s.candidates, "migrationsReceived verifiedOrigins known watch eligible deepActive deepMaximum queued promoted repromoted demoted completeWindows auditedWindows uniqueEvaluated uniqueAudited predictiveAssessments predictivePasses predictiveFailures predictiveUnavailable waitMeanMs waitMaximumMs olderSelected".split(" "));
  Object.values(c).forEach((v) => n(v));
  if (c.deepActive !== null && c.deepMaximum !== null && c.deepActive > c.deepMaximum) throw Error("OPERATING_DEEP_CAPACITY");
  const q = exact2(s.quality, "captureConnected qualityGaps auditUnavailable auditUnusable decisionDeadlineMisses enrichmentDeadlineFailures incompleteExclusions capacityExclusions structuralExclusions limitations".split(" "));
  b(q.captureConnected);
  for (const k of Object.keys(q).filter((k2) => k2 !== "captureConnected" && k2 !== "limitations")) n(q[k]);
  if (!Array.isArray(q.limitations) || q.limitations.length > 10) throw Error("OPERATING_LIMITATIONS_BOUND");
  q.limitations.forEach((v) => text2(v, 512));
  const p = exact2(s.provider, "rpcRequests rpcResponseBytes nativeStreamBytes broadWatchBytes discoveryConnected watchConnected httpTimeouts httpErrors throttles rollingStartsPerMinute maximumStartsPerMinute minimumSpacingMs primaryCooldownUntil historyCooldownUntil controlCooldownUntil".split(" "));
  for (const k of Object.keys(p)) {
    if (k.endsWith("Until")) {
      if (p[k] !== null) {
        const z = typeof p[k] === "string" ? Date.parse(p[k]) : NaN;
        if (!Number.isSafeInteger(z) || new Date(z).toISOString() !== p[k]) throw Error("OPERATING_COOLDOWN_TIME");
      }
    } else if (k.endsWith("Connected")) b(p[k]);
    else n(p[k]);
  }
  const r = exact2(s.resources, "sampleAt cpuOneCoreFraction rssBytes availableMemoryBytes availableDiskBytes eventLoopLagMs state".split(" "));
  t(r.sampleAt);
  for (const k of ["cpuOneCoreFraction", "eventLoopLagMs"]) n(r[k], false);
  for (const k of ["rssBytes", "availableMemoryBytes", "availableDiskBytes"]) n(r[k]);
  if (!["normal", "pressure", "recovering", "unavailable"].includes(r.state)) throw Error("OPERATING_RESOURCE_STATE");
  const h = exact2(s.protection, "state targetCadenceMs completedEvaluationBoundaryMs lastCompletedAt maximumCompletedGapMs maximumQuoteAgeAtUseMs breaches unavailableChecks".split(" "));
  if (!["flat", "monitored", "degraded", "unavailable"].includes(h.state)) throw Error("OPERATING_PROTECTION_STATE");
  t(h.lastCompletedAt);
  for (const k of ["targetCadenceMs", "completedEvaluationBoundaryMs", "breaches", "unavailableChecks"]) n(h[k]);
  for (const k of ["maximumCompletedGapMs", "maximumQuoteAgeAtUseMs"]) n(h[k], false);
  const times = exact2(s.times, "marketNotificationAt freshSupportAt bankClockAt auditAt predictiveAt reconciliationAt".split(" "));
  Object.values(times).forEach((v) => t(v));
  if (!Array.isArray(s.decisions) || s.decisions.length > 50 || !Array.isArray(s.refusals) || s.refusals.length > 30 || !Array.isArray(s.pendingOrders) || s.pendingOrders.length > 3) throw Error("OPERATING_LIST_BOUND");
  for (const raw of s.decisions) {
    const d = exact2(raw, ["id", "mint", "at", "stage", "reason"]);
    text2(d.id, 128);
    text2(d.mint, 96);
    t(d.at, false);
    text2(d.stage, 80);
    text2(d.reason, 512);
  }
  for (const raw of s.refusals) {
    const d = exact2(raw, ["reason", "count"]);
    text2(d.reason, 256);
    if (count2(d.count) === null) throw Error("OPERATING_REFUSAL_COUNT");
  }
  for (const raw of s.pendingOrders) {
    const o = exact2(raw, "id mint side decidedAt executeAt expiresAt reservedSol quantityMinimum reason".split(" "));
    text2(o.id, 128);
    text2(o.mint, 96);
    text2(o.reason, 512);
    if (!["buy", "sell"].includes(o.side) || typeof o.reservedSol !== "string" || !/^(0|[1-9]\d{0,20})(\.\d{1,9})?$/.test(o.reservedSol) || typeof o.quantityMinimum !== "string" || !/^(0|[1-9]\d{0,38})$/.test(o.quantityMinimum)) throw Error("OPERATING_ORDER_AMOUNT");
    t(o.decidedAt, false);
    t(o.executeAt, false, true);
    t(o.expiresAt, false, true);
    if (Date.parse(o.executeAt) < Date.parse(o.decidedAt) + 500 || Date.parse(o.expiresAt) <= Date.parse(o.executeAt) || Date.parse(o.expiresAt) > Date.parse(o.decidedAt) + 3e4) throw Error("OPERATING_ORDER_TIME");
  }
  if (Buffer.byteLength(JSON.stringify(s)) > 32 * 1024) throw Error("OPERATING_INTELLIGENCE_BYTES");
  return s;
}

// src/reporting.ts
var MAX_SNAPSHOT_BYTES = 128 * 1024;
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("object required");
  const o = value;
  if (Object.keys(o).sort().join("|") !== [...keys].sort().join("|")) throw new Error("unexpected/missing fields");
  return o;
}
function text(value, max = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("bounded text required");
}
function time2(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error("UTC millisecond timestamp required");
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== value) throw new Error("invalid timestamp");
  return n;
}
function number(value, nonnegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15 || nonnegative && value < 0) throw new Error("bounded finite number required");
}
function nullable(value, check) {
  if (value !== null) check(value);
}
function oneOf(value, allowed) {
  if (!allowed.includes(value)) throw new Error("unsupported value");
}
function bool(value) {
  if (typeof value !== "boolean") throw new Error("boolean required");
}
function units(value, decimals) {
  if (typeof value !== "string" || !(decimals ? /^(0|[1-9]\d{0,20})(\.\d{1,9})?$/ : /^(0|[1-9]\d{0,39})$/).test(value)) throw new Error("decimal integer quantity required");
}
function list(value, max, check) {
  if (!Array.isArray(value) || value.length > max) throw new Error("bounded array required");
  value.forEach(check);
}
function validateIdentity(identity) {
  text(identity.accountId, 128);
  time2(identity.inceptionAt);
  text(identity.release, 128);
  text(identity.strategy, 128);
}
function validateSnapshot(value, expected, now = Date.now()) {
  validateIdentity(expected);
  const hasIntelligence = !!value && typeof value === "object" && Object.hasOwn(value, "intelligence");
  const s = object(value, ["project", "mode", "liveTrading", "schemaVersion", "account", "sequence", "source", "times", "status", "balances", "costLabels", "positions", "trades", "decisions", "pnl", "history", "funnel", "metrics", ...hasIntelligence ? ["intelligence"] : []]);
  oneOf(s.project, ["pump-opportunity-engine"]);
  oneOf(s.mode, ["PAPER"]);
  oneOf(s.liveTrading, [false]);
  oneOf(s.schemaVersion, [1]);
  const a = object(s.account, ["id", "inceptionAt", "initialUsd"]);
  if (a.id !== expected.accountId || a.inceptionAt !== expected.inceptionAt || a.initialUsd !== 1e3) throw new Error("wrong account/inception");
  if (typeof s.sequence !== "string" || !/^[1-9]\d{0,39}$/.test(s.sequence)) throw new Error("durable positive decimal sequence required");
  const source = object(s.source, ["release", "strategy"]);
  if (source.release !== expected.release || source.strategy !== expected.strategy) throw new Error("unexpected source version");
  const ts = object(s.times, ["generatedAt", "marketAt", "reconciledAt", "usefulProgressAt"]);
  const generated = time2(ts.generatedAt);
  if (generated > now + 3e4 || generated < time2(expected.inceptionAt)) throw new Error("invalid generation time");
  for (const key of ["marketAt", "reconciledAt", "usefulProgressAt"]) nullable(ts[key], (v) => {
    if (time2(v) > generated) throw new Error("source time newer than generation");
  });
  const status = object(s.status, ["runtime", "market", "entries", "reconciled", "blocker"]);
  oneOf(status.runtime, ["running", "stopped", "unavailable"]);
  oneOf(status.market, ["observing", "warming", "unavailable"]);
  oneOf(status.entries, ["enabled", "paused", "disabled"]);
  bool(status.reconciled);
  nullable(status.blocker, (v) => text(v, 512));
  if (status.reconciled === true && ts.reconciledAt === null) throw new Error("reconciliation time required");
  const b = object(s.balances, ["cashSol", "reservedSol", "equitySol", "equityUsd", "realizedUsd", "unrealizedUsd", "tradingPnlUsd", "economicPnlUsd", "positionCostUsd", "markedExposureUsd", "drawdownUsd", "executionCostsUsd", "operatingCostsUsd", "passiveSolEquityUsd", "solPriceUsd"]);
  units(b.cashSol, true);
  units(b.reservedSol, true);
  nullable(b.equitySol, (v) => units(v, true));
  if (Number(b.reservedSol) > Number(b.cashSol)) throw new Error("reservations exceed cash");
  for (const key of ["equityUsd", "realizedUsd", "unrealizedUsd", "tradingPnlUsd", "economicPnlUsd"]) nullable(b[key], (v) => number(v));
  number(b.positionCostUsd, true);
  for (const key of ["markedExposureUsd", "drawdownUsd", "executionCostsUsd", "operatingCostsUsd", "passiveSolEquityUsd", "solPriceUsd"]) nullable(b[key], (v) => number(v, true));
  const costs = object(s.costLabels, ["execution", "operating"]);
  oneOf(costs.execution, ["simulated"]);
  oneOf(costs.operating, ["actual", "estimated", "allocated", "mixed", "unavailable"]);
  const eventTime = (value2) => {
    const n = time2(value2);
    if (n < time2(expected.inceptionAt) || n > generated) throw new Error("event outside account/source chronology");
  };
  list(s.positions, 3, (v) => {
    const p = object(v, ["mint", "label", "quantity", "enteredAt", "entryCostUsd", "netLiquidationUsd", "executionCostsUsd", "status"]);
    text(p.mint, 96);
    text(p.label, 80);
    units(p.quantity, false);
    eventTime(p.enteredAt);
    number(p.entryCostUsd, true);
    nullable(p.netLiquidationUsd, (v2) => number(v2, true));
    number(p.executionCostsUsd, true);
    text(p.status, 80);
  });
  list(s.trades, 50, (v) => {
    const t = object(v, ["id", "mint", "side", "quantity", "at", "valueUsd", "executionCostsUsd", "status", "reason"]);
    text(t.id, 128);
    text(t.mint, 96);
    oneOf(t.side, ["buy", "sell"]);
    units(t.quantity, false);
    eventTime(t.at);
    nullable(t.valueUsd, (v2) => number(v2, true));
    nullable(t.executionCostsUsd, (v2) => number(v2, true));
    text(t.status, 80);
    text(t.reason, 512);
  });
  list(s.decisions, 50, (v) => {
    const d = object(v, ["id", "mint", "at", "stage", "reason"]);
    text(d.id, 128);
    text(d.mint, 96);
    eventTime(d.at);
    text(d.stage, 80);
    text(d.reason, 512);
  });
  let last = -Infinity;
  list(s.pnl, 720, (v) => {
    const p = object(v, ["at", "tradingUsd", "economicUsd"]);
    const at = time2(p.at);
    if (at <= last || at < time2(expected.inceptionAt) || at > generated) throw new Error("history chronology/account mismatch");
    last = at;
    nullable(p.tradingUsd, (v2) => number(v2));
    nullable(p.economicUsd, (v2) => number(v2));
  });
  const h = object(s.history, ["windowStartAt", "downsampled", "label"]);
  nullable(h.windowStartAt, eventTime);
  bool(h.downsampled);
  text(h.label, 256);
  const f = object(s.funnel, ["discovered", "supported", "sufficientlyObserved", "evaluated", "qualified", "attempted", "paperFilled", "exited", "reconciled"]);
  for (const v of Object.values(f)) if (!Number.isSafeInteger(v) || v < 0) throw new Error("nonnegative counter required");
  const m = object(s.metrics, ["processingLagMs", "eventLoopLagMs", "providerEvents", "rpcRequests", "projectedDailyDataSol", "budgetRemainingSol", "budgetStatus", "coverage", "latency"]);
  for (const key of ["processingLagMs", "eventLoopLagMs", "projectedDailyDataSol", "budgetRemainingSol"]) nullable(m[key], (v) => number(v, true));
  for (const key of ["providerEvents", "rpcRequests"]) if (!Number.isSafeInteger(m[key]) || m[key] < 0) throw new Error("nonnegative usage counter required");
  oneOf(m.budgetStatus, ["available", "degraded", "unavailable"]);
  text(m.coverage, 512);
  text(m.latency, 256);
  if (hasIntelligence) {
    if (expected.accountId !== ORIGINAL_POE_ACCOUNT || expected.inceptionAt !== ORIGINAL_POE_INCEPTION) throw Error("operating intelligence requires original account");
    const intelligence = validateOperatingIntelligence(s.intelligence, ts.generatedAt);
    if (intelligence.run.strategyVersion !== source.strategy) throw Error("operating strategy/source mismatch");
    const atoms = (v) => {
      const [whole, part = ""] = v.split(".");
      return BigInt(whole) * 1000000000n + BigInt(part.padEnd(9, "0"));
    };
    if (intelligence.pendingOrders.reduce((n, o) => n + atoms(o.reservedSol), 0n) !== atoms(b.reservedSol)) throw Error("operating reservation mismatch");
    if (s.positions.length > 0 && intelligence.protection.state === "flat") throw Error("operating ownership mismatch");
  }
  if (Buffer.byteLength(JSON.stringify(s)) > MAX_SNAPSHOT_BYTES) throw new Error("snapshot payload limit");
  return s;
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
var hash = (s) => createHash("sha256").update(canonical(s)).digest("hex");
var SnapshotPublisher = class {
  constructor(options) {
    this.options = options;
    const u = new URL(options.url);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || options.secret.length < 24) throw new Error("HTTPS endpoint and dedicated ingestion secret required");
    validateIdentity(options.identity);
    for (const n of [options.intervalMs ?? 3e4, options.timeoutMs ?? 3e3, options.maxBackoffMs ?? 3e5]) if (!Number.isSafeInteger(n) || n < 10 || n > 3e5) throw new Error("bounded publisher timing required");
  }
  options;
  latest = null;
  highest = null;
  timer;
  active;
  running = false;
  inflight;
  metrics = { attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0, lastSuccessAt: null, lastError: null };
  offer(value, rawSourceSha256) {
    if (rawSourceSha256 !== void 0 && !/^[a-f0-9]{64}$/.test(rawSourceSha256)) throw Error("publisher source hash");
    const snapshot = validateSnapshot(value, this.options.identity);
    const fingerprint = hash(snapshot);
    const sequence = BigInt(snapshot.sequence);
    if (this.highest && (sequence < this.highest.sequence || sequence === this.highest.sequence && fingerprint !== this.highest.fingerprint)) throw new Error("publisher sequence regression/conflict");
    this.highest = { sequence, fingerprint };
    this.latest = { snapshot: structuredClone(snapshot), body: JSON.stringify(snapshot), fingerprint, ...rawSourceSha256 === void 0 ? {} : { rawSourceSha256 } };
  }
  queuedSequence() {
    return this.latest?.snapshot.sequence ?? null;
  }
  async publishOnce() {
    if (this.running || this.inflight || this.active) throw Error("publisher already active");
    this.inflight = this.publish();
    try {
      await this.inflight;
    } finally {
      this.inflight = void 0;
    }
    return { ...this.metrics };
  }
  start() {
    if (!this.running) {
      this.running = true;
      this.schedule(0);
    }
  }
  schedule(delay) {
    if (this.running) this.timer = setTimeout(() => {
      this.inflight = this.publish();
    }, delay);
  }
  async publish() {
    const current = this.latest;
    if (!current) {
      this.schedule(this.options.intervalMs ?? 3e4);
      return;
    }
    this.metrics.attempts++;
    this.active = new AbortController();
    const timeout = setTimeout(() => this.active?.abort(), this.options.timeoutMs ?? 3e3);
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.secret}` },
        body: current.body,
        signal: this.active.signal,
        redirect: "error"
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`http_${response.status}`);
      }
      if (this.options.onAcknowledgement) {
        if (response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body) throw Error("invalid_acknowledgement");
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          for (; ; ) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 2048) {
              await reader.cancel();
              throw Error("invalid_acknowledgement");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const ack = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!ack || typeof ack !== "object" || Array.isArray(ack) || Object.keys(ack).join("|") !== "result" || !["accepted", "duplicate"].includes(ack.result)) throw Error("invalid_acknowledgement");
        this.options.onAcknowledgement({ published: true, result: ack.result, accountId: current.snapshot.account.id, inceptionAt: current.snapshot.account.inceptionAt, release: current.snapshot.source.release, sequence: current.snapshot.sequence, sourceAtMs: Date.parse(current.snapshot.times.generatedAt), fingerprint: current.fingerprint, acknowledgedAtMs: Date.now(), ...current.rawSourceSha256 === void 0 ? {} : { rawSourceSha256: current.rawSourceSha256 } });
      } else await response.body?.cancel();
      this.metrics.successes++;
      this.metrics.consecutiveFailures = 0;
      this.metrics.lastSuccessAt = (/* @__PURE__ */ new Date()).toISOString();
      this.metrics.lastError = null;
      if (this.latest?.fingerprint === current.fingerprint) this.latest = null;
    } catch (e) {
      this.metrics.failures++;
      this.metrics.consecutiveFailures++;
      this.metrics.lastError = e instanceof Error && /^http_\d{3}$/.test(e.message) ? e.message : "network_unavailable";
    } finally {
      clearTimeout(timeout);
      this.active = void 0;
      const interval = this.options.intervalMs ?? 3e4;
      this.schedule(Math.min(this.options.maxBackoffMs ?? 3e5, interval * 2 ** Math.min(this.metrics.consecutiveFailures, 8)));
    }
  }
  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.active?.abort();
    await this.inflight;
  }
};

// src/snapshot-publisher.ts
var ORIGINAL_SNAPSHOT_URL = "https://meme-machine-dashboard-staging.onrender.com/api/snapshot";
function snapshotFilePublisherArguments(args) {
  const values = /* @__PURE__ */ new Map();
  let watch = false, once = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--watch" || key === "--once") {
      if (watch || once) throw Error("PUBLISHER_DUPLICATE_ARGUMENT");
      watch = key === "--watch";
      once = key === "--once";
      continue;
    }
    if (!["--file", "--account-id", "--inception-at", "--release", "--strategy"].includes(key) || values.has(key)) throw Error("PUBLISHER_ARGUMENT");
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error("PUBLISHER_ARGUMENT_VALUE");
    values.set(key, value);
  }
  const file = values.get("--file") ?? "", identity = { accountId: values.get("--account-id") ?? "", inceptionAt: values.get("--inception-at") ?? "", release: values.get("--release") ?? "", strategy: values.get("--strategy") ?? "" };
  if (!watch && !once || values.size !== 5 || !isAbsolute(file) || resolve(file) !== file || basename(file) !== "snapshot.json" || identity.accountId !== ORIGINAL_POE_ACCOUNT || identity.inceptionAt !== ORIGINAL_POE_INCEPTION || !/^[a-f0-9]{40}$/.test(identity.release) || !identity.strategy || identity.strategy.length > 128 || /[\u0000-\u001f]/.test(identity.strategy)) throw Error("PUBLISHER_EXACT_ORIGINAL_BINDING_REQUIRED");
  return { file, identity, watch, ...once ? { once: true } : {} };
}
var SYSTEMD_CREDENTIAL_DIRECTORY = "/run/credentials/poe-runtime.service";
function publisherFileOwnerModeAccepted(path, file, uid, credential = false, credentialDirectory) {
  const systemd = credential && credentialDirectory === SYSTEMD_CREDENTIAL_DIRECTORY && path === SYSTEMD_CREDENTIAL_DIRECTORY + "/poe-ingest-secret" && file.uid === 0 && file.gid === 0 && (file.mode & 4095) === 288;
  return systemd || (file.mode & 63) === 0 && (file.uid === uid || credential && file.uid === 0);
}
function privateRead(path, maximum, credential = false, credentialDirectory) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const a = fstatSync(fd), uid = process.getuid?.();
    if (!a.isFile() || a.nlink !== 1 || a.size <= 0 || a.size > maximum || !publisherFileOwnerModeAccepted(path, a, uid, credential, credentialDirectory)) throw Error("PRIVATE_PUBLISHER_FILE");
    const raw = readFileSync(fd), b = fstatSync(fd);
    if (raw.length !== a.size || a.ino !== b.ino || a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs) throw Error("PUBLISHER_FILE_CHANGED");
    return raw;
  } finally {
    closeSync(fd);
  }
}
function publisherCredentialPath(env) {
  const directory = env.CREDENTIALS_DIRECTORY, explicit = env.POE_PUBLISH_SECRET_FILE;
  const path = explicit ?? (directory ? join(directory, "poe-ingest-secret") : null);
  if (!path || !isAbsolute(path) || resolve(path) !== path || path !== "/etc/poe/secrets/ingest-secret" && !(directory && isAbsolute(directory) && resolve(directory) === directory && dirname(path) === directory && basename(path) === "poe-ingest-secret")) throw Error("ORIGINAL_PUBLISHER_CREDENTIAL_BINDING_REQUIRED");
  return path;
}
function readPublisherCredential(env) {
  const raw = privateRead(publisherCredentialPath(env), 4096, true, env.CREDENTIALS_DIRECTORY), secret = raw.toString("utf8").trim();
  if (!/^[A-Za-z0-9._~+/=-]{24,512}$/.test(secret)) throw Error("ORIGINAL_PUBLISHER_CREDENTIAL_FORMAT");
  return secret;
}
function readSnapshotFileWithProvenance(file, identity) {
  const raw = privateRead(file, 128 * 1024);
  return { snapshot: validateSnapshot(JSON.parse(raw.toString("utf8")), identity), rawSourceSha256: createHash2("sha256").update(raw).digest("hex") };
}
function readSnapshotFile(file, identity) {
  return readSnapshotFileWithProvenance(file, identity).snapshot;
}
var SnapshotFilePublisher = class {
  constructor(options) {
    this.options = options;
    this.publisher = new SnapshotPublisher({ url: ORIGINAL_SNAPSHOT_URL, secret: options.secret, identity: options.identity, intervalMs: options.publishIntervalMs ?? 15e3, timeoutMs: 5e3, maxBackoffMs: 6e4, fetch: options.fetch, onAcknowledgement: options.onAcknowledgement ?? (() => {
    }) });
    if (!Number.isSafeInteger(options.pollMs ?? 1e3) || (options.pollMs ?? 1e3) < 10 || !Number.isSafeInteger(options.offerMs ?? 15e3) || (options.offerMs ?? 15e3) < 10) throw Error("PUBLISHER_CADENCE");
  }
  options;
  timer;
  running = false;
  lastOfferAt = -Infinity;
  lastOfferedSourceHash = null;
  sourceAvailability = null;
  publisher;
  // A changed verified file refreshes only the bounded latest-value queue.
  // Network cadence/backoff remain owned by SnapshotPublisher; unchanged
  // snapshots are still reoffered periodically for receiver-restart recovery.
  inspect() {
    if (!this.running) return;
    const at = (this.options.now ?? Date.now)(), mono = (this.options.monotonic ?? (() => performance.now()))();
    try {
      const { snapshot, rawSourceSha256 } = readSnapshotFileWithProvenance(this.options.file, this.options.identity);
      if (rawSourceSha256 !== this.lastOfferedSourceHash || mono - this.lastOfferAt >= (this.options.offerMs ?? 15e3)) {
        this.publisher.offer(snapshot, rawSourceSha256);
        this.lastOfferAt = mono;
        this.lastOfferedSourceHash = rawSourceSha256;
      }
      if (this.sourceAvailability !== true) {
        this.sourceAvailability = true;
        this.options.onSourceState?.({ sourceAvailable: true, at, reason: null });
      }
    } catch {
      if (this.sourceAvailability !== false) {
        this.sourceAvailability = false;
        this.options.onSourceState?.({ sourceAvailable: false, at, reason: "verified_snapshot_unavailable" });
      }
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => this.inspect(), this.options.pollMs ?? 1e3);
        this.timer.unref();
      }
    }
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.inspect();
    this.publisher.start();
  }
  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    await this.publisher.stop();
  }
  metrics() {
    return { ...this.publisher.metrics, sourceAvailable: this.sourceAvailability };
  }
};
async function runSnapshotFilePublisher(args = process.argv.slice(2), env = process.env) {
  if (process.getuid?.() === 0) throw Error("PUBLISHER_NONROOT_REQUIRED");
  const settings = snapshotFilePublisherArguments(args), secret = readPublisherCredential(env);
  const write = (value) => {
    process.stdout.write(JSON.stringify(value) + "\n");
  };
  if (settings.once) {
    const { snapshot, rawSourceSha256 } = readSnapshotFileWithProvenance(settings.file, settings.identity), publisher2 = new SnapshotPublisher({ url: ORIGINAL_SNAPSHOT_URL, secret, identity: settings.identity, timeoutMs: 5e3, onAcknowledgement: write });
    publisher2.offer(snapshot, rawSourceSha256);
    const metrics = await publisher2.publishOnce();
    if (metrics.successes !== 1) throw Error("PUBLISHER_FINAL_REPORT_NOT_ACKNOWLEDGED");
    return metrics;
  }
  const publisher = new SnapshotFilePublisher({ ...settings, secret, onAcknowledgement: write, onSourceState: write });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  publisher.start();
  try {
    while (!stopped) await new Promise((r) => setTimeout(r, 250));
  } finally {
    await publisher.stop();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
  return publisher.metrics();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runSnapshotFilePublisher().catch((error) => {
  const allowed = ["PRIVATE_PUBLISHER_FILE", "PUBLISHER_FILE_CHANGED", "ORIGINAL_PUBLISHER_CREDENTIAL_FORMAT", "EACCES", "EPERM", "ENOENT", "ERR_ACCESS_DENIED"];
  const code = error instanceof Error ? "code" in error ? String(error.code) : error.message : "";
  process.stderr.write("POE original snapshot publisher unavailable\n" + JSON.stringify({ kind: "POE_ORIGINAL_PUBLISHER_UNAVAILABLE", reasonCode: allowed.includes(code) ? code : "PUBLISHER_STARTUP_UNAVAILABLE" }) + "\n");
  process.exitCode = 1;
});
export {
  ORIGINAL_SNAPSHOT_URL,
  SnapshotFilePublisher,
  publisherCredentialPath,
  publisherFileOwnerModeAccepted,
  readPublisherCredential,
  readSnapshotFile,
  readSnapshotFileWithProvenance,
  runSnapshotFilePublisher,
  snapshotFilePublisherArguments
};
