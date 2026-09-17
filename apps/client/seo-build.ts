import type { Plugin } from 'vite';
import { websiteServices, websiteQuestions } from './src/website/content';
import { websiteSeo, websiteStructuredData, websiteUrl } from './src/website/seo';
import { companyDetails, companyName, policyLinks } from './src/website/legal/policies';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// A visible, useful HTML introduction before React loads (also usable without JS).
// Service and FAQ copy comes from the same source as Website.tsx, not a bot-only page.
export function homepageHtml(shell: string): string {
  const copy = websiteSeo.zh;
  const metadata = `
    <meta data-website-seo name="description" content="${escape(copy.description)}">
    <link data-website-seo rel="canonical" href="${websiteUrl}">
    <meta data-website-seo property="og:type" content="website">
    <meta data-website-seo property="og:site_name" content="Moventra">
    <meta data-website-seo property="og:locale" content="zh_CN">
    <meta data-website-seo property="og:title" content="${escape(copy.title)}">
    <meta data-website-seo property="og:description" content="${escape(copy.description)}">
    <meta data-website-seo property="og:url" content="${websiteUrl}">
    <meta data-website-seo name="twitter:card" content="summary">
    <meta data-website-seo name="twitter:title" content="${escape(copy.title)}">
    <meta data-website-seo name="twitter:description" content="${escape(copy.description)}">
    <script data-website-seo type="application/ld+json">${JSON.stringify(websiteStructuredData).replace(/</g, '\\u003c')}</script>`;
  const body = `<div id="root"><div style="max-width:1120px;margin:auto;padding:32px 24px;font-family:system-ui,sans-serif;line-height:1.8;color:#212b36">
    <header><a href="/" aria-label="Moventra 首页"><img src="/brand/moventra-logo.svg" alt="Moventra" width="170" height="37"></a>
    <nav><a href="#services">产品与服务</a> · <a href="#faq">常见问题</a> · <a href="#contact">咨询方案</a></nav></header>
    <main><p>面向企业与开发团队</p><h1>广告营销、AI 工具与云服务</h1>
    <p>提供广告投放、AI 订阅和云端部署服务。按你的业务需求，选择合适的方案。</p>
    <section id="services"><h2>产品与服务</h2>${websiteServices.map(service => `<article><h3>${escape(service.title)}</h3><p>${escape(service.description)}</p><ul>${service.items.map(item => `<li>${escape(item)}</li>`).join('')}</ul></article>`).join('')}</section>
    <section id="faq"><h2>常见问题</h2>${websiteQuestions.map(([question, answer]) => `<h3>${escape(question)}</h3><p>${escape(answer)}</p>`).join('')}</section>
    <section id="contact"><h2>咨询服务方案</h2><p>整理你的业务需求、使用规模和预期时间，便于确认服务范围。</p><a href="mailto:${escape(companyDetails.contactEmail)}">${escape(companyDetails.contactEmail)}</a></section></main>
    <footer><p>${escape(companyName)}</p><address>${escape(companyDetails.principalAndMailingAddress)}</address><nav>${policyLinks.map(link => `<a href="${link.href}">${escape(link.label.zh)}</a>`).join(' · ')}</nav></footer>
    </div></div>`;
  if (!shell.includes('<div id="root"></div>') || !shell.includes('noindex,nofollow')) throw new Error('Unexpected client HTML shell; refusing to generate SEO page');
  return shell.replace('noindex,nofollow', 'index,follow,max-image-preview:large')
    .replace(/<title>.*?<\/title>/, `<title>${escape(copy.title)}</title>`)
    .replace('</head>', `${metadata}\n</head>`).replace('<div id="root"></div>', body);
}

export function websiteSeoBuild(): Plugin {
  return {
    name: 'moventra-homepage-seo',
    enforce: 'post',
    generateBundle(_, bundle) {
      const shell = bundle['index.html'];
      if (!shell || shell.type !== 'asset' || typeof shell.source !== 'string') throw new Error('Missing client HTML shell');
      this.emitFile({ type: 'asset', fileName: '__seo-home.html', source: homepageHtml(shell.source) });
    },
  };
}
