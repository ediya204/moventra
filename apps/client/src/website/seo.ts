export const websiteUrl = 'https://moventra.me/';
export const websiteSeo = {
  zh: {
    title: 'Moventra | 广告营销、AI 订阅与云服务',
    description: 'Moventra 面向企业与开发团队，提供广告投放策略、素材优化、AI 工具与订阅方案，以及应用部署和云资源配置服务。联系我们，按业务需求定制服务方案。',
  },
  en: {
    title: 'Moventra | Advertising, AI Subscriptions & Cloud Services',
    description: 'Moventra helps businesses and development teams with advertising strategy, creative optimization, AI tools and subscriptions, application deployment and cloud resources. Contact us to discuss your needs.',
  },
};
export const websiteStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${websiteUrl}#organization`, name: 'Moventra', url: websiteUrl, logo: `${websiteUrl}brand/moventra-logo.svg`, email: 'info@moventra.me' },
    { '@type': 'WebSite', '@id': `${websiteUrl}#website`, name: 'Moventra', url: websiteUrl, publisher: { '@id': `${websiteUrl}#organization` } },
  ],
};
