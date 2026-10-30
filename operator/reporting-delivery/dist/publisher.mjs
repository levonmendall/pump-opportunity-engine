// scripts/publish-pilot-status.mjs
import { open, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// src/reporting.ts
var MAX_SNAPSHOT_BYTES = 128 * 1024;
function object(value, keys2) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("object required");
  const o = value;
  if (Object.keys(o).sort().join("|") !== [...keys2].sort().join("|")) throw new Error("unexpected/missing fields");
  return o;
}
function text(value, max = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("bounded text required");
}
function time(value) {
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
  time(identity.inceptionAt);
  text(identity.release, 128);
  text(identity.strategy, 128);
}
function validateSnapshot(value, expected, now = Date.now()) {
  validateIdentity(expected);
  const s = object(value, ["project", "mode", "liveTrading", "schemaVersion", "account", "sequence", "source", "times", "status", "balances", "costLabels", "positions", "trades", "decisions", "pnl", "history", "funnel", "metrics"]);
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
  const generated = time(ts.generatedAt);
  if (generated > now + 3e4 || generated < time(expected.inceptionAt)) throw new Error("invalid generation time");
  for (const key of ["marketAt", "reconciledAt", "usefulProgressAt"]) nullable(ts[key], (v) => {
    if (time(v) > generated) throw new Error("source time newer than generation");
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
    const n = time(value2);
    if (n < time(expected.inceptionAt) || n > generated) throw new Error("event outside account/source chronology");
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
    const at = time(p.at);
    if (at <= last || at < time(expected.inceptionAt) || at > generated) throw new Error("history chronology/account mismatch");
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
  if (Buffer.byteLength(JSON.stringify(s)) > MAX_SNAPSHOT_BYTES) throw new Error("snapshot payload limit");
  return s;
}

// src/pilot-telemetry.ts
var PILOT_TELEMETRY_LIMIT = 192 * 1024;
var LIMIT = PILOT_TELEMETRY_LIMIT;
var stages = ["discovered", "supported", "sufficientlyObserved", "evaluated", "qualified", "reserved", "attempted", "paperFilled", "exited", "reconciled", "verifiedMigrationOrigins", "admitted", "usableWindows"];
var metricNames = ["rpcRequests", "providerEvents", "normalizedTrades", "eventLoopLagMs", "maximumCompletedGapMs", "maximumQuoteAgeMs", "protectionBreaches", "unavailableChecks", "streamBytes"];
var watchCounts = ["known", "watch", "eligibleKnown", "deepActive", "maximumDeep", "queued", "promoted", "repromoted", "demoted", "expired", "capacityExclusions", "structuralExclusions", "completeWindows", "strategyRejections", "incompleteDataExclusions", "enrichmentDeadlineFailures"];
var featureCounts = ["predictiveAssessments", "predictiveFailures"];
var sourceTimeNames = ["lastMarketNotificationAt", "lastFreshSupportAt", "lastBankClockAt", "lastAuditAt", "lastPredictiveAt", "financialReconciliationAt"];
var observationWatchCounts = ["observationEligibleKnown", "observationQueued", "maximumOlderResearchIdentities"];
var ageCohortNames = ["preEntry", "entryEligible", "olderSelected"];
function object2(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("invalid telemetry object");
  return x;
}
function text2(x, max) {
  if (typeof x !== "string" || !x || x.length > max || /[\u0000-\u001f]/.test(x)) throw new Error("invalid telemetry text");
  return x;
}
function number2(x, nullable2 = true) {
  if (nullable2 && (x === null || x === void 0)) return null;
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > Number.MAX_SAFE_INTEGER) throw new Error("invalid telemetry number");
  return x;
}
function integer(x, nullable2 = true) {
  const n = number2(x, nullable2);
  if (n !== null && !Number.isSafeInteger(n)) throw new Error("invalid telemetry integer");
  return n;
}
function bool2(x) {
  if (typeof x !== "boolean") throw new Error("invalid telemetry boolean");
  return x;
}
var safeText = (x, max = 256) => String(x ?? "unreported").replace(/https?:\/\/\S+/gi, "[endpoint]").replace(/Bearer\s+\S+/gi, "[credential]").replace(/[\u0000-\u001f]/g, " ").slice(0, max) || "unreported";
function keys(o, allowed) {
  if (Object.keys(o).some((k) => !allowed.includes(k))) throw new Error("unexpected telemetry field");
}
function validateWatch(value) {
  const w = object2(value);
  keys(w, [...watchCounts, ...featureCounts, ...observationWatchCounts, "ageCohorts", "waitMs", "promotionWaitMs"]);
  for (const k of watchCounts) {
    if (!Object.hasOwn(w, k)) throw Error("missing watch field");
    integer(w[k]);
  }
  for (const k of featureCounts) integer(w[k]);
  for (const key of observationWatchCounts) if (Object.hasOwn(w, key)) {
    integer(w[key]);
    if (w[key] !== null && w[key] > 512) throw Error("observation watch identity limit");
  }
  if (w.maximumOlderResearchIdentities !== void 0 && w.maximumOlderResearchIdentities !== null && w.maximumOlderResearchIdentities > 24) throw Error("older research identity limit");
  for (const key of ["observationEligibleKnown", "observationQueued"]) if (w[key] !== void 0 && w[key] !== null && w.known !== null && w[key] > w.known) throw Error("observation watch count inconsistent");
  if (w.observationQueued !== void 0 && w.observationQueued !== null && w.observationEligibleKnown !== void 0 && w.observationEligibleKnown !== null && w.observationQueued > w.observationEligibleKnown) throw Error("observation queue count inconsistent");
  if (w.ageCohorts !== void 0 && w.ageCohorts !== null) {
    const cohorts = object2(w.ageCohorts);
    keys(cohorts, [...ageCohortNames]);
    for (const key of ageCohortNames) {
      if (!Object.hasOwn(cohorts, key)) throw Error("missing age cohort");
      integer(cohorts[key]);
      if (cohorts[key] !== null && (cohorts[key] > 512 || w.known !== null && cohorts[key] > w.known)) throw Error("age cohort identity limit");
    }
    if (cohorts.entryEligible !== null && w.eligibleKnown !== null && cohorts.entryEligible !== w.eligibleKnown) throw Error("entry age cohort inconsistent");
    if (cohorts.olderSelected !== null && w.maximumOlderResearchIdentities !== void 0 && w.maximumOlderResearchIdentities !== null && cohorts.olderSelected > w.maximumOlderResearchIdentities) throw Error("older research capacity inconsistent");
    if (ageCohortNames.every((key) => cohorts[key] !== null)) {
      const sum = ageCohortNames.reduce((n, key) => n + cohorts[key], 0);
      if (w.known !== null && sum > w.known || w.observationEligibleKnown !== void 0 && w.observationEligibleKnown !== null && sum !== w.observationEligibleKnown) throw Error("observation age cohorts inconsistent");
    }
  }
  const wait = object2(w.waitMs);
  keys(wait, ["mean", "maximum"]);
  if (!Object.hasOwn(wait, "mean") || !Object.hasOwn(wait, "maximum")) throw Error("missing watch wait");
  number2(wait.mean);
  number2(wait.maximum);
  for (const k of ["known", "watch", "eligibleKnown", "queued"]) if (w[k] !== null && w[k] > 512) throw Error("watch identity limit");
  if (w.maximumDeep !== null && (w.maximumDeep < 1 || w.maximumDeep > 20)) throw Error("watch deep limit");
  if (w.deepActive !== null && (w.deepActive > 20 || w.maximumDeep !== null && w.deepActive > w.maximumDeep)) throw Error("watch deep limit");
  for (const k of ["watch", "eligibleKnown", "deepActive"]) if (w[k] !== null && w.known !== null && w[k] > w.known) throw Error("watch count inconsistent");
  if (wait.mean !== null && wait.maximum !== null && wait.mean > wait.maximum) throw Error("watch wait inconsistent");
  if (w.promotionWaitMs !== void 0 && w.promotionWaitMs !== null) {
    const completed = object2(w.promotionWaitMs);
    keys(completed, ["mean", "maximum"]);
    if (!Object.hasOwn(completed, "mean") || !Object.hasOwn(completed, "maximum")) throw Error("missing promotion wait");
    number2(completed.mean);
    number2(completed.maximum);
    if (completed.mean !== null && completed.maximum !== null && completed.mean > completed.maximum) throw Error("promotion wait inconsistent");
  }
  return structuredClone(w);
}
function projectWatch(value) {
  if (value === void 0 || value === null) return null;
  const w = object2(object2(value).summary), wait = w.waitMs === void 0 ? {} : object2(w.waitMs), completed = w.promotionWaitMs === void 0 || w.promotionWaitMs === null ? {} : object2(w.promotionWaitMs);
  return validateWatch({ ...Object.fromEntries([...watchCounts, ...featureCounts].map((k) => [k, integer(w[k])])), ...Object.fromEntries(observationWatchCounts.filter((k) => Object.hasOwn(w, k)).map((k) => [k, integer(w[k])])), ...w.ageCohorts === void 0 ? {} : { ageCohorts: w.ageCohorts === null ? null : Object.fromEntries(ageCohortNames.map((k) => [k, integer(object2(w.ageCohorts)[k])])) }, waitMs: { mean: number2(wait.mean), maximum: number2(wait.maximum) }, promotionWaitMs: { mean: number2(completed.mean), maximum: number2(completed.maximum) } });
}
function validateObservationAgePolicy(value) {
  const policy = object2(value), fields = ["version", "minimumObservationAgeMs", "recentMaximumAgeMs", "selectedOlderMaximumAgeMs"];
  keys(policy, fields);
  if (fields.some((k) => !Object.hasOwn(policy, k))) throw Error("missing observation age policy field");
  const version = text2(policy.version, 96);
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(version)) throw Error("invalid observation policy version");
  for (const key of fields.slice(1)) {
    integer(policy[key], false);
    if (policy[key] > 864e5) throw Error("observation age policy bound");
  }
  if (policy.minimumObservationAgeMs >= policy.recentMaximumAgeMs || policy.recentMaximumAgeMs < 6e4 || policy.selectedOlderMaximumAgeMs < policy.recentMaximumAgeMs) throw Error("observation age policy order");
  return structuredClone(policy);
}
function projectObservationAgePolicy(value) {
  if (value === null) return null;
  const policy = object2(value);
  return validateObservationAgePolicy({ version: policy.version, minimumObservationAgeMs: policy.minimumObservationAgeMs, recentMaximumAgeMs: policy.recentMaximumAgeMs, selectedOlderMaximumAgeMs: policy.selectedOlderMaximumAgeMs });
}
function validateSourceTimes(value, generatedAt) {
  const times = object2(value);
  keys(times, [...sourceTimeNames]);
  for (const key of sourceTimeNames) {
    if (!Object.hasOwn(times, key)) throw Error("missing source fact timestamp");
    const at = integer(times[key]);
    if (at !== null && at > generatedAt) throw Error("source fact timestamp newer than generatedAt");
  }
  return times;
}
function projectSourceTimes(value, generatedAt) {
  if (value === null) return null;
  const times = object2(value);
  return validateSourceTimes(Object.fromEntries(sourceTimeNames.map((key) => [key, integer(times[key])])), generatedAt);
}
function projectPilotStatus(value) {
  const p = object2(value);
  if (p.experimental !== true || p.authoritative !== false || p.liveTradingEnabled !== false) throw new Error("isolated PAPER pilot required");
  const f = object2(p.funnel), u = object2(p.usage), rpc = object2(u.rpc), feeds = object2(u.feeds), t = object2(p.timing), source = object2(p.source);
  const result = {
    schemaVersion: 1,
    kind: "experimental-pilot",
    authoritative: false,
    liveTrading: false,
    accountId: text2(p.accountId, 100),
    inceptionAt: integer(p.inceptionAt, false),
    runId: text2(p.runId, 120),
    generatedAt: integer(p.generatedAt, false),
    source: { release: text2(source.commit, 64), strategy: text2(p.strategyVersion, 100), sha256: typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256) ? source.sha256 : null },
    running: bool2(p.running),
    entriesEnabled: bool2(p.entriesEnabled),
    status: safeText(p.status),
    ...p.mode === void 0 ? {} : { mode: p.mode, financialExecutionAuthorized: bool2(p.financialExecutionAuthorized) },
    ...p.observationAgePolicy === void 0 ? {} : { observationAgePolicy: projectObservationAgePolicy(p.observationAgePolicy) },
    ...p.sourceTimes === void 0 ? {} : { sourceTimes: projectSourceTimes(p.sourceTimes, integer(p.generatedAt, false)) },
    portfolio: p.mode === "paper" && p.financialExecutionAuthorized === true && p.experimentalPortfolio !== void 0 ? p.experimentalPortfolio : null,
    accounting: p.mode === "paper" && p.financialExecutionAuthorized === true && p.experimentalPortfolio && p.experimentalAccounting !== void 0 ? p.experimentalAccounting : null,
    funnel: Object.fromEntries(stages.map((k) => [k, integer(f[k])])),
    metrics: { rpcRequests: integer(rpc.newUnits), providerEvents: integer(feeds.frames), normalizedTrades: integer(feeds.normalizedTrades), eventLoopLagMs: number2(u.eventLoopDelayP95Ms), maximumCompletedGapMs: Array.isArray(t.completedEvaluationGaps) && t.completedEvaluationGaps.length ? number2(t.maximumCompletedGapMs) : null, maximumQuoteAgeMs: Array.isArray(t.completedEvaluationGaps) && t.completedEvaluationGaps.length ? number2(t.maximumQuoteAgeAtUseMs) : null, protectionBreaches: integer(t.protectionBreaches), unavailableChecks: integer(t.unavailableChecks), streamBytes: integer(feeds.totalSocketBytes) },
    decisions: (Array.isArray(p.decisions) ? p.decisions : []).slice(-30).map((d) => ({ at: integer(d.at, false), mint: text2(d.mint, 100), stage: safeText(d.stage, 100), reason: safeText(d.reason) })),
    refusals: Object.entries(object2(p.refusals ?? {})).filter(([, v]) => typeof v === "number").slice(0, 30).map(([reason, count]) => ({ reason: safeText(reason), count: integer(count, false) })),
    watch: projectWatch(p.watch)
  };
  return validatePilotTelemetry(result);
}
function validatePilotTelemetry(input) {
  const p = object2(input);
  keys(p, ["schemaVersion", "kind", "authoritative", "liveTrading", "accountId", "inceptionAt", "runId", "generatedAt", "source", "running", "entriesEnabled", "status", "funnel", "metrics", "decisions", "refusals", "watch", "mode", "financialExecutionAuthorized", "portfolio", "accounting", "observationAgePolicy", "sourceTimes"]);
  if (p.schemaVersion !== 1 || p.kind !== "experimental-pilot" || p.authoritative !== false || p.liveTrading !== false) throw new Error("invalid pilot identity");
  if (!/^poe-pilot-[a-z0-9-]+$/.test(text2(p.accountId, 100))) throw new Error("pilot account required");
  integer(p.inceptionAt, false);
  integer(p.generatedAt, false);
  if (p.generatedAt < p.inceptionAt) throw new Error("invalid source time");
  text2(p.runId, 120);
  bool2(p.running);
  bool2(p.entriesEnabled);
  text2(p.status, 256);
  const s = object2(p.source);
  keys(s, ["release", "strategy", "sha256"]);
  text2(s.release, 64);
  text2(s.strategy, 100);
  if (s.sha256 !== null && !(typeof s.sha256 === "string" && /^[a-f0-9]{64}$/.test(s.sha256))) throw Error("invalid source hash");
  const f = object2(p.funnel);
  keys(f, [...stages]);
  for (const k of stages) {
    if (!Object.hasOwn(f, k)) throw Error("missing funnel field");
    integer(f[k]);
  }
  const m = object2(p.metrics);
  keys(m, [...metricNames]);
  for (const k of metricNames) {
    if (!Object.hasOwn(m, k)) throw Error("missing metric field");
    if (["eventLoopLagMs", "maximumCompletedGapMs", "maximumQuoteAgeMs"].includes(k)) number2(m[k]);
    else integer(m[k]);
  }
  if (!Array.isArray(p.decisions) || p.decisions.length > 30 || !Array.isArray(p.refusals) || p.refusals.length > 30) throw new Error("telemetry list limit");
  for (const d of p.decisions) {
    keys(object2(d), ["at", "mint", "stage", "reason"]);
    integer(d.at, false);
    if (d.at > p.generatedAt) throw new Error("future decision");
    text2(d.mint, 100);
    text2(d.stage, 100);
    text2(d.reason, 256);
  }
  for (const r of p.refusals) {
    keys(object2(r), ["reason", "count"]);
    text2(r.reason, 256);
    integer(r.count, false);
  }
  if (p.watch !== void 0 && p.watch !== null) validateWatch(p.watch);
  if (p.observationAgePolicy !== void 0 && p.observationAgePolicy !== null) validateObservationAgePolicy(p.observationAgePolicy);
  if (p.sourceTimes !== void 0 && p.sourceTimes !== null) validateSourceTimes(p.sourceTimes, p.generatedAt);
  if (p.mode !== void 0) {
    if (!["candidate-evaluation", "paper"].includes(p.mode)) throw Error("invalid pilot mode");
    bool2(p.financialExecutionAuthorized);
    if (p.mode === "candidate-evaluation" && (p.financialExecutionAuthorized || p.entriesEnabled)) throw Error("candidate mode cannot authorize financial execution");
    if (p.mode === "candidate-evaluation" && p.sourceTimes !== void 0 && p.sourceTimes !== null && p.sourceTimes.financialReconciliationAt !== null) throw Error("candidate mode cannot claim financial reconciliation");
  } else if (p.financialExecutionAuthorized !== void 0) throw Error("financial mode required");
  if (p.portfolio !== void 0 && p.portfolio !== null) {
    if (p.mode !== "paper" || p.financialExecutionAuthorized !== true) throw Error("explicit PAPER financial mode required");
    if (Buffer.byteLength(JSON.stringify(p.portfolio)) > MAX_SNAPSHOT_BYTES) throw Error("portfolio size limit");
    const portfolio = validateSnapshot(p.portfolio, { accountId: p.accountId, inceptionAt: new Date(p.inceptionAt).toISOString(), release: p.source.release, strategy: p.source.strategy }, p.generatedAt);
    if (Date.parse(portfolio.times.generatedAt) > p.generatedAt) throw Error("portfolio source time newer than diagnostic source");
    if (p.running === false && portfolio.status.runtime === "running" || p.running === true && portfolio.status.runtime === "stopped") throw Error("portfolio runtime status inconsistent");
    if (portfolio.status.entries === "enabled" && !p.entriesEnabled) throw Error("portfolio entry permission inconsistent");
  }
  if (p.accounting !== void 0 && p.accounting !== null) {
    if (p.mode !== "paper" || p.financialExecutionAuthorized !== true || !p.portfolio) throw Error("accounting requires the experimental PAPER portfolio");
    const a = object2(p.accounting), fields = ["schemaVersion", "at", "totalPnlLamports", "realizedLamports", "unrealizedLamports", "executionCostsLamports", "lockedDepositLamports"];
    keys(a, fields);
    if (fields.some((k) => !Object.hasOwn(a, k)) || a.schemaVersion !== 1 || integer(a.at, false) !== p.generatedAt) throw Error("invalid accounting source time or shape");
    const amount = (value, signed, nullable2 = false) => {
      if (nullable2 && value === null) return;
      if (typeof value !== "string" || value.length > 40 || !(signed ? /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/ : /^(?:0|[1-9][0-9]*)$/).test(value)) throw Error("invalid accounting integer");
      const n = BigInt(value), minimum = signed ? -(1n << 127n) : 0n, maximum = signed ? (1n << 127n) - 1n : (1n << 128n) - 1n;
      if (n < minimum || n > maximum) throw Error("accounting integer bound");
    };
    amount(a.totalPnlLamports, true, true);
    amount(a.realizedLamports, true);
    amount(a.unrealizedLamports, true, true);
    amount(a.executionCostsLamports, false);
    amount(a.lockedDepositLamports, false);
    if (p.portfolio.balances.equitySol === null && (a.totalPnlLamports !== null || a.unrealizedLamports !== null)) throw Error("unknown marks require unavailable accounting totals");
  }
  if (Buffer.byteLength(JSON.stringify(p)) > LIMIT) throw new Error("telemetry size limit");
  return structuredClone(p);
}

