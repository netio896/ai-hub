@echo off
chcp 65001 >nul

title Puter.js Local Server

echo ===================================================
echo 正在启动 Puter.js 本地服务器
echo ===================================================
echo.
echo 浏览器将自动打开
echo 使用期间请不要关闭此窗口
echo.

start http://localhost:8001

python -m http.server 8001