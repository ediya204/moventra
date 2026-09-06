export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function pickValue(record: Record<string, unknown>, keys: string[], fallback: unknown = '-') {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

export function numberValue(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatAmount(value: unknown, currency = 'USD') {
  const amount = numberValue(value);
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function formatNumber(value: unknown) {
  return numberValue(value).toLocaleString('zh-CN');
}

export function formatPercent(numerator: unknown, denominator: unknown, digits = 1) {
  const total = numberValue(denominator);
  if (total <= 0) return '0%';
  return `${((numberValue(numerator) / total) * 100).toFixed(digits)}%`;
}

export function formatDateTime(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  const text = String(value);
  const numeric = Number(text);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 9_999_999_999 ? numeric : numeric * 1000)
    : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function toRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord);
}

export function maskCard(value: unknown) {
  const text = String(value ?? '').replace(/\s/g, '');
  if (!text) return '-';
  if (text.includes('*') || text.includes('•')) return String(value);
  const last4 = text.slice(-4);
  return `•••• •••• •••• ${last4}`;
}
