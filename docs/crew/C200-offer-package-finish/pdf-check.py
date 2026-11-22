"""Сверка ZIP, трёх независимых заданий печати и подготовленных JPEG бланков."""
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import pypdf
import pypdfium2 as pdfium

proof, source_dir, report_file = map(Path, sys.argv[1:])
report = json.loads(report_file.read_text(encoding="utf-8"))
assert len(report) == 3
total_pages = 0
with zipfile.ZipFile(proof / "package.zip") as archive:
    members = archive.namelist()
    assert len(members) == len(set(members)) == 3
    assert archive.testzip() is None
    for i, row in enumerate(report):
        filename = row["company"] + "_" + row["number"] + ".pdf"
        original = archive.read(filename)
        zipped = pypdf.PdfReader(io.BytesIO(original))
        printed = pdfium.PdfDocument(proof / f"printed-{i + 1}.pdf")
        rendered = pdfium.PdfDocument(original)
        assert len(printed) == len(zipped.pages) == row["pages"] >= 2
        text_by_page = [page.extract_text() for page in zipped.pages]
        assert row["number"] in text_by_page[0]
        assert "Итого: " in text_by_page[-1]
        assert "Итого:" + str(row["total"]) + "₽" in re.sub(r"\s+", "", text_by_page[-1])
        text = "\n".join(text_by_page)
        assert text.count("Итого:") == 1
        assert all(text.count(f"SAMPLE-{n:02}") == 1 for n in range(1, 17))
        for n, page in enumerate(zipped.pages):
            assert abs(float(page.mediabox.width) - 595.28) < 0.5
            assert abs(float(page.mediabox.height) - 841.89) < 0.5
            assert "Наименование" in text_by_page[n]
            # Бланк — полноразмерное фоновое изображение. Фотографии строк меньше и имеют собственные XObject.
            backgrounds = [pic for pic in page.images if all(d > 300 for d in pic.image.size)]
            expected = source_dir / f"reference-{i}-{min(n, 1)}.jpg"
            assert len(backgrounds) == int(expected.is_file()), (i, n)
            if backgrounds:
                assert backgrounds[0].indirect_reference.get_object().get_data() == expected.read_bytes(), (i, n, "Неверное фоновое изображение")
            def raster_digest(doc):
                bitmap = doc[n].render(scale=110 / 72).to_pil()
                return bitmap.size, hashlib.sha256(bitmap.tobytes()).digest()
            assert raster_digest(printed) == raster_digest(rendered), (i, n, "Различие печати и ZIP")
            total_pages += 1
        rendered.close()
        printed.close()
print(f"Проверено документов: {len(report)}. Сверено страниц: {total_pages}.")
