# Claude Cage 宣传片

一支 60 秒、1920×1080 / 60 fps 的宣传片，画面和配乐都由代码生成。

| 时间 | 段落 | 内容 |
|---|---|---|
| 0–14s | 痛点 | 四个硬切镜头：封号让钱和进度清零；VPS、指纹浏览器、远程 Mac mini 的月账单；全局代理把整台电脑拖下水；传统虚拟机又重又慢还得自己配。最后一句“就不能，简单一点吗？” |
| 14–20s | 方案 | 像素 Logo 落笼，定位语“为 Claude 量身定制的轻量虚拟机”，开箱即用，只需配置自己的代理。 |
| 19–44s | 三步上手 | 复刻应用界面：配置代理、时区跟随出口 → 11 项泄漏检查通过后才联网 → 在 Cage 里打开终端运行 `claude`，主机不开全局代理。 |
| 44–50s | 卖点汇总 | 轻量开箱即用 · 自带泄漏审查 · 与主机隔离 · 开源接受审查。 |
| 49–55s | 写给相遇 | 角色插画与“把 Claude 关起来，是为了更好地保护我们的相遇。” |
| 55–60s | 片尾 | Logo、平台、主页与 GitHub 地址、非隶属声明。 |

痛点里的账单金额、节点名和终端对话都是示意内容，改文案直接编辑 `index.html`。

## 文件

- `index.html`：舞台、各幕布局和样式。
- `promo.js`：每一帧都是时间的纯函数 `render(t)`，预览、拖动和导出看到的画面完全一致。
- `timeline.js`：画面与配乐共用的时间点，改节奏只改这里。
- `soundtrack.mjs`：按时间轴合成配乐与音效，输出 `out/soundtrack.wav`。
- `render.mjs`：本地静态服务 + 无头 Chrome 逐帧截图 + ffmpeg 编码。

## 使用

需要 Node.js 18+ 和本机的 Chrome、Chromium 或 Edge（macOS、Windows、Linux 的常见安装位置会自动查找，也可以用 `CHROME_PATH` 指定）。ffmpeg 由 `ffmpeg-static` 提供；如果 npm 提示安装脚本未授权，执行 `npm install-scripts approve ffmpeg-static` 后重新安装。

```bash
cd promo
npm install
npm run preview          # 打开打印出的地址实时预览：空格播放/暂停，←/→ 跳转，?t=12.5 定位
npm run render           # 合成配乐并导出 out/claude-cage-promo.mp4
npm run render:draft     # 960×540 / 30 fps 快速草稿
node render.mjs --frames 8.6,24,33   # 只导出这些时间点的 PNG
```

页面使用 Google Fonts（Inter、Noto Sans SC、Noto Serif SC、JetBrains Mono），渲染时需要能访问字体服务；离线时会退回系统字体，排版会有轻微差异。
