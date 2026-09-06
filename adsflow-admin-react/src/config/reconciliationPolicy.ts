export const RECONCILIATION_POLICY_VERSION = 'funds-recon-v1.0.0';

export const RECONCILIATION_POLICY = {
  absoluteTolerance: 1,
  relativeTolerance: 0.00001,
  staleSnapshotMinutes: 30,
  transactionWindowDays: 30,
  duplicateWindowMinutes: 15,
  velocity: { oneHour: 4, twentyFourHours: 8 },
  amountOutlier: { minimumBaseline: 8, robustZ: 4, minimumAmount: 500 },
  fraudScore: { critical: 50, high: 30, review: 15 },
  weights: { duplicate: 35, velocity: 25, amountOutlier: 25, frozenCard: 15, newMerchant: 8 },
} as const;
