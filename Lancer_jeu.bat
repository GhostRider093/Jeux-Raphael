@echo off
setlocal EnableExtensions
title Raphael - Lancement du jeu
cd /d "%~dp0"

set "RAPHAEL_URL=http://127.0.0.1:8010/index.html"
set "RAPHAEL_PORT=8010"

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%RAPHAEL_URL%'; if($r.StatusCode -eq 200){exit 0} } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 goto :OPEN_GAME

where py >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
  goto :CHECK_PORT
)
where python >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_EXE=python"
  set "PYTHON_ARGS="
  goto :CHECK_PORT
)

echo.
echo ERREUR : Python est introuvable.
echo Installez Python 3 puis relancez ce fichier.
echo.
pause
exit /b 1

:CHECK_PORT
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort %RAPHAEL_PORT% -State Listen -ErrorAction SilentlyContinue; if($c){exit 1}else{exit 0}" >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERREUR : le port %RAPHAEL_PORT% est deja utilise par une autre application.
  echo Fermez cette application puis relancez le jeu.
  echo.
  pause
  exit /b 1
)

echo Demarrage de Raphael...
start "Serveur Raphael E" /min "%PYTHON_EXE%" %PYTHON_ARGS% -m http.server %RAPHAEL_PORT% --bind 127.0.0.1 --directory "%~dp0."

for /L %%G in (1,1,12) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%RAPHAEL_URL%'; if($r.StatusCode -eq 200){exit 0} } catch {}; exit 1" >nul 2>&1
  if not errorlevel 1 goto :OPEN_GAME
  ping -n 2 127.0.0.1 >nul
)

echo.
echo ERREUR : le serveur local n'a pas pu demarrer.
echo Verifiez Python et les autorisations du pare-feu Windows.
echo.
pause
exit /b 1

:OPEN_GAME
start "" "%RAPHAEL_URL%"
exit /b 0
