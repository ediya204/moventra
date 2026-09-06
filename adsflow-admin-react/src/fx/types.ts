export type Money = { minor: string; currency: string; scale: number };
export type Source = {
  id: string;
  amountCents?: string;
  status?: string;
  detailedStatus?: string;
  description?: string;
  date?: string;
  authorizedAt?: string;
  accountId?: string;
  accountSubtype?: string;
  cardId?: string;
  virtualAccountId?: string;
  orderId?: string;
  referenceNumber?: string;
  providerAuthorizationId?: string;
  memo?: string;
  declineReason?: string;
  approvalReason?: string;
  merchantData?: {
    description?: string;
    categoryCode?: string;
    location?: {
      city?: string;
      state?: string;
      country?: string;
      zip?: string;
    };
  };
  originalCurrency?: {
    code: string;
    amountCents?: string;
    conversionRate?: string;
  };
  fxFeeInfo?: { amountCents?: string };
  cashbackInfo?: { amountCents?: string; rate?: string };
  feeInfo?: { relatedTransaction?: { id?: string; amount?: string } };
};
export type Transaction = {
  id: string;
  sourceKind: "fx" | "legacy";
  crossCurrency: "same" | "cross" | "unknown";
  scenario: string;
  sourceId: string;
  platform: string;
  connectionId: string;
  entityId: string;
  source: Source;
  category: string;
  balanceType: string;
  accountAmount: Money | null;
  originalAmount: Money | null;
  originalCurrency: string | null;
  originalRawMinor: string | null;
  providerRate: string | null;
  displayRatio: string | null;
  ratioBasis: string;
  status: string;
  statusLabel: string;
  detailedStatus: string;
  detailedStatusLabel: string;
  authorizedAt: string | null;
  sourceDate: string | null;
  postedAt: string | null;
  collectedAt: string;
  dateMeaning: string;
  feeTreatment: string;
  matching: string;
  syncState: string;
  issues: string[];
  assumption: string;
};
export type Page = {
  rows: Transaction[];
  total: number;
  page: number;
  pageSize: number;
};
export type Relation = {
  kind: string;
  confirmation: string;
  evidence: string;
  parentId: string;
  childId: string;
  record: Transaction;
};
export type Detail = {
  feeDetails: {
    id: string;
    dateCharged: string;
    feeAmountCents: string;
    feeType: string;
    accountId: string;
    originalTransactionId: string | null;
  }[];
  record: Transaction;
  history: {
    rows: {
      requestSequence: number;
      source: Source;
      accountAmount: Money | null;
      originalAmount: Money | null;
      collectedAt: string;
      result: string;
    }[];
    complete: boolean;
    note: string;
  };
  relations: Relation[];
  events: {
    event_id: string;
    event: string;
    event_timestamp: string;
    received_at: string;
    delivery_id: string;
    result: string;
  }[];
  authorizationAmount: Money | null;
  net: {
    scopeId: string;
    scopeKind: "original_order" | "record";
    account: Money | null;
    original: Money | null;
    refund: Money | null;
    confirmedWithinDemo: boolean;
    issues: string[];
    note: string;
  };
  fees: {
    fx: string | null;
    cashback: string | null;
    treatment: string;
    note: string;
  };
  asOf: string;
};
export type Report = {
  accountTotal: number;
  page: number;
  pageSize: number;
  dailyPage: number;
  dailyTotal: number;
  context: {
    from: string;
    to: string;
    timezone: string;
    basis: string;
    basisLabel: string;
    asOf: string;
    completeness: string;
  };
  accounts: {
    accountId: string;
    connectionId: string;
    balanceType: string;
    currency: string;
    scale: number;
    posted: Record<string, string>;
    pending: Record<string, string>;
    inflow: string;
    outflow: string;
    net: string;
    issues: number;
    count: number;
  }[];
  originals: {
    currency: string;
    scale: number;
    purchase: string;
    refund: string;
    net: string;
    unknown: number;
  }[];
  daily: {
    day: string;
    accountId: string;
    balanceType: string;
    currency: string;
    scale: number;
    net: string;
  }[];
  unassigned: number;
  note: string;
};
export type Balances = {
  rows: {
    id: string;
    accountId: string;
    type: string;
    available: Money | null;
    posted: Money | null;
    timestamp: string;
    collectedAt: string;
    expected: Money | null;
    difference: Money | null;
    state: string;
    note: string;
  }[];
  note: string;
  limitedTo: number;
};
