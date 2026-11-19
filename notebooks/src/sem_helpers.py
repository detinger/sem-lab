# SEM Lab notebook helpers: model figure, charts, tables and export.
# Source: notebooks/src/sem_helpers.py (embedded into every notebook by notebooks/build_notebooks.py).
# Pure matplotlib / pandas; nothing here estimates anything (estimation is semlab_bundle.py).
import html as _html
import json as _json
import math as _math
import os as _os
import zipfile as _zipfile

import matplotlib.pyplot as plt
import numpy as _np
import pandas as pd
from matplotlib.patches import Ellipse, FancyArrowPatch, FancyBboxPatch

# Palette (validated reference palette: blue as the single data hue, grey for "not significant").
INK = "#0b0b0b"
INK_2 = "#52514e"
INK_3 = "#8a8985"
RULE = "#d9d8d4"
BLUE = "#2a78d6"
BLUE_DARK = "#184f95"
BLUE_FILL = "#e3eefb"
GREY_FILL = "#f4f3f0"
ORANGE = "#eb6834"
BLUE_RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
             "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
    "font.size": 10, "axes.edgecolor": RULE, "axes.labelcolor": INK_2, "axes.titlesize": 11,
    "axes.titleweight": "bold", "axes.titlecolor": INK, "xtick.color": INK_2, "ytick.color": INK_2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": False,
    "legend.frameon": False, "figure.dpi": 100, "savefig.dpi": 200, "savefig.bbox": "tight",
})

ARROW = "→"


# ---------------------------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------------------------

def names_of(model):
    """id -> display name for constructs and indicators."""
    out = {c["id"]: c["name"] for c in model["constructs"]}
    out.update({i["id"]: i["name"] for i in model["indicators"]})
    return out


def fmt_p(p):
    if p is None or (isinstance(p, float) and _math.isnan(p)):
        return ""
    return "< .001" if p < 0.001 else f"{p:.3f}".replace("0.", ".", 1)


def significant(row):
    """A two-sided percentile CI that excludes 0 (the decision rule used in these notebooks)."""
    lo, hi = row.get("ciLower"), row.get("ciUpper")
    if lo is None or hi is None or pd.isna(lo) or pd.isna(hi):
        return None
    return bool(lo > 0 or hi < 0)


def ensure_dir(path):
    _os.makedirs(path, exist_ok=True)
    return path


# ---------------------------------------------------------------------------------------------
# Data dictionary and descriptives
# ---------------------------------------------------------------------------------------------

def data_dictionary(model, profiles=None):
    """One row per indicator: column, construct, measurement mode and declared scale."""
    rows = []
    owner = {}
    for c in model["constructs"]:
        for iid in c["indicatorIds"]:
            owner[iid] = c
    for ind in model["indicators"]:
        c = owner[ind["id"]]
        sc = ind.get("scale") or {}
        row = {"column": ind["column"], "construct": c["name"], "construct label": c["label"],
               "measurement": c["measurement"], "level": ind.get("level"),
               "scale min": sc.get("min"), "scale max": sc.get("max")}
        if profiles is not None:
            row["generator profile"] = profiles[ind["column"]]["profile"]
        rows.append(row)
    return pd.DataFrame(rows)


def descriptives(df, model):
    cols = [i["column"] for i in model["indicators"]]
    d = df[cols].agg(["count", "mean", "std", "min", "median", "max", "skew"]).T
    d["count"] = d["count"].astype(int)
    d.index.name = "column"
    return d


