param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root '.tools'
$Downloads = Join-Path $Tools 'downloads'

function Find-Python {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        try {
            $p = & $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0 -and $p -and (Test-Path ([string]$p))) { return [string]$p }
        } catch { }
    }
    $candidates = @((Join-Path $Tools 'python312\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        'C:\Python312\python.exe', 'C:\Program Files\Python312\python.exe')
    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notlike '*WindowsApps*') { $candidates += $command.Source }
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            try {
                $v = & $p -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sep=chr(46))' 2>$null
                if ($LASTEXITCODE -eq 0 -and $v -eq '3.12') { return $p }
            } catch { }
        }
    }
    return $null
}

function Find-Git {
    $command = Get-Command git.exe -ErrorAction SilentlyContinue
    $candidates = @((Join-Path $Tools 'git\cmd\git.exe'),
        (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'))
    if ($command) { $candidates = @($command.Source) + $candidates }
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            try { $null = & $p --version; if ($LASTEXITCODE -eq 0) { return $p } } catch { }
        }
    }
    return $null
}

function Find-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    $candidates = @()
    if ($command) { $candidates += $command.Source }
    $candidates += Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path (Join-Path $Tools 'node')) {
        $candidates += @(Get-ChildItem (Join-Path $Tools 'node') -Filter node.exe -Recurse | ForEach-Object { $_.FullName })
    }
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            try {
                $v = ([string](& $p --version)).Trim().TrimStart('v')
                if ($LASTEXITCODE -eq 0 -and ([version]$v).Major -eq 24 -and ([version]$v) -ge [version]'24.15.0' -and
                    (Test-Path (Join-Path (Split-Path $p) 'npm.cmd'))) { return $p }
            } catch { }
        }
    }
    return $null
}

function Download-File($Url, $Destination) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

function Install-SignedExe($File, $Arguments) {
    $signature = Get-AuthenticodeSignature -FilePath $File
    if ($signature.Status -ne 'Valid') { throw "Installer signature verification failed: $File ($($signature.Status))" }
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) { throw "Installer exited with code $($process.ExitCode): $File" }
}

try {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
        throw 'This bootstrap currently supports x64 Windows only.'
    }
    $Python = Find-Python
    $Git = Find-Git
    $Node = Find-Node
    Write-Host "Python 3.12: $(if ($Python) { $Python } else { 'MISSING' })"
    Write-Host "Git: $(if ($Git) { $Git } else { 'MISSING' })"
    Write-Host "Node 24.15+ (24.x) with npm: $(if ($Node) { $Node } else { 'MISSING or incompatible version' })"
    if ($CheckOnly) { exit 0 }
    New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
    if (-not $Python) {
        $installer = Join-Path $Downloads 'python-3.12.10-amd64.exe'
        Download-File 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' $installer
        $target = Join-Path $Tools 'python312'
        Install-SignedExe $installer @('/quiet', 'InstallAllUsers=0', 'PrependPath=0', 'Include_launcher=0',
            'Include_test=0', "TargetDir=`"$target`"")
        $Python = Find-Python
        if (-not $Python) { throw 'Python installer finished but Python 3.12 was not detected.' }
    }
    if (-not $Git) {
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest'
        $asset = @($release.assets | Where-Object { $_.name -match '^Git-[0-9].*-64-bit\.exe$' })
        if ($asset.Count -ne 1) { throw 'Could not unambiguously locate the official Git x64 installer.' }
        $installer = Join-Path $Downloads 'git-x64-installer.exe'
        Download-File $asset[0].browser_download_url $installer
        $target = Join-Path $Tools 'git'
        Install-SignedExe $installer @('/CURRENTUSER', '/VERYSILENT', '/NORESTART', '/SP-', "/DIR=`"$target`"")
        $Git = Find-Git
        if (-not $Git) { throw 'Git installer finished but Git was not detected.' }
    }
    if (-not $Node) {
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
        $release = $index | Where-Object { $_.version -match '^v24\.[0-9]+\.[0-9]+$' -and
            ([version]$_.version.Substring(1)) -ge [version]'24.15.0' } |
            Sort-Object { [version]$_.version.Substring(1) } -Descending | Select-Object -First 1
        if (-not $release) { throw 'No compatible Node 24 release found.' }
        $name = "node-$($release.version)-win-x64.zip"
        $base = "https://nodejs.org/dist/$($release.version)"
        $archive = Join-Path $Downloads $name
        Download-File "$base/$name" $archive
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
        $match = [regex]::Match($sums, '(?m)^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($name) + '\r?$')
        if (-not $match.Success -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) {
            throw 'Node archive checksum verification failed.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $Tools 'node') -Force
        $Node = Find-Node
        if (-not $Node) { throw 'Node extracted but compatible Node/npm was not detected.' }
    }
    # Only this process and child processes use the selected tools on PATH.
    $env:PATH = "$(Split-Path $Python);$(Split-Path $Git);$(Split-Path $Node);$env:PATH"
    Write-Host 'Prerequisites ready. Setting up the project virtual environment and headless engine...'
    & $Python (Join-Path $PSScriptRoot 'setup_windows.py')
    if ($LASTEXITCODE -ne 0) { throw "Project setup exited with code $LASTEXITCODE" }
} catch {
    Write-Error $_
    exit 1
}
