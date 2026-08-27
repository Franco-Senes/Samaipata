@echo off
setlocal enabledelayedexpansion
title Samaipata Installer Script

:: Set an error flag to track missing dependencies
set ERRORS=0

echo Checking system requirements...
echo ---------------------------------------
echo.

:: --- CHECK OLLAMA ---
echo Checking Ollama...
where ollama >nul 2>nul
if !errorlevel! equ 0 goto OLLAMA_FOUND

echo [ERROR] Ollama is not found on this system.
:PROMPT_OLLAMA
set /p INSTALL_O="Want to install Ollama now? (y/n): "
if /i "!INSTALL_O!" == "y" goto INSTALL_OLLAMA
if /i "!INSTALL_O!" == "n" goto SKIP_OLLAMA_ERR

echo Invalid input. Please enter 'y' or 'n'.
goto PROMPT_OLLAMA

:INSTALL_OLLAMA
echo.
echo [Downloading and installing Ollama via PowerShell...]
powershell -Command "irm https://ollama.com/install.ps1 | iex"
echo.
echo Ollama installation finished! 
echo Note: If it fails in the next step, close and reopen this window to refresh your PATH.
goto CHECK_NODE

:SKIP_OLLAMA_ERR
set ERRORS=1
goto CHECK_NODE

:OLLAMA_FOUND
echo [SUCCESS] Ollama is installed!
ollama --version


:: --- CHECK NODE.JS ---
:CHECK_NODE
echo.
echo Checking Node.js...
where node >nul 2>nul
if !errorlevel! equ 0 goto NODE_FOUND

echo [ERROR] Node.js is not found on this system.
echo Download it from: https://nodejs.org/
set ERRORS=1
goto CHECK_GIT

:NODE_FOUND
:: Extract the major version number
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a

if !NODE_MAJOR! GEQ 18 goto NODE_GOOD

echo [ERROR] Node.js version is too old!
echo Found major version: !NODE_MAJOR!
echo You need version 18 or higher. Update at: https://nodejs.org/
set ERRORS=1
goto CHECK_GIT

:NODE_GOOD
echo [SUCCESS] Node.js 18+ requirement met!
node -v


:: --- CHECK GIT ---
:CHECK_GIT
echo.
echo Checking Git...
where git >nul 2>nul
if !errorlevel! equ 0 goto GIT_FOUND

echo [ERROR] Git is not found on this system.
echo Download it from: https://git-scm.com/downloads
set ERRORS=1
goto EVALUATE_ERRORS

:GIT_FOUND
echo [SUCCESS] Git is installed!
git --version


:: --- EVALUATE ERRORS ---
:EVALUATE_ERRORS
echo.
echo ---------------------------------------
if !ERRORS! equ 1 (
    echo [!] Some dependencies are missing. Please fix them before continuing.
    pause
    exit /b
)

:: --- PROMPT TO CONTINUE ---
:PROMPT_FINAL
echo All dependencies met!
echo.
echo [NOTE] Samaipata will be installed in the same directory as this script. 
echo Make sure you are running this script from your desired location.
set /p CONTINUE="Continue to Samaipata installer? (y/n): "

if /i "!CONTINUE!" == "y" goto INSTALL
if /i "!CONTINUE!" == "n" goto CANCEL

echo Invalid input. Please enter 'y' or 'n'.
echo.
goto PROMPT_FINAL

:: --- BRANCHES ---
:INSTALL
echo.
echo [1/4] Cloning Samaipata repository...
git clone https://github.com/Franco-Senes/Samaipata.git
if !errorlevel! neq 0 (
    echo [ERROR] Failed to clone the repository. The folder might already exist.
    pause
    exit /b
)

:: Enter the cloned directory
cd Samaipata

echo.
echo [2/4] Installing dependencies...
call npm install

echo.
echo [3/4] Creating .env file...
echo PORT=5000> .env
echo JWT_SECRET=yourcustomkey>> .env
echo OLLAMA=http://localhost:11434>> .env
echo ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000>> .env
echo ZERO_CLIENT_ID=>> .env
echo ZERO_CLIENT_SECRET=>> .env
echo ZERO_REDIRECT_URI=http://localhost:5000/api/auth/zero/callback>> .env
echo ZERO_SERVER_URL=https://zero.info.bo>> .env
echo HACKCLUB_API_KEY=>> .env
echo [SUCCESS] .env file created!

echo.
echo [4/4] Starting Samaipata server...
echo -----------------------------------------------------------------
echo [READY] Open your browser and go to: http://localhost:5000
echo You can stop the server at any time by pressing Ctrl + C
echo -----------------------------------------------------------------
call npm start

pause
exit /b

:CANCEL
echo.
echo Installation cancelled by user.
pause
exit /b