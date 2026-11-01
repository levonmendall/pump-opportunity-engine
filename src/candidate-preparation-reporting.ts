/** Bounded source facts about work before a selected subscription is opened.
 * These fields describe observation preparation and never grant entry permission. */
export const CANDIDATE_PREPARATION_VERSION = 'native-candidate-preparation-v1' as const;
export const CANDIDATE_PREPARATION_STATES = ['idle','awaiting-dispatch','validating-pool','awaiting-token-age','ready','awaiting-market-evidence','provider-unavailable'] as const;
export const CANDIDATE_PREPARATION_COUNTERS = ['attempts','poolReady','poolAbsent','poolUnsupported','providerUnavailable','allocationsFromPrepared'] as const;
export const CANDIDATE_PREPARATION_STAGES = ['pool-validation','token-age','allocation'] as const;
export type CandidatePreparationReporting = {
 version: typeof CANDIDATE_PREPARATION_VERSION;
 scope: 'CURRENT_SOURCE_INSTANCE';
 sourceInstanceId: string;
 runId: string;
 startedAt: string;
 generatedAt: string;
 state: typeof CANDIDATE_PREPARATION_STATES[number];
 currentMint: string | null;
 counters: Record<typeof CANDIDATE_PREPARATION_COUNTERS[number],number>;
 lastOutcome: {mint:string;pool:string;at:string;reason:string;stage:typeof CANDIDATE_PREPARATION_STAGES[number]} | null;
 progress: {lastAcknowledgedAt:string|null;lastAuditedAt:string|null;unproductiveSinceAt:string|null;serviceableSinceAt:string|null;lastAttemptAt:string|null;attemptsSinceProgress:number};
};
const INCEPTION = Date.parse('2026-10-26T22:07:36.212Z');
const record = (value:unknown):Record<string,any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,any> : {};
const integer = (value:unknown):value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const address = (value:unknown):value is string => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
function need(value:unknown):asserts value {if (!value) throw Error('CANDIDATE_PREPARATION_REPORTING_INVALID');}
function exact(value:unknown,keys:string) {
 const r=record(value);
 need(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(r).sort().join(' ') === keys.split(' ').sort().join(' '));
 return r;
}
function iso(value:unknown,at:number):string|null {
 return integer(value) && value >= INCEPTION && value <= at ? new Date(value).toISOString() : null;
}
export function projectCandidatePreparationReporting(status:unknown,generated:number):CandidatePreparationReporting|undefined {
 const raw=record(record(status).candidatePreparation);
 if (raw.version !== CANDIDATE_PREPARATION_VERSION) return undefined;
 try {
  const at=raw.generatedAt;
  need(integer(at) && at >= INCEPTION && at <= generated);
  const outcome=raw.lastOutcome===null ? null : record(raw.lastOutcome);
  const progress=record(raw.progress);
  const optionalTime=(value:unknown)=>{if(value===null)return null;const result=iso(value,at);need(result!==null);return result;};
  return validateCandidatePreparationReporting({
   version:raw.version,scope:raw.scope,sourceInstanceId:raw.sourceInstanceId,runId:raw.runId,
   startedAt:iso(raw.startedAt,at),generatedAt:new Date(at).toISOString(),state:raw.state,currentMint:raw.currentMint,
   counters:Object.fromEntries(CANDIDATE_PREPARATION_COUNTERS.map(key=>[key,record(raw.counters)[key]])),
   lastOutcome:outcome===null?null:{mint:outcome.mint,pool:outcome.pool,at:iso(outcome.at,at),reason:outcome.reason,stage:outcome.stage},
   progress:{lastAcknowledgedAt:optionalTime(progress.lastAcknowledgedAt),lastAuditedAt:optionalTime(progress.lastAuditedAt),unproductiveSinceAt:optionalTime(progress.unproductiveSinceAt),serviceableSinceAt:optionalTime(progress.serviceableSinceAt),lastAttemptAt:optionalTime(progress.lastAttemptAt),attemptsSinceProgress:progress.attemptsSinceProgress},
  },generated);
 } catch {return undefined;}
}
export function validateCandidatePreparationReporting(value:unknown,generated:number):CandidatePreparationReporting {
 const r=exact(value,'version scope sourceInstanceId runId startedAt generatedAt state currentMint counters lastOutcome progress');
 need(r.version===CANDIDATE_PREPARATION_VERSION && r.scope==='CURRENT_SOURCE_INSTANCE');
 need(typeof r.runId==='string' && /^[a-zA-Z0-9-]{1,128}$/.test(r.runId));
 need(typeof r.sourceInstanceId==='string' && r.sourceInstanceId.startsWith('native-runner:'+r.runId+':') && /^native-runner:[a-zA-Z0-9-]+:[a-zA-Z0-9-]+$/.test(r.sourceInstanceId));
 const time=(value:unknown,nullable=false):number|null=>{
  if (value===null && nullable) return null;
  const at=typeof value==='string'?Date.parse(value):NaN;
  need(integer(at) && at>=INCEPTION && at<=generated && new Date(at).toISOString()===value);return at;
 };
 const start=time(r.startedAt)!,at=time(r.generatedAt)!;
 need(start<=at && (CANDIDATE_PREPARATION_STATES as readonly unknown[]).includes(r.state) && (r.currentMint===null || address(r.currentMint)));
 for (const n of Object.values(exact(r.counters,CANDIDATE_PREPARATION_COUNTERS.join(' ')))) need(integer(n));
 if (r.lastOutcome!==null) {
  const outcome=exact(r.lastOutcome,'mint pool at reason stage');
  need(address(outcome.mint) && address(outcome.pool) && typeof outcome.reason==='string' && /^[A-Z][A-Z0-9_:-]{0,119}$/.test(outcome.reason));
  need((CANDIDATE_PREPARATION_STAGES as readonly unknown[]).includes(outcome.stage));
  const outcomeAt=time(outcome.at)!;need(outcomeAt>=start && outcomeAt<=at);
 }
 const p=exact(r.progress,'lastAcknowledgedAt lastAuditedAt unproductiveSinceAt serviceableSinceAt lastAttemptAt attemptsSinceProgress');
 need(integer(p.attemptsSinceProgress));
 for (const name of ['lastAcknowledgedAt','lastAuditedAt','unproductiveSinceAt','serviceableSinceAt','lastAttemptAt']) {const t=time(p[name],true);need(t===null || t>=start && t<=at);}
 if (p.unproductiveSinceAt===null) need(p.attemptsSinceProgress===0);
 else {
  need(p.attemptsSinceProgress>0 && p.lastAttemptAt!==null && p.lastAttemptAt>=p.unproductiveSinceAt);
  for (const name of ['lastAcknowledgedAt','lastAuditedAt']) need(p[name]===null || p[name]<=p.unproductiveSinceAt);
 }
 if (p.serviceableSinceAt!==null) need(p.unproductiveSinceAt!==null && p.serviceableSinceAt>=p.unproductiveSinceAt && p.lastAttemptAt!==null);
 need(Buffer.byteLength(JSON.stringify(r))<=4096);
 return r as CandidatePreparationReporting;
}
