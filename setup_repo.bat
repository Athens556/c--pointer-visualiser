@echo off
echo Initializing Git Repository...
git init
git add .
git commit -m "Initial commit: C Pointer Visualizer"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Commit failed. You may need to configure your git identity.
    echo Try running:
    echo   git config --global user.email "you@example.com"
    echo   git config --global user.name "Your Name"
    echo Then run this script again.
    pause
    exit /b
)

echo Adding Remote...
git remote add origin https://github.com/Athens556/c--pointer-visualiser.git
git branch -M main

echo Pushing to GitHub...
git push -u origin main

echo Done!
pause
