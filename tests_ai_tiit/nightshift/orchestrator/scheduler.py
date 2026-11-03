import subprocess

def create_task(name, command):
    r = subprocess.run(["schtasks", "/Create", "/TN", name, "/TR", command, "/SC", "DAILY", "/ST", "01:00", "/F"], capture_output=True, text=True)
    return r.returncode == 0

def remove_task(name):
    r = subprocess.run(["schtasks", "/Delete", "/TN", name, "/F"], capture_output=True, text=True)
    return r.returncode == 0