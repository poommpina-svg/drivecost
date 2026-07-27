@echo off
chcp 65001 >nul
title DriveCost - Push to GitHub
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] ไม่พบ Git กรุณาติดตั้ง Git for Windows ก่อน
  echo https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

echo.
set /p REPO_URL=วาง GitHub Repository URL แล้วกด Enter: 
if "%REPO_URL%"=="" (
  echo [ERROR] ยังไม่ได้ใส่ Repository URL
  pause
  exit /b 1
)

git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
git branch -M main

echo.
echo กำลัง Push ไป GitHub...
git push -u origin main

if errorlevel 1 (
  echo.
  echo [ERROR] Push ไม่สำเร็จ
  echo ตรวจสิทธิ์ GitHub, Repository URL และการเข้าสู่ระบบ Git Credential Manager
  echo.
  pause
  exit /b 1
)

echo.
echo Push สำเร็จแล้ว
echo %REPO_URL%
echo.
pause
