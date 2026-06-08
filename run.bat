@echo off
setlocal enabledelayedexpansion

:: Setup local paths
set "PATH=%CD%\.go_sdk\go\bin;%PATH%"
set "GOPATH=%CD%\.gopath"
set "GOBIN=%GOPATH%\bin"
set "PATH=%GOBIN%;%PATH%"

:: Check setup
if not exist .go_sdk\go\bin\go.exe goto do_setup
if not exist .gopath\bin\wails3.exe goto do_setup
goto menu

:do_setup
echo ==========================================
echo Installing portable Go and Wails v3...
echo ==========================================
if not exist .go_sdk mkdir .go_sdk
if not exist .gopath mkdir .gopath
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://go.dev/dl/go1.22.5.windows-amd64.zip' -OutFile 'go_sdk.zip'"
powershell -Command "Expand-Archive -Path 'go_sdk.zip' -DestinationPath '.go_sdk'"
del go_sdk.zip

:: Install Wails v3
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

:: Install frontend deps
where bun >nul 2>nul
if %ERRORLEVEL% equ 0 (
    cd frontend && bun install && cd ..
) else (
    cd frontend && npm install && cd ..
)
echo Setup complete!

:menu
echo ==========================================
echo    NoCodex ePDF Studio - Portable Run
echo ==========================================
echo 1) Start Development Mode (wails3 dev)
echo 2) Build Standalone Windows (.exe) App
echo 3) Re-run Setup / Update Dependencies
echo ==========================================
set /p CHOICE="Select an option (1-3): "

if "%CHOICE%"=="1" (
    wails3 dev
) else if "%CHOICE%"=="2" (
    wails3 task windows:build
) else if "%CHOICE%"=="3" (
    rmdir /s /q .go_sdk .gopath 2>nul
    goto do_setup
) else (
    echo Invalid choice.
    pause
)
