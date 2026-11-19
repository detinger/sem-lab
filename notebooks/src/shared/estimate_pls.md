%% code
import time

columns, data_rows = semlab.read_csv("data.csv")
data = semlab.build_analysis_data(model, columns, data_rows, analysis["missingData"])
t0 = time.perf_counter()
out = semlab.estimate(model, analysis, data)
elapsed = time.perf_counter() - t0
if not out["ok"]:
    raise RuntimeError(f"{out['error']['code']}: {out['error']['message']}")
result = out["result"]
est = result["estimation"]
boot = result.get("bootstrap") or {}
print(f"N used: {result['sample']['nUsed']} of {result['sample']['nRows']} rows ({result['sample']['missingData']})")
print(f"converged: {est['converged']} after {est['iterations']} iterations; admissible: {est['admissible']}")
if boot:
    print(f"bootstrap: {boot['completed']} of {boot['requested']} draws completed, {boot['failed']} failed, "
          f"{boot['inadmissible']} inadmissible; seed {boot['seed']}; {boot['ciMethod']} CI, level {boot['confidenceLevel']}")
print(f"estimation incl. bootstrap took {elapsed:.1f} s")
for w in result["warnings"]:
    print(f"warning [{w['code']}]: {w['message']}")
assert est["converged"] and est["admissible"]
rep = pls_report(result, model, semlab)
