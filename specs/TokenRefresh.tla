---------------------------- MODULE TokenRefresh ----------------------------
(***************************************************************************)
(* Model of the CURRENT design of getAccessToken in src/store/authStore.ts *)
(* (:97-120).                                                              *)
(*                                                                         *)
(* getAccessToken is re-entrant with no mutex. It read-modify-writes a      *)
(* single localStorage record across an await: read at :98, refresh at     *)
(* :109, write at :111 (success) or :114 (failure). There are nine         *)
(* independent call sites -- save, loadProject, toggleShare,               *)
(* deleteCloudProject, and five in the project list / import UI -- any of  *)
(* which can be in flight together (e.g. autosave firing while the user    *)
(* clicks Share).                                                          *)
(*                                                                         *)
(* This spec is expected to FAIL NoStaleOverwrite.                         *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANT Clients

\* writePersisted(null) -- the record is gone and the user is signed out.
NoSession == [exists |-> FALSE, tok |-> 0]

VARIABLES
    store,      \* the localStorage record (single shared cell)
    pc,         \* client -> "idle" | "refreshing" | "done" | "failed"
    snap,       \* client -> the record it read at :98, before its await
    nextTok,    \* source of fresh access tokens
    staleWrite  \* history variable: has anyone written based on a stale read?

vars == <<store, pc, snap, nextTok, staleWrite>>

Init ==
    \* The initial token is within 60s of expiry, so every caller takes the
    \* refresh branch -- the case of interest.
    /\ store      = [exists |-> TRUE, tok |-> 1]
    /\ pc         = [c \in Clients |-> "idle"]
    /\ snap       = [c \in Clients |-> [exists |-> TRUE, tok |-> 1]]
    /\ nextTok    = 2
    /\ staleWrite = FALSE

\* :98-99 -- no record at all.
ReadNoSession(c) ==
    /\ pc[c] = "idle"
    /\ ~store.exists
    /\ pc' = [pc EXCEPT ![c] = "failed"]
    /\ UNCHANGED <<store, snap, nextTok, staleWrite>>

\* :98 then :101 -- snapshot the record and start refreshing. Nothing marks
\* the store as having a refresh in flight, so every client does this
\* independently.
ReadAndRefresh(c) ==
    /\ pc[c] = "idle"
    /\ store.exists
    /\ snap' = [snap EXCEPT ![c] = store]
    /\ pc'   = [pc EXCEPT ![c] = "refreshing"]
    /\ UNCHANGED <<store, nextTok, staleWrite>>

\* A write is stale if the record moved on after this client read it -- i.e.
\* the client is clobbering someone else's newer write.
IsStale(c) == snap[c] # store

\* :109-112 -- POST succeeded; write {...persisted, accessToken} back. Note
\* the spread is off this client's OWN snapshot, not off current storage.
RefreshSucceeds(c) ==
    /\ pc[c] = "refreshing"
    /\ store'      = [exists |-> TRUE, tok |-> nextTok]
    /\ nextTok'    = nextTok + 1
    /\ pc'         = [pc EXCEPT ![c] = "done"]
    /\ staleWrite' = (staleWrite \/ IsStale(c))
    /\ UNCHANGED snap

\* :113-117 -- ANY failure (network blip, 5xx, rotated refresh token) wipes
\* the entire auth record and signs the user out.
RefreshFails(c) ==
    /\ pc[c] = "refreshing"
    /\ store'      = NoSession
    /\ pc'         = [pc EXCEPT ![c] = "failed"]
    /\ staleWrite' = (staleWrite \/ IsStale(c))
    /\ UNCHANGED <<snap, nextTok>>

Terminating ==
    /\ \A c \in Clients : pc[c] \in {"done", "failed"}
    /\ UNCHANGED vars

Next ==
    \/ \E c \in Clients :
        ReadNoSession(c) \/ ReadAndRefresh(c) \/ RefreshSucceeds(c) \/ RefreshFails(c)
    \/ Terminating

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Properties.                                                             *)
(***************************************************************************)

TypeOK ==
    /\ store.exists \in BOOLEAN
    /\ \A c \in Clients : pc[c] \in {"idle", "refreshing", "done", "failed"}

\* SAFETY.  No caller writes the auth record based on a read the record has
\* already moved past. getAccessToken read-modify-writes across an await and
\* never re-validates, so this is exactly the defect.
\*
\* VIOLATED: two callers snapshot the same record and refresh concurrently;
\* the first succeeds and advances the record; the second then writes --
\* clobbering a session established after its own read. When the second
\* call fails (a blip, a 5xx, a rotated refresh token) that write is
\* writePersisted(null), signing the user out mid-save.
\*
\* Note this is deliberately NOT "a successful refresh is never followed by
\* a logout" -- that is too strong, since a later, sequential refresh may
\* legitimately discover a dead token and sign out correctly.
NoStaleOverwrite == ~staleWrite

\* The mechanism behind the violation: nothing bounds concurrent refreshes.
\* VIOLATED trivially with two clients.
AtMostOneRefreshInFlight ==
    Cardinality({c \in Clients : pc[c] = "refreshing"}) <= 1

=============================================================================
