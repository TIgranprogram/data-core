import subprocess, sys
# Демонстрация параллельного запуска на собственных тестах (xdist)
r = subprocess.run([sys.executable, "-m", "pytest", "-n", "auto", "-q"], capture_output=True, text=True)
print(r.stdout)
print(r.stderr)
sys.exit(r.returncode)