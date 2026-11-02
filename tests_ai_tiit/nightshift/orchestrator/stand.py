import json
import re
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

import yaml

from .paths import ROOT

NIGHT_DB = "datacore-night"
MONGO_CONTAINER = "nightshift-mongo"
APP_SERVICE = "app"
FORBIDDEN_PORTS = {3000, 3001, 3002, 27017, 27018}

class StandError(Exception):
    pass

def pick_backup(names):
    """Самый свежий datacore-*.tgz по имени; .part и чужие файлы не берутся."""
    found = [n for n in names if re.fullmatch(r"datacore-[\d_-]+\.tgz", n)]
    return max(found) if found else None

def assert_stand_safe(db, compose_text):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+-night", db or ""):
        raise StandError(f"Имя базы стенда «{db}» не оканчивается на -night")
    if not re.search(r"^\s*internal:\s*true\s*$", compose_text, re.M):
        raise StandError("Сеть стенда не закрыта: нет internal: true")
    for port in re.findall(r"[\"'\s-](?:[\d.]+:)?(\d+):\d+[\"'\s]", compose_text):
        if int(port) in FORBIDDEN_PORTS:
            raise StandError(f"Стенд публикует запрещённый порт {port}")

def find_dump(extracted):
    for top in sorted(Path(extracted).iterdir()):
        if (top / "datacore").is_dir():
            return top / "datacore"
    raise StandError("В бэкапе нет папки datacore")

def _run(cmd, cwd=None, timeout=600):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if r.returncode != 0:
        tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
        raise StandError(f"Команда {cmd[0]} {cmd[1]} упала: {tail[0][:200]}")
    return r.stdout

def _mongo(script):
    return _run(["docker", "exec", MONGO_CONTAINER, "mongo", "--quiet", NIGHT_DB, "--eval", script]).strip()

def _wait_primary(tries=30):
    for _ in range(tries):
        try:
            if _mongo("print(db.isMaster().ismaster)").endswith("true"):
                return
        except StandError:
            pass
        time.sleep(2)
    raise StandError("Mongo стенда не стал основным узлом")

def refresh(keep_app=False, root=ROOT):
    """Сбрасывает базу стенда к свежему бэкапу и проверяет, что он восстановился."""
    stand_dir = root / "stand"
    assert_stand_safe(NIGHT_DB, (stand_dir / "docker-compose.yml").read_text(encoding="utf-8"))
    with open(root / "config" / "project.yaml", encoding="utf-8") as f:
        backups = Path(yaml.safe_load(f)["backup_path_pc"])
    name = pick_backup([p.name for p in backups.iterdir()]) if backups.exists() else None
    if not name:
        raise StandError(f"Нет бэкапа datacore-*.tgz в {backups}")

    _run(["docker", "compose", "up", "-d", "mongo", "mongo-init", "mailpit"], cwd=stand_dir)
    _wait_primary()

    extracted = root / "data" / "restore"
    shutil.rmtree(extracted, ignore_errors=True)
    extracted.mkdir(parents=True)
    try:
        with tarfile.open(backups / name, "r:gz") as tar:
            tar.extractall(extracted, filter="data")
        dump = find_dump(extracted)
        expected = len(list(dump.glob("*.bson")))
        _run(["docker", "exec", MONGO_CONTAINER, "rm", "-rf", "/tmp/prod-dump"])
        _run(["docker", "cp", str(dump), f"{MONGO_CONTAINER}:/tmp/prod-dump"])
        _run(["docker", "exec", MONGO_CONTAINER, "mongorestore", "--quiet", "--drop", "--db", NIGHT_DB, "/tmp/prod-dump"])
        _run(["docker", "exec", MONGO_CONTAINER, "rm", "-rf", "/tmp/prod-dump"])
    finally:
        shutil.rmtree(extracted, ignore_errors=True)

    restored = json.loads(_mongo(
        "var o={};db.getCollectionNames().forEach(function(c){o[c]=db.getCollection(c).count()});print(JSON.stringify(o))"
    ))
    if len(restored) < expected:
        raise StandError(f"Восстановлено коллекций {len(restored)} из {expected}")
    if sum(restored.values()) == 0:
        raise StandError("База стенда пуста после восстановления")
    if not keep_app:
        _run(["docker", "compose", "up", "-d", "--force-recreate", APP_SERVICE], cwd=stand_dir)
    return {"backup": name, "db": NIGHT_DB, "collections": len(restored), "documents": sum(restored.values()), "app_restarted": not keep_app}
