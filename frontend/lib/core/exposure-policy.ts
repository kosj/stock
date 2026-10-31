export interface ExposureLimits { maxPositionWeight: number; maxSectorWeight: number }
/** Risk ceilings, not fitted return targets. Existing overweights are not liquidated. */
export const DEFAULT_EXPOSURE_LIMITS: ExposureLimits = { maxPositionWeight: .25, maxSectorWeight: .5 };
export function validateExposureLimits(limits: ExposureLimits) {
  if ([limits.maxPositionWeight, limits.maxSectorWeight].some(v => !Number.isFinite(v) || v <= 0 || v > 1))
    throw new Error("유효하지 않은 집중도 한도");
}
export function entryBudget(slotBudget: number, cash: number, capital: number, sectorValue: number, limits: ExposureLimits) {
  validateExposureLimits(limits);
  return Math.max(0, Math.min(slotBudget, cash, capital * limits.maxPositionWeight,
    capital * limits.maxSectorWeight - sectorValue));
}
