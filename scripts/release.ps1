$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
$zip = $null
$stream = $null
$created = $false
$output = $null
try {
    if (!(Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js >= 20 is required.'
    }
    & node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js >= 20 is required.' }
    $manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = [string]$manifest.version
    if ($version -notmatch '^\d+(\.\d+){0,3}$') { throw 'Invalid manifest version.' }
    $parts = @($version.Split('.') | ForEach-Object { [int]$_ })
    if (@($parts | Where-Object { $_ -gt 65535 }).Count -gt 0 -or ($parts | Measure-Object -Sum).Sum -eq 0) {
        throw 'Manifest version components must be 0..65535, not all zero.'
    }
    & node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Static checks failed.' }
    Write-Host 'Static checks passed. This project has no automated test suite; browser regression is manual.'

    # Explicit allowlist: no repository metadata, credentials, tests or build tools.
    $files = @((Get-Item -LiteralPath (Join-Path $root 'manifest.json')))
    $source = Get-Item -LiteralPath (Join-Path $root 'src')
    $tree = @(Get-ChildItem -LiteralPath $source.FullName -Recurse -Force)
    foreach ($item in @($source) + $tree) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Symlinks/reparse points are not allowed in release sources: $($item.FullName)"
        }
    }
    $allowed = @('.js', '.mjs', '.html', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.txt', '.md', '.woff', '.woff2')
    foreach ($file in @($tree | Where-Object { !$_.PSIsContainer })) {
        if ($file.Extension.ToLowerInvariant() -notin $allowed) { throw "Unexpected source file: $($file.FullName)" }
        $files += $file
    }
    foreach ($name in @('README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'NOTICE', 'NOTICE.md')) {
        $path = Join-Path $root $name
        if (Test-Path -LiteralPath $path -PathType Leaf) { $files += Get-Item -LiteralPath $path }
    }
    $dist = Join-Path $root 'dist'
    if (!(Test-Path -LiteralPath $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
    if (((Get-Item -LiteralPath $dist).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'dist must not be a symlink.' }
    # Unique output; never delete prior releases or overwrite an existing archive.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $output = Join-Path $dist "netdisk-offline-download-extension-v$version-$stamp.zip"
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew)
    $created = $true
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
    foreach ($file in $files | Sort-Object FullName) {
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Release files must not be symlinks.' }
        $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $zip.Dispose(); $zip = $null
    $stream.Dispose(); $stream = $null
    $archive = [IO.Compression.ZipFile]::OpenRead($output)
    try {
        if (!$archive.GetEntry('manifest.json')) { throw 'Archive has no root manifest.json.' }
        if ($archive.Entries.Count -ne $files.Count) { throw 'Archive entry count mismatch.' }
    } finally { $archive.Dispose() }
    $sha = [Security.Cryptography.SHA256]::Create()
    $hashStream = [IO.File]::OpenRead($output)
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($hashStream)).Replace('-', '').ToLowerInvariant() }
    finally { $hashStream.Dispose(); $sha.Dispose() }
    "$hash  $(Split-Path $output -Leaf)" | Set-Content -LiteralPath "$output.sha256" -Encoding ASCII
    Write-Host "`nRelease archive: $output" -ForegroundColor Green
    Write-Host "SHA256: $hash"
    Write-Host 'Packaging only: no upload, signing or store publication was performed.'
    Write-Warning 'Before public release, verify third-party licenses and run real-browser smoke tests.'
} catch {
    if ($null -ne $zip) { $zip.Dispose(); $zip = $null }
    if ($null -ne $stream) { $stream.Dispose(); $stream = $null }
    # Keep partial output for diagnostics; clearly mark failure rather than delete files.
    if ($created) { Write-Warning "Packaging failed; do not publish this output: $output" }
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
} finally { Pop-Location }
