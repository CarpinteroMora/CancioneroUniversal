@echo off
rem Abre Cancionero Universal. La primera vez lo deja listo en segundo plano y en el menu Inicio.
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw -3 servidor\canciotras_servidor.py %* & goto :eof)
where pythonw >nul 2>nul && (start "" pythonw servidor\canciotras_servidor.py %* & goto :eof)
where python >nul 2>nul && (start "" /min python servidor\canciotras_servidor.py %* & goto :eof)
echo Cancionero Universal necesita Python 3: https://www.python.org/downloads/
pause
