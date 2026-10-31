# Cage 项目主页

面向首次使用者的中文介绍、安装入口、三步开始和使用边界。页面采用暖白底与陶土橙强调色，使用实际工作台渲染的演示截图。

```sh
npm ci
npm run dev      # http://localhost:4822
npm run check
npm run build    # dist/
```

当前页面位于 `src/pages/index.astro`，样式位于 `src/styles/cage.css`，产品截图在 `public/`。版本与下载地址需和根目录 `VERSION`、GitHub Release 保持一致。App 的签名、公证状态只能根据实际发布证据填写。

私有阶段主页通过 Sites 以仅所有者可见的方式预览，身份记录在 `.openai/hosting.json`。安装包存放于私有 GitHub Release，访问者仍需仓库权限；网站不保存或转发 GitHub 令牌。GitHub Actions 只构建静态产物，不自动公开 Pages。

公开发布前需确认仓库、Release 和网站的访问范围，并更新正式域名。`SITE_URL` 可覆盖构建时站点地址。保留的上游组件不作为 Cage 页面入口。
