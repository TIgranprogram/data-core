import subprocess
import sys
import re

# Получить IP хоста из /etc/resolv.conf
r = subprocess.run(["docker", "exec", "nightshift-mongo", "cat", "/etc/resolv.conf"],
                   capture_output=True, text=True)
m = re.search(r"host\(([\d.]+)\)", r.stdout)
host_ip = m.group(1) if m else None
if not host_ip:
    print("ISOLATION FAIL: не удалось определить IP хоста")
    sys.exit(2)

targets = [(host_ip, 27017), (host_ip, 27018), (host_ip, 3000), ("google.com", 80)]
all_blocked = True
for host, port in targets:
    cmd = ["docker", "exec", "nightshift-mongo", "bash", "-c",
           f"timeout 5 bash -c '</dev/tcp/{host}/{port}' && echo REACHABLE || echo BLOCKED"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    out = (r.stdout + r.stderr).strip()
    # различаем BLOCKED (таймаут/connection refused) от DNS/ошибки запуска
    if "REACHABLE" in out:
        print(f"{host}:{port} REACHABLE")
        all_blocked = False
    elif "BLOCKED" in out:
        print(f"{host}:{port} BLOCKED")
    elif "Temporary failure in name resolution" in out or "Invalid argument" in out:
        # DNS не резолвится — для host IP это не должно быть; для google.com при internal — ожидаемо
        if host == "google.com":
            print(f"{host}:{port} BLOCKED (DNS)")
        else:
            print(f"ISOLATION UNKNOWN: {host}:{port} DNS error (не засчитывается)")
            sys.exit(2)
    else:
        print(f"ISOLATION UNKNOWN: {host}:{port} {out}")
        sys.exit(2)

if all_blocked:
    print("ISOLATION OK")
    sys.exit(0)
else:
    print("ISOLATION FAIL: внешняя сеть доступна")
    sys.exit(1)