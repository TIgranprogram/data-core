"""
Personal Data Core - Deploy to Synology NAS / Ubuntu VM

Usage:
    python deploy/synology/deploy.py
    python deploy/synology/deploy.py --wipe          # clean install (dev/demo!)
    python deploy/synology/deploy.py --platform synology
    python deploy/synology/deploy.py --skip-build    # без docker build (образ уже собран)

Config: deploy/synology/config.env (copy from config.env.example)

Steps:
    1. Load config.env + verify sources
    2. Create archive (backend/ + docker-compose.prod.yml + deploy/)
    3. Connect via paramiko (password or DEPLOY_SSH_KEY)
    4. Upload & extract + .env (JWT / ADMIN_PASSWORD / MONGO_* креденшелы)
    5. Docker build + up (контур :3001, mongo 7 с --auth)
    6. Wait rs0 + backend health + login check + Mongo auth check

Отличия от kppdf-deploy (адаптировано 2026-10-17, см. ROADMAP P1.8):
    - НЕТ сборки NX-фронта и desktop-installer'а (админка — статика внутри backend/)
    - REMOTE_DIR=/opt/data-core, DATA_DIR=/var/lib/datacore, порт 3001
    - имена контейнеров datacore-* (kppdf-контур не трогаем)
    - .env включает MONGO_* (root/app/keyfile) — mongo включён с --auth
"""

import argparse
import base64
import os
import secrets
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path


# -- Platform defaults --------------------------------------------------

PLATFORMS = {
    "ubuntu": {
        "remote_dir": "/opt/data-core",
        "data_dir": "/var/lib/datacore",
        "docker": "docker",
    },
    "synology": {
        "remote_dir": "/volume1/docker/data-core",
        "data_dir": "/volume1/docker/datacore-data",
        "docker": "/usr/local/bin/docker",
    },
}

ARCHIVE_NAME = "datacore-deploy.tar.gz"
CONFIG_FILE = "config.env"
APP_PORT = 3001  # контур data-core; kppdf держит 3000 — не трогать


# -- Config loader ------------------------------------------------------

def load_config(project_root):
    """Load deploy/synology/config.env (KEY=VALUE, # comments)."""
    cfg = {}
    cfg_path = project_root / "deploy" / "synology" / CONFIG_FILE
    if not cfg_path.exists():
        return cfg
    for line in cfg_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        cfg[key.strip()] = val.strip()
    return cfg


