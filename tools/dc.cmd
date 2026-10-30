@echo off
rem Запуск dc из Windows: dc start ^| errors ^| check ^| data ^| status ^| logs ^| stand ^| night
node "%~dp0dc.mjs" %*
