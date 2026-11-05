Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Starting NutriShield AI Backend on http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    & $venvPython -m uvicorn app:app --host 127.0.0.1 --port 8000
} else {
    python -m uvicorn app:app --host 127.0.0.1 --port 8000
}

