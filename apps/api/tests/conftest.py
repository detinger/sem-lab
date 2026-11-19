import copy
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "packages" / "fixtures" / "synthetic" / "pls-two-construct"
FAKE_ENGINE = Path(__file__).with_name("fake_engine.py")
SENTINEL = "SENTINEL_ROW_VALUE_7f3a91"


def load_fixture():
    model = json.loads((FIXTURE / "model.json").read_text(encoding="utf-8"))
    analyses = json.loads((FIXTURE / "analyses.json").read_text(encoding="utf-8"))
    analysis = next(a["analysis"] for a in analyses if a["analysis"]["engine"] == "r-csem")
    csv = (FIXTURE / "data.csv").read_bytes()
    return model, analysis, csv


@pytest.fixture
def make_settings(tmp_path, monkeypatch):
    def _make(**kw) -> Settings:
        defaults = dict(
            app_env="production",
            data_dir=tmp_path / "data",
            engine_r_command=[sys.executable, str(FAKE_ENGINE)],
            rscript_command=["/nonexistent/Rscript"],
            allowed_origins=["http://localhost:5173"],
            rate_limit_jobs_per_minute=0,
            cancel_grace_seconds=0.5,
            sweep_interval_seconds=3600,
        )
        defaults.update(kw)
        return Settings(**defaults)

    return _make


@pytest.fixture
def make_client(make_settings, monkeypatch):
    clients = []

    def _make(mode: str | None = "ok", **kw):
        if mode is not None:
            monkeypatch.setenv("FAKE_ENGINE_MODE", mode)
        s = make_settings(**kw)
        s.engine_env_extra = {"FAKE_ENGINE_MODE": mode or "ok"}
        client = TestClient(create_app(s))
        client.__enter__()
        clients.append(client)
        client.settings = s
        return client

    yield _make
    for c in clients:
        try:
            c.__exit__(None, None, None)
        except Exception:  # already stopped by the test (restart simulation)
            pass


class Payload:
    def __init__(self):
        self.model, self.analysis, self.csv = load_fixture()

    def files(self, csv: bytes | None = None, model=None, analysis=None, raw_request: str | None = None):
        req = raw_request or json.dumps({"model": model or self.model, "analysis": analysis or self.analysis})
        return {"request": (None, req), "data": ("data.csv", csv if csv is not None else self.csv, "text/csv")}

    def bootstrap_analysis(self, reps=200):
        a = copy.deepcopy(self.analysis)
        a["seed"] = 1234
        a["bootstrap"] = {
            "enabled": True,
            "repetitions": reps,
            "ci": "percentile",
            "confidenceLevel": 0.95,
            "sides": "two-sided",
        }
        return a


@pytest.fixture
def payload():
    return Payload()


TERMINAL = {"complete", "failed", "cancelled"}


def wait_for(client, job_id, states=TERMINAL, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/analysis/jobs/{job_id}")
        assert r.status_code == 200, r.text
        if r.json()["status"] in states:
            return r.json()
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not reach {states}; last={r.json()}")


def submit(client, payload, **kw):
    r = client.post("/api/analysis/jobs", files=payload.files(**kw))
    assert r.status_code == 202, r.text
    return r.json()["id"]
