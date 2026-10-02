@echo off
cd /d "%~dp0"
python -m pip install -r requirements.txt
set ADMIN_USER=admin
set ADMIN_PASSWORD=troque-esta-senha
python app.py
pause
