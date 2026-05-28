# Script para cargar secrets en Cloudflare Workers.
# Ejecutar despues de iniciar sesion con Wrangler o de definir CLOUDFLARE_API_TOKEN.

$ErrorActionPreference = "Stop"
$workerName = "control-horas"

function Read-SecretValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $existingValue = [Environment]::GetEnvironmentVariable($Name)
  if ($existingValue) {
    return $existingValue
  }

  $secureValue = Read-Host "Ingresar $Name" -AsSecureString
  $secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)

  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
  }
}

function Set-WorkerSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $secretValue = Read-SecretValue -Name $Name
  $secretValue | npx wrangler secret put $Name --name $workerName
  Write-Host "OK: $Name" -ForegroundColor Green
}

Write-Host "Cargando secrets en Worker: $workerName" -ForegroundColor Cyan

Set-WorkerSecret -Name "SUPABASE_SERVICE_ROLE_KEY"
Set-WorkerSecret -Name "SMTP_PASS"

Write-Host ""
Write-Host "Todos los secrets cargados correctamente." -ForegroundColor Green
Write-Host "El Worker va a redesplegar en segundos con la DB conectada." -ForegroundColor Cyan

Write-Host ""
Write-Host "Buscando URL del Worker..." -ForegroundColor Yellow
npx wrangler deployments list --name $workerName 2>&1 | Select-Object -First 5
