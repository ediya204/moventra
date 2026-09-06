export type ApiEnvelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
};

export type SessionProfile = {
  username: string;
  nickname?: string;
  avatar?: string;
  roles: string[];
  permissions: string[];
};

export type LoginResult = {
  avatar?: string;
  username: string;
  nickname?: string;
  roles?: string[];
  permissions?: string[];
  accessToken: string;
  refreshToken?: string;
  expires?: string;
};

export type Paginated<T = Record<string, unknown>> = {
  list?: T[];
  total?: number;
  pageSize?: number;
  currentPage?: number;
  statistics?: Record<string, unknown>;
};

export type UnknownRecord = Record<string, unknown>;
