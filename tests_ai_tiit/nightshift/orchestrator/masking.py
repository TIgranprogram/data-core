import re

MASK = "***"
_PATTERNS = [
    (re.compile(r"kppd_[A-Za-z0-9_-]+"), MASK),
    (re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), MASK),
    (re.compile(r"(Bearer\s+)\S+", re.I), r"\1" + MASK),
    (re.compile(r"(://[^:/@\s]+:)[^@\s]+(@)"), r"\1" + MASK + r"\2"),
    (re.compile(r"\b([\w-]*(?:password|passwd|secret|token|api[_-]?key)[\w-]*[\"']?\s*[=:]\s*[\"']?)[^\s\"',;]+", re.I), r"\1" + MASK),
]

def mask_text(text):
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text

def mask_obj(value):
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, dict):
        return {k: mask_obj(v) for k, v in value.items()}
    if isinstance(value, list):
        return [mask_obj(v) for v in value]
    return value
