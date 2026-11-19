%% markdown
# 03 · Information systems success (inspired by DeLone & McLean) with PLS-SEM

*SEM Lab Colab collection, notebook 3 of 5. Data: **SYNTHETIC** (generated in this
notebook). Estimation: SEM Lab's own engine (Python), no R required.*

**Attribution.** The model is inspired by the updated IS success model: DeLone, W. H., &
McLean, E. R. (2003). The DeLone and McLean model of information systems success: a ten-year
update. *Journal of Management Information Systems, 19*(4), 9–30. It is SEM Lab's teaching
specification, not a replication: the data are **synthetic** and do not reproduce any published
study. This notebook is the Python companion of SEM Lab's example *"Information systems
success (inspired by DeLone & McLean)"* and uses byte-identical data.

### Learning objectives

After this notebook you can

1. assess a six-construct research model with 23 reflective indicators;
2. examine **discriminant validity** with HTMT (and HTMT2), the Fornell–Larcker criterion and
   cross-loadings, and explain why HTMT is preferred;
3. estimate and test **total, total indirect and specific indirect effects** in a model with
   several mediators;
4. use an importance–performance map (IPMA) for net benefits.

### Theory and *illustrative* hypotheses

The three quality dimensions of an information system — system quality (**SYSQ**), information
quality (**INFQ**) and service quality (**SERVQ**) — affect use (**USE**) and user satisfaction
(**SAT**); use also affects satisfaction, and both lead to net benefits (**NB**).

| | Hypotheses (illustrative) |
|---|---|
| H1–H3 | SYSQ, INFQ, SERVQ → USE (+) |
| H4–H6 | SYSQ, INFQ, SERVQ → SAT (+) |
| H7 | USE → SAT (+) |
| H8, H9 | USE → NB (+), SAT → NB (+) |
| H10 | The quality dimensions affect NB only indirectly, through USE and SAT |

The data are synthetic and cross-sectional; the arrows express model assumptions, not
demonstrated causal effects.

%% include setup

%% markdown
## 2. Data: synthetic and reproducible

Six standardised common factors, 23 items on a 1–7 scale. The three quality dimensions are
correlated (0.35–0.45). Thresholds differ by construct (information quality items lean towards
agreement, service quality items towards disagreement), which matters later for IPMA. The code
is extracted unchanged from SEM Lab's generator (`{{GENERATOR_PATH}}`); seed {{SEED}} and
N = {{N}} reproduce the bundled dataset byte for byte.

%% generator

%% include data

%% include model

%% markdown
**Reading the descriptives.** Information quality items have the highest means (about 4.8) and
service quality items the lowest (about 3.5); the other items centre near 4.

## 4. The model

The three quality constructs are exogenous; the model lets them correlate freely (in PLS-SEM,
correlations among exogenous constructs are always part of the model, so the figure lists them
instead of drawing double-headed arrows).

%% code
FIGURES["model.png"] = draw_model(model, title="IS success model (inspired by DeLone & McLean): specification")
plt.show()

%% markdown
## 5. Estimation with SEM Lab's engine

The settings of the SEM Lab example: classic PLS-SEM, path weighting, percentile bootstrap
(seed 20261401) and IPMA with net benefits (NB) as the target. We use B = 5,000 draws (the app
example opens with 1,000 for speed; point estimates are identical, and 5,000 draws with the same
seed in the app give exactly these intervals). The estimation cell took about 7 s on an Apple
M-series laptop; a free Colab CPU can be a few times slower.

%% code
analysis = {
    "method": "pls-sem",
    "engine": "browser",
    "estimator": "pls-pm",
    "missingData": "listwise",
    "seed": 20261401,
    "bootstrap": {"enabled": True, "repetitions": 5000, "ci": "percentile",
                  "confidenceLevel": 0.95, "sides": "two-sided"},
    "pls": {"innerWeighting": "path", "maxIterations": 300, "tolerance": 1e-7},
    "ipma": {"targetConstructId": "c_nb"},
}

%% include estimate_pls

%% markdown
## 6. Measurement model: loadings, reliability, convergent validity

%% code
show(rep["loadings"])
show(rep["quality"][["alpha", "rho_A", "rho_C", "AVE"]])

%% markdown
**Interpretation.** All 23 loadings exceed 0.708, reliabilities lie between 0.70 and 0.95 and
every AVE exceeds 0.50. The measurement model is ready for the discriminant validity check.

## 7. Discriminant validity

Three common criteria, from the most to the least recommended:

- **HTMT**: the mean correlation between items of *different* constructs relative to the
  geometric mean of the mean correlations among items of the *same* construct. Values below
  0.85 (or 0.90 for conceptually close constructs) support discriminant validity. **HTMT2** uses
  geometric instead of arithmetic means and is robust to unequal loadings.
