@echo off
cd /d "%~dp0"
title 网易云电台下载器
echo ============================================
echo   玖桐博客 网易云电台下载器
echo   首次运行会自动安装依赖（含 ffmpeg）
echo ============================================
echo.
python -m pip install --disable-pip-version-check -q fastapi uvicorn python-multipart requests imageio-ffmpeg
echo.
echo 启动服务: http://127.0.0.1:8003
echo 关闭本窗口即停止服务。
echo.
start "" http://127.0.0.1:8003
python -m uvicorn app:app --host 127.0.0.1 --port 8003
pause
