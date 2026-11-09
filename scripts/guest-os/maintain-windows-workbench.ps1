#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Profile,
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ManifestSHA256,
    [switch]$Tools,
    [string]$BindingSHA256,
    [pscredential]$GuestAdministrator
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$bindingPath=Join-Path $Profile 'windows-guest.json'
$item=Get-Item -LiteralPath $bindingPath -Force
if ($item -isnot [IO.FileInfo] -or $item.Length -gt 16384 -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '已绑定的 Windows 环境记录无法核验。' }
$bindingHash=(Get-FileHash -LiteralPath $bindingPath -Algorithm SHA256).Hash
if ($BindingSHA256 -and $BindingSHA256 -ne $bindingHash) { throw 'Windows 环境绑定已变化，请重新发起更新。' }
if ((Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash -ne $ManifestSHA256) { throw '组件清单已变化，请重新发起更新。' }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (![Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $parameters=@{Profile=$Profile;ManifestPath=$ManifestPath;ManifestSHA256=$ManifestSHA256;BindingSHA256=$bindingHash;Tools=[bool]$Tools}
    $payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($parameters|ConvertTo-Json -Compress)))
    $script=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PSCommandPath))
    $command='$ErrorActionPreference=''Stop'';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('''+$payload+'''))|ConvertFrom-Json;$a=@{};$p.PSObject.Properties|ForEach-Object{$a[$_.Name]=$_.Value};$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('''+$script+'''));try{& $s @a;exit 0}catch{Write-Error $_;exit 1}'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process=Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell/v1.0/powershell.exe') -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','RemoteSigned','-EncodedCommand',$encoded) -Verb RunAs -PassThru
    try {
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw 'Windows 组件更新未完成。系统磁盘和账户已保留，请在系统窗口查看原因后重试。' }
    } finally { $process.Dispose() }
    return
}
$binding=Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
$vm=Hyper-V\Get-VM -Id ([guid]$binding.vm_id)
$disks=@($vm | Hyper-V\Get-VMHardDiskDrive)
$pairDirectory=[IO.Path]::GetDirectoryName($binding.relay_executable)
$stagedPairDirectory=Join-Path $binding.instance_directory 'cage-workbench\pair'
if ($binding.version -ne 1 -or $vm.Id -eq [guid]::Empty -or $vm.State -ne 'Running' -or
    $binding.gui_user_sid -notmatch '^S-1-5-21-' -or @(Hyper-V\Get-VMNetworkAdapter -VM $vm).Count -ne 0 -or
    $disks.Count -ne 1 -or $disks[0].Path -ine (Join-Path $binding.instance_directory 'system.vhdx') -or
    ($pairDirectory -ine $stagedPairDirectory -and $pairDirectory -ine $item.Directory.FullName) -or
    $binding.relay_executable -ine (Join-Path $pairDirectory 'Cage.GuestClipboard.exe') -or
    $binding.pairing_file -ine (Join-Path $pairDirectory 'pairing.dpapi')) {
    throw '当前运行的 Windows 客机与保留的绑定不一致。'
}
for ($entry=Get-Item -LiteralPath $binding.relay_executable -Force; $entry; $entry=if ($entry -is [IO.FileInfo]) {$entry.Directory} else {$entry.Parent}) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '主机连接组件路径包含文件链接。' }
}
$manifest=Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.protocol -ne 1 -or $manifest.system -cne 'windows-11' -or $manifest.revision -notmatch '^[a-f0-9]{64}$' -or @($manifest.files).Count -notin 1..10000) { throw '原生组件清单无效。' }
$kit=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')+'\'
foreach ($entry in $manifest.files) {
    $source=[IO.Path]::GetFullPath((Join-Path $kit $entry.source))
    if (!$source.StartsWith($kit,[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint -or
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw '应用组件包已变化，请重新安装完整 Cage 应用。' }
}
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('Cage\ComponentMaintenance\'+$vm.Id.ToString('D'))
for ($parent=$work; $parent; $parent=[IO.Path]::GetDirectoryName($parent)) {
    if ((Test-Path -LiteralPath $parent) -and (Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '组件维护目录包含文件链接。' }
}
$null=New-Item -ItemType Directory -Path $work -Force
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
Set-Acl -LiteralPath $work -AclObject $acl
$lock=[IO.File]::Open((Join-Path $work 'maintenance.lock'),'OpenOrCreate','ReadWrite','None')
$stage=Join-Path $work ([guid]::NewGuid().ToString('N'))
$session=$null
$remote=$null
$completed=$false
try {
    $null=New-Item -ItemType Directory -Path $stage
    $files=Join-Path $stage 'files'
    $null=New-Item -ItemType Directory -Path $files
    foreach ($entry in $manifest.files) {
        if (!$entry.target) { continue }
        if ($entry.target -notmatch '^(bridge|network)/[^:]+$' -or $entry.target -match '(^|/)\.\.?(/|$)|\\') { throw '组件安装位置无效。' }
        $target=Join-Path $files $entry.target
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
        Copy-Item -LiteralPath (Join-Path $kit $entry.source) -Destination $target
        if ((Get-FileHash -LiteralPath $target).Hash -ne $entry.installed_sha256) { throw '复制后的组件摘要不匹配。' }
    }
    [IO.File]::WriteAllText((Join-Path $stage 'native-components.json'),($manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    $packages=Get-Content -LiteralPath (Join-Path $kit 'payload/windows-workbench-packages.json') -Raw | ConvertFrom-Json
    $cli=Get-Content -LiteralPath (Join-Path $kit 'payload/cli-dependencies.json') -Raw | ConvertFrom-Json
    if ($Tools) {
        . (Join-Path $kit 'windows-workbench-packages.ps1')
        $cache=Join-Path $work 'packages'
        $null=New-Item -ItemType Directory -Path $cache -Force
        $downloads=@{}
        foreach ($spec in @($packages.PSObject.Properties)+@($cli.PSObject.Properties)) { $downloads[$spec.Name]=Get-PinnedPackage $spec.Value $cache }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $bridge=Join-Path $stage 'runtime'
        $null=New-Item -ItemType Directory -Path $bridge
        $archive=[IO.Compression.ZipFile]::OpenRead($downloads.node)
        try { [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('node-v24.22.2-win-x64/node.exe'),(Join-Path $bridge 'node.exe')) } finally { $archive.Dispose() }
        Expand-PinnedTar $downloads.playwright (Join-Path $bridge 'playwright')
        Expand-PinnedTar $downloads.playwrightCore (Join-Path $bridge 'playwright/node_modules/playwright-core')
        [IO.Compression.ZipFile]::ExtractToDirectory($downloads.editorCLI,(Join-Path $bridge 'vscode-cli'))
        Expand-PinnedTar $downloads.editorServer (Join-Path $bridge 'vscode-server')
        [IO.File]::WriteAllText((Join-Path $bridge 'editor-runtime.json'),'{"commit":"261c84cb1eddf11235f9e2c921425e9663fbe556"}')
        $toolStage=Join-Path $stage 'tools'
        $null=New-Item -ItemType Directory -Path $toolStage
        foreach ($name in @('desktop','winfsp','sshfs','uv','python','claude','git')) { Copy-Item -LiteralPath $downloads[$name] -Destination $toolStage }
        & (Join-Path $env:SystemRoot 'System32/tar.exe') -a -cf (Join-Path $toolStage 'extras.zip') -C $bridge .
        if ($LASTEXITCODE) { throw '无法准备经过校验的环境工具包。' }
    }
    if (!$GuestAdministrator) { $GuestAdministrator=Get-Credential -Message 'Cage：请输入当前 Windows 客机的管理员账户以更新组件。' }
    if (!$GuestAdministrator) { throw '已取消 Windows 组件更新。' }
    $session=New-PSSession -VMId $vm.Id -Credential $GuestAdministrator
    $remote=Invoke-Command -Session $session -ArgumentList $vm.Id -ScriptBlock {
        param($expected)
        if ([guid](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Virtual Machine\Guest\Parameters').VirtualMachineId -ne $expected) { throw 'guest_identity_mismatch' }
        $path=Join-Path $env:ProgramFiles ('Cage Component Update\'+[guid]::NewGuid().ToString('N'))
        $null=New-Item -ItemType Directory -Path $path -Force
        $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
        foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
        Set-Acl -LiteralPath $path -AclObject $acl
        $path
    }
    $archive=Join-Path $work ([guid]::NewGuid().ToString('N')+'.zip')
    try {
        $entries=@('files','native-components.json')
        if ($Tools) { $entries+='tools' }
        & (Join-Path $env:SystemRoot 'System32/tar.exe') -a -cf $archive -C $stage @entries
        if ($LASTEXITCODE) { throw '无法打包客机组件。' }
        Copy-Item -LiteralPath $archive -Destination (Join-Path $remote 'update.zip') -ToSession $session
        $hash=(Get-FileHash -LiteralPath $archive).Hash
    } finally { if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive } }
    Copy-Item -LiteralPath (Join-Path $kit 'install-windows-workbench-components.ps1') -Destination $remote -ToSession $session
    Invoke-Command -Session $session -FilePath (Join-Path $kit 'update-windows-workbench-components.ps1') -ArgumentList $vm.Id,$binding.gui_user_sid,$remote,$hash,([bool]$Tools),($packages|ConvertTo-Json -Depth 6 -Compress),($cli|ConvertTo-Json -Depth 6 -Compress)
    # The host relay is an application file. Pairing bytes and the binding are retained.
    $relayStage=$binding.relay_executable+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        Copy-Item -LiteralPath (Join-Path $files 'bridge/Cage.GuestClipboard.exe') -Destination $relayStage
        Set-Acl -LiteralPath $relayStage -AclObject (Get-Acl -LiteralPath $binding.relay_executable)
        [IO.File]::Replace($relayStage,$binding.relay_executable,[Management.Automation.Language.NullString]::Value)
    } finally { if (Test-Path -LiteralPath $relayStage) { Remove-Item -LiteralPath $relayStage } }
    if (@(Hyper-V\Get-VMNetworkAdapter -VM (Hyper-V\Get-VM -Id $vm.Id)).Count -ne 0) { throw '更新期间客机网络配置发生变化。' }
    $completed=$true
    Write-Output 'Windows 客机组件已完成文件核验，已保留账户、项目和配对资料。'
} finally {
    if ($session) {
        if ($remote -and $completed) { Invoke-Command -Session $session -ArgumentList $remote -ScriptBlock { param($path) Remove-Item -LiteralPath $path -Recurse -Force } -ErrorAction Continue }
        elseif ($remote) { Write-Warning ('组件恢复材料保留在客机 '+$remote+'，重试会继续使用原环境。') }
        Remove-PSSession $session
    }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $lock.Dispose()
}
