"""Structural-model graph and effects (port of packages/engine/src/pls/effects.ts):
total = (I - B)^-1 - I, total indirect = total - B, specific indirect = product of the path
coefficients along one directed chain of length >= 2 (at most 500 chains)."""

import numpy as np

from .linalg import inverse_r

MAX_SPECIFIC_INDIRECT = 500


def _adjacency(k, edges):
    """Adjacency lists in node order; each list keeps the order of the paths."""
    adj = [[] for _ in range(k)]
    for e in edges:
        adj[e.source].append(e.target)
    return adj


def find_cycle(k, edges):
    """One directed cycle (node indices, first node repeated at the end) or None."""
    adj = _adjacency(k, edges)
    state = [0] * k
    stack = []
    found = []

    def visit(v):
        state[v] = 1
        stack.append(v)
        for w in adj[v]:
            if found:
                return
            if state[w] == 1:
                found.append(stack[stack.index(w) :] + [w])
                return
            if state[w] == 0:
                visit(w)
        stack.pop()
        state[v] = 2

    for v in range(k):
        if not found and state[v] == 0:
            visit(v)
    return found[0] if found else None


def all_paths(k, edges, src, tgt, limit=float("inf")):
    """All directed paths src -> tgt (node lists, source first) in a DAG, depth-first."""
    adj = _adjacency(k, edges)
    out = []

    def walk(v, trail):
        if len(out) >= limit:
            return
        for w in adj[v]:
            if w == tgt:
                out.append(trail + [w])
            else:
                walk(w, trail + [w])

    walk(src, [src])
    return out


class ConnectedPair:
    __slots__ = ("source", "target", "direct", "has_indirect", "specific")

    def __init__(self, source, target, direct, has_indirect, specific):
        self.source = source
        self.target = target
        self.direct = direct
        self.has_indirect = has_indirect
        self.specific = specific


class SpecificChain:
    __slots__ = ("nodes", "source", "target", "via")

    def __init__(self, nodes):
        self.nodes = nodes
        self.source = nodes[0]
        self.target = nodes[-1]
        self.via = nodes[1:-1]


class EffectsSpec:
    __slots__ = ("pairs", "specific", "truncated")

    def __init__(self, pairs, specific, truncated):
        self.pairs = pairs
        self.specific = specific
        self.truncated = truncated


def effects_spec(k, edges, max_specific=MAX_SPECIFIC_INDIRECT):
    """Every ordered pair with at least one directed path, in construct order."""
    pairs = []
    n_specific = 0
    truncated = False
    for s in range(k):
        for t in range(k):
            if s == t:
                continue
            ps = all_paths(k, edges, s, t)
            if not ps:
                continue
            long = [p for p in ps if len(p) >= 3]
            if n_specific + len(long) > max_specific:
                keep = max(0, max_specific - n_specific)
                truncated = truncated or keep < len(long)
                long = long[:keep]
            n_specific += len(long)
            pairs.append(
                ConnectedPair(
                    s,
                    t,
                    any(e.source == s and e.target == t for e in edges),
                    any(len(p) >= 3 for p in ps),
                    long,
                )
            )
    specific = [SpecificChain(nodes) for p in pairs for nodes in p.specific]
    return EffectsSpec(pairs, specific, truncated)


class EffectValues:
    __slots__ = ("total", "indirect", "specific")

    def __init__(self, total, indirect, specific):
        self.total = total
        self.indirect = indirect
        self.specific = specific


def compute_effects(k, edges, path_values, spec):
    """Effects for one vector of path coefficients (`path_values[i]` belongs to `edges[i]`)."""
    B = np.zeros((k, k))
    for e, v in zip(edges, path_values):
        B[e.target, e.source] = v
    eye = np.eye(k)
    inv = inverse_r(eye - B)
    T = inv - eye
    total = [float(T[p.target, p.source]) for p in spec.pairs]
    indirect = [float(T[p.target, p.source] - B[p.target, p.source]) for p in spec.pairs]
    specific = []
    for sp in spec.specific:
        v = 1.0
        for i in range(len(sp.nodes) - 1):
            v *= float(B[sp.nodes[i + 1], sp.nodes[i]])
        specific.append(v)
    return EffectValues(total, indirect, specific)
