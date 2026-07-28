@echo off
REM Weekly security-sweep wrapper for Windows Task Scheduler.
REM Runs the sweep, logs every run, and raises a VISIBLE alert only when the sweep exits non-zero
REM (a NEW regression vs. the saved baseline). Silent on a clean week.
setlocal
set "REPO=c:\Users\Administrator\Downloads\athleteos"
set "LOG=%REPO%\scripts\.security-sweep.log"
cd /d "%REPO%"
echo ==================== %DATE% %TIME% ====================>> "%LOG%"
"C:\Program Files\nodejs\node.exe" scripts\security-sweep.mjs >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo exit=%RC%>> "%LOG%"
if not "%RC%"=="0" (
  copy /y "%LOG%" "%USERPROFILE%\Desktop\SECURITY-ALERT-sweep.txt" >nul 2>&1
  msg "%USERNAME%" "OnStandard security sweep: a NEW regression appeared. See Desktop\SECURITY-ALERT-sweep.txt" 2>nul
)
endlocal
exit /b 0
