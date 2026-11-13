@echo off
rem dc: start, errors, check, data, status, logs, stand, night (ASCII only: cmd breaks on UTF-8 here)
node "%~dp0dc.mjs" %*
