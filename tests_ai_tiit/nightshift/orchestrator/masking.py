import re

_SECRET_KEY = re.compile(r"(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)", re.I)


def mask_text(text):
    text = str(text)
    text = re.sub(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----", "***", text)
    text = re.sub(r"kppd_[A-Za-z0-9_-]+", "***", text)
    text = re.sub(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+", "***", text)
    text = re.sub(r"(mongodb(?:\+srv)?://)[^/@\s]+@", r"\1***@", text, flags=re.I)
    text = re.sub(r"Bearer\s+[^\s\"']+", "Bearer ***", text, flags=re.I)
    # ENV, CLI, JSON и YAML: в том числе quoted значения с пробелами.
    text = re.sub(r"((?:[\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)[\w-]*)[\"']?\s*(?:[:=]\s*|\s+))([\"'][^\"']*[\"']|[^\s,;}]+)", r"\1***", text, flags=re.I)
    # -p может означать пароль; в отчёте предпочитаем избыточное скрытие project, а не утечку.
    text = re.sub(r"((?:^|\s)-p(?:=|\s+))([\"'][^\"']*[\"']|[^\s,;}]+)", r"\1***", text)
    return text


def mask_obj(obj):
    if isinstance(obj, str):
        return mask_text(obj)
    if isinstance(obj, (list, tuple)):
        out = []
        hide_next = False
        for item in obj:
            out.append('***' if hide_next else mask_obj(item))
            hide_next = isinstance(item, str) and (item == '-p' or (item.startswith('--') and '=' not in item and bool(_SECRET_KEY.search(item))))
        return out
    if isinstance(obj, dict):
        return {mask_text(k): "***" if _SECRET_KEY.search(str(k)) else mask_obj(v) for k, v in obj.items()}
    return obj
