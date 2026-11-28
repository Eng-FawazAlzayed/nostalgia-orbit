@echo off
REM Private copy of the site: bound to the Tailscale address, so only devices on
REM this tailnet can open it. The public GitHub Pages build stays as it is.
cd /d "%~dp0public"
set TS=100.115.3.122
echo Nostalgia Orbit (private) -^> http://%TS%:8099/
start "" http://%TS%:8099/
python -m http.server 8099 --bind %TS%
