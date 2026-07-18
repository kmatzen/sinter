--------------------------- MODULE WorkerBridge ---------------------------
(***************************************************************************)
(* Model of the CURRENT design of src/engine/workerBridge.ts.              *)
(*                                                                         *)
(* The bridge is a singleton multiplexing three request kinds (evaluate,   *)
(* exportSTL, export3MF -- the two exports behave identically here, so     *)
(* they are collapsed into one "export" kind) over a single Worker, using  *)
(* ONE `responseHandler` slot and NO correlation identifiers.  Responses   *)
(* are dispatched purely by message *type*.                                *)
(*                                                                         *)
(* This spec is expected to FAIL.  Both NoOrphan and NoCrossTalk have      *)
(* counterexamples at MaxReq = 2.  See WorkerBridgeFixed.tla for the       *)
(* corrected protocol.                                                     *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxReq         \* how many requests the client may issue

Ids == 1..MaxReq

\* The empty handler slot: `responseHandler = null` (workerBridge.ts:12).
NoHandler == [kind |-> "none", id |-> 0, seq |-> 0]

\* A request that has neither resolved nor rejected.
Pending == [state |-> "pending", by |-> 0]

VARIABLES
    nextId,     \* next request id to allocate
    kind,       \* id -> "evaluate" | "export"
    reqQueue,   \* postMessage queue, main thread -> worker
    respQueue,  \* postMessage queue, worker -> main thread
    handler,    \* THE single responseHandler slot
    evalSeq,    \* this.evalSeq (workerBridge.ts:14)
    settled     \* id -> [state, by]; `by` records WHICH request's response settled it

vars == <<nextId, kind, reqQueue, respQueue, handler, evalSeq, settled>>

\* The ids actually handed out so far.
Issued == 1..(nextId - 1)

Init ==
    /\ nextId    = 1
    /\ kind      = [i \in Ids |-> "evaluate"]
    /\ reqQueue  = <<>>
    /\ respQueue = <<>>
    /\ handler   = NoHandler
    /\ evalSeq   = 0
    /\ settled   = [i \in Ids |-> Pending]

(***************************************************************************)
(* Client actions.                                                         *)
(*                                                                         *)
(* Note that BOTH issue actions overwrite `handler` unconditionally --     *)
(* this is workerBridge.ts:35, :55 and :67.  The previous handler is       *)
(* dropped on the floor, along with the promise it was going to settle.    *)
(***************************************************************************)

IssueEvaluate ==            \* workerBridge.ts:31-49
    /\ nextId <= MaxReq
    /\ kind'     = [kind EXCEPT ![nextId] = "evaluate"]
    /\ evalSeq'  = evalSeq + 1                      \* const seq = ++this.evalSeq
    /\ handler'  = [kind |-> "evaluate", id |-> nextId, seq |-> evalSeq + 1]
    /\ reqQueue' = Append(reqQueue, nextId)
    /\ nextId'   = nextId + 1
    /\ UNCHANGED <<respQueue, settled>>

IssueExport ==              \* workerBridge.ts:51-73
    /\ nextId <= MaxReq
    /\ kind'     = [kind EXCEPT ![nextId] = "export"]
    /\ handler'  = [kind |-> "export", id |-> nextId, seq |-> 0]
    /\ reqQueue' = Append(reqQueue, nextId)
    /\ nextId'   = nextId + 1
    /\ UNCHANGED <<respQueue, evalSeq, settled>>

(***************************************************************************)
(* The worker.  Single-threaded, strictly FIFO, no cancellation: once a    *)
(* request is queued it WILL be processed to completion (sdfWorker.ts:165).*)
(* It answers with the response type for that request's kind, or errors.   *)
(***************************************************************************)

RespTypeOf(k) == IF k = "evaluate" THEN "sdf" ELSE "exportResult"

WorkerProcess ==
    /\ reqQueue # <<>>
    /\ \E t \in {RespTypeOf(kind[Head(reqQueue)]), "error"} :
           respQueue' = Append(respQueue, [id |-> Head(reqQueue), type |-> t])
    /\ reqQueue' = Tail(reqQueue)
    /\ UNCHANGED <<nextId, kind, handler, evalSeq, settled>>

(***************************************************************************)
(* Bridge onmessage (workerBridge.ts:21-26) plus the installed handler.    *)
(*                                                                         *)
(* Settling is idempotent: calling resolve()/reject() on an already-       *)
(* settled promise is a no-op in JS, so a second attempt changes nothing.  *)
(***************************************************************************)

Settle(i, st, src) ==
    IF settled[i].state = "pending"
    THEN settled' = [settled EXCEPT ![i] = [state |-> st, by |-> src]]
    ELSE UNCHANGED settled

Deliver(msg) ==
    IF handler = NoHandler
    THEN UNCHANGED settled                          \* `if (this.responseHandler)` fails
    ELSE IF handler.kind = "evaluate"
         THEN IF handler.seq # evalSeq
                THEN UNCHANGED settled              \* :37 stale -- returns WITHOUT settling
              ELSE IF msg.type = "sdf"
                THEN Settle(handler.id, "resolved", msg.id)
              ELSE IF msg.type = "error"
                THEN Settle(handler.id, "rejected", msg.id)
              ELSE UNCHANGED settled                \* exportResult hits neither branch
         ELSE IF msg.type = "exportResult"
                THEN Settle(handler.id, "resolved", msg.id)
              ELSE IF msg.type = "error"
                THEN Settle(handler.id, "rejected", msg.id)
              ELSE UNCHANGED settled                \* sdf hits neither branch

BridgeDeliver ==
    /\ respQueue # <<>>
    /\ Deliver(Head(respQueue))
    /\ respQueue' = Tail(respQueue)
    /\ UNCHANGED <<nextId, kind, reqQueue, handler, evalSeq>>

\* Allow stuttering once all work is issued and drained, so TLC does not
\* report a spurious deadlock.
Terminating ==
    /\ nextId > MaxReq
    /\ reqQueue  = <<>>
    /\ respQueue = <<>>
    /\ UNCHANGED vars

Next == IssueEvaluate \/ IssueExport \/ WorkerProcess \/ BridgeDeliver \/ Terminating

Spec == Init /\ [][Next]_vars /\ WF_vars(WorkerProcess) /\ WF_vars(BridgeDeliver)

(***************************************************************************)
(* Properties.                                                             *)
(***************************************************************************)

TypeOK ==
    /\ nextId \in 1..(MaxReq + 1)
    /\ kind \in [Ids -> {"evaluate", "export"}]
    /\ evalSeq \in 0..MaxReq
    /\ \A i \in Ids : settled[i].state \in {"pending", "resolved", "rejected"}

\* Nothing is in flight: every request has been processed and every response
\* has been delivered to the bridge.
Quiescent == reqQueue = <<>> /\ respQueue = <<>>

\* SAFETY 1.  When the system is at rest, no issued request is still pending.
\* Equivalently: every promise returned by evaluate/exportSTL/export3MF
\* eventually settles.  VIOLATED -- an export in flight when an evaluate is
\* issued has its handler overwritten, and its exportResult then falls
\* through the evaluate handler's if/else-if chain and is discarded.
NoOrphan == Quiescent => \A i \in Issued : settled[i].state # "pending"

\* SAFETY 2.  A request is settled by its OWN response, never another's.
\* VIOLATED -- two evaluates in flight: the first's `sdf` response is
\* delivered to the second's handler, which passes the `seq === evalSeq`
\* check (it IS the newest) and resolves the second promise with the first
\* request's geometry.
NoCrossTalk == \A i \in Issued : settled[i].state # "pending" => settled[i].by = i

\* LIVENESS.  The same claim as NoOrphan, stated temporally.
AllRequestsSettle == <>[](\A i \in Issued : settled[i].state # "pending")

=============================================================================
