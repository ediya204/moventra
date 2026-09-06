export type BinProduct = {
  channelId?:string;channelName?:string;channelStatus?:string;sourceStatus?:string;openingBlockedReason?:string;
  id: string;
  name: string;
  binPrefix: string;
  network: string;
  currency: string;
  status: string;
  description: string;
  revision: number;
  maxCards: number;
  issuedCount: number;
  remaining?: number;
  mode?: string;
  platform?: string;
  upstreamProductId?: string | null;
  internalNote?: string;
  createdAt?: string;
  updatedAt?: string;
  audit?: { action: string; description: string; created_at: string }[];
};
export const binStatuses: Record<string, string> = {
  draft: "草稿",
  active: "已上架",
  paused: "暂停开卡",
  archived: "已归档",
};
