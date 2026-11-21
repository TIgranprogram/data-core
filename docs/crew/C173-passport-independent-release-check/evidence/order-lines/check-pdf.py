from hashlib import sha256
import json
from pathlib import Path

from pypdf import PdfReader

root = Path(__file__).resolve().parent
results = []
for row in json.loads((root / 'trace.json').read_text(encoding='utf-8')):
    for revision in (1, 2):
        filename = f"{row['variant']}-r{revision}.pdf"
        path = root / filename
        pages = [page.extract_text() for page in PdfReader(path).pages]
        name = row['previousName'] if revision == 1 else row['name']
        number = row['passportNumber']
        assert f'ПАСПОРТ № {number}' in pages[0]
        assert f"ГАРАНТИЙНЫЙ ТАЛОН № {row['warrantyCode']}" in pages[-1]
        for page in (pages[0], pages[-1]):
            assert name in page and f'Номер изделия: {number}' in page and 'C173 Тестовая фирма' in page
        for page in pages[1:-1]:
            assert f'Паспорт № {number} стр.' in page
        assert 'Заказчик' in pages[-1] and '№ заказа: NAME-' in pages[-1]
        assert '500 × 400 × 450 мм' in '\n'.join(pages)
        results.append(dict(file=filename, pages=len(pages), sha256=sha256(path.read_bytes()).hexdigest(),
                            coverAndCouponName=name, passportNumber=number, warrantyCode=row['warrantyCode']))
print(json.dumps(results, ensure_ascii=False, indent=2))
