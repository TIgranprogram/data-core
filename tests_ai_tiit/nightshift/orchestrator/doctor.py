import importlib.metadata
import platform
import shutil
import subprocess
import sys
from .execution import safe_env
from .masking import mask_obj


def check():
    result = {'os': platform.system(), 'python': platform.python_version(),
              'python_supported': sys.version_info >= (3, 12), 'dependencies': {}, 'tools': {}}
    for name in ['pydantic', 'pyyaml', 'jinja2', 'psutil', 'pytest', 'pytest-xdist']:
        try:
            result['dependencies'][name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result['dependencies'][name] = None
    commands = {'git': ['git', '--version'], 'node': ['node', '--version'],
                'uv': ['uv', '--version'], 'docker': ['docker', '--version'],
                'compose': ['docker', 'compose', 'version'],
                'docker_daemon': ['docker', 'version', '--format', '{{.Server.Version}}']}
    for name, cmd in commands.items():
        if not shutil.which(cmd[0]):
            result['tools'][name] = {'ok': False, 'error': f'{cmd[0]} отсутствует в PATH'}
            continue
        if cmd[0] == 'docker':
            cmd = ['docker', '--context', 'default', *cmd[1:]]
        try:
            r = subprocess.run(cmd, env=safe_env(), capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=10)
            result['tools'][name] = {'ok': r.returncode == 0, 'version': r.stdout.strip(),
                                     'error': r.stderr.strip() if r.returncode else None}
        except (OSError, subprocess.TimeoutExpired) as exc:
            result['tools'][name] = {'ok': False, 'error': str(exc)}
    result['ok'] = result['python_supported'] and all(result['dependencies'].values()) and all(t['ok'] for t in result['tools'].values())
    return mask_obj(result)
