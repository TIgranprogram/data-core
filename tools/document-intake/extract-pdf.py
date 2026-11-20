"""Получить текст исходного PDF по страницам, ничего не изменяя в документе."""
import json
import sys

try:
    import pymupdf
except ImportError:
    try:
        import fitz as pymupdf
    except ImportError:
        sys.exit(2)

if not hasattr(pymupdf, 'open'):
    sys.exit(2)

limit = int(sys.argv[2])
pages = []
size = 0
with pymupdf.open(sys.argv[1]) as document:
    if not document.is_pdf or document.needs_pass or document.page_count > 100:
        sys.exit(3)
    for page in document:
        text = page.get_text('text', sort=True)
        size += len(text)
        if size > limit:
            sys.exit(3)
        pages.append(text)
sys.stdout.buffer.write(json.dumps(pages, ensure_ascii=False).encode('utf-8'))
