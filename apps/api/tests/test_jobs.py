import json
import os
import signal
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.store import new_job_id
from tests.conftest import submit, wait_for


def job_dir(client, job_id):
    return client.settings.data_dir / "jobs" / job_id


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_lifecycle_complete_with_progress(make_client, payload):
    c = make_client("ok")
    jid = submit(c, payload, analysis=payload.bootstrap_analysis())
    status = wait_for(c, jid)
    assert status["status"] == "complete"
    # request.json and data.csv were written by the API, per the protocol
    req = json.loads((job_dir(c, jid) / "request.json").read_text())
    assert req["protocolVersion"] == 1 and req["jobId"] == jid
    assert req["limits"] == {"maxBootstrap": 10000, "timeoutSeconds": 1800}
    assert (job_dir(c, jid) / "data.csv").read_bytes() == payload.csv
    r = c.get(f"/api/analysis/jobs/{jid}/result")
    assert r.status_code == 200 and r.json()["schemaVersion"] == 1


def test_progress_is_reported_as_written(make_client, payload):
    c = make_client("slow")
    jid = submit(c, payload, analysis=payload.bootstrap_analysis())
    deadline = time.monotonic() + 10
    st = None
    while time.monotonic() < deadline:
        st = c.get(f"/api/analysis/jobs/{jid}").json()
        if st["status"] == "bootstrapping":
            break
        time.sleep(0.05)
    assert st["status"] == "bootstrapping" and st["stage"] == "bootstrapping"
    assert (st["done"], st["total"], st["failed"], st["inadmissible"]) == (0, 1000, 0, 0)
    c.delete(f"/api/analysis/jobs/{jid}")


def test_no_percentage_invented_before_engine_reports(make_client, payload):
    c = make_client("stubborn")
    jid = submit(c, payload)
    st = wait_for(c, jid, {"estimating"})
    assert st["done"] is None and st["total"] is None
    c.delete(f"/api/analysis/jobs/{jid}")


def test_result_not_available_until_complete(make_client, payload):
    c = make_client("slow")
    jid = submit(c, payload)
    r = c.get(f"/api/analysis/jobs/{jid}/result")
    assert r.status_code == 409
    c.delete(f"/api/analysis/jobs/{jid}")


def test_engine_error_becomes_failed_with_code(make_client, payload):
    c = make_client("error")
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed"
    assert st["error"]["code"] == "ENGINE_NONCONVERGENCE"
    assert st["error"]["details"] == {"iterations": 300}
    assert c.get(f"/api/analysis/jobs/{st['id']}/result").status_code == 409


def test_unknown_engine_error_code_is_internal(make_client, payload):
    c = make_client("bad-code")
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"


def test_crash_is_engine_internal(make_client, payload):
    c = make_client("crash")
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"
    assert "exit status 3" in st["error"]["message"]


def test_exit_without_result_is_engine_internal(make_client, payload):
    c = make_client("no-result")
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"


def test_timeout(make_client, payload):
    c = make_client("hang", job_timeout_seconds=1)
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed" and st["error"]["code"] == "TIMEOUT"


