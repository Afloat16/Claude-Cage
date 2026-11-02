# Cage 项目主页

主页地址为 <https://lee-xeo.github.io/Claude-Cage/>，面向首次使用者介绍产品、公开安装包、开始使用步骤与使用边界。

在本目录执行：

```sh
npm ci
npm run dev      # http://localhost:4822/Claude-Cage/
npm run check
npm run build    # dist/
```

默认中文入口与其他语言路由位于 `src/pages/`，共用 `src/components/CageHome.astro`。`src/i18n/cage.ts` 从根目录对应 README 提取正文，`src/i18n/languages.ts` 定义下拉框中的 15 种语言及界面短文案。样式位于 `src/styles/cage.css`，工作台截图位于 `public/`，README 共用素材位于根目录 `assets/`。`astro.config.mjs` 的 `site` 和 `base` 分别指定站点域名与项目子路径；内部链接、图片和重定向使用 `import.meta.env.BASE_URL`。自定义部署可通过 `SITE_URL` 和 `SITE_BASE` 覆盖。

“下载应用”在所有语言中打开同一个三平台选择弹窗，列出 macOS、Windows、Linux 的系统要求、可用安装包、版本说明与安装指南。没有公开包的平台提供安装与构建说明。弹窗支持键盘操作、Esc、关闭按钮和点击背景关闭；禁用 JavaScript 时下载区仍提供平台链接。

下载信息来自 `src/data/release.json`，表示可公开下载的版本，可以低于根目录 `VERSION` 所标记的开发版本。`downloadURL` 为 macOS 包，`windowsDownloadURL` 和 `linuxDownloadURL` 为同版本可选安装包。独立的 `desktop-preview-<版本>` Release 可提供同版本 Windows 未签名包与 Linux 包，分别使用 `windowsPreview`、`linuxPreview` 保存版本、下载地址和说明；Windows 始终标注未签名，不进入签名安装包的自动更新入口。同步时核对两个安装包及其对应源码摘要，只关联与 macOS 主版本一致的预览包。从仓库根目录运行 `node www/scripts/sync-release.mjs`，即可从匿名 GitHub API 刷新公开版本；带 `--archive-directory` 时下载并核验三平台包。普通本地构建使用已保存的数据，不要求联网。

GitHub Actions 在网站文件或 README 的普通推送与 PR 中检查和构建；公开 Release 发布或维护者手动运行时部署 GitHub Pages。Release 事件会先下载实际 macOS 安装包与对应 Mihomo 源码，验证摘要、Developer ID 签名、Apple 公证和 Gatekeeper，失败时不会部署这一轮网站。Windows、Linux 的发行验收由对应平台流程负责。发布操作见[公开发行与主页部署](../docs/public-releases.md)。

根目录 README 是维护者确认产品措辞的来源。README 修改触发主页重新构建；发布工作流只刷新下载版本并读取现有译文，不自动生成翻译。中文主页为 `/`，其他语言使用 `/<语言代码>/`，语言范围与根目录 README 导航一致，不提供英语。下拉框切换独立 URL；阿拉伯语、波斯语、普什图语、达里语使用从右向左布局。网页正文直接复用对应 README 译文，结构调整时构建会提示维护者同步映射。

GitHub Pages 是当前主页的发布目标，部署配置由仓库工作流维护。

维护者明确授权 Windows 未签名公开预览后，可手动运行 `platform-preview.yml`，提供已经成功的三平台 CI run ID 并启用 `unsigned_windows`。流程从该次 CI 获取安装包，核对源码版本、两个平台的原始摘要、配套源码和上传后的 GitHub digest，公开独立平台 Release 后调用官网验收与部署。日常推送不触发此发布，现有 macOS 附件不被覆盖。

`public/install.sh` 仍被上游 `release.sh` 与安装器测试使用，保留用于 agent-vm 兼容流程，不作为 Cage 安装入口。
