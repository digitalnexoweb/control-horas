# Deploy completo a Cloudflare Workers.
# Requiere sesion de Wrangler o CLOUDFLARE_API_TOKEN.

$ErrorActionPreference = "Stop"

$workerUrl = "https://control-horas.digitalnexoweb.workers.dev"
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Import-DotEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()

    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $parts = $line.Split("=", 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")

    if ($name -and -not [Environment]::GetEnvironmentVariable($name)) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Require-CloudflareAuth {
  if ([Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN")) {
    return
  }

  $whoamiOutput = npx wrangler whoami 2>&1
  $whoamiText = ($whoamiOutput | Out-String)

  if ($LASTEXITCODE -ne 0 -or $whoamiText -match "not authenticated") {
    throw "Falta autenticacion de Cloudflare. Ejecuta 'npx wrangler login' o define CLOUDFLARE_API_TOKEN para esta terminal."
  }

  Write-Host $whoamiText
}

function Set-WorkerSecretFromEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) {
    throw "Falta $Name en variables de entorno o backend/.env"
  }

  $value | npx wrangler secret put $Name
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo cargar $Name en Cloudflare"
  }
}

Push-Location $rootDir

try {
  Import-DotEnv -Path (Join-Path $rootDir "backend/.env")
  Require-CloudflareAuth

  Write-Host "Cargando secrets requeridos..." -ForegroundColor Cyan
  Set-WorkerSecretFromEnv -Name "SUPABASE_SERVICE_ROLE_KEY"
  Set-WorkerSecretFromEnv -Name "SMTP_PASS"

  Write-Host "Desplegando Worker..." -ForegroundColor Cyan
  npx wrangler deploy

  if ($LASTEXITCODE -ne 0) {
    throw "Fallo el deploy de Cloudflare"
  }

  Write-Host "Verificando API..." -ForegroundColor Cyan
  $health = Invoke-WebRequest -Uri "$workerUrl/api/health" -UseBasicParsing

  if ($health.StatusCode -ne 200 -or $health.Content -notmatch '"ok"\s*:\s*true') {
    throw "La API no respondio correctamente en /api/health"
  }

  Write-Host "Cloudflare quedo funcionando: $workerUrl" -ForegroundColor Green
} finally {
  Pop-Location
}
