/** Scheduling, not expected return or financial permission. A bounded additive
 * fairness bonus cannot multiply weak/missing evidence indefinitely. */
export const OPPORTUNITY_PRIORITY_POLICY=Object.freeze({
 version:'shared-flow-opportunity-priority-v2',fairnessMaximum:0.05,
 fairnessSaturationMs:60_000,missingDimensionMerit:0.5,
 meaning:'current-economic-merit-plus-at-most-five-percentage-points-wait-credit',
});
export function observationFairnessBonus(serviceableWaitMs:number):number{
 if(!Number.isFinite(serviceableWaitMs)||serviceableWaitMs<0)throw Error('OBSERVATION_WAIT_INVALID');
 return OPPORTUNITY_PRIORITY_POLICY.fairnessMaximum*Math.min(1,serviceableWaitMs/OPPORTUNITY_PRIORITY_POLICY.fairnessSaturationMs);
}
export function observationSelectionPriority(merit:number,waitMs:number):number{
 if(!Number.isFinite(merit)||merit<0||merit>1)throw Error('OBSERVATION_MERIT_INVALID');
 return merit+observationFairnessBonus(waitMs);
}
