#!/usr/bin/env python3
"""
SMT proofs of the per-node facts the property tests can only sample.

Property-based testing tells you a claim survived a few hundred thousand
points.  These are proofs over the reals: each lemma asserts the *negation* of
the claim and asks Z3 for a model.  `unsat` means no counterexample exists
anywhere, which is what "sound" has to mean for a field the mesher trusts.

Run with `./check.sh` (or `python3 lemmas.py`).  Exit status is non-zero if any
lemma fails to discharge.
"""

import sys
from z3 import (
    Real, Int, Reals, Solver, And, Or, Not, Implies, ForAll, sat, unsat,
    If, Sqrt, RealVal,
)

results = []


def lemma(name, solver, note=""):
    """A lemma holds when its negation is unsatisfiable."""
    status = solver.check()
    ok = status == unsat
    results.append((name, ok, status, note))
    return ok


def norm_sq(v):
    return sum(c * c for c in v)


# ---------------------------------------------------------------------------
# 1+2. Ellipsoid soundness and 1-Lipschitz.
#
#    Both reduce to the same two facts about f(p) = (|p/r| - 1) * min(r).
#    Writing them with symbolic radii under square roots leaves nlsat with a
#    problem it does not return from, so they are split into the two steps the
#    pen-and-paper argument uses, each of which is small enough to decide:
#
#      (A) reverse triangle inequality:  | |u| - |v| | <= |u - v|
#      (B) anisotropy bound:             min(r) * |w| <= |r (*) w|
#
#    Soundness: for q on the surface, |q/r| = 1, so with u = p/r, v = q/r,
#      f(p) = (|u| - |v|) * min(r) <=(A) |u - v| * min(r) <=(B) |p - q|.
#    Lipschitz is the same chain with v = q/r for an arbitrary q.
# ---------------------------------------------------------------------------
def reverse_triangle():
    s = Solver()
    s.set('timeout', 60000)
    ux, uy, uz = Reals('ux uy uz')
    vx, vy, vz = Reals('vx vy vz')
    a, b, c = Reals('a b c')
    s.add(a >= 0, a * a == norm_sq([ux, uy, uz]))
    s.add(b >= 0, b * b == norm_sq([vx, vy, vz]))
    s.add(c >= 0, c * c == norm_sq([ux - vx, uy - vy, uz - vz]))
    s.add(Or(a - b > c, b - a > c))                  # negation
    return lemma(
        '(A) reverse triangle inequality on 3-vectors', s,
        '| |u| - |v| | <= |u - v|',
    )


def anisotropy_bound():
    s = Solver()
    s.set('timeout', 60000)
    rx, ry, rz = Reals('rx ry rz')
    wx, wy, wz = Reals('wx wy wz')
    m = Real('m')
    s.add(rx > 0, ry > 0, rz > 0)
    s.add(m == If(And(rx <= ry, rx <= rz), rx, If(ry <= rz, ry, rz)))
    # Squared form, so no roots are needed: m^2 |w|^2 <= |r (*) w|^2.
    s.add(m * m * norm_sq([wx, wy, wz]) > norm_sq([rx * wx, ry * wy, rz * wz]))
    return lemma(
        '(B) min(r) * |w| <= |r (*) w| for every w', s,
        'the step that lets a scaled sphere bound Euclidean distance',
    )


def ellipsoid_chain():
    """Given (A) and (B), the two ellipsoid properties follow by arithmetic."""
    s = Solver()
    s.set('timeout', 60000)
    ku, kv, duv, dpq, m, f = Reals('ku kv duv dpq m f')
    s.add(m > 0, ku >= 0, kv >= 0, duv >= 0, dpq >= 0)
    s.add(ku - kv <= duv, kv - ku <= duv)            # (A)
    s.add(m * duv <= dpq)                            # (B)
    s.add(f == (ku - kv) * m)
    s.add(Or(f > dpq, kv * m - ku * m > dpq))        # negation of both bounds
    return lemma(
        'ellipsoid: soundness and 1-Lipschitz follow from (A) and (B)', s,
        'f(p) = (|p/r| - |q/r|) * min(r) is bounded by |p - q| in both directions',
    )


