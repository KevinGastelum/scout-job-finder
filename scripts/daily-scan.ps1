<#
.SYNOPSIS
Runs one unattended Scout scan followed by a market-intel refresh.

.DESCRIPTION
Entry point for the scheduled task registered by register-daily-scan.ps1. Everything it needs
is derived from the script's own location, because Task Scheduler starts a process with neither
the repo as its working directory nor a login shell's PATH.
#>
[CmdletBinding()]
param(
    [string] $LogPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $LogPath) { $LogPath = Join-Path $repoRoot '.tmp\daily-scan.log' }

$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-Log {
    param([string] $Message)
    Add-Content -Path $LogPath -Encoding utf8 -Value "$((Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK'))  $Message"
}

# Task Scheduler does not source the user's shell profile, so bun is not on PATH. Prefer a
# resolved command when one exists so a non-default install location still works.
$bunCommand = Get-Command bun -ErrorAction SilentlyContinue
if ($bunCommand) { $bun = $bunCommand.Source } else { $bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
if (-not (Test-Path $bun)) {
    Write-Log "FAIL  bun not found (looked for $bun)"
    exit 1
}

# Start-Process rather than the call operator: PowerShell 5.1 turns a native command's stderr
# into NativeCommandError records when the stream is redirected inline, which $ErrorActionPreference
# would then make fatal. The scan writes progress to stderr, so that would kill every run.
function Invoke-Step {
    param([string] $Step)

    $outFile = Join-Path $logDir "$Step.out"
    $errFile = Join-Path $logDir "$Step.err"
    Write-Log "START $Step"

    $proc = Start-Process -FilePath $bun -ArgumentList 'run', $Step `
        -WorkingDirectory $repoRoot -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile

    foreach ($file in @($outFile, $errFile)) {
        if (Test-Path $file) {
            Get-Content $file | Where-Object { $_ -ne '' } | ForEach-Object { Write-Log "  $_" }
            Remove-Item $file -Force
        }
    }

    if ($proc.ExitCode -ne 0) {
        Write-Log "FAIL  $Step exited $($proc.ExitCode)"
        return $false
    }
    Write-Log "OK    $Step"
    return $true
}

# intel runs even when the scan reports source errors: a scan that loses one board still
# collected the rest, and a stale demand report is worse than one built from a partial run.
$scanOk = Invoke-Step 'scan'
$intelOk = Invoke-Step 'intel'

# doctor last, so its verdict describes the state this run left behind. Its non-zero exit
# turns a stalled pipeline (no fresh scan, no profile) into a FAIL line; per-source
# degradation shows up as ! warning lines inside the logged report.
$doctorOk = Invoke-Step 'doctor'

if ($scanOk -and $intelOk -and $doctorOk) { exit 0 }
exit 1
