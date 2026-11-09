# Cross-platform regression for the real smoke-report and CI artifact contract.
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$directory = Join-Path ([IO.Path]::GetTempPath()) ('cage-smoke-contract-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$savedRunnerTemp = $env:RUNNER_TEMP
function Assert-SmokeContract([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    $env:RUNNER_TEMP = Join-Path $directory 'runner-temp'
    Assert-SmokeContract ((Get-WindowsWorkbenchTestBase) -eq [IO.Path]::GetFullPath($env:RUNNER_TEMP)) 'CI report directory ignores RUNNER_TEMP.'
    Remove-Item Env:RUNNER_TEMP -ErrorAction SilentlyContinue
    Assert-SmokeContract ((Get-WindowsWorkbenchTestBase) -eq [IO.Path]::GetTempPath()) 'Local report directory lost its OS temp fallback.'
    $report = Join-Path $directory 'smoke.json'
    $fixture = Join-Path $directory 'fixture.json'
    $childScript = Join-Path $directory 'child.ps1'
    [IO.File]::WriteAllText($childScript, '[IO.File]::Copy($args[0],$args[1],$true); exit 17')
    @{
        success = $false; nativeBridgeReady = $false; phase = 'loading_workbench'
        nativeStatus = 'failed http://localhost:1234/?token=private-token#private-fragment'
        entryJSON = 'private-entry'; pageURL = 'http://localhost:1234/#private-launch'
        page = @{ text = 'private-page-body'; errors = @(
            @{ type = 'module-load'; source = '/missing.js?session=private-query#private-fragment' },
            @{ type = 'error'; source = '/main.js'; message = 'syntax error'; stack = @('at http://localhost:1234/main.js?session=private-query#private-fragment') }
        ) }
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $fixture
    $start = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
    $start.UseShellExecute = $false
    foreach ($argument in @('-NoProfile','-NonInteractive','-File',$childScript,$fixture,$report)) { $start.ArgumentList.Add($argument) }
    $child = [Diagnostics.Process]::Start($start)
    try {
        $child.WaitForExit()
        Assert-SmokeContract ($child.ExitCode -eq 17) 'Failure fixture did not exit unsuccessfully.'
        $failed = $false
        $captured = & {
            try { Assert-WindowsWorkbenchReport -ExitCode $child.ExitCode -Report $report }
            catch { $script:observedFailure = $_.Exception.Message; Write-Output ('Rejected smoke: ' + $_.Exception.Message) }
        } 6>&1
        $text = ($captured | ForEach-Object { $_.ToString() }) -join "`n"
        Assert-SmokeContract ($observedFailure -like '*loading_workbench*') 'Failure report was not parsed before rejecting its process exit.'
        foreach ($expected in @('loading_workbench', 'module-load', '/missing.js', 'syntax error')) {
            Assert-SmokeContract ($text.Contains($expected)) "Missing safe smoke evidence: $expected"
        }
        foreach ($private in @('private-token','private-fragment','private-query','private-entry','private-launch','private-page-body')) {
            Assert-SmokeContract (-not $text.Contains($private)) "Private smoke field leaked: $private"
        }
    } finally { $child.Dispose() }
    [IO.File]::WriteAllText($report, '{"success":true,"nativeBridgeReady":true}')
    Assert-WindowsWorkbenchReport -ExitCode 0 -Report $report
    $rejected = $false
    try { Assert-WindowsWorkbenchReport -ExitCode 17 -Report $report } catch { $rejected = $true }
    Assert-SmokeContract $rejected 'Nonzero child exit was accepted because its report said success.'
    Write-Output 'PASS: RUNNER_TEMP/local selection, real failed child with existing diagnostic, safe evidence logging, and success/exit contract.'
} finally {
    $env:RUNNER_TEMP = $savedRunnerTemp
    Remove-Item -LiteralPath $directory -Recurse
}
