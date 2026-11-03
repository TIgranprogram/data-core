import psutil
from datetime import datetime

def snapshot(run_id, db="data/nightshift.db"):
    import sqlite3
    from pathlib import Path
    Path(db).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db)
    c.execute("INSERT INTO metrics (run_id, ts, cpu, ram, disk) VALUES (?,?,?,?,?)",
              (run_id, datetime.now().isoformat(), psutil.cpu_percent(), psutil.virtual_memory().percent, psutil.disk_usage('.').percent))
    c.commit()
    c.close()