@echo off
setlocal enabledelayedexpansion

:: ============================================
:: VIGNETTE - Installation & Launch Script
:: For Windows 11 x64
:: ============================================

echo.
echo ============================================
echo   VIGNETTE - AI Video Creation Studio
echo   Installation and Launch Script
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Check Node.js version
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js detected: %NODE_VERSION%

:: Check if npm is available
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not available!
    echo Please reinstall Node.js with npm included.
    echo.
    pause
    exit /b 1
)

:: Get current directory (this script's location)
set APP_DIR=%~dp0

:: Navigate to vignette subdirectory
cd /d "%APP_DIR%vignette"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Could not navigate to app directory: %APP_DIR%vignette
    echo.
    pause
    exit /b 1
)

echo.
echo [INFO] Working directory: %APP_DIR%vignette
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] node_modules not found. Installing dependencies...
    echo.
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Failed to install dependencies!
        echo Please check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed successfully!
) else (
    echo [INFO] Dependencies already installed.
    echo.
    
    :: Ask user if they want to reinstall dependencies
    set /p REINSTALL="Do you want to reinstall dependencies? (Y/N): "
    if /i "!REINSTALL!"=="Y" (
        echo.
        echo [INFO] Reinstalling dependencies...
        echo.
        call npm install
        if %ERRORLEVEL% neq 0 (
            echo.
            echo [ERROR] Failed to reinstall dependencies!
            echo.
            pause
            exit /b 1
        )
        echo.
        echo [OK] Dependencies reinstalled successfully!
    )
)

echo.
echo ============================================
echo   Starting VIGNETTE Development Server
echo ============================================
echo.
echo [INFO] Opening browser automatically...
echo [INFO] Press Ctrl+C to stop the server
echo.

:: Start the development server
call npm run dev

:: If we reach here, the server was stopped
echo.
echo [INFO] Server stopped.
echo.
pause
