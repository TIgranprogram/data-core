"""Reset deployed admin password (requires --password) and clear softlock via restart.

Usage (from repo root):
  python deploy/synology/reset-admin-password.py --password '<strong-new-password>'

Reads SSH/JWT from gitignored deploy/synology/config.env.
Never commit live passwords — pass via CLI or ADMIN_PASSWORD_NEW env.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
import urllib.request

import paramiko

ROOT = pathlib.Path(__file__).resolve().parents[2]
CFG_PATH = ROOT / "deploy" / "synology" / "config.env"
CRED_PATH = ROOT / "deploy" / "synology" / "CREDENTIALS.md"


def load_cfg() -> dict[str, str]:
    cfg: dict[str, str] = {}
    for line in CFG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        cfg[k.strip()] = v.strip()
    return cfg


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset deployed admin password")
    parser.add_argument(
        "--password",
        default=os.environ.get("ADMIN_PASSWORD_NEW"),
        help="New admin password (≥12). Or set ADMIN_PASSWORD_NEW.",
    )
    args = parser.parse_args()
    new_pw = (args.password or "").strip()
    if len(new_pw) < 12:
        print("FAIL: --password / ADMIN_PASSWORD_NEW required, ≥12 chars", file=sys.stderr)
        sys.exit(1)
    if new_pw == "admin-change-me-immediately-in-production":
        print("FAIL: banned demo default password", file=sys.stderr)
        sys.exit(1)

    cfg = load_cfg()
    old_pw = cfg["ADMIN_PASSWORD"]

    text = CFG_PATH.read_text(encoding="utf-8")
    CFG_PATH.write_text(
        re.sub(r"^ADMIN_PASSWORD=.*$", f"ADMIN_PASSWORD={new_pw}", text, flags=re.M),
        encoding="utf-8",
    )
    if CRED_PATH.exists():
        cred = CRED_PATH.read_text(encoding="utf-8")
        CRED_PATH.write_text(cred.replace(old_pw, new_pw), encoding="utf-8")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(cfg["DEPLOY_SSH_KEY"])
    client.connect(
        cfg["DEPLOY_HOST"],
        username=cfg["DEPLOY_USER"],
        pkey=pkey,
        timeout=15,
        allow_agent=False,
        look_for_keys=False,
    )

    def run(cmd: str, timeout: int = 120) -> tuple[str, str]:
        _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        return out, err

    def sudo(inner: str, timeout: int = 120) -> tuple[str, str]:
        ssh_pw = cfg.get("DEPLOY_PASSWORD", "")
        if ssh_pw:
            return run(f"echo '{ssh_pw}' | sudo -S {inner}", timeout=timeout)
        return run(f"sudo {inner}", timeout=timeout)

    # Hash password inside container (bcryptjs available on backend image)
    hash_js = (
        "const b=require('bcryptjs');\n"
        f"b.hash({json.dumps(new_pw)}, 10).then(h => console.log(h));\n"
    )
    # Write hash script remotely then eval via node in backend container
    remote_js = "/tmp/kppdf-hash-pw.js"
    # Avoid shell-injection: base64 the script
    import base64

    b64 = base64.b64encode(hash_js.encode()).decode()
    run(f"echo {b64} | base64 -d > {remote_js}")
    hout, herr = sudo(
        f"docker cp {remote_js} kppdf-backend:/tmp/hash-pw.js && "
        "docker exec kppdf-backend node /tmp/hash-pw.js",
        timeout=60,
    )
    pw_hash = hout.strip().splitlines()[-1] if hout.strip() else ""
    if not pw_hash.startswith("$2"):
        print("FAIL: bcrypt hash", hout, herr, file=sys.stderr)
        sys.exit(1)

    # Update mongo user + rewrite .env + recreate backend (clears softlock memory)
    mongo_js = (
        f"var r = db.users.updateOne({{username:'admin'}}, {{$set:{{passwordHash: {json.dumps(pw_hash)}}}}});\n"
        "printjson(r);\n"
    )
    mb64 = base64.b64encode(mongo_js.encode()).decode()
    run(f"echo {mb64} | base64 -d > /tmp/kppdf-admin-pw.js")
    sudo(
        "docker cp /tmp/kppdf-admin-pw.js kppdf-mongo:/tmp/admin-pw.js && "
        "docker exec kppdf-mongo mongo kppdf /tmp/admin-pw.js",
        timeout=60,
    )

    env_body = (
        f"JWT_SECRET={cfg['JWT_SECRET']}\n"
        f"JWT_REFRESH_SECRET={cfg['JWT_REFRESH_SECRET']}\n"
        f"ADMIN_PASSWORD={new_pw}\n"
        f"CORS_ORIGIN={cfg.get('CORS_ORIGIN', 'https://kppdf-crm.ru')}\n"
        f"KPPDF_DATA_DIR={cfg.get('KPPDF_DATA_DIR', '/var/lib/kppdf80')}\n"
        "TRUST_PROXY=1\n"
    )
    eb64 = base64.b64encode(env_body.encode()).decode()
    run(f"echo {eb64} | base64 -d > /tmp/kppdf.env")
    sudo("cp /tmp/kppdf.env /opt/kppdf-8.0/.env")
    sudo(
        "bash -lc 'cd /opt/kppdf-8.0 && docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps backend'",
        timeout=180,
    )

    for _ in range(30):
        time.sleep(2)
        hout, _ = run("curl -sf -m 5 http://127.0.0.1:3000/api/health/ready || true")
        if "ok" in hout.lower() or '"status"' in hout:
            break

    payload = json.dumps({"username": "admin", "password": new_pw}).encode()
    for label, url in (
        ("LAN", "http://127.0.0.1:3000/api/auth/login"),
        ("PUBLIC", "https://kppdf-crm.ru/api/auth/login"),
    ):
        try:
            req = urllib.request.Request(
                url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read().decode()
                print(f"{label} login: HTTP {resp.status} {body[:80]}")
        except Exception as exc:  # noqa: BLE001
            print(f"{label} login: FAIL {exc}")

    client.close()
    print("OK: admin password updated in config.env / CREDENTIALS.md / mongo / .env")
    print("PASSWORD: (see --password you passed; not echoed)")


if __name__ == "__main__":
    main()
