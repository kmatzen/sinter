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

### `WorkerBridgeCancel.tla` — admission control and cancellation (#51). **All properties hold.**

`WorkerBridgeFixed` makes every request settle, but every issued request goes
straight into the worker's message queue, where it is beyond reach. Ten edits
posted ten full evaluations and discarded nine results.

**A `cancel` message cannot fix that, and this is the central finding.** A
dedicated worker drains its message queue only *between* invocations of
`self.onmessage`, and `sdfWorker` runs each message to completion
(`sdfWorker.ts:203`). A `cancel` posted while a job is running is not read
until that job is over; a `cancel` posted behind nine queued evaluates is not
read until all nine have run. Keeping a cancelled-`rid` set in the worker and
checking it inside `evaluateCPUWithProgress`'s recursion — the obvious
design — cannot work, because the set can never have been updated by the time
it is read. The mechanisms that *would* work are a `SharedArrayBuffer` flag
polled with `Atomics.load`, which requires cross-origin isolation
(COOP/COEP) and would break this app's OAuth popups; or making the mesher
`async` and yielding periodically, which puts an `await` in the hot recursion.

So cancellation is moved to the side of the boundary that can act on it:

1. **Admission control.** A request is registered when *issued* but posted
   only when its worker is idle. `held` is the bridge's own queue; `posted`
   is the single request the worker has. Only work still in `held` can be
   discarded — which is the entire reason for the split.
2. **Supersession.** Issuing an evaluate settles and drops every evaluate
   still `held`. The one already posted cannot be recalled, so at most one
   stale evaluation ever runs. That is the floor for a worker that never
   yields.
3. **Cancel** settles every export, held and posted alike, and calls
   `terminate()`. Safe only because exports have their own worker.

The spec deliberately leaves `respQueue` untouched on cancel: `terminate()`
cannot retract a response the worker already posted. That surviving message
is the race the spec exists to check — it arrives for an id that is no longer
registered, and `dispatch`'s "unknown id → drop" rule is what makes the
request settle exactly once.

Checked at `MaxReq = 4`: 9,385 distinct states, depth 17, no error. Carries
`NoOrphan`, `NoCrossTalk` and `HandlerAgreesWithSettled` over unchanged, and
adds:

- **`NoStranded`** — an unsettled request is `held`, `posted`, or awaiting
  delivery of a response. `HandlerAgreesWithSettled` does not catch a cancel
  that clears `held`/`posted` without settling, nor a pump that drops an id
  without posting it; this does, at the step where it happens rather than at
  quiescence.
- **`OneOutstandingPerChannel`** — at most one request per channel is with
  its worker.
- **`SettleIsFinal`** (action property) — once settled, a request's outcome
  never changes. This is the property #51 asks for: the cancel racing an
  in-flight completion neither settles twice nor strands.

Both new properties were checked for teeth by mutation. Removing the settle
from `Cancel` violates `NoStranded`; dropping a held request in `Pump` instead
of posting it violates `NoStranded`; and settling in `BridgeDeliver` without
checking registration — the double-settle bug — violates `SettleIsFinal`.

Implemented in `src/engine/workerBridge.ts` (`held`/`posted` are
`WorkerChannel.queue`/`.inFlight`), with regression tests in
`src/engine/workerBridge.test.ts`.

### Not modelled

- **`progressHandler`**, which has the same single-slot problem
  (`workerBridge.ts:13`, `:54`, `:66`) and is cleared by whichever export
  finishes first. The correlation-id fix applies unchanged.
- **`worker.onerror`** (`:28`), which only logs. Under the fixed protocol it
  should reject every registered handler and clear the map.

## UndoHistory — `src/store/modelerStore.ts`

Models undo/redo. Every mutator in the store truncates `history` at the
cursor, pushes a clone of the new tree, and moves the cursor to the end —
except `toggleNode` (`:260`), which calls `set({ tree: newTree })` and records
nothing.

Two safety properties:

- **`HistoryMatchesTree`** — the entry the cursor points at is the tree on
  screen. `undo` and `redo` both assign `tree` straight from `history[idx]`, so
  wherever this is false the next undo silently discards work.
- **`NoSilentLoss`** — the tree on screen appears somewhere in the history. A
  tree in no entry is work that undo cannot return to and redo cannot reach.

Deliberately *not* asserted: that every state the user ever saw stays
reachable. Linear undo discards the redo branch on the next edit, so that is
false of any correct implementation. An earlier draft asserted it and TLC
rejected the fixed spec — worth recording, since it is the easy mistake here.

### `UndoHistory.tla` — current design. **`HistoryMatchesTree` fails.**

TLC reaches the violation in three states: an `Edit`, then a `Toggle`, which
moves `tree` while leaving `history` and `idx` behind.

### `UndoHistoryFixed.tla` — `toggleNode` records like every other mutator.

Both properties hold; 29 distinct states, no error.
