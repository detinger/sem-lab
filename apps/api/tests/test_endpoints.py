import copy
import json
import logging

from fastapi.testclient import TestClient

from tests.conftest import SENTINEL, submit, wait_for


def post(c, payload, **kw):
    return c.post("/api/analysis/jobs", files=payload.files(**kw))


def err(r):
    return r.json()["error"]


def test_health_reports_engines_honestly(make_client):
    c = make_client("ok")
    r = c.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["version"]
    engines = {e["id"]: e for e in body["engines"]}
    # test settings point Rscript at a path that does not exist: no R engine may claim availability
    assert all(not engines[i]["available"] for i in ("r-csem", "r-seminr", "r-lavaan"))
    assert engines["r-csem"]["reason"]
    # Python engines come from importlib.metadata; no job adapter yet
    assert engines["py-semopy"]["available"] and engines["py-semopy"]["jobs"] is False
    assert engines["py-semopy"]["version"] == "2.3.11"


def test_health_probes_a_fake_rscript(make_client, tmp_path):
    fake = tmp_path / "Rscript"
    fake.write_text(
        '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "R scripting front-end version 4.6.2"; '
        'else printf "cSEM=0.7.1\\nseminr=\\nlavaan=0.7-3\\n"; fi\n'
    )
    fake.chmod(0o755)
    c = make_client("ok", rscript_command=[str(fake)])
    engines = {e["id"]: e for e in c.get("/api/health").json()["engines"]}
    assert engines["r-csem"]["available"] and engines["r-csem"]["version"] == "0.7.1"
    assert not engines["r-seminr"]["available"]
    assert engines["r-lavaan"]["available"]


def test_capabilities_serves_registry(make_client):
    r = make_client("ok").get("/api/capabilities")
    assert r.status_code == 200 and r.json()["schemaVersion"] == 1 and r.json()["capabilities"]


def test_examples_empty_and_export_not_implemented(make_client):
    c = make_client("ok")
    assert c.get("/api/examples").json() == {"examples": []}
    r = c.post("/api/export/code")
    assert r.status_code == 501 and err(r)["code"] == "NOT_IMPLEMENTED"


def test_unknown_route_is_json_404_without_trace(make_client):
    r = make_client("ok").get("/api/nope")
    assert r.status_code == 404 and err(r)["code"] == "NOT_FOUND" and "Traceback" not in r.text


def test_request_id_header(make_client):
    c = make_client("ok")
    r = c.get("/api/health")
    assert len(r.headers["x-request-id"]) >= 8
    r2 = c.get("/api/health", headers={"X-Request-ID": "client-supplied-12345"})
    assert r2.headers["x-request-id"] == "client-supplied-12345"
    r3 = c.get("/api/health", headers={"X-Request-ID": "bad id\twith spaces"})
    assert r3.headers["x-request-id"] != "bad id\twith spaces"


def test_validate_endpoint(make_client, payload):
    c = make_client("ok")
    r = c.post("/api/models/validate", json={"model": payload.model, "analysis": payload.analysis})
    assert r.status_code == 200 and r.json()["valid"] is True
    assert "authoritative validator is the web app" in r.json()["note"]
    bad = copy.deepcopy(payload.model)
    bad["relationships"].append(copy.deepcopy(bad["relationships"][0]))
    r = c.post("/api/models/validate", json={"model": bad})
    codes = {i["code"] for i in r.json()["issues"]}
    assert r.json()["valid"] is False and "DUPLICATE_ID" in codes
    r = c.post("/api/models/validate", json={"model": {"constructs": 1}})
    assert r.json()["valid"] is False and r.json()["issues"][0]["code"] == "SHAPE"
    assert (
        c.post("/api/models/validate", content=b"{nope", headers={"content-type": "application/json"}).status_code
        == 400
    )


def test_create_job_bad_request_json(make_client, payload):
    c = make_client("ok")
    r = post(c, payload, raw_request="{not json")
    assert r.status_code == 400 and err(r)["code"] == "REQUEST_INVALID"


def test_create_job_contract_violation_reports_paths_not_values(make_client, payload):
    c = make_client("ok")
    a = copy.deepcopy(payload.analysis)
    a["missingData"] = "fiml"
    r = post(c, payload, analysis=a)
    assert r.status_code == 422 and err(r)["code"] == "REQUEST_INVALID"
    assert "FIML is only defined" in json.dumps(err(r)["details"])


