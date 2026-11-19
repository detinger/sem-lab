"""End-to-end with the real R engine. Skipped unless services/r-engine/bin/run-job exists and R is installed."""

import os
import shutil

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_ENGINE_COMMAND, Settings
from app.main import create_app
from tests.conftest import submit, wait_for

pytestmark = pytest.mark.skipif(
    not (DEFAULT_ENGINE_COMMAND.is_file() and os.access(DEFAULT_ENGINE_COMMAND, os.X_OK) and shutil.which("Rscript")),
    reason="services/r-engine/bin/run-job is missing or not executable, or Rscript is not installed",
)


@pytest.fixture
def real_client(tmp_path):
    s = Settings(data_dir=tmp_path / "data", allowed_origins=[], rate_limit_jobs_per_minute=0, job_timeout_seconds=600)
    with TestClient(create_app(s)) as c:
        yield c


@pytest.mark.parametrize("bootstrap", [False, True], ids=["no-bootstrap", "bootstrap-200"])
def test_real_pls_job(real_client, payload, bootstrap):
    analysis = payload.bootstrap_analysis(200) if bootstrap else None
    jid = submit(real_client, payload, analysis=analysis)
    st = wait_for(real_client, jid, timeout=600)
    assert st["status"] == "complete", st
    result = real_client.get(f"/api/analysis/jobs/{jid}/result").json()  # validated by Pydantic before return
    assert result["provenance"]["engine"] == "r-csem"
    assert result["sample"]["nRows"] == result["sample"]["nUsed"] + result["sample"]["nDropped"]
    if bootstrap:
        assert result["bootstrap"]["requested"] == 200
    else:
        assert "bootstrap" not in result