def likert_distribution_plot(df, model, title="Response distribution per item"):
    """Horizontal 100% stacked bars of response categories (one light-to-dark blue ramp)."""
    inds = model["indicators"]
    lo = min(i["scale"]["min"] for i in inds)
    hi = max(i["scale"]["max"] for i in inds)
    cats = list(range(lo, hi + 1))
    idx = _np.linspace(0, len(BLUE_RAMP) - 1, len(cats)).round().astype(int)
    colors = [BLUE_RAMP[k] for k in idx]
    order = []
    group_breaks = []
    for c in model["constructs"]:
        cols = [i["column"] for i in inds if i["id"] in c["indicatorIds"]]
        order.extend(cols)
        group_breaks.append((c["name"], len(order)))
    n_items = len(order)
    fig, ax = plt.subplots(figsize=(8.6, 0.9 + 0.27 * n_items))
    y = _np.arange(n_items)[::-1]
    left = _np.zeros(n_items)
    for k, cat in enumerate(cats):
        share = _np.array([(df[col] == cat).mean() * 100 for col in order])
        ax.barh(y, share, left=left, color=colors[k], edgecolor="white", linewidth=1.0, height=0.78,
                label=str(cat))
        left += share
    ax.set_yticks(y, order, fontsize=8)
    ax.set_xlim(0, 100)
    ax.set_xlabel("% of respondents")
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    prev = 0
    for name, end in group_breaks:
        mid = (prev + end - 1) / 2
        ax.text(101.5, y[0] - mid, name, va="center", ha="left", fontsize=9, color=INK, fontweight="bold")
        if prev > 0:
            ax.axhline(y[0] - prev + 0.5, color=INK_3, linewidth=0.6)
        prev = end
    ax.legend(title="Category", ncol=len(cats), loc="lower center", bbox_to_anchor=(0.5, 1.0),
              fontsize=8, title_fontsize=8, handlelength=1.2, columnspacing=0.8)
    ax.set_title(title, pad=34, loc="left")
    fig.tight_layout()
    return fig


# ---------------------------------------------------------------------------------------------
# Model figure (generated from the canonical SemModel)
# ---------------------------------------------------------------------------------------------

_CW, _CH = 1.55, 0.78          # construct ellipse width / height
_IW, _IH = 0.74, 0.32          # indicator box width / height
_DX = 3.7                      # horizontal distance between layers
_ISTEP_V, _ISTEP_H = 0.44, 0.84  # indicator spacing in a vertical / horizontal fan
_FAN = 1.85                    # distance from construct centre to a side fan
_FAN_V = 1.08                  # distance from construct centre to an above/below fan


def _structural(model):
    return [(r["sourceId"], r["targetId"]) for r in model["relationships"] if r["kind"] == "structural"]


def _layers(model):
    ids = [c["id"] for c in model["constructs"]]
    edges = _structural(model)
    layer = {i: 0 for i in ids}
    for _ in range(len(ids)):
        changed = False
        for s, t in edges:
            if layer[t] < layer[s] + 1:
                layer[t] = layer[s] + 1
                changed = True
        if not changed:
            break
    return layer


def _seg_hits_rect(p, q, cx, cy, w, h, steps=60):
    for k in range(steps + 1):
        t = k / steps
        x = p[0] + (q[0] - p[0]) * t
        y = p[1] + (q[1] - p[1]) * t
        if abs(x - cx) <= w / 2 and abs(y - cy) <= h / 2:
            return True
    return False


def _fan_positions(cx, cy, k, side):
    if side in ("left", "right"):
        x = cx - _FAN if side == "left" else cx + _FAN
        return [(x, cy + (k - 1) / 2 * _ISTEP_V - j * _ISTEP_V) for j in range(k)]
    y = cy + _FAN_V if side == "above" else cy - _FAN_V
    return [(cx - (k - 1) / 2 * _ISTEP_H + j * _ISTEP_H, y) for j in range(k)]


