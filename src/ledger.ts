import {PAPER_EPOCH_VERSION,PAPER_V3_EPOCH_VERSION,PAPER_V3_TEN_SOL_EPOCH_ID,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION,verifyArchivedEpochAssets,PAPER_TEN_SOL_EPOCH_ID,PAPER_TEN_SOL_EPOCH_AUTHORIZATION,validatePaperEpoch,requireEpochFlat,verifiedEpochBackup,paperEpochStateSha256,type PaperEpoch,type LegacyPaperEpoch,type V3PaperEpoch,type PaperEpochBackupReceipt} from './paper-epoch.js';
import Database from 'better-sqlite3';
import {PAPER_EQUITY_RISK_VERSION,PAPER_EQUITY_RISK_POLICY,PAPER_V3_EQUITY_RISK_VERSION,PAPER_V3_EQUITY_RISK_POLICY,consumedEntryAllowance,drawdownFacts,validateEquityRiskState,validateEntryAllocation,entryAllocation,type EquityRiskState,type EntryAllocation} from './paper-equity-risk.js';
import {validatePaperExecutionPlan,validatePaperExecutionLanding,validatePaperExecutionAttempt,paperExecutionFee,type PaperExecutionPlan,type PaperExecutionLanding,type PaperExecutionAttempt} from './execution-realism.js';
import { createHash } from 'node:crypto';
import { openSync, closeSync, fstatSync, lstatSync, statSync, realpathSync, constants, type Stats } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import {validateReportingTradeCache,reportingFilledTrade,type ReportingFilledTrade,type ReportingTradeCache} from './reporting.js';
import { initializeOperatingCosts, validateOperatingCosts, applyOperatingCostEvent, projectOperatingCosts, type OperatingCostState, type OperatingCostEvent } from './costs.js';

/** One PAPER accounting path. Fixture and authoritative identities never mix. No live execution. */
export type UsdPrice = { microUsdPerSol: string; at: number; source: string };
/** Actual-size token liquidation net of exit costs; excludes separately locked rent deposits. */
export type Mark = { netLamports: string; pricedBaseUnits: string; at: number; evidence: string };
export const ADAPTIVE_PAPER_STRATEGY_VERSION='adaptive-momentum-v2-paper-v1' as const;
export const V3_PAPER_STRATEGY_VERSION='liquidity-resilient-momentum-v3' as const;
export type EntryStrategy={version:typeof ADAPTIVE_PAPER_STRATEGY_VERSION|typeof V3_PAPER_STRATEGY_VERSION;cycle:number;windowStartAt:number;windowEndAt:number;assessedAt:number;signalId:string};
export type PositionStrategy=EntryStrategy&{roundTripId:string;highWaterNetLamports:string;highWaterAt:number;profitProtectionFloorLamports?:string};
type ClosedCycle={schemaVersion:1;mint:string;cycle:number;entryOrderId:string;entryWindowEndAt:number;closedAt:number|null;exitOrderId:string|null;legacyEntryCutoff:boolean};
export type EntryEligibility={allowed:boolean;reason:string;closedAt:number|null;previousWindowEndAt:number|null;cycle:number};
export type Position = {
  mint: string; units: string; entryLamports: string; entryGas: string;
  costMicroUsd: string; deposit: string; enteredAt: number;
  /** Absent metadata permanently retains the original holding's exit rules. */
  strategy?:PositionStrategy;
  allocation?:EntryAllocation;
  executionModelVersion?:'paper-chain-conditioned-v1';
};
export type Order = {
  id: string; side: 'buy' | 'sell'; mint: string; decidedAt: number; executeAt: number;
  expiresAt: number; gas: string; deposit: string; maxSpend: string;
  minReceive: string; reserved: string; decisionEvidence: string;
  entryStrategy?:EntryStrategy;
  allocation?:EntryAllocation;
  executionModel?:PaperExecutionPlan;
  /** Intratransaction quote-ATA rent: cash reserved, never an asset or consumed cost. */
  temporaryRentLamports?:string;
};
export type LedgerMode = 'PAPER' | 'DISPOSABLE_PAPER';
export type LedgerState = {
  schemaVersion: 1;
  equityRisk?:EquityRiskState;
  paperEpoch?:PaperEpoch;
  accountId: string; fixtureId?: string; mode: LedgerMode; inceptionAt: number;
  initialMicroUsd: string; inceptionPrice: UsdPrice; lamports: string;
  roundingResidualMicroUsd: string; gasReserve: string;
  lockedDeposits: Record<string, string>; lastAt: number;
  positions: Record<string, Position>; pending: Record<string, Order>;
  realizedLamports: string; executionCosts: string; daily: {
    day: string; baselineMicroUsd: string; paused: boolean; lossPaused: boolean; reconciledAt: number;
  }; revision: number;
  controls: { entriesEnabled: boolean; reason: string; changedAt: number; readinessVersion: string | null; stopRequested: boolean };
};
type State = LedgerState;
/** Structural policy selector; admission additionally verifies its durable
 * epoch/policy anchor through PaperLedger. Legacy policy remains unchanged. */
export function isV3PaperEpochState(s:Pick<LedgerState,'paperEpoch'>){return s.paperEpoch?.id===PAPER_V3_TEN_SOL_EPOCH_ID&&s.paperEpoch.version===PAPER_V3_EPOCH_VERSION;}
export function isV3PaperRiskState(s:Pick<LedgerState,'paperEpoch'|'equityRisk'>){return isV3PaperEpochState(s)&&s.equityRisk?.version===PAPER_V3_EQUITY_RISK_VERSION;}
export function dailyLossEntryBlocked(s:Pick<LedgerState,'daily'|'paperEpoch'|'equityRisk'>){return !isV3PaperEpochState(s)&&s.daily.lossPaused;}
export const OPERATING_FINANCIAL_READINESS_VERSION='paper-operating-financial-readiness-v1' as const;
export const TECHNICAL_PROTECTION_PAUSE_REASONS=Object.freeze(['completed PAPER protection gap exceeded research boundary','completed protection deadline exceeded; candidate windows must restart','first completed protection deadline exceeded; fresh observation required','PAPER protection currently overdue; candidate admissions closed','PAPER protection unavailable; exposure retained'] as const);
export type TechnicalProtectionRecoveryAuthority={verified:true;accountId:string;inceptionAt:number;stateRevision:number;controlChangedAt:number;controlReason:string;originRevision:number;authoritySha256:string}|{verified:false;reason:string};
export type TechnicalProtectionRecoveryProof={version:'paper-technical-protection-recovery-v1';authoritySha256:string;originRevision:number;accountId:string;inceptionAt:number;stateRevision:number;controlChangedAt:number;controlReason:string;positionUnits:Record<string,string>;startedAt:number;completedAt:number;completedEvaluations:number;maximumCompletedGapMs:number;lastQuoteAt:number};
export type LegacyRuntimeReadiness={version:string;evidence:string;marketAt:number;recoveryComplete:boolean;candidateWindowsReady:boolean;budgetAvailable:boolean};
/** Financial permission only. No candidate window, signal, entry quote or order
 * is asserted. The original bank Clock/source expiry and liquidation times are
 * retained; exact inventory and current reconciliation are bound to one writer. */
export type OperatingFinancialReadiness={version:typeof OPERATING_FINANCIAL_READINESS_VERSION;purpose:'financial-permission-only';evidence:string;accountId:string;stateRevision:number;reconciledAt:number;positionUnits:Record<string,string>;source:{kind:'selected-native-support'|'complete-held-liquidation-context';bankClockAt:number;receivedAt:number;validUntil:number};recoveryComplete:boolean;financialInventoryReady:boolean;budgetAvailable:boolean;technicalProtectionRecovery?:TechnicalProtectionRecoveryProof};
export type RuntimeReadiness=LegacyRuntimeReadiness|OperatingFinancialReadiness;
export type ReportingPoint = { at: number; tradingMicroUsd: string | null; economicMicroUsd: string | null };
export type ReportingHistory = { points: ReportingPoint[]; windowLimited: boolean; downsampled: boolean };
/** Optional reporting metadata only. Legacy reporting_history is never migrated
 * or interpreted as a historical token-trading series. */
export const REPORTING_OPERATING_HISTORY_KEY='reporting_history_operating_v2' as const;
export const OPERATING_REPORTING_BASIS='net-token-trading-sol-current-usd-v2' as const;
export type OperatingReportingHistory=ReportingHistory&{schemaVersion:2;basis:typeof OPERATING_REPORTING_BASIS;cutoverAt:number|null;firstObservedAt:number|null};
export type ExecutionQuote = {
  /** Caller must supply the first available supported state at/after modeled delay. */
  at: number; spendLamports: string; receiveUnits: string; evidence: string;
  /** Required for sells: quote must liquidate exactly the entire held amount. */
  pricedBaseUnits?: string;
  refundedDepositLamports?: string; refundEvidence?: string;
  executionModel?:PaperExecutionLanding;
};
export type OrderOutcome = { status: 'filled' | 'failed' | 'expired'; reason: string; at: number };
export type InternalShutdownRecoveryProof={verified:true;accountId:string;inceptionAt:number;stateRevision:number;lastSuccessfulResumeRevision:number;stops:Array<{revision:number;actionId:string;at:number}>;proofSha256:string}|{verified:false;reason:string};
export type DailyLossResetReceipt={accountId:string;inceptionAt:number;at:number;reason:string;revisionBefore:number;revisionAfter:number;previousDaily:LedgerState['daily'];nextDaily:LedgerState['daily'];controlsPreserved:true;entryPermissionGranted:false;orderCreated:false}&({reset:true;alreadyClear:false;currentEquityMicroUsd:string;price:UsdPrice}|{reset:false;alreadyClear:true;currentEquityMicroUsd:null;price:null});
/** Provenance only. Neither this bounded read nor its digest grants permission
 * to enter, changes a stop, or substitutes for fresh financial/market evidence. */
const INTERNAL_SHUTDOWN_PROOF_POLICY=Object.freeze({version:'internal-native-shutdown-chain-v1',maximumRuns:128,maximumStops:128,maximumControlIntents:512,maximumControlBytes:1024*1024});
const INTERNAL_SHUTDOWN_SOFT_PAUSES=new Set(['graceful native PAPER segment ended; exposure retained','native PAPER process closing; obligations retained','native PAPER routine checkpoint: fresh audited readiness required','execution startup: fresh reconciliation/readiness required','current equity or liquidation unavailable; entries closed','current financial reconciliation unavailable; exposure retained','entry preparation or reconciliation unavailable','consistent backup unavailable; exposure retained']);
const L = 1_000_000_000n;
const INITIAL = 1_000_000_000n; // $1,000 in microUSD
const MAX_PRICE_AGE = 10_000;
const MAX_QUOTE_AGE = 2_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const boundedText = (s: unknown, max = 512): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
const amount = (s: string) => {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s)) throw new Error('unsigned integer amount required');
  const n = BigInt(s);
  if (n > (1n << 127n) - 1n) throw new Error('amount exceeds supported bound');
  return n;
};
function priceAt(price: UsdPrice, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(price.at) ||
    price.at > now || now - price.at > MAX_PRICE_AGE || typeof price.source !== 'string' || !price.source || price.source.length > 512 ||
    amount(price.microUsdPerSol) === 0n) throw new Error('fresh timestamped USD conversion required');
  return amount(price.microUsdPerSol);
}
/** Shared input/history validation prevents a new readiness receipt from
 * becoming an unknown or unbounded historical control intent after restart. */
function runtimeReadinessKind(value:unknown,now:number,marks:unknown,revision?:number,accountId?:string,price?:unknown,unrestrictedPositions=false):'legacy'|'financial'|null{
 const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v),integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0,exact=(v:Record<string,unknown>,keys:string)=>Object.keys(v).sort().join(',')===keys;
 if(!object(value)||!boundedText(value.version,128)||!boundedText(value.evidence)||value.recoveryComplete!==true||value.budgetAvailable!==true)return null;
 if(value.version!==OPERATING_FINANCIAL_READINESS_VERSION)return exact(value,'budgetAvailable,candidateWindowsReady,evidence,marketAt,recoveryComplete,version')&&integer(value.marketAt)&&value.marketAt<=now&&now-value.marketAt<=MAX_QUOTE_AGE&&value.candidateWindowsReady===true?'legacy':null;
 const financialKeys='accountId,budgetAvailable,evidence,financialInventoryReady,positionUnits,purpose,reconciledAt,recoveryComplete,source,stateRevision,version'.split(',');if(Object.hasOwn(value,'technicalProtectionRecovery'))financialKeys.push('technicalProtectionRecovery');
 if(!exact(value,financialKeys.sort().join(','))||value.purpose!=='financial-permission-only'||value.financialInventoryReady!==true||!boundedText(value.accountId,160)||accountId!==undefined&&value.accountId!==accountId||!integer(value.stateRevision)||revision!==undefined&&value.stateRevision!==revision||!integer(value.reconciledAt)||value.reconciledAt>now||now-value.reconciledAt>MAX_QUOTE_AGE||!object(value.positionUnits)||!unrestrictedPositions&&Object.keys(value.positionUnits).length>3||!object(marks)||!object(value.source)||!exact(value.source,'bankClockAt,kind,receivedAt,validUntil'))return null;
 const source=value.source,keys=Object.keys(value.positionUnits).sort();if(!integer(source.bankClockAt)||!integer(source.receivedAt)||!integer(source.validUntil)||source.bankClockAt>source.receivedAt||source.receivedAt>now||source.validUntil!==source.bankClockAt+30000||now>source.validUntil||source.kind!==(keys.length?'complete-held-liquidation-context':'selected-native-support')||Object.keys(marks).sort().join('|')!==keys.join('|'))return null;
 try{for(const mint of keys){const units=value.positionUnits[mint],m=marks[mint];if(!boundedText(mint,96)||amount(units)===0n||!object(m)||!exact(m,'at,evidence,netLamports,pricedBaseUnits')||m.pricedBaseUnits!==units||!integer(m.at)||m.at>now||now-m.at>MAX_QUOTE_AGE||m.at<source.receivedAt||!boundedText(m.evidence)||/[\u0000-\u001f]/.test(m.evidence))return null;amount(m.netLamports);}}catch{return null;}
 if(Object.hasOwn(value,'technicalProtectionRecovery')){
  const p=value.technicalProtectionRecovery;if(!object(p)||!exact(p,'accountId,authoritySha256,completedAt,completedEvaluations,controlChangedAt,controlReason,inceptionAt,lastQuoteAt,maximumCompletedGapMs,originRevision,positionUnits,startedAt,stateRevision,version')||p.version!=='paper-technical-protection-recovery-v1'||p.accountId!==value.accountId||!integer(p.inceptionAt)||!integer(p.stateRevision)||p.stateRevision!==value.stateRevision||!integer(p.originRevision)||p.originRevision>p.stateRevision||!integer(p.controlChangedAt)||!TECHNICAL_PROTECTION_PAUSE_REASONS.includes(p.controlReason as never)||typeof p.authoritySha256!=='string'||!/^[a-f0-9]{64}$/.test(p.authoritySha256)||!isDeepStrictEqual(p.positionUnits,value.positionUnits)||!integer(p.startedAt)||p.startedAt<p.inceptionAt||p.startedAt<p.controlChangedAt||!integer(p.completedAt)||p.completedAt>now||now-p.completedAt>MAX_QUOTE_AGE||p.completedAt-p.startedAt<60000||!integer(p.completedEvaluations)||p.completedEvaluations<2||p.completedEvaluations>1000000||!integer(p.maximumCompletedGapMs)||p.maximumCompletedGapMs>4000||p.maximumCompletedGapMs===0||p.completedAt-p.startedAt>(p.completedEvaluations-1)*p.maximumCompletedGapMs||!integer(p.lastQuoteAt)||p.lastQuoteAt>p.completedAt||now-p.lastQuoteAt>MAX_QUOTE_AGE||(keys.length?p.lastQuoteAt!==Math.min(...keys.map(mint=>marks[mint].at)):!object(price)||p.lastQuoteAt!==price.at))return null;
 }
 return 'financial';
}
const usd = (lamports: bigint, price: bigint) => lamports * price / L;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateEntryStrategy(value:EntryStrategy,at:number){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==ADAPTIVE_PAPER_STRATEGY_VERSION&&value.version!==V3_PAPER_STRATEGY_VERSION||!Number.isSafeInteger(value.cycle)||value.cycle<1||!Number.isSafeInteger(value.windowStartAt)||value.windowStartAt<0||value.windowEndAt!==value.windowStartAt+60000||value.windowEndAt!==Math.floor(at/10000)*10000||!Number.isSafeInteger(value.assessedAt)||value.assessedAt<value.windowEndAt||value.assessedAt>at||!boundedText(value.signalId,160)||/[\u0000-\u001f]/.test(value.signalId))throw Error('adaptive entry strategy invariant');
}

