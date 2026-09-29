#Requires -Version 5.1
<#
.SYNOPSIS
    Tauri 项目构建产物清理脚本
.DESCRIPTION
    扫描 Tauri 项目中 debug/release 构建产生的冗余文件，
    交互式选择清理目标，释放磁盘空间。
.NOTES
    作者: Qwen | 适用于 Windows PowerShell 5.1+ / PowerShell 7+
#>

[CmdletBinding()]
param(
    # 项目根目录，默认为当前目录
    [string]$ProjectPath = (Get-Location).Path,
    # 跳过交互确认，直接清理所有推荐项
    [switch]$Force
)

# ===================== 工具函数 =====================

function Get-FolderSizeMB {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    try {
        $size = (Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue |
                 Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        return [math]::Round($size / 1MB, 2)
    } catch {
        return 0
    }
}

function Format-Size {
    param([double]$SizeMB)
    if ($SizeMB -ge 1024) {
        return "{0:N2} GB" -f ($SizeMB / 1024)
    }
    return "{0:N2} MB" -f $SizeMB
}

function Remove-FolderSafe {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path $Path)) {
        Write-Host "  [跳过] $Label - 目录不存在" -ForegroundColor DarkGray
        return 0
    }
    $sizeBefore = Get-FolderSizeMB $Path
    try {
        Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
        Write-Host "  [已清理] $Label - 释放 $(Format-Size $sizeBefore)" -ForegroundColor Green
        return $sizeBefore
    } catch {
        Write-Host "  [失败] $Label - $($_.Exception.Message)" -ForegroundColor Red
        return 0
    }
}

# ===================== 定义清理目标 =====================

$cleanTargets = @(
    @{
        Id       = 1
        Label    = "Rust Debug 构建产物"
        Path     = Join-Path $ProjectPath "src-tauri\target\debug"
        Desc     = "cargo build 产生的调试二进制、依赖、增量缓存等（通常最大）"
        Recommend = $true
    },
    @{
        Id       = 2
        Label    = "Rust Release 构建产物"
        Path     = Join-Path $ProjectPath "src-tauri\target\release"
        Desc     = "cargo build --release 产生的发布版二进制和依赖"
        Recommend = $false
    },
    @{
        Id       = 3
        Label    = "Rust 增量编译缓存"
        Path     = Join-Path $ProjectPath "src-tauri\target\debug\incremental"
        Desc     = "增量编译中间文件，删除后下次编译稍慢但完全安全"
        Recommend = $true
    },
    @{
        Id       = 4
        Label    = "Rust 构建脚本产物 (build/)"
        Path     = Join-Path $ProjectPath "src-tauri\target\debug\build"
        Desc     = "build.rs 脚本生成的中间文件"
        Recommend = $true
    },
    @{
        Id       = 5
        Label    = "Rust 指纹缓存 (.fingerprint/)"
        Path     = Join-Path $ProjectPath "src-tauri\target\debug\.fingerprint"
        Desc     = "Cargo 用于判断是否需要重新编译的指纹文件"
        Recommend = $true
    },
    @{
        Id       = 6
        Label    = "前端构建产物 (dist/)"
        Path     = Join-Path $ProjectPath "dist"
        Desc     = "Vite/Webpack 等打包生成的前端静态文件"
        Recommend = $false
    },
    @{
        Id       = 7
        Label    = "前端构建产物 (build/)"
        Path     = Join-Path $ProjectPath "build"
        Desc     = "部分框架（如 React CRA）的打包输出目录"
        Recommend = $false
    },
    @{
        Id       = 8
        Label    = "Tauri 生成代码 (gen/)"
        Path     = Join-Path $ProjectPath "src-tauri\gen"
        Desc     = "Tauri CLI 自动生成的平台绑定代码，可重新生成"
        Recommend = $false
    },
    @{
        Id       = 9
        Label    = "node_modules/"
        Path     = Join-Path $ProjectPath "node_modules"
        Desc     = "前端 npm 依赖（删除后需重新 npm install）"
        Recommend = $false
    },
    @{
        Id       = 10
        Label    = "整个 Rust target/ 目录"
        Path     = Join-Path $ProjectPath "src-tauri\target"
        Desc     = "⚠️ 核弹级清理：删除所有 Rust 编译产物，下次编译需完整重建"
        Recommend = $false
    }
)

# ===================== 主逻辑 =====================

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       Tauri 项目构建产物清理工具                 ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "项目路径: $ProjectPath" -ForegroundColor Yellow
Write-Host ""

# 检查是否为 Tauri 项目
$tauriConf = Join-Path $ProjectPath "src-tauri\tauri.conf.json"
$tauriConfJson5 = Join-Path $ProjectPath "src-tauri\tauri.conf.json5"
$cargoToml = Join-Path $ProjectPath "src-tauri\Cargo.toml"

