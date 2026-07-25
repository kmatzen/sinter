# SMT lemmas

Proofs over the reals for the geometry facts the property tests can only
sample. Each lemma asserts the *negation* of a claim and asks Z3 for a model;
`unsat` means no counterexample exists anywhere.

```sh
pip3 install z3-solver
./check.sh
```

## What is proved

| Lemma | Why it matters |
|---|---|
| **(A)** reverse triangle inequality, `\| \|u\| - \|v\| \| <= \|u - v\|` | step one of the ellipsoid argument |
| **(B)** `min(r) * \|w\| <= \|r ⊙ w\|` | step two — the fact that lets a scaled sphere bound Euclidean distance |
| ellipsoid soundness and 1-Lipschitz, from (A) and (B) | `evaluate.ts` reports `(\|p/r\| - 1) * min(r)`; this is why it never overstates clearance, and why `round`/`offset`/`shell` over an ellipsoid are safe |
| `linearPattern` window covers every overlapping instance | the #69 fix — proves the search window cannot miss the nearest copy |
| the old ±1 window admits a missed instance (expected `sat`) | pins down that #69 was real, and that the lemma above is not vacuous |
| a capsule with `height <= 2*radius` equals a sphere | the #72 fix |

## Notes

The two ellipsoid properties were first written directly, with symbolic radii
under square roots. nlsat does not return on that form — it reports `unknown`
after any timeout you care to wait for. Splitting them into the two steps of
the pen-and-paper argument, each small enough to decide, discharges both. That
is the usual shape of this work: the solver is fine at small algebraic facts
and hopeless at the whole statement, so the decomposition is the effort.

A concrete-radii instance (half-axes 30, 5, 10) also times out, and is left out
rather than carried as a known failure — the general chain already covers it.

Every solver runs with a 60s timeout, so a lemma that becomes intractable
reports `unknown` and fails rather than hanging the suite.
