# Cage 项目主页

主页地址为 <https://lee-xeo.github.io/Claude-Cage/>，面向首次使用者介绍产品、公开安装包、开始使用步骤与使用边界。

在本目录执行：

```sh
npm ci
npm run dev      # http://localhost:4822/Claude-Cage/
npm run check
npm run build    # dist/
```

页面位于 `src/pages/index.astro`，样式位于 `src/styles/cage.css`，截图位于 `public/`。`astro.config.mjs` 的 `site` 和 `base` 分别指定站点域名与项目子路径；内部链接、图片和重定向使用 `import.meta.env.BASE_URL`。自定义部署可通过 `SITE_URL` 和 `SITE_BASE` 覆盖。

下载信息来自 `src/data/release.json`，表示可公开下载的版本，可以低于根目录 `VERSION` 所标记的开发版本。从仓库根目录运行 `node www/scripts/sync-release.mjs`，即可从匿名 GitHub API 刷新公开版本，并核对附件与校验清单。普通本地构建使用已保存的数据，不要求联网。

GitHub Actions 在 `main` 的网站文件变化、Release 发布或编辑、手动运行时重新构建并部署 GitHub Pages；PR 只检查。Release 事件会先下载实际安装包与对应 Mihomo 源码，验证摘要、Developer ID 签名、Apple 公证和 Gatekeeper，失败时不会部署这一轮网站。发布操作见[公开发行与主页部署](../docs/public-releases.md)。

根目录 README 是维护者确认产品措辞的来源。README 修改完成后，再同步主页及各语言页面；发布工作流只更新下载版本，不自动改写或翻译正文。当前 `/fr/` 为回到主页的兼容入口，尚未提供 Cage 法语正文。上游遗留组件与语言文件不作为 Cage 页面入口。

`.openai/hosting.json` 保留原 Sites 私有预览的身份；GitHub Pages 发布不使用该配置。
