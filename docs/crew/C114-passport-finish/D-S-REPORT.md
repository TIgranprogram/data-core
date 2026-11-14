# C114 D-S — техописание, сервер (2026-11-14)
1. ✅ «Взять из состава» ставит часть: `materials-text.ts` partIdsByName (стем «Стойки»↔«Стойка»), `showcase-materials.ts` берёт `products.parts[].lineId` → материал строки состава → `passportParts`. Нет части в справочнике — пусто (не выдумываем). Связь `materials.passportSpec` без partId — в схему не добавлял.
2. ✅ `GET /showcase/:id/techsheet-gaps` → `{ready,missing[]}` (materials, parts, dimensions, weightKg, purpose, installation); `fill-queue` берёт из него materials/parts (остальное уже есть), scope `passport+techsheet`.
Проверки: tsc 0; jest 87 наборов / 872 зелёные; eslint чисто. e2e не гонял; openapi правлен вручную.
Frontend: scope теперь может быть `passport+techsheet`; новые items с target `techsheet` (key materials/parts) ведут во вкладку «Техописание».
