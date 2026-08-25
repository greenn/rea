@echo off
setlocal
cd /d "%~dp0"

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

echo [REA] Starting http://127.0.0.1:8787
"%PYTHON%" server\rea_server.py
goto :eof

:error
echo.
echo [REA] Could not start. See the error above.
pause
exit /b 1
