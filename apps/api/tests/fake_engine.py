"""A fake engine that follows docs/architecture/engine-protocol.md. Usage: fake_engine.py <job-dir>

Behaviour is chosen by the `mode` the test writes into the environment variable FAKE_ENGINE_MODE.
It never reads or prints data rows.
"""

import json
import os
import signal
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

EXAMPLE = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "examples" / "valid" / "result.shape-example.json"
)


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def progress(job: Path, **ev) -> None:
    with open(job / "progress.ndjson", "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": now(), **ev}) + "\n")
        f.flush()


def write_result(job: Path, doc) -> None:
    tmp = job / "result.json.tmp"
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.rename(tmp, job / "result.json")


def good_result(job: Path) -> dict:
    result = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    req = json.loads((job / "request.json").read_text(encoding="utf-8"))
    result["provenance"]["engine"] = req["analysis"]["engine"]
    return {"ok": True, "result": result}


def main() -> int:
    job = Path(sys.argv[1])
    mode = os.environ.get("FAKE_ENGINE_MODE", "ok")
    print("fake engine start", job.name, flush=True)
    if mode == "crash":
        progress(job, stage="validating")
        return 3
    if mode == "no-result":
        return 0
    if mode == "stubborn":  # ignores SIGTERM: needs SIGKILL
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        progress(job, stage="estimating")
        while True:
            time.sleep(0.1)
    if mode in ("slow", "hang"):
        progress(job, stage="validating")
        progress(job, stage="bootstrapping", done=0, total=1000, failed=0, inadmissible=0)
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
        while True:
            time.sleep(0.1)
            if mode == "slow" and (job / "cancel").exists():
                return 0
    if mode == "concurrency":
        progress(job, stage="estimating")
        time.sleep(float(os.environ.get("FAKE_ENGINE_SLEEP", "0.6")))
        write_result(job, good_result(job))
        return 0

    progress(job, stage="validating")
    progress(job, stage="estimating")
    progress(job, stage="bootstrapping", done=200, total=2000, failed=1, inadmissible=2)
    if mode == "ok-slowish":
        time.sleep(0.5)
    progress(job, stage="summarizing")
    if mode == "error":
        write_result(
            job,
            {
                "ok": False,
                "error": {
                    "code": "ENGINE_NONCONVERGENCE",
                    "message": "did not converge",
                    "details": {"iterations": 300},
                },
            },
        )
    elif mode == "bad-code":
        write_result(job, {"ok": False, "error": {"code": "SOMETHING_ELSE", "message": "x"}})
    elif mode == "malformed":
        doc = good_result(job)
        doc["result"]["sample"]["nUsed"] = 5  # nUsed + nDropped != nRows
        write_result(job, doc)
    elif mode == "wrong-engine":
        doc = good_result(job)
        doc["result"]["provenance"]["engine"] = "r-lavaan"
        write_result(job, doc)
    else:
        write_result(job, good_result(job))
    return 0


if __name__ == "__main__":
    sys.exit(main())
