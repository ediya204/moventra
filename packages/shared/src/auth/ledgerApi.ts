import { liveGet, SessionError } from './liveApi';
import { isAdminSite } from './site';
import { isLedgerReadPath, parseShadowLedger } from './ledgerContract';

export async function getShadowLedger(customerId: string) {
  const path = `/${isAdminSite ? 'admin' : 'client'}-api/v1/customers/${customerId}/ledger`;
  if (!isLedgerReadPath(path)) throw new SessionError('invalid_path');
  const data = await liveGet<unknown>(path);
  try { return parseShadowLedger(data, customerId); }
  catch { throw new SessionError('invalid_api_response'); }
}