def model_layout(model):
    """Deterministic layered left-to-right layout: construct positions and indicator fan sides."""
    cons = model["constructs"]
    ids = [c["id"] for c in cons]
    k_of = {c["id"]: len(c["indicatorIds"]) for c in cons}
    layer = _layers(model)
    edges = _structural(model)
    preds = {i: [s for s, t in edges if t == i] for i in ids}
    succs = {i: [t for s, t in edges if s == i] for i in ids}
    n_layers = max(layer.values()) + 1
    pos = {}
    # layer 0: stacked clusters, top to bottom in model order
    first = [i for i in ids if layer[i] == 0]
    heights = [max(k_of[i] * _ISTEP_V, _CH) + 0.55 for i in first]
    total = sum(heights)
    y = total / 2
    for i, h in zip(first, heights):
        pos[i] = (0.0, y - h / 2)
        y -= h
    # later layers: barycentre of predecessors, then minimum separation
    for L in range(1, n_layers):
        members = [i for i in ids if layer[i] == L]
        for i in members:
            pos[i] = (L * _DX, sum(pos[p][1] for p in preds[i]) / len(preds[i]))
        members.sort(key=lambda i: -pos[i][1])
        sink_layer = all(not succs[i] for i in members)
        for a, b in zip(members, members[1:]):
            gap = (max(k_of[a], k_of[b]) * _ISTEP_V + 0.6) if sink_layer else 2.6
            if pos[a][1] - pos[b][1] < gap:
                pos[b] = (pos[b][0], pos[a][1] - gap)
    # move constructs that sit on a long edge out of its way (alternating up / down)
    direction = 1
    for _ in range(30):
        moved = False
        for s, t in edges:
            if layer[t] - layer[s] < 2:
                continue
            (x1, y1), (x2, y2) = pos[s], pos[t]
            for c in ids:
                if c in (s, t) or not (layer[s] < layer[c] < layer[t]):
                    continue
                xc, yc = pos[c]
                yseg = y1 + (y2 - y1) * (xc - x1) / (x2 - x1)
                if abs(yc - yseg) < 0.9:
                    pos[c] = (xc, yseg + direction * 1.6)
                    direction = -direction
                    moved = True
        if not moved:
            break
    # indicator fan side: fewest collisions with structural edges and other constructs
    segs = [(pos[s], pos[t]) for s, t in edges]
    sides = {}
    for c in cons:
        i = c["id"]
        cands = []
        if layer[i] == 0:
            cands.append("left")
        if not succs[i]:
            cands.append("right")
        cands += ["above", "below", "right"] if layer[i] > 0 else ["above", "below"]
        best, best_score = None, None
        for rank, side in enumerate(dict.fromkeys(cands)):
            score = 0
            for (fx, fy) in _fan_positions(pos[i][0], pos[i][1], k_of[i], side):
                for p, q in segs:
                    if _seg_hits_rect(p, q, fx, fy, _IW + 0.12, _IH + 0.12):
                        score += 1
                for o in ids:
                    if o != i and abs(pos[o][0] - fx) < (_CW + _IW) / 2 + 0.1 and abs(pos[o][1] - fy) < (_CH + _IH) / 2 + 0.1:
                        score += 5
            if best_score is None or score < best_score:
                best, best_score = side, score
        sides[i] = best
    return pos, sides


def _ellipse_point(cx, cy, dx, dy, a=_CW / 2, b=_CH / 2):
    t = 1.0 / _math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
    return cx + dx * t, cy + dy * t


def _box_point(cx, cy, dx, dy, w=_IW, h=_IH):
    tx = (w / 2) / abs(dx) if dx else _math.inf
    ty = (h / 2) / abs(dy) if dy else _math.inf
    t = min(tx, ty)
    return cx + dx * t, cy + dy * t


def _arrow(ax, p, q, color=INK_2, lw=1.1, style="-|>", ls="-", rad=0.0, z=2):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle=style, mutation_scale=11, color=color, lw=lw,
                                 linestyle=ls, shrinkA=0, shrinkB=0, zorder=z,
                                 connectionstyle=f"arc3,rad={rad}"))


def _label(ax, x, y, text, size=8.5, color=INK, weight="normal"):
    ax.text(x, y, text, ha="center", va="center", fontsize=size, color=color, fontweight=weight, zorder=6,
            bbox={"boxstyle": "round,pad=0.18", "fc": "white", "ec": "none", "alpha": 0.95})


