import sqlite3
from pathlib import Path
from .masking import mask_text

def _conn(db="data/nightshift.db"):
    Path(db).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db)
    c.row_factory = sqlite3.Row
    return c

def mark_stage(run_id, stage, status, db="data/nightshift.db"):
    c = _conn(db)
    c.execute("INSERT INTO stages (run_id, name, status) VALUES (?,?,?)", (run_id, mask_text(stage), mask_text(status)))
    c.commit()
    c.close()

def completed_stages(run_id, db="data/nightshift.db"):
    c = _conn(db)
    rows = c.execute("SELECT name FROM stages WHERE run_id=? AND status='done'", (run_id,)).fetchall()
    c.close()
    return [r["name"] for r in rows]

def next_pending(run_id, all_stages, db="data/nightshift.db"):
    done = set(completed_stages(run_id, db))
    for s in all_stages:
        if s not in done:
            return s
    return None
