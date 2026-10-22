// S1 - approval threshold (A-06): max(1, floor(0.7 * adminCount)).

/** Number of distinct approvals needed for a clinic with `adminCount` enrolled approvers. */
export function approvalThreshold(adminCount: number): number {
  if (!Number.isInteger(adminCount) || adminCount < 1) {
    throw new RangeError(`adminCount must be an integer >= 1, got ${String(adminCount)}`);
  }
  // Integer arithmetic (7n / 10) avoids floating point drift of 0.7 * n.
  return Math.max(1, Math.floor((7 * adminCount) / 10));
}

/** True when the threshold is at least 2, i.e. no single approver can grant alone (A-31). */
export function isRealQuorum(adminCount: number): boolean {
  return approvalThreshold(adminCount) >= 2;
}