def draw_model(model, title=None, paths=None, r2=None, loadings=None, significant_paths=None,
               show_covariances=True, note=None):
    """Draw the SemModel: constructs as ellipses, indicators as boxes, layered left to right.

    Reflective blocks: arrows construct -> indicator. Composite (formative) blocks: indicator ->
    construct. Optional estimates: paths {(srcId, tgtId): value}, r2 {constructId: value},
    loadings {indicatorId: value}; significant_paths {(srcId, tgtId): bool} draws
    non-significant paths dashed and grey."""
    pos, sides = model_layout(model)
    nm = names_of(model)
    ind_by_id = {i["id"]: i for i in model["indicators"]}
    fig, ax = plt.subplots()
    xs, ys = [], []
    for c in model["constructs"]:
        cid = c["id"]
        cx, cy = pos[cid]
        xs += [cx - _CW / 2, cx + _CW / 2]
        ys += [cy - _CH / 2, cy + _CH / 2]
        ax.add_patch(Ellipse((cx, cy), _CW, _CH, fc=BLUE_FILL, ec=BLUE_DARK, lw=1.3, zorder=4))
        txt = c["name"]
        if r2 and r2.get(cid) is not None:
            ax.text(cx, cy + 0.12, txt, ha="center", va="center", fontsize=10.5, fontweight="bold", color=INK, zorder=5)
            ax.text(cx, cy - 0.17, f"R² = {r2[cid]:.2f}", ha="center", va="center", fontsize=8, color=INK_2, zorder=5)
        else:
            ax.text(cx, cy, txt, ha="center", va="center", fontsize=10.5, fontweight="bold", color=INK, zorder=5)
        fan = _fan_positions(cx, cy, len(c["indicatorIds"]), sides[cid])
        reflective = c["measurement"] == "reflective"
        for iid, (fx, fy) in zip(c["indicatorIds"], fan):
            xs += [fx - _IW / 2, fx + _IW / 2]
            ys += [fy - _IH / 2, fy + _IH / 2]
            ax.add_patch(FancyBboxPatch((fx - _IW / 2, fy - _IH / 2), _IW, _IH, boxstyle="round,pad=0,rounding_size=0.05",
                                        fc=GREY_FILL, ec=INK_3, lw=0.9, zorder=4))
            ax.text(fx, fy, ind_by_id[iid]["name"], ha="center", va="center", fontsize=8, color=INK, zorder=5)
            dx, dy = fx - cx, fy - cy
            pc = _ellipse_point(cx, cy, dx, dy)
            pi = _box_point(fx, fy, -dx, -dy)
            if reflective:
                _arrow(ax, pc, pi, color=INK_3, lw=0.8)
            else:
                _arrow(ax, pi, pc, color=INK_3, lw=0.8)
            if loadings and loadings.get(iid) is not None:
                mx, my = (pc[0] + pi[0]) / 2, (pc[1] + pi[1]) / 2
                _label(ax, mx, my, f"{loadings[iid]:.2f}", size=6.5, color=INK_2)
    covs = []
    placed = []
    seg_list = [((s, t), pos[s], pos[t]) for s, t in _structural(model)]
    for r in model["relationships"]:
        s, t = r["sourceId"], r["targetId"]
        (x1, y1), (x2, y2) = pos[s], pos[t]
        if r["kind"] == "structural":
            p = _ellipse_point(x1, y1, x2 - x1, y2 - y1)
            q = _ellipse_point(x2, y2, x1 - x2, y1 - y2)
            ns = significant_paths is not None and significant_paths.get((s, t)) is False
            _arrow(ax, p, q, color=INK_3 if ns else BLUE_DARK, lw=1.0 if ns else 1.5, ls="--" if ns else "-")
            if paths and paths.get((s, t)) is not None:
                lx, ly = _free_spot(p, q, (s, t), seg_list, placed)
                placed.append((lx, ly))
                _label(ax, lx, ly, f"{paths[(s, t)]:.2f}",
                       size=8.5, color=INK_3 if ns else INK, weight="normal" if ns else "bold")
        elif r["kind"] == "covariance":
            covs.append(f"{nm[s]} \u2194 {nm[t]}")
    pad = 0.45
    has_note = bool(note) or (bool(covs) and show_covariances)
    x0, x1_, y0, y1_ = min(xs) - pad, max(xs) + pad, min(ys) - pad - (0.55 if has_note else 0), max(ys) + pad
    ax.set_xlim(x0, x1_)
    ax.set_ylim(y0, y1_)
    ax.set_aspect("equal")
    ax.axis("off")
    scale = 0.78
    fig.set_size_inches(max(6.5, (x1_ - x0) * scale), max(3.5, (y1_ - y0) * scale + (0.5 if title else 0)))
    if title:
        ax.set_title(title, loc="left", fontsize=11.5, pad=8)
    notes = []
    if covs and show_covariances:
        notes.append("Construct covariances in the model (not drawn): " + ", ".join(covs) + ".")
    if note:
        notes.append(note)
    if notes:
        ax.text(x0 + 0.1, y0 + 0.05, "\n".join(notes), fontsize=8, color=INK_2, ha="left", va="bottom")
    return fig


