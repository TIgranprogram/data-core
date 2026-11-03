import tempfile, os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestrator.resume import mark_stage, completed_stages, next_pending

def test_resume():
    with tempfile.TemporaryDirectory() as td:
        db = os.path.join(td, "t.db")
        from orchestrator.db import init_db
        init_db(Path(db))
        mark_stage(1, "static", "done", db=db)
        assert "static" in completed_stages(1, db=db)
        assert next_pending(1, ["static", "regression"], db=db) == "regression"