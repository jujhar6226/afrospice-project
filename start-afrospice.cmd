@echo off
set ROOT=%~dp0

start "AfroSpice Workspace" cmd /k "cd /d %ROOT%frontend && npm.cmd run dev"

echo AfroSpice workspace is starting in a new window.
echo Backend health: http://127.0.0.1:5000/api/system/health
echo Frontend app:  http://127.0.0.1:5173
