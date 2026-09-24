# Launcher for M-Squad Student Placement & Analytics Dashboard
$htmlPath = Join-Path $PSScriptRoot "index.html"
Write-Host "Opening M-Squad Student Placement Dashboard..." -ForegroundColor Cyan
Start-Process $htmlPath
Write-Host "Dashboard opened in your default browser: $htmlPath" -ForegroundColor Green
