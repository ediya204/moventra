export const RISK_POLICY_VERSION = 'ops-risk-v1.0.0';

export const RISK_POLICY = {
  windowsInDays: [1, 7, 30, 90] as const,
  highDecline: {
    minimumAttempts: 8,
    rawRate: 0.2,
    wilsonLowerBound: 0.1,
  },
  sequence: {
    confirmedContinuousDeclines: 3,
    suspectedContinuousDeclines: 2,
    rollingHours: 24,
    rollingDeclines: 3,
  },
  overdue: {
    largeAmount: 1000,
    confirmedConsecutiveSnapshots: 2,
  },
  card: {
    lowBalance: 300,
  },
  trend: {
    minimumRecentAttempts: 3,
    rejectionRateIncreasePoints: 0.1,
  },
  concentration: {
    highMerchantHhi: 0.35,
  },
  quality: {
    highCoverage: 0.9,
    mediumCoverage: 0.5,
    highMinimumAttempts: 30,
    mediumMinimumAttempts: 10,
  },
} as const;

