------------------------ MODULE WorkerBridgeCancel -------------------------
(***************************************************************************)
(* WorkerBridge with admission control and export cancellation (#51).      *)
(*                                                                         *)
(* Extends WorkerBridgeFixed.tla with the three mechanisms #51 needed, and *)
(* keeps every property that spec established.                             *)
(*                                                                         *)
(*   1. ADMISSION CONTROL.  A request is registered when it is ISSUED but  *)
(*      posted to the worker only when that worker is idle.  `held` is the *)
(*      queue the bridge keeps on its own side; `posted` is the single     *)
(*      request the worker has been given.  WorkerBridgeFixed had no such  *)
(*      distinction -- every issued request went straight into the         *)
(*      worker's queue, where it was beyond reach.                         *)
(*                                                                         *)
(*   2. SUPERSESSION.  Issuing an evaluate settles and discards every      *)
(*      evaluate still `held`.  Their results would be dropped by          *)
(*      useEvaluator's seq guard anyway, so running them is waste.  Only   *)
(*      work the bridge is still holding can be discarded, which is what   *)
(*      makes (1) worth its complexity.                                    *)
(*                                                                         *)
(*   3. CANCEL.  Settles every export -- held and posted alike -- and      *)
(*      terminates the export worker.  Modelled as clearing `held` and     *)
(*      `posted` for that channel while DELIBERATELY LEAVING `respQueue`   *)
(*      ALONE: terminate() cannot retract a response the worker already    *)
(*      posted.  That surviving message is the race this spec exists to    *)
(*      check.                                                             *)
(*                                                                         *)
(* Note what is NOT modelled, because it cannot be built: a cooperative    *)
(* cancel flag delivered by postMessage.  A dedicated worker drains its    *)
(* message queue only between invocations of self.onmessage, so a cancel   *)
(* sent while a job runs is not read until that job is over.  In this      *)
(* model that is the absence of any action by which the bridge can affect  *)
(* `posted` other than by abandoning it.                                   *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxReq

Ids   == 1..MaxReq
Chans == {"eval", "export"}

Pending == [state |-> "pending", by |-> 0]

VARIABLES
    nextId,
    kind,
    held,       \* channel -> Seq(Ids): issued, registered, NOT yet posted
    posted,     \* channel -> Id or 0: the one request the worker has
    respQueue,  \* channel -> Seq(msg)
    inflight,   \* SET of correlation ids with a registered handler
    evalSeq,
    settled

vars == <<nextId, kind, held, posted, respQueue, inflight, evalSeq, settled>>

Issued == 1..(nextId - 1)

ChanOf(i) == IF kind[i] = "evaluate" THEN "eval" ELSE "export"

SeqToSet(s) == {s[k] : k \in DOMAIN s}

Init ==
    /\ nextId    = 1
    /\ kind      = [i \in Ids |-> "evaluate"]
    /\ held      = [c \in Chans |-> <<>>]
    /\ posted    = [c \in Chans |-> 0]
    /\ respQueue = [c \in Chans |-> <<>>]
    /\ inflight  = {}
    /\ evalSeq   = 0
    /\ settled   = [i \in Ids |-> Pending]

(***************************************************************************)
(* Client actions.                                                         *)
(***************************************************************************)

\* Every id still held on the eval channel is a superseded evaluate: it is
\* settled with null here, and never reaches the worker.  This is the whole
\* point of #51 -- ten edits used to run ten evaluations and discard nine.
IssueEvaluate ==
    /\ nextId <= MaxReq
    /\ LET stale == SeqToSet(held["eval"])
       IN /\ settled'  = [i \in Ids |-> IF i \in stale
                                        THEN [state |-> "resolved", by |-> i]
                                        ELSE settled[i]]
          /\ inflight' = (inflight \ stale) \cup {nextId}
    /\ held'    = [held EXCEPT !["eval"] = <<nextId>>]
    /\ kind'    = [kind EXCEPT ![nextId] = "evaluate"]
    /\ evalSeq' = evalSeq + 1
    /\ nextId'  = nextId + 1
    /\ UNCHANGED <<posted, respQueue>>

IssueExport ==
    /\ nextId <= MaxReq
    /\ kind'     = [kind EXCEPT ![nextId] = "export"]
    /\ inflight' = inflight \cup {nextId}
    /\ held'     = [held EXCEPT !["export"] = Append(held["export"], nextId)]
    /\ nextId'   = nextId + 1
    /\ UNCHANGED <<posted, respQueue, evalSeq, settled>>

\* Abort every export.  `respQueue["export"]` is untouched on purpose.
Cancel ==
    /\ posted["export"] # 0 \/ held["export"] # <<>>
    /\ LET victims == {i \in inflight : ChanOf(i) = "export"}
       IN /\ settled'  = [i \in Ids |-> IF i \in victims
                                        THEN [state |-> "cancelled", by |-> i]
                                        ELSE settled[i]]
          /\ inflight' = inflight \ victims
    /\ held'   = [held   EXCEPT !["export"] = <<>>]
    /\ posted' = [posted EXCEPT !["export"] = 0]
    /\ UNCHANGED <<nextId, kind, respQueue, evalSeq>>

(***************************************************************************)
(* Bridge pump.  Hands the worker the next held request, and only when it  *)
(* is idle.  A settled id is never left in `held`, so there is nothing to  *)
(* skip here -- the implementation's `if (!req) continue` guards against a *)
(* state this model makes unreachable, and is defence in depth.            *)
(***************************************************************************)

Pump(c) ==
    /\ posted[c] = 0
    /\ held[c] # <<>>
    /\ posted' = [posted EXCEPT ![c] = Head(held[c])]
    /\ held'   = [held   EXCEPT ![c] = Tail(held[c])]
    /\ UNCHANGED <<nextId, kind, respQueue, inflight, evalSeq, settled>>

(***************************************************************************)
(* Worker.  Answers the request it was given.  `respQueue[c] = <<>>` is    *)
(* what stops it answering twice; `posted` is cleared by the bridge on     *)
(* delivery, not here, mirroring dispatch() clearing channel.inFlight.     *)
(***************************************************************************)

RespTypeOf(k) == IF k = "evaluate" THEN "sdf" ELSE "exportResult"

WorkerProcess(c) ==
    /\ posted[c] # 0
    /\ respQueue[c] = <<>>
    /\ \E t \in {RespTypeOf(kind[posted[c]]), "error"} :
           respQueue' = [respQueue EXCEPT ![c] = <<[id |-> posted[c], type |-> t]>>]
    /\ UNCHANGED <<nextId, kind, held, posted, inflight, evalSeq, settled>>

(***************************************************************************)
(* Dispatch, keyed by correlation id.  An id that is no longer registered  *)
(* has already been settled -- by a cancel, or by supersession -- and its  *)
(* response is dropped.  That single rule is what makes a cancel racing an *)
(* in-flight completion settle the request exactly once.                   *)
(***************************************************************************)

BridgeDeliver(c) ==
    /\ respQueue[c] # <<>>
    /\ LET msg == Head(respQueue[c])
       IN /\ respQueue' = [respQueue EXCEPT ![c] = Tail(respQueue[c])]
          /\ IF msg.id \in inflight
             THEN /\ settled' = [settled EXCEPT ![msg.id] =
                                    [state |-> IF msg.type = "error"
                                               THEN "rejected" ELSE "resolved",
                                     by    |-> msg.id]]
                  /\ inflight' = inflight \ {msg.id}
                  /\ posted'   = [posted EXCEPT ![c] =
                                     IF posted[c] = msg.id THEN 0 ELSE posted[c]]
             ELSE UNCHANGED <<settled, inflight, posted>>
    /\ UNCHANGED <<nextId, kind, held, evalSeq>>

Quiescent ==
    /\ \A c \in Chans : held[c] = <<>> /\ posted[c] = 0 /\ respQueue[c] = <<>>

Terminating ==
    /\ nextId > MaxReq
    /\ Quiescent
    /\ UNCHANGED vars

Next ==
    \/ IssueEvaluate
    \/ IssueExport
    \/ Cancel
    \/ \E c \in Chans : Pump(c)
    \/ \E c \in Chans : WorkerProcess(c)
    \/ \E c \in Chans : BridgeDeliver(c)
    \/ Terminating

\* Cancel is deliberately NOT fair: it is a user action, and a fair Cancel
\* would mean every export is eventually cancelled.
Spec ==
    /\ Init
    /\ [][Next]_vars
    /\ \A c \in Chans : WF_vars(Pump(c))
    /\ \A c \in Chans : WF_vars(WorkerProcess(c))
    /\ \A c \in Chans : WF_vars(BridgeDeliver(c))

(***************************************************************************)
(* Properties.                                                             *)
(***************************************************************************)

TypeOK ==
    /\ nextId \in 1..(MaxReq + 1)
    /\ kind \in [Ids -> {"evaluate", "export"}]
    /\ inflight \subseteq Ids
    /\ evalSeq \in 0..MaxReq
    /\ \A c \in Chans : posted[c] \in Ids \cup {0}
    /\ \A i \in Ids :
           settled[i].state \in {"pending", "resolved", "rejected", "cancelled"}

\* Carried over from WorkerBridgeFixed.tla, unchanged.
NoOrphan    == Quiescent => \A i \in Issued : settled[i].state # "pending"
NoCrossTalk == \A i \in Issued : settled[i].state # "pending" => settled[i].by = i

HandlerAgreesWithSettled ==
    \A i \in Issued : (i \in inflight) <=> (settled[i].state = "pending")

\* New for #51.  An unsettled request must be somewhere it can still make
\* progress: held by the bridge, posted to a worker, or awaiting delivery of
\* a response.  This is what a cancel that clears `held`/`posted` without
\* settling would break, and what a pump that drops an id without posting it
\* would break.  HandlerAgreesWithSettled alone does not catch either.
InHeld(i)   == \E c \in Chans : \E k \in DOMAIN held[c]      : held[c][k] = i
IsPosted(i) == \E c \in Chans : posted[c] = i
InResp(i)   == \E c \in Chans : \E k \in DOMAIN respQueue[c] : respQueue[c][k].id = i

NoStranded == \A i \in inflight : InHeld(i) \/ IsPosted(i) \/ InResp(i)

\* At most one request per channel is outstanding with its worker.  Holding
\* the rest is what makes supersession and cancellation possible at all.
OneOutstandingPerChannel ==
    \A c \in Chans : posted[c] # 0 => (\A i \in SeqToSet(held[c]) : i # posted[c])

\* The specific hazard #51 names: "a cancel racing with an in-flight
\* completion does not settle the request twice".  Once settled, a request's
\* outcome never changes again -- so the response that outlived terminate()
\* cannot overwrite the cancellation, and cannot resurrect it either.
SettleIsFinal ==
    [][\A i \in Ids : settled[i].state # "pending" => settled'[i] = settled[i]]_vars

AllRequestsSettle == <>[](\A i \in Issued : settled[i].state # "pending")

=============================================================================
