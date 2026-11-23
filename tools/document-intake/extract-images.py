"""C239: только нативные иллюстрации, однозначно связанные с SKU ячейки PDF."""
import base64
import hashlib
import json
import re
import sys

import pymupdf

MAX_TOTAL = 6 * 1024 * 1024
SKU = re.compile(r"(?<![\w-])([A-ZА-ЯЁ]{1,8}-\d{1,6})(?![\w-])", re.I)


def extract(filename):
    document = pymupdf.open(filename)
    if document.is_encrypted or len(document) > 30:
        raise ValueError("PDF недоступен или содержит слишком много страниц")
    assets, rows, warnings = {}, [], []
    total = 0
    for page_number, page in enumerate(document, 1):
        # Метаданные всех вхождений, включая inline: до digest и декодирования.
        metadata = page.get_image_info(hashes=False, xrefs=False)
        if len(metadata) > 200 or any(image["width"] < 1 or image["height"] < 1
                                     or image["width"] > 2560 or image["height"] > 2560
                                     for image in metadata):
            raise ValueError("Ресурс рисунка превышает допустимый размер")
        if sum(image["width"] * image["height"] * 4 for image in metadata) > 32 * 1024 * 1024:
            raise ValueError("Слишком большой суммарный объём рисунков страницы")
        labels = []
        for block in page.get_text("blocks"):
            if block[6] != 0:
                continue
            codes = set(SKU.findall(block[4]))
            # Только ячейка с номером строки и одним кодом, не реквизиты/логотип.
            if len(codes) == 1 and re.match(r"^\s*\d{1,3}\s+", block[4]):
                labels.append((next(iter(codes)).upper(), block[:4], " ".join(block[4].split())))
        for image in page.get_image_info(xrefs=True):
            bbox = image["bbox"]
            candidates = [label for label in labels
                          if label[1][2] < bbox[0]
                          and min(label[1][3], bbox[3]) > max(label[1][1], bbox[1])]
            if len(candidates) != 1:
                warnings.append({"page": page_number, "reason": "Рисунок не связан с единственной строкой SKU"})
                continue
            xref = image.get("xref", 0)
            if not xref or image["width"] > 2560 or image["height"] > 2560:
                raise ValueError("Рисунок требует отдельной проверки размера или формата")
            raw = document.extract_image(xref)
            if raw.get("smask"):
                pix = pymupdf.Pixmap(document, xref)
                pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(document, raw["smask"]))
                data, extension = pix.tobytes("png"), "png"
            else:
                data, extension = raw["image"], raw["ext"]
            if extension == "jpg":
                extension = "jpeg"
            if extension not in ("png", "jpeg") or len(data) > 3 * 1024 * 1024:
                raise ValueError("Для рисунка поддерживаются небольшие PNG/JPEG без изменения байтов")
            digest = hashlib.sha256(data).hexdigest()
            if digest not in assets:
                total += len(data)
                if total > MAX_TOTAL or len(assets) >= 30:
                    raise ValueError("Слишком много данных рисунков")
                assets[digest] = {"sha256": digest, "sizeBytes": len(data), "width": image["width"],
                                  "height": image["height"], "ext": extension,
                                  "mime": "image/" + extension, "base64": base64.b64encode(data).decode("ascii")}
            sku, text_bbox, text = candidates[0]
            rows.append({"sku": sku, "page": page_number, "bbox": list(bbox),
                         "textBBox": list(text_bbox), "label": text, "assetSha256": digest})
    if not rows or len(rows) > 200 or len({row["sku"] for row in rows}) != len(rows):
        raise ValueError("Нет однозначной таблицы рисунков: проверьте исходный PDF")
    return {"extractorVersion": 1, "assets": list(assets.values()), "rows": rows, "warnings": warnings}


if __name__ == "__main__":
    try:
        print(json.dumps(extract(sys.argv[1]), ensure_ascii=False))
    except Exception:
        print(json.dumps({"error": "Не удалось однозначно прочитать рисунки таблицы PDF"}, ensure_ascii=False))
        sys.exit(1)
