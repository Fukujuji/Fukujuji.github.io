@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 福寿寺 ホームページ（編集・確認用サーバ）を起動します...
echo.
echo   公開サイトそのものではありません。
echo   公開用ファイルを作るには build_static.py を実行してください。
echo.
python -X utf8 app.py
pause
