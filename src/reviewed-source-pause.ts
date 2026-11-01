/** Owner-requested recovery of one authenticated historical source-only
 * quarantine. This is not a reason whitelist, capital reset or entry grant.
 * A replacement process still needs all current financial/source proofs. */
import {createHash} from 'node:crypto';
import type {LedgerState} from './ledger.js';
import type {ReviewedContentionHistory} from './reviewed-market-contention.js';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const REVIEWED_SOURCE_PAUSE = Object.freeze({
  version: 'reviewed-source-quarantine-247900-v1',
  accountId: 'poe-3123e352-4581-455b-85db-acd7e825e99e',
  inceptionAt: 1793052456212, epochId: 'poe-paper-10sol-v3-20261030',
  sourceCommit: 'bb145cc82b0f05560b03bbd9e53de0c9e360f48f',
  anchorRevision: 246832, anchorAt: 1793558513312,
  anchorActionSha256: '9d718797a325de03a6dc772ef783516e2fb8f57ff5fa32f0c6ca5cceaf15654a',
  pauseRevision: 247900, pauseAt: 1793560027961,
  pauseActionSha256: '929152ecac1d78bf6bcf979995164092421d3dab28e27f6f3bcda479e5471ecf',
  pauseDetailSha256: '98f18d1e402955986eae2a1924cf6e44a7c1327a351ab878bd7972f01e03de8f',
  pauseReasonSha256: '184dc639bc4ffe5d12240228a7699ebad26c3df20a2191d6a27e7fdd43c4de8d',
  cashLamports: '9856630758', lockedDepositCount: 9, lockedDepositLamports: '13624560',
  entryPermissionGranted: false,
} as const);
/** The caller has already authenticated joined journal/actions, chronology,
 * payloads and results. Hashes below bind the retained incident, never text
 * supplied by a candidate or a later ordinary hard pause. */
export type ReviewedSourcePauseState = Omit<LedgerState, 'controls'> & {controls: Omit<LedgerState['controls'], 'reason'> & {reasonSha256: string}};
export function reviewedSourcePauseLineage(s: Readonly<ReviewedSourcePauseState>, h: ReviewedContentionHistory | null): boolean {
  const p = REVIEWED_SOURCE_PAUSE;
  if (!h || s.accountId !== p.accountId || s.inceptionAt !== p.inceptionAt || s.mode !== 'PAPER'
    || s.paperEpoch?.id !== p.epochId || s.equityRisk?.version !== 'paper-equity-risk-v3-no-daily-stop-v1'
    || s.lamports !== p.cashLamports || s.controls.entriesEnabled || s.controls.stopRequested || s.daily.lossPaused
    || Object.keys(s.positions).length || Object.keys(s.pending).length
    || Object.keys(s.lockedDeposits).length !== p.lockedDepositCount
    || Object.values(s.lockedDeposits).reduce((n, v) => n + BigInt(v), 0n).toString() !== p.lockedDepositLamports
    || h.anchor?.kind !== 'resume' || h.anchor.revision !== p.anchorRevision || h.anchor.at !== p.anchorAt
    || h.anchor.actionSha256 !== p.anchorActionSha256 || !h.controls.length) return false;
  const first = h.controls[0]!;
  if (first.kind !== 'pause' || first.revision !== p.pauseRevision || first.at !== p.pauseAt
    || first.actionSha256 !== p.pauseActionSha256 || first.detailSha256 !== p.pauseDetailSha256
    || first.reasonSha256 !== p.pauseReasonSha256 || !first.ordinary || first.startup || first.restored
    || !first.paused || first.cancellations !== 0) return false;
  let previous = first, startupRevision: number | null = null;
  for (const row of h.controls.slice(1)) {
    if (row.kind !== 'pause' || !row.paused || row.cancellations !== 0 || row.revision <= previous.revision
      || row.at < previous.at || Number(row.ordinary) + Number(row.startup) + Number(row.restored) !== 1) return false;
    if (row.startup && row.temporary) startupRevision = row.revision;
    else if (row.restored && startupRevision !== null && row.revision === startupRevision + 1
      && row.reasonSha256 === p.pauseReasonSha256
      && row.actionSha256 === sha('trader:restore-hard-pause:' + startupRevision + ':' + row.at)) startupRevision = null;
    else if (row.ordinary && row.temporary) startupRevision = null;
    else return false; // Every newer owner, financial or unknown hard intent wins.
    previous = row;
  }
  return previous.revision <= s.revision && previous.at === s.controls.changedAt
    && previous.reasonSha256 === s.controls.reasonSha256;
}