- **Fornell–Larcker**: each construct's AVE should exceed its squared correlations with all
  other constructs (equivalently, √AVE should exceed the correlations). SEM Lab reports the
  matrix as cSEM does: AVE on the diagonal, squared construct correlations off the diagonal. Simulation studies show that it often fails to
  detect problems when loadings are similar and high.
- **Cross-loadings**: each item should load highest on its own construct (a weak criterion).

%% code
FIGURES["htmt.png"] = heatmap_table(rep["htmt"], "HTMT (cells above 0.85 are outlined)", threshold=0.85)
plt.show()
frames = semlab.to_dataframes(result, model)
htmt2 = frames["matrix:htmt2"].set_index("")
htmt2.index.name = None
print("HTMT2:")
show(htmt2.astype(float).where(np.tril(np.ones(htmt2.shape, dtype=bool), -1)))
print("Fornell-Larcker (diagonal: AVE; off-diagonal: squared construct correlations):")
show(rep["fornell-larcker"])

%% code
cross = frames["matrix:cross-loadings"].set_index("")
cross.index.name = None
cross = cross.astype(float)
owner = {i: c["name"] for c in model["constructs"] for i in [names_of(model)[x] for x in c["indicatorIds"]]}
cross["own construct"] = [owner[i] for i in cross.index]
cross["own loading is highest"] = [cross.loc[i, owner[i]] == cross.loc[i, cross.columns[:-1]].max() for i in cross.index]
show(cross)
print("All items load highest on their own construct:", bool(cross["own loading is highest"].all()))

%% markdown
**Interpretation.** The largest HTMT value is far below 0.85, HTMT2 agrees, the Fornell–Larcker
criterion holds (each AVE on the diagonal exceeds the squared correlations in its row and
column; the largest squared correlation is SAT–NB, about 0.33) and every
item loads highest on its own construct. The six constructs are empirically distinct. With
real survey data, use and satisfaction, or satisfaction and net benefits, are the pairs most
likely to come close to the threshold.

## 8. Structural model

%% code
paths = rep["paths"]
show(paths.drop(columns=["key", "from", "to"]), 4)
FIGURES["paths.png"] = coefficient_plot(paths, label_col="path")
plt.show()
show(rep["quality"][["R²", "R² adj."]].dropna())
print("f² (rows: predictor, columns: outcome):")
show(rep["f2"])
print("Structural VIF:")
show(rep["vif"])

%% markdown
**Interpretation.** All nine paths are positive with intervals that exclude zero (H1–H9
supported in this sample). SERVQ → USE has the smallest population value (0.10) but is
estimated at 0.16 here: sampling error can push a small effect up as well as down, which is why
a single sample never "confirms" a population value. The quality dimensions explain little of
USE (R² = 0.17) and almost half of SAT (R² = 0.45); USE and SAT explain 37% of NB. The f² values
show that SAT → NB (0.26) is the only medium-sized effect; most others are small. All structural
VIFs are below 1.3, so the correlated quality dimensions do not create a collinearity problem.

## 9. Indirect effects on net benefits (H10)

There is no direct path from the quality dimensions to NB, so each of their effects on NB is
indirect, and it runs through up to three routes (e.g. SYSQ → USE → NB, SYSQ → SAT → NB and
SYSQ → USE → SAT → NB). SEM Lab reports the **specific indirect effect** of every route with
its own bootstrap interval; for each construct they add up to its total indirect effect.

%% code
eff = rep["effects"]
nb_total = eff[(eff["to"] == "NB") & (eff["effect"] == "total")]
show(nb_total.drop(columns=["key", "from", "to"]), 4)
spec_nb = eff[(eff["to"] == "NB") & (eff["effect"] == "specific indirect")]
show(spec_nb[["route", "est", "se", "ciLower", "ciUpper", "significant (95% CI excludes 0)"]], 4)
check = spec_nb.groupby("from")["est"].sum() - eff[(eff["to"] == "NB") & (eff["effect"] == "total indirect")].set_index("from")["est"]
print(f"sum of specific indirect effects - total indirect effect: max |difference| = {check.abs().max():.1e}")
FIGURES["specific_indirect_nb.png"] = coefficient_plot(
    spec_nb, label_col="route", title=f"Specific indirect effects on NB with 95% bootstrap CIs",
    xlabel="Standardised specific indirect effect")
plt.show()

%% markdown
**Interpretation.** Every quality dimension has a positive total effect on NB that is entirely
indirect. Routes through satisfaction carry the largest effects; three-step routes
(… → USE → SAT → NB) are products of three coefficients and are therefore small, but their
intervals can still exclude zero. Whether you call this "full mediation" depends on the model:
here the direct paths were *not estimated* (fixed at zero by the specification), so the data
cannot show a direct effect even if there were one. A fair test of H10 would add the direct
paths and check that they are close to zero — see the challenges.

