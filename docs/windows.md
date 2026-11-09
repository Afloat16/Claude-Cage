# Windows 安装、更新与发布

Cage 的 Windows 版本面向 Windows 10 22H2（内部版本 19045）和 Windows 11 的 x64 电脑。安装后从开始菜单打开 Cage，选择客机系统、导入自己的代理，再进入工作台。具备完整 Hyper-V 的 Windows 11 专业版、企业版或教育版可运行 Windows 11 客机，使用 PowerShell、Windows 原生工具和官方 Claude Desktop；其他受支持的 Windows 主机可使用 Debian 13。具体组合见[选择客机系统](guide/guest-systems.md)。

## 安装前准备

下表和 WHPX 配置适用于 Debian 客机。Windows 11 客机需要完整的 Hyper-V 平台与管理工具，以及支持第二代虚拟机、安全启动和 vTPM 的主机。首次创建通过系统提权安装专用管理助手，日常 Cage 仍以普通用户运行，助手仅管理已登记客机。Windows 家庭版使用 Debian 路线。克隆入口匹配 Microsoft 官方 ESD，手动安装可选官方 ISO，均按相应许可使用。

“自动匹配本机系统版本”匹配 Windows 发行版本、版本类型和语言，展示主机与客机补丁构建差异；安装中断后继续原记录与系统盘。当前已实测建机、首次启动与冷启动，修复后的最终工作台登记仍待复验。完整条件和流程见[客机系统指南](guide/guest-systems.md#自动匹配本机系统版本)。

| 项目 | 要求 |
|---|---|
| 系统 | x64 Windows 10 22H2 或 Windows 11；不包含 Windows ARM64 与 32 位系统 |
| 虚拟化 | BIOS/UEFI 已启用处理器虚拟化，Windows 已启用“Windows 虚拟机监控程序平台” |
| 存储 | 使用本地磁盘，保留安装包、Linux 镜像、虚拟磁盘和更新备份所需空间；初始虚拟磁盘上限为 24 GiB |
| 代理 | 自己的 Clash/Mihomo YAML 来源或 HTTP/SOCKS5 节点；Cage 不提供代理服务 |

在“启用或关闭 Windows 功能”中启用“Windows 虚拟机监控程序平台”，按系统要求重启。也可在管理员终端执行：

```powershell
DISM /Online /Enable-Feature /FeatureName:HypervisorPlatform /All
```

这个系统功能需要一次管理员授权；Cage 日常运行和应用安装使用普通用户权限。企业电脑若禁止虚拟化，应由设备管理员启用。Debian 路线使用独立的 QEMU 虚拟机，Windows 客机使用 Hyper-V，两者都不依赖 WSL 或 Docker。

## 安装并开始工作

1. 在[项目主页](https://lee-xeo.github.io/Claude-Cage/#download)点击“下载应用”并选择 Windows，核对对应发行条目的 `SHA256SUMS`。签名安装包名为 `Cage-<版本>-windows-amd64-setup.exe`；当前公开预览包名为 `Cage-<版本>-windows-amd64-setup-unsigned.exe`，主页标明“预览版 · 未签名”。未签名包可能触发未知发布者提示，需手动安装和更新。
2. 运行安装程序，选择安装位置。首次安装时，默认选择本地 D 盘的 `D:\Cage`；没有本地 D 盘时使用当前用户的 `%LOCALAPPDATA%\Programs\Cage`。已有安装沿用原目录，也可以手动选择其他位置。安装器随附 .NET 桌面运行组件、WebView2 安装程序、QEMU、OpenSSH 客户端和代理核心，无需另装 Go、Node.js 或 Clash。
3. 在“快捷方式”页选择“添加桌面快捷方式”和“添加到开始菜单”。首次安装默认勾选两项，覆盖安装沿用上次选择，旧安装按已有快捷方式恢复选择。卸载会清理 Cage 创建的快捷方式。
4. 从选中的快捷方式启动 Cage，选择客机系统。如果 C 盘空间有限，在工作台点击“选择环境存储位置”，选择其他磁盘的专用空文件夹，再导入代理并启动环境。镜像、工具和虚拟磁盘按所选系统准备；已有环境也可以从设置迁移。见[选盘与迁移步骤](getting-started.md#选择环境存储位置)和[客机系统指南](guide/guest-systems.md)。

安装器不设置系统代理，不安装 SSH 服务，不把随附工具加入系统 PATH。WebView2 是 Microsoft 提供的系统浏览器运行时，其安装与维护由 Microsoft 安装程序负责。

安装器逐文件解压到安装位置所在磁盘的暂存目录，成功后替换应用，避免在系统临时目录生成整包解压副本。Windows 临时目录仍可能保存少量安装器辅助文件；缺少 WebView2 时，Microsoft 安装程序会管理其共享运行组件的位置。

“打开项目”接受 Windows 文件夹。使用 Debian 客机时，例如 `C:\Users\姓名\Projects\demo` 在 Linux 内对应 `/c/Users/姓名/Projects/demo`；使用 Windows 客机时，终端与工具采用 Windows 路径。项目文件仍保存在原来的主机文件夹中，编辑和删除直接影响原文件；项目内的 `.git` 可读写，可在 Cage 中暂存、提交和切换分支。只共享默认工作区与明确打开的目录。

Windows 快捷键以 `Ctrl` 为主：`Ctrl+O` 打开项目、`Ctrl+T` 新建网页、`Ctrl+L` 定位地址栏、`Ctrl+W` 关闭标签，`Ctrl+Shift+Enter` 新建终端。终端使用 `Ctrl+Shift+C/V` 复制粘贴，`Ctrl+C` 中断命令。网页和编辑器采用相应客机系统的按键行为。

窗口仅保留系统标题栏，工作台直接占据下方区域。文件、项目和设置操作使用工作台入口与快捷键；检查应用更新和版本信息可从托盘图标的右键菜单打开。窗口首次打开时按当前屏幕的可用区域居中，并适配 Windows 显示缩放。手动调整后的窗口尺寸和最大化状态会保存；换屏或降低分辨率时，窗口保持在当前屏幕内。后台启动与版本检测不显示命令行窗口。

关闭窗口会保留环境与后台任务，可从托盘图标重新打开；停止环境或选择停止后退出会结束终端。重新打开应用可连接仍运行的会话。

浏览器上传通过本机文件选择窗口选取文件；下载完成可用 Windows“另存为”选择位置。侧栏“下载”提供打开文件、在资源管理器中显示与再次另存为，取消保存窗口时保留默认 Downloads 中的文件。操作与限制见[浏览器上传与下载](getting-started.md#浏览器上传与下载)。

## 更新与卸载

应用内更新从固定的公开 GitHub Releases 来源选择 Windows x64 安装器，并沿用预发行与正式版通道规则。检查与下载经过已经应用并运行的 Cage 代理，不回退主机直连。下载安装器后校验 SHA-256、版本、产品名称和 Authenticode 签名；当前应用与新安装器必须具有相同的发布者公钥，未签名开发包不能自动安装更新。

没有新版时隐藏更新按钮；有新版时显示金色圆形按钮。用户先保存文件并结束运行中的任务，再点击一次，按钮显示环形下载进度和百分比。校验通过后自动安装，不再二次确认。更新器先备份应用，再通过工作台统一入口停止环境、代理和控制服务，等待当前窗口退出后执行静默安装。新应用完成工作台启动确认后才认定成功；安装或启动失败时尝试恢复旧程序，保留失败原因和必要备份。磁盘空间不足、文件被其他软件占用等情况可能阻止自动恢复，应按错误信息处理。

手动更新前也应保存文件、停止环境并退出 Cage，再运行新版安装器。旧后台仍运行时安装器会拒绝覆盖。客机工具在“设置 → 环境与恢复”中单独更新，替换应用会保留原系统与数据。

卸载前停止环境并退出，在 Windows“设置 → 应用”中卸载 Cage。卸载保留用户数据：默认配置、代理和环境数据根目录为 `%USERPROFILE%\.claude-cage`，另选的环境存储位置继续保留；默认工作区通常位于 `%USERPROFILE%\.claude-cage-workspace`，自行打开的项目仍在原目录。WebView2 可能由其他程序共用，不随 Cage 自动卸载。需要另行删除数据时先备份，删除虚拟磁盘会丢失只保存在客机中的文件与登录状态。

## 常见启动问题

Windows Hypervisor Platform 已启用时，QEMU 仍可能因嵌套虚拟化初始化失败而退出，错误码为 `80370302`。当前开发构建在 Windows x64 的默认 WHPX 参数中使用 `kernel-irqchip=off`，由 QEMU 实现中断控制器，保留 WHPX 的 CPU 加速。正常桌面入口直接使用该参数，无需外部 PowerShell 兼容脚本；显式设置的 QEMU machine 参数仍优先。此设置改变中断控制器实现，具体硬件上的多核、时钟和性能表现见[验收报告](test-reports/2026-11-06-exit-recovery/README.md)。启动失败时，“操作详情”显示经过脱敏的 QEMU stderr 摘要，完整脱敏诊断包可从设置导出。

当前开发构建在升级或强制结束后会自动检查旧连接记录及控制锁。旧锁空闲时修复其所有者和私有权限，再由新后台重建连接记录；真实后台持有的锁继续阻止接管。权限无法迁移时显示具体原因。请保留个人配置目录，不要通过删除账户或虚拟磁盘解决连接问题。点右上角 × 隐藏窗口并保留托盘，结束应用请使用“退出 Cage”；运行中的环境可选择保留运行或停止后退出。

本地开发包已适配含中文的安装目录。启动时优先读取随附 QEMU 的 UEFI 固件，无需在用户目录另存副本。在默认虚拟 CPU 配置下，Cage 会向 Windows 虚拟机监控程序平台查询可用指令；Claude Code 需要客机提供 SSE4.2。自行指定了虚拟 CPU 型号的环境仍沿用该设置。这两项修复尚未进入公开的 `v0.1.5-alpha.2` 安装包。

- 提示虚拟化不可用：检查 BIOS/UEFI 的虚拟化开关及 Windows 虚拟机监控程序平台，重启后再试。远程或嵌套虚拟机还需要外层宿主允许嵌套虚拟化。
- 提示缺少 WebView2：重新运行完整安装程序。不要从第三方站点下载同名 DLL。
- 工作台能打开，环境不能联网：检查 Cage 内是否已选择节点及网络检查结果。Windows 浏览器能联网不表示 Cage 节点已配置。
- 提示权限或路径不可用：使用当前用户有权限访问的本地目录，不把 Cage 安装目录、私有配置或磁盘根目录作为共享项目。更新器拒绝含符号链接或目录联接的安装路径。

反馈问题时提供 Cage 版本、Windows 版本与内部版本号、CPU 架构、失败步骤和错误原文。不要附带代理密码、订阅链接、会话地址或未脱敏的配置文件。

## 维护者构建与验收

### 平台验收记录

Windows 实现和安装器处于开发验收阶段。源码构建成功不代表所有电脑均已通过验收；下载时应查看对应发行说明。未签名开发包用于测试，不能通过应用内更新自动安装。正式发行还需要可信代码签名、完整的随附软件源码材料和 Win10/11 实机验收。

当前开发包已在 Windows 11 Pro 24H2（26100）的 Intel x64 实体机验证安装、覆盖安装、原生工作台、QEMU/WHPX 启动、十一项关键安全检查、中文空格路径共享、终端输入与缩放，以及浏览器和编辑器操作。暂停外网后客机 HTTPS 请求被阻断，重新检测后恢复；配置和项目文件在覆盖安装后保留。卸载保留数据及拒绝未签名更新也已实测。Windows 10 的实机兼容性和可信签名版本之间的完整升级仍待验证。

Windows 11 x64（内部版本 26200）另已在普通账户的原生工作台验证首次选 D 盘、显示真实下载字节、断点续传、已有环境从 C 盘迁到 D 盘并启动，以及迁移中断恢复。迁移后核对了虚拟机内文件、内置编辑器登录会话和本机测试账户。


### Windows 客机里的 PowerShell

Hyper-V 装机流程为新建的 Windows 11 x64 客机预装 PowerShell 7.6.9 LTS。首次登录后，在客机终端运行 `pwsh --version` 即可查看版本；旧脚本仍可用 `powershell.exe` 调用系统的 5.1。

Windows 开发包将创建脚本放在安装目录的 `resources\guest-os\new-windows-guest.ps1`。创建客机时，宿主从微软下载约 110 MB 的 x64 ZIP，核对 SHA-256 后写入只读安装盘。客机无需联网，所有用户共用 `%ProgramFiles%\PowerShell\7`。宿主也可通过 `-PowerShellZip` 指定已下载的同版本文件。该步骤在 Windows 首次安装时运行，已有客机不会在 Cage 更新时重装。[客机创建脚本](../scripts/guest-os/new-windows-test-vm.ps1) · [微软发布校验清单](https://github.com/PowerShell/PowerShell/releases/download/v7.6.9/hashes.sha256)

### 构建 Windows 应用

Windows QEMU 由固定源码及 `patches/qemu` 中的补丁构建。MSYS2 UCRT64 需要安装 `gcc`、`glib2`、`pixman`、`libslirp`、`dtc`、`ninja`、`python`、`pkgconf` 对应的 `mingw-w64-ucrt-x86_64-` 软件包，以及 `make`、`patch`、`diffutils`。`CAGE_MSYS2_ROOT` 指向 MSYS2 根目录。QEMU 源码和构建目录须使用不含空格的路径。`build-windows.ps1` 自动构建并校验 QEMU 缓存，安装包旁的源码材料包含对应补丁及依赖清单。

构建使用 PowerShell 7、Go（遵循 `go.mod`）、Node.js、.NET 10 SDK、7-Zip 和 NSIS。依赖版本、下载地址及哈希固定在 `packaging/windows/dependencies.json`；构建时逐个校验。源码默认版本来自根目录 `VERSION`。

```powershell
pwsh -File scripts/build-windows.ps1
pwsh -File scripts/package-windows.ps1 -SkipBuild
```

构建会检查前端资源是否为空、是否含全零字节、JavaScript 语法与入口引用，并为资源生成哈希清单。后台编译后核对嵌入的资源。Windows 应用目录在交付前还必须使用独立临时配置，通过 WebView2 页面加载与原生桥自检；超时或失败会停止构建。在 Windows 上使用 `-SkipBuild` 打包也会重新执行该自检。自检不启动虚拟机，也不读取默认个人配置。失败时保留临时诊断目录，成功时确认后台退出后清理。

应用目录输出到 `_output/windows-amd64/app`，安装器与校验文件输出到 `_output/releases/<版本>/windows`。正式签名构建使用构建脚本的 `-Release` 模式，支持 SSL.com eSigner 或当前用户证书存储中的代码签名证书；发布脚本还要求与 QEMU 构建相对应的源码归档。参数以脚本帮助为准。签名完成后再生成发行物摘要，不能对签名后的文件重新修改。两个平台同批发布时，使用[公开发行流程](public-releases.md#发布安装包)生成共用校验清单；官网仅在公开 Release 的 Windows 附件和摘要有效时显示下载按钮。

本地测试需要可信签名时，构建和打包脚本均可使用 `-Sign`。此模式沿用当前版本，签名应用、后端、代理核心、卸载器和安装器，并核对 Windows 信任及发布者证书。测试安装包带 `-test-signed` 文件名后缀。

```powershell
pwsh -File scripts/build-windows.ps1 -Sign
pwsh -File scripts/package-windows.ps1 -SkipBuild -Sign
```

安装器的快捷方式页采用原生复选框。自动化安装可传入 `/DESKTOPSHORTCUT=0|1` 和 `/STARTMENUSHORTCUT=0|1`，参数放在最后的 `/D=` 安装目录之前。未提供参数的静默更新沿用已保存的选择。实现使用 NSIS 的自定义页面和状态接口。[NSIS 页面文档](https://nsis.sourceforge.io/Docs/nsDialogs/Readme.html)

安装器和卸载器通过 `MUI_ICON`、`MUI_UNICON` 指定 Cage 图标，配置放在 Modern UI 页面定义之前。打包脚本检查可执行文件的主图标组，逐档核对 16–256 像素的七幅图像与 `Cage.ico` 一致。图标被模板覆盖时，打包会报错。[Modern UI 图标配置](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html)

卸载清单枚举应用载荷的全部文件和目录，包括点号开头的文件及隐藏属性项目。安装回归还会核对卸载后专用程序目录完全移除，确保随后可以装回同一路径。

安装目标支持尚未创建的路径、已有空目录和带有效 Cage 安装标记的程序目录。目录检查使用 NSIS `DirState` 区分空目录与实际内容。缺少有效安装标记且含文件或子目录时，安装器要求另选目录。回归测试先创建空目录，再执行完整安装流程。

首次验证 eSigner 时，在自己的终端运行下面的命令。需要 Java 21 和 Node.js；macOS、Windows 和 Linux 都可以调用签名工具。工具固定版本与摘要保存在 `packaging/windows/signing.json`，下载内容变化时会停止，须审核后更新。输入 SSL.com 用户名、密码、凭据 ID，等工具提示后再输入验证器当时显示的六位验证码。密码和验证码不显示、不保存；签名后的副本写入新的输出目录，原文件保留。

```sh
node scripts/esigner.mjs install
node scripts/esigner.mjs sign /absolute/path/to/Cage.exe --output-dir /absolute/path/to/fresh-signed-output
```

签名单个文件不会发版。完整 Windows 构建选择 `CAGE_WINDOWS_SIGNING_PROVIDER=esigner`，并设置 `CAGE_ESIGNER_USERNAME`、`CAGE_ESIGNER_PASSWORD`、`CAGE_ESIGNER_CREDENTIAL_ID`、`CAGE_ESIGNER_CERTIFICATE_SERIAL` 和 `CAGE_ESIGNER_TOTP_SECRET`；其中 TOTP 密钥供无人值守流程生成验证码，不能用六位验证码代替。NSIS 的卸载器签名子进程不提供交互终端，因此完整打包需要这些环境配置。密码和密钥不要写入 shell 命令历史或源码。GitHub 环境配置见 [CI/CD 说明](ci-cd.md#首次配置发布材料)。

Windows 正式构建会检查可信 Authenticode 签名、时间戳与指定证书；只通过这些检查的副本才会替换待打包文件。其他平台上的签名测试不能替代 Windows 信任与安装验收。自动更新继续要求旧应用和新安装器使用相同发布者公钥，换用新密钥前需要单独安排更新迁移。

工具参数与验证器配置以 SSL.com 的 [CodeSignTool 指南](https://www.ssl.com/guide/esigner-codesigntool-command-guide/)和 [签名凭据指南](https://www.ssl.com/guide/esigner-signing-credential-guide/)为准。

CI 负责源码、原生窗口、安装器和 Windows 可执行测试；干净 Windows 10/11 上的虚拟化仍需要设备验收。每次正式发行至少记录：首次安装、WebView2 首次启动、无虚拟化时的提示、代理导入、VM 首次下载与启动、网络隔离检查、中文和空格路径共享、终端输入与缩放、退出恢复、从旧签名版升级、失败恢复、卸载后数据保留。只有真实执行的项目才能标记通过。

### 窗口上栏的外观

切换「设置 → 外观」后，菜单栏及其下拉菜单会采用所选主题的侧栏配色。Windows 11 的标题栏使用相同配色，Windows 10 的标题栏随浅色或深色模式切换。开启 Windows 对比度主题时，原生菜单和标题栏采用系统配色。
