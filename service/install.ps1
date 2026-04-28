# Builds and installs BlueFlameIngest as a Windows service.
# Run from an elevated PowerShell prompt.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$ServiceName = "BlueFlameIngest"
$DisplayName = "BlueFlame Ingest Service"
$Description = "Watches a folder for company-list files and pushes them to the BlueFlame web app via localhost WebSocket."

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishDir = Join-Path $ScriptDir "publish"
$ExePath    = Join-Path $PublishDir "BlueFlameIngest.exe"
$ConfigPath = Join-Path $ScriptDir "config.json"
$ExamplePath = Join-Path $ScriptDir "config.example.json"

# Bootstrap config.json from the template on first run. The real config is
# gitignored so the cloud.ingestToken never ends up in version control.
if (-not (Test-Path $ConfigPath)) {
    if (-not (Test-Path $ExamplePath)) { throw "Neither config.json nor config.example.json was found." }
    Copy-Item $ExamplePath $ConfigPath
    Write-Host "Created config.json from config.example.json — edit it to set cloud.ingestToken before using cloud mode." -ForegroundColor Yellow
}

Write-Host "Publishing self-contained single-file build to $PublishDir ..." -ForegroundColor Cyan
dotnet publish (Join-Path $ScriptDir "BlueFlameIngest.csproj") `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -o $PublishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

# Stop + delete any prior install
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping existing service ..." -ForegroundColor Yellow
    if ($existing.Status -ne "Stopped") { Stop-Service -Name $ServiceName -Force }
    Write-Host "Removing existing service ..." -ForegroundColor Yellow
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host "Installing service ..." -ForegroundColor Cyan
sc.exe create $ServiceName binPath= "`"$ExePath`"" start= auto DisplayName= "`"$DisplayName`"" | Out-Null
sc.exe description $ServiceName "$Description" | Out-Null
sc.exe failure $ServiceName reset= 60 actions= restart/5000/restart/10000/restart/30000 | Out-Null

Write-Host "Starting service ..." -ForegroundColor Cyan
Start-Service -Name $ServiceName

Write-Host ""
Write-Host "Done. Service '$ServiceName' is running." -ForegroundColor Green
Write-Host "Health check: curl http://127.0.0.1:7321/health"
Write-Host "Edit config:  $PublishDir\config.json   (then: Restart-Service $ServiceName)"
