@echo off
setlocal
cd /d "%~dp0"

if exist ".env" (
  echo [REA] Loading .env
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if not defined REA_HOST set "REA_HOST=127.0.0.1"
if not defined REA_PORT set "REA_PORT=18787"

set "PYTHON=.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo [REA] Creating local Python environment...
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)

"%PYTHON%" -c "import fastapi, uvicorn, faster_whisper, yt_dlp, multipart" >nul 2>nul
if errorlevel 1 (
  echo [REA] Installing Whisper service dependencies...
  "%PYTHON%" -m pip install --upgrade pip
  if errorlevel 1 goto :error
  "%PYTHON%" -m pip install -r server\requirements.txt
  if errorlevel 1 goto :error
)

echo [REA] Starting http://%REA_HOST%:%REA_PORT%
"%PYTHON%" server\rea_server.py
goto :eof

:error
echo.
echo [REA] Could not start. See the error above.
pause
exit /b 1
