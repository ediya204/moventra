// Internal display aliases only; never overwrite the provider's merchant data.
const brands: [RegExp, string][] = [
  [/^(?:METAPAY|META(?:\s+(?:ADS|PAY|PLATFORMS))?)(?=$|[\s*._:/-])/i, 'Meta'],
  [/^(?:FACEBK|FACEBOOK|FACEBOOKAD)(?=$|[\s*._:/-])/i, 'Facebook'],
  [/^GOOGLE(?=$|[\s*._:/-])/i, 'Google'],
  [/^TIKTOK(?=$|[\s*._:/-])/i, 'TikTok'],
  [/^(?:OPENAI|CHATGPT)(?=$|[\s*._:/-])/i, 'OpenAI'],
  [/^(?:ANTHROPIC|CLAUDE)(?=$|[\s*._:/-])/i, 'Anthropic'],
  [/^JINA\s+AI(?=$|[\s*._:/-])/i, 'Jina AI'],
  [/^(?:AMAZON WEB SERVICES|AWS)(?=$|[\s*._:/-])/i, 'Amazon Web Services'],
  [/^CLOUDFLARE(?=$|[\s*._:/-])/i, 'Cloudflare'],
  [/^VERCEL(?=$|[\s*._:/-])/i, 'Vercel'],
  [/^GITHUB(?=$|[\s*._:/-])/i, 'GitHub'],
  [/^SHOPIFY(?=$|[\s*._:/-])/i, 'Shopify'],
  [/^CANVA(?=$|[\s*._:/-])/i, 'Canva'],
  [/^FIGMA(?=$|[\s*._:/-])/i, 'Figma'],
  [/^NOTION(?=$|[\s*._:/-])/i, 'Notion'],
];

export function merchantBrand(description?: string | null): string | undefined {
  if (!description) return undefined;
  const value = description.normalize('NFKC').trim();
  return brands.find(([pattern]) => pattern.test(value))?.[1];
}

export function companyLogoUrl(name: string, key: string): string | undefined {
  if (!name.trim() || !key.startsWith('pk_')) return undefined;
  const params = new URLSearchParams({ token: key, size: '64', format: 'png', theme: 'light', retina: 'true', fallback: '404' });
  // Pin ambiguous Meta name searches to the selected brand domain.
  const path = name === 'Meta' ? 'meta.com' : `name/${encodeURIComponent(name)}`;
  return `https://img.logo.dev/${path}?${params}`;
}