def _dist_point_segment(x, y, p, q):
    (x1, y1), (x2, y2) = p, q
    dx, dy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return _math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def _free_spot(p, q, key, segs, placed):
    """A point along p-q for a path label, away from other paths and labels."""
    best, best_d = None, -1.0
    for f in (0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75):
        x, y = p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f
        d = min([_dist_point_segment(x, y, a, b) for k, a, b in segs if k != key] + [9.0])
        d = min([d] + [_math.hypot(x - lx, y - ly) * 0.6 for lx, ly in placed])
        if d >= 0.45:
            return x, y
        if d > best_d:
            best, best_d = (x, y), d
    return best


def _place_labels(ax, xs, ys, labels, fontsize=9):
    """Annotate points, trying a few offsets so that labels do not overlap each other."""
    fig = ax.figure
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    boxes = []
    offsets = [(7, 4), (7, -13), (-9, 4), (-9, -13), (7, 15), (-9, 15), (7, -24), (-9, -24)]
    for x, y, lab in zip(xs, ys, labels):
        chosen = None
        for ox, oy in offsets:
            ann = ax.annotate(lab, (x, y), xytext=(ox, oy), textcoords="offset points", fontsize=fontsize,
                              color=INK, ha="left" if ox > 0 else "right")
            bb = ann.get_window_extent(renderer).expanded(1.05, 1.15)
            if not any(bb.overlaps(o) for o in boxes):
                chosen = ann
                boxes.append(bb)
                break
            ann.remove()
        if chosen is None:
            ann = ax.annotate(lab, (x, y), xytext=offsets[0], textcoords="offset points", fontsize=fontsize, color=INK)
            boxes.append(ann.get_window_extent(renderer))


def path_dict(paths_df, model, column="est"):
    """{(sourceId, targetId): value} from a paths table that has 'from'/'to' names."""
    by_name = {c["name"]: c["id"] for c in model["constructs"]}
    return {(by_name[r["from"]], by_name[r["to"]]): r[column] for _, r in paths_df.iterrows()}


# ---------------------------------------------------------------------------------------------
# Result charts
# ---------------------------------------------------------------------------------------------

def coefficient_plot(df, label_col="label", title="Path coefficients with 95% bootstrap CIs",
                     xlabel="Standardised path coefficient"):
    """Point estimates with percentile CIs; CIs that include 0 are drawn grey and hollow."""
    d = df.reset_index(drop=True)
    fig, ax = plt.subplots(figsize=(7.2, 0.8 + 0.42 * len(d)))
    y = _np.arange(len(d))[::-1]
    for yy, (_, r) in zip(y, d.iterrows()):
        sig = significant(r)
        col = BLUE if sig else INK_3
        ax.plot([r["ciLower"], r["ciUpper"]], [yy, yy], color=col, lw=2, solid_capstyle="round", zorder=2)
        ax.plot(r["est"], yy, "o", ms=8, color=col if sig else "white", mec=col, mew=2, zorder=3)
        ax.text(r["ciUpper"] + 0.02 * (max(0.0, d["ciUpper"].max()) - min(0.0, d["ciLower"].min())), yy, f"{r['est']:.3f}" + ("" if sig else "  (CI includes 0)"),
                va="center", fontsize=8, color=INK_2)
    ax.axvline(0, color=INK_3, lw=0.8, ls=(0, (3, 2)), zorder=1)
    ax.set_yticks(y, d[label_col])
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    lo = min(0.0, d["ciLower"].min())
    hi = max(0.0, d["ciUpper"].max())
    xr = hi - lo
    ax.set_xlim(lo - 0.06 * xr, hi + 0.30 * xr)
    ax.set_xlabel(xlabel)
    ax.xaxis.grid(True, color="#eeeeec", lw=0.6)
    ax.set_axisbelow(True)
    ax.set_title(title, loc="left")
    fig.tight_layout()
    return fig


