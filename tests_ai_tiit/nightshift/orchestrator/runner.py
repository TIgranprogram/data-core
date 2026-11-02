import subprocess
import sys
import time
from pathlib import Path

def _kill_tree(pid):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        import os, signal
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception:
                pass

def run_suite(suite, timeout_sec=30):
    cmd = suite.get("command", [])
    if cmd and cmd[0] == "python":
        cmd = [sys.executable, *cmd[1:]]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    try:
        stdout, stderr = proc.communicate(timeout=timeout_sec)
        return {"name": suite.get("name"), "returncode": proc.returncode, "stdout": stdout or "", "stderr": stderr or "", "timed_out": False, "command": cmd}
    except subprocess.TimeoutExpired:
        _kill_tree(proc.pid)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = "", ""
        return {"name": suite.get("name"), "returncode": 124, "stdout": stdout or "", "stderr": stderr or "", "timed_out": True, "command": cmd, "status": "прерван по времени"}

if __name__ == "__main__":
    import json
    s = {"name": "demo", "command": ["python", "-c", "print('ok')"]}
    print(json.dumps(run_suite(s), ensure_ascii=False))