if (-not (Test-Path $tauriConf) -and -not (Test-Path $tauriConfJson5) -and -not (Test-Path $cargoToml)) {
    Write-Host "⚠️  未检测到 Tauri 项目结构（缺少 src-tauri/tauri.conf.json 或 Cargo.toml）" -ForegroundColor Yellow
    $continue = Read-Host "是否仍要继续扫描？(y/N)"
    if ($continue -notmatch '^[yY]') { exit 0 }
}

# 扫描并显示各目录大小
Write-Host "正在扫描各目录大小..." -ForegroundColor DarkGray
Write-Host ""
Write-Host ("{0,-4} {1,-35} {2,12}  {3}" -f "编号", "清理目标", "大小", "说明") -ForegroundColor White
Write-Host ("{0,-4} {1,-35} {2,12}  {3}" -f "----", "-----------------------------------", "------------", "----") -ForegroundColor DarkGray

$totalScanned = 0
foreach ($target in $cleanTargets) {
    $sizeMB = Get-FolderSizeMB $target.Path
    $totalScanned += $sizeMB
    $sizeStr = Format-Size $sizeMB
    $recMark = if ($target.Recommend) { " ★" } else { "" }
    $color = if ($sizeMB -gt 100) { "Red" } elseif ($sizeMB -gt 10) { "Yellow" } else { "Gray" }
    if ($sizeMB -eq 0) { $color = "DarkGray" }

    Write-Host ("{0,-4} " -f $target.Id) -NoNewline -ForegroundColor White
    Write-Host ("{0,-35}" -f "$($target.Label)$recMark") -NoNewline -ForegroundColor $color
    Write-Host ("{0,12}" -f $sizeStr) -NoNewline -ForegroundColor $color
    Write-Host ("  {0}" -f $target.Desc) -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "可清理总计: $(Format-Size $totalScanned)" -ForegroundColor Cyan
Write-Host "（★ = 推荐清理项，删除后不影响项目源码，下次构建自动重建）" -ForegroundColor DarkGray
Write-Host ""

if ($totalScanned -eq 0) {
    Write-Host "✅ 没有发现需要清理的构建产物。" -ForegroundColor Green
    exit 0
}

# 选择清理项
if ($Force) {
    $selected = $cleanTargets | Where-Object { $_.Recommend } | ForEach-Object { $_.Id }
    Write-Host "[-Force] 自动选择所有推荐项: $($selected -join ', ')" -ForegroundColor Yellow
} else {
    Write-Host "请输入要清理的编号（多个用逗号分隔，输入 'all' 全部清理，'rec' 仅推荐项，直接回车退出）:" -ForegroundColor White
    $input = Read-Host "> "

    if ([string]::IsNullOrWhiteSpace($input)) {
        Write-Host "已取消。" -ForegroundColor DarkGray
        exit 0
    }

    if ($input.Trim().ToLower() -eq 'all') {
        $selected = $cleanTargets | ForEach-Object { $_.Id }
    } elseif ($input.Trim().ToLower() -eq 'rec') {
        $selected = $cleanTargets | Where-Object { $_.Recommend } | ForEach-Object { $_.Id }
    } else {
        $selected = $input -split '[,\s]+' | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le $cleanTargets.Count }
    }
}

if ($selected.Count -eq 0) {
    Write-Host "未选择任何有效项。" -ForegroundColor DarkGray
    exit 0
}

# 如果选了 "整个 target/" (10)，自动排除其子项 (1-5) 避免重复
if ($selected -contains 10) {
    $selected = $selected | Where-Object { $_ -notin @(1,2,3,4,5) }
    $selected += 10
    $selected = $selected | Sort-Object -Unique
}

# 二次确认
$selectedTargets = $cleanTargets | Where-Object { $_.Id -in $selected }
Write-Host ""
Write-Host "即将清理以下项目:" -ForegroundColor Yellow
foreach ($t in $selectedTargets) {
    $sizeMB = Get-FolderSizeMB $t.Path
    Write-Host "  - $($t.Label) ($(Format-Size $sizeMB))" -ForegroundColor White
}
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "确认执行清理？(y/N)"
    if ($confirm -notmatch '^[yY]') {
        Write-Host "已取消。" -ForegroundColor DarkGray
        exit 0
    }
}

# 执行清理
Write-Host ""
Write-Host "开始清理..." -ForegroundColor Cyan
$totalFreed = 0

foreach ($t in $selectedTargets) {
    $freed = Remove-FolderSafe -Path $t.Path -Label $t.Label
    $totalFreed += $freed
}

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ 清理完成！共释放: $(Format-Size $totalFreed)" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示: 下次运行 'cargo tauri dev' 或 'cargo tauri build' 时会自动重建所需文件。" -ForegroundColor DarkGray