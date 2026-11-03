import argparse
import json
import os
import sys
from pathlib import Path
from .paths import ROOT
from .plugins import find_suites
from .runner import run_suite
from .report import generate, category
from .handoff import create_handoff
from .masking import mask_obj
from .profiles import load_profile, needs_isolation, select_suites
from .execution import now, commit_hash


def emit(obj):
    print(json.dumps(mask_obj(obj), ensure_ascii=False))


def blocked(name, reason):
    return {'name': name, 'returncode': 2, 'category': 'blocked', 'reason': reason,
            'command': [], 'executed': False, 'commit_hash': commit_hash(), 'started_at': now(), 'finished_at': now()}


def cmd_run(args):
    if not args.profile and not args.suite:
        emit({'error': 'Нужен явный --profile local|night либо --suite. Все suites автоматически не запускаются.'})
        raise SystemExit(2)
    if args.profile and args.suite:
        emit({'error': 'Выберите только профиль или suite'})
        raise SystemExit(2)
    try:
        all_suites = find_suites(ROOT / 'suites')
        profile = load_profile(args.profile) if args.profile else None
        if profile:
            suites, skipped = select_suites(all_suites, profile)
        else:
            suites = [s for s in all_suites if s['name'] == args.suite]
            skipped = [s['name'] for s in all_suites if s not in suites]
        if not suites:
            raise ValueError('suite not found')
    except (ValueError, OSError) as exc:
        results = [blocked('selection', str(exc))]
        rep = generate(results)
        create_handoff(results)
        emit({'error': str(exc), 'report': str(rep)})
        raise SystemExit(2)
    results = []
    env = {}
    problem = None
    if needs_isolation(suites, profile):
        from .stand import check_isolation, StandError
        try:
            if not getattr(args, 'project', None):
                raise StandError('Для test API нужен явный --project и подтверждённый ownership')
            check_isolation(args.project)
            env['NS_PROJECT'] = args.project
        except (StandError, OSError, ValueError) as exc:
            problem = str(exc)
    for suite in suites:
        if problem and (suite.get('needs_stand') or suite['name'] == 'isolation_check'):
            results.append(blocked(suite['name'], problem))
        else:
            results.append(run_suite(suite, timeout_sec=suite.get('timeout_sec', 30), env=env))
    rep = generate(results)
    create_handoff(results)
    categories = [category(r) for r in results]
    emit({'report': str(rep), 'failed': any(c != 'passed' for c in categories),
          'executed': [r['name'] for r in results if r.get('executed')], 'skipped': skipped, 'categories': categories})
    raise SystemExit(2 if any(c in {'runner_error', 'timeout', 'not_implemented', 'blocked'} for c in categories)
                     else 1 if any(c != 'passed' for c in categories) else 0)


def cmd_status(args):
    from .stand import status, StandError
    try:
        info = status(getattr(args, 'project', None))
        reps = sorted((ROOT / 'reports').glob('*/report.json'), key=lambda p: p.stat().st_mtime)
        info['latest_report'] = str(reps[-1]) if reps else None
        emit(info)
    except (StandError, OSError, ValueError) as exc:
        emit({'error': str(exc)})
        raise SystemExit(2)


def cmd_stand(args):
    from .stand import up, down, refresh, status, StandError
    try:
        if args.action == 'refresh':
            if not args.backup or args.project:
                raise StandError('Refresh требует --backup; существующий --project запрещён')
            info = refresh(args.backup)
        elif args.action == 'up':
            if args.project:
                raise StandError('Up всегда создаёт новый уникальный контур; старый project запрещён')
            info = up()
        elif args.action == 'down':
            if not args.project:
                raise StandError('Down требует явный --project и ownership manifest')
            info = down(args.project)
        else:
            info = status(args.project)
        emit(info)
    except (StandError, OSError, ValueError) as exc:
        emit({'error': str(exc)})
        raise SystemExit(2)


def cmd_doctor(args):
    from .doctor import check
    info = check()
    emit(info)
    raise SystemExit(0 if info['ok'] else 2)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(prog='nightshift')
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('run')
    selection = p.add_mutually_exclusive_group(required=True)
    selection.add_argument('--profile')
    selection.add_argument('--suite')
    p.add_argument('--project')
    p.set_defaults(func=cmd_run)
    p = sub.add_parser('status')
    p.add_argument('--json', action='store_true')
    p.add_argument('--project')
    p.set_defaults(func=cmd_status)
    p = sub.add_parser('doctor')
    p.set_defaults(func=cmd_doctor)
    p = sub.add_parser('report')
    p.add_argument('what', nargs='?', choices=['latest'], default='latest')
    p.set_defaults(func=lambda a: cmd_status(a))
    p = sub.add_parser('stand')
    p.add_argument('action', choices=['up', 'status', 'down', 'refresh'])
    p.add_argument('--project')
    p.add_argument('--backup')
    p.set_defaults(func=cmd_stand)
    p = sub.add_parser('scenarios')
    p.add_argument('action', choices=['sync'])
    def scenarios(a):
        from .scenarios import sync_scenarios
        emit({'uncovered': sync_scenarios()})
    p.set_defaults(func=scenarios)
    args = parser.parse_args(argv)
    os.chdir(ROOT)
    args.func(args)


if __name__ == '__main__':
    main()
