------------------------ MODULE WorkerBridgeFixed -------------------------
(***************************************************************************)
(* Corrected WorkerBridge protocol.                                        *)
(*                                                                         *)
(* Three changes relative to WorkerBridge.tla:                             *)
(*                                                                         *)
(*   1. Every request carries a correlation id.  The worker echoes it back *)
(*      on every response (including errors).                              *)
(*   2. The single `responseHandler` slot becomes a MAP from correlation   *)
(*      id to handler.  Issuing a request registers an entry; delivering a *)
(*      response settles and removes exactly that entry.  Nothing is ever  *)
(*      overwritten.                                                       *)
(*   3. A superseded evaluate still SETTLES (resolve(null)) instead of     *)
(*      returning without settling.  Staleness becomes a caller-side       *)
(*      concern -- useEvaluator.ts already has its own evalSeqRef guard at *)
(*      src/engine/useEvaluator.ts:28,33 -- rather than a reason to strand *)
(*      a promise.                                                         *)
(*                                                                         *)
(* Both safety properties and the liveness property hold.                  *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxReq

Ids == 1..MaxReq

Pending == [state |-> "pending", by |-> 0]

VARIABLES
    nextId,
    kind,
    reqQueue,
    respQueue,
    inflight,   \* SET of correlation ids with a registered handler
    evalSeq,
    settled

vars == <<nextId, kind, reqQueue, respQueue, inflight, evalSeq, settled>>

Issued == 1..(nextId - 1)

Init ==
    /\ nextId    = 1
    /\ kind      = [i \in Ids |-> "evaluate"]
    /\ reqQueue  = <<>>
    /\ respQueue = <<>>
    /\ inflight  = {}
    /\ evalSeq   = 0
    /\ settled   = [i \in Ids |-> Pending]

(***************************************************************************)
(* Client actions.  Registration is additive -- no handler is displaced.   *)
(***************************************************************************)

IssueEvaluate ==
    /\ nextId <= MaxReq
    /\ kind'     = [kind EXCEPT ![nextId] = "evaluate"]
    /\ evalSeq'  = evalSeq + 1
    /\ inflight' = inflight \cup {nextId}
    /\ reqQueue' = Append(reqQueue, nextId)
    /\ nextId'   = nextId + 1
    /\ UNCHANGED <<respQueue, settled>>

IssueExport ==
    /\ nextId <= MaxReq
    /\ kind'     = [kind EXCEPT ![nextId] = "export"]
    /\ inflight' = inflight \cup {nextId}
    /\ reqQueue' = Append(reqQueue, nextId)
    /\ nextId'   = nextId + 1
    /\ UNCHANGED <<respQueue, evalSeq, settled>>

(***************************************************************************)
(* Worker.  Unchanged, except that the correlation id is echoed back --    *)
(* which the model already did, since responses were tagged with `id`.     *)
(***************************************************************************)

RespTypeOf(k) == IF k = "evaluate" THEN "sdf" ELSE "exportResult"

WorkerProcess ==
    /\ reqQueue # <<>>
    /\ \E t \in {RespTypeOf(kind[Head(reqQueue)]), "error"} :
           respQueue' = Append(respQueue, [id |-> Head(reqQueue), type |-> t])
    /\ reqQueue' = Tail(reqQueue)
    /\ UNCHANGED <<nextId, kind, inflight, evalSeq, settled>>

(***************************************************************************)
(* Bridge dispatch, keyed by correlation id.  Note there is no longer any  *)
(* dependence on the message *type* for routing, and no fall-through case: *)
(* a registered request is always settled by its own response.             *)
(***************************************************************************)

Deliver(msg) ==
    IF msg.id \in inflight
    THEN /\ settled' = [settled EXCEPT ![msg.id] =
                           [state |-> IF msg.type = "error" THEN "rejected"
                                                            ELSE "resolved",
                            by    |-> msg.id]]
         /\ inflight' = inflight \ {msg.id}
    ELSE UNCHANGED <<settled, inflight>>

BridgeDeliver ==
    /\ respQueue # <<>>
    /\ Deliver(Head(respQueue))
    /\ respQueue' = Tail(respQueue)
    /\ UNCHANGED <<nextId, kind, reqQueue, evalSeq>>

Terminating ==
    /\ nextId > MaxReq
    /\ reqQueue  = <<>>
    /\ respQueue = <<>>
    /\ UNCHANGED vars

Next == IssueEvaluate \/ IssueExport \/ WorkerProcess \/ BridgeDeliver \/ Terminating

Spec == Init /\ [][Next]_vars /\ WF_vars(WorkerProcess) /\ WF_vars(BridgeDeliver)

(***************************************************************************)
(* Properties -- identical statements to WorkerBridge.tla.                 *)
(***************************************************************************)

TypeOK ==
    /\ nextId \in 1..(MaxReq + 1)
    /\ kind \in [Ids -> {"evaluate", "export"}]
    /\ inflight \subseteq Ids
    /\ evalSeq \in 0..MaxReq
    /\ \A i \in Ids : settled[i].state \in {"pending", "resolved", "rejected"}

Quiescent == reqQueue = <<>> /\ respQueue = <<>>

NoOrphan    == Quiescent => \A i \in Issued : settled[i].state # "pending"
NoCrossTalk == \A i \in Issued : settled[i].state # "pending" => settled[i].by = i

\* An id is registered iff its promise has not settled.  This is the
\* invariant that makes the other two hold, and the one an implementation
\* must not break (e.g. by deleting a map entry without settling).
HandlerAgreesWithSettled ==
    \A i \in Issued : (i \in inflight) <=> (settled[i].state = "pending")

AllRequestsSettle == <>[](\A i \in Issued : settled[i].state # "pending")

=============================================================================
