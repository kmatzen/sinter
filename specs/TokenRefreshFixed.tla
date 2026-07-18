------------------------- MODULE TokenRefreshFixed --------------------------
(***************************************************************************)
(* Corrected getAccessToken protocol.                                      *)
(*                                                                         *)
(* Two changes relative to TokenRefresh.tla:                               *)
(*                                                                         *)
(*   1. Single-flight. The first caller to need a refresh becomes the       *)
(*      leader and stores its in-flight promise; concurrent callers await   *)
(*      that same promise instead of issuing their own refresh. At most one *)
(*      refresh is ever in flight, so no caller can be signed out by        *)
(*      another caller's failure.                                          *)
(*                                                                         *)
(*   2. Only a definitive auth failure clears the session. invalid_grant /  *)
(*      401 means the refresh token is genuinely dead -> sign out. A        *)
(*      network error or 5xx rejects the waiting callers but LEAVES the     *)
(*      record intact, so a blip mid-save no longer logs the user out.      *)
(*                                                                         *)
(* All three properties hold.                                              *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

\* NoLeader is a model value standing for "no refresh in flight".
CONSTANTS Clients, NoLeader

NoSession == [exists |-> FALSE, tok |-> 0]

VARIABLES
    store,
    pc,         \* client -> "idle" | "refreshing" | "waiting" | "done" | "failed"
    leader,     \* the client owning the in-flight refresh, or NoLeader
    snap,       \* the leader's snapshot, taken when it acquired the lock
    nextTok,
    staleWrite  \* history variable, as in TokenRefresh.tla

vars == <<store, pc, leader, snap, nextTok, staleWrite>>

Init ==
    /\ store      = [exists |-> TRUE, tok |-> 1]
    /\ pc         = [c \in Clients |-> "idle"]
    /\ leader     = NoLeader
    /\ snap       = [exists |-> TRUE, tok |-> 1]
    /\ nextTok    = 2
    /\ staleWrite = FALSE

ReadNoSession(c) ==
    /\ pc[c] = "idle"
    /\ ~store.exists
    /\ pc' = [pc EXCEPT ![c] = "failed"]
    /\ UNCHANGED <<store, leader, snap, nextTok, staleWrite>>

\* No refresh in flight: take the lock and issue one.
AcquireAndRefresh(c) ==
    /\ pc[c] = "idle"
    /\ store.exists
    /\ leader = NoLeader
    /\ leader' = c
    /\ snap'   = store
    /\ pc' = [pc EXCEPT ![c] = "refreshing"]
    /\ UNCHANGED <<store, nextTok, staleWrite>>

\* A refresh is already in flight: await the SAME promise rather than
\* issuing a second one.
JoinInflight(c) ==
    /\ pc[c] = "idle"
    /\ store.exists
    /\ leader # NoLeader
    /\ pc' = [pc EXCEPT ![c] = "waiting"]
    /\ UNCHANGED <<store, leader, snap, nextTok, staleWrite>>

\* Everyone sharing the in-flight promise settles together.
Settle(c, outcome) ==
    [x \in Clients |-> IF x = c \/ pc[x] = "waiting" THEN outcome ELSE pc[x]]

LeaderSucceeds(c) ==
    /\ leader = c
    /\ pc[c] = "refreshing"
    /\ store'      = [exists |-> TRUE, tok |-> nextTok]
    /\ nextTok'    = nextTok + 1
    /\ pc'         = Settle(c, "done")
    /\ leader'     = NoLeader
    /\ staleWrite' = (staleWrite \/ (snap # store))
    /\ UNCHANGED snap

\* invalid_grant / 401: the refresh token is dead. Signing out is correct.
LeaderRejectedByProvider(c) ==
    /\ leader = c
    /\ pc[c] = "refreshing"
    /\ store'      = NoSession
    /\ pc'         = Settle(c, "failed")
    /\ leader'     = NoLeader
    /\ staleWrite' = (staleWrite \/ (snap # store))
    /\ UNCHANGED <<snap, nextTok>>

\* Network error / 5xx: fail the callers but KEEP the session. The old code
\* wiped the record here, turning a dropped packet into a forced re-auth.
LeaderTransientFailure(c) ==
    /\ leader = c
    /\ pc[c] = "refreshing"
    /\ pc'     = Settle(c, "failed")
    /\ leader' = NoLeader
    /\ UNCHANGED <<store, snap, nextTok, staleWrite>>

Terminating ==
    /\ \A c \in Clients : pc[c] \in {"done", "failed"}
    /\ UNCHANGED vars

Next ==
    \/ \E c \in Clients :
        \/ ReadNoSession(c) \/ AcquireAndRefresh(c) \/ JoinInflight(c)
        \/ LeaderSucceeds(c) \/ LeaderRejectedByProvider(c) \/ LeaderTransientFailure(c)
    \/ Terminating

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Properties -- the first two are the same statements as TokenRefresh.tla.*)
(***************************************************************************)

TypeOK ==
    /\ store.exists \in BOOLEAN
    /\ \A c \in Clients : pc[c] \in {"idle", "refreshing", "waiting", "done", "failed"}
    /\ leader \in Clients \cup {NoLeader}

\* Same statement as TokenRefresh.tla. Holds here: the lock means no other
\* client can write between the leader's read and its own write.
NoStaleOverwrite == ~staleWrite

AtMostOneRefreshInFlight ==
    Cardinality({c \in Clients : pc[c] = "refreshing"}) <= 1

\* A client waiting on the shared promise never issues its own refresh.
WaitersDoNotRefresh ==
    \A c \in Clients : pc[c] = "refreshing" => leader = c

=============================================================================
