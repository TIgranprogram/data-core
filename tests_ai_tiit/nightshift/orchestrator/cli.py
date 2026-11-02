import argparse
import json
import os
import sys
from pathlib import Path
from .paths import ROOT
from .plugins import find_suites
from .runner import run_suite
from .report import generate
from .handoff import create_handoff
from .masking import mask_obj
from .profiles import load_profile, needs_isolation, select_suites

def check_isolation(suites):
    gate = next((s for s in suites if s.get("name") == "isolation_check"), None)
    if gate is None:
        return "нет набора isolation_check"
    try:
        r = run_suite(gate, timeout_sec=gate.get("timeout_sec", 30))
    except Exception as e:
        return str(e)
    if r.get("returncode") != 0:
        return (r.get("stdout", "") + r.get("stderr", "")).strip() or f"код {r.get('returncode')}"
    return None

def cmd_run(args):
    try:
        all_suites = find_suites()
        profile = load_profile(args.profile) if args.profile and not args.suite else None
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(2)
    suites = all_suites
    skipped = []
    if args.suite:
        suites = [s for s in suites if s.get("name") == args.suite]
    elif profile:
        suites, skipped = select_suites(suites, profile)
    if not suites:
        print(json.dumps({"error": "suite not found"}, ensure_ascii=False))
        sys.exit(2)
    if needs_isolation(suites, profile):
        problem = check_isolation(all_suites)
        if problem:
            print(json.dumps({"error": "Изоляция стенда не пройдена, прогон остановлен", "detail": mask_obj(problem)}, ensure_ascii=False))
            sys.exit(2)
    results = []
    for s in suites:
        try:
            r = run_suite(s, timeout_sec=s.get("timeout_sec", 30))
        except Exception as e:
            r = {"name": s.get("name"), "returncode": 2, "stdout": "", "stderr": str(e), "timed_out": False, "error": str(e)}
        results.append(r)
    results = mask_obj(results)
    rep = generate(results)
    create_handoff(results)
    failed = any(r.get("returncode") not in (0,) for r in results)
    # сбой самой Ночной смены: если runner упал с исключением/timeout? timeout считается прерыванием, не сбоем приложения.
    nightshift_error = any(r.get("returncode") == 2 for r in results)
    print(json.dumps({"report": str(rep), "failed": failed, "skipped": skipped}, ensure_ascii=False))
    if nightshift_error:
        sys.exit(2)
    sys.exit(1 if failed else 0)

def cmd_status(args):
    print(json.dumps({"status": "idle"}, ensure_ascii=False))

def cmd_report_latest(args):
    reps = sorted(Path("reports").glob("*"))
    if reps:
        print(str(reps[-1]))
    else:
        print("none")

def main(argv=None):
    parser = argparse.ArgumentParser(prog="nightshift")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run")
    p_run.add_argument("--profile", default=None)
    p_run.add_argument("--suite", default=None)
    p_run.set_defaults(func=cmd_run)
    p_status = sub.add_parser("status")
    p_status.add_argument("--json", action="store_true")
    p_status.set_defaults(func=cmd_status)
    p_report = sub.add_parser("report")
    p_report.add_argument("what", nargs="?", default="latest")
    p_report.set_defaults(func=cmd_report_latest)
    # stand
    sp_stand = sub.add_parser("stand")
    sp_stand.add_argument("action", nargs="?", default="refresh")
    def cmd_stand(a):
        import subprocess
        cwd = "stand"
        if a.action == "up":
            r = subprocess.run(["docker", "compose", "up", "-d"], cwd=cwd, capture_output=True, text=True)
        elif a.action == "down":
            r = subprocess.run(["docker", "compose", "down"], cwd=cwd, capture_output=True, text=True)
        elif a.action == "refresh":
            subprocess.run(["docker", "compose", "down"], cwd=cwd, capture_output=True, text=True)
            r = subprocess.run(["docker", "compose", "up", "-d"], cwd=cwd, capture_output=True, text=True)
        else:
            r = subprocess.run(["docker", "compose", "ps"], cwd=cwd, capture_output=True, text=True)
        print(r.stdout + r.stderr)
    sp_stand.set_defaults(func=cmd_stand)
    # stop
    sp_stop = sub.add_parser("stop")
    sp_stop.set_defaults(func=lambda a: print("stop stub"))
    # doctor
    sp_doctor = sub.add_parser("doctor")
    sp_doctor.set_defaults(func=lambda a: print("doctor stub"))
    # scenarios
    sp_scn = sub.add_parser("scenarios")
    sp_scn.add_argument("action", nargs="?", default="sync")
    def cmd_scn(a):
        from .scenarios import sync_scenarios
        unc = sync_scenarios()
        print("Не покрыто тестами:", unc)
    sp_scn.set_defaults(func=cmd_scn)
    args = parser.parse_args(argv)
    os.chdir(ROOT)
    args.func(args)

if __name__ == "__main__":
    main()