@echo off
setlocal EnableExtensions
title Raphael - Mode DEV (rechargement auto)
cd /d "%~dp0"

set "RAPHAEL_URL=http://127.0.0.1:8010/index.html"
set "RAPHAEL_HEALTH_URL=http://127.0.0.1:8010/api/health"
set "RAPHAEL_PORT=8010"

echo.
echo ============================================
echo   RAPHAEL - MODE DEVELOPPEMENT
echo   Rechargement auto du code (--reload).
echo   Accessible depuis le smartphone (meme WiFi).
echo ============================================
echo.
echo   Sur ce PC          : %RAPHAEL_URL%
set "LAN_IP="
powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notlike '*WSL*' -and $_.InterfaceAlias -notlike '*vEthernet*' } | Select-Object -First 1 -ExpandProperty IPAddress)" > "%TEMP%\raphael_lan_ip.txt" 2>nul
set /p LAN_IP=<"%TEMP%\raphael_lan_ip.txt"
del "%TEMP%\raphael_lan_ip.txt" >nul 2>&1
if defined LAN_IP echo   Sur le smartphone  : http://%LAN_IP%:%RAPHAEL_PORT%/index.html
echo.

REM --- Le serveur tourne deja ? On ouvre juste le jeu. ---
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%RAPHAEL_HEALTH_URL%'; if($r.StatusCode -eq 200){exit 0} } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  echo Un serveur repond deja sur le port %RAPHAEL_PORT%.
  echo Ouverture du jeu... [cette fenetre ne gere pas ce serveur]
  start "" "%RAPHAEL_URL%"
  echo.
  pause
  exit /b 0
)

REM --- Detection de Python ---
where py >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
  goto :CHECK_DEPS
)
where python >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_EXE=python"
  set "PYTHON_ARGS="
  goto :CHECK_DEPS
)

echo ERREUR : Python est introuvable. Installez Python 3 puis relancez.
pause
exit /b 1

:CHECK_DEPS
"%PYTHON_EXE%" %PYTHON_ARGS% -c "import fastapi,uvicorn,itsdangerous,websockets" >nul 2>&1
if errorlevel 1 (
  echo Installation des dependances Nova Flight...
  "%PYTHON_EXE%" %PYTHON_ARGS% -m pip install -r "%~dp0requirements.txt"
  if errorlevel 1 (
    echo ERREUR : installation des dependances impossible.
    pause
    exit /b 1
  )
)

REM --- Verifie que le port est libre ---
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort %RAPHAEL_PORT% -State Listen -ErrorAction SilentlyContinue; if($c){exit 1}else{exit 0}" >nul 2>&1
if errorlevel 1 (
  echo ERREUR : le port %RAPHAEL_PORT% est deja utilise. Fermez l'autre application.
  pause
  exit /b 1
)

REM --- Ouvre le jeu des que le serveur repond, en tache de fond ---
start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%RAPHAEL_HEALTH_URL%'; if($r.StatusCode -eq 200){Start-Process '%RAPHAEL_URL%'; break}}catch{}; Start-Sleep -Milliseconds 500}"

REM --- Demarre uvicorn avec rechargement auto (cette fenetre montre les logs) ---
echo Demarrage du serveur DEV sur le port %RAPHAEL_PORT%...
echo Laissez cette fenetre ouverte. Fermez-la (ou Ctrl+C) pour arreter le jeu.
echo.
"%PYTHON_EXE%" %PYTHON_ARGS% -m uvicorn app:app --host 0.0.0.0 --port %RAPHAEL_PORT% --reload

echo.
echo Serveur arrete.
pause
exit /b 0
