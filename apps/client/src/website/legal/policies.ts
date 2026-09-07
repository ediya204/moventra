export type PolicyKind = 'privacy' | 'terms' | 'cookies';
type Copy = { zh: string; en: string };
export type PolicySection = { title: Copy; paragraphs: Copy[] };
export type Policy = { title: Copy; summary: Copy; sections: PolicySection[] };
const copy = (zh: string, en: string): Copy => ({ zh, en });
const section = (zh: string, en: string, ...paragraphs: Copy[]): PolicySection => ({ title: copy(zh, en), paragraphs });
export const companyName = 'Moventra Technology Inc';
export const policyDate = '2026-09-07';
// Incorporation details are transcribed from the user-provided certificate.
// Company and email confirmed by the user; public response storage checked for this release.
export const policyDraft = false;
export const policyLinks: { kind: PolicyKind; href: string; label: Copy }[] = [
  { kind: 'privacy', href: '/privacy-policy', label: copy('隐私政策', 'Privacy Policy') },
  { kind: 'terms', href: '/terms-of-service', label: copy('服务条款', 'Terms of Service') },
  { kind: 'cookies', href: '/cookie-policy', label: copy('Cookie 政策', 'Cookie Policy') },
];
export const companyDetails = {
  contactEmail: 'info@moventra.me',
  jurisdiction: copy('美国怀俄明州', 'Wyoming, United States'),
  entityType: copy('营利公司（Profit Corporation）', 'Profit Corporation'),
  registrationId: '2026-002074896',
  incorporationDate: '2026-09-07',
  principalAndMailingAddress: '30 N Gould St Ste R, Sheridan, WY 82801, United States',
};
const contact = section('公司资料与联系', 'Company information and contact', copy(
  `${companyName} 是在${companyDetails.jurisdiction.zh}注册的${companyDetails.entityType.zh}。怀俄明州登记号（Original ID）：${companyDetails.registrationId}。成立日期：${companyDetails.incorporationDate}（按注册证书所载日期）。`,
  `${companyName} is a ${companyDetails.entityType.en} incorporated in ${companyDetails.jurisdiction.en}. Wyoming registration number (Original ID): ${companyDetails.registrationId}. Date of incorporation: ${companyDetails.incorporationDate}, as stated in the certificate.`
), copy(
  `公司登记的主要办公地址及邮寄地址：${companyDetails.principalAndMailingAddress}。`,
  `Principal office and mailing address on the company filing: ${companyDetails.principalAndMailingAddress}.`
), copy(
  `隐私请求、服务咨询及本政策相关问题，请联系 ${companyDetails.contactEmail}。已有客户也可通过服务协议列明的业务联系人与我们联系。`,
  `For privacy requests, service inquiries, or questions about these policies, contact ${companyDetails.contactEmail}. Existing customers may also contact the representative identified in their service agreement.`
));
export const policies: Record<PolicyKind, Policy> = {
  privacy: {
    title: copy('隐私政策', 'Privacy Policy'),
    summary: copy('了解我们如何处理官网访问、服务咨询和现有账户登录涉及的信息，以及您可以作出的选择。', 'How we handle information associated with website visits, service inquiries, and existing account access, and the choices available to you.'),
    sections: [
      section('适用范围与责任主体', 'Scope and responsible entity', copy(
        '本政策由 Moventra Technology Inc（“Moventra”“我们”）提供，适用于 Moventra 官网及其公开登录、注册预览、密码重置和登录后资料补全页面。已开通的客户服务、工作台业务数据或第三方平台可能另有合同和隐私说明；本政策不替代这些具体说明。',
        'This policy is provided by Moventra Technology Inc (“Moventra”, “we”, or “us”) for the Moventra website and its public sign-in, registration preview, password reset, and post-login profile completion pages. Activated customer services, workspace business data, and third-party platforms may be subject to additional agreements and privacy notices; this policy does not replace those specific notices.'
      )),
      section('您提供的信息', 'Information you provide', copy(
        '官网服务需求表包含姓名、工作邮箱、意向服务和需求描述。当前“下载需求清单”仅在您的浏览器中生成文本文件，不会将表单发送给我们；下载文件由您自行保管和分享。注册预览页面仅在浏览器中检查格式，不创建账户或提交填写内容。密码找回会将您提供的邮箱发送至 Google Firebase，以处理密码重置邮件请求。',
        'The service brief asks for your name, work email, service of interest, and requirements. “Download brief” currently generates a text file in your browser without sending the form to us. You control storage and sharing of that file. The registration preview validates input in the browser without creating an account or submitting that input. Password recovery sends the email address you provide to Google Firebase to process a password reset email request.'
      ), copy(
        '邮箱密码登录由 Google Firebase 验证；您主动选择 Google 登录时，由 Google 完成身份验证并返回账户标识、邮箱及可用的个人资料。我们使用身份令牌验证登录状态，并由业务服务核验账户和数据权限。首次登录后，如您提交资料补全，我们会将姓名、已验证邮箱和身份标识用于创建本站登录用户；这不会自动开通资金账户或业务权限。当您通过另行约定的渠道联系我们时，我们会接收您实际发送的联系方式、业务需求和沟通记录。请勿在官网需求描述中填写完整卡号、安全码、验证码、密码或其他与咨询无关的敏感信息。',
        'Email and password sign-in is verified by Google Firebase. If you choose Google sign-in, Google authenticates you and returns an account identifier, email, and available profile information. We use identity tokens to verify sign-in, and our business service checks account and data permissions. If you submit profile details after first sign-in, your name, verified email, and identity identifier are used to create a website user; this does not automatically activate financial accounts or business permissions. When you contact us through a separately agreed channel, we receive the contact details, requirements, and correspondence you actually send. Do not include full card numbers, security codes, one-time codes, passwords, or unrelated sensitive information in a website service brief.'
      )),
      section('访问数据与浏览器存储', 'Access data and browser storage', copy(
        '加载网站会向提供页面和资源的服务器传送 IP 地址、浏览器请求信息及所请求的资源。网站由 Cloudflare 提供页面分发与安全服务，Cloudflare 也可能接收浏览器发送的网络错误报告；当前页面使用 Iconify 图标资源，加载图标时其资源服务可能接收这些网络信息。官网使用本地存储记住您主动选择的语言；详情见 Cookie 政策。当前官网代码未集成广告追踪像素或访问分析工具。',
        'Loading the site transmits your IP address, browser request information, and requested resources to the servers delivering the page and its assets. Cloudflare provides page delivery and security and may also receive browser network error reports. The pages use Iconify resources, whose servers may receive this network information when icons load. Local storage remembers a language you explicitly select; see the Cookie Policy. The current website code does not integrate advertising pixels or visitor analytics tools.'
      )),
      section('信息用途与处理依据', 'Purposes and grounds for processing', copy(
        '我们将实际接收的信息用于回复您提出的请求、沟通服务范围、履行已确认的服务安排、验证账户访问，以及处理安全事件、争议或适用法律要求。在适用法律要求明确处理依据时，这些用途分别以应您请求采取的订约前措施或合同履行、必要的服务与安全管理的合法利益、法定义务或另行取得的同意为依据；需要同意的可选用途不会仅凭您浏览本政策启动。',
        'Information we actually receive is used to respond to requests, discuss scope, carry out agreed services, authenticate access, and address security incidents, disputes, or applicable legal requirements. Where a legal basis is required, these purposes rely, as applicable, on steps requested before a contract or contract performance, legitimate interests in necessary service and security administration, legal obligations, or separately obtained consent. Reading this policy does not activate optional uses requiring consent.'
      )),
      section('信息接收方与跨境处理', 'Recipients and international processing', copy(
        '根据您使用的功能，必要信息可能由 Cloudflare（网站分发与安全）、Google Firebase / Google（身份验证与账户邮件）、Render（业务 API 托管）、Iconify（图标资源）及参与已约定交付的服务提供方处理；仅为回应请求、交付服务或履行法律义务而披露相关信息。第三方平台会按自身政策处理您直接提供给它们的信息。当前官网没有配置出售个人信息或基于跨站行为进行广告定向的功能。',
        'Depending on the features you use, necessary information may be processed by Cloudflare (website delivery and security), Google Firebase / Google (authentication and account emails), Render (business API hosting), Iconify (icon resources), and providers involved in agreed delivery. Relevant information is disclosed to respond to requests, deliver services, or comply with legal obligations. Third-party platforms process information you provide directly to them under their own policies. The current website has no configured feature for selling personal information or targeting advertising based on cross-site behavior.'
      ), copy(
        '网络资源和服务提供方可能位于您所在国家或地区之外。具体服务涉及的接收方、处理地点及依法需要的跨境保障，应在该服务开通前的说明或协议中明确；本政策不承诺数据仅存储在某一个国家，也不将尚未核实的保障机制表述为已落实。',
        'Resource and service providers may operate outside your country or region. Recipients, processing locations, and legally required transfer safeguards for a specific service must be identified in its notice or agreement before activation. This policy does not promise storage in a single country or represent unverified safeguards as implemented.'
      )),
      section('保留期限与安全', 'Retention and security', copy(
        '未提交的表单内容保留在当前页面中；您下载的文件由您控制。语言偏好没有设置自动到期时间，可在浏览器中清除。当前前端登录令牌保存在页面内存中，退出或刷新页面后不再保留该前端会话；这不代表服务端记录同步删除。对于我们实际收到的咨询和服务记录，保留时间取决于处理请求、履约、解决争议及法律义务所需期限，不作未经确认的固定天数承诺。',
        'Unsubmitted form input remains in the current page; downloaded files are under your control. Language preferences have no configured automatic expiry and can be cleared in your browser. The current frontend sign-in token is held in page memory; signing out or refreshing ends that frontend session, without implying deletion of server records. For inquiries and service records we actually receive, retention depends on the time needed to address requests, perform agreements, resolve disputes, and meet legal obligations; no unverified fixed period is promised.'
      ), copy(
        '我们按信息用途限制账户访问，并要求用户保护登录凭据。任何网络传输或存储方式都无法保证绝对安全；如怀疑账户被未授权使用，请及时通过已约定的服务联系渠道报告。',
        'Account access is limited according to its purpose, and users must protect their credentials. No transmission or storage method guarantees absolute security. Report suspected unauthorized account use promptly through your agreed service contact.'
      )),
      section('您的权利与选择', 'Your rights and choices', copy(
        '视适用法律及具体情形，您可能有权请求访问、更正、删除或获取个人信息副本，限制或反对特定处理，撤回依赖同意的处理许可，以及向当地数据保护监管机构投诉。撤回同意不影响撤回前处理的合法性。处理请求时可能需要核验身份；法律或合同要求保留的记录可能无法立即删除，届时应说明原因。您也可以不填写预览表单，并清除浏览器中的网站数据。',
        'Depending on applicable law and circumstances, you may request access, correction, deletion, or a copy of personal information, restriction of or objection to certain processing, withdrawal of consent where relied upon, and lodge a complaint with a local data protection authority. Withdrawal does not affect earlier lawful processing. Identity verification may be necessary; records required by law or contract may not be immediately deletable, and the reason should be explained. You can also choose not to complete preview forms and clear site data in your browser.'
      )),
      section('未成年人及政策更新', 'Children and policy updates', copy(
        '本网站面向能够合法订约的成年人和企业用户，不面向儿童提供服务。请勿提交儿童个人信息；如发现误收，可通过服务联系渠道提出处理请求。政策调整会在本页面显示更新日期；如新的用途依法需要通知或同意，我们将在相应用途开始前办理，不以静默修改政策追溯扩大使用范围。',
        'This site is intended for adults able to enter contracts and business users, not children. Do not submit children’s personal information; contact us through the service contact channel if it is submitted in error. Policy changes will display an updated date here. Where a new use requires notice or consent, that step will occur before the new use; a silent policy update will not retroactively expand permitted uses.'
      )), contact,
    ],
  },
  terms: {
    title: copy('服务条款', 'Terms of Service'),
    summary: copy('使用 Moventra 官网和咨询服务时的基本规则，以及具体服务需要另行确认的事项。', 'Ground rules for using the Moventra website and discussing services, and matters that require a separate service agreement.'),
    sections: [
      section('服务提供方与适用范围', 'Provider and scope', copy(
        '本条款由 Moventra Technology Inc（“Moventra”“我们”）提供，适用于本官网及服务咨询。具体采购或开通服务须由有权代表双方的人员确认订单或服务协议；其中针对具体服务的约定优先适用，但不得排除适用法律规定的强制性权利。浏览网页或下载需求清单本身不构成付款授权、订阅开通或订单成立。',
        'These terms are provided by Moventra Technology Inc (“Moventra”, “we”, or “us”) for this website and service inquiries. A purchase or activation requires an order or service agreement confirmed by authorized representatives. Service-specific provisions take priority without excluding mandatory rights under applicable law. Browsing or downloading a brief does not itself authorize payment, activate a subscription, or create an order.'
      )),
      section('服务范围', 'Service scope', copy(
        '官网介绍广告营销、AI 订阅、订阅卡及云服务。具体交付内容、适用平台与地区、账户资格、期限和支持范围须在合作前确认。订阅卡栏目用于介绍 Netflix（奈飞）、Google 等数字服务的订阅需求与方案，不代表任何平台、地区或付款方式均可使用，也不代表 Moventra 与上述品牌存在官方合作或背书。相关商标属于各自权利人。',
        'The website describes marketing, AI subscriptions, subscription cards, and cloud services. Deliverables, eligible platforms and regions, account requirements, duration, and support scope must be confirmed before engagement. The subscription card section describes needs and options for digital services such as Netflix and Google. It does not guarantee acceptance by every platform, region, or payment method, or imply official affiliation or endorsement. Trademarks belong to their respective owners.'
      )),
      section('预览功能与账户', 'Preview features and accounts', copy(
        '当前需求清单在本机生成，未发送咨询；注册页仅作格式预览，找回密码功能会向 Firebase 提交重置邮件请求。登录后的资料补全可创建本站登录用户，但不自动开通业务或资金账户。真实账户仅供获授权用户使用，身份登录不自动授予其他客户或业务数据的访问权。您应提供准确资料、保护凭据，并仅代表您本人或您有权代表的组织操作。演示页面、示例金额和操作模拟不能作为真实资金可用性、支付完成或服务已开通的凭证。',
        'The brief is generated locally without sending an inquiry. The registration page is a format preview; password recovery submits a reset email request to Firebase. Post-login profile completion can create a website user but does not automatically activate business or financial accounts. Real accounts are for authorized users. Signing in does not automatically grant access to other customers or business data. Provide accurate information, protect credentials, and act only for yourself or an organization you are authorized to represent. Demo pages, sample amounts, and simulated actions do not prove funds availability, completed payment, or activated services.'
      )),
      section('订单、费用、续订与退款', 'Orders, fees, renewals, and refunds', copy(
        '价格、币种、税费、交付时间、订阅期限及付款方式以确认的订单或服务协议为准。任何续订机制、自动扣款授权、取消时限、已交付部分的费用及退款规则均须在购买前说明并确认。官网当前不提供结账或自动扣费功能，本条款不构成自动续费授权。取消、交付失败或退款问题按相应订单及适用法律处理，不以本条款一概排除退款或法定消费者权利。',
        'Prices, currency, taxes, delivery timing, subscription duration, and payment methods are governed by the confirmed order or service agreement. Renewal arrangements, recurring payment authorization, cancellation deadlines, charges for delivered work, and refund rules must be disclosed and confirmed before purchase. The current website has no checkout or automatic charging feature, and these terms do not authorize automatic renewal. Cancellations, failed delivery, and refunds are addressed under the relevant order and applicable law, without a blanket exclusion of refunds or statutory consumer rights.'
      )),
      section('合理使用与第三方平台', 'Acceptable use and third-party platforms', copy(
        '您不得利用服务实施欺诈、侵权、未经授权的访问、凭据共享或转售、恶意代码传播，或规避平台资格、地区、许可及安全限制。使用广告、AI、影音、数字订阅和云平台时，您仍需遵守各平台的账户、内容和使用条款。第三方可能调整产品、价格或可用性；我们应就影响已约定交付的事项沟通，并按订单及适用法律处理。',
        'Do not use the services for fraud, infringement, unauthorized access, unauthorized credential sharing or resale, malware distribution, or circumvention of platform eligibility, regional, licensing, or security restrictions. Advertising, AI, streaming, digital subscription, and cloud platforms retain their own account, content, and usage terms. Third parties may change their products, prices, or availability; issues affecting agreed delivery should be communicated and addressed under the order and applicable law.'
      )),
      section('内容与知识产权', 'Content and intellectual property', copy(
        '官网的品牌、设计和原创内容受适用知识产权法律保护。您可以为了解服务而正常浏览和保存需求清单，但不得冒充 Moventra 或未经授权将网站内容用于误导性推广。您保留对所提交材料的权利，并应具备为约定服务提供这些材料所需的授权；我们对材料的使用限于处理请求和约定交付所需范围。',
        'Our branding, design, and original website content are protected by applicable intellectual property laws. You may browse to evaluate services and save a service brief, but may not impersonate Moventra or use site content for unauthorized misleading promotion. You retain rights in submitted materials and must have the authority to provide them for the agreed service; our use is limited to responding to your request and performing agreed delivery.'
      )),
      section('服务可用性与责任', 'Availability and responsibility', copy(
        '我们不保证官网持续无中断、完全无错误，也不保证广告效果、AI 输出准确性或第三方平台始终可用。具体服务质量、补救措施和责任安排应在订单或协议中明确。本条款不排除或限制法律不允许排除或限制的责任，包括适用法律保护的消费者权利；也不免除我们履行已确认服务的义务。',
        'We do not guarantee uninterrupted or error-free website access, advertising results, AI output accuracy, or continuous third-party availability. Service quality commitments, remedies, and liability arrangements should be specified in the order or agreement. These terms do not exclude or limit liability that cannot lawfully be excluded or limited, including protected consumer rights, or remove our obligations to deliver confirmed services.'
      )),
      section('暂停、变更及争议', 'Suspension, changes, and disputes', copy(
        '对于未经授权的访问、安全风险或违反约定的使用，我们可在必要范围内限制访问；在法律允许且不妨碍安全处置时说明原因。已付款项、未完成交付及数据处理仍按相应协议和适用法律处理。重大条款变更不追溯改变已确认订单；需要重新同意的事项应另行确认。争议可先通过订单所列联系人协商；管辖法律及争议解决安排由适用法律和具体协议确定，除具体协议另有约定外，本条款不指定专属管辖法院或设置强制仲裁。',
        'Access may be restricted as necessary for unauthorized activity, security risks, or use that violates agreed terms, with reasons provided where lawful and compatible with security response. Payments, outstanding delivery, and data handling remain governed by the relevant agreement and law. Material changes do not retroactively change confirmed orders; matters requiring renewed agreement must be separately confirmed. Raise disputes first with the order contact. Applicable law and dispute arrangements are determined by law and the specific agreement; unless a specific agreement provides otherwise, these terms do not select an exclusive court or impose mandatory arbitration.'
      )), contact,
    ],
  },
  cookies: {
    title: copy('Cookie 政策', 'Cookie Policy'),
    summary: copy('说明 Cookie、语言偏好、本地存储和会话的用途，以及如何管理这些设置。', 'The purposes of cookies, language preferences, local storage, and sessions, and how to manage them.'),
    sections: [
      section('什么是 Cookie 与类似技术', 'Cookies and similar technologies', copy(
        'Cookie 是网站可存储在浏览器中的小型数据。localStorage 等类似技术也可以在设备上保存信息，而页面内存只在当前页面会话中使用。它们的用途和保留期限并不相同。本政策适用于 Moventra Technology Inc 官网的公开页面及现有登录流程。',
        'Cookies are small pieces of data websites can store in a browser. Similar technologies such as localStorage can also save information on a device, while page memory is used only during the current page session. Their purposes and lifetimes differ. This policy covers Moventra Technology Inc’s public website pages and existing sign-in flow.'
      )),
      section('语言偏好', 'Language preference', copy(
        '名称：moventra.website.language。提供方：本网站（第一方）。类型：localStorage，不是 Cookie。用途：在您主动切换中文或英文后保存 zh 或 en，以便下次访问沿用语言选择。期限：没有自动到期时间，直至您清除网站数据或浏览器删除该数据。该值不保存姓名、邮箱或登录凭据。未保存偏好时，网站根据浏览器语言选择初始语言；禁用本地存储不影响当前页面的语言切换。',
        'Name: moventra.website.language. Provider: this website (first party). Type: localStorage, not a cookie. Purpose: saves zh or en after you explicitly switch languages so a later visit can use your choice. Duration: no automatic expiry, until you clear site data or your browser removes it. This value does not store a name, email, or credentials. Without a saved preference, the site uses your browser language initially; blocking local storage does not prevent switching language in the current page.'
      )),
      section('登录会话与表单', 'Sign-in sessions and forms', copy(
        '当前前端登录令牌保存在页面内存中，不由前端写入 Cookie、localStorage 或 sessionStorage；刷新或退出会清除该前端会话。需求表和注册预览内容不会由页面写入持久化存储；密码找回会提交邮箱到 Firebase，但不由页面保存该邮箱。浏览器自身的自动填充和密码保存由您的浏览器设置控制。',
        'The current frontend sign-in token is held in page memory and is not written by the frontend to cookies, localStorage, or sessionStorage; refreshing or signing out clears that frontend session. Service brief input and registration previews are not written to persistent storage by those pages. Password recovery submits an email address to Firebase but does not persist that address in the page. Browser autofill and password saving are controlled by your browser settings.'
      )),
      section('第三方资源与服务端 Cookie', 'Third-party resources and server cookies', copy(
        '页面按需请求 Iconify 图标资源，资源服务可能接收 IP 地址与浏览器请求信息；浏览器也可能缓存静态资源。Cloudflare 的网络错误报告配置可能由浏览器保存，并用于报告连接失败等网络问题，不用于广告定向。2026-09-07 对官网、登录、注册及密码找回页的匿名响应检查未发现 Set-Cookie；这不代表第三方登录流程完全不使用 Cookie。主动使用 Google 登录时，Google 的页面和身份验证服务可能使用其自己的 Cookie 或临时存储，具体期限和控制方式由其政策与浏览器设置决定。',
        'Pages request Iconify assets as needed, and its resource servers may receive your IP address and browser request information. Browsers may also cache static assets. Cloudflare network error reporting settings may be stored by the browser to report connection failures and other network issues, not for ad targeting. Anonymous responses checked on 2026-09-07 for the home, sign-in, registration, and password recovery pages did not set cookies. This does not mean third-party sign-in is cookie-free. If you choose Google sign-in, Google pages and authentication services may use their own cookies or temporary storage; their policies and your browser settings govern duration and controls.'
      )),
      section('分析、广告与同意', 'Analytics, advertising, and consent', copy(
        '当前官网代码未配置访问分析、广告追踪或跨站再营销 Cookie，也没有“接受全部”形式的 Cookie 同意弹窗。我们不会把浏览本页面或点击普通链接当作同意可选追踪。若后续引入依法需要同意的分析、广告或其他可选存储，应在启用前更新说明，提供有效选择，并在取得所需同意前保持关闭。',
        'The current website code does not configure visitor analytics, advertising tracking, or cross-site remarketing cookies, and has no “accept all” cookie consent banner. Reading this page or clicking ordinary links is not consent to optional tracking. If analytics, advertising, or other optional storage requiring consent is introduced, the notice must be updated and meaningful choices provided before activation, with such technologies disabled until required consent is obtained.'
      )),
      section('如何管理', 'How to manage storage', copy(
        '您可以在浏览器的隐私或网站数据设置中查看、阻止或清除本网站的 Cookie 和本地存储。清除后语言偏好会丢失；阻止认证或安全服务所需的 Cookie 可能影响相应服务。退出登录可结束当前前端会话。删除网站数据不会删除已经下载到设备上的需求清单，也不等于向我们提出删除服务端个人信息的请求；后者请参阅隐私政策。',
        'Use your browser’s privacy or site data settings to inspect, block, or clear this site’s cookies and local storage. Clearing removes your saved language preference; blocking cookies needed by authentication or security services may affect those services. Signing out ends the current frontend session. Clearing site data does not delete downloaded service briefs or request deletion of server-side personal information; see the Privacy Policy for those requests.'
      )),
      section('政策更新', 'Policy updates', copy(
        '我们会在存储用途或服务发生变化时更新本页及更新日期。如有关于 Cookie 或浏览器存储的问题，请通过下方邮箱联系我们。',
        'We will update this page and its date when storage purposes or services change. Contact us at the email below with questions about cookies or browser storage.'
      )), contact,
    ],
  },
};
