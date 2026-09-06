# Minimals 来源组件

更新日期：2026-09-07。此目录保留用户既有 Minimals MUI 5 源码中的选定组件；原始来源为旧本地 `console payment/frontend/src`，该原始项目不在本仓库。

包含 Iconify、Label、FormProvider、RHFTextField、useBoolean 及部分插画组件。独立客户端也保留所需组件副本，不跨应用导入。插画资源共用 `packages/assets/public/assets/illustrations/characters`；相关图片 URL 适配 Vite BASE_URL。

共用认证布局和找回密码在 `packages/shared/src/website/auth`；客户端注册预览在 `apps/client/src/website/auth`。登录现由 Firebase/Go 实现，找回密码使用 Firebase；`/register` 仍是表单预览，Google 登录后的资料补全是另一流程。不能沿用旧文档“所有恢复页面仅预览”的结论。

MUI Button 适配当前依赖，没有沿用模板示例中的登录日志/假提交。模板原许可继续适用，本次目录整理和文档更新不重新授权第三方源码，也不表示包含全部 Minimals 组件。

原项目参考：[Minimals](https://minimals.cc/)、[组件说明](https://docs.minimals.cc/components/)、[快速开始](https://docs.minimals.cc/quick-start/)。项目范围见 [文档索引](../../../../docs/README.md)。