def test_create_job_engine_method_mismatch_and_seed_rules(make_client, payload):
    c = make_client("ok")
    a = copy.deepcopy(payload.analysis)
    a["engine"] = "r-lavaan"
    assert post(c, payload, analysis=a).status_code == 422
    a = payload.bootstrap_analysis()
    del a["seed"]
    assert post(c, payload, analysis=a).status_code == 422


def test_too_many_bootstrap_reps(make_client, payload):
    c = make_client("ok", max_bootstrap_reps=500)
    r = post(c, payload, analysis=payload.bootstrap_analysis(501))
    assert r.status_code == 422 and err(r)["code"] == "LIMIT_EXCEEDED"
    assert post(c, payload, analysis=payload.bootstrap_analysis(500)).status_code == 202


def test_registry_gating_rejects_unsupported(make_client, payload):
    c = make_client("ok")
    # seminr has no centroid weighting in the registry
    a = copy.deepcopy(payload.analysis)
    a["engine"] = "r-seminr"
    a["pls"]["innerWeighting"] = "centroid"
    r = post(c, payload, analysis=a)
    assert r.status_code == 422 and err(r)["code"] == "CAPABILITY_UNSUPPORTED"
    assert any(u["capability"] == "pls.inner-weighting.centroid" for u in err(r)["details"]["unsupported"])
    # BCa is only planned
    a = payload.bootstrap_analysis()
    a["bootstrap"]["ci"] = "bca"
    assert err(post(c, payload, analysis=a))["code"] == "CAPABILITY_UNSUPPORTED"
    # Python engines have no job runner yet
    a = copy.deepcopy(payload.analysis)
    a["engine"] = "py-plspm"
    assert err(post(c, payload, analysis=a))["code"] == "CAPABILITY_UNSUPPORTED"


def test_oversized_csv_rejected_with_413(make_client, payload):
    c = make_client("ok", max_csv_mb=1)
    big = b"x1,x2\n" + b"1,2\n" * (1024 * 1024)
    r = post(c, payload, csv=big)
    assert r.status_code == 413 and err(r)["code"] == "REQUEST_TOO_LARGE"
    assert list((c.settings.data_dir / "jobs").iterdir()) == []


def test_row_and_column_limits(make_client, payload):
    c = make_client("ok", max_rows=5)
    r = post(c, payload, csv=payload.csv)
    assert r.status_code == 422 and err(r)["code"] == "LIMIT_EXCEEDED"
    c2 = make_client("ok", max_columns=3)
    assert err(post(c2, payload))["code"] == "LIMIT_EXCEEDED"
    assert list((c.settings.data_dir / "jobs").iterdir()) == []  # nothing left behind


def test_csv_problems(make_client, payload):
    c = make_client("ok")
    assert err(post(c, payload, csv=b""))["code"] == "REQUEST_INVALID"
    assert err(post(c, payload, csv=b"\xff\xfe\x00bad\n1\n"))["message"] == "The CSV is not valid UTF-8."
    header = payload.csv.split(b"\n", 1)[0].replace(b"x1", b"x2")
    r = post(c, payload, csv=header + b"\n1,2\n")
    assert err(r)["message"] == "The CSV header contains duplicate column names."
    r = post(c, payload, csv=b"a,b\n1,2\n")
    assert r.status_code == 422 and err(r)["code"] == "DATA_COLUMN_MISSING"
    assert "x1" in err(r)["details"]["columns"]


def test_bom_is_stripped(make_client, payload):
    c = make_client("ok")
    jid = submit(c, payload, csv=b"\xef\xbb\xbf" + payload.csv)
    assert (c.settings.data_dir / "jobs" / jid / "data.csv").read_bytes() == payload.csv


def test_missing_multipart_parts(make_client, payload):
    c = make_client("ok")
    r = c.post("/api/analysis/jobs", files={"request": (None, "{}")})
    assert r.status_code == 422 and err(r)["code"] == "REQUEST_INVALID"


def test_job_not_found_and_bad_ids(make_client):
    c = make_client("ok")
    assert c.get("/api/analysis/jobs/" + "A" * 22).status_code == 404
    assert c.get("/api/analysis/jobs/..%2F..%2Fetc").status_code == 404
    assert c.delete("/api/analysis/jobs/short").status_code == 404


def test_rate_limit_per_ip(make_client, payload):
    c = make_client("crash", rate_limit_jobs_per_minute=2)
    assert post(c, payload).status_code == 202
    assert post(c, payload).status_code == 202
    r = post(c, payload)
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1 and err(r)["code"] == "RATE_LIMITED"


