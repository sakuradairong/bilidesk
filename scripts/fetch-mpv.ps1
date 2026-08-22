[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$defaultTag = "2026-08-21-49418246f3"
$defaultAsset = "mpv-dev-lgpl-x86_64-20260821-git-49418246f3.7z"
$defaultSha256 = "317dfd9ee814be76e5f6e20b45efcc07440389a62b55dd85201829b4880510e0"

$overridden = $env:MPV_RELEASE -or $env:MPV_ASSET -or $env:MPV_SHA256
if ($overridden -and (-not $env:MPV_RELEASE -or -not $env:MPV_ASSET -or -not $env:MPV_SHA256)) {
    throw "MPV_RELEASE, MPV_ASSET and MPV_SHA256 must be set together"
}

$tag = if ($overridden) { $env:MPV_RELEASE } else { $defaultTag }
$asset = if ($overridden) { $env:MPV_ASSET } else { $defaultAsset }
$expectedSha256 = if ($overridden) { $env:MPV_SHA256.ToLowerInvariant() } else { $defaultSha256 }
$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root "src-tauri\vendor\mpv"
$dll = Join-Path $destination "libmpv-2.dll"

New-Item -ItemType Directory -Force -Path $destination | Out-Null
if ((Test-Path -LiteralPath $dll) -and -not $Force) {
    Write-Host "already have $dll"
    exit 0
}

$sevenZip = Get-Command 7z, 7zz -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sevenZip) {
    throw "7-Zip is required (install 7z or 7zz)"
}

$url = "https://github.com/zhongfly/mpv-winbuild/releases/download/$tag/$asset"
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "bilidesk-mpv-$([guid]::NewGuid().ToString('N')).7z"

try {
    Write-Host "downloading pinned asset $url"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
    $actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256) {
        throw "libmpv checksum mismatch (expected $expectedSha256, actual $actualSha256)"
    }
    Write-Host "verified sha256:$actualSha256"

    & $sevenZip.Source e -y "-o$destination" $archive libmpv-2.dll | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "7-Zip failed with exit code $LASTEXITCODE"
    }
    Get-Item -LiteralPath $dll | Select-Object FullName, Length, LastWriteTime
}
finally {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}
