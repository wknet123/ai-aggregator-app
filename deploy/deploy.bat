@echo off
REM ============================================
REM AI Aggregator Platform - Deployment Script (Windows)
REM ============================================

setlocal enabledelayedexpansion

echo ============================================
echo   AI Aggregator Platform - Deployment
echo ============================================

REM Check if .env file exists
if not exist ".env" (
    echo Warning: .env file not found. Creating from .env.example...
    copy .env.example .env
    echo Please update .env with your actual configuration values.
)

REM Parse command line arguments
set COMMAND=%1
if "%COMMAND%"=="" set COMMAND=up

if "%COMMAND%"=="up" (
    echo Starting all services...
    docker compose up -d --build
    echo.
    echo All services started successfully!
    echo.
    echo Access your application at:
    echo   - Frontend: http://localhost:80
    echo   - Backend API: http://localhost:8000
    echo   - API Docs: http://localhost:8000/docs
    echo.
    echo Default credentials:
    echo   - Admin: admin@example.com / 123456
    echo   - Demo: demo@example.com / 123456
    goto :end
)

if "%COMMAND%"=="down" (
    echo Stopping all services...
    docker compose down
    echo All services stopped.
    goto :end
)

if "%COMMAND%"=="restart" (
    echo Restarting all services...
    docker compose down
    docker compose up -d --build
    echo All services restarted.
    goto :end
)

if "%COMMAND%"=="logs" (
    set SERVICE=%2
    if "!SERVICE!"=="" (
        docker compose logs -f
    ) else (
        docker compose logs -f !SERVICE!
    )
    goto :end
)

if "%COMMAND%"=="status" (
    echo Service Status:
    docker compose ps
    goto :end
)

if "%COMMAND%"=="clean" (
    echo Warning: This will remove all containers, volumes, and images!
    set /p CONFIRM="Are you sure? (y/N) "
    if /i "!CONFIRM!"=="y" (
        docker compose down -v --rmi all
        echo Cleanup complete.
    )
    goto :end
)

if "%COMMAND%"=="rebuild" (
    set SERVICE=%2
    if "!SERVICE!"=="" (
        echo Rebuilding all services...
        docker compose build --no-cache
    ) else (
        echo Rebuilding !SERVICE!...
        docker compose build --no-cache !SERVICE!
    )
    docker compose up -d
    echo Rebuild complete.
    goto :end
)

if "%COMMAND%"=="shell" (
    set SERVICE=%2
    if "!SERVICE!"=="" set SERVICE=backend
    echo Opening shell in !SERVICE! container...
    docker compose exec !SERVICE! /bin/sh
    goto :end
)

if "%COMMAND%"=="db" (
    echo Connecting to MySQL database...
    docker compose exec db mysql -u ai_user -pAi@User2024 ai_aggregator
    goto :end
)

REM Default: show help
echo Usage: deploy.bat [command] [options]
echo.
echo Commands:
echo   up        - Start all services (default)
echo   down      - Stop all services
echo   restart   - Restart all services
echo   logs      - View logs (optionally specify service)
echo   status    - View service status
echo   clean     - Remove all containers, volumes, and images
echo   rebuild   - Rebuild containers (optionally specify service)
echo   shell     - Open shell in container (default: backend)
echo   db        - Connect to MySQL database
echo.
echo Examples:
echo   deploy.bat up
echo   deploy.bat logs backend
echo   deploy.bat rebuild frontend
echo   deploy.bat shell backend

:end
endlocal