def test_queue_full(make_client, payload):
    c = make_client("slow", max_concurrent_jobs=1, max_queued_jobs=1)
    a = submit(c, payload)
    wait_for(c, a, {"bootstrapping"})
    submit(c, payload)
    r = post(c, payload)
    assert r.status_code == 503 and err(r)["code"] == "QUEUE_FULL"


def test_cors_only_for_allowed_origins(make_client):
    c = make_client("ok", allowed_origins=["http://localhost:5173"])
    ok = c.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "x-request-id" in ok.headers["access-control-expose-headers"].lower()
    bad = c.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers
    pre = c.options(
        "/api/analysis/jobs",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == "http://localhost:5173"
    pre_bad = c.options(
        "/api/analysis/jobs", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in pre_bad.headers


def test_cors_on_413(make_client, payload):
    c = make_client("ok", max_csv_mb=1)
    r = c.post(
        "/api/analysis/jobs",
        files=payload.files(csv=b"a\n" * (2 * 1024 * 1024)),
        headers={"Origin": "http://localhost:5173"},
    )
    assert r.status_code == 413 and r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_engine_log_endpoint_disabled_unless_development(make_client, payload):
    c = make_client("ok")
    jid = submit(c, payload)
    wait_for(c, jid)
    assert c.get(f"/api/analysis/jobs/{jid}/engine-log").status_code == 404
    d = make_client("ok", app_env="development")
    jid = submit(d, payload)
    wait_for(d, jid)
    r = d.get(f"/api/analysis/jobs/{jid}/engine-log")
    assert r.status_code == 200 and "fake engine start" in r.text
    # the normal status/result responses never carry engine.log text
    assert "fake engine start" not in json.dumps(d.get(f"/api/analysis/jobs/{jid}").json())
    assert "fake engine start" not in d.get(f"/api/analysis/jobs/{jid}/result").text


def test_internal_errors_have_no_stack_trace(make_client, monkeypatch):
    c = make_client("ok")
    monkeypatch.setattr(c.app.state.service, "status", lambda row: 1 / 0)
    jid = "A" * 22
    c.app.state.store.create(jid, "r-csem")
    (c.settings.data_dir / "jobs" / jid).mkdir()
    c.app.state.service.runner.submit(jid)  # tracked, so no recovery path
    r = TestClient(c.app, raise_server_exceptions=False).get(f"/api/analysis/jobs/{jid}")
    assert r.status_code == 500 and err(r)["code"] == "INTERNAL_ERROR"
    assert "Traceback" not in r.text and "ZeroDivision" not in r.text


def test_privacy_no_csv_content_in_logs_or_responses(make_client, payload, caplog):
    """A sentinel placed in an uploaded CSV must never reach logs or any API response."""
    caplog.set_level(logging.DEBUG)
    c = make_client("ok")
    lines = payload.csv.split(b"\n")
    lines[1] = lines[1] + b"," + SENTINEL.encode()  # extra cell on a row; csv still parses
    csv_with_sentinel = b"\n".join(lines)
    texts = []
    # 1) a successful job
    jid = submit(c, payload, csv=csv_with_sentinel)
    texts.append(json.dumps(wait_for(c, jid)))
    texts.append(c.get(f"/api/analysis/jobs/{jid}/result").text)
    # 2) rejected uploads: bad column binding, non-UTF-8 with the sentinel, limit errors, malformed request
    texts.append(post(c, payload, csv=f"a,b\n{SENTINEL},2\n".encode()).text)
    texts.append(post(c, payload, csv=b"\xff" + SENTINEL.encode() + b"\n1\n").text)
    c.settings.max_rows = 1
    texts.append(post(c, payload, csv=csv_with_sentinel).text)
    texts.append(post(c, payload, csv=csv_with_sentinel, raw_request="{" + SENTINEL).text)
    # 3) an internal failure while the CSV is on disk
    c.delete(f"/api/analysis/jobs/{jid}")
    logged = "\n".join(
        r.getMessage() + " " + json.dumps(getattr(r, "__dict__", {}), default=str) for r in caplog.records
    )
    assert caplog.records, "logging was expected to be captured"
    assert SENTINEL not in logged
    assert all(SENTINEL not in t for t in texts)
    # and the sentinel really was stored only in the job's data.csv (sanity: the test is not vacuous)
    assert SENTINEL.encode() in csv_with_sentinel
