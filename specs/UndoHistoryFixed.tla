---- MODULE UndoHistoryFixed ----
(***************************************************************************)
(* `UndoHistory` with the one change that repairs it: `toggleNode` records *)
(* the new tree the way every other mutator does, instead of assigning     *)
(* `set({ tree: newTree })` and leaving the cursor behind.                 *)
(*                                                                         *)
(* Both properties hold here.                                             *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxOps

VARIABLES tree, history, idx, nextTok, ops

vars == <<tree, history, idx, nextTok, ops>>

Init ==
    /\ tree = 0
    /\ history = <<0>>
    /\ idx = 1
    /\ nextTok = 1
    /\ ops = 0

Record(v) ==
    /\ history' = SubSeq(history, 1, idx) \o <<v>>
    /\ idx' = idx + 1

Edit ==
    /\ ops < MaxOps
    /\ tree' = nextTok
    /\ Record(nextTok)
    /\ nextTok' = nextTok + 1
    /\ ops' = ops + 1

\* The fix: a toggle is an edit like any other.
Toggle == Edit

Undo ==
    /\ ops < MaxOps
    /\ idx > 1
    /\ idx' = idx - 1
    /\ tree' = history[idx - 1]
    /\ UNCHANGED <<history, nextTok>>
    /\ ops' = ops + 1

Redo ==
    /\ ops < MaxOps
    /\ idx < Len(history)
    /\ idx' = idx + 1
    /\ tree' = history[idx + 1]
    /\ UNCHANGED <<history, nextTok>>
    /\ ops' = ops + 1

Done == ops >= MaxOps /\ UNCHANGED vars

Next == Edit \/ Toggle \/ Undo \/ Redo \/ Done

Spec == Init /\ [][Next]_vars

HistoryMatchesTree == history[idx] = tree

NoSilentLoss == \E i \in 1..Len(history) : history[i] = tree

====
