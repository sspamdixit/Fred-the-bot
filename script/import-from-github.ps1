<#
.SYNOPSIS
  Clone or update sspamdixit/bubbl-manager with an optional GitHub PAT (entered as a secret).

.DESCRIPTION
  Prompts for a Personal Access Token using masked input. For public repos you can leave it blank.
  Never prints the token. Uses HTTPS; PAT is only held in memory for the git operation.

.PARAMETER TargetDir
  Folder to clone into, or existing repo to update. Default: parent of this script (project root).

.PARAMETER Branch
  Branch to checkout (default: main).

.PARAMETER InPlace
  If the folder exists, has files, and has no .git, initialize git and reset to match origin (destructive).

.PARAMETER InPlaceConfirm
  Required with -InPlace (must be exactly YES) to confirm overwriting local files.
#>
[CmdletBinding()]
param(
  [string]$TargetDir = (Split-Path $PSScriptRoot -Parent),
  [string]$Branch = "main",
  [switch]$InPlace,
  [string]$InPlaceConfirm = ""
)

$ErrorActionPreference = "Stop"
$repoPath = "sspamdixit/bubbl-manager"
$publicUrl = "https://github.com/$repoPath.git"

function Get-PatPlain {
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) { return $env:GITHUB_TOKEN.Trim() }
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PAT)) { return $env:GITHUB_PAT.Trim() }
  if ($PSVersionTable.PSVersion.Major -ge 7) {
    $p = Read-Host "GitHub PAT (optional for public repos; press Enter to skip)" -MaskInput
    return $p
  }
  Write-Host "GitHub PAT (optional for public repos; input is hidden; press Enter to skip)"
  $sec = Read-Host -AsSecureString
  if ($null -eq $sec -or $sec.Length -eq 0) { return "" }
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  }
  finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Invoke-Git {
  param([string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is not installed or not on PATH. Install Git for Windows, then re-run."
  exit 1
}

$pat = Get-PatPlain
try {
  $cloneUrl = if ([string]::IsNullOrWhiteSpace($pat)) {
    Write-Host "Using public clone (no PAT)."
    $publicUrl
  }
  else {
    # x-access-token is the recommended username for HTTPS + PAT on github.com
    "https://x-access-token:$pat@github.com/$repoPath.git"
  }

  if (Test-Path (Join-Path $TargetDir ".git")) {
    Write-Host "Updating existing repo at $TargetDir"
    Push-Location $TargetDir
    try {
      Invoke-Git @("remote", "set-url", "origin", $cloneUrl)
      Invoke-Git @("fetch", "origin", $Branch)
      Invoke-Git @("checkout", $Branch)
      Invoke-Git @("pull", "--ff-only", "origin", $Branch)
    }
    finally {
      Pop-Location
    }
    # Restore remote to clean URL without embedded token (avoid storing PAT in .git/config)
    Invoke-Git @("-C", $TargetDir, "remote", "set-url", "origin", $publicUrl)
  }
  elseif ($InPlace -and (Test-Path $TargetDir) -and -not (Test-Path (Join-Path $TargetDir ".git"))) {
    $itemCount = @(Get-ChildItem -LiteralPath $TargetDir -Force -ErrorAction SilentlyContinue).Count
    if ($itemCount -eq 0) {
      Write-Error "-InPlace requires a non-empty folder. Use clone into an empty path instead."
      exit 1
    }
    if ($InPlaceConfirm -ne "YES") {
      Write-Error "-InPlace will DELETE local uncommitted changes and match GitHub. Re-run with -InPlaceConfirm YES"
      exit 1
    }
    Write-Host "Initializing git in $TargetDir and resetting to origin/$Branch (destructive)."
    Invoke-Git @("-C", $TargetDir, "init")
    Invoke-Git @("-C", $TargetDir, "remote", "add", "origin", $cloneUrl)
    Invoke-Git @("-C", $TargetDir, "fetch", "origin", $Branch)
    Invoke-Git @("-C", $TargetDir, "reset", "--hard", "origin/$Branch")
    Invoke-Git @("-C", $TargetDir, "remote", "set-url", "origin", $publicUrl)
  }
  else {
    $parent = Split-Path $TargetDir -Parent
    if ($parent -and -not (Test-Path $parent)) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $hasFiles = (Test-Path $TargetDir) -and (@(Get-ChildItem -LiteralPath $TargetDir -Force -ErrorAction SilentlyContinue).Count -gt 0)
    if ($hasFiles) {
      Write-Error "Target '$TargetDir' exists and is not empty, and has no .git. Use -InPlace -InPlaceConfirm YES, or an empty folder."
      exit 1
    }
    if (-not (Test-Path $TargetDir)) {
      New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }
    Write-Host "Cloning into $TargetDir"
    Invoke-Git @("clone", "--branch", $Branch, "--single-branch", $cloneUrl, $TargetDir)
    Invoke-Git @("-C", $TargetDir, "remote", "set-url", "origin", $publicUrl)
  }
}
finally {
  Remove-Variable -Name pat -ErrorAction SilentlyContinue
}

Write-Host "Done. Remote 'origin' is set to the public HTTPS URL (no token stored)."