%% code
sig = dict(zip(path_dict(paths, model).keys(), paths["significant (95% CI excludes 0)"]))
r2_by_id = {c["id"]: rep["quality"].loc[c["name"], "R²"] for c in model["constructs"]
            if pd.notna(rep["quality"].loc[c["name"], "R²"])}
FIGURES["model_estimated.png"] = draw_model(
    model, title="Estimated model (classic PLS-SEM, standardised)", paths=path_dict(paths, model),
    r2=r2_by_id, significant_paths=sig,
    note="Path labels: coefficients; dashed grey = 95% bootstrap CI includes 0. SYNTHETIC data.")
plt.show()

%% markdown
## 10. IPMA for net benefits

Importance = unstandardised total effect on NB after rescaling every indicator to 0–100 with
its declared endpoints 1 and 7; performance = mean 0–100 construct score.

%% code
ipma_c = pd.DataFrame(semlab.results_tables(result, model)["ipmaConstructs"])
ipma_c = ipma_c[["construct", "importance", "performance", "predecessor"]]
show(ipma_c)
FIGURES["ipma_nb.png"] = ipma_plot(ipma_c, "NB")
plt.show()

%% markdown
**Interpretation.** Satisfaction is the most important driver of net benefits (importance 0.44,
performance 57). Use is the second most important (0.34) but performs only at about 50 of 100:
with high importance and below-average performance it is the clearest improvement candidate.
Among the quality dimensions, system and information quality have the same importance (0.20),
but information quality already performs well (64) while system quality performs at 50, so
system quality is the better lever of the two. Service quality has both the lowest importance
and the lowest performance (42). As always, IPMA is a reading of this model's total effects,
not a causal promise.

## 11. Export

%% code
EXPORT_TABLES = {
    "loadings.csv": rep["loadings"], "reliability_validity.csv": rep["quality"], "htmt.csv": rep["htmt"],
    "htmt2.csv": htmt2, "fornell_larcker.csv": rep["fornell-larcker"], "cross_loadings.csv": cross,
    "paths.csv": rep["paths"], "effects.csv": rep["effects"], "f2.csv": rep["f2"], "vif.csv": rep["vif"],
    "fit.csv": rep["fit"], "ipma_nb_constructs.csv": ipma_c,
}
WORD_TABLES = [
    ("Table 1. Reliability and convergent validity",
     rep["quality"][["alpha", "rho_A", "rho_C", "AVE"]].rename_axis("Construct").reset_index(),
     "SYNTHETIC data (N = 400). Classic PLS-SEM, SEM Lab engine.", 3),
    ("Table 2. Discriminant validity (HTMT)", rep["htmt"].rename_axis("").reset_index(),
     "Values below 0.85 support discriminant validity.", 3),
    ("Table 3. Structural paths with 95% percentile bootstrap intervals",
     paths[["path", "est", "se", "ciLower", "ciUpper"]].rename(
         columns={"path": "Path", "est": "β", "se": "SE", "ciLower": "2.5%", "ciUpper": "97.5%"}),
     "B = 5,000 bootstrap draws, seed 20261401.", 3),
    ("Table 4. Specific indirect effects on net benefits",
     spec_nb[["route", "est", "ciLower", "ciUpper"]].rename(
         columns={"route": "Route", "est": "Effect", "ciLower": "2.5%", "ciUpper": "97.5%"}),
     "Products of the standardised path coefficients along each route.", 3),
]

%% include export

%% markdown
## 12. Summary and questions

- The six-construct measurement model is reliable, convergent and discriminant (HTMT, HTMT2,
  Fornell–Larcker and cross-loadings agree).
- All nine hypothesised paths are positive; the quality dimensions reach net benefits only
  through use and satisfaction, with satisfaction carrying most of the effect.
- IPMA: satisfaction is the key driver of net benefits; use combines high importance with low
  performance; service quality has the lowest performance and importance.

**Questions**

1. Why is HTMT preferred over the Fornell–Larcker criterion?
2. SYSQ → USE → SAT → NB is significant but small. Why are three-step specific indirect effects
   usually small?
3. What is the difference between the total indirect effect of INFQ on NB and its total effect
   here, and why?
4. Why can the IPMA performance of SERVQ be low even though its items were answered on the
   same 1–7 scale as all others?

**Challenges**

1. Add direct paths SYSQ → NB, INFQ → NB and SERVQ → NB to `model["relationships"]` (kind
   `"structural"`), re-estimate with bootstrap and test H10 properly. Are the direct effects
   close to zero? (The population values are exactly zero.)
2. Replace the inner weighting scheme `"path"` by `"factorial"` and `"centroid"`. Which results
   change, and which do not change at all?
