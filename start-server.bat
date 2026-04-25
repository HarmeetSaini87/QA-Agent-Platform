@echo off
REM QA Launchpad — Silent Server Launcher
REM Double-click or call from Task Scheduler to start the Node.js app hidden.

cd /d "E:\AI Agent\qa-agent-platform-dev"

REM Kill any existing process on port 3003
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3003.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 >nul
)

REM Start Node.js + tsx silently (no window)
start "" /B "C:\Program Files\nodejs\node.exe" ^
    "E:\AI Agent\qa-agent-platform-dev\node_modules\tsx\dist\cli.mjs" ^
    "E:\AI Agent\qa-agent-platform-dev\src\ui\server.ts" ^
    >> "E:\AI Agent\qa-agent-platform-dev\server-dev.log" ^
    2>> "E:\AI Agent\qa-agent-platform-dev\server-dev-error.log"

echo QA Launchpad started. Check server-dev.log for details.
