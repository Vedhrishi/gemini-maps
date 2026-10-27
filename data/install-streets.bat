@echo off
cd /d "%~dp0"
tar -xf streets.tar
del streets.tar
echo Done: data\streets installed
pause