def resolve_settings(args, cfg):
    """Merge CLI args, config.env, platform defaults."""
    platform = (args.platform or cfg.get("PLATFORM") or "ubuntu").lower()
    if platform not in PLATFORMS:
        fail("Unknown platform: " + platform + ". Use ubuntu or synology.")

    defaults = PLATFORMS[platform]
    host = args.host or cfg.get("DEPLOY_HOST") or "<LAN_IP>"
    user = args.user or cfg.get("DEPLOY_USER") or "<SSH_USER>"
    password = args.password or cfg.get("DEPLOY_PASSWORD") or None
    ssh_key = cfg.get("DEPLOY_SSH_KEY") or None
    if ssh_key:
        ssh_key = os.path.expandvars(os.path.expanduser(ssh_key))
        if not os.path.isfile(ssh_key):
            fail("DEPLOY_SSH_KEY not found: " + ssh_key)
    # data-core: читаем DATA_DIR (не KPPDF_DATA_DIR), remote только из config
    remote_dir = cfg.get("REMOTE_DIR") or defaults["remote_dir"]
    data_dir = cfg.get("DATA_DIR") or defaults["data_dir"]
    docker = cfg.get("DOCKER_CMD") or defaults["docker"]
    wipe = args.wipe or cfg.get("WIPE", "").lower() in ("true", "1", "yes")
    cors = cfg.get("CORS_ORIGIN") or "http://" + host + ":" + str(APP_PORT)

    jwt_secret = cfg.get("JWT_SECRET", "")
    jwt_refresh = cfg.get("JWT_REFRESH_SECRET", "")
    admin_password = cfg.get("ADMIN_PASSWORD", "")
    if not jwt_secret or "CHANGE_ME" in jwt_secret:
        jwt_secret = secrets.token_hex(32)
        warn("JWT_SECRET auto-generated - save it in config.env!")
    if not jwt_refresh or "CHANGE_ME" in jwt_refresh:
        jwt_refresh = secrets.token_hex(32)
        warn("JWT_REFRESH_SECRET auto-generated - save it in config.env!")
    if not admin_password or "CHANGE_ME" in admin_password:
        admin_password = "Kp8-" + secrets.token_urlsafe(16)
        warn("ADMIN_PASSWORD auto-generated - save it in config.env / CREDENTIALS.md!")

    # Mongo auth (задача B): root для init/бэкапов, datacore для приложения.
    # На пустом datadir root создастся сам из MONGO_INITDB_ROOT_*.
    mongo_root_password = cfg.get("MONGO_ROOT_PASSWORD", "")
    mongo_app_password = cfg.get("MONGO_APP_PASSWORD", "")
    keyfile_secret = cfg.get("MONGO_KEYFILE_SECRET", "")
    changed = False
    if not mongo_root_password or "CHANGE_ME" in mongo_root_password:
        mongo_root_password = secrets.token_urlsafe(32)
        changed = True
        warn("MONGO_ROOT_PASSWORD auto-generated - save it in config.env!")
    if not mongo_app_password or "CHANGE_ME" in mongo_app_password:
        mongo_app_password = secrets.token_urlsafe(32)
        changed = True
        warn("MONGO_APP_PASSWORD auto-generated - save it in config.env!")
    if not keyfile_secret or "CHANGE_ME" in keyfile_secret:
        keyfile_secret = base64.b64encode(secrets.token_bytes(384)).decode().rstrip("=")
        changed = True
        warn("MONGO_KEYFILE_SECRET auto-generated - save it in config.env!")
    if changed:
        warn(
            "Add to config.env: MONGO_ROOT_PASSWORD=... MONGO_APP_PASSWORD=... "
            "MONGO_KEYFILE_SECRET=..."
        )

    mongo_uri = cfg.get("MONGO_URI") or (
        "mongodb://datacore:" + mongo_app_password
        + "@mongo:27017/datacore?replicaSet=rs0&authSource=datacore"
    )

    return {
        "platform": platform,
        "host": host,
        "user": user,
        "password": password,
        "ssh_key": ssh_key,
        "remote_dir": remote_dir,
        "data_dir": data_dir,
        "docker": docker,
        "wipe": wipe,
        "cors": cors,
        "jwt_secret": jwt_secret,
        "jwt_refresh": jwt_refresh,
        "admin_password": admin_password,
        "mongo_root_password": mongo_root_password,
        "mongo_app_password": mongo_app_password,
        "mongo_keyfile_secret": keyfile_secret,
        "mongo_uri": mongo_uri,
    }


# -- Helpers ------------------------------------------------------------

def _safe_print(msg):
    """Windows cp1251 consoles choke on arrows/emoji - never crash deploy on log."""
    try:
        print(msg)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        print(msg.encode(enc, errors="replace").decode(enc, errors="replace"))


def log(msg):
    _safe_print("  " + msg)


def ok(msg):
    _safe_print("  [OK] " + msg)


def warn(msg):
    _safe_print("  [WARN] " + msg)


def fail(msg):
    _safe_print("  [FAIL] " + msg)
    sys.exit(1)