# ---------------------------------------------------------------------------
# 3. The linear-pattern window contains every instance that can reach a point.
#
#    This is the #69 fix.  Spacing is scaled to 1 without loss of generality —
#    the whole construction is invariant under scaling lo, hi and t together.
#
#    A copy spans [lo + i, hi + i].  The evaluator searches instances
#    base .. base + W - 1 where base = clamp(floor(t - hi) - 1, 0, count - W).
#    The claim: any instance whose span contains t is in that range.
# ---------------------------------------------------------------------------
def linear_window_covers():
    s = Solver()
    s.set('timeout', 60000)
    lo, hi, t = Reals('lo hi t')
    count, W, i, fb, base = Int('count'), Int('W'), Int('i'), Int('fb'), Int('base')

    s.add(lo <= hi, count >= 2, i >= 0, i < count)

    # W = min(count, ceil(hi - lo) + 3): either it saturates at count, or it
    # covers the child's span with two cells to spare.
    s.add(W >= 1, W <= count, Or(W == count, W >= (hi - lo) + 3))

    # fb = floor(t - hi)
    s.add(fb <= t - hi, t - hi < fb + 1)

    # base = clamp(fb - 1, 0, count - W)
    s.add(base == If(fb - 1 < 0, 0, If(fb - 1 > count - W, count - W, fb - 1)))

    # Instance i's span contains t ...
    s.add(lo + i <= t, t <= hi + i)
    # ... but the search window misses it.
    s.add(Or(i < base, i > base + W - 1))
    return lemma(
        'linearPattern window contains every instance overlapping the point', s,
        'the #69 fix: spacing normalised to 1, base = clamp(floor(t-hi)-1, 0, count-W)',
    )


# ---------------------------------------------------------------------------
# 4. The old +/-1 window did NOT have that property — expect a counterexample.
#
#    A lemma that is supposed to fail: it pins down that the bug was real and
#    that the proof above is not vacuous.
# ---------------------------------------------------------------------------
def old_window_is_unsound():
    s = Solver()
    s.set('timeout', 60000)
    lo, hi, t = Reals('lo hi t')
    count, i, idx, cl = Int('count'), Int('i'), Int('idx'), Real('cl')

    s.add(lo <= hi, count >= 2, i >= 0, i < count)
    # clamped = clamp(t, 0, count - 1); idx = round(clamped)
    s.add(cl == If(t < 0, 0, If(t > count - 1, count - 1, t)))
    s.add(idx <= cl + RealVal(1) / 2, cl - RealVal(1) / 2 <= idx)
    s.add(lo + i <= t, t <= hi + i)
    s.add(Or(i < idx - 1, i > idx + 1))
    status = s.check()
    ok = status == sat                    # a counterexample is the point here
    results.append(('old +/-1 window admits a missed instance (expected sat)',
                    ok, status, 'demonstrates #69 was a real defect'))
    return ok


# ---------------------------------------------------------------------------
# 5. A capsule shorter than its diameter is exactly a sphere at the origin.
# ---------------------------------------------------------------------------
def capsule_degenerate():
    s = Solver()
    s.set('timeout', 60000)
    r, h = Reals('r h')
    px, py, pz = Reals('px py pz')
    s.add(r > 0, h > 0, h <= 2 * r)

    half = If(h / 2 - r > 0, h / 2 - r, 0)            # the max(0, ...) guard
    clamped = If(py < -half, -half, If(py > half, half, py))

    dcap, dsph = Reals('dcap dsph')
    s.add(dcap >= 0, dcap * dcap == norm_sq([px, py - clamped, pz]))
    s.add(dsph >= 0, dsph * dsph == norm_sq([px, py, pz]))

    s.add((dcap - r) != (dsph - r))                   # negation of equality
    return lemma(
        'capsule with height <= 2*radius equals a sphere of that radius', s,
        'the #72 fix: without max(0, ...) the clamp inverts and displaces it',
    )


def main():
    reverse_triangle()
    anisotropy_bound()
    ellipsoid_chain()
    linear_window_covers()
    old_window_is_unsound()
    capsule_degenerate()

    width = max(len(n) for n, _, _, _ in results)
    failed = 0
    for name, ok, status, note in results:
        print(f'{"PASS" if ok else "FAIL"}  {name.ljust(width)}  [{status}]')
        if note:
            print(f'      {note}')
        if not ok:
            failed += 1
    print()
    print(f'{len(results) - failed}/{len(results)} lemmas discharged')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
