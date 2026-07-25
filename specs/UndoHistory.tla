---- MODULE UndoHistory ----
(***************************************************************************)
(* Undo/redo in `src/store/modelerStore.ts`.                               *)
(*                                                                         *)
(* Every mutator in the store follows the same shape: truncate the history *)
(* at the cursor, push a clone of the new tree, and move the cursor to the *)
(* end.  `toggleNode` (:260) is the exception — it replaces the tree with  *)
(* `set({ tree: newTree })` and records nothing.                           *)
(*                                                                         *)
(* This models the current design.  Both properties below fail; the        *)
(* counterexamples are the point.  `UndoHistoryFixed` records the toggle   *)
(* like every other mutator and satisfies them.                            *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxOps

VARIABLES
    tree,      \* the tree the editor is showing, as an opaque content token
    history,   \* sequence of recorded tokens
    idx,       \* cursor into history (1-based; the store's historyIndex + 1)
    nextTok,   \* supply of fresh content tokens
    ops        \* bound on the search depth

vars == <<tree, history, idx, nextTok, ops>>

Init ==
    /\ tree = 0
    /\ history = <<0>>
    /\ idx = 1
    /\ nextTok = 1
    /\ ops = 0

\* The common path: truncate at the cursor, append, point at the new entry.
Record(v) ==
    /\ history' = SubSeq(history, 1, idx) \o <<v>>
    /\ idx' = idx + 1

\* setTree, addNode, deleteNode, updateParams, ... — anything that records.
Edit ==
    /\ ops < MaxOps
    /\ tree' = nextTok
    /\ Record(nextTok)
    /\ nextTok' = nextTok + 1
    /\ ops' = ops + 1

\* toggleNode: changes the tree, leaves history and the cursor untouched.
Toggle ==
    /\ ops < MaxOps
    /\ tree' = nextTok
    /\ nextTok' = nextTok + 1
    /\ UNCHANGED <<history, idx>>
    /\ ops' = ops + 1

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

(***************************************************************************)
(* Safety                                                                  *)
(***************************************************************************)

\* The entry the cursor points at is what the editor is showing.  Undo and
\* redo both assign `tree` straight from `history[idx]`, so any state where
\* this is false means the next undo silently discards work.
HistoryMatchesTree == history[idx] = tree

\* The tree on screen is recorded somewhere.  Stated separately from
\* HistoryMatchesTree because it is the user-visible half: a tree that appears
\* in no history entry is work that undo cannot return to and redo cannot
\* reach, so it is simply lost.
\*
\* Note what is deliberately NOT asserted — that every state the user ever saw
\* stays reachable.  Linear undo discards the redo branch on the next edit, so
\* that is false of any correct implementation, not just this one.
NoSilentLoss == \E i \in 1..Len(history) : history[i] = tree

====
