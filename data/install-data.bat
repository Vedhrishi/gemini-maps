@echo off
cd /d "%~dp0"
for %%i in (1 2 3 4) do tar -xf cells_part%%i.tar
del cells_part1.tar cells_part2.tar cells_part3.tar cells_part4.tar
echo Done: data\cells now has the India place data
pause
