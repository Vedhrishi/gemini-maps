@echo off
cd /d R:\gemini-maps\gemini-maps\frontend\public\data
copy /b cells.part00+cells.part01+cells.part02+cells.part03 cells-new.tar
if exist cells rmdir /s /q cells
tar -xf cells-new.tar
del cells-new.tar cells.part00 cells.part01 cells.part02 cells.part03
echo Done. Now run: cd /d R:\gemini-maps\gemini-maps\frontend ^&^& npm run deploy