def bootstrap_histogram(draws, est, ci, label, title=None):
    draws = _np.asarray([d for d in draws if d is not None], dtype=float)
    fig, ax = plt.subplots(figsize=(6.4, 3.0))
    ax.hist(draws, bins=50, color=BLUE, edgecolor="white", linewidth=0.6)
    ax.axvline(est, color=INK, lw=1.4, label=f"estimate {est:.3f}")
    ax.axvline(ci[0], color=ORANGE, lw=1.2, ls=(0, (4, 2)), label=f"95% percentile CI [{ci[0]:.3f}, {ci[1]:.3f}]")
    ax.axvline(ci[1], color=ORANGE, lw=1.2, ls=(0, (4, 2)))
    ax.axvline(0, color=INK_3, lw=0.8, label="zero")
    ax.legend(loc="upper left", fontsize=8)
    ax.set_ylim(0, ax.get_ylim()[1] * 1.25)
    ax.set_xlabel(label)
    ax.set_ylabel("bootstrap draws")
    ax.set_title(title or f"Bootstrap distribution: {label}", loc="left")
    fig.tight_layout()
    return fig


def ipma_plot(ipma_df, target_name, label_col="construct", title=None):
    """Importance-performance map: x = importance (unstandardised total effect), y = performance (0-100)."""
    d = ipma_df
    fig, ax = plt.subplots(figsize=(6.4, 4.6))
    ax.scatter(d["importance"], d["performance"], s=70, color=BLUE, edgecolor="white", linewidth=1.5, zorder=3)
    mi, mp = d["importance"].mean(), d["performance"].mean()
    ax.axvline(mi, color=INK_3, lw=0.8, ls=(0, (3, 2)))
    ax.axhline(mp, color=INK_3, lw=0.8, ls=(0, (3, 2)))
    xr = d["importance"].max() - min(0, d["importance"].min())
    ax.set_xlim(min(0, d["importance"].min()) - 0.05 * xr, d["importance"].max() + 0.25 * xr)
    yr = max(5.0, d["performance"].max() - d["performance"].min())
    ax.set_ylim(d["performance"].min() - 0.25 * yr, d["performance"].max() + 0.25 * yr)
    ax.text(ax.get_xlim()[1], ax.get_ylim()[0], "high importance,\nlow performance:\nimprovement priority  ",
            ha="right", va="bottom", fontsize=8, color=INK_2)
    ax.set_xlabel(f"Importance (unstandardised total effect on {target_name})")
    ax.set_ylabel("Performance (0-100)")
    ax.grid(True, color="#eeeeec", lw=0.6)
    ax.set_axisbelow(True)
    ax.set_title(title or f"Importance-performance map, target {target_name}", loc="left")
    fig.tight_layout()
    _place_labels(ax, list(d["importance"]), list(d["performance"]), [str(v) for v in d[label_col]])
    return fig


