@echo off
echo.
echo ╔══════════════════════════════════════╗
echo ║        ERGen Setup and Launch        ║
echo ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install from https://python.org
    pause
    exit /b 1
)

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo.
echo ╔══════════════════════════════════════╗
echo ║  Open http://localhost:5000          ║
echo ╚══════════════════════════════════════╝
echo.

python app.py
pause