/** Shared with backup/recovery validation. No database or financial mutation. */
export function validateOperatingReportingHistory(value:unknown,inceptionAt:number):OperatingReportingHistory {
  const h=value as OperatingReportingHistory,integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
  if(!integer(inceptionAt)||!h||typeof h!=='object'||Array.isArray(h)||Object.keys(h).sort().join(',')!=='basis,cutoverAt,downsampled,firstObservedAt,points,schemaVersion,windowLimited'||h.schemaVersion!==2||h.basis!==OPERATING_REPORTING_BASIS||typeof h.windowLimited!=='boolean'||typeof h.downsampled!=='boolean'||!Array.isArray(h.points)||h.points.length<1||h.points.length>720)throw Error('invalid operating reporting history metadata');
  if(h.cutoverAt!==null&&(!integer(h.cutoverAt)||h.cutoverAt<=inceptionAt)||h.firstObservedAt!==null&&(!integer(h.firstObservedAt)||h.cutoverAt===null||h.firstObservedAt<h.cutoverAt))throw Error('operating reporting cutover mismatch');
  let previous=-Infinity;
  for(const p of h.points){
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='at,economicMicroUsd,tradingMicroUsd'||!integer(p.at)||p.at<inceptionAt||p.at<=previous)throw Error('operating reporting chronology');
    for(const v of [p.tradingMicroUsd,p.economicMicroUsd])if(v!==null){if(typeof v!=='string'||!/^(-?(0|[1-9][0-9]*))$/.test(v))throw Error('integer operating reporting value required');amount(v.startsWith('-')?v.slice(1):v);}
    if(p.at>inceptionAt&&(p.tradingMicroUsd!==null||p.economicMicroUsd!==null)&&(h.cutoverAt===null||p.at<h.cutoverAt))throw Error('operating reporting value before cutover');
    if(p.at>inceptionAt&&p.tradingMicroUsd!==null&&(h.firstObservedAt===null||p.at<h.firstObservedAt))throw Error('operating reporting first observation mismatch');
    previous=p.at;
  }
  const first=h.points[0]!;
  if(first.at!==inceptionAt||first.tradingMicroUsd!=='0'||first.economicMicroUsd!==null)throw Error('operating reporting inception mismatch');
  if(h.cutoverAt===null&&(h.points.length!==1||h.firstObservedAt!==null||h.windowLimited||h.downsampled))throw Error('operating reporting cutover absent');
  if(h.cutoverAt!==null&&h.points.length<2)throw Error('operating reporting observations absent');
  if(h.firstObservedAt!==null&&!h.windowLimited&&!h.downsampled&&!h.points.some(p=>p.at===h.firstObservedAt&&p.tradingMicroUsd!==null))throw Error('operating reporting first observation absent');
  if(h.cutoverAt!==null&&h.cutoverAt>inceptionAt+1){const gap=h.points[1];if(!gap||gap.at!==inceptionAt+1||gap.tradingMicroUsd!==null||gap.economicMicroUsd!==null)throw Error('operating reporting inception gap absent');}
  return structuredClone(h);
}

/** Parent aliases share one lease; final DB aliases cannot split ownership or WAL identity. */
function canonicalDatabase(path: string): string {
  const absolute = resolve(path);
  const canonical = join(realpathSync(dirname(absolute)), basename(absolute));
  try {
    const s = lstatSync(canonical);
    if (!s.isFile() || s.nlink !== 1) throw new Error('financial database must be a regular non-symlink file with one link');
  } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
  return canonical;
}

/** Standard Linux flock on a separate inode. Never use a financial DB lock as a process lease. */
function acquireOwner(path: string): number {
  if (process.platform !== 'linux' || !process.geteuid) throw new Error('Linux advisory flock required');
  const uid = process.geteuid();
  const ownerPath = path + '.owner.lock';
  const parent = statSync(dirname(ownerPath));
  if (!parent.isDirectory() || parent.uid !== uid || parent.mode & 0o077) throw new Error('financial owner directory must be private and owner-held');
  const check = (s: Stats) => {
    if (!s.isFile() || s.uid !== uid || (s.mode & 0o7777) !== 0o600 || s.nlink !== 1) throw new Error('financial owner lock must be an owner-held regular non-symlink 0600 file with one link');
  };
  try { check(lstatSync(ownerPath)); }
  catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
  const fd = openSync(ownerPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const before = fstatSync(fd); check(before);
    // dup(fd) in the child shares the parent's open file description. Linux retains
    // this flock after the short helper exits until the parent's FD closes/SIGKILL.
    const lease = spawnSync('/usr/bin/flock', ['-xn', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd], timeout: 5000 });
    if (lease.error || lease.status !== 0) throw new Error(lease.status === 1 ? 'financial owner locked by another process' : 'Linux advisory flock unavailable; ownership not established');
    const after = lstatSync(ownerPath); check(after);
    if (after.dev !== before.dev || after.ino !== before.ino) throw new Error('financial owner lock changed during acquisition');
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}

/** Pure financial schema validation shared by writer recovery and read-only backups. */
export function validateFinancialState(s: LedgerState, accountId: string, mode: LedgerMode,options:{allowUnavailableEntryPolicy?:boolean}={}) {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const key = (v: unknown, max: number) => boundedText(v, max) && !['__proto__','constructor','prototype'].includes(v);
  const eventTime = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= s.inceptionAt && (v as number) <= s.lastAt;
  if (!record(s) || s.schemaVersion !== 1 || s.accountId !== accountId || s.mode !== mode || s.initialMicroUsd !== INITIAL.toString() || !Number.isSafeInteger(s.inceptionAt) || s.inceptionAt < 0 || !Number.isSafeInteger(s.lastAt) || s.lastAt < s.inceptionAt || !Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error('financial identity/state invariant');
  if(s.paperEpoch!==undefined)validatePaperEpoch(s.paperEpoch,s);
  if (!record(s.inceptionPrice)) throw new Error('inception conversion invariant');
  const inceptionPrice = priceAt(s.inceptionPrice, s.inceptionAt);
  const initialLamports = INITIAL * L / inceptionPrice;
  if (amount(s.roundingResidualMicroUsd) !== INITIAL - usd(initialLamports, inceptionPrice)) throw new Error('inception rounding invariant');
  if (!record(s.controls) || typeof s.controls.entriesEnabled !== 'boolean' || typeof s.controls.stopRequested !== 'boolean' || !boundedText(s.controls.reason) || !eventTime(s.controls.changedAt) || !(s.controls.readinessVersion === null || boundedText(s.controls.readinessVersion, 128)) || s.controls.stopRequested && s.controls.entriesEnabled || s.mode === 'PAPER' && s.controls.entriesEnabled && s.controls.readinessVersion === null) throw new Error('financial recovery/control invariant');
  if (!record(s.daily) || typeof s.daily.lossPaused !== 'boolean' || typeof s.daily.paused !== 'boolean' || s.daily.lossPaused && !s.daily.paused || !Number.isSafeInteger(s.daily.reconciledAt) || s.daily.reconciledAt < 0 || s.daily.reconciledAt > s.lastAt || typeof s.daily.day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s.daily.day) || utcDay(Date.parse(s.daily.day + 'T00:00:00.000Z')) !== s.daily.day || s.daily.day < utcDay(s.inceptionAt) || s.daily.day > utcDay(s.lastAt) || s.daily.reconciledAt > 0 && utcDay(s.daily.reconciledAt) !== s.daily.day) throw new Error('financial day/reconciliation invariant');
  const cash = amount(s.lamports); const gasReserve = amount(s.gasReserve);
  if (initialLamports <= gasReserve) throw new Error('inception gas reserve invariant');
  amount(s.executionCosts); amount(s.daily.baselineMicroUsd);
  if (typeof s.realizedLamports !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(s.realizedLamports) || amount(s.realizedLamports.startsWith('-') ? s.realizedLamports.slice(1) : s.realizedLamports) > (1n << 127n) - 1n) throw new Error('realized balance invariant');
  if (!record(s.positions) || !record(s.pending) || !record(s.lockedDeposits) || !isV3PaperEpochState(s)&&(Object.keys(s.positions).length > 3 || Object.keys(s.pending).length > 3)) throw new Error('capacity/state map invariant');
  for (const [mint, deposit] of Object.entries(s.lockedDeposits)) {
    if (!key(mint, 96)) throw new Error('locked deposit identity invariant');
    amount(deposit);
  }
  for (const [mint, p] of Object.entries(s.positions)) {
    if (!record(p) || !key(mint, 96) || p.mint !== mint || !eventTime(p.enteredAt) || amount(p.units) === 0n || amount(p.entryLamports) === 0n || amount(p.entryGas) === 0n || (p.allocation===undefined&&amount(p.costMicroUsd) > 50_000_000n) || amount(p.deposit) > amount(s.lockedDeposits[mint] ?? '0')) throw new Error('position identity/amount invariant');
    if(p.executionModelVersion!==undefined&&p.executionModelVersion!=='paper-chain-conditioned-v1')throw Error('position execution model version invariant');
    if(p.allocation!==undefined){if(!s.equityRisk&&!options.allowUnavailableEntryPolicy)throw Error('position allocation policy unavailable');validateEntryAllocation(p.allocation,p.enteredAt,amount(p.entryLamports)+amount(p.entryGas));if(amount(p.costMicroUsd)!==usd(amount(p.allocation.consumedLamports),amount(p.allocation.microUsdPerSol)))throw Error('position allocation cost invariant');}
    if(p.strategy!==undefined){validateEntryStrategy(p.strategy,p.strategy.assessedAt);if(!boundedText(p.strategy.roundTripId,100)||!Number.isSafeInteger(p.strategy.highWaterAt)||p.strategy.highWaterAt<p.enteredAt||p.strategy.highWaterAt>s.lastAt||p.strategy.assessedAt>p.enteredAt)throw Error('adaptive position strategy invariant');amount(p.strategy.highWaterNetLamports);if(p.strategy.profitProtectionFloorLamports!==undefined&&(p.strategy.version!==V3_PAPER_STRATEGY_VERSION||amount(p.strategy.profitProtectionFloorLamports)<=amount(p.entryLamports)+amount(p.entryGas)||amount(p.strategy.profitProtectionFloorLamports)>amount(p.strategy.highWaterNetLamports)))throw Error('V3 executable profit floor invariant');}
  }
  let reservations = 0n;
  const pendingMints = new Set<string>(); let pendingBuys = 0;
  for (const [id, o] of Object.entries(s.pending)) {
    if (!record(o) || !key(id, 100) || o.id !== id || !key(o.mint, 96) || pendingMints.has(o.mint) || !eventTime(o.decidedAt) || !Number.isSafeInteger(o.executeAt) || !Number.isSafeInteger(o.expiresAt) || o.executeAt < o.decidedAt + 500 || o.expiresAt <= o.executeAt || o.expiresAt > o.decidedAt + 30_000 || !boundedText(o.decisionEvidence) || amount(o.gas) === 0n || amount(o.minReceive) === 0n) throw new Error('pending order identity/time/amount invariant');
    const gas = amount(o.gas), spend = amount(o.maxSpend), deposit = amount(o.deposit), reserved = amount(o.reserved);
    if(o.executionModel!==undefined&&(!validatePaperExecutionPlan(o.executionModel)||o.executionModel.plannedAt!==o.decidedAt||o.executionModel.executeAt!==o.executeAt||o.executionModel.expiresAt!==o.expiresAt||paperExecutionFee(o.executionModel)!==o.gas||o.temporaryRentLamports!==o.executionModel.temporaryQuoteRentLamports))throw Error('pending execution model invariant');
    const temporary=amount(o.temporaryRentLamports??'0');if(!o.executionModel&&o.temporaryRentLamports!==undefined)throw Error('temporary rent requires supported execution model');
    if(o.allocation!==undefined){if(o.side!=='buy')throw Error('allocation belongs to entry only');validateEntryAllocation(o.allocation,o.decidedAt,gas+spend);}
    if(o.entryStrategy!==undefined){if(o.side!=='buy')throw Error('adaptive strategy belongs to entry only');validateEntryStrategy(o.entryStrategy,o.decidedAt);}
    if (o.side === 'buy') {
      pendingBuys++;
      if (spend === 0n || s.positions[o.mint] || reserved !== gas + spend + deposit + temporary || deposit > 0n && s.lockedDeposits[o.mint]) throw new Error('pending buy reservation invariant');
    } else if (o.side === 'sell') {
      if (!s.positions[o.mint] || spend !== 0n || deposit !== 0n || reserved !== gas + temporary) throw new Error('pending exit reservation invariant');
    } else throw new Error('pending order side invariant');
    pendingMints.add(o.mint); reservations += reserved;
  }
  if(s.equityRisk!==undefined)try{validateEquityRiskState(s.equityRisk,s.inceptionAt,s.lastAt,s.revision);}catch(error){if(!options.allowUnavailableEntryPolicy)throw error;}
  // The gas reserve protects NEW entries, not exits. Held-position management
  // may consume it, but no action may spend another action's reservation.
  if (reservations > cash || !isV3PaperEpochState(s)&&Object.keys(s.positions).length + pendingBuys > 3) throw new Error('cash reservation/capacity invariant');
}

export class PaperLedger {
  private readonly db: Database.Database;
  private readonly historicalClosedCycles=new Map<string,ClosedCycle|null>();
  private ownerFd: number | undefined;
  readonly sqlite: { version: string; source: string };