def heatmap_table(df, title, threshold=None, fmt="{:.3f}"):
    """A small annotated matrix (e.g. HTMT); cells above `threshold` are outlined in orange."""
    m = df.astype(float)
    if m.shape[0] > 1 and m.iloc[0].isna().all() and m.iloc[:, -1].isna().all():
        m = m.iloc[1:, :-1]  # lower triangle without the empty first row and last column
    fig, ax = plt.subplots(figsize=(1.2 + 0.85 * m.shape[1], 0.9 + 0.55 * m.shape[0]))
    vals = m.values
    ax.imshow(_np.where(_np.isnan(vals), _np.nan, vals), cmap=_cmap(), vmin=0, vmax=1)
    for i in range(m.shape[0]):
        for j in range(m.shape[1]):
            v = vals[i, j]
            if _np.isnan(v):
                continue
            ax.text(j, i, fmt.format(v), ha="center", va="center", fontsize=8.5,
                    color="white" if v > 0.62 else INK)
            if threshold is not None and v > threshold:
                ax.add_patch(plt.Rectangle((j - 0.5, i - 0.5), 1, 1, fill=False, ec=ORANGE, lw=2))
    ax.set_xticks(range(m.shape[1]), m.columns)
    ax.set_yticks(range(m.shape[0]), m.index)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_title(title, loc="left")
    fig.tight_layout()
    return fig


def _cmap():
    from matplotlib.colors import LinearSegmentedColormap
    return LinearSegmentedColormap.from_list("blue", ["#ffffff"] + BLUE_RAMP[:11])


# ---------------------------------------------------------------------------------------------
# Export: CSV, PNG and a Word-ready table (HTML with inline styles)
# ---------------------------------------------------------------------------------------------

def word_table_html(df, title, note=None, decimals=3, index=False):
    """An APA-style table as HTML with inline styles only. Open the file in a browser, select
    the table, copy, and paste into Word or Google Docs: it arrives as an editable table."""
    d = df.reset_index() if index else df
    cell = "padding:2pt 7pt;font-family:'Times New Roman',Times,serif;font-size:11pt;"
    head = cell + "border-top:1.5pt solid #000;border-bottom:0.75pt solid #000;font-weight:normal;"
    parts = ["<table style=\"border-collapse:collapse;\">",
             (f"<caption style=\"caption-side:top;text-align:left;{cell}padding-left:0;\">"
              f"<b>{_html.escape(title)}</b></caption>"), "<thead><tr>"]
    for k, col in enumerate(d.columns):
        align = "left" if k == 0 else "right"
        parts.append(f"<th style=\"{head}text-align:{align};\">{_html.escape(str(col))}</th>")
    parts.append("</tr></thead><tbody>")
    nrow = len(d)
    for r_i, (_, row) in enumerate(d.iterrows()):
        parts.append("<tr>")
        for k, col in enumerate(d.columns):
            v = row[col]
            if isinstance(v, (float, _np.floating)):
                txt = "" if _np.isnan(v) else f"{v:.{decimals}f}"
            elif v is None:
                txt = ""
            else:
                txt = str(v)
            style = cell + ("text-align:left;" if k == 0 else "text-align:right;")
            if r_i == nrow - 1:
                style += "border-bottom:1.5pt solid #000;"
            parts.append(f"<td style=\"{style}\">{_html.escape(txt)}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table>")
    if note:
        parts.append(f"<p style=\"{cell}font-size:10pt;margin-top:4pt;\"><i>Note.</i> {_html.escape(note)}</p>")
    return "\n".join(parts)


