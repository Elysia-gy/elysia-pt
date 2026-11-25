param(
  [string]$Profile = 'desktop',
  [string]$DshRoot = '',
  [string]$DshHome = '',
  [switch]$DryRun,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$Repo = 'Elysia-gy/elysia-pt'
$PackageName = 'dsh-elysia'

function Write-Step([string]$Message) {
  Write-Host "[elysia] $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
  throw "[elysia] $Message"
}

# 1. 找到插件源码：优先用脚本所在目录；从 URL 直接运行时下载 zip。
$source = $PSScriptRoot
if (-not $source -or -not (Test-Path (Join-Path $source 'package.json'))) {
  Write-Step '下载 GitHub 仓库...'
  $zip = Join-Path $env:TEMP 'elysia-pt.zip'
  $extract = Join-Path $env:TEMP ('elysia-pt-' + [Guid]::NewGuid().ToString('N'))
  Invoke-WebRequest "https://api.github.com/repos/$Repo/zipball/main" -OutFile $zip -Headers @{ 'User-Agent' = 'dsh-elysia-installer' } -TimeoutSec 300
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $source = Get-ChildItem $extract -Directory | Select-Object -First 1 -ExpandProperty FullName
  if (-not $source) { Fail '下载的压缩包是空的。' }
}

$manifest = Get-Content (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne $PackageName) {
  Fail "源码目录不是 $PackageName（读到 $($manifest.name)）。"
}

# 2. DSH 目录与 profile。
if (-not $DshHome) {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME } else { $DshHome = Join-Path $HOME '.dsh' }
}
if (-not (Test-Path $DshHome)) { Fail "找不到 DSH 目录：$DshHome" }

$profileDir = Join-Path $DshHome "profiles\$Profile"
$profileManifest = Join-Path $profileDir 'package.json'
if (-not (Test-Path $profileManifest)) {
  Fail "找不到 profile：$profileDir（先用 DSH 打开一次桌面版，或换 -Profile web）"
}

# 3. DSH 安装根：用于找自带的 node / pnpm。
if (-not $DshRoot) {
  $proc = Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc -and $proc.Path) {
    $DshRoot = Split-Path -Parent $proc.Path
  } else {
    $candidates = @(
      (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
      (Join-Path $env:LOCALAPPDATA 'DeepSeek Harness'),
      (Join-Path $env:ProgramFiles 'DeepSeek Harness'),
      'E:\DHS'
    )
    foreach ($candidate in $candidates) {
      if (Test-Path (Join-Path $candidate 'DeepSeek Harness.exe')) { $DshRoot = $candidate; break }
    }
  }
}

$node = $null
$pnpmCjs = $null
$pnpmCommand = $null
if ($DshRoot) {
  $node = Join-Path $DshRoot 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
  $pnpmCjs = Join-Path $DshRoot 'resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
}
if (-not (Test-Path $node) -or -not (Test-Path $pnpmCjs)) {
  $node = $null
  $pnpmCjs = $null
  $pnpmCommand = (Get-Command pnpm -ErrorAction SilentlyContinue | Select-Object -First 1).Source
}
if (-not $pnpmCommand -and -not $pnpmCjs) {
  Fail '找不到 pnpm：DSH 安装目录不完整，或系统 PATH 里没有 pnpm。'
}

# 4. 拷贝到持久目录，避免从下载缓存直接 link。
$dest = Join-Path $DshHome 'plugins\dsh-elysia'
Write-Step "插件目录：$dest"
Write-Step "profile：$profileDir"
if (-not $DryRun) {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($item in @('lib', 'assets', 'src', 'package.json', 'README.md', 'LICENSE', 'NOTICE.md')) {
    $from = Join-Path $source $item
    if (Test-Path $from) {
      Copy-Item -LiteralPath $from -Destination $dest -Recurse -Force
    }
  }
}

# 5. 把本地目录加进 profile 依赖。
$pnpmArgs = @('add', '--config.confirmModulesPurge=false')
if (Test-Path (Join-Path $profileDir 'pnpm-workspace.yaml')) { $pnpmArgs += '-w' }
$pnpmArgs += "file:$dest"
Write-Step "pnpm $($pnpmArgs -join ' ')"
if (-not $DryRun) {
  Push-Location $profileDir
  try {
    if ($pnpmCjs) {
      & $node $pnpmCjs @pnpmArgs
    } else {
      & $pnpmCommand @pnpmArgs
    }
    if ($LASTEXITCODE -ne 0) { Fail "pnpm 安装失败，退出码 $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

# 6. 在 cordis.patch.yml 里插入插件；已经存在就跳过。
$patch = Join-Path $profileDir 'cordis.patch.yml'
if (-not $DryRun) {
  if (-not (Test-Path $patch)) { New-Item -ItemType File -Path $patch | Out-Null }
  $patchText = Get-Content $patch -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if (-not $patchText -or $patchText -notmatch 'name:\s*dsh-elysia') {
    $block = @'

# dsh-elysia：爱莉希雅陪伴插件（由 install.ps1 写入；数据在 <dshHome>/dsh-elysia/state.json）
- insert:
    - id: elysia
      name: dsh-elysia
      config:
        enabled: true
        desktopPet: true
'@
    Add-Content -LiteralPath $patch -Value $block -Encoding UTF8
    Write-Step '已写入 cordis.patch.yml'
  } else {
    Write-Step 'cordis.patch.yml 已有 dsh-elysia，跳过'
  }
}

# 7. 可选重启 DSH。
if ($Restart -and -not $DryRun) {
  if ($DshRoot) {
    $exe = Join-Path $DshRoot 'DeepSeek Harness.exe'
    if (Test-Path $exe) {
      Write-Step '重启 DSH...'
      Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force
      Start-Sleep -Seconds 3
      Start-Process $exe
    }
  }
}

Write-Step '完成。'
if (-not $Restart) {
  Write-Step '请手动重启 DSH 桌面应用，插件才会加载。'
}
Write-Step '装好后在设置页应该能看到「爱莉希雅」卡片；桌宠默认会启动独立桌面版。'
