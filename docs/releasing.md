# 发布 macOS 安装包

本页供维护者构建和发布 Cage。用户安装说明见[开始使用](getting-started.md)。发行目标为 Apple Silicon、macOS 14 或更新版本；安装包包含应用、控制程序、代理核心和许可证，首次启动再下载 Linux 环境与开发工具。

## 构建前准备

需要 macOS、Xcode Command Line Tools、Go（版本见 `go.mod`）、Node.js 24、`uv`。`VERSION` 是 App、控制程序和安装包的版本来源。`CFBundleShortVersionString` 使用数字版本，关于窗口显示包含 Alpha 标记的完整版本。

对外分发还需要 Apple Developer ID Application 证书与配套私钥，以及已保存到钥匙串的 `notarytool` 凭据。证书、私钥和公证凭据只保存在钥匙串或 CI Secret 中，不写入源码或发布附件。按 [Apple 公证说明](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) 配置认证后，可先用 `xcrun notarytool history --keychain-profile <名称>` 验证。

## 构建并验证

先完成产品改动和相关测试，再运行发行脚本：

```sh
export CAGE_SIGNING_IDENTITY='Developer ID Application: 你的名称 (TEAMID)'
export CAGE_NOTARY_PROFILE='你的公证凭据名称'
bash scripts/package-macos.sh
```

脚本从源码构建，逐一签名嵌套程序，给控制程序保留虚拟化权限，并启用 Hardened Runtime 与可信时间戳。App 和 DMG 分别提交 Apple 公证、附加票据并验证。公证未通过、签名错误或 Gatekeeper 拒绝时，脚本失败，不生成“可发布”的成功提示。

产物位于 `_output/releases/<版本>/`：

- `Cage-<版本>-macos-arm64.dmg`：供用户拖入应用程序文件夹安装。
- `mihomo-<核心版本>-source.tar.gz`：随包独立代理程序的对应上游源码，须与安装包一起上传。
- `SHA256SUMS`：上述两个附件的 SHA-256 校验值。
- `app-notarization.json`、`dmg-notarization.json`、`Cage-notarization.zip`：本地公证过程记录，不作为用户下载附件。

应用内 `Contents/Resources/licenses/` 包含主项目、Go 依赖、前端运行依赖、Mihomo 与 noVNC 的许可材料，以及实际随包使用的 noVNC 修改后源码。维护者应在依赖变化后运行 `scripts/licenses` 更新 Go 依赖许可集合。发行脚本会拒绝缺少许可证的前端运行依赖。

只做本机开发时可运行 `bash scripts/build-app.sh`，未设置签名身份会使用 ad-hoc 签名。`--install` 可安装到 `~/Applications/Cage.app`，会替换该位置的旧版本。此构建方式不完成公证，不能作为已经通过 Gatekeeper 的下载包宣传。

## Apple 返回等待或失败时

公证结果文件保存提交 ID。超时后先查询原提交，不重复上传同一包：

```sh
xcrun notarytool info <提交ID> --keychain-profile "$CAGE_NOTARY_PROFILE"
xcrun notarytool log <提交ID> --keychain-profile "$CAGE_NOTARY_PROFILE" _output/notarization-log.json
```

App 提交已 Accepted 时，运行 `xcrun stapler staple _output/Cage.app`，再执行 `bash scripts/package-macos.sh --from-notarized-app` 接续 DMG 制作。此选项要求 App 版本与 `VERSION` 一致且已有有效票据；源码有新改动时必须重新完整构建。

DMG 提交已 Accepted 时，直接对原 DMG 执行 `xcrun stapler staple`、`xcrun stapler validate` 和 `spctl --assess --type open --context context:primary-signature --verbose=2`。附加票据会改变文件内容，必须重新生成校验值。公证被拒时根据 Apple 日志修复并重建；不能用移除隔离属性或关闭 Gatekeeper 代替验收。

## 发布与安装验收

推送前确认目标仓库仍为私有，检查提交内容不包含个人配置、节点凭据、登录链接和未脱敏截图。先推送源码提交及相应版本标签，再向 GitHub 预发行版上传 DMG、Mihomo 源码和校验文件；私有仓库附件仅对有权限的 GitHub 用户开放。

从实际 DMG 复制 App 后验证签名、票据与首次入口。用独立临时配置验证空状态，避免覆盖维护者正在使用的环境。每次发布说明分别列出已验证项和仍需真实用户操作的项目：干净 Mac 安装、首次镜像下载、代理配置、Claude 授权及模型请求、重启恢复、升级和卸载。单独通过公证不能替代这些产品验证。

更新版本前，用户应退出 Cage 并停止环境，再替换应用。应用配置、代理配置和虚拟磁盘位于用户数据目录，替换 App 保留这些内容；删除 App 也不会自动删除项目与虚拟磁盘。当前 Alpha 使用手动下载安装包升级。
