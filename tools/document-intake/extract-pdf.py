"""Получить текст исходного PDF по страницам, ничего не изменяя в документе."""
import base64
import json
import re
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

ROLE = re.compile(
    r"\s*(?:(?:муниципальный|государственный)\s+)?"
    r"(поставщик|исполнитель|продавец|подрядчик|покупатель|заказчик|получатель|плательщик)\s*:?\s*",
    re.IGNORECASE,
)
SELLER = {"поставщик", "исполнитель", "продавец", "подрядчик"}
INN = re.compile(r"\s*ИНН(?:\s*(?:[/\\]|и)\s*КПП)?\s*[:№]?\s*(?:\d{12}|\d{10})(?!\d)", re.IGNORECASE)


def party_columns(page, number):
    """Берём реквизиты под двумя явными заголовками на одной высоте."""
    lines = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            if line["dir"] == (1.0, 0.0):
                text = "".join(span["text"] for span in line["spans"]).strip()
                if text:
                    lines.append((line["bbox"], text))
    headings = [(box, match[1].lower() in SELLER) for box, text in lines if (match := ROLE.fullmatch(text))]
    headings.sort(key=lambda item: item[0][0])
    for i, (left, left_seller) in enumerate(headings):
        for right, right_seller in headings[i + 1:]:
            if left_seller == right_seller or right[0] - left[2] < 24 or abs(left[1] - right[1]) > 4:
                continue
            pair = []
            for heading, edge in ((left, right[0] - 8), (right, page.rect.x1 + 1)):
                lane = [(box, text) for box, text in lines
                        if abs(box[0] - heading[0]) <= 12 and box[2] < edge and heading[1] - 1 <= box[1] <= heading[1] + 128]
                lane.sort(key=lambda item: item[0][1])
                tax = [index for index, (_, text) in enumerate(lane) if INN.match(text)]
                if len(tax) != 1 or not 2 <= tax[0] <= 8 or any(ROLE.fullmatch(text) for _, text in lane[1:tax[0]]):
                    break
                quote = "\n".join(text for _, text in lane[:tax[0] + 1])
                if not ROLE.fullmatch(lane[0][1]) or len(quote) > 650:
                    break
                pair.append({"page": number, "quote": quote})
            if len(pair) == 2:
                yield from pair


limit = int(sys.argv[2])
columns = len(sys.argv) == 4 and sys.argv[3] == "--party-columns"
render = len(sys.argv) == 5 and sys.argv[3] == "--images"
pages = []
size = 0
with pymupdf.open(sys.argv[1]) as document:
    if not document.is_pdf or document.needs_pass or document.page_count > 100:
        sys.exit(3)
    selected = set(json.loads(sys.argv[4])[:4]) if render else set()
    for index, page in enumerate(document, 1):
        if render:
            if index in selected and 0 < max(page.rect.width, page.rect.height):
                scale = 1700 / max(page.rect.width, page.rect.height)
                pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                jpeg = pix.tobytes("jpeg", jpg_quality=86)
                pages.append({"page": index, "jpeg": base64.b64encode(jpeg).decode("ascii")})
            continue
        if columns:
            pages.extend(party_columns(page, index))
            if len(pages) > 20:
                pages = []
                break
            continue
        text = page.get_text('text', sort=True)
        size += len(text)
        if size > limit:
            sys.exit(3)
        pages.append(text)
sys.stdout.buffer.write(json.dumps(pages, ensure_ascii=False).encode('utf-8'))
