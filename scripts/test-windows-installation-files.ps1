#requires -Version 5.1
param([string]$HelperShell = (Get-Process -Id $PID).Path)
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '../packaging/windows/installation-files.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('cage-install-files-' + [guid]::NewGuid().ToString('N'))
$checks = 0
$windows = $env:OS -eq 'Windows_NT'
function Check([bool]$Value, [string]$Message) {
    if (!$Value) { throw $Message }
    $script:checks++
}
function Write-File([string]$Path, [string]$Value) {
    [IO.Directory]::CreateDirectory((Split-Path $Path -Parent)) | Out-Null
    [IO.File]::WriteAllText($Path, $Value)
}
function New-FileLink([string]$Path, [string]$Target) {
    if ($windows) {
        & cmd.exe /c mklink $Path.Replace('/', '\') $Target.Replace('/', '\') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated file link fixture.' }
    } else { [IO.File]::CreateSymbolicLink($Path, $Target) | Out-Null }
}
function Read-Link([string]$Path) {
    $entry = Get-Item -LiteralPath $Path -Force
    if ($windows) { return ([string]@($entry.Target)[0]).Replace('\', '/') }
    return $entry.LinkTarget
}
function Remove-TestTree([string]$Path) {
    foreach ($entry in Get-ChildItem -LiteralPath $Path -Force) {
        if (!$windows -and $entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            [IO.File]::Delete($entry.FullName)
        } elseif ($entry.Attributes -band [IO.FileAttributes]::Directory) {
            if (!($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-TestTree $entry.FullName }
            [IO.Directory]::Delete($entry.FullName)
        } else { [IO.File]::Delete($entry.FullName) }
    }
}
function App([string]$Path, [string]$Version) {
    Write-File (Join-Path $Path 'Cage.install-id') 'io.github.lee-xeo.claude-cage'
    Write-File (Join-Path $Path 'program.txt') $Version
    Write-File (Join-Path $Path 'resources/customizable.txt') ('default-' + $Version)
    Write-File (Join-Path $Path 'Uninstall.exe') ('uninstaller-' + $Version)
    $files = @(Get-ChildItem -LiteralPath $Path -File -Recurse | ForEach-Object {
        @{path = $_.FullName.Substring($Path.TrimEnd('\','/').Length + 1).Replace('\', '/'); sha256 = (Get-FileHash $_.FullName).Hash.ToLowerInvariant()}
    })
    @{version = 1; files = $files} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Path 'Cage.install-files.json')
}
function Invoke-Helper([string[]]$Arguments, [int]$Expected = 0) {
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $HelperShell -NoProfile -File $helper @Arguments 2>&1 | Out-String
    } finally { $ErrorActionPreference = 'Stop' }
    if ($LASTEXITCODE -ne $Expected) { throw "Helper returned $LASTEXITCODE, expected $Expected. $output" }
}
function Prepare([string]$Old, [string]$Stage, [string]$Receipt) {
    Invoke-Helper @('-Operation','prepare','-Source',$Old,'-Target',$Stage,'-Receipt',$Receipt,'-Backup',($Old+'-backup'))
}
function Commit([string]$Old, [string]$Stage, [string]$Receipt) {
    $backup = $Old + '-backup'
    [IO.Directory]::Move($Old, $backup)
    Invoke-Helper @('-Operation','move','-Source',$backup,'-Target',$Stage,'-Receipt',$Receipt)
    [IO.Directory]::Move($Stage, $Old)
    Invoke-Helper @('-Operation','cleanup','-Source',$backup,'-Target',$Old,'-Receipt',$Receipt)
    return $backup
}
try {
    foreach ($manifestState in @('current','missing','invalid')) {
        $scenario = Join-Path $root $manifestState
        $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
        App $old 'old'; App $stage 'new'
        $manifest = Join-Path $old 'Cage.install-files.json'
        if ($manifestState -eq 'missing') { Remove-Item $manifest }
        if ($manifestState -eq 'invalid') { Write-File $manifest '{broken' }
        Write-File (Join-Path $old 'my-project/work.txt') 'project data'
        Write-File (Join-Path $old 'resources/customizable.txt') 'user customization'
        Write-File (Join-Path $scenario 'outside/config.txt') 'outside data'
        [IO.Directory]::CreateDirectory((Join-Path $old 'empty-project')) | Out-Null
        Prepare $old $stage $receipt
        Check ((Get-Content (Join-Path $old 'program.txt') -Raw) -eq 'old') 'Preparation modified the original installation.'
        $backup = Commit $old $stage $receipt
        Check ((Get-Content (Join-Path $old 'program.txt') -Raw) -eq 'new') 'New program was overwritten by legacy files.'
        Check ((Get-Content (Join-Path $old 'my-project/work.txt') -Raw) -eq 'project data') 'Project data was lost.'
        Check ((Get-Content (Join-Path $scenario 'outside/config.txt') -Raw) -eq 'outside data') 'External profile was modified.'
        Check (Test-Path (Join-Path $old 'empty-project') -PathType Container) 'Empty project directory was lost.'
        $copies = @(Get-ChildItem (Join-Path $old 'Cage-preserved-files') -File -Recurse | Where-Object { (Get-Content $_.FullName -Raw) -eq 'user customization' })
        Check ($copies.Count -eq 1) 'Modified same-name program content was not retained exactly once.'
        Check (!(Test-Path $backup)) 'Completed transfer left a full old application copy.'
        $embedded = Join-Path $scenario 'embedded.json'
        Copy-Item (Join-Path $old 'Cage.install-files.json') $embedded
        Write-File (Join-Path $old 'resources/customizable.txt') 'new customization'
        Invoke-Helper @('-Operation','uninstall','-Target',$old,'-Manifest',$embedded)
        Check (!(Test-Path (Join-Path $old 'program.txt'))) 'Uninstaller retained an unchanged program file.'
        Check ((Get-Content (Join-Path $old 'my-project/work.txt') -Raw) -eq 'project data') 'Uninstall deleted a project.'
        Check ((Get-Content (Join-Path $old 'resources/customizable.txt') -Raw) -eq 'new customization') 'Uninstall deleted a modified program file.'
        Check (Test-Path (Join-Path $old 'empty-project') -PathType Container) 'Uninstall deleted an unknown empty project.'
        Check (Test-Path (Join-Path $old 'Cage.install-id')) 'Retained data directory cannot be recognized on reinstall.'
        App $stage 'reinstalled'
        Prepare $old $stage $receipt
        $null = Commit $old $stage $receipt
        Check ((Get-Content (Join-Path $old 'my-project/work.txt') -Raw) -eq 'project data') 'Reinstall after uninstall lost the project.'
    }
    $scenario = Join-Path $root 'concurrent'
    $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
    App $old 'old'; App $stage 'new'
    Write-File (Join-Path $old 'project.txt') 'first'
    Prepare $old $stage $receipt
    Write-File (Join-Path $old 'project.txt') 'late edit'
    Write-File (Join-Path $old 'new-project.txt') 'created during install'
    [IO.Directory]::CreateDirectory((Join-Path $old 'late-empty-project')) | Out-Null
    $null = Commit $old $stage $receipt
    $late = @(Get-ChildItem (Join-Path $old 'Cage-preserved-files') -File -Recurse)
    Check ((Get-Content (Join-Path $old 'project.txt') -Raw) -eq 'late edit') 'Concurrent edit was deleted.'
    Check (@($late | Where-Object { (Get-Content $_.FullName -Raw) -eq 'created during install' }).Count -eq 1) 'Concurrent new file was deleted.'
    Check (@(Get-ChildItem (Join-Path $old 'Cage-preserved-files') -Directory -Recurse | Where-Object Name -eq 'late-empty-project').Count -eq 1) 'Concurrent empty project was deleted.'
    $scenario = Join-Path $root 'rollback'
    $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
    App $old 'old'; App $stage 'new'
    Write-File (Join-Path $old 'project.txt') 'rollback project'
    Prepare $old $stage $receipt
    $backup = $old + '-backup'
    [IO.Directory]::Move($old, $backup)
    Remove-Item -LiteralPath $stage -Recurse
    try { [IO.Directory]::Move($stage, $old); throw 'Expected the missing stage to fail.' }
    catch [IO.DirectoryNotFoundException] { [IO.Directory]::Move($backup, $old) }
    Invoke-Helper @('-Operation','complete','-Target',$old,'-Receipt',$receipt)
    Check ((Get-Content (Join-Path $old 'project.txt') -Raw) -eq 'rollback project') 'Failed replacement lost the original project.'
    Check ((Get-Content (Join-Path $old 'program.txt') -Raw) -eq 'old') 'Failed replacement changed the original program.'
    $stage = Join-Path $scenario 'staged-again'; App $stage 'new'
    $locked = [IO.File]::Open((Join-Path $old 'program.txt'), 'Open', 'ReadWrite', 'None')
    try { Invoke-Helper @('-Operation','prepare','-Source',$old,'-Target',$stage,'-Receipt',$receipt) 1 }
    finally { $locked.Dispose() }
    Check ((Get-Content (Join-Path $old 'project.txt') -Raw) -eq 'rollback project') 'Failed preparation changed a locked project.'
    $fresh = Join-Path $root 'fresh'; App $fresh 'fresh'
    $embedded = Join-Path $root 'fresh-embedded.json'; Copy-Item (Join-Path $fresh 'Cage.install-files.json') $embedded
    Invoke-Helper @('-Operation','uninstall','-Target',$fresh,'-Manifest',$embedded)
    Check (!(Test-Path $fresh)) 'An unmodified installation was not fully removed.'
    $scenario = Join-Path $root 'links'
    $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
    App $old 'old'; App $stage 'new'
    Write-File (Join-Path $scenario 'outside/target.txt') 'external link target'
    [IO.Directory]::CreateDirectory((Join-Path $old 'my-project')) | Out-Null
    New-FileLink (Join-Path $old 'my-project/relative.txt') '../../outside/target.txt'
    New-FileLink (Join-Path $old 'my-project/missing.txt') 'missing-target'
    $junction = Join-Path $old 'my-project/junction'
    if ($windows) {
        & cmd.exe /c mklink /J $junction (Join-Path $scenario 'outside') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated junction fixture.' }
    } else { [IO.Directory]::CreateSymbolicLink($junction, (Join-Path $scenario 'outside')) | Out-Null }
    Prepare $old $stage $receipt
    $null = Commit $old $stage $receipt
    Check ((Read-Link (Join-Path $old 'my-project/relative.txt')) -eq '../../outside/target.txt') 'Relative symlink text changed during installation.'
    Check ((Get-Content (Join-Path $old 'my-project/relative.txt') -Raw) -eq 'external link target') 'Relative symlink no longer reaches its target.'
    Check ((Read-Link (Join-Path $old 'my-project/missing.txt')) -eq 'missing-target') 'Dangling symlink was lost.'
    Check ((Get-Content (Join-Path $junction 'target.txt') -Raw) -eq 'external link target') 'Directory link was not retained.'
    $embedded = Join-Path $scenario 'embedded.json'; Copy-Item (Join-Path $old 'Cage.install-files.json') $embedded
    Invoke-Helper @('-Operation','uninstall','-Target',$old,'-Manifest',$embedded)
    Check ((Get-Content (Join-Path $scenario 'outside/target.txt') -Raw) -eq 'external link target') 'Uninstall changed an external link target.'
    Check ((Read-Link (Join-Path $old 'my-project/relative.txt')) -eq '../../outside/target.txt') 'Uninstall removed a project link.'
    $scenario = Join-Path $root 'linked-program-directory'
    $old = Join-Path $scenario 'installed'; App $old 'old'
    $embedded = Join-Path $scenario 'embedded.json'; Copy-Item (Join-Path $old 'Cage.install-files.json') $embedded
    Write-File (Join-Path $scenario 'outside/customizable.txt') 'default-old'
    Remove-Item (Join-Path $old 'resources') -Recurse
    if ($windows) {
        & cmd.exe /c mklink /J (Join-Path $old 'resources') (Join-Path $scenario 'outside') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated junction fixture.' }
    } else { [IO.Directory]::CreateSymbolicLink((Join-Path $old 'resources'), (Join-Path $scenario 'outside')) | Out-Null }
    Invoke-Helper @('-Operation','uninstall','-Target',$old,'-Manifest',$embedded)
    Check ((Get-Content (Join-Path $scenario 'outside/customizable.txt') -Raw) -eq 'default-old') 'Uninstall followed a replaced program directory link.'
    Check ([bool]((Get-Item (Join-Path $old 'resources') -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'Uninstall removed a user directory link.'
    $scenario = Join-Path $root 'linked-installation-root'
    $actual = Join-Path $scenario 'actual'; $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
    App $actual 'old'; App $stage 'new'
    Write-File (Join-Path $actual 'my-project/work.txt') 'external installation project'
    if ($windows) {
        & cmd.exe /c mklink /J $old $actual | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated installation junction.' }
    } else { [IO.Directory]::CreateSymbolicLink($old, $actual) | Out-Null }
    Invoke-Helper @('-Operation','prepare','-Source',$old,'-Target',$stage,'-Receipt',$receipt) 1
    Check ((Get-Content (Join-Path $actual 'my-project/work.txt') -Raw) -eq 'external installation project') 'Preparation followed the installation root link and changed its target.'
    Check (!(Test-Path $receipt)) 'Preparation published a transaction for a redirected installation root.'
    $scenario = Join-Path $root 'move-rollback'
    $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
    App $old 'old'; App $stage 'new'
    Write-File (Join-Path $old 'first-project/work.txt') 'first user project'
    Write-File (Join-Path $old 'second-project/work.txt') 'second user project'
    New-FileLink (Join-Path $old 'first-project/link.txt') 'work.txt'
    Prepare $old $stage $receipt
    $moves = @((Get-Content $receipt -Raw | ConvertFrom-Json).moves)
    $backup = $old + '-backup'; [IO.Directory]::Move($old, $backup)
    [IO.Directory]::CreateDirectory((Join-Path $stage $moves[-1].destination)) | Out-Null
    Invoke-Helper @('-Operation','move','-Source',$backup,'-Target',$stage,'-Receipt',$receipt) 1
    Invoke-Helper @('-Operation','restore','-Source',$stage,'-Target',$backup,'-Receipt',$receipt)
    [IO.Directory]::Move($backup, $old)
    Check ((Get-Content (Join-Path $old 'first-project/work.txt') -Raw) -eq 'first user project') 'Rollback missed an already moved project.'
    Check ((Get-Content (Join-Path $old 'second-project/work.txt') -Raw) -eq 'second user project') 'Rollback changed the project whose move failed.'
    Check ((Read-Link (Join-Path $old 'first-project/link.txt')) -eq 'work.txt') 'Rollback changed a relative project link.'
    $scenario = Join-Path $root 'type-conflicts'
    $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'staged'; $receipt = Join-Path $scenario 'receipt.json'
    App $old 'old'; App $stage 'new'
    Remove-Item (Join-Path $old 'Cage.install-files.json')
    Write-File (Join-Path $old 'obsolete.dll') 'obsolete library'
    Write-File (Join-Path $old 'resources/new-tool/data.txt') 'user directory'
    Write-File (Join-Path $stage 'resources/new-tool') 'new program file'
    Prepare $old $stage $receipt
    $null = Commit $old $stage $receipt
    Check (!(Test-Path (Join-Path $old 'obsolete.dll'))) 'Legacy unknown DLL remained in the new application loader path.'
    Check ((Get-Content (Join-Path $old 'resources/new-tool') -Raw) -eq 'new program file') 'A user directory replaced a new program file.'
    $retained = @(Get-ChildItem (Join-Path $old 'Cage-preserved-files') -File -Recurse)
    Check (@($retained | Where-Object { (Get-Content $_.FullName -Raw) -eq 'obsolete library' }).Count -eq 1) 'Legacy DLL bytes were lost.'
    Check (@($retained | Where-Object { (Get-Content $_.FullName -Raw) -eq 'user directory' }).Count -eq 1) 'Conflicting user directory was lost.'
    $scenario = Join-Path $root 'legacy-automatic-rollback'
    $old = Join-Path $scenario 'installed'; $stage = Join-Path $scenario 'restored'; $receipt = Join-Path $scenario 'receipt.json'
    App $stage 'old-program'
    Remove-Item (Join-Path $stage 'Cage.install-files.json')
    Write-File (Join-Path $stage 'my-project/work.txt') 'before attempted update'
    Write-File (Join-Path $stage 'personal.txt') 'old personal file'
    App $old 'failed-new-program'
    Write-File (Join-Path $old 'my-project/work.txt') 'saved while the new version was running'
    Write-File (Join-Path $old 'personal.txt') 'latest personal file'
    New-FileLink (Join-Path $old 'my-project/latest-link.txt') 'work.txt'
    Invoke-Helper @('-Operation','prepare','-Source',$old,'-Target',$stage,'-Receipt',$receipt,'-Backup',($old+'-backup'),'-LegacyTarget')
    $null = Commit $old $stage $receipt
    Check ((Get-Content (Join-Path $old 'program.txt') -Raw) -eq 'old-program') 'Legacy recovery did not restore the previous program.'
    Check ((Get-Content (Join-Path $old 'my-project/work.txt') -Raw) -eq 'saved while the new version was running') 'Legacy recovery put an old project at the active path.'
    Check ((Get-Content (Join-Path $old 'personal.txt') -Raw) -eq 'latest personal file') 'Legacy recovery put an old personal file at the active path.'
    Check ((Read-Link (Join-Path $old 'my-project/latest-link.txt')) -eq 'work.txt') 'Legacy recovery lost the current relative link.'
    $previousCopies = @(Get-ChildItem (Join-Path $old 'Cage-preserved-files') -File -Recurse)
    Check (@($previousCopies | Where-Object { (Get-Content $_.FullName -Raw) -eq 'before attempted update' }).Count -eq 1) 'Legacy recovery deleted the previous project version.'
    Check (@($previousCopies | Where-Object { (Get-Content $_.FullName -Raw) -eq 'old personal file' }).Count -eq 1) 'Legacy recovery deleted the previous personal-file version.'
    if ($windows) {
        & $HelperShell -NoProfile -File (Join-Path $PSScriptRoot 'test-windows-verified-file-deletion.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Verified-handle deletion regression failed.' }
    }
    Write-Output "Installation file ownership: $checks checks passed."
} finally {
    if (Test-Path -LiteralPath $root) { Remove-TestTree $root; [IO.Directory]::Delete($root) }
}
