import {financialEpochLineage,validateFinancialEpochReport,type FinancialEpochReport} from './financial-epoch-reporting.js';
import { ORIGINAL_POE_ACCOUNT, ORIGINAL_POE_INCEPTION } from './operating-intelligence.js';

/**
 * Reporting-only, source-owned equity evidence. This is not a P&L series and is
 * never allowed to write to, replace, or determine the PAPER financial state.
 */
export const LIFETIME_EQUITY_SOURCE = 'original-ec2-verified-equity' as const;
export const MAX_LIFETIME_EQUITY_POINTS = 720;
export const EQUITY_GAP_MS = 5 * 60_000;

export type LifetimeEquityPoint = {
  at: string;
  equityUsd: number;
  segment: number;
  kind: 'inception' | 'observed' | 'epoch-start';
};
export type LifetimeEquityHistory = {
  schemaVersion: 1;
  financialEpoch?:FinancialEpochReport;
  accountId: typeof ORIGINAL_POE_ACCOUNT;
  inceptionAt: typeof ORIGINAL_POE_INCEPTION;
  source: typeof LIFETIME_EQUITY_SOURCE;
  lastSequence: string;
  downsampled: boolean;
  points: LifetimeEquityPoint[];
};

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) throw Error('EQUITY_OBJECT_REQUIRED');
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).sort().join('|') !== [...keys].sort().join('|')) throw Error('EQUITY_FIELDS_INVALID');
  return obj;
}
function utc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw Error('EQUITY_UTC_REQUIRED');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw Error('EQUITY_UTC_INVALID');
  return parsed;
}
export function validateLifetimeEquityHistory(input: unknown, now = Date.now()): LifetimeEquityHistory {
  const hasEpoch=!!input&&typeof input==='object'&&Object.hasOwn(input,'financialEpoch');
  const obj = exactObject(input, ['schemaVersion', 'accountId', 'inceptionAt', 'source', 'lastSequence', 'downsampled', 'points',...(hasEpoch?['financialEpoch']:[])]);
  const epoch=hasEpoch?validateFinancialEpochReport(obj.financialEpoch,new Date(now+30000).toISOString()):null;
  const epochs=epoch?financialEpochLineage(epoch):[];let epochsSeen=0;
  if (obj.schemaVersion !== 1 || obj.accountId !== ORIGINAL_POE_ACCOUNT ||
      obj.inceptionAt !== ORIGINAL_POE_INCEPTION || obj.source !== LIFETIME_EQUITY_SOURCE)
    throw Error('EQUITY_ORIGINAL_ACCOUNT_REQUIRED');
  if (typeof obj.lastSequence !== 'string' || !/^(0|[1-9]\d{0,39})$/.test(obj.lastSequence))
    throw Error('EQUITY_SEQUENCE_INVALID');
  if (typeof obj.downsampled !== 'boolean') throw Error('EQUITY_SAMPLE_LABEL_REQUIRED');
  if (!Array.isArray(obj.points) || obj.points.length < 1 || obj.points.length > MAX_LIFETIME_EQUITY_POINTS)
    throw Error('EQUITY_POINTS_BOUND');
  const inception = utc(obj.inceptionAt);
  let previousAt = -Infinity, previousSegment = -1;
  for (const [index, item] of obj.points.entries()) {
    const point = exactObject(item, ['at', 'equityUsd', 'segment', 'kind']);
    const at = utc(point.at);
    if (at < inception || at > now + 30_000 || at <= previousAt) throw Error('EQUITY_CHRONOLOGY');
    if (typeof point.equityUsd !== 'number' || !Number.isFinite(point.equityUsd) ||
        point.equityUsd < 0 || point.equityUsd > 1e15) throw Error('EQUITY_AMOUNT_INVALID');
    if (!Number.isSafeInteger(point.segment) || (point.segment as number) < 0 ||
        (point.segment as number) < previousSegment) throw Error('EQUITY_SEGMENTS_INVALID');
    if (point.kind !== 'inception' && point.kind !== 'observed' && point.kind!=='epoch-start') throw Error('EQUITY_KIND_INVALID');
    if (index === 0 && (point.kind !== 'inception' || at !== inception ||
        point.equityUsd !== 1000 || point.segment !== 0)) throw Error('EQUITY_INCEPTION_PROOF_REQUIRED');
    if (index > 0 && point.kind === 'inception') throw Error('EQUITY_INCEPTION_DUPLICATED');
    if(point.kind==='epoch-start'){
      const receipt=epochs[epochsSeen];if(!receipt||point.at!==receipt.activatedAt||point.equityUsd!==receipt.initialUsd||(point.segment as number)<=previousSegment)throw Error('EQUITY_EPOCH_PROOF_REQUIRED');
      epochsSeen++;
    }else if(epochs[epochsSeen]&&at>=Date.parse(epochs[epochsSeen]!.activatedAt))throw Error('EQUITY_EPOCH_MARKER_REQUIRED');
    previousAt = at;
    previousSegment = point.segment as number;
  }
  if(epochsSeen!==epochs.length)throw Error('EQUITY_EPOCH_MARKER_REQUIRED');
  if (Buffer.byteLength(JSON.stringify(input)) > 128 * 1024) throw Error('EQUITY_TRANSFER_BOUND');
  return structuredClone(input) as LifetimeEquityHistory;
}
