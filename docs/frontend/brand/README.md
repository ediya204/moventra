# Moventra 品牌素材

更新日期：2026-09-07。当前品牌为 Moventra。共用静态素材在 [packages/assets/public/brand](../../../packages/assets/public/brand)，由两端 Vite publicDir 引用。

- [浅色背景标志](../../../packages/assets/public/brand/moventra-logo.svg)：蓝色图形与深色字标。
- [深色背景标志](../../../packages/assets/public/brand/moventra-logo-inverse.svg)：蓝色图形与白色字标。
- [独立图形](../../../packages/assets/public/brand/moventra-mark.svg)。
- [favicon](../../../packages/assets/public/favicon.svg)。

使用共享 `BrandLogo` 组件，保持比例，不拉伸或任意改动路径颜色。品牌图形蓝 `#084CFF`、字标深色 `#071B38`；MUI 交互主色见 [主题约定](../ui-theme.md)，不要求两者色值相同。

历史设计依据为 `moventra-approved-reference.png`，该参考图未纳入当前仓库；现有 SVG 为轮廓化字标，无需运行时加载字标字体。Public Sans 字体许可保留在本目录的 [Public-Sans-LICENSE.txt](Public-Sans-LICENSE.txt)，不得改写第三方授权。

品牌素材改名不改变 Firebase 项目/App ID、Render 资源 ID 或历史数据库备份的真实名称。页面源文件存在不意味着对应业务已生产上线，参阅 [文档索引](../../README.md)。
