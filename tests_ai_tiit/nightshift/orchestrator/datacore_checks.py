import argparse
import json
import subprocess
from .paths import ROOT
from .execution import safe_env, now, commit_hash
from .masking import mask_obj

BACKEND = ROOT.parents[1] / 'backend'


def commands(kind):
    modules = BACKEND / 'node_modules'
    if kind == 'static':
        return [
            ['node', str(modules / 'typescript/bin/tsc'), '--noEmit', '--incremental', 'false'],
            ['node', str(modules / 'eslint/bin/eslint.js'), 'src/**/*.ts'],
            ['node', str(BACKEND / 'scripts/pwa-import-check.mjs')],
        ]
    if kind == 'unit':
        return [['node', str(modules / 'jest/bin/jest.js'), '--runInBand', '--silent']]
    raise ValueError('Неизвестный вид DataCore checks')


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=['static', 'unit'])
    args = parser.parse_args(argv)
    code = 0
    for command in commands(args.kind):
        result = {'command': command, 'commit_hash': commit_hash(), 'started_at': now()}
        try:
            proc = subprocess.run(command, cwd=BACKEND, env=safe_env(), capture_output=True,
                                  text=True, encoding='utf-8', errors='replace', timeout=800)
            result.update(returncode=proc.returncode, stdout=proc.stdout, stderr=proc.stderr)
            code = max(code, 1 if proc.returncode else 0)
        except (OSError, subprocess.TimeoutExpired) as exc:
            result.update(returncode=2, error=str(exc))
            code = 2
        result['finished_at'] = now()
        print(json.dumps(mask_obj(result), ensure_ascii=False))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
