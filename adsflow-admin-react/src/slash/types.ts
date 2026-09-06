// Provider fields stay optional at the application boundary for legacy/other platforms.
export interface SlashTransactionSource {
 id?: string; accountId?: string; virtualAccountId?: string; cardId?: string;
 status?: string; detailedStatus?: string; amountCents?: number; accountSubtype?: string;
 originalCurrency?: {code?: string;amountCents?: number;conversionRate?: number};
 date?: string;authorizedAt?: string;description?: string;memo?: string;
 orderId?: string;referenceNumber?: string;providerAuthorizationId?: string;
 merchantData?: {description?: string;categoryCode?: string;location?: {city?: string;state?: string;country?: string;zip?: string}};
 declineReason?: string;approvalReason?: string;
 fxFeeInfo?: {amountCents?: number};cashbackInfo?: {amountCents?: number;rate?: number};
 feeInfo?: {relatedTransaction?: {id?: string;amount?: number}};
}
export interface SourceFields extends SlashTransactionSource {
 name?: string;last4?: string;expiryMonth?: string;expiryYear?: string;isPhysical?: boolean;
 cardGroupId?: string;cardGroupName?: string;cardProductId?: string;createdAt?: string;
 spendingConstraint?: {spendingRule?:{utilizationLimitV2?:Array<{preset?:string;limitAmount?:{amountCents?:number};timezone?:string}>}};
 type?: string;accountType?:string;timestamp?:string;
 available?:{amountCents?:number};posted?:{amountCents?:number};
 feeType?:string;feeAmountCents?:number;dateCharged?:string;originalTransaction?:SlashTransactionSource;
}
export interface SourceRecord {
 id:string;kind:string;source:SourceFields;
 internal:{platform:string;entityId:string;scenarioId:string;namespace:string;version:number;customerId?:string;customerName?:string;email?:string;firstCollectedAt?:string;lastSyncedAt?:string;syncError?:string|null;matchingStatus?:string;assumption?:string;openingBalanceCents?:number;currency?:string};
 currency?:string;amount?:string;direction?:string;statusLabel?:string;detailedStatusLabel?:string;dateMeaning?:string;postedAt?:string|null;
}
export interface SourceDetail extends SourceRecord {
 versions:Array<{version:number;source:SourceFields;collectedAt:string}>;
 events:Array<{event:string;eventId:string;entityId:string;eventTimestamp:string;collectedAt:string}>;
 deliveries:Array<{id:string;event_id:string|null;received_at:string;result:string}>;
 relations:Array<{id:string;from_id:string;to_id:string;relation_type:string;evidence:string;confirmation:string}>;
 adjustments:Array<{id:string;amount_cents:number;occurred_at:string;reason:string;confirmation:string}>;
 fees:SourceRecord[];balances:SourceRecord[];virtualAccounts:SourceRecord[];
 snapshots:Array<{id:string;timestamp:string;step:string;available_cents:number;posted_cents:number}>;
}
export interface Scenario {id:string;title:string;description:string;expected_net_cents:number;expected_hold_cents:number;confirmation:string}
export interface Page<T>{rows:T[];total:number;page:number;pageSize:number}
export interface DemoSummary {
 totals:Array<{currency:string;account_subtype:string;postedNetCents:number;postedDebitCents:number;postedCreditCents:number;holdCents:number;count:number}>;
 monthly:Array<{month:string;currency:string;account_subtype:string;netCents:number}>;
 adjustments:Array<{month:string;amountCents:number}>;
 counts:Record<string,number>;asOf:string;timeBasis:string;balances:SourceRecord[];
}
