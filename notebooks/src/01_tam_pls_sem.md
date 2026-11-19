%% markdown
# 01 · Technology Acceptance Model (TAM) with PLS-SEM

*SEM Studio Colab collection, notebook 1 of 5. Data: **SYNTHETIC** (generated in this
notebook). Estimation: SEM Studio's own engine (Python), no R required.*

**Attribution.** The model follows the core of the Technology Acceptance Model: Davis, F. D.
(1989). Perceived usefulness, perceived ease of use, and user acceptance of information
technology. *MIS Quarterly, 13*(3), 319–340. The data are **synthetic teaching data** generated
by SEM Studio from a stated population model; they do not reproduce any published study.
This notebook is the Python companion of SEM Studio's example *"Technology acceptance (TAM) —
mediation"* and uses byte-identical data.

### Learning objectives

After this notebook you can

1. specify a reflective measurement model and check indicator loadings, reliability
   (Cronbach's α, ρA, ρC), convergent validity (AVE) and discriminant validity (HTMT);
2. estimate structural paths with PLS-SEM and judge them with **bootstrap** confidence intervals;
3. decompose a total effect into a direct and an indirect (mediated) effect, and test the
   indirect effect with a bootstrap interval;
4. report the results in tables and figures, and export them.

### Theory and *illustrative* hypotheses

TAM proposes that people intend to use a technology when they find it useful (perceived
usefulness, **PU**) and easy to use (perceived ease of use, **PEOU**), and that ease of use also
makes a system appear more useful. In this notebook:

| | Hypothesis (illustrative) | Expected sign |
|---|---|---|
| H1 | PEOU → PU | + |
| H2 | PU → BI (behavioural intention) | + |
| H3 | PEOU → BI (direct effect) | + |
| H4 | PU mediates the effect of PEOU on BI (indirect effect PEOU → PU → BI) | + |

The hypotheses are illustrative: they give us something to test. Because the data are
synthetic and cross-sectional, the results can never confirm TAM, and the arrows express the
model's assumptions, **not** demonstrated causal effects.

%% include setup

%% markdown
## 2. Data: synthetic and reproducible

The data are generated from a population model with three standardised common factors
(PEOU, PU, BI). Each respondent's continuous item responses are drawn from the
model-implied multivariate normal distribution and then cut into seven categories (1–7) by
fixed thresholds; the PU items use a "high-agreement" profile, so their answers lean
towards 7. The generator is the one that produced SEM Studio's bundled dataset
(`{{GENERATOR_PATH}}`): the collapsed cell holds its general functions, the visible cell the
population model of this case. With seed {{SEED}} and N = {{N}} the notebook reproduces the
bundled CSV byte for byte, which the cell after them checks with a SHA-256 hash.

%% generator

%% include data

%% include model

%% markdown
**Reading the descriptives.** All items use the full 1–7 range. The PU items have higher means
(about 4.7 against 3.8–4.0) and a slight negative skew because of their high-agreement
profile, a typical pattern for usefulness items. PLS-SEM does not assume normally distributed indicators, but strongly skewed items are
worth noting in a report.

## 4. The model

The figure is drawn from the same canonical model file the app uses. Reflective measurement:
arrows point from each construct to its indicators (the construct is assumed to cause the
item responses). Structural paths connect the constructs.

%% code
FIGURES["model.png"] = draw_model(model, title="TAM: measurement and structural model")
plt.show()

%% markdown
## 5. Estimation with SEM Studio's engine

The analysis settings below are those of the SEM Studio example: classic PLS-SEM (Mode A
weights for reflective blocks), path weighting scheme, at most 300 iterations, tolerance 1e-7,
and a **percentile bootstrap** with a fixed seed so that every run gives identical intervals.

**Bootstrap size.** This notebook uses B = 5,000 draws, a common choice for reporting final
results. The estimation cell took about 4 s on an Apple M-series laptop; a free Colab CPU can be a few times slower (the cell prints its own time). The app's example opens with B = 1,000 for speed; the point
estimates are identical, and setting 5,000 draws with seed 20261103 in the app gives exactly the
intervals shown here, because SEM Studio's bootstrap draws the same resamples in the browser,
in Python and in R.

%% code
analysis = {
    "method": "pls-sem",
    "engine": "browser",          # SEM Studio's engine (here its Python port)
    "estimator": "pls-pm",
    "missingData": "listwise",
    "seed": 20261103,
    "bootstrap": {"enabled": True, "repetitions": 5000, "ci": "percentile",
                  "confidenceLevel": 0.95, "sides": "two-sided"},
    "pls": {"innerWeighting": "path", "maxIterations": 300, "tolerance": 1e-7},
}

%% include estimate_pls

%% markdown
## 6. Measurement model

### Loadings

For reflective indicators we look at the outer loadings (the correlation of each indicator
with its construct score). A common guideline is a loading of at least 0.708, so that the
construct explains at least half of the indicator's variance (loading² ≥ 0.5).

%% code
show(rep["loadings"])
print("Smallest loading:", rep["loadings"].loc[rep["loadings"]["loading"].idxmin(), ["indicator", "loading"]].to_dict())

%% markdown
**Interpretation.** Every loading exceeds 0.708 and every bootstrap interval is far from the
guideline, so all indicators are kept. The population loadings were 0.74–0.88: the estimates
are close, slightly *higher* for most items, because composite loadings also absorb part of each
indicator's own error variance.

### Reliability and convergent validity

| Criterion | Guideline |
|---|---|
| Cronbach's α (lower bound) and ρC (upper bound) | 0.70–0.95 |
| ρA (between them) | 0.70–0.95 |
| AVE | ≥ 0.50 |

%% code
show(rep["quality"][["alpha", "rho_A", "rho_C", "AVE"]])

%% markdown
**Interpretation.** All three constructs are reliable (α, ρA and ρC between 0.83 and 0.93) and
their AVE exceeds 0.50, so each construct explains more than half of its indicators' variance.
None of the values exceeds 0.95, which would suggest redundant item wording.

### Discriminant validity: HTMT

The heterotrait–monotrait ratio estimates the correlation between two constructs as if they
were measured without error. Values below 0.85 (conservative) or 0.90 (liberal, for
conceptually similar constructs) support discriminant validity.

%% code
FIGURES["htmt.png"] = heatmap_table(rep["htmt"], "HTMT (cells above 0.85 are outlined)", threshold=0.85)
plt.show()
show(rep["htmt"])

%% markdown
**Interpretation.** The largest HTMT is well below 0.85, so the three constructs are empirically
distinct. (In the population, the latent correlations are 0.60 for PEOU–PU, 0.50 for PEOU–BI
and 0.62 for PU–BI.)

## 7. Structural model: paths, bootstrap and mediation

%% code
paths = rep["paths"]
show(paths.drop(columns=["key", "from", "to"]), 4)
FIGURES["paths.png"] = coefficient_plot(paths, label_col="path")
plt.show()

%% markdown
**Interpretation.** All three paths are positive and their 95% percentile intervals exclude
zero, so H1–H3 are supported *in this sample*. PEOU → PU is the strongest path. The direct
path PEOU → BI is small (about 0.13). Compare with the population values: PEOU → PU (0.50 vs
0.60) and PEOU → BI (0.13 vs 0.20) are smaller, because classic PLS composites contain
measurement error, which attenuates the correlations between constructs. PU → BI happens to
land on its population value (0.50): attenuation also weakens the control for PEOU in the BI
equation. Sampling error and the discretisation into 7 categories add further differences.
The p values come from a t distribution with B − 1 degrees of freedom and
the bootstrap standard error; the percentile CI is the primary decision rule here.

### R², f² and collinearity

%% code
r2 = rep["quality"][["R²", "R² adj."]].dropna()
show(r2)
print("f² (rows: predictor, columns: outcome):")
show(rep["f2"])
print("Structural VIF (rows: predictor, columns: outcome):")
show(rep["vif"])

%% markdown
**Interpretation.** PEOU explains about a quarter of the variance of PU (R² = 0.25), and PEOU
and PU together explain about a third of BI (R² = 0.33). Effect sizes f² of 0.02, 0.15 and
0.35 are often read as small, medium and large: PEOU → PU (0.33) and PU → BI (0.28) are
medium-to-large, whereas dropping the direct path PEOU → BI would change R²(BI) only
marginally (f² ≈ 0.02). Structural VIFs are far below 3, so collinearity between PEOU and PU
does not distort the BI equation.

### Mediation: direct, indirect and total effects (H4)

%% code
eff = rep["effects"]
show(eff[eff["to"] == "BI"].drop(columns=["key", "from", "to"]), 4)
direct = paths.set_index("path").loc[f"PEOU {ARROW} BI", "est"]
indirect = eff[(eff["effect"] == "total indirect") & (eff["from"] == "PEOU") & (eff["to"] == "BI")].iloc[0]
total = eff[(eff["effect"] == "total") & (eff["from"] == "PEOU") & (eff["to"] == "BI")].iloc[0]
print(f"total {total['est']:.4f} = direct {direct:.4f} + indirect {indirect['est']:.4f} "
      f"(difference {total['est'] - direct - indirect['est']:.1e})")
print(f"VAF (indirect / total) = {indirect['est'] / total['est']:.1%}")

%% code
# The result keeps every bootstrap draw of the paths and of each specific indirect effect.
# Here the only route from PEOU to BI via a mediator is PEOU -> PU -> BI.
specific = eff[(eff["effect"] == "specific indirect") & (eff["from"] == "PEOU") & (eff["to"] == "BI")].iloc[0]
draws = result["bootstrap"]["draws"][specific["key"]]
FIGURES["bootstrap_indirect.png"] = bootstrap_histogram(
    draws, specific["est"], (specific["ciLower"], specific["ciUpper"]), f"indirect effect {specific['route']}")
plt.show()

%% markdown
**Interpretation.** The indirect effect PEOU → PU → BI is the product of the two paths. Its
bootstrap distribution is clearly away from zero and its 95% interval excludes zero, so H4 is
supported: PU mediates the PEOU–BI relationship. Because the direct effect is also significant,
the mediation is *partial* (complementary: direct and indirect effects have the same sign).
The share of the total effect that runs through PU (VAF, variance accounted for) is about two
thirds. The
bootstrap histogram is the reason we test indirect effects by bootstrap: a product of two
coefficients is not normally distributed, so a symmetric "estimate ± 1.96 SE" interval would
be inappropriate.

A causal reading ("ease of use *increases* intention *because* it increases usefulness") needs
more than this design: the data are synthetic and cross-sectional, and alternative models
(e.g. reversed arrows) can fit as well. Report the effects as consistent with mediation, not
as proof of it.

### Estimated model

%% code
sig = {k: v for k, v in zip(path_dict(paths, model).keys(), paths["significant (95% CI excludes 0)"])}
r2_by_id = {c["id"]: rep["quality"].loc[c["name"], "R²"] for c in model["constructs"]
            if pd.notna(rep["quality"].loc[c["name"], "R²"])}
loadings_by_id = {f"i_{r['indicator']}": r["loading"] for _, r in rep["loadings"].iterrows()}
FIGURES["model_estimated.png"] = draw_model(
    model, title="TAM: estimated model (classic PLS-SEM, standardised)", paths=path_dict(paths, model),
    r2=r2_by_id, loadings=loadings_by_id, significant_paths=sig,
    note="Path labels: coefficients; dashed grey = 95% bootstrap CI includes 0. SYNTHETIC data.")
plt.show()

%% markdown
### Global fit (optional in PLS-SEM)

SRMR below 0.08 is a common guideline for an acceptable approximate fit of the *composite*
model. PLS-SEM is primarily a prediction-oriented method, and model fit criteria for PLS are
still debated; report SRMR as supplementary information.

%% code
show(rep["fit"], 4)

%% markdown
## 8. Export

%% code
EXPORT_TABLES = {
    "loadings.csv": rep["loadings"], "reliability_validity.csv": rep["quality"], "htmt.csv": rep["htmt"],
    "paths.csv": rep["paths"], "effects.csv": rep["effects"], "f2.csv": rep["f2"], "fit.csv": rep["fit"],
}
WORD_TABLES = [
    ("Table 1. Reliability and convergent validity",
     rep["quality"][["alpha", "rho_A", "rho_C", "AVE"]].rename_axis("Construct").reset_index(),
     "SYNTHETIC data (N = 500). Classic PLS-SEM, SEM Studio engine.", 3),
    ("Table 2. Structural paths with 95% percentile bootstrap intervals",
     paths[["path", "est", "se", "ciLower", "ciUpper"]].rename(
         columns={"path": "Path", "est": "β", "se": "SE", "ciLower": "2.5%", "ciUpper": "97.5%"}),
     "B = 5,000 bootstrap draws, seed 20261103. SYNTHETIC data.", 3),
    ("Table 3. Effects of PEOU on BI",
     eff[(eff["from"] == "PEOU") & (eff["to"] == "BI")][["effect", "route", "est", "ciLower", "ciUpper"]].rename(
         columns={"effect": "Effect", "route": "Route", "est": "Estimate", "ciLower": "2.5%", "ciUpper": "97.5%"}),
     "Indirect effect = product of the paths PEOU → PU and PU → BI.", 3),
]

%% include export

%% markdown
## 9. Summary and questions

- The reflective measurement model is sound: loadings > 0.708, reliability 0.80–0.93, AVE > 0.5,
  HTMT < 0.85.
- PEOU → PU, PU → BI and PEOU → BI are positive with bootstrap intervals that exclude zero.
- PU partially mediates the effect of PEOU on BI; most of the total effect is indirect.

**Questions**

1. Why is the bootstrap interval of the indirect effect not symmetric around the estimate?
2. The population path PEOU → PU is 0.60 but the estimate is about 0.50. Name two reasons.
3. Which number tells you that collinearity between PEOU and PU is not a problem for BI?
4. Would you call the mediation "full" or "partial"? Which result decides it?

**Challenges**

1. Re-run the estimation with `"repetitions": 1000` and compare the intervals with B = 5,000.
   Then change the seed. Which numbers change, and by how much? What does that tell you about
   reporting the number of draws and the seed?
2. Change `analysis["method"]` to `"plsc"` (consistent PLS) and re-run Sections 5–7. Compare the
   paths with the population values in Section 2 and explain the difference from classic PLS.
