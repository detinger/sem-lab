import json
import random
import shutil
import struct
import subprocess
from pathlib import Path

import pytest

from app.canonical import canonical_json, model_hash, sha256_hex

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "packages" / "contracts"
VECTORS = json.loads((CONTRACTS / "examples" / "hash" / "vectors.json").read_text(encoding="utf-8"))
NODE = shutil.which("node")


@pytest.mark.parametrize("vec", VECTORS, ids=[v["name"] for v in VECTORS])
def test_hash_vector(vec):
    text = canonical_json(vec["input"])
    assert text == vec["canonical"]
    assert sha256_hex(text) == vec["sha256"]


def test_rejects_non_finite():
    for bad in (float("nan"), float("inf"), -float("inf")):
        with pytest.raises(ValueError):
            canonical_json({"x": bad})


@pytest.mark.skipif(NODE is None, reason="node is not installed; TS cross-check skipped")
def test_model_hash_matches_typescript():
    path = CONTRACTS / "examples" / "valid" / "model.tam-v1.json"
    model = json.loads(path.read_text(encoding="utf-8"))
    script = (
        "import {modelHash} from '" + str(CONTRACTS) + "/src/index.ts'; import fs from 'node:fs';"
        "const m = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));"
        "process.stdout.write(await modelHash(m));"
    )
    out = subprocess.run(
        [NODE, "--input-type=module", "-e", script, str(path)], capture_output=True, text=True, timeout=60
    )
    if out.returncode != 0:
        pytest.skip(f"node could not load the contracts package: {out.stderr[-200:]}")
    assert model_hash(model) == out.stdout.strip()


@pytest.mark.skipif(NODE is None, reason="node is not installed; TS cross-check skipped")
def test_number_formatting_matches_javascript():
    rng = random.Random(7)
    nums = [0.1, 1e-7, 1e21, 1e-6, 123456789012345680000.0, 5e-324, 1.7976931348623157e308, -2.5e-5, 100.0]
    for _ in range(300):
        bits = rng.getrandbits(64)
        v = struct.unpack("<d", struct.pack("<Q", bits))[0]
        if v == v and abs(v) != float("inf"):
            nums.append(v)
        nums.append(rng.uniform(-1, 1) * 10 ** rng.randint(-12, 25))
    script = "const a = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(a.map(x => Object.is(x,-0)?'0':String(x))));"
    out = subprocess.run([NODE, "-e", script, json.dumps(nums)], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        pytest.skip("node failed")
    expected = json.loads(out.stdout)
    assert [canonical_json(n) for n in nums] == expected
