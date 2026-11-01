/** A source rebuild closes admission, not financial integrity. Permission is
 * still recovered only by the original ledger's verified readiness path. */
export const CANDIDATE_SOURCE_RECOVERY_PAUSE = 'candidate source recovery; fresh verified readiness required' as const;

/** Market callbacks can enter financial code (for example cancel a pending
 * buy). Their exceptions must latch financial uncertainty BEFORE an outer
 * source-recovery handler sees them. Never relabel an unknown write outcome. */
export function sourceFinancialCallback<T>(operation: () => T, financialFailure: (error: unknown) => void): T {
  try { return operation(); }
  catch (error) {
    try { financialFailure(error); } catch { /* Financial latch is set before fallible recording. */ }
    throw error;
  }
}