class RemoteHost:
    """SSH connection via paramiko (supports password & key auth)."""

    def __init__(self, host, user, password=None, docker="docker", ssh_key=None):
        self.host = host
        self.user = user
        self.password = password
        self.ssh_key = ssh_key
        self.docker = docker
        self._ssh = None

    def connect(self):
        import paramiko
        self._ssh = paramiko.SSHClient()
        self._ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {
            "hostname": self.host,
            "username": self.user,
            "timeout": 15,
            "allow_agent": False,
            "look_for_keys": False,
        }
        if self.ssh_key:
            kwargs["key_filename"] = self.ssh_key
        elif self.password:
            kwargs["password"] = self.password
        else:
            kwargs["allow_agent"] = True
            kwargs["look_for_keys"] = True
        try:
            self._ssh.connect(**kwargs)
            via = "key" if self.ssh_key else ("password" if self.password else "agent")
            ok("Connected to " + self.user + "@" + self.host + " (" + via + ")")
        except paramiko.AuthenticationException:
            fail("Auth failed. Set DEPLOY_SSH_KEY or DEPLOY_PASSWORD / --password.")
        except Exception as e:
            fail("Connection failed: " + str(e))

    def close(self):
        if self._ssh:
            self._ssh.close()

    def exec(self, command, timeout=30):
        try:
            stdin, stdout, stderr = self._ssh.exec_command(
                command, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            if err and "password" not in err.lower() and "Warning" not in err:
                return out + "\nERR: " + err
            return out
        except Exception as e:
            return "ERROR: " + str(e)

    def exec_sudo(self, command, timeout=30):
        pwd = self.password or ""
        full = "echo '" + pwd + "' | sudo -S bash -c '" + command.replace("'", "'\\''") + "'"
        return self.exec(full, timeout=timeout)

    def upload_file(self, local_path, remote_dir):
        filename = os.path.basename(local_path)
        remote_path = remote_dir + "/" + filename

        try:
            scp_cmd = [
                "scp", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no",
            ]
            if self.ssh_key:
                scp_cmd.extend(["-i", self.ssh_key])
            scp_cmd.extend([local_path, self.user + "@" + self.host + ":" + remote_path])
            result = subprocess.run(
                scp_cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                ok("Uploaded via SCP")
                return
        except Exception as e:
            warn("SCP: " + str(e))

        try:
            sftp = self._ssh.open_sftp()
            sftp.put(local_path, remote_path)
            sftp.close()
            ok("Uploaded via SFTP")
            return
        except Exception as e:
            warn("SFTP: " + str(e))

        with open(local_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        chunk_size = 8000
        chunks = [b64[i:i + chunk_size] for i in range(0, len(b64), chunk_size)]

        self.exec("rm -f " + remote_path)
        for chunk in chunks:
            self._ssh.exec_command("echo -n '" + chunk + "' >> " + remote_path, timeout=30)
        self.exec("base64 -d " + remote_path + " > " + remote_path + ".tmp && "
                  "mv " + remote_path + ".tmp " + remote_path)
        ok("Uploaded via pipe")

    def upload_text(self, content, remote_path):
        """Upload small text file via SFTP or echo."""
        try:
            sftp = self._ssh.open_sftp()
            with sftp.file(remote_path, "w") as f:
                f.write(content)
            sftp.close()
            ok("Uploaded " + os.path.basename(remote_path))
            return
        except Exception as e:
            warn("SFTP text: " + str(e))

        b64 = base64.b64encode(content.encode()).decode()
        self.exec("rm -f " + remote_path)
        chunk_size = 8000
        for i in range(0, len(b64), chunk_size):
            chunk = b64[i:i + chunk_size]
            self._ssh.exec_command("echo -n '" + chunk + "' >> " + remote_path + ".b64", timeout=30)
        self.exec("base64 -d " + remote_path + ".b64 > " + remote_path + " && rm -f " + remote_path + ".b64")
        ok("Uploaded " + os.path.basename(remote_path) + " via pipe")

    def docker_compose(self, remote_dir, action, timeout=300):
        # Always run from remote_dir; keep compound actions as one bash -c script.
        docker_cmd = (
            "export PATH=/usr/local/bin:/usr/bin:/sbin:$PATH; "
            "cd " + remote_dir + " || exit 1; "
            "DC='" + self.docker + " compose -f docker-compose.prod.yml'; "
            + action
        )
        return self.exec_sudo(docker_cmd, timeout=timeout)


# -- Archive creation ---------------------------------------------------

def create_archive(archive_path, project_root):
    log("Creating archive...")
    # data-core: бэкенд (включая admin/ статику) + compose. Фронта нет —
    # админка монтируется в образ через Dockerfile (COPY --from=build /app/admin).
    items = ["backend/", "docker-compose.prod.yml", "deploy/"]
    exclude = [
        "backend/node_modules", "backend/dist", "backend/.git",
        "backend/src/__tests__", "backend/.env", "backend/.env.local",
        "backend/coverage",
        "deploy/synology/config.env",       # секреты НЕ уезжают в архив
        "deploy/synology/CREDENTIALS.md",   # то же
        "deploy/synology/.env",
    ]

    def excluded(rel):
        rel = rel.replace("\\", "/")
        for p in exclude:
            p2 = p.replace("\\", "/")
            if rel == p2 or rel.startswith(p2 + "/"):
                return True
        return False

    with tarfile.open(archive_path, "w:gz") as tar:
        for item in items:
            item_path = project_root / item
            if not item_path.exists():
                warn(item + " not found, skip")
                continue
            if item_path.is_dir():
                for root, dirs, files in os.walk(item_path):
                    rel = os.path.relpath(root, project_root)
                    dirs[:] = [d for d in dirs if not excluded(os.path.join(rel, d))]
                    for f in files:
                        fp = os.path.join(root, f)
                        an = os.path.relpath(fp, project_root).replace("\\", "/")
                        if not excluded(an):
                            tar.add(fp, arcname=an)
            else:
                an = os.path.relpath(item_path, project_root).replace("\\", "/")
                tar.add(str(item_path), arcname=an)
    size = os.path.getsize(archive_path)
    ok("Archive: " + str(size // 1024) + " KB")


def make_env_file(settings):
    """Generate .env for docker compose on remote host (secrets, no defaults)."""
    lines = [
        "DATA_DIR=" + settings["data_dir"],
        "NODE_ENV=production",
        "PORT=3000",
        "JWT_SECRET=" + settings["jwt_secret"],
        "JWT_REFRESH_SECRET=" + settings["jwt_refresh"],
        "ADMIN_USERNAME=admin",
        "ADMIN_PASSWORD=" + settings["admin_password"],
        "CORS_ORIGIN=" + settings["cors"],
        "TRUST_PROXY=1",
        "LOG_LEVEL=info",
        "SWAGGER_ENABLED=false",
        # --- Mongo auth (задача B) ---
        "MONGO_ROOT_USER=root",
        "MONGO_ROOT_PASSWORD=" + settings["mongo_root_password"],
        "MONGO_APP_USER=datacore",
        "MONGO_APP_PASSWORD=" + settings["mongo_app_password"],
        "MONGO_KEYFILE_SECRET=" + settings["mongo_keyfile_secret"],
        "MONGO_URI=" + settings["mongo_uri"],
        "MONGO_DB=datacore",
        "MONGO_REPLICA_SET=rs0",
    ]
    return "\n".join(lines) + "\n"


def ensure_data_dirs(remote, settings):
    """Create persistent data directories on host (outside REMOTE_DIR)."""
    data_dir = settings["data_dir"]
    user = settings["user"]
    log("Ensuring data dirs: " + data_dir)
    cmd = (
        "mkdir -p " + data_dir + "/mongodb " + data_dir + "/uploads "
        + data_dir + "/backups && "
        "chown -R 999:999 " + data_dir + "/mongodb && "
        "chown -R " + user + ":" + user + " " + data_dir + "/uploads "
        + data_dir + "/backups"
    )
    r = remote.exec_sudo(cmd, timeout=30)
    ok("Data dirs ready: mongodb/, uploads/, backups/")
    if r and "ERR:" in r:
        warn(r[:150])


def wipe_remote(remote, settings):
    """Stop stack and delete app dir + mongo data (dev/demo wipe only)."""
    remote_dir = settings["remote_dir"]
    data_dir = settings["data_dir"]
    log("WIPE: stopping containers and clearing " + remote_dir + " + mongo data")
    remote.exec_sudo(
        "cd " + remote_dir + " && "
        + remote.docker + " compose -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true",
        timeout=120,
    )
    # Свои контейнеры (datacore-*). kppdf-* НЕ трогаем!
    remote.exec_sudo(
        remote.docker + " rm -f datacore-backend datacore-mongo 2>/dev/null || true",
        timeout=60,
    )
    remote.exec_sudo(
        "rm -rf " + remote_dir + "/* " + remote_dir + "/.[!.]* 2>/dev/null || true; "
        "rm -rf " + data_dir + "/mongodb/* " + data_dir + "/uploads/* 2>/dev/null || true; "
        "mkdir -p " + remote_dir + " " + data_dir + "/mongodb " + data_dir + "/uploads "
        + data_dir + "/backups; "
        "chown -R 999:999 " + data_dir + "/mongodb; "
        "chown -R " + settings["user"] + ":" + settings["user"] + " " + remote_dir + " "
        + data_dir + "/uploads " + data_dir + "/backups",
        timeout=120,
    )
    ok("Wipe complete (app + mongo data cleared; kppdf untouched)")


# -- Verification helpers -----------------------------------------------

def wait_for_replica_set(remote, settings, max_wait=90):
    """rs0 must be initiated before backend can connect (mongosh 7 + auth)."""
    log("Waiting for Mongo replica set rs0...")
    root_pw = settings["mongo_root_password"].replace("'", "'\\''")
    for i in range(max_wait // 5):
        status = remote.exec(
            remote.docker
            + " exec datacore-mongo mongosh --quiet -u root -p '" + root_pw
            + "' --authenticationDatabase admin --eval "
            + "'try{print(rs.status().ok)}catch(e){print(0)}'",
            timeout=15,
        )
        if status.strip().splitlines() and status.strip().splitlines()[-1].strip().startswith("1"):
            ok("Replica set ready")
            return True
        time.sleep(5)
        if i % 2 == 0:
            log("  rs not ready yet (" + str((i + 1) * 5) + "s)")
    warn("Replica set not ready - backend may fail to connect")
    return False


def wait_for_backend(remote, settings, max_wait=120):
    port = APP_PORT
    log("Waiting for backend (up to " + str(max_wait) + "s)...")
    for i in range(max_wait // 5):
        time.sleep(5)
        h = remote.exec("curl -sf http://localhost:" + str(port) + "/api/health/ready", timeout=10)
        if h and ("ok" in h.lower() or '"status"' in h.lower()):
            ok("Backend ready!")
            return True
        if i % 3 == 0 and i > 0:
            log("  (" + str((i + 1) * 5) + "s)")
    warn("Backend not ready within timeout")
    return False


def verify_mongo_auth(remote, settings):
    """Критерий P0.4: подключение без пароля должно отклоняться."""
    log("Verifying Mongo auth (no-password read must be rejected)...")
    r = remote.exec(
        remote.docker
        + " exec datacore-mongo mongosh --quiet --eval "
        + "'try{db.getSiblingDB(\"datacore\").users.find().limit(1).toArray();"
        + "print(\"NOAUTH-ACCEPTED\")}catch(e){print(\"NOAUTH-REJECTED\")}'",
        timeout=15,
    )
    if "NOAUTH-REJECTED" in r:
        ok("Mongo rejects unauthenticated reads")
    else:
        warn("Mongo accepted a read WITHOUT password - check --auth!")


# -- Main ---------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Deploy Personal Data Core to Synology/Ubuntu")
    parser.add_argument("--host", default=None)
    parser.add_argument("--user", default=None)
    parser.add_argument("--password", default=None)
    parser.add_argument("--platform", choices=["ubuntu", "synology"], default=None)
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Stop stack and delete REMOTE_DIR + mongo data before deploy (dev/demo only)",
    )
    parser.add_argument("--skip-build", action="store_true",
                        help="Не пересобирать docker-образ (использовать существующий)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    cfg = load_config(project_root)
    settings = resolve_settings(args, cfg)
    archive_path = os.path.join(tempfile.gettempdir(), ARCHIVE_NAME)

    print()
    print("=== Personal Data Core - Deploy (" + settings["platform"] + ") ===")
    print("  Host: " + settings["host"])
    print("  App:  " + settings["remote_dir"] + " (:" + str(APP_PORT) + ")")
    print("  Data: " + settings["data_dir"])
    if settings["wipe"]:
        print("  Mode: WIPE (clean install)")
    print()

    print("Step 1/6: Verify source code...")
    if not (project_root / "backend" / "src").exists():
        fail("backend/src not found!")
    if not (project_root / "docker-compose.prod.yml").exists():
        fail("docker-compose.prod.yml not found!")
    if not (project_root / "backend" / "admin" / "index.html").exists():
        fail("backend/admin/index.html not found!")
    ok("Source OK (backend + admin UI + compose)")

    print()
    print("Step 2/6: Create archive...")
    create_archive(archive_path, project_root)

    print()
    print("Step 3/6: Connect...")
    remote = RemoteHost(
        settings["host"], settings["user"], settings["password"],
        docker=settings["docker"], ssh_key=settings.get("ssh_key"))
    remote.connect()
    remote.exec("mkdir -p " + settings["remote_dir"])
    if settings["wipe"]:
        wipe_remote(remote, settings)
    ensure_data_dirs(remote, settings)

    print()
    print("Step 4/6: Upload & extract...")
    remote.upload_file(archive_path, settings["remote_dir"])
    os.remove(archive_path)

    env_content = make_env_file(settings)
    remote.upload_text(env_content, settings["remote_dir"] + "/.env")
    ok(".env uploaded (JWT + ADMIN_PASSWORD + MONGO_*)")

    r = remote.exec(
        "cd " + settings["remote_dir"] + " && tar xzf " + ARCHIVE_NAME + " && "
        "rm -f " + ARCHIVE_NAME + " && ls -d */",
        timeout=60)
    ok("Extracted: " + r[:120])

    print()
    print("Step 5/6: Docker build & start...")
    if args.skip_build:
        action = "$DC down --remove-orphans 2>/dev/null || true; $DC up -d"
    else:
        action = ("$DC down --remove-orphans 2>/dev/null || true; "
                  "$DC build backend && $DC up -d")
    r = remote.docker_compose(settings["remote_dir"], action, timeout=900)
    ok("Docker: " + (r[:400] if r else "ok"))
    if r and ("ERR:" in r or "error" in r.lower() or "Error" in r):
        warn("Compose output may contain errors - continuing to health wait")

    # mongo-keyfile + mongo-init + mongo(healthy) должны отработать до backend
    time.sleep(5)
    wait_for_replica_set(remote, settings)
    backend_ok = wait_for_backend(remote, settings)

    if not backend_ok:
        logs = remote.exec(
            remote.docker + " logs --tail 80 datacore-backend 2>&1", timeout=30)
        warn("Backend logs:\n" + (logs[:1500] if logs else "(empty)"))
        remote.close()
        fail("Deploy incomplete")

    print()
    print("Step 6/6: Verify...")
    h = remote.exec("curl -sf http://localhost:" + str(APP_PORT) + "/api/health/ready", timeout=10)
    ok("Health: " + (h[:80] if h else "no response"))

    log("Verifying auth...")
    admin_pw = settings["admin_password"].replace("'", "'\\''")
    login = remote.exec(
        "curl -sf -X POST http://localhost:" + str(APP_PORT) + "/api/auth/login "
        "-H 'Content-Type: application/json' "
        "-d '{\"username\":\"admin\",\"password\":\"" + admin_pw + "\"}'",
        timeout=15,
    )
    if login and "access" in login:
        ok("Auth login OK")
    else:
        warn("Auth verify: " + (login[:200] if login else "no response"))

    log("Verifying admin UI...")
    admin_status = remote.exec(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:" + str(APP_PORT) + "/admin/",
        timeout=10)
    if "200" in admin_status:
        ok("Admin UI HTTP 200")
    else:
        warn("Admin UI: HTTP " + admin_status[:10])

    verify_mongo_auth(remote, settings)
    remote.close()

    print()
    print("=== Deploy complete ===")
    print()
    print("  API:   http://" + settings["host"] + ":" + str(APP_PORT) + "/api/health")
    print("  Admin: http://" + settings["host"] + ":" + str(APP_PORT) + "/admin")
    print("  Docs:  http://" + settings["host"] + ":" + str(APP_PORT) + "/docs (выключен в prod)")
    print("  Auth:  admin / (см. CREDENTIALS.md ADMIN_PASSWORD)")
    print()
    print("  Data:  " + settings["data_dir"] + "/ (mongodb, uploads, backups)")
    print()
    print("  SSH:")
    if settings.get("ssh_key"):
        print("    ssh -i " + settings["ssh_key"] + " " + settings["user"] + "@" + settings["host"])
    else:
        print("    ssh " + settings["user"] + "@" + settings["host"])
    print("    cd " + settings["remote_dir"])
    print("    " + settings["docker"] + " compose -f docker-compose.prod.yml ps|logs")
    print("    bash deploy/synology/backup.sh   # бэкап (нужен MONGO_ROOT_PASSWORD в .env)")
    print()


if __name__ == "__main__":
    main()
