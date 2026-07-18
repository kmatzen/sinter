# TLA+ specifications

Formal models of Sinter's concurrent protocols, checked with TLC.

## Running

Requires a JVM. `./check.sh` downloads `tla2tools.jar` into this directory on
first run (it is gitignored — do not commit the 2MB jar).

```sh
./check.sh                      # run every spec
./check.sh WorkerBridgeFixed    # run one
```

## WorkerBridge — `src/engine/workerBridge.ts`

Models the singleton bridge that multiplexes `evaluate`, `exportSTL`, and
`export3MF` over one Web Worker.

Two safety properties are specified:

- **`NoOrphan`** — when nothing is in flight, no issued request is still
  pending. Equivalently: every promise returned by the bridge eventually
  settles.
- **`NoCrossTalk`** — a request is settled by its own response, never by
  another request's.

### `WorkerBridge.tla` — current design. **Both properties fail.**

The bridge holds a *single* `responseHandler` slot (`workerBridge.ts:12`) and
dispatches responses by message *type* alone — there are no correlation ids.
Every call overwrites the slot (`:35`, `:55`, `:67`).

`NoCrossTalk` fails in 5 states:

| # | action | effect |
|---|--------|--------|
| 2 | `evaluate` #1 | `evalSeq = 1`, handler ← #1 |
| 3 | `evaluate` #2 | `evalSeq = 2`, handler ← #2 (**#1's handler is gone**) |
| 4 | worker answers #1 | `sdf` response for request #1 queued |
| 5 | bridge delivers it | handler is #2's; `seq === evalSeq` passes, so **#2's promise resolves with #1's geometry** |

`NoOrphan` fails on the same prefix: #1 never settles, and when #2's own
response arrives its `resolve` is a no-op because #2 is already settled.

The other instance of `NoOrphan` — the one most likely to be seen in
practice — is an **export orphaned by an edit**. `exportSTL` installs its
handler; `useEvaluator` fires on the next store change (`useEvaluator.ts:40`)
and overwrites it; the worker's `exportResult` then reaches an *evaluate*
handler, matches neither the `msg.type === 'sdf'` nor the
`msg.type === 'error'` branch, and is silently discarded. The `await` in
`Toolbar.tsx:68` never returns.

A third path, visible in the model as the `handler.seq # evalSeq` branch: a
superseded evaluate returns at `:37` *without* settling. If the newest
evaluate is itself orphaned, `evaluating` is never cleared and the viewport
spinner (`Viewport.tsx:36`) spins forever.

Note that none of these require the worker to misbehave. The worker is
correct and FIFO throughout; the defect is entirely in the bridge's
dispatch.

### `WorkerBridgeFixed.tla` — corrected design. **All properties hold.**

Checked exhaustively at `MaxReq = 4` (2,535 distinct states, depth 13),
including the liveness property `AllRequestsSettle` under weak fairness.

Three changes:

1. Requests carry a correlation id; the worker echoes it on every response,
   errors included.
2. The single handler slot becomes a **map** from correlation id to handler.
   Issuing registers; delivering settles and deregisters exactly one entry.
   Nothing is displaced.
3. A superseded `evaluate` still settles (`resolve(null)`) rather than
   returning without settling. Staleness becomes a caller-side concern —
   `useEvaluator` already has its own `evalSeqRef` guard
   (`useEvaluator.ts:28,33`).

The protocol is implemented in `src/engine/workerBridge.ts`, with the
correlation id (`rid`) threaded through `src/types/geometry.ts` and echoed by
`src/worker/sdfWorker.ts`. Both counterexamples above are replayed as
executable regression tests in `src/engine/workerBridge.test.ts` — they fail
against the old design and pass against the new one.

`HandlerAgreesWithSettled` is the invariant that makes the other two hold,
and the one an implementation must preserve: an id is registered **iff** its
promise has not settled. Deleting a map entry without settling it, or
settling without deleting, breaks it.

### Not modelled

- **Cancellation.** The worker processes its queue synchronously to
  completion (`sdfWorker.ts:165`); there is no way to drop queued work. The
  fixed spec makes every request settle, but a 256³ export still blocks
  every evaluate behind it. Real cancellation needs either a `cancel`
  message checked inside `evaluateCPUWithProgress`'s recursion
  (`sdfWorker.ts:93`) or worker termination and respawn. Worth a follow-up
  spec once the design is chosen.
- **`progressHandler`**, which has the same single-slot problem
  (`workerBridge.ts:13`, `:54`, `:66`) and is cleared by whichever export
  finishes first. The correlation-id fix applies unchanged.
- **`worker.onerror`** (`:28`), which only logs. Under the fixed protocol it
  should reject every registered handler and clear the map.