def test_cancel_cooperative_and_process_group_gone(make_client, payload):
    c = make_client("slow")
    jid = submit(c, payload)
    wait_for(c, jid, {"bootstrapping"})
    pid = c.app.state.store.get(jid).pid
    assert pid and pid_alive(pid)
    r = c.post(f"/api/analysis/jobs/{jid}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (job_dir(c, jid) / "cancel").exists()
    deadline = time.monotonic() + 5
    while pid_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not pid_alive(pid)
    assert c.get(f"/api/analysis/jobs/{jid}").json()["status"] == "cancelled"
    assert c.get(f"/api/analysis/jobs/{jid}/result").status_code == 409


def test_cancel_escalates_to_sigkill(make_client, payload):
    c = make_client("stubborn", cancel_grace_seconds=0.3)
    jid = submit(c, payload)
    wait_for(c, jid, {"estimating"})
    pid = c.app.state.store.get(jid).pid
    c.post(f"/api/analysis/jobs/{jid}/cancel")
    deadline = time.monotonic() + 5
    while pid_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not pid_alive(pid), "SIGTERM-ignoring engine must be SIGKILLed after the grace period"


def test_delete_cancels_and_removes_files_and_row(make_client, payload):
    c = make_client("slow")
    jid = submit(c, payload)
    wait_for(c, jid, {"bootstrapping"})
    pid = c.app.state.store.get(jid).pid
    assert job_dir(c, jid).exists()
    assert c.delete(f"/api/analysis/jobs/{jid}").status_code == 204
    assert not job_dir(c, jid).exists()
    assert c.app.state.store.get(jid) is None
    assert c.get(f"/api/analysis/jobs/{jid}").status_code == 404
    assert not pid_alive(pid)


def test_delete_completed_job_removes_uploaded_data(make_client, payload):
    c = make_client("ok")
    jid = submit(c, payload)
    wait_for(c, jid)
    assert (job_dir(c, jid) / "data.csv").exists()
    assert c.delete(f"/api/analysis/jobs/{jid}").status_code == 204
    assert not job_dir(c, jid).exists()


def test_malformed_result_fails_job_and_is_not_returned(make_client, payload):
    c = make_client("malformed")
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"
    assert "sample" in st["error"]["message"]  # location only, never the offending value
    assert c.get(f"/api/analysis/jobs/{st['id']}/result").status_code == 409


def test_result_tampered_after_completion_is_withheld_and_job_fails(make_client, payload):
    c = make_client("ok")
    jid = submit(c, payload)
    wait_for(c, jid)
    p = job_dir(c, jid) / "result.json"
    doc = json.loads(p.read_text())
    doc["result"]["parameters"][0]["pValue"] = 7
    p.write_text(json.dumps(doc))
    r = c.get(f"/api/analysis/jobs/{jid}/result")
    assert r.status_code == 500 and r.json()["error"]["code"] == "ENGINE_INTERNAL"
    assert c.get(f"/api/analysis/jobs/{jid}").json()["status"] == "failed"


def test_result_from_wrong_engine_rejected(make_client, payload):
    c = make_client("wrong-engine")
    st = wait_for(c, submit(c, payload))
    assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"


def _insert_job(settings, state, *, pid=None, with_files=True, age_hours=0.0):
    jid = new_job_id()
    d = settings.data_dir / "jobs" / jid
    d.mkdir(parents=True)
    if with_files:
        (d / "data.csv").write_text("a,b\n1,2\n")
    con = sqlite3.connect(str(settings.data_dir / "jobs.sqlite3"))
    t = time.time() - age_hours * 3600
    con.execute(
        "INSERT INTO jobs (id,state,engine,created_at,updated_at,pid) VALUES (?,?,?,?,?,?)",
        (jid, state, "r-csem", t, t, pid),
    )
    con.commit()
    con.close()
    return jid, d


def test_restart_recovery_marks_orphaned_job_failed(make_client, make_settings, payload):
    c = make_client("ok")
    jid, _ = _insert_job(c.settings, "estimating", pid=2_000_000_000)  # a pid that cannot exist
    c.__exit__(None, None, None)  # "stop the API"
    with TestClient(create_app(make_settings(data_dir=c.settings.data_dir))) as c2:
        st = c2.get(f"/api/analysis/jobs/{jid}").json()
        assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"


def test_restart_recovery_accepts_finished_result_and_requeues_queued(make_client, make_settings, payload):
    c = make_client("ok")
    # a job that completed while the API was down: result.json present, state still "estimating"
    done = submit(c, payload)
    wait_for(c, done)
    c.app.state.store.set_state(done, "estimating", only_if_not_terminal=False)
    # a never-started queued job with its files
    qid, qd = _insert_job(c.settings, "queued")
    (qd / "request.json").write_text(
        json.dumps(
            {"protocolVersion": 1, "jobId": qid, "model": payload.model, "analysis": payload.analysis, "limits": {}}
        )
    )
    c.__exit__(None, None, None)
    with TestClient(create_app(make_settings(data_dir=c.settings.data_dir))) as c2:
        assert c2.get(f"/api/analysis/jobs/{done}").json()["status"] == "complete"
        assert wait_for(c2, qid)["status"] == "complete"


def test_status_read_recovers_untracked_running_job(make_client, payload):
    c = make_client("ok")
    jid, _ = _insert_job(c.settings, "bootstrapping", pid=2_000_000_000)
    st = c.get(f"/api/analysis/jobs/{jid}").json()
    assert st["status"] == "failed" and st["error"]["code"] == "ENGINE_INTERNAL"


def test_retention_sweep_deletes_old_jobs_and_orphan_dirs(make_client, payload):
    c = make_client("ok", data_retention_hours=1)
    old, old_dir = _insert_job(c.settings, "complete", age_hours=2)
    fresh = submit(c, payload)
    wait_for(c, fresh)
    assert c.app.state.service.sweep() == 1
    assert not old_dir.exists() and c.app.state.store.get(old) is None
    assert c.app.state.store.get(fresh) is not None


def test_concurrency_limit(make_client, payload, monkeypatch):
    c = make_client("concurrency", max_concurrent_jobs=2)
    c.settings.engine_env_extra["FAKE_ENGINE_SLEEP"] = "0.5"
    ids = [submit(c, payload) for _ in range(5)]
    for i in ids:
        assert wait_for(c, i, timeout=30)["status"] == "complete"
    runner = c.app.state.service.runner
    assert runner.peak_running == 2


def test_queued_job_reports_queued(make_client, payload):
    c = make_client("slow", max_concurrent_jobs=1)
    first = submit(c, payload)
    second = submit(c, payload)
    wait_for(c, first, {"bootstrapping"})
    assert c.get(f"/api/analysis/jobs/{second}").json()["status"] == "queued"
    c.post(f"/api/analysis/jobs/{second}/cancel")
    assert c.get(f"/api/analysis/jobs/{second}").json()["status"] == "cancelled"
    c.delete(f"/api/analysis/jobs/{first}")


def test_engine_gets_no_api_secrets(make_client, payload, monkeypatch):
    from app.runner import engine_env

    monkeypatch.setenv("SOME_API_SECRET", "x")
    monkeypatch.setenv("SEM_STUDIO_RSCRIPT", "/x")
    env = engine_env({"A": "b"})
    assert "SOME_API_SECRET" not in env and env["SEM_STUDIO_RSCRIPT"] == "/x" and env["A"] == "b"


@pytest.mark.skipif(not hasattr(signal, "SIGKILL"), reason="posix only")
def test_job_ids_are_128_bit_urlsafe():
    ids = {new_job_id() for _ in range(100)}
    assert len(ids) == 100 and all(len(i) == 22 for i in ids)
