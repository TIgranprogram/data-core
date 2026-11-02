import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestrator.stand import StandError, assert_stand_safe, find_dump, pick_backup

SAFE = "networks:\n  nightshift_net:\n    internal: true\n"


def test_pick_backup_takes_newest_and_ignores_others():
    names = ["datacore-2026-11-01_055351.tgz", "datacore-2026-11-02_030715.tgz", "datacore-2026-11-03_000000.tgz.part", "pull.log"]
    assert pick_backup(names) == "datacore-2026-11-02_030715.tgz"
    assert pick_backup(["pull.log"]) is None


def test_safe_stand_passes():
    assert_stand_safe("datacore-night", SAFE)


@pytest.mark.parametrize("db", ["datacore", "datacore-test", "", None])
def test_wrong_db_is_refused(db):
    with pytest.raises(StandError):
        assert_stand_safe(db, SAFE)


def test_open_network_is_refused():
    with pytest.raises(StandError):
        assert_stand_safe("datacore-night", SAFE.replace("internal: true", "internal: false"))


def test_forbidden_port_is_refused():
    with pytest.raises(StandError):
        assert_stand_safe("datacore-night", SAFE + 'ports:\n  - "127.0.0.1:27018:27017"\n')


def test_find_dump(tmp_path):
    (tmp_path / "mongo-1" / "datacore").mkdir(parents=True)
    assert find_dump(tmp_path).name == "datacore"
    with pytest.raises(StandError):
        find_dump(tmp_path / "mongo-1" / "datacore")
