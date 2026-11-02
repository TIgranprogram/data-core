import os
import sys

# Проверка изоляции стенда
errors = []

# 1. Порт Mongo стенда не боевой
stand_port = os.environ.get("STAND_MONGO_PORT", "27018")
if stand_port in ("27017",):
    errors.append("стенд использует боевой порт Mongo")

# 2. Имя БД стенда
stand_db = os.environ.get("STAND_DB", "datacore-test")
if not stand_db.endswith("-test") and stand_db != "datacore-night":
    errors.append(f"подозрительное имя БД стенда: {stand_db}")

# 3. Не подключаемся к боевой datacore
if os.environ.get("BOEVE_DB", "") == "datacore":
    errors.append("боевая БД datacore подключена")

# 4. VM :3000 запрещён
if os.environ.get("VM_URL", "").endswith(":3000"):
    errors.append("подключение к VM :3000")

if errors:
    for e in errors:
        print("ISOLATION FAIL:", e)
    sys.exit(1)
print("ISOLATION OK")
sys.exit(0)