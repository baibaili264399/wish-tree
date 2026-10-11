# 无头渲染：把姻缘树的不同生长阶段截成 PNG，用于逐轮比对画面
# 用法：pwsh -File tools/render.ps1 -Tag v1 -Stages 0,0.45,1
param(
  [int]$Size = 1000,
  [string]$Tag = "v",
  [string[]]$Stages = @("0", "0.45", "1"),
  [int]$Budget = 14000
)
$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $PSScriptRoot
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "C:\Program Files\Google\Chrome\Application\chrome.exe" }
$dir = Join-Path $base "shots"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$url = "file:///" + ($base -replace '\\', '/') + "/index.html?still=1"
foreach ($s in $Stages) {
  $out = Join-Path $dir ("{0}{1}.png" -f $Tag, ($s -replace '\.', '_'))
  Remove-Item $out -ErrorAction SilentlyContinue
  Start-Process -FilePath $edge -ArgumentList @(
    "--headless=new", "--hide-scrollbars",
    "--window-size=$Size,$Size", "--virtual-time-budget=$Budget",
    "--screenshot=$out", "$url&grow=$s"
  ) -Wait -NoNewWindow
  if (Test-Path $out) { Write-Host ("{0} -> {1:N0} bytes" -f (Split-Path -Leaf $out), (Get-Item $out).Length) }
  else { Write-Host ("{0} FAILED" -f (Split-Path -Leaf $out)) }
}