  constructor(path: string, readonly accountId: string, readonly mode: LedgerMode = 'PAPER') {
    if (mode === 'DISPOSABLE_PAPER' ? !/^fixture-[a-z0-9-]{1,80}$/.test(accountId) : mode !== 'PAPER' || !/^poe-[a-z0-9-]{1,80}$/.test(accountId)) throw new Error('explicit POE or disposable fixture identity required');
    if (mode === 'PAPER' && (path === ':memory:' || path.length === 0)) throw new Error('durable PAPER account path required');
    const database = path === ':memory:' ? path : canonicalDatabase(path);
    if (database !== ':memory:') this.ownerFd = acquireOwner(database);
    let opened: Database.Database | undefined;
    try {
      if (database !== ':memory:') canonicalDatabase(database); // Recheck after acquiring the owner lease.
      this.db = opened = new Database(database, { timeout: 100 });
      this.sqlite = this.db.prepare('SELECT sqlite_version() version, sqlite_source_id() source').get() as typeof this.sqlite;
      const [major, minor, patch] = this.sqlite.version.split('.').map(Number);
      if (!(major! > 3 || major === 3 && (minor! > 51 || minor === 51 && patch! >= 3))) throw new Error('SQLite WAL-reset fixed version >=3.51.3 required');
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 5").all() as { name: string }[];
      if (tables.length && (!['financial_state','actions','journal'].every(name => tables.some(row => row.name === name)) || tables.some(row => !['financial_state','actions','journal','metadata'].includes(row.name)))) throw new Error('foreign database schema; refusing to initialize or modify');
      // Financial locks last only for short synchronous transactions. The separate
      // advisory flock owns the writer while network/market/reporting work awaits.
      this.db.pragma('locking_mode = NORMAL');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('wal_autocheckpoint = 128');
      this.db.exec(`CREATE TABLE IF NOT EXISTS financial_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS journal (
        revision INTEGER PRIMARY KEY, action_id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      const existing = this.read();
      if (existing && ((existing.accountId ?? existing.fixtureId) !== accountId || existing.mode !== mode)) throw new Error('wrong fixture account or PAPER identity/mode');
      if (existing) { this.assertState(existing); this.getOperatingCosts(); }
      else if ((this.db.prepare('SELECT (SELECT count(*) FROM actions) + (SELECT count(*) FROM journal) + (SELECT count(*) FROM metadata) records').get() as { records: number }).records > 0) throw new Error('financial state missing from populated account; recovery required, never reseed');
    } catch (e) {
      try { opened?.close(); }
      finally { if (this.ownerFd !== undefined) { closeSync(this.ownerFd); this.ownerFd = undefined; } }
      throw e;
    }
  }

  private read(): State | undefined {
    const row = this.db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as { body: string } | undefined;
    return row ? JSON.parse(row.body) as State : undefined;
  }
  state(): Readonly<State> {
    const s = this.read();
    if (!s) throw new Error('PAPER account not initialized');
    if(s.paperEpoch)this.validateEpochAnchor(s);else if(this.db.prepare('SELECT 1 FROM actions WHERE id IN (?,?) UNION ALL SELECT 1 FROM journal WHERE action_id IN (?,?) LIMIT 1').get('epoch:'+PAPER_TEN_SOL_EPOCH_ID,'epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID,'epoch:'+PAPER_TEN_SOL_EPOCH_ID,'epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID))throw Error('PAPER_EPOCH_STATE_MISSING_FROM_RECORDED_HISTORY');
    if(s.paperEpoch?.id===PAPER_TEN_SOL_EPOCH_ID&&this.db.prepare('SELECT 1 FROM journal WHERE action_id=? LIMIT 1').get('epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID))throw Error('PAPER_V3_EPOCH_STATE_REGRESSED');
    return s;
  }
  private validateEpochAnchor(s:State){
    const epoch=s.paperEpoch;if(!epoch)return;validatePaperEpoch(epoch,s);
    const id='epoch:'+epoch.id,row=this.db.prepare('SELECT a.payload_hash payloadHash,a.result,j.revision,j.at,j.kind,j.detail FROM actions a JOIN journal j ON j.action_id=a.id WHERE a.id=?').get(id) as {payloadHash:string;result:string;revision:number;at:number;kind:string;detail:string}|undefined;
    if(!row||row.kind!=='paper-epoch-transition'||row.at!==epoch.startedAt||row.revision!==epoch.transitionRevision||Buffer.byteLength(row.detail)>65536||Buffer.byteLength(row.result)>65536)throw Error('PAPER_EPOCH_HISTORY_UNAVAILABLE');
    const payload=JSON.parse(row.detail),result=JSON.parse(row.result),v3=epoch.id===PAPER_V3_TEN_SOL_EPOCH_ID;
    if(row.payloadHash!==digest({kind:row.kind,payload})||payload.authorization!==(v3?PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION:PAPER_TEN_SOL_EPOCH_AUTHORIZATION)||!isDeepStrictEqual(result.epoch,epoch)||!isDeepStrictEqual(payload.epoch,epoch)||paperEpochStateSha256(payload.previousState)!==epoch.priorStateSha256||payload.backup?.backupSha256!==epoch.backupSha256||payload.backup.stateSha256!==epoch.priorStateSha256||payload.backup.revision!==epoch.transitionRevision-1||payload.backup.accountId!==s.accountId||payload.backup.inceptionAt!==s.inceptionAt||Object.keys(epoch.archivedAssets.lockedDeposits).length>0&&payload.assetDisposition!==PAPER_EPOCH_ASSET_SEGREGATION||(!v3&&payload.previousState?.paperEpoch!==undefined)||payload.previousState?.accountId!==s.accountId||payload.previousState?.inceptionAt!==s.inceptionAt||epoch.archivedAssets.cashLamports!==payload.previousState.lamports||!isDeepStrictEqual(epoch.archivedAssets.lockedDeposits,Object.fromEntries(Object.entries(payload.previousState.lockedDeposits).filter(([,v])=>BigInt(v as string)>0n))))throw Error('PAPER_EPOCH_HISTORY_UNAVAILABLE');
    if(v3){if(!isDeepStrictEqual(epoch.priorEpoch,payload.previousState.paperEpoch)||!isDeepStrictEqual(payload.riskPolicy,PAPER_V3_EQUITY_RISK_POLICY)||result.equityRisk?.version!==PAPER_V3_EQUITY_RISK_VERSION||result.equityRisk?.activatedAt!==epoch.startedAt||result.equityRisk?.activationRevision!==epoch.transitionRevision)throw Error('PAPER_V3_EPOCH_HISTORY_UNAVAILABLE');this.validateEpochAnchor(payload.previousState);}
  }
  private assertState(s: State) { validateFinancialState(s, this.accountId, this.mode,{allowUnavailableEntryPolicy:true}); }
  private apply<T>(id: string, kind: string, now: number, payload: unknown, fn: (s: State) => T): T {
    if (!id || id.length > 160 || !Number.isSafeInteger(now)) throw new Error('invalid action identity/time');
    if (JSON.stringify(payload).length > 65_536) throw new Error('financial action payload limit');
    const hash = digest({ kind, payload });
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT payload_hash, result FROM actions WHERE id=?').get(id) as { payload_hash: string; result: string } | undefined;
      if (prior) {
        if (prior.payload_hash !== hash) throw new Error('idempotency conflict');
        return JSON.parse(prior.result) as T;
      }
      const s = this.read(); if (!s) throw new Error('PAPER account not initialized');
      if (now < s.lastAt) throw new Error('financial time regression');
      const result = fn(s);
      s.lastAt = now; s.revision++; this.assertState(s);
      this.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(s));
      this.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id, hash, JSON.stringify(result));
      this.db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(s.revision, id, now, kind, JSON.stringify(payload));
      return result;
    }).immediate();
  }

  initialize(price: UsdPrice, at: number, gasReserve = '5000000') {
    return this.db.transaction(() => {
      const old = this.read();
      if (old) return old; // Never reseed or require a new conversion on recovery.
      const p = priceAt(price, at); const reserve = amount(gasReserve);
      const cash = INITIAL * L / p;
      if (cash <= reserve) throw new Error('insufficient simulated gas capital');
      const s: State = {
        schemaVersion: 1,
        accountId: this.accountId, ...(this.mode === 'DISPOSABLE_PAPER' ? { fixtureId: this.accountId } : {}), mode: this.mode, inceptionAt: at,
        initialMicroUsd: INITIAL.toString(), inceptionPrice: price, lamports: cash.toString(),
        roundingResidualMicroUsd: (INITIAL - usd(cash, p)).toString(), gasReserve,
        positions: {}, pending: {}, lockedDeposits: {}, lastAt: at, realizedLamports: '0', executionCosts: '0',
        daily: { day: utcDay(at), baselineMicroUsd: INITIAL.toString(), paused: true, lossPaused: false, reconciledAt: 0 }, revision: 0,
        controls: { entriesEnabled: this.mode === 'DISPOSABLE_PAPER', reason: this.mode === 'PAPER' ? 'startup: observation only; explicit runtime readiness required' : 'disposable fixture', changedAt: at, readinessVersion: null, stopRequested: false },
      };
      this.assertState(s);
      this.db.prepare('INSERT INTO financial_state VALUES(1,?)').run(JSON.stringify(s));
      this.db.prepare('INSERT INTO journal VALUES(0,?,?,?,?)').run('inception', at, 'inception', JSON.stringify({ price, gasReserve, mode: s.mode }));
      // One factual inception point from the recorded virtual contribution and
      // exact USD residual, not a synthetic price series or historical flatline.
      this.db.prepare("INSERT INTO metadata VALUES('reporting_history',?)").run(JSON.stringify({ points: [{ at, tradingMicroUsd: '0', economicMicroUsd: null }], windowLimited: false, downsampled: false } satisfies ReportingHistory));
      return s;
    }).immediate();
  }

  private equity(s: State, price: bigint, marks: Record<string, Mark>, now: number): bigint {
    let liquid = amount(s.lamports);
    for (const p of Object.values(s.positions)) {
      const mark = marks[p.mint];
      if (!mark || !boundedText(mark.evidence) || mark.pricedBaseUnits !== p.units || !Number.isSafeInteger(mark.at) || mark.at > now || now - mark.at > MAX_QUOTE_AGE) throw new Error('unknown/stale/wrong-size liquidation mark');
      liquid += amount(mark.netLamports);
    }
    for (const deposit of Object.values(s.lockedDeposits)) liquid += amount(deposit);
    return usd(liquid, price) + (s.paperEpoch?0n:amount(s.roundingResidualMicroUsd));
  }

  /** Audited one-time activation. No entry permission, stop clearance, cash or
   * historical repricing. Reconciliation scans all retained same-day receipts
   * incrementally so migration cannot monopolize a protection-critical tick. */
  activateEquityRiskPolicy(now:number){
    const state=this.state(),status=this.equityRiskStatus(state);if(status.kind==='active')return structuredClone(state.equityRisk!);if(status.kind==='unavailable')throw Error('equity risk activation/state unavailable; new risk closed');
    return this.apply('activate:'+PAPER_EQUITY_RISK_VERSION,'equity-risk-policy-activation',now,{version:PAPER_EQUITY_RISK_VERSION,policy:PAPER_EQUITY_RISK_POLICY},s=>{
      s.equityRisk={version:PAPER_EQUITY_RISK_VERSION,activatedAt:now,activationRevision:s.revision+1,daily:this.newRiskDay(s,now)};
      return structuredClone(s.equityRisk);
    });
  }
  /** Optional entry-policy corruption closes new risk while the independent
   * cash/inventory/order invariants still permit genuine existing exits. */
  private equityRiskStatus(s:State):{kind:'legacy'|'active'|'unavailable';reasonCode?:'EQUITY_RISK_POLICY_INVALID'|'EQUITY_RISK_HISTORY_UNAVAILABLE'}{
    if(s.paperEpoch?.id===PAPER_V3_TEN_SOL_EPOCH_ID||s.equityRisk?.version===PAPER_V3_EQUITY_RISK_VERSION){
      try{if(!isV3PaperRiskState(s))throw Error();validateEquityRiskState(s.equityRisk,s.inceptionAt,s.lastAt,s.revision);this.validateEpochAnchor(s);
        const risk=s.equityRisk!;if(risk.activatedAt!==s.paperEpoch!.startedAt||risk.activationRevision!==s.paperEpoch!.transitionRevision)throw Error();
      }catch{return {kind:'unavailable',reasonCode:'EQUITY_RISK_HISTORY_UNAVAILABLE'};}
      return {kind:'active'};
    }
    const anchor=this.db.prepare('SELECT a.payload_hash payloadHash,a.result,j.revision,j.at,j.kind,j.detail FROM (SELECT ? id) x LEFT JOIN actions a ON a.id=x.id LEFT JOIN journal j ON j.action_id=x.id').get('activate:'+PAPER_EQUITY_RISK_VERSION) as {payloadHash:string|null;result:string|null;revision:number|null;at:number|null;kind:string|null;detail:string|null};
    if(s.equityRisk===undefined)return anchor.result!==null||anchor.detail!==null?{kind:'unavailable',reasonCode:'EQUITY_RISK_HISTORY_UNAVAILABLE'}:{kind:'legacy'};
    try{validateEquityRiskState(s.equityRisk,s.inceptionAt,s.lastAt,s.revision);}catch{return {kind:'unavailable',reasonCode:'EQUITY_RISK_POLICY_INVALID'};}
    try{if(!anchor.result||!anchor.detail||Buffer.byteLength(anchor.result)>65536||Buffer.byteLength(anchor.detail)>65536||anchor.kind!=='equity-risk-policy-activation'||anchor.revision!==s.equityRisk.activationRevision||anchor.at!==s.equityRisk.activatedAt)throw Error();const payload=JSON.parse(anchor.detail),result=JSON.parse(anchor.result);if(anchor.payloadHash!==digest({kind:anchor.kind,payload})||!isDeepStrictEqual(payload,{version:PAPER_EQUITY_RISK_VERSION,policy:PAPER_EQUITY_RISK_POLICY})||result.version!==PAPER_EQUITY_RISK_VERSION||result.activatedAt!==anchor.at||result.activationRevision!==anchor.revision)throw Error();}catch{return {kind:'unavailable',reasonCode:'EQUITY_RISK_HISTORY_UNAVAILABLE'};}
    return {kind:'active'};
  }
  v3RiskPolicyActive(){const s=this.state();return isV3PaperRiskState(s)&&this.equityRiskStatus(s).kind==='active';}
  private newRiskDay(s:State,now:number):EquityRiskState['daily']{return {day:utcDay(now),highWaterMicroUsd:null,highWaterAt:null,lossPaused:false,historyState:'scanning',historyCoverage:'unavailable',historyCutoffRevision:s.revision,historyCursorRevision:0,historyReceipts:0,historyDigest:digest({version:s.equityRisk?.version??PAPER_EQUITY_RISK_VERSION,day:utcDay(now),accountId:s.accountId,inceptionAt:s.inceptionAt,cutoffRevision:s.revision})};}
  private scanRiskHistory(s:State,now:number){
    const risk=s.equityRisk;if(!risk)return;const d=risk.daily;if(d.historyState!=='scanning')return;
    const dayStart=Date.parse(d.day+'T00:00:00.000Z'),from=Math.max(dayStart,s.paperEpoch?.startedAt??0),through=dayStart+86400000;
    type Receipt={revision:number;actionId:string;at:number;detail:string;payloadHash:string|null;result:string|null};
    const rows=this.db.prepare("SELECT j.revision,j.action_id actionId,j.at,j.detail,a.payload_hash payloadHash,a.result FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>? AND j.revision<=? AND j.at>=? AND j.at<? AND j.kind='reconcile' ORDER BY j.revision LIMIT 257").all(d.historyCursorRevision,d.historyCutoffRevision,from,through) as Receipt[];
    try{
    // Revisions are the original contiguous0..cutoff financial prefix. A
    // receipt query alone cannot see a missing driving journal row. Check
    // indexed cardinality/identity before consuming and again at certification.
    const prefix=this.db.prepare('SELECT count(*) count,min(revision) first,max(revision) last FROM journal WHERE revision<=?').get(d.historyCutoffRevision) as {count:number;first:number;last:number};
    if(prefix.first!==0||prefix.last!==d.historyCutoffRevision||prefix.count!==d.historyCutoffRevision+1||this.db.prepare('SELECT 1 FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>0 AND j.revision<=? AND a.id IS NULL LIMIT 1').get(d.historyCutoffRevision))throw Error('risk history prefix incomplete');
    for(const row of rows.slice(0,256)){
      if(!Number.isSafeInteger(row.at)||row.at>now||!boundedText(row.actionId,160)||!row.result||Buffer.byteLength(row.detail)>65536||Buffer.byteLength(row.result)>65536)throw Error('risk history receipt unavailable');
      const payload=JSON.parse(row.detail),result=JSON.parse(row.result);if(payload.now!==row.at||digest({kind:'reconcile',payload})!==row.payloadHash||typeof result.paused!=='boolean')throw Error('risk history identity mismatch');priceAt(payload.price,row.at);const value=amount(result.equityMicroUsd);
      if(d.highWaterMicroUsd===null||value>amount(d.highWaterMicroUsd)){d.highWaterMicroUsd=value.toString();d.highWaterAt=row.at;}
      d.historyReceipts++;d.historyCursorRevision=row.revision;d.historyDigest=digest({previous:d.historyDigest,revision:row.revision,actionId:row.actionId,at:row.at,payloadHash:row.payloadHash,resultSha256:digest(result)});
    }
    if(rows.length<=256){d.historyCursorRevision=d.historyCutoffRevision;d.historyState='complete';d.historyCoverage=d.historyReceipts?'verified-retained-same-day':'first-complete-observation';}
    }catch{d.historyState='invalid';d.historyCoverage='unavailable';}
  }
  private observeEquityRisk(s:State,now:number,equity:bigint,scan=false){
    const policy=this.equityRiskStatus(s);if(policy.kind==='unavailable')return false;
    if(policy.kind==='legacy'){if(BigInt(s.daily.baselineMicroUsd)-equity>=50_000_000n){s.daily.paused=true;s.daily.lossPaused=true;}return true;}
    if(s.equityRisk!.daily.day!==utcDay(now))s.equityRisk!.daily=this.newRiskDay(s,now);
    const d=s.equityRisk!.daily,legacyLoss=s.daily.lossPaused;
    if(scan)this.scanRiskHistory(s,now);
    if(d.highWaterMicroUsd===null||equity>amount(d.highWaterMicroUsd)){d.highWaterMicroUsd=equity.toString();d.highWaterAt=now;}
    if(d.historyState!=='complete')return false;
    if(isV3PaperRiskState(s)){
      // V3 records drawdown but has no portfolio loss admission latch. The
      // superseded latches remain in the immutable previous epoch journal.
      d.lossPaused=false;s.daily.lossPaused=false;
      if(legacyLoss&&s.controls.entriesEnabled&&!s.controls.stopRequested)s.daily.paused=false;
      return true;
    }
    if(drawdownFacts(amount(d.highWaterMicroUsd),equity).breached)d.lossPaused=true;
    s.daily.lossPaused=d.lossPaused;if(d.lossPaused)s.daily.paused=true;
    else if(legacyLoss&&s.controls.entriesEnabled&&!s.controls.stopRequested)s.daily.paused=false;
    return true;
  }
  /** Current 5% consumed-cost sizing only; no qualification or order claim. */
  entryRiskBudget(now:number,price:UsdPrice,marks:Record<string,Mark>={},deposit='0',temporaryRent='0'){
    const s=this.state(),p=priceAt(price,now),equity=this.equity(s,p,marks,now),reserved=Object.values(s.pending).reduce((n,o)=>n+amount(o.reserved),0n),cash=amount(s.lamports),protectedCash=reserved+amount(s.gasReserve)+amount(deposit)+amount(temporaryRent),available=cash>protectedCash?cash-protectedCash:0n;
    const policy=this.equityRiskStatus(s),maximum=policy.kind==='unavailable'?0n:policy.kind==='active'?consumedEntryAllowance(equity,p):50_000_000n*L/p;
    const ready=policy.kind==='legacy'||policy.kind==='active'&&s.equityRisk!.daily.day===utcDay(now)&&s.equityRisk!.daily.historyState==='complete';
    return {ready,maximumConsumedLamports:maximum.toString(),cashLimitedConsumedLamports:(maximum<available?maximum:available).toString(),equityMicroUsd:equity.toString(),microUsdPerSol:p.toString()};
  }

  private updateAdaptiveHighWater(s:State,now:number,marks:Record<string,Mark>){
    const updated:string[]=[];
    for(const position of Object.values(s.positions))if(position.strategy){const mark=marks[position.mint];if(!mark)continue;if(!boundedText(mark.evidence)||mark.pricedBaseUnits!==position.units||!Number.isSafeInteger(mark.at)||mark.at<position.enteredAt||mark.at>now||now-mark.at>MAX_QUOTE_AGE)throw Error('adaptive high-water requires fresh exact-size liquidation evidence');if(mark.at>=position.strategy.highWaterAt&&amount(mark.netLamports)>amount(position.strategy.highWaterNetLamports)){position.strategy.highWaterNetLamports=mark.netLamports;position.strategy.highWaterAt=mark.at;updated.push(position.mint);}}
    return updated;
  }
  /** Fresh SOL liquidation remains useful protection during unavailable USD.
   * A higher peak is durable in this SAME writer; this never reconciles USD,
   * changes cash/daily controls, grants entry or invents an unavailable mark. */
  checkpointAdaptiveProtection(id:string,now:number,marks:Record<string,Mark>){
    const probe=structuredClone(this.state()),valid:Record<string,Mark>={},unavailable:string[]=[];
    for(const position of Object.values(probe.positions))if(position.strategy){const mark=marks[position.mint];let usable=false;try{usable=!!mark&&boundedText(mark.evidence)&&mark.pricedBaseUnits===position.units&&Number.isSafeInteger(mark.at)&&mark.at>=position.enteredAt&&mark.at<=now&&now-mark.at<=MAX_QUOTE_AGE; if(usable)amount(mark!.netLamports);}catch{usable=false;}if(usable)valid[position.mint]=mark!;else unavailable.push(position.mint);}
    if(!this.updateAdaptiveHighWater(probe,now,valid).length)return {updated:[] as string[],unavailable};
    return this.apply(id,'adaptive-protection-peak',now,{now,marks:valid},s=>({updated:this.updateAdaptiveHighWater(s,now,valid),unavailable}));
  }
  /** Persist a tighter V3 executable-profit floor in the original writer.
   * This cannot reprice cash, clear controls or loosen protection after restart. */
  checkpointV3ProtectionFloor(id:string,now:number,input:{mint:string;units:string;roundTripId:string;floorLamports:string;quoteAt:number;evidence:string}){
    const check=(s:Readonly<State>)=>{
      const p=s.positions[input.mint],floor=amount(input.floorLamports);
      if(!p||p.strategy?.version!==V3_PAPER_STRATEGY_VERSION||p.units!==input.units||p.strategy.roundTripId!==input.roundTripId||!Number.isSafeInteger(now)||!Number.isSafeInteger(input.quoteAt)||input.quoteAt<p.enteredAt||input.quoteAt>now||now-input.quoteAt>MAX_QUOTE_AGE||!boundedText(input.evidence)||floor<=amount(p.entryLamports)+amount(p.entryGas)||floor>amount(p.strategy.highWaterNetLamports))throw Error('V3 fresh exact-inventory executable profit floor required');
      return {floor,prior:amount(p.strategy.profitProtectionFloorLamports??'0')};
    };
    const previous=check(this.state());if(previous.floor<=previous.prior)return {updated:false,floorLamports:previous.prior.toString()};
    return this.apply(id,'v3-protection-profit-floor',now,{now,...input},s=>{
      const value=check(s);if(value.floor<=value.prior)return {updated:false,floorLamports:value.prior.toString()};
      s.positions[input.mint]!.strategy!.profitProtectionFloorLamports=value.floor.toString();return {updated:true,floorLamports:value.floor.toString()};
    });
  }

  reconcile(id: string, now: number, price: UsdPrice, marks: Record<string, Mark>) {
    const p = priceAt(price, now);
    return this.apply(id, 'reconcile', now, { now, price, marks }, s => {
      const equity = this.equity(s, p, marks, now);
      // Reuse the sole existing reconciliation transaction. Never create a
      // diagnostic writer or advance a peak from stale/wrong-size evidence.
      this.updateAdaptiveHighWater(s,now,marks);
      if (s.daily.day !== utcDay(now)) {
        s.daily = { day: utcDay(now), baselineMicroUsd: equity.toString(), paused: false, lossPaused: false, reconciledAt: now };
      } else {
        // Inception starts closed, and only fresh reconciliation opens it.
        if (s.daily.reconciledAt === 0) s.daily.paused = false;
        s.daily.reconciledAt = now;
      }
      this.observeEquityRisk(s,now,equity,true);
      return { equityMicroUsd: equity.toString(), paused: s.daily.paused };
    });
  }

  pause(id: string, now: number, reason = 'operator paused new entries') {
    if (!boundedText(reason)) throw new Error('bounded pause reason required');
    return this.apply(id, 'pause', now, { now, reason }, s => {
      s.daily.paused = true; s.controls.entriesEnabled = false;
      s.controls.reason = reason; s.controls.changedAt = now;
      const canceled = Object.values(s.pending).filter(o => o.side === 'buy').map(o => o.id);
      // Preserve already-decided actions until their modeled attempt/cancel is recorded.
      return { paused: true, pendingBuyCancellations: canceled };
    });
  }

  /** One explicit owner-authorized current-day risk reset, through the sole
   * financial writer. Stable id+reason identifies the authorization; changing
   * observational time/price on a retry returns its ORIGINAL durable receipt,
   * never another waiver after a subsequent loss. No entry control is armed. */
  dailyLossResetReceipt(id:string,reason:string):DailyLossResetReceipt|null{
    const record=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value);
    if(!id||id.length>160||!boundedText(reason)||/[\u0000-\u001f]/.test(reason))throw Error('invalid owner reset authorization');
    const prior=this.db.prepare('SELECT payload_hash,result FROM actions WHERE id=?').get(id)as{payload_hash:string;result:string}|undefined;
    if(!prior)return null;
    if(prior.payload_hash!==digest({kind:'owner-daily-loss-reset',payload:{reason}}))throw Error('idempotency conflict');
    const result=JSON.parse(prior.result)as DailyLossResetReceipt,state=this.state();
    const fields='reset alreadyClear accountId inceptionAt at reason revisionBefore revisionAfter previousDaily currentEquityMicroUsd nextDaily price controlsPreserved entryPermissionGranted orderCreated'.split(' ').sort().join('|'),dailyFields='day baselineMicroUsd paused lossPaused reconciledAt'.split(' ').sort().join('|');
    if(!record(result)||Object.keys(result).sort().join('|')!==fields||typeof result.reset!=='boolean'||result.alreadyClear!==!result.reset||result.accountId!==this.accountId||result.inceptionAt!==state.inceptionAt||result.reason!==reason||result.entryPermissionGranted!==false||result.orderCreated!==false||result.controlsPreserved!==true||!Number.isSafeInteger(result.at)||result.at<state.inceptionAt||result.at>state.lastAt||!Number.isSafeInteger(result.revisionBefore)||result.revisionBefore<0||result.revisionAfter!==result.revisionBefore+1||result.revisionAfter>state.revision)throw Error('owner reset receipt unavailable');
    if(!record(result.previousDaily)||!record(result.nextDaily)||Object.keys(result.previousDaily).sort().join('|')!==dailyFields||Object.keys(result.nextDaily).sort().join('|')!==dailyFields||result.previousDaily.day!==utcDay(result.at)||typeof result.previousDaily.paused!=='boolean'||!Number.isSafeInteger(result.previousDaily.reconciledAt)||result.previousDaily.reconciledAt<0||result.previousDaily.reconciledAt>result.at)throw Error('owner reset daily receipt unavailable');
    amount(result.previousDaily.baselineMicroUsd);
    if(result.reset){
      amount(result.currentEquityMicroUsd);
      if(result.previousDaily.lossPaused!==true||result.previousDaily.paused!==true||result.previousDaily.reconciledAt<=0||result.at-result.previousDaily.reconciledAt>MAX_QUOTE_AGE||!isDeepStrictEqual(result.nextDaily,{...result.previousDaily,baselineMicroUsd:result.currentEquityMicroUsd,lossPaused:false,paused:true})||!record(result.price)||Object.keys(result.price).sort().join('|')!=='at|microUsdPerSol|source')throw Error('owner reset observation receipt unavailable');
      priceAt(result.price,result.at);
    }else if(result.previousDaily.lossPaused!==false||result.currentEquityMicroUsd!==null||result.price!==null||!isDeepStrictEqual(result.previousDaily,result.nextDaily))throw Error('owner reset no-op receipt unavailable');
    return result;
  }
  /** Even an already-clear reply consumes this ONE owner authorization before
   * transmission, so a lost reply cannot later waive a new loss. */
  consumeDailyLossResetNoop(id:string,now:number,reason:string):DailyLossResetReceipt{
    if(!boundedText(reason)||/[\u0000-\u001f]/.test(reason))throw Error('explicit bounded owner daily-loss reset reason required');
    return this.apply(id,'owner-daily-loss-reset',now,{reason},s=>{
      if(s.daily.day!==utcDay(now)||s.daily.lossPaused)throw Error('owner reset no-op requires an already clear current day');
      const daily=structuredClone(s.daily);
      return {reset:false,alreadyClear:true,accountId:s.accountId,inceptionAt:s.inceptionAt,at:now,reason,revisionBefore:s.revision,revisionAfter:s.revision+1,previousDaily:daily,currentEquityMicroUsd:null,nextDaily:structuredClone(daily),price:null,controlsPreserved:true,entryPermissionGranted:false,orderCreated:false};
    });
  }
  resetDailyLoss(id:string,now:number,price:UsdPrice,marks:Record<string,Mark>,reason:string):DailyLossResetReceipt{
    if(!boundedText(reason)||/[\u0000-\u001f]/.test(reason))throw Error('explicit bounded owner daily-loss reset reason required');
    return this.apply(id,'owner-daily-loss-reset',now,{reason},s=>{
      if(this.equityRiskStatus(s).kind!=='legacy')throw Error('versioned equity high-water policy cannot be reset by legacy absolute-loss authorization');
      if(Object.keys(s.positions).length||Object.keys(s.pending).length)throw Error('daily-loss reset requires flat settled accounting');
      if(Object.keys(marks).length)throw Error('daily-loss reset requires empty flat liquidation marks');
      if(s.daily.day!==utcDay(now)||s.daily.reconciledAt<=0||s.daily.reconciledAt>now||now-s.daily.reconciledAt>MAX_QUOTE_AGE)throw Error('daily-loss reset requires fresh same-day reconciliation');
      if(!s.daily.lossPaused)throw Error('no current daily-loss latch to reset');
      const equity=this.equity(s,priceAt(price,now),marks,now),previousDaily=structuredClone(s.daily);
      s.daily.baselineMicroUsd=equity.toString();s.daily.lossPaused=false;
      // Ordinary authenticated readiness must still satisfy its current audit,
      // quote, owner/hard-stop, financial and provider conditions afterward.
      s.daily.paused=true;
      return {reset:true,alreadyClear:false,accountId:s.accountId,inceptionAt:s.inceptionAt,at:now,reason,revisionBefore:s.revision,revisionAfter:s.revision+1,previousDaily,currentEquityMicroUsd:equity.toString(),nextDaily:structuredClone(s.daily),price:structuredClone(price),controlsPreserved:true,entryPermissionGranted:false,orderCreated:false};
    });
  }

  /** One bounded, authenticated control history for both ordinary temporary
   * recovery and separately proved protection recovery. Later startup wording
   * cannot erase an earlier owner, unknown or malformed intent. */
  private operatingControlHistory(state:State,at:number){
    try{
      type Row={revision:number;actionId:string;at:number;kind:string;detail:string;payloadHash:string;result:string};
      const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
      const select="SELECT j.revision,j.action_id actionId,j.at,j.kind,CASE WHEN length(CAST(j.detail AS BLOB))<=65536 THEN j.detail END detail,a.payload_hash payloadHash,CASE WHEN length(CAST(a.result AS BLOB))<=65536 THEN a.result END result FROM journal j LEFT JOIN actions a ON a.id=j.action_id";
      const read=(row:Row)=>{if(!Number.isSafeInteger(row.revision)||row.revision<1||row.revision>state.revision||!Number.isSafeInteger(row.at)||row.at<state.inceptionAt||row.at>at||!boundedText(row.actionId,160)||typeof row.detail!=='string'||typeof row.result!=='string')throw Error('malformed');const payload=JSON.parse(row.detail),result=JSON.parse(row.result);if(!object(payload)||payload.now!==row.at||!object(result)||row.payloadHash!==digest({kind:row.kind,payload}))throw Error('malformed');return {payload,result};};
      const validateResume=(row:Row,enabled:boolean)=>{const {payload,result}=read(row),kind=runtimeReadinessKind(payload.readiness,row.at,payload.marks,row.revision-1,state.accountId,payload.price,isV3PaperRiskState(state));if(row.kind!=='resume'||Object.keys(payload).sort().join(',')!=='marks,now,price,readiness'||!kind||Object.keys(result).sort().join(',')!=='enabled,reason'||result.enabled!==enabled||enabled&&result.reason!==(kind==='financial'?'explicit verified operating financial readiness':'explicit verified runtime readiness')||!enabled&&result.reason!=='fresh reconciliation or next UTC-day loss reset required'&&!(kind==='financial'&&result.reason==='fresh reconciled inventory and authorized temporary recovery required'))throw Error('malformed');priceAt(payload.price,row.at);return {payload,result};};
      let anchor=this.db.prepare(select+" WHERE j.kind='resume' AND CASE WHEN length(CAST(a.result AS BLOB))<=65536 AND json_valid(a.result) THEN json_type(a.result,'$.enabled')='true' ELSE 0 END ORDER BY j.revision DESC LIMIT 1").get()as Row|undefined;
      if(state.paperEpoch&&(!anchor||anchor.revision<state.paperEpoch.transitionRevision)){this.validateEpochAnchor(state);anchor=this.db.prepare(select+' WHERE j.action_id=?').get('epoch:'+state.paperEpoch.id) as Row;}
      if(anchor?.kind==='paper-epoch-transition')this.validateEpochAnchor(state);else if(anchor)validateResume(anchor,true);else{const inception=this.db.prepare("SELECT action_id actionId,at,kind,CASE WHEN length(CAST(detail AS BLOB))<=65536 THEN detail END detail FROM journal WHERE revision=0").get()as{actionId:string;at:number;kind:string;detail:string}|undefined;if(!inception||inception.actionId!=='inception'||inception.at!==state.inceptionAt||inception.kind!=='inception'||typeof inception.detail!=='string'||!isDeepStrictEqual(JSON.parse(inception.detail),{price:state.inceptionPrice,gasReserve:state.gasReserve,mode:state.mode}))throw Error('malformed inception');}
      const boundary=anchor?.revision??0,size=this.db.prepare("SELECT count(*) count,coalesce(sum(length(CAST(j.detail AS BLOB))+coalesce(length(CAST(a.result AS BLOB)),0)),0) bytes FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>? AND j.kind IN ('pause','safe-stop','resume')").get(boundary)as{count:number;bytes:number};if(size.count>512||size.bytes>1024*1024)return null;
      const rows=this.db.prepare(select+" WHERE j.revision>? AND j.kind IN ('pause','safe-stop','resume') ORDER BY j.revision LIMIT 513").all(boundary)as Row[];if(rows.length!==size.count)return null;
      let previousAt=anchor?.at??state.inceptionAt,previousRevision=boundary;
      const decoded=rows.map(row=>{if(row.revision<=previousRevision||row.at<previousAt)throw Error('malformed order');previousRevision=row.revision;previousAt=row.at;const {payload,result}=read(row);
        if(row.kind==='resume')validateResume(row,false);
        else if(row.kind==='pause'){if(Object.keys(payload).sort().join(',')!=='now,reason'||!boundedText(payload.reason)||Object.keys(result).sort().join(',')!=='paused,pendingBuyCancellations'||result.paused!==true||!Array.isArray(result.pendingBuyCancellations)||!isV3PaperRiskState(state)&&result.pendingBuyCancellations.length>3||!result.pendingBuyCancellations.every((id:unknown)=>boundedText(id,100)))throw Error('malformed pause');}
        else if(row.kind!=='safe-stop')throw Error('unknown control');
        const ordinary=/^trader:pause:(\d+):(\d+)$/.exec(row.actionId),restored=/^trader:restore-hard-pause:(\d+):(\d+)$/.exec(row.actionId),startup=row.actionId===`execution-recovery:${state.accountId}:${row.revision-1}`,stamp=ordinary??restored;
        if(stamp&&(Number(stamp[1])!==row.revision-1||!Number.isSafeInteger(Number(stamp[2]))||Number(stamp[2])<state.inceptionAt||Number(stamp[2])>at))throw Error('malformed action identity');
        return {row,payload,result,ordinary:!!ordinary,restored:!!restored,startup};
      });
      return {anchor,decoded};
    }catch{return null;}
  }

  /** Read-only control authority, never proof that actual protection recovered. */
  technicalProtectionRecoveryAuthority(at:number):TechnicalProtectionRecoveryAuthority{
    const state=this.state(),no=(reason:string):TechnicalProtectionRecoveryAuthority=>({verified:false,reason});
    if(!Number.isSafeInteger(at)||at<state.lastAt)return no('TECHNICAL_PROTECTION_CONTROL_TIME');
    if(state.controls.entriesEnabled||state.controls.stopRequested||dailyLossEntryBlocked(state)||Object.keys(state.pending).length||!TECHNICAL_PROTECTION_PAUSE_REASONS.includes(state.controls.reason as never))return no('TECHNICAL_PROTECTION_CONTROL_NOT_ELIGIBLE');
    const history=this.operatingControlHistory(state,at);if(!history||!history.anchor)return no('TECHNICAL_PROTECTION_CONTROL_HISTORY_UNAVAILABLE');
    let originRevision:number|null=null,lastControl:{at:number;reason:string}|null=null;
    const intents:Array<{revision:number;actionId:string;at:number;kind:string;payloadHash:string;resultSha256:string}>=[];
    for(const {row,payload,result,ordinary,restored,startup}of history.decoded){intents.push({revision:row.revision,actionId:row.actionId,at:row.at,kind:row.kind,payloadHash:row.payloadHash,resultSha256:digest(result)});
      if(row.kind==='safe-stop')return no('TECHNICAL_PROTECTION_STOP_INTENT_PRESENT');if(row.kind==='resume')continue;
      if(ordinary&&TECHNICAL_PROTECTION_PAUSE_REASONS.includes(payload.reason as never))originRevision=row.revision;
      else if(restored){if(originRevision===null||payload.reason!==state.controls.reason)return no('TECHNICAL_PROTECTION_UNPROVEN_RESTORE');}
      else if(!(ordinary&&INTERNAL_SHUTDOWN_SOFT_PAUSES.has(payload.reason)||startup&&payload.reason==='execution startup: fresh reconciliation/readiness required'))return no('TECHNICAL_PROTECTION_OWNER_OR_UNKNOWN_CONTROL');
      lastControl={at:row.at,reason:payload.reason};
    }
    if(originRevision===null||!lastControl||lastControl.at!==state.controls.changedAt||lastControl.reason!==state.controls.reason)return no('TECHNICAL_PROTECTION_CURRENT_CONTROL_MISMATCH');
    const anchor=history.anchor,body={version:'technical-protection-control-authority-v1',accountId:state.accountId,inceptionAt:state.inceptionAt,anchor:{revision:anchor.revision,actionId:anchor.actionId,payloadHash:anchor.payloadHash,resultSha256:digest(JSON.parse(anchor.result))},originRevision,controlChangedAt:state.controls.changedAt,controlReason:state.controls.reason,intents};
    return {verified:true,accountId:state.accountId,inceptionAt:state.inceptionAt,stateRevision:state.revision,controlChangedAt:state.controls.changedAt,controlReason:state.controls.reason,originRevision,authoritySha256:digest(body)};
  }

  private operatingTemporaryControlVerified(state:State,at:number){
    const history=this.operatingControlHistory(state,at);if(!history)return false;let lastControl:{at:number;reason:string}|null=history.anchor?.kind==='paper-epoch-transition'?{at:history.anchor.at,reason:'execution startup: fresh reconciliation/readiness required'}:null;
    for(const {row,payload,ordinary,restored,startup}of history.decoded){if(row.kind==='safe-stop')return false;if(row.kind==='resume')continue;
      if(restored||!(ordinary&&INTERNAL_SHUTDOWN_SOFT_PAUSES.has(payload.reason)||startup&&payload.reason==='execution startup: fresh reconciliation/readiness required'))return false;
      lastControl={at:row.at,reason:payload.reason};
    }
    return !!lastControl&&lastControl.at===state.controls.changedAt&&lastControl.reason===state.controls.reason;
  }

  /** Preflight for the operating candidate path; no preparation or state
   * change may launder an owner intent behind temporary startup wording. */
  operatingFinancialRecoveryAllowed(at:number){const state=this.state();return Number.isSafeInteger(at)&&at>=state.lastAt&&!state.controls.entriesEnabled&&!state.controls.stopRequested&&!dailyLossEntryBlocked(state)&&!Object.keys(state.pending).length&&INTERNAL_SHUTDOWN_SOFT_PAUSES.has(state.controls.reason)&&this.operatingTemporaryControlVerified(state,at);}

  resume(id: string, now: number, price: UsdPrice, marks: Record<string, Mark>, readiness: RuntimeReadiness) {
    const p = priceAt(price, now);
    const kind=runtimeReadinessKind(readiness,now,marks,undefined,this.accountId,price,this.v3RiskPolicyActive());if(!kind)throw new Error('fresh explicit runtime readiness required');
    return this.apply(id, 'resume', now, { now, price, marks, readiness }, s => {
      if(kind==='financial'){
        const q=readiness as OperatingFinancialReadiness,units=Object.fromEntries(Object.entries(s.positions).map(([mint,position])=>[mint,position.units]));
        const technical=q.technicalProtectionRecovery,authority=technical?this.technicalProtectionRecoveryAuthority(now):null,controlAllowed=technical?authority?.verified===true&&authority.accountId===technical.accountId&&authority.inceptionAt===technical.inceptionAt&&authority.stateRevision===technical.stateRevision&&authority.controlChangedAt===technical.controlChangedAt&&authority.controlReason===technical.controlReason&&authority.originRevision===technical.originRevision&&authority.authoritySha256===technical.authoritySha256:this.operatingTemporaryControlVerified(s,now)&&INTERNAL_SHUTDOWN_SOFT_PAUSES.has(s.controls.reason);
        if(q.stateRevision!==s.revision||q.reconciledAt!==s.daily.reconciledAt||!isDeepStrictEqual(q.positionUnits,units)||Object.keys(s.pending).length||s.controls.stopRequested||!controlAllowed)return {enabled:false,reason:'fresh reconciled inventory and authorized temporary recovery required'};
      }
      const equity = this.equity(s, p, marks, now);
      const riskReady=this.observeEquityRisk(s,now,equity);
      if (!riskReady || s.daily.day !== utcDay(now) || s.daily.reconciledAt === 0 || now - s.daily.reconciledAt > MAX_QUOTE_AGE || dailyLossEntryBlocked(s)) return { enabled: false, reason: 'fresh reconciliation or next UTC-day loss reset required' };
      s.daily.paused = false;
      s.controls = { entriesEnabled: true, reason: kind==='financial'?'explicit verified operating financial readiness':'explicit verified runtime readiness', changedAt: now, readinessVersion: readiness.version, stopRequested: false };
      return { enabled: true, reason: s.controls.reason };
    });
  }

  safeStop(id: string, now: number) {
    return this.apply(id, 'safe-stop', now, { now }, s => {
      s.controls.entriesEnabled = false; s.controls.stopRequested = true;
      s.controls.changedAt = now; s.controls.reason = 'safe stop requested'; s.daily.paused = true;
      const canceledEntries = Object.values(s.pending).filter(o => o.side === 'buy').map(o => o.id);
      for (const orderId of canceledEntries) delete s.pending[orderId];
      const openPositions = Object.keys(s.positions).length;
      const uncertainActions = Object.keys(s.pending).length;
      return { safeToExit: openPositions === 0 && uncertainActions === 0, state: openPositions || uncertainActions ? 'management-required' : 'stopped-safe', openPositions, uncertainActions, canceledEntries };
    });
  }

  cancelEntryOrders(id: string, now: number, reason: string, mint?: string) {
    if (!boundedText(reason)) throw new Error('bounded entry cancellation reason required');
    if (mint !== undefined && !boundedText(mint, 96)) throw new Error('bounded cancellation mint required');
    // The legacy three-argument payload remains byte-for-byte equivalent for
    // existing idempotency keys. A scoped action includes its exact mint.
    return this.apply(id, 'cancel-entry-orders', now, { now, reason, ...(mint === undefined ? {} : { mint }) }, s => {
      const canceledEntries = Object.values(s.pending).filter(o => o.side === 'buy' && (mint === undefined || o.mint === mint)).map(o => o.id);
      for (const orderId of canceledEntries) delete s.pending[orderId];
      return { canceledEntries, preservedExitOrders: Object.values(s.pending).filter(o => o.side === 'sell').map(o => o.id) };
    });
  }

  /** Durable no-reentry index; successful fills write this marker atomically. */
  hasTradedMint(mint: string): boolean {
    if (!boundedText(mint, 96)) throw new Error('bounded mint identity required');
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('traded_mint:' + mint) as { value: string } | undefined;
    if (row && row.value !== '1') throw new Error('traded mint history marker invalid');
    return !!row;
  }

  private closedCycle(mint:string,state:Readonly<State>,ignoredPendingId?:string):ClosedCycle|null{
    const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('paper_round_trip_v2:'+mint) as {value:string}|undefined;if(!row)return this.historicalClosedCycle(mint,state,ignoredPendingId);
    if(row.value.length>2048)return null;let value:ClosedCycle;try{value=JSON.parse(row.value);}catch{return null;}
    if(!value||value.schemaVersion!==1||value.mint!==mint||!Number.isSafeInteger(value.cycle)||value.cycle<1||!boundedText(value.entryOrderId,100)||!Number.isSafeInteger(value.entryWindowEndAt)||value.entryWindowEndAt<0||value.entryWindowEndAt>state.lastAt||typeof value.legacyEntryCutoff!=='boolean'||!(value.closedAt===null||Number.isSafeInteger(value.closedAt)&&value.closedAt>=state.inceptionAt&&value.closedAt<=state.lastAt)||!(value.exitOrderId===null||boundedText(value.exitOrderId,100))||(value.closedAt===null)!==(value.exitOrderId===null))return null;return value;
  }
  private preservePriorRoundTripIndex(mint:string,now:number,revision:number){
    const prior=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('paper_round_trip_v2:'+mint) as {value:string}|undefined;if(!prior)return;
    const sha256=createHash('sha256').update(prior.value).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES(?,?)').run('paper_round_trip_index_history:'+sha256,JSON.stringify({mint,observedAt:now,beforeRevision:revision,sha256,raw:prior.value}));
  }
  /** Old authoritative accounts already prove full closes in their original
   * order/attempt/action rows. Read that proof without rewriting any history.
   * The cache is disposable; the next actual fill establishes the durable
   * versioned cycle. Unknown/malformed/over-bound history grants no re-entry. */
  private historicalClosedCycle(mint:string,state:Readonly<State>,ignoredPendingId?:string):ClosedCycle|null{
    if(state.positions[mint]||Object.values(state.pending).some(order=>order.mint===mint&&order.id!==ignoredPendingId)||!this.hasTradedMint(mint))return null;
    if(this.historicalClosedCycles.has(mint))return this.historicalClosedCycles.get(mint)!;
    let result:ClosedCycle|null=null;
    try{
      type Row={revision:number;at:number;actionId:string;detail:string;payloadHash:string;result:string;orderDetail:string;orderHash:string};
      const rows=this.db.prepare("SELECT j.revision,j.at,j.action_id actionId,j.detail,a.payload_hash payloadHash,a.result,o.detail orderDetail,oa.payload_hash orderHash FROM journal j JOIN actions a ON a.id=j.action_id JOIN journal o ON o.action_id='order:'||json_extract(j.detail,'$.orderId') JOIN actions oa ON oa.id=o.action_id WHERE j.kind='attempt' AND o.kind='order' AND json_extract(o.detail,'$.input.mint')=? ORDER BY j.revision DESC LIMIT 257").all(mint) as Row[];
      if(rows.length>256)throw Error('bounded legacy round-trip proof');
      const fills=rows.flatMap(row=>{if(row.detail.length>65536||row.orderDetail.length>65536||row.result.length>65536)throw Error('legacy receipt bound');const attempt=JSON.parse(row.detail),order=JSON.parse(row.orderDetail),receipt=JSON.parse(row.result);if(digest({kind:'attempt',payload:attempt})!==row.payloadHash||digest({kind:'order',payload:order})!==row.orderHash)throw Error('legacy receipt hash');const trade=reportingFilledTrade(row.actionId,row.at,attempt,order,receipt);return trade?[{row,attempt,order,trade}]:[];});
      const sell=fills[0],buy=fills.find(item=>item.trade.side==='buy');
      if(sell?.trade.side==='sell'&&buy&&sell.row.revision>buy.row.revision&&sell.row.at>=buy.row.at&&sell.row.at<=state.lastAt&&sell.attempt.quote.pricedBaseUnits===buy.attempt.quote.receiveUnits){result={schemaVersion:1,mint,cycle:fills.filter(item=>item.trade.side==='buy').length,entryOrderId:buy.order.input.id,entryWindowEndAt:buy.order.input.entryStrategy?.windowEndAt??Math.floor(buy.row.at/10000)*10000,closedAt:sell.row.at,exitOrderId:sell.order.input.id,legacyEntryCutoff:!buy.order.input.entryStrategy};}
    }catch{/* Missing evidence is a refusal, never a fabricated closure. */}
    if(this.historicalClosedCycles.size>=64)this.historicalClosedCycles.delete(this.historicalClosedCycles.keys().next().value!);this.historicalClosedCycles.set(mint,result);return result;
  }
  private entryEligibilityFrom(state:Readonly<State>,mint:string,strategyVersion:string,windowEndAt:number,at:number,ignoredPendingId?:string):EntryEligibility{
    if(!boundedText(mint,96)||!Number.isSafeInteger(at)||at<state.lastAt||!Number.isSafeInteger(windowEndAt)||windowEndAt<60000||windowEndAt>at)throw Error('valid entry eligibility identity/window/time required');
    if(state.positions[mint]||Object.values(state.pending).some(order=>order.id!==ignoredPendingId))return {allowed:false,reason:'held or pending financial obligation remains',closedAt:null,previousWindowEndAt:null,cycle:1};
    const prior=this.closedCycle(mint,state,ignoredPendingId),result=(allowed:boolean,reason:string):EntryEligibility=>({allowed,reason,closedAt:prior?.closedAt??null,previousWindowEndAt:prior?.entryWindowEndAt??null,cycle:(prior?.cycle??0)+1});
    if(!prior&&this.db.prepare('SELECT 1 FROM metadata WHERE key=?').get('paper_round_trip_v2:'+mint))return result(false,'round-trip recovery index unavailable; no entry authority');
    if(!this.hasTradedMint(mint))return result(true,'first complete qualified entry remains subject to financial controls');
    if(strategyVersion!==ADAPTIVE_PAPER_STRATEGY_VERSION&&strategyVersion!==V3_PAPER_STRATEGY_VERSION)return result(false,'legacy no-reentry policy');
    if(!prior||prior.closedAt===null)return result(false,'prior fill has no verified completed closure');
    if(state.daily.reconciledAt<prior.closedAt||state.daily.reconciledAt>at)return result(false,'post-close financial reconciliation required');
    if(windowEndAt-60000<=prior.closedAt||windowEndAt<=prior.entryWindowEndAt)return result(false,'new complete audited window after closure required');
    return result(true,'verified closed round trip and strictly new post-close observation window');
  }
  /** History awareness only; this never arms controls or substitutes for a
   * complete independent audit, current quote, risk or uncertainty checks. */
  entryEligibility(mint:string,strategyVersion:string,windowEndAt:number,at:number):EntryEligibility{return this.entryEligibilityFrom(this.state(),mint,strategyVersion,windowEndAt,at);}

  order(input: Omit<Order, 'reserved'|'allocation'>, price: UsdPrice, marks: Record<string, Mark>) {
    const now = input.decidedAt;
    return this.apply(`order:${input.id}`, 'order', now, { input, price, marks }, s => {
      if (!Number.isSafeInteger(input.executeAt) || !Number.isSafeInteger(input.expiresAt) || input.executeAt < now + 500 || input.expiresAt <= input.executeAt || input.expiresAt > now + 30_000 || !boundedText(input.decisionEvidence)) throw new Error('invalid delay/expiry/evidence');
      if(Object.hasOwn(input,'allocation'))throw Error('entry allocation is ledger-issued');
      if(input.executionModel!==undefined&&(!validatePaperExecutionPlan(input.executionModel)||input.executionModel.plannedAt!==now||input.executionModel.executeAt!==input.executeAt||input.executionModel.expiresAt!==input.expiresAt||paperExecutionFee(input.executionModel)!==input.gas||input.temporaryRentLamports!==input.executionModel.temporaryQuoteRentLamports))throw Error('invalid PAPER execution model');
      let allocation:EntryAllocation|undefined;
      const gas = amount(input.gas); const dep = amount(input.deposit);
      const spend = amount(input.maxSpend); const min = amount(input.minReceive);
      if (gas === 0n || min === 0n || input.id.length > 100 || !input.id || !input.mint || ['__proto__', 'constructor', 'prototype'].some(k => k === input.id || k === input.mint)) throw new Error('invalid order amounts/identity');
      if (Object.values(s.pending).some(o => o.mint === input.mint)) throw new Error('one pending action per token');
      if (!isV3PaperEpochState(s)&&Object.keys(s.pending).length >= 3) throw new Error('pending capacity');
      const temporary=amount(input.temporaryRentLamports??'0');if(!input.executionModel&&input.temporaryRentLamports!==undefined)throw Error('temporary rent requires supported execution model');
      let reserved = gas+temporary;
      if (input.side === 'buy') {
        if (spend === 0n) throw new Error('positive buy maximum required');
        const p = priceAt(price, now);
        const equity = this.equity(s, p, marks, now);
        const riskReady=this.observeEquityRisk(s,now,equity);
        if (!riskReady || s.daily.day !== utcDay(now) || s.daily.reconciledAt === 0 || now - s.daily.reconciledAt > MAX_QUOTE_AGE || s.daily.paused || !s.controls.entriesEnabled || s.controls.stopRequested) return { rejected: 'entries paused or reconciliation required' };
        if (s.positions[input.mint]) throw new Error('adds/re-entry into held position forbidden');
        if(input.entryStrategy){validateEntryStrategy(input.entryStrategy,now);const eligibility=this.entryEligibilityFrom(s,input.mint,input.entryStrategy.version,input.entryStrategy.windowEndAt,now);if(!eligibility.allowed||input.entryStrategy.cycle!==eligibility.cycle)throw Error('adaptive re-entry requires verified closed cycle and fresh audited signal');}
        else if (this.hasTradedMint(input.mint)) throw new Error('re-entry after a prior PAPER fill forbidden');
        if (s.lockedDeposits[input.mint] && dep > 0n) throw new Error('existing account deposit cannot be charged twice');
        if (!s.equityRisk && Object.keys(s.lockedDeposits).length >= 128 && !s.lockedDeposits[input.mint]) throw new Error('unresolved deposit capacity');
        const pendingBuys = Object.values(s.pending).filter(o => o.side === 'buy');
        if (!isV3PaperRiskState(s)&&Object.keys(s.positions).length + pendingBuys.length >= (s.equityRisk?2:3)) throw new Error('position capacity');
        reserved += spend + dep;
        if(s.equityRisk){if(gas+spend>consumedEntryAllowance(equity,p))throw Error('5% current equity consumed-entry limit');allocation=entryAllocation(equity,p,now,gas+spend,s.equityRisk.version);}
        else if (usd(reserved, p) > 50_000_000n) throw new Error('$50 initial commitment limit');
        const heldCost = Object.values(s.positions).reduce((n, x) => n + amount(x.costMicroUsd), 0n);
        const pendingCost = pendingBuys.reduce((n, x) => n + usd(amount(x.reserved), p), 0n);
        if (!s.equityRisk&&heldCost + pendingCost + usd(reserved, p) > 150_000_000n) throw new Error('$150 cost limit');
      } else if (input.side === 'sell') {
        if (!s.positions[input.mint] || spend !== 0n || dep !== 0n) throw new Error('full-position sell required');
      } else throw new Error('unsupported side');
      const existing = Object.values(s.pending).reduce((n, o) => n + amount(o.reserved), 0n);
      const entryReserve = input.side === 'buy' ? amount(s.gasReserve) : 0n;
      if (existing + reserved + entryReserve > amount(s.lamports)) throw new Error('insufficient unreserved cash');
      s.pending[input.id] = { ...input, reserved: reserved.toString(),...(allocation?{allocation}:{}) };
      return { reserved: reserved.toString() };
    });
  }

  attempt(id: string, orderId: string, now: number, quote: ExecutionQuote | null, price: UsdPrice, marks: Record<string, Mark> = {},executionAttempt?:PaperExecutionAttempt): OrderOutcome {
    return this.apply(id, 'attempt', now, { orderId, now, quote, price, marks,...(executionAttempt===undefined?{}:{executionAttempt}) }, s => {
      const o = s.pending[orderId]; if (!o) throw new Error('order is not pending');
      if (now < o.executeAt) throw new Error('modeled delay not elapsed');
      let chargedGas = 0n;
      const finish = (status: OrderOutcome['status'], reason: string) => {
        if (status === 'failed') s.realizedLamports = (BigInt(s.realizedLamports) - chargedGas).toString();
        delete s.pending[orderId]; return { status, reason, at: now };
      };
      if (now >= o.expiresAt) return finish('expired', 'expiry reached before attempt');
      let p = 0n,entryEquity:bigint|null=null;
      if (o.side === 'buy') {
        if(o.entryStrategy){const eligibility=this.entryEligibilityFrom(s,o.mint,o.entryStrategy.version,o.entryStrategy.windowEndAt,now,o.id);if(!eligibility.allowed||o.entryStrategy.cycle!==eligibility.cycle)return finish('failed','adaptive round-trip or fresh-entry identity changed; canceled before attempt');}
        try { p = priceAt(price, now); }
        catch { return finish('failed', 'USD valuation unavailable; entry canceled before attempt'); }
        let equity: bigint;
        try { equity = this.equity(s, p, marks, now); }
        catch { return finish('failed', 'unknown liquidation marks; entry canceled before attempt'); }
        const riskReady=this.observeEquityRisk(s,now,equity);entryEquity=equity;
        if(s.equityRisk&&amount(o.maxSpend)+amount(o.gas)>consumedEntryAllowance(equity,p))return finish('failed','5% current equity consumed-entry limit; canceled before attempt');
        if (!riskReady || s.daily.day !== utcDay(now) || s.daily.paused || !s.controls.entriesEnabled || s.controls.stopRequested || now - s.daily.reconciledAt > MAX_QUOTE_AGE) return finish('failed', 'entry gate closed; canceled before attempt');
        const totalReservations = Object.values(s.pending).reduce((sum, pending) => sum + amount(pending.reserved), 0n);
        if (totalReservations + amount(s.gasReserve) > amount(s.lamports)) return finish('failed', 'gas reserve needed for held-position management; entry canceled before attempt');
      }
      const model=o.executionModel;
      if(model){
        if(!validatePaperExecutionAttempt(executionAttempt,model))return finish('failed','invalid modeled attempt; unsubmitted; no network fee');
        if(executionAttempt.stage==='preflight-unsubmitted')return finish('failed','modeled preflight unavailable; unsubmitted; no network fee');
        if(!quote||!validatePaperExecutionLanding(quote.executionModel,model,now)||quote.at!==quote.executionModel.landingAt)return finish('failed','modeled landing unavailable; unsubmitted; no network fee');
      }else if(executionAttempt!==undefined)return finish('failed','unexpected execution metadata; no network fee');
      const gas = amount(o.gas);
      chargedGas = gas;
      s.lamports = (amount(s.lamports) - gas).toString();
      s.executionCosts = (amount(s.executionCosts) + gas).toString();
      if (!quote || !boundedText(quote.evidence) || !Number.isSafeInteger(quote.at) || quote.at < o.executeAt || quote.at > now || now - quote.at > MAX_QUOTE_AGE) return finish('failed', 'missing/stale first-attempt state; gas charged; no retry');
      let spend: bigint, received: bigint;
      try { spend = amount(quote.spendLamports); received = amount(quote.receiveUnits); }
      catch { return finish('failed', 'malformed first-attempt amounts; gas charged; no retry'); }
      if (received < amount(o.minReceive) || (o.side === 'buy' && (spend > amount(o.maxSpend) || spend === 0n)) || (o.side === 'sell' && spend !== 0n)) return finish('failed', 'price constraint failed; gas charged; no retry');
      if (o.side === 'buy') {
        let allocation:EntryAllocation|undefined;
        if(s.equityRisk){const equity=entryEquity!;if(spend+gas>consumedEntryAllowance(equity,p))return finish('failed','5% current equity consumed-entry limit at execution; gas charged');allocation=entryAllocation(equity,p,now,spend+gas,s.equityRisk.version);}
        else if (usd(spend + gas + amount(o.deposit), p) > 50_000_000n) return finish('failed', '$50 commitment limit at execution; gas charged');
        if (s.positions[o.mint]) throw new Error('position already held');
        this.historicalClosedCycles.delete(o.mint);
        s.lamports = (amount(s.lamports) - spend - amount(o.deposit)).toString();
        if (amount(o.deposit) > 0n) s.lockedDeposits[o.mint] = o.deposit;
        s.positions[o.mint] = {
          mint: o.mint, units: received.toString(), entryLamports: spend.toString(), entryGas: gas.toString(),
          costMicroUsd: usd(spend + gas, p).toString(), deposit: o.deposit, enteredAt: now,...(allocation?{allocation}:{}),...(o.executionModel?{executionModelVersion:o.executionModel.version}:{}),
          ...(o.entryStrategy?{strategy:{...o.entryStrategy,roundTripId:o.id,highWaterNetLamports:'0',highWaterAt:now}}:{}),
        };
        this.db.prepare(o.entryStrategy?'INSERT OR IGNORE INTO metadata VALUES(?,?)':'INSERT INTO metadata VALUES(?,?)').run('traded_mint:' + o.mint, '1');
        if(o.entryStrategy){this.preservePriorRoundTripIndex(o.mint,now,s.revision);this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('paper_round_trip_v2:'+o.mint,JSON.stringify({schemaVersion:1,mint:o.mint,cycle:o.entryStrategy.cycle,entryOrderId:o.id,entryWindowEndAt:o.entryStrategy.windowEndAt,closedAt:null,exitOrderId:null,legacyEntryCutoff:false} satisfies ClosedCycle));}
      } else {
        const pos = s.positions[o.mint]; if (!pos) throw new Error('position missing');
        if (quote.pricedBaseUnits !== pos.units) return finish('failed', 'exit quote is not for actual full size; gas charged');
        let refund: bigint;
        try { refund = amount(quote.refundedDepositLamports ?? '0'); }
        catch { return finish('failed', 'malformed deposit refund; gas charged; no retry'); }
        const locked = amount(s.lockedDeposits[o.mint] ?? '0');
        if (refund > locked || refund > 0n && !boundedText(quote.refundEvidence)) return finish('failed', 'unverified deposit refund; gas charged');
        s.lamports = (amount(s.lamports) + received + refund).toString();
        if (locked > refund) s.lockedDeposits[o.mint] = (locked - refund).toString();
        else delete s.lockedDeposits[o.mint];
        s.realizedLamports = (BigInt(s.realizedLamports) + received - gas - amount(pos.entryLamports) - amount(pos.entryGas)).toString();
        this.historicalClosedCycles.delete(o.mint);
        // Exit protection depends on the held obligation, never optional
        // re-entry metadata. A malformed index cannot prevent liquidation.
        this.preservePriorRoundTripIndex(o.mint,now,s.revision);this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('paper_round_trip_v2:'+o.mint,JSON.stringify({schemaVersion:1,mint:o.mint,cycle:pos.strategy?.cycle??1,entryOrderId:pos.strategy?.roundTripId??'legacy-held:'+o.mint+':'+pos.enteredAt,entryWindowEndAt:pos.strategy?.windowEndAt??Math.floor(pos.enteredAt/10000)*10000,closedAt:now,exitOrderId:o.id,legacyEntryCutoff:!pos.strategy} satisfies ClosedCycle));
        delete s.positions[o.mint];
      }
      return finish('filled', 'single modeled PAPER attempt; no live fill claim');
    });
  }

  releaseDeposit(id: string, mint: string, lamports: string, now: number, evidence: string) {
    return this.apply(id, 'deposit-release', now, { mint, lamports, now, evidence }, s => {
      const refund = amount(lamports); const locked = amount(s.lockedDeposits[mint] ?? '0');
      if (!boundedText(evidence) || refund === 0n || refund > locked || s.positions[mint]) throw new Error('verified closed-account refund required');
      s.lamports = (amount(s.lamports) + refund).toString();
      if (refund === locked) delete s.lockedDeposits[mint];
      else s.lockedDeposits[mint] = (locked - refund).toString();
      return { refundedLamports: lamports };
    });
  }

  exportJournal(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('bounded export required');
    return this.db.prepare('SELECT * FROM journal ORDER BY revision DESC LIMIT ?').all(limit);
  }
  /** Replaceable max50 filled-trade projection, verified by indexed durable actions. */
  getReportingTrades():ReportingTradeCache {
    const state=this.state(),size=this.db.prepare("SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key='reporting_trades'").get() as {size:number}|undefined;
    if(!size)return {schemaVersion:1,accountId:state.accountId,inceptionAt:state.inceptionAt,windowLimited:false,trades:[]};
    if(size.size>128*1024)throw Error('reporting trade cache bound');
    const raw=this.db.prepare("SELECT value FROM metadata WHERE key='reporting_trades'").get() as {value:string};
    const cache=validateReportingTradeCache(JSON.parse(raw.value),state.accountId,state.inceptionAt,state.lastAt);
    for(const trade of cache.trades)this.validateReportingTrade(trade);return cache;
  }
  private validateReportingTrade(trade:ReportingFilledTrade){
    const attempt=this.db.prepare('SELECT at,kind,detail FROM journal WHERE action_id=?').get(trade.actionId) as {at:number;kind:string;detail:string}|undefined;
    if(!attempt||attempt.kind!=='attempt'||Buffer.byteLength(attempt.detail)>65536)throw Error('reporting trade attempt absent');
    const payload=JSON.parse(attempt.detail),order=this.db.prepare('SELECT detail FROM journal WHERE action_id=?').get('order:'+payload.orderId) as {detail:string}|undefined;
    if(!order||Buffer.byteLength(order.detail)>65536)throw Error('reporting trade order absent');
    const expected=reportingFilledTrade(trade.actionId,attempt.at,payload,JSON.parse(order.detail),this.actionResult(trade.actionId));
    if(!expected||!isDeepStrictEqual(trade,expected))throw Error('reporting trade durable evidence mismatch');
  }
  recordReportingTrades(trades:readonly ReportingFilledTrade[]):ReportingTradeCache {
    const state=this.state();validateReportingTradeCache({schemaVersion:1,accountId:state.accountId,inceptionAt:state.inceptionAt,windowLimited:false,trades:[...trades].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))},state.accountId,state.inceptionAt,state.lastAt);
    return this.db.transaction(()=>{
      const previous=this.getReportingTrades(),byId=new Map(previous.trades.map(row=>[row.actionId,row]));
      for(const trade of trades){this.validateReportingTrade(trade);const old=byId.get(trade.actionId);if(old&&!isDeepStrictEqual(old,trade))throw Error('reporting trade cache conflict');byId.set(trade.actionId,structuredClone(trade));}
      const sorted=[...byId.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.actionId.localeCompare(b.actionId)),next:ReportingTradeCache={...previous,windowLimited:previous.windowLimited||sorted.length>50,trades:sorted.slice(0,50)};
      if(!isDeepStrictEqual(previous,next))this.db.prepare("INSERT INTO metadata VALUES('reporting_trades',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
      return next;
    }).immediate();
  }
  /** O(1) lookup of a durable idempotent result; no state or journal mutation. */
  actionResult(id: string): unknown | undefined {
    if (!id || id.length > 160) throw new Error('bounded action identity required');
    const row = this.db.prepare('SELECT result FROM actions WHERE id=?').get(id) as { result: string } | undefined;
    return row ? JSON.parse(row.result) : undefined;
  }
  /** Inspect ordered control intentions, not the latest N general journal rows:
   * cash reconciliation can run every second without hiding an owner stop or
   * making a failed resume look like an accepted recovery boundary. */
  internalShutdownRecoveryProof(knownRunIds:readonly string[],at:number):InternalShutdownRecoveryProof {
    const no=(reason:string):InternalShutdownRecoveryProof=>({verified:false,reason});
    try{
      const s=this.state();this.assertState(s);
      if(!Number.isSafeInteger(at)||at<s.lastAt)return no('INTERNAL_SHUTDOWN_PROOF_TIME');
      if(!s.controls.stopRequested||s.controls.entriesEnabled)return no('INTERNAL_SHUTDOWN_NOT_REQUESTED');
      const p=INTERNAL_SHUTDOWN_PROOF_POLICY;
      if(!Array.isArray(knownRunIds)||knownRunIds.length<1||knownRunIds.length>p.maximumRuns||new Set(knownRunIds).size!==knownRunIds.length)return no('INTERNAL_SHUTDOWN_RUN_SET');
      const runs=new Map<string,number>();
      for(const id of knownRunIds){
        if(typeof id!=='string'||!/^native-paper-\d{17}$/.test(id))return no('INTERNAL_SHUTDOWN_RUN_SET');
        const n=id.slice(13),started=Date.UTC(Number(n.slice(0,4)),Number(n.slice(4,6))-1,Number(n.slice(6,8)),Number(n.slice(8,10)),Number(n.slice(10,12)),Number(n.slice(12,14)),Number(n.slice(14,17)));
        if(!Number.isSafeInteger(started)||started<s.inceptionAt||started>at||new Date(started).toISOString().replace(/[^0-9]/g,'')!==n)return no('INTERNAL_SHUTDOWN_RUN_TIME');runs.set(id,started);
      }
      type Row={revision:number;actionId:string;at:number;kind:string;detail:string;payloadHash:string|null;result:string|null};
      const select="SELECT j.revision,CASE WHEN length(j.action_id)<=160 THEN j.action_id END actionId,j.at,j.kind,CASE WHEN length(CAST(j.detail AS BLOB))<=65536 THEN j.detail END detail,CASE WHEN length(a.payload_hash)=64 THEN a.payload_hash END payloadHash,CASE WHEN length(CAST(a.result AS BLOB))<=65536 THEN a.result END result FROM journal j LEFT JOIN actions a ON a.id=j.action_id";
      // json_valid is explicit: malformed later resume results are not silently
      // treated as an enabled anchor; ordered validation below rejects them.
      let anchor=this.db.prepare(select+" WHERE j.kind='resume' AND CASE WHEN length(CAST(a.result AS BLOB))<=65536 AND json_valid(a.result) THEN json_type(a.result,'$.enabled')='true' ELSE 0 END ORDER BY j.revision DESC LIMIT 1").get() as Row|undefined;
      const inception=this.db.prepare('SELECT action_id actionId,at,kind,CASE WHEN length(CAST(detail AS BLOB))<=65536 THEN detail END detail FROM journal WHERE revision=0').get() as {actionId:string;at:number;kind:string;detail:string}|undefined;
      if(!inception||inception.actionId!=='inception'||inception.at!==s.inceptionAt||inception.kind!=='inception'||typeof inception.detail!=='string')return no('INTERNAL_SHUTDOWN_INCEPTION');
      const inceptionPayload=JSON.parse(inception.detail);
      if(!isDeepStrictEqual(inceptionPayload,{price:s.inceptionPrice,gasReserve:s.gasReserve,mode:s.mode}))return no('INTERNAL_SHUTDOWN_INCEPTION');
      const successfulResumeRevision=anchor?.revision??0;
      if(s.paperEpoch&&(!anchor||anchor.revision<s.paperEpoch.transitionRevision)){this.validateEpochAnchor(s);anchor=this.db.prepare(select+' WHERE j.action_id=?').get('epoch:'+s.paperEpoch.id) as Row;}
      const boundary=anchor?.revision??0;
      if(!Number.isSafeInteger(boundary)||boundary<0||boundary>s.revision)return no('INTERNAL_SHUTDOWN_HISTORY_MALFORMED');
      const size=this.db.prepare("SELECT count(*) count,coalesce(sum(length(CAST(j.detail AS BLOB))+coalesce(length(CAST(a.result AS BLOB)),0)),0) bytes FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>? AND j.kind IN ('pause','safe-stop','resume')").get(boundary) as {count:number;bytes:number};
      if(size.count>p.maximumControlIntents||size.bytes>p.maximumControlBytes)return no('INTERNAL_SHUTDOWN_HISTORY_BOUND');
      const rows=this.db.prepare(select+" WHERE j.revision>? AND j.kind IN ('pause','safe-stop','resume') ORDER BY j.revision ASC LIMIT ?").all(boundary,p.maximumControlIntents+1) as Row[];
      if(rows.length!==size.count||rows.length>p.maximumControlIntents)return no('INTERNAL_SHUTDOWN_HISTORY_BOUND');
      const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
      const read=(r:Row)=>{
        if(!Number.isSafeInteger(r.revision)||r.revision<1||r.revision>s.revision||!Number.isSafeInteger(r.at)||r.at<s.inceptionAt||r.at>s.lastAt||!boundedText(r.actionId,160)||typeof r.detail!=='string'||Buffer.byteLength(r.detail)>65536||typeof r.result!=='string'||Buffer.byteLength(r.result)>65536||typeof r.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(r.payloadHash))throw Error('malformed');
        const payload=JSON.parse(r.detail),result=JSON.parse(r.result);if(!object(payload)||payload.now!==r.at||!object(result)||r.payloadHash!==digest({kind:r.kind,payload}))throw Error('malformed');return {payload,result};
      };
      const resume=(r:Row,expectedEnabled:boolean)=>{
        const {payload,result}=read(r),q=payload.readiness;
        const kind=runtimeReadinessKind(q,r.at,payload.marks,r.revision-1,s.accountId,payload.price,isV3PaperRiskState(s)),validReason=expectedEnabled?(kind==='financial'?'explicit verified operating financial readiness':'explicit verified runtime readiness'):result.reason==='fresh reconciliation or next UTC-day loss reset required'||kind==='financial'&&result.reason==='fresh reconciled inventory and authorized temporary recovery required';
        if(r.kind!=='resume'||Object.keys(payload).sort().join(',')!=='marks,now,price,readiness'||!object(payload.price)||!object(payload.marks)||!kind||Object.keys(result).sort().join(',')!=='enabled,reason'||result.enabled!==expectedEnabled||(expectedEnabled?result.reason!==validReason:!validReason))throw Error('malformed');
        priceAt(payload.price as UsdPrice,r.at);return {payload,result};
      };
      if(anchor?.kind==='paper-epoch-transition')this.validateEpochAnchor(s);else if(anchor)resume(anchor,true);
      let previousAt=anchor?.at??s.inceptionAt,previousRevision=boundary,internalStop=false,lastControl:{at:number;reason:string}|null=null;
      const stops:Array<{revision:number;actionId:string;at:number}>=[],intents:Array<{revision:number;actionId:string;at:number;kind:string;payloadHash:string|null;resultSha256:string}>=[];
      for(const r of rows){
        if(r.revision<=previousRevision||r.at<previousAt)return no('INTERNAL_SHUTDOWN_HISTORY_MALFORMED');previousRevision=r.revision;previousAt=r.at;
        const {payload,result}=read(r);intents.push({revision:r.revision,actionId:r.actionId,at:r.at,kind:r.kind,payloadHash:r.payloadHash,resultSha256:digest(result)});
        if(r.kind==='resume'){resume(r,false);continue;}
        if(r.kind==='safe-stop'){
          if(Object.keys(payload).join(',')!=='now'||typeof result.safeToExit!=='boolean'||!['management-required','stopped-safe'].includes(result.state)||!Number.isSafeInteger(result.openPositions)||result.openPositions<0||!Number.isSafeInteger(result.uncertainActions)||result.uncertainActions<0||!Array.isArray(result.canceledEntries)||!isV3PaperRiskState(s)&&result.canceledEntries.length>3||!result.canceledEntries.every((id:unknown)=>boundedText(id,100))||result.safeToExit!==(result.openPositions===0&&result.uncertainActions===0)||result.state!==(result.safeToExit?'stopped-safe':'management-required'))return no('INTERNAL_SHUTDOWN_HISTORY_MALFORMED');
          const match=/^native-paper-(?:stop|finally):(native-paper-\d{17})$/.exec(r.actionId),run=match?runs.get(match[1]!):undefined;
          if(!match||run===undefined||r.at<run)return no('INTERNAL_SHUTDOWN_OWNER_OR_UNKNOWN_STOP');
          if(stops.length>=p.maximumStops)return no('INTERNAL_SHUTDOWN_STOP_BOUND');stops.push({revision:r.revision,actionId:r.actionId,at:r.at});internalStop=true;lastControl={at:r.at,reason:'safe stop requested'};continue;
        }
        if(r.kind!=='pause'||Object.keys(payload).sort().join(',')!=='now,reason'||!boundedText(payload.reason)||Object.keys(result).sort().join(',')!=='paused,pendingBuyCancellations'||result.paused!==true||!Array.isArray(result.pendingBuyCancellations)||!isV3PaperRiskState(s)&&result.pendingBuyCancellations.length>3||!result.pendingBuyCancellations.every((id:unknown)=>boundedText(id,100)))return no('INTERNAL_SHUTDOWN_HISTORY_MALFORMED');
        const ordinary=/^trader:pause:(\d+):(\d+)$/.exec(r.actionId),restored=/^trader:restore-hard-pause:(\d+):(\d+)$/.exec(r.actionId),recovery=r.actionId===`execution-recovery:${s.accountId}:${r.revision-1}`;
        const stamp=ordinary??restored,typed=stamp&&Number(stamp[1])===r.revision-1&&Number.isSafeInteger(Number(stamp[2]))&&Number(stamp[2])>=s.inceptionAt&&Number(stamp[2])<=at;
        if(payload.reason==='safe stop requested'&&restored&&typed&&internalStop){lastControl={at:r.at,reason:payload.reason};continue;}
        if(!INTERNAL_SHUTDOWN_SOFT_PAUSES.has(payload.reason)||!(ordinary&&typed||recovery&&payload.reason==='execution startup: fresh reconciliation/readiness required'))return no('INTERNAL_SHUTDOWN_HARD_OR_UNKNOWN_PAUSE');
        lastControl={at:r.at,reason:payload.reason};
      }
      if(!internalStop||!lastControl)return no('INTERNAL_SHUTDOWN_CHAIN_ABSENT');
      if(s.controls.changedAt!==lastControl.at||s.controls.reason!==lastControl.reason||this.state().revision!==s.revision)return no('INTERNAL_SHUTDOWN_STATE_CHANGED');
      const identity={accountId:s.accountId,inceptionAt:s.inceptionAt,stateRevision:s.revision,lastSuccessfulResumeRevision:successfulResumeRevision};
      return {verified:true,...identity,stops,proofSha256:digest({version:p.version,...identity,knownRunIds:[...runs.keys()].sort(),anchor:anchor?{revision:anchor.revision,actionId:anchor.actionId,at:anchor.at,payloadHash:anchor.payloadHash,resultSha256:digest(JSON.parse(anchor.result!))}:null,intents})};
    }catch{return no('INTERNAL_SHUTDOWN_HISTORY_MALFORMED');}
  }
  /** Bounded read model; absence means unknown coverage, never assumed free operations. */
  getOperatingCosts(): OperatingCostState {
    const account = this.state();
    const size = this.db.prepare("SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key='operating_costs'").get() as { size: number } | undefined;
    if (!size) {
      // Existing durable action/journal IDs provide this indexed history check; do not
      // scan the journal or silently reseed a lost cost projection on refresh.
      for (const [from, through] of [['cost:', 'cost;'], ['cost-valuation:', 'cost-valuation;']]) {
        const action = this.db.prepare('SELECT 1 FROM actions WHERE id>=? AND id<? LIMIT 1').get(from, through);
        const journal = this.db.prepare('SELECT 1 FROM journal WHERE action_id>=? AND action_id<? LIMIT 1').get(from, through);
        if (action || journal) throw new Error('operating cost metadata missing from recorded history; recovery required');
      }
      return initializeOperatingCosts(account.accountId, account.inceptionAt);
    }
    if (size.size > 262_144) throw new Error('operating cost metadata limit');
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get() as { value: string };
    const costs = JSON.parse(row.value) as OperatingCostState;
    validateOperatingCosts(costs);
    if (costs.accountId !== account.accountId || costs.inceptionAt !== account.inceptionAt || costs.lastRecordedAt > account.lastAt) throw new Error('operating cost account/inception chronology mismatch');
    return costs;
  }
  /** Uses the same atomic journal/action/metadata transaction as PAPER finance.
   * Operating outlays affect economic P&L, not this virtual account's cash. */
  recordOperatingCost(event: OperatingCostEvent, now = event.recordedAt) {
    const identity = event.kind === 'valuation' ? event.expense?.id : event.id;
    if (!boundedText(identity, 128)) throw new Error('bounded operating cost action identity required');
    const actionId = event.kind === 'valuation' ? 'cost-valuation:' + identity : 'cost:' + identity;
    return this.apply(actionId, 'operating-cost', now, { event }, account => {
      // Deliberately inside apply: an identical old action returns its durable
      // result first, without rebasing original knowledge time or reapplying it.
      if (now !== event.recordedAt) throw new Error('new operating cost recording time must equal its evidence time');
      if (event.kind === 'valuation') {
        const row = this.db.prepare('SELECT kind, detail FROM journal WHERE action_id=?').get('cost:' + event.expense.id) as { kind: string; detail: string } | undefined;
        const original = row ? JSON.parse(row.detail) as { event?: OperatingCostEvent } : undefined;
        if (row?.kind !== 'operating-cost' || original?.event?.kind !== 'expense' || !isDeepStrictEqual(original.event, event.expense)) throw new Error('original operating expense does not match authoritative journal');
      }
      const costs = applyOperatingCostEvent(this.getOperatingCosts(), event, now), body = JSON.stringify(costs);
      if (Buffer.byteLength(body) > 262_144) throw new Error('operating cost metadata limit');
      this.db.prepare("INSERT INTO metadata VALUES('operating_costs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(body);
      return { recorded: true, actionId, eventId: event.id, kind: event.kind, accountId: account.accountId, inceptionAt: account.inceptionAt, recordedAt: now };
    });
  }
  /** One explicit owner-authorized PAPER capital transition. A verified full
   * SQLite snapshot and zero unresolved obligations precede the append. No
   * historical row, identity, cost metadata, or lifetime counter is rewritten. */
  async beginAuthorizedTenSolEpoch(input:{authorization:typeof PAPER_TEN_SOL_EPOCH_AUTHORIZATION;price:UsdPrice;backupDirectory:string;assetDisposition?:typeof PAPER_EPOCH_ASSET_SEGREGATION},clock:()=>number=Date.now):Promise<{epoch:PaperEpoch;backup:PaperEpochBackupReceipt;alreadyApplied:boolean}> {
    if(input.authorization!==PAPER_TEN_SOL_EPOCH_AUTHORIZATION)throw Error('PAPER_EPOCH_OWNER_AUTHORIZATION_REQUIRED');
    const id='epoch:'+PAPER_TEN_SOL_EPOCH_ID,existing=this.state();
    if(existing.paperEpoch){this.validateEpochAnchor(existing);const prior=this.actionResult(id) as {epoch:PaperEpoch;backup:PaperEpochBackupReceipt};return {...structuredClone(prior),alreadyApplied:true};}
    if(this.db.prepare('SELECT 1 FROM actions WHERE id=?').get(id)||this.db.prepare('SELECT 1 FROM journal WHERE action_id=?').get(id))throw Error('PAPER_EPOCH_HISTORY_CONFLICT');
    requireEpochFlat(existing,input.assetDisposition);if(this.equityRiskStatus(existing).kind!=='active')throw Error('PAPER_EPOCH_VERIFIED_EQUITY_RISK_REQUIRED');
    const assets=verifyArchivedEpochAssets(this.db,existing);
    const backup=await verifiedEpochBackup(this.db,input.backupDirectory,s=>validateFinancialState(s,this.accountId,this.mode),input.assetDisposition);
    const at=clock(),p=priceAt(input.price,at),previousState=this.state();if(previousState.revision!==backup.revision||paperEpochStateSha256(previousState)!==backup.stateSha256)throw Error('PAPER_EPOCH_SOURCE_CHANGED_AFTER_BACKUP');
    requireEpochFlat(previousState,input.assetDisposition);if(!Number.isSafeInteger(at)||at<previousState.lastAt||at<previousState.inceptionAt)throw Error('PAPER_EPOCH_TIME_INVALID');
    const epoch:PaperEpoch={version:PAPER_EPOCH_VERSION,id:PAPER_TEN_SOL_EPOCH_ID,startedAt:at,transitionRevision:previousState.revision+1,initialLamports:'10000000000',initialMicroUsd:(10n*p).toString(),price:structuredClone(input.price),priorStateSha256:backup.stateSha256,backupSha256:backup.backupSha256,priorRealizedLamports:previousState.realizedLamports,priorExecutionCostsLamports:previousState.executionCosts,priorOperatingCostsMicroUsd:projectOperatingCosts(this.getOperatingCosts(),{asOf:at,now:at,tradingPnlMicroUsd:null}).operatingCostsMicroUsd,capitalAdjustmentLamports:(10000000000n-BigInt(assets.totalLamports)).toString(),contributionLamports:'10000000000',capitalArchivedLamports:assets.totalLamports,archivedAssets:assets};
    const result=this.apply(id,'paper-epoch-transition',at,{authorization:input.authorization,assetDisposition:input.assetDisposition??null,previousState,epoch,backup},s=>{
      if(s.paperEpoch||s.revision!==backup.revision||paperEpochStateSha256(s)!==backup.stateSha256)throw Error('PAPER_EPOCH_SOURCE_CHANGED_BEFORE_APPEND');requireEpochFlat(s,input.assetDisposition);
      s.paperEpoch=epoch;s.lamports=epoch.initialLamports;s.lockedDeposits={};
      s.daily={day:utcDay(at),baselineMicroUsd:epoch.initialMicroUsd,paused:true,lossPaused:false,reconciledAt:0};
      // The only day reset is this explicit epoch transition. Later restarts
      // retain the same epoch high water and pause; ordinary UTC days scan only
      // same-epoch reconciliation receipts while retaining the full old prefix.
      s.equityRisk!.daily={day:utcDay(at),highWaterMicroUsd:epoch.initialMicroUsd,highWaterAt:at,lossPaused:false,historyState:'complete',historyCoverage:'first-complete-observation',historyCutoffRevision:s.revision,historyCursorRevision:s.revision,historyReceipts:0,historyDigest:digest({epoch,backup:backup.logicalSha256})};
      s.controls={entriesEnabled:false,reason:'execution startup: fresh reconciliation/readiness required',changedAt:at,readinessVersion:null,stopRequested:false};
      return {epoch:structuredClone(epoch),backup:structuredClone(backup)};
    });
    this.validateEpochAnchor(this.state());return {...result,alreadyApplied:false};
  }
  /** Owner-authorized V3 is a distinct, append-only capital/policy boundary.
   * The old epoch, latches, policies and every lifetime row remain recoverable.
   * Reruns return the original receipt without another contribution or reset. */
  async beginAuthorizedV3TenSolEpoch(input:{authorization:typeof PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION;price:UsdPrice;backupDirectory:string;assetDisposition?:typeof PAPER_EPOCH_ASSET_SEGREGATION},clock:()=>number=Date.now):Promise<{epoch:V3PaperEpoch;backup:PaperEpochBackupReceipt;alreadyApplied:boolean;riskPolicy:typeof PAPER_V3_EQUITY_RISK_POLICY;equityRisk:EquityRiskState}> {
    if(input.authorization!==PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION)throw Error('PAPER_V3_EPOCH_OWNER_AUTHORIZATION_REQUIRED');
    const id='epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID,existing=this.state();
    if(existing.paperEpoch?.id===PAPER_V3_TEN_SOL_EPOCH_ID){
      this.validateEpochAnchor(existing);if(this.equityRiskStatus(existing).kind!=='active')throw Error('PAPER_V3_EPOCH_POLICY_UNAVAILABLE');
      const prior=this.actionResult(id) as {epoch:V3PaperEpoch;backup:PaperEpochBackupReceipt;riskPolicy:typeof PAPER_V3_EQUITY_RISK_POLICY;equityRisk:EquityRiskState};return {...structuredClone(prior),alreadyApplied:true};
    }
    if(existing.paperEpoch?.id!==PAPER_TEN_SOL_EPOCH_ID||existing.equityRisk?.version!==PAPER_EQUITY_RISK_VERSION||this.equityRiskStatus(existing).kind!=='active')throw Error('PAPER_V3_VERIFIED_PREVIOUS_EPOCH_REQUIRED');
    if(this.db.prepare('SELECT 1 FROM actions WHERE id=?').get(id)||this.db.prepare('SELECT 1 FROM journal WHERE action_id=?').get(id))throw Error('PAPER_V3_EPOCH_HISTORY_CONFLICT');
    requireEpochFlat(existing,input.assetDisposition);const assets=verifyArchivedEpochAssets(this.db,existing);
    const backup=await verifiedEpochBackup(this.db,input.backupDirectory,s=>validateFinancialState(s,this.accountId,this.mode),input.assetDisposition,PAPER_V3_TEN_SOL_EPOCH_ID);
    const at=clock(),p=priceAt(input.price,at),previousState=this.state();
    if(previousState.revision!==backup.revision||paperEpochStateSha256(previousState)!==backup.stateSha256)throw Error('PAPER_EPOCH_SOURCE_CHANGED_AFTER_BACKUP');
    requireEpochFlat(previousState,input.assetDisposition);if(previousState.paperEpoch?.id!==PAPER_TEN_SOL_EPOCH_ID||!Number.isSafeInteger(at)||at<=previousState.paperEpoch.startedAt||at<previousState.lastAt)throw Error('PAPER_V3_EPOCH_TIME_OR_CHAIN_INVALID');
    const epoch:V3PaperEpoch={version:PAPER_V3_EPOCH_VERSION,id:PAPER_V3_TEN_SOL_EPOCH_ID,priorEpoch:structuredClone(previousState.paperEpoch),startedAt:at,transitionRevision:previousState.revision+1,initialLamports:'10000000000',initialMicroUsd:(10n*p).toString(),price:structuredClone(input.price),priorStateSha256:backup.stateSha256,backupSha256:backup.backupSha256,priorRealizedLamports:previousState.realizedLamports,priorExecutionCostsLamports:previousState.executionCosts,priorOperatingCostsMicroUsd:projectOperatingCosts(this.getOperatingCosts(),{asOf:at,now:at,tradingPnlMicroUsd:null}).operatingCostsMicroUsd,capitalAdjustmentLamports:(10000000000n-BigInt(assets.totalLamports)).toString(),contributionLamports:'10000000000',capitalArchivedLamports:assets.totalLamports,archivedAssets:assets};
    const result=this.apply(id,'paper-epoch-transition',at,{authorization:input.authorization,assetDisposition:input.assetDisposition??null,previousState,epoch,backup,riskPolicy:PAPER_V3_EQUITY_RISK_POLICY},s=>{
      if(s.paperEpoch?.id!==PAPER_TEN_SOL_EPOCH_ID||s.revision!==backup.revision||paperEpochStateSha256(s)!==backup.stateSha256)throw Error('PAPER_EPOCH_SOURCE_CHANGED_BEFORE_APPEND');requireEpochFlat(s,input.assetDisposition);
      s.paperEpoch=epoch;s.lamports=epoch.initialLamports;s.lockedDeposits={};
      s.daily={day:utcDay(at),baselineMicroUsd:epoch.initialMicroUsd,paused:true,lossPaused:false,reconciledAt:0};
      s.equityRisk={version:PAPER_V3_EQUITY_RISK_VERSION,activatedAt:at,activationRevision:s.revision+1,daily:{day:utcDay(at),highWaterMicroUsd:epoch.initialMicroUsd,highWaterAt:at,lossPaused:false,historyState:'complete',historyCoverage:'first-complete-observation',historyCutoffRevision:s.revision,historyCursorRevision:s.revision,historyReceipts:0,historyDigest:digest({epoch,backup:backup.logicalSha256,riskPolicy:PAPER_V3_EQUITY_RISK_POLICY})}};
      s.controls={entriesEnabled:false,reason:'execution startup: fresh reconciliation/readiness required',changedAt:at,readinessVersion:null,stopRequested:false};
      return {epoch:structuredClone(epoch),backup:structuredClone(backup),riskPolicy:PAPER_V3_EQUITY_RISK_POLICY,equityRisk:structuredClone(s.equityRisk)};
    });
    this.validateEpochAnchor(this.state());return {...result,alreadyApplied:false};
  }
  async backup(path: string) { await this.db.backup(path); }
  nextSnapshotSequence() {
    this.state();
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get() as { value: string } | undefined;
      if (row && !/^(0|[1-9][0-9]{0,39})$/.test(row.value)) throw new Error('reporting sequence metadata invalid');
      const next = (BigInt(row?.value ?? '0') + 1n).toString();
      if (next.length > 40) throw new Error('reporting sequence exhausted');
      this.db.prepare("INSERT INTO metadata VALUES('snapshot_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(next);
      return next;
    }).immediate();
  }
  private validateReportingPoint(point: ReportingPoint, inceptionAt: number) {
    if (!point || typeof point !== 'object' || Array.isArray(point) || Object.keys(point).sort().join(',') !== 'at,economicMicroUsd,tradingMicroUsd' || !Number.isSafeInteger(point.at) || point.at < inceptionAt) throw new Error('invalid reporting point identity/time');
    for (const value of [point.tradingMicroUsd, point.economicMicroUsd]) {
      if (value === null) continue;
      if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) throw new Error('integer reporting value required');
      amount(value.startsWith('-') ? value.slice(1) : value);
    }
  }
  getReportingHistory(): ReportingHistory {
    const inceptionAt = this.state().inceptionAt;
    const size = this.db.prepare("SELECT length(value) size FROM metadata WHERE key='reporting_history'").get() as { size: number } | undefined;
    if (!size) return { points: [], windowLimited: false, downsampled: false };
    if (size.size > 262_144) throw new Error('reporting history metadata limit');
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='reporting_history'").get() as { value: string };
    const history = JSON.parse(row.value) as ReportingHistory;
    if (!history || typeof history !== 'object' || Object.keys(history).sort().join(',') !== 'downsampled,points,windowLimited' || !Array.isArray(history.points) || history.points.length > 720 || typeof history.windowLimited !== 'boolean' || typeof history.downsampled !== 'boolean') throw new Error('invalid reporting history metadata');
    let previous = -Infinity;
    for (const point of history.points) {
      this.validateReportingPoint(point, inceptionAt);
      if (point.at <= previous) throw new Error('reporting history chronology');
      previous = point.at;
    }
    if (!history.windowLimited && history.points.length && (history.points[0]!.at !== inceptionAt || history.points[0]!.tradingMicroUsd !== '0')) throw new Error('reporting inception point mismatch');
    return history;
  }
  recordReportingPoint(point: ReportingPoint): ReportingHistory {
    this.validateReportingPoint(point, this.state().inceptionAt);
    return this.db.transaction(() => {
      const history = this.getReportingHistory(), last = history.points.at(-1);
      if (last && point.at < last.at) throw new Error('reporting point regression');
      if (last && point.at === last.at) {
        if (point.tradingMicroUsd !== last.tradingMicroUsd || point.economicMicroUsd !== last.economicMicroUsd) throw new Error('reporting point conflict');
        return history;
      }
      history.points.push({ ...point });
      if (history.points.length > 720) {
        // Preserve first/last and every actual null-transition boundary. Thin
        // the densest interior sample, without fabricating any point or gap.
        const mask = (p: ReportingPoint) => `${p.tradingMicroUsd === null}:${p.economicMicroUsd === null}`;
        let remove = -1, smallestSpan = Infinity;
        for (let i = 1; i < history.points.length - 1; i++) {
          const before = history.points[i - 1]!, current = history.points[i]!, after = history.points[i + 1]!;
          const span = after.at - before.at;
          if (mask(before) === mask(current) && mask(current) === mask(after) && span < smallestSpan) { remove = i; smallestSpan = span; }
        }
        if (remove >= 0) { history.points.splice(remove, 1); history.downsampled = true; }
        else { history.points.shift(); history.windowLimited = true; }
      }
      this.db.prepare("INSERT INTO metadata VALUES('reporting_history',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(history));
      return history;
    }).immediate();
  }
  getOperatingReportingHistory():OperatingReportingHistory {
    const inceptionAt=this.state().inceptionAt,size=this.db.prepare('SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key=?').get(REPORTING_OPERATING_HISTORY_KEY) as {size:number}|undefined;
    if(!size)return {schemaVersion:2,basis:OPERATING_REPORTING_BASIS,cutoverAt:null,firstObservedAt:null,points:[{at:inceptionAt,tradingMicroUsd:'0',economicMicroUsd:null}],windowLimited:false,downsampled:false};
    if(size.size>262144)throw Error('operating reporting history metadata limit');
    const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(REPORTING_OPERATING_HISTORY_KEY) as {value:string};
    return validateOperatingReportingHistory(JSON.parse(row.value),inceptionAt);
  }
  /** Only reporting metadata is written. observedAt is the actual source
   * observation time; historical null markers denote absence, not old prices. */
  recordOperatingReportingPoint(point:ReportingPoint,observedAt:number):OperatingReportingHistory {
    const inceptionAt=this.state().inceptionAt;this.validateReportingPoint(point,inceptionAt);
    if(!Number.isSafeInteger(observedAt)||observedAt<point.at)throw Error('operating reporting observation time');
    const inceptionPoint=point.at===inceptionAt&&point.tradingMicroUsd==='0'&&point.economicMicroUsd===null;
    if(!inceptionPoint&&point.at<observedAt&&(point.tradingMicroUsd!==null||point.economicMicroUsd!==null))throw Error('operating reporting data cannot be backdated');
    return this.db.transaction(()=>{
      const h=this.getOperatingReportingHistory(),last=h.points.at(-1)!;
      if(point.at<last.at)throw Error('operating reporting point regression');
      if(point.at===last.at){if(point.tradingMicroUsd!==last.tradingMicroUsd||point.economicMicroUsd!==last.economicMicroUsd)throw Error('operating reporting point conflict');return h;}
      if(h.cutoverAt===null)h.cutoverAt=observedAt;
      if(h.points.length===1&&point.at>inceptionAt+1)h.points.push({at:inceptionAt+1,tradingMicroUsd:null,economicMicroUsd:null});
      h.points.push({...point});
      if(point.tradingMicroUsd!==null&&h.firstObservedAt===null)h.firstObservedAt=point.at;
      while(h.points.length>720){
        const mask=(p:ReportingPoint)=>`${p.tradingMicroUsd===null}:${p.economicMicroUsd===null}`;let remove=-1,smallest=Infinity;
        for(let i=1;i<h.points.length-1;i++){const a=h.points[i-1]!,b=h.points[i]!,c=h.points[i+1]!,span=c.at-a.at;if(mask(a)===mask(b)&&mask(b)===mask(c)&&span<smallest){remove=i;smallest=span;}}
        if(remove>=0){h.points.splice(remove,1);h.downsampled=true;}
        else{const gap=h.points[1]?.at===inceptionAt+1&&h.points[1].tradingMicroUsd===null&&h.points[1].economicMicroUsd===null;h.points.splice(gap?2:1,1);h.windowLimited=true;if(!gap&&h.points[1]!.at>inceptionAt+1)h.points.splice(1,0,{at:inceptionAt+1,tradingMicroUsd:null,economicMicroUsd:null});}
      }
      const validated=validateOperatingReportingHistory(h,inceptionAt),body=JSON.stringify(validated);if(Buffer.byteLength(body)>262144)throw Error('operating reporting history metadata limit');
      this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(REPORTING_OPERATING_HISTORY_KEY,body);return validated;
    }).immediate();
  }
  projection(now: number, price?: UsdPrice, marks: Record<string, Mark> = {}) {
    const s = this.state();
    const reservedLamports = Object.values(s.pending).reduce((sum, o) => sum + amount(o.reserved), 0n);
    const lockedDepositLamports = Object.values(s.lockedDeposits).reduce((sum, n) => sum + amount(n), 0n);
    let equityLamports: bigint | null = amount(s.lamports) + lockedDepositLamports;
    let unknownMarks = false;
    let positionLiquidationLamports = 0n;
    for (const position of Object.values(s.positions)) {
      const mark = marks[position.mint];
      if (!mark || !boundedText(mark.evidence) || mark.pricedBaseUnits !== position.units || !Number.isSafeInteger(mark.at) || mark.at > now || now - mark.at > MAX_QUOTE_AGE) { unknownMarks = true; continue; }
      positionLiquidationLamports += amount(mark.netLamports);
    }
    equityLamports = unknownMarks ? null : equityLamports + positionLiquidationLamports;
    let p: bigint | null = null;
    try { if (price) p = priceAt(price, now); } catch { /* Explicit unknown USD valuation. */ }
    const initialLamports = s.paperEpoch?amount(s.paperEpoch.initialLamports):INITIAL * L / amount(s.inceptionPrice.microUsdPerSol),initialMicroUsd=s.paperEpoch?amount(s.paperEpoch.initialMicroUsd):INITIAL,residual=s.paperEpoch?0n:amount(s.roundingResidualMicroUsd);
    const equityMicroUsd = p !== null && equityLamports !== null ? usd(equityLamports, p) + residual : null;
    const passiveSolEquityMicroUsd = p !== null ? usd(initialLamports, p) + residual : null;
    const totalPnlMicroUsd = equityMicroUsd === null ? null : (equityMicroUsd - initialMicroUsd).toString();
    const lifetimeOperating = projectOperatingCosts(this.getOperatingCosts(), { asOf: now, now, tradingPnlMicroUsd: totalPnlMicroUsd });
    const epochOperating=s.paperEpoch?(lifetimeOperating.operatingCostsMicroUsd===null||s.paperEpoch.priorOperatingCostsMicroUsd===null?null:(BigInt(lifetimeOperating.operatingCostsMicroUsd)-BigInt(s.paperEpoch.priorOperatingCostsMicroUsd)).toString()):lifetimeOperating.operatingCostsMicroUsd;
    const operating={...lifetimeOperating,operatingCostsMicroUsd:epochOperating,economicPnlMicroUsd:epochOperating===null||totalPnlMicroUsd===null?null:(BigInt(totalPnlMicroUsd)-BigInt(epochOperating)).toString(),classification:epochOperating===null?'unavailable' as const:lifetimeOperating.classification};
    const dayFresh = s.daily.day === utcDay(now) && s.daily.reconciledAt > 0 && now >= s.daily.reconciledAt && now - s.daily.reconciledAt <= MAX_QUOTE_AGE;
    const policy=this.equityRiskStatus(s),risk=policy.kind==='active'?s.equityRisk:undefined,d=risk?.daily,historyReady=!!d&&d.day===utcDay(now)&&d.historyState==='complete';
    const drawdown=historyReady&&d.highWaterMicroUsd!==null&&equityMicroUsd!==null?drawdownFacts(amount(d.highWaterMicroUsd),equityMicroUsd):null;
    const v3=isV3PaperEpochState(s),lossBlocked=!v3&&(d?.lossPaused===true||drawdown?.breached===true);
    const riskReason=!risk?null:d?.historyState==='invalid'?'EQUITY_RISK_HISTORY_UNAVAILABLE':!historyReady?'EQUITY_RISK_INITIALIZING':equityMicroUsd===null?'EQUITY_RISK_VALUATION_UNAVAILABLE':!dayFresh?'EQUITY_RISK_RECONCILIATION_STALE':lossBlocked?'EQUITY_RISK_DAILY_DRAWDOWN':null;
    const target=historyReady&&equityMicroUsd!==null&&p!==null?consumedEntryAllowance(equityMicroUsd,p):null,unreserved=amount(s.lamports)-reservedLamports,cashAllowance=unreserved>amount(s.gasReserve)?unreserved-amount(s.gasReserve):0n;
    const equityRisk=risk?{version:risk.version,state:historyReady&&equityMicroUsd!==null&&dayFresh?'ready' as const:'unavailable' as const,reasonCode:riskReason,asOf:now,entry:{targetBps:500,targetConsumedCostMicroUsd:target===null?null:(equityMicroUsd!*500n/10000n).toString(),targetConsumedCostLamports:target?.toString()??null,unreservedCashLamports:unreserved.toString(),cashLimitedConsumedCostLamports:target===null?null:(target<cashAllowance?target:cashAllowance).toString(),refundableDepositsIncluded:false,executabilityClaimed:false},daily:{day:d!.day,limitBps:v3?null:1000,highWaterMicroUsd:d!.highWaterMicroUsd,highWaterAt:d!.highWaterAt,currentEquityMicroUsd:equityMicroUsd?.toString()??null,drawdownMicroUsd:drawdown?.drawdownMicroUsd??null,drawdownBps:drawdown?.drawdownBps??null,remainingBeforePauseMicroUsd:v3?null:drawdown?.remainingBeforePauseMicroUsd??null,lossPaused:lossBlocked,historyCoverage:d!.historyCoverage,basis:'complete-observed-executable-equity-current-usd'}}:policy.kind==='unavailable'?{version:v3?PAPER_V3_EQUITY_RISK_VERSION:PAPER_EQUITY_RISK_VERSION,state:'unavailable' as const,reasonCode:policy.reasonCode!,asOf:now,entry:{targetBps:500,targetConsumedCostMicroUsd:null,targetConsumedCostLamports:null,unreservedCashLamports:unreserved.toString(),cashLimitedConsumedCostLamports:null,refundableDepositsIncluded:false,executabilityClaimed:false},daily:{day:utcDay(now),limitBps:v3?null:1000,highWaterMicroUsd:null,highWaterAt:null,currentEquityMicroUsd:equityMicroUsd?.toString()??null,drawdownMicroUsd:null,drawdownBps:null,remainingBeforePauseMicroUsd:null,lossPaused:dailyLossEntryBlocked(s),historyCoverage:'unavailable' as const,basis:'complete-observed-executable-equity-current-usd'}}:null;
    return {
      ...(equityRisk?{equityRisk}:{}),
      accountId: s.accountId, mode: s.mode, inceptionAt: s.inceptionAt, initialMicroUsd: s.initialMicroUsd, revision: s.revision,
      cashLamports: s.lamports, reservedLamports: reservedLamports.toString(), lockedDepositLamports: lockedDepositLamports.toString(),
      equityLamports: equityLamports?.toString() ?? null, equityMicroUsd: equityMicroUsd?.toString() ?? null,
      totalPnlLamports: equityLamports === null ? null : (equityLamports - initialLamports).toString(),
      totalPnlMicroUsd,
      operatingCostsMicroUsd: operating.operatingCostsMicroUsd, economicPnlMicroUsd: operating.economicPnlMicroUsd, operatingCostClassification: operating.classification,
      passiveSolEquityMicroUsd: passiveSolEquityMicroUsd?.toString() ?? null,
      solPriceEffectMicroUsd: passiveSolEquityMicroUsd === null ? null : (passiveSolEquityMicroUsd - initialMicroUsd).toString(),
      realizedLamports: (BigInt(s.realizedLamports)-BigInt(s.paperEpoch?.priorRealizedLamports??'0')).toString(), executionCostsLamports: (BigInt(s.executionCosts)-BigInt(s.paperEpoch?.priorExecutionCostsLamports??'0')).toString(),
      lifetimeRealizedLamports:s.realizedLamports,lifetimeExecutionCostsLamports:s.executionCosts,
      paperEpoch:s.paperEpoch?structuredClone(s.paperEpoch):null,epochInitialLamports:initialLamports.toString(),epochInitialMicroUsd:initialMicroUsd.toString(),
      positionLiquidationLamports: unknownMarks ? null : positionLiquidationLamports.toString(),
      positionCostMicroUsd: Object.values(s.positions).reduce((sum, x) => sum + amount(x.costMicroUsd), 0n).toString(),
      openPositions: Object.keys(s.positions).length, pendingActions: Object.keys(s.pending).length,
      entriesEnabled: s.controls.entriesEnabled && !s.controls.stopRequested && !s.daily.paused && dayFresh && equityMicroUsd !== null && policy.kind!=='unavailable' && (!risk||historyReady&&!lossBlocked),
      unknownMarks, usdValuationAvailable: p !== null, daily: s.daily, controls: s.controls,
    };
  }
  integrity() { return this.db.pragma('integrity_check', { simple: true }); }
  close() {
    try { this.db.close(); }
    finally { if (this.ownerFd !== undefined) { closeSync(this.ownerFd); this.ownerFd = undefined; } }
  }
}

/** Fixture wrapper uses the same accounting implementation and rejects production identities. */
export class DisposableLedger extends PaperLedger {
  constructor(path: string, readonly fixtureId: string) { super(path, fixtureId, 'DISPOSABLE_PAPER'); }
}
