@echo off
REM QA Launchpad — Silent Server Launcher (PROD)
REM Double-click or call from Task Scheduler to start the Node.js app hidden.

cd /d "E:\AI Agent\qa-agent-platform"

REM Kill any existing process on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 >nul
)

REM Start Node.js + tsx silently (no window)
start "" /B "C:\Program Files\nodejs\node.exe" ^
    "E:\AI Agent\qa-agent-platform\node_modules\tsx\dist\cli.mjs" ^
    "E:\AI Agent\qa-agent-platform\src\ui\server.ts" ^
    >> "E:\AI Agent\qa-agent-platform\server.log" ^
    2>> "E:\AI Agent\qa-agent-platform\server_err.log"

echo QA Launchpad PROD started on port 3000. Check server.log for details.
