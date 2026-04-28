# Stops and removes the BlueFlameIngest Windows service.
# Run from an elevated PowerShell prompt.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$ServiceName = "BlueFlameIngest"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Service '$ServiceName' is not installed." -ForegroundColor Yellow
    return
}

if ($existing.Status -ne "Stopped") {
    Write-Host "Stopping service ..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force
}

Write-Host "Removing service ..." -ForegroundColor Yellow
sc.exe delete $ServiceName | Out-Null

Write-Host "Done." -ForegroundColor Green