// scripts/publish-pilot-status.mjs
var DESTINATION = "https://meme-machine-dashboard-staging.onrender.com/api/pilot";
async function readPrivateFile(path, limit) {
  const fd = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 63) !== 0 || s.size > limit) throw Error("Private bounded owner file required");
    const data = Buffer.alloc(Math.min(limit + 1, s.size + 1));
    let size = 0;
    for (; ; ) {
      const r = await fd.read(data, size, data.length - size, size);
      size += r.bytesRead;
      if (size > limit) throw Error("Reporting input limit");
      if (!r.bytesRead) break;
      if (size === data.length) throw Error("Reporting input changed while reading");
    }
    return data.subarray(0, size).toString("utf8");
  } finally {
    await fd.close();
  }
}
async function publishPilotStatus({ file, secret, accountId, inceptionAt, endpoint = DESTINATION, fetcher = fetch }) {
  const url = new URL(endpoint);
  if (url.href !== DESTINATION) throw Error("Only the configured POE reporting receiver is allowed");
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512 || /[\s\u0000-\u001f]/.test(secret)) throw Error("Dedicated reporting credential required");
  const snapshot = projectPilotStatus(JSON.parse(await readPrivateFile(file, 4 * 1024 * 1024)));
  if (snapshot.accountId !== accountId || snapshot.inceptionAt !== inceptionAt) throw Error("Pilot reporting identity mismatch");
  if (snapshot.generatedAt > Date.now() + 5e3) throw Error("Pilot clock is in the future");
  const r = await fetcher(url, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(5e3) });
  if (!r.ok) {
    await r.body?.cancel();
    throw Error("Pilot reporting receiver unavailable");
  }
  const reader = r.body?.getReader();
  if (!reader) throw Error("Reporting acknowledgement unavailable");
  let size = 0;
  const chunks = [];
  try {
    for (; ; ) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 4096) {
        await reader.cancel();
        throw Error("Reporting response limit");
      }
      chunks.push(p.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8")).result;
  if (!["accepted", "duplicate"].includes(result)) throw Error("Reporting acknowledgement invalid");
  return { published: true, result, accountId: snapshot.accountId, runId: snapshot.runId, sourceAt: snapshot.generatedAt, running: snapshot.running, sourceAgeMs: Math.max(0, Date.now() - snapshot.generatedAt) };
}
async function main() {
  const args = process.argv.slice(2), i = args.indexOf("--file"), watch = args.includes("--watch");
  if (i < 0 || !args[i + 1]) throw Error("Use --file /absolute/status.json [--watch]");
  const file = resolve(args[i + 1]), keyFile = process.env.POE_PILOT_INGEST_SECRET_FILE;
  if (!keyFile) throw Error("Attach the dedicated reporting credential through a private file");
  const secret = (await readPrivateFile(keyFile, 4096)).trim(), accountId = process.env.POE_PILOT_ACCOUNT_ID, inceptionAt = Number(process.env.POE_PILOT_INCEPTION_AT);
  if (!/^poe-pilot-[a-z0-9-]+$/.test(accountId ?? "") || !Number.isSafeInteger(inceptionAt) || inceptionAt <= 0) throw Error("Actual pilot identity required");
  let stopped = false, failures = 0;
  const stop = () => {
    stopped = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  do {
    try {
      console.log(JSON.stringify(await publishPilotStatus({ file, secret, accountId, inceptionAt, endpoint: process.env.POE_PILOT_REPORT_URL ?? DESTINATION })));
      failures = 0;
    } catch {
      failures++;
      console.error("Pilot reporting unavailable; source timestamps and trading state unchanged.");
      if (!watch) process.exitCode = 1;
    }
    if (watch && !stopped) await new Promise((r) => {
      const done = () => {
        clearTimeout(timer);
        process.removeListener("SIGINT", done);
        process.removeListener("SIGTERM", done);
        r();
      };
      const timer = setTimeout(done, Math.min(6e4, 15e3 * 2 ** Math.min(failures, 2)));
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  } while (watch && !stopped);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  console.error("Pilot publisher configuration rejected; no trading state changed.");
  process.exitCode = 1;
});
export {
  projectPilotStatus,
  publishPilotStatus,
  readPrivateFile
};
