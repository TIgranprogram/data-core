"""Переместить закрытый оригинал, удерживая исключительную аренду ядра Linux."""
import errno
import fcntl
import hashlib
import os
import signal
import stat
import sys

source, target = sys.argv[1:]
signal.signal(signal.SIGIO, signal.SIG_IGN)
try:
    descriptor = os.open(source, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
except OSError as error:
    if error.errno in (errno.EACCES, errno.ENOENT, errno.ELOOP, errno.EAGAIN):
        sys.exit(3)
    raise

with os.fdopen(descriptor, 'rb') as stream:
    try:
        fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_WRLCK)
    except OSError as error:
        if error.errno in (errno.EAGAIN, errno.EACCES):
            sys.exit(3)
        if error.errno in (errno.EINVAL, errno.ENOSYS, errno.EOPNOTSUPP, errno.EPERM):
            sys.exit(4)
        raise
    before = os.fstat(descriptor)
    try:
        named = os.stat(source, follow_symlinks=False)
    except FileNotFoundError:
        sys.exit(3)
    if not stat.S_ISREG(named.st_mode) or named.st_ino != before.st_ino or named.st_dev != before.st_dev or named.st_nlink != 1:
        sys.exit(3)
    # Каталог назначения только что создан с уникальным ID и недоступен другим обработчикам.
    if os.path.lexists(target):
        sys.exit(5)
    os.rename(source, target)
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1 << 20), b''):
        digest.update(block)
    after = os.fstat(descriptor)
    if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
        sys.exit(5)
    print(digest.hexdigest())