def save_word_tables(path, tables, page_title):
    """Write several Word-ready tables [(title, df, note, decimals)] into one HTML file."""
    body = []
    for title, df, note, decimals in tables:
        body.append(word_table_html(df, title, note, decimals))
        body.append("<p>&nbsp;</p>")
    doc = ("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>" + _html.escape(page_title) +
           "</title></head>\n<body style=\"background:#ffffff;color:#000000;\">\n" + "\n".join(body) + "\n</body></html>\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)
    return path


def save_figure(fig, folder, name):
    ensure_dir(folder)
    p = _os.path.join(folder, name)
    fig.savefig(p)
    return p


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        _json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return path


def zip_folder(folder, zip_path):
    with _zipfile.ZipFile(zip_path, "w", _zipfile.ZIP_DEFLATED) as z:
        for root, _, files in _os.walk(folder):
            for fn in sorted(files):
                full = _os.path.join(root, fn)
                z.write(full, _os.path.relpath(full, _os.path.dirname(folder) or "."))
    return zip_path


def offer_download(path):
    """In Colab, start a browser download; elsewhere just report where the file is."""
    try:
        from google.colab import files  # type: ignore
    except ImportError:
        print(f"Saved {path} (outside Colab: find it in the notebook's working directory).")
        return
    files.download(path)


# ---------------------------------------------------------------------------------------------
# PLS result tables (readable pandas views of semlab.results_tables)
# ---------------------------------------------------------------------------------------------

def _matrix(frames, key):
    m = frames[key].set_index("")
    m.index.name = None
    return m.astype(float)


def pls_report(result, model, semlab):
    """Readable tables from a NormalizedSemResult of a PLS run."""
    t = semlab.to_dataframes(result, model)
    rep = {}
    load = t["loadings"].rename(columns={"from": "construct", "to": "indicator", "est": "loading"})
    load["loading²"] = load["loading"] ** 2
    rep["loadings"] = load[["construct", "indicator", "loading", "loading²", "se", "ciLower", "ciUpper"]].reset_index(drop=True)
    w = t["weights"].rename(columns={"from": "construct", "to": "indicator", "est": "weight"})
    rep["weights"] = w[["construct", "indicator", "weight", "se", "ciLower", "ciUpper"]].reset_index(drop=True)
    cm = t["constructMetrics"].set_index("construct")
    cm.index.name = None
    cols = [c for c in ["cronbach-alpha", "rho-a", "rho-c", "ave", "r2", "r2-adjusted"] if c in cm.columns]
    rep["quality"] = cm[cols].astype(float).rename(columns={"cronbach-alpha": "alpha", "rho-a": "rho_A", "rho-c": "rho_C",
                                                             "ave": "AVE", "r2": "R²", "r2-adjusted": "R² adj."})
    htmt = _matrix(t, "matrix:htmt")
    rep["htmt"] = htmt.where(_np.tril(_np.ones(htmt.shape, dtype=bool), -1))
    rep["fornell-larcker"] = _matrix(t, "matrix:fornell-larcker")
    paths = t["paths"].copy()
    paths["path"] = paths["from"] + f" {ARROW} " + paths["to"]
    paths["significant (95% CI excludes 0)"] = [significant(r) for _, r in paths.iterrows()]
    rep["paths"] = paths[["path", "key", "from", "to", "est", "se", "statistic", "pValue", "ciLower", "ciUpper",
                          "significant (95% CI excludes 0)"]].reset_index(drop=True)
    rep["f2"] = _matrix(t, "matrix:f2").dropna(how="all").dropna(axis=1, how="all")
    rep["vif"] = _matrix(t, "matrix:vif-structural").dropna(how="all").dropna(axis=1, how="all")
    eff = t["effects"].copy()
    if len(eff):
        eff["effect"] = eff["kind"].map({"total-effect": "total", "indirect-effect": "total indirect",
                                         "specific-indirect": "specific indirect"})
        eff["route"] = [
            f"{r['from']} {ARROW} " + (f"{r['via'].replace(' -> ', f' {ARROW} ')} {ARROW} " if isinstance(r["via"], str) and r["via"] else "") + r["to"]
            for _, r in eff.iterrows()]
        eff["significant (95% CI excludes 0)"] = [significant(r) for _, r in eff.iterrows()]
        rep["effects"] = eff[["effect", "route", "key", "from", "to", "est", "se", "pValue", "ciLower", "ciUpper",
                              "significant (95% CI excludes 0)"]].reset_index(drop=True)
    else:
        rep["effects"] = eff
    rep["fit"] = t["fit"][["name", "value"]].set_index("name")
    rep["warnings"] = t["warnings"]
    return rep


def show(df, decimals=3):
    """Display a DataFrame rounded for reading (the unrounded numbers stay in the variable)."""
    try:
        from IPython.display import display
    except ImportError:  # pragma: no cover
        print(df.round(decimals).to_string())
        return
    display(df.round(decimals))
