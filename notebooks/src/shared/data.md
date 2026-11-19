%% code
# Generate the data with the fixture's seed and N, and prove they are byte-identical to the
# dataset bundled with SEM Lab (packages/fixtures/synthetic/{{CASE_ID}}/data.csv).
import pandas as pd

SEED, N = {{SEED}}, {{N}}
EXPECTED_DATA_SHA256 = "{{DATA_SHA256}}"  # manifest.json of the fixture

pop, profiles, header, rows = {{DATA_FN}}(SEED, N)
csv_data = csv_bytes(header, rows)
data_sha = hashlib.sha256(csv_data).hexdigest()
assert data_sha == EXPECTED_DATA_SHA256, f"data sha256 {data_sha} differs from the fixture's {EXPECTED_DATA_SHA256}"
with open("data.csv", "wb") as f:
    f.write(csv_data)

df = pd.read_csv("data.csv")
print(f"data.csv written: {len(df)} rows x {df.shape[1]} columns, SYNTHETIC")
print(f"sha256 {data_sha} == fixture {{CASE_ID}}: the SEM Lab example uses exactly these bytes")
df.head()

%% markdown
### The population model behind the data

These are the *true* values the generator used. They describe standardised common factors on
the continuous scale, before the responses were cut into categories. A sample estimate will not
reproduce them exactly: there is sampling error (N = {{N}}), discretisation into categories, and
classic PLS-SEM estimates composites, not common factors (its paths are attenuated when
indicators carry measurement error; see the PLSc comparison later).

%% code
pop_loadings = pd.DataFrame(
    [{"construct": c["name"], "indicator": ind, "population loading": lam}
     for c in pop["spec"]["constructs"] for ind, lam in zip(c["indicators"], c["loadings"])])
pop_paths = pd.DataFrame(
    [{"path": f"{s} → {t}", "population coefficient": b} for s, t, b in pop["spec"]["paths"]])
pop_r2 = pd.DataFrame(
    [{"construct": nm, "population R²": 1.0 - pop["Psi"][i][i]}
     for i, nm in enumerate(pop["names"]) if pop["endogenous"][i]])
print("Structural coefficients (standardised):")
display(pop_paths.round(3))
print("Explained variance of the endogenous constructs:")
display(pop_r2.round(3))
print("Standardised loadings:")
display(pop_loadings.pivot_table(index="construct", columns=pop_loadings.groupby("construct").cumcount() + 1,
                                 values="population loading", sort=False).round(2))
