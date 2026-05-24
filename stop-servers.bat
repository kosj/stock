@echo off
echo 서버 프로세스 종료 중...

taskkill /F /IM python.exe 2>nul
if %ERRORLEVEL% == 0 (echo [OK] Python 프로세스 종료) else (echo [--] Python 프로세스 없음)

taskkill /F /IM node.exe 2>nul
if %ERRORLEVEL% == 0 (echo [OK] Node.js 프로세스 종료) else (echo [--] Node.js 프로세스 없음)

echo 완료.
