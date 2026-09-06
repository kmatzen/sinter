---- MODULE NodeTree ----
(***************************************************************************)
(* Structural integrity of the node tree under editing --                  *)
(* `src/store/modelerStore.ts`.                                            *)
(*                                                                         *)
(* Every action here is something a user can do with a mouse: click a node *)
(* to select it, drag one node onto another, drag a shape in from the      *)
(* palette, drop on empty canvas, press the X, duplicate, wrap, copy,      *)
(* paste. The question the model asks is whether any *sequence* of those   *)
(* gestures can leave the document in a shape the rest of the app cannot   *)
(* handle.                                                                 *)
(*                                                                         *)
(* Four safety properties are specified. All four fail against the current *)
(* design; see README.md for the counterexamples and                       *)
(* NodeTreeFixed.tla for the repair.                                       *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxNodes, MaxOps

Nodes  == 1..MaxNodes
NoNode == 0

(***************************************************************************)
(* Kinds are abstracted to their arity, because arity is all the editing   *)
(* code branches on -- with one exception that matters enormously:         *)
(*                                                                         *)
(*   Prim   box, sphere, ... -- arity 0, and *in* `NODE_KINDS.primitives`  *)
(*   Leaf   text, mesh       -- arity 0, and deliberately NOT in that list *)
(*                              (operations.ts:14-17)                      *)
(*   Bool   union, subtract, intersect        -- arity 2                   *)
(*   Mod    shell/offset/round/mirror/halfSpace/patterns/transforms -- 1   *)
(*   Empty  the `_empty` placeholder (modelerStore.ts:134)                 *)
(*   Unused an id that has not been allocated                              *)
(*                                                                         *)
(* `addNodeFromData` tests `NODE_KINDS.primitives.includes(...)` for the   *)
(* drop target but `expectedChildren(...) === 0` for the dropped node      *)
(* (:413, :441). Collapsing Prim and Leaf into one kind would hide that    *)
(* disagreement, which is exactly what one of the counterexamples is.      *)
(***************************************************************************)
Kinds == {"Prim", "Leaf", "Bool", "Mod", "Empty", "Unused"}

Capacity == [Prim |-> 0, Leaf |-> 0, Bool |-> 2, Mod |-> 1, Empty |-> 0, Unused |-> 0]

\* What a user can introduce: shapes and operations from the palette, and a
\* Leaf via ImportMesh (ImportMesh.tsx:75 routes through addNodeFromData too).
Droppable == {"Prim", "Leaf", "Bool", "Mod"}

\* `wrapSelected` and `addPrimitive` are reached from AddNodeMenu, which offers
\* primitives to one and operations to the other (AddNodeMenu.tsx:41,:46).
Operators == {"Bool", "Mod"}

VARIABLES
    root,   \* the root node id, or NoNode for an empty document
    kid,    \* [Nodes -> Seq(Nodes)] -- children, in slot order
    knd,    \* [Nodes -> Kinds]
    sel,    \* selectedNodeId
    clip,   \* clipboard: the kind of the copied node, or "Unused" for empty
    lost,   \* AUX: nodes an edit dropped that it had no business dropping
    ops

vars == <<root, kid, knd, sel, clip, lost, ops>>

-----------------------------------------------------------------------------
(* Reachability.                                                            *)
(*                                                                          *)
(* `kid` is a general graph, not a tree by construction. That is the point: *)
(* the implementation manipulates parent and child links independently, so  *)
(* whether the result is still a tree is a property to be checked, not an   *)
(* assumption to be baked in. Closure is a monotone fixpoint over a finite  *)
(* set, so it terminates even when the graph has a cycle.                   *)

ChildSet(f, n) == {f[n][i] : i \in 1..Len(f[n])}

RECURSIVE Close(_, _)
Close(f, S) ==
    LET T == S \cup UNION {ChildSet(f, n) : n \in S}
    IN IF T = S THEN S ELSE Close(f, T)

ReachOf(r, f) == IF r = NoNode THEN {} ELSE Close(f, {r})

Reach   == ReachOf(root, kid)
Desc(n) == Close(kid, ChildSet(kid, n))

\* Nodes a user can actually point at. An `_empty` renders as a
\* PlaceholderSlot (TreeNode.tsx:254), which has no click handler, no drag
\* handle and no remove button, and whose drop handler passes the *parent*
\* id (:299,:303). So a placeholder is never a source, target or selection.
Live == {n \in Reach : knd[n] # "Empty"}

-----------------------------------------------------------------------------
(* Allocation and garbage collection.                                       *)
(*                                                                          *)
(* Ids are uuids, so a real id is never reused. The model recycles ids that *)
(* have fallen out of the tree purely to keep the state canonical -- two    *)
(* documents that differ only in the identity of discarded garbage are the  *)
(* same document. Nothing below inspects an unreachable node.               *)

Free   == {n \in Nodes : knd[n] = "Unused"}
Fresh1 == CHOOSE n \in Free : \A m \in Free : n <= m
Fresh2 == LET F2 == Free \ {Fresh1} IN CHOOSE n \in F2 : \A m \in F2 : n <= m

GCkid(r, f) == [n \in Nodes |-> IF n \in ReachOf(r, f) THEN f[n] ELSE <<>>]
GCknd(r, f, k) == [n \in Nodes |-> IF n \in ReachOf(r, f) THEN k[n] ELSE "Unused"]

-----------------------------------------------------------------------------
(* Sequence and slot helpers.                                               *)

Drop(s, i)      == SubSeq(s, 1, i - 1) \o SubSeq(s, i + 1, Len(s))
ParentOf(f, x)  == IF \E p \in Reach : x \in ChildSet(f, p)
                   THEN CHOOSE p \in Reach : x \in ChildSet(f, p)
                   ELSE NoNode
IdxOf(f, p, x)  == CHOOSE i \in 1..Len(f[p]) : f[p][i] = x

\* Put `v` in the slot that currently holds `x`. Callers handle x = root.
SetSlot(f, x, v) == LET p == ParentOf(f, x)
                    IN IF p = NoNode THEN f ELSE [f EXCEPT ![p][IdxOf(f, p, x)] = v]

\* addChildPreferSlot (modelerStore.ts:160): fill the first `_empty`
\* placeholder if there is one, otherwise append -- unconditionally, with no
\* regard for how many children the kind can actually carry.
EmptyIdx(f, n) == IF \E i \in 1..Len(f[n]) : knd[f[n][i]] = "Empty"
                  THEN CHOOSE i \in 1..Len(f[n]) :
                         /\ knd[f[n][i]] = "Empty"
                         /\ \A j \in 1..Len(f[n]) : knd[f[n][j]] = "Empty" => i <= j
                  ELSE 0

AddPreferSlot(f, n, c) ==
    LET e == EmptyIdx(f, n)
    IN IF e > 0 THEN [f EXCEPT ![n][e] = c] ELSE [f EXCEPT ![n] = f[n] \o <<c>>]

-----------------------------------------------------------------------------
(* removeFromTree (modelerStore.ts:138).                                    *)
(*                                                                          *)
(* "If this node has exactly one child, promote the child" -- counting      *)
(* `_empty` placeholders as children, which is the whole of the difference  *)
(* between this and PromoteFixed in NodeTreeFixed.tla.                      *)

Promote(x) == IF Len(kid[x]) = 1 THEN kid[x][1] ELSE NoNode

RealKids(x)  == {i \in 1..Len(kid[x]) : knd[kid[x][i]] # "Empty"}

\* What a delete is *entitled* to destroy: the node, plus its subtree unless
\* it has a single real operand, which the user expects to survive.
IntendedLoss(x) ==
    LET rk == RealKids(x)
    IN IF Cardinality(rk) = 1
       THEN LET c == kid[x][CHOOSE i \in rk : TRUE]
            IN ((Desc(x) \cup {x}) \ (Desc(c) \cup {c}))
       ELSE Desc(x) \cup {x}

\* The structural half of removeFromTree, as (newRoot, newKid, newKnd).
\* Split out because moveNode calls it too (:503).
RemovedRoot(x) == IF x = root THEN Promote(x) ELSE root

RemovedKid(x) ==
    LET pr == Promote(x)
        p  == ParentOf(kid, x)
    IN IF x = root THEN kid
       ELSE IF pr # NoNode THEN SetSlot(kid, x, pr)
       ELSE IF knd[p] = "Bool" THEN [kid EXCEPT ![p][IdxOf(kid, p, x)] = Fresh1]
       ELSE [kid EXCEPT ![p] = Drop(kid[p], IdxOf(kid, p, x))]

\* A boolean keeps its arity by parking an `_empty` in the vacated slot.
RemovedKnd(x) ==
    LET pr == Promote(x)
        p  == ParentOf(kid, x)
    IN IF x # root /\ pr = NoNode /\ knd[p] = "Bool"
       THEN [knd EXCEPT ![Fresh1] = "Empty"]
       ELSE knd

\* Removing into a boolean slot needs one spare id for the placeholder.
RemoveNeedsId(x) ==
    /\ x # root
    /\ Promote(x) = NoNode
    /\ knd[ParentOf(kid, x)] = "Bool"

-----------------------------------------------------------------------------
(* Committing an edit.                                                      *)
(*                                                                          *)
(* Every action funnels through this so the bookkeeping -- garbage          *)
(* collection, the `lost` ledger, the operation counter -- is written once. *)
(* `il` is the set the action is allowed to destroy; anything else that     *)
(* falls out of the tree is silent loss. `_empty` placeholders are excluded *)
(* throughout: they are scaffolding, not the user's work.                   *)

Commit(r, f, k, s, il) ==
    LET nr == ReachOf(r, f)
        gone == {n \in Reach : n \notin nr /\ knd[n] # "Empty"}
    IN /\ root' = r
       /\ kid'  = GCkid(r, f)
       /\ knd'  = GCknd(r, f, k)
       /\ sel'  = s
       /\ lost' = lost \cup (gone \ il)
       /\ ops'  = ops + 1

\* Selection is only cleared when the *selected id itself* was the target
\* (modelerStore.ts:268). Removing an ancestor is not considered.
KeepSel(x) == IF sel = x THEN NoNode ELSE sel

-----------------------------------------------------------------------------
(*                                A C T I O N S                             *)
-----------------------------------------------------------------------------

\* Click a node in the tree, or in the viewport, or click away.
Select ==
    /\ ops < MaxOps
    /\ \E n \in Live \cup {NoNode} :
         /\ sel' = n
         /\ UNCHANGED <<root, kid, knd, clip, lost>>
    /\ ops' = ops + 1

\* AddNodeMenu -> addPrimitive (modelerStore.ts:323). Empty document: the
\* shape becomes the root. Otherwise the tree is auto-unioned with it.
AddPrimitive ==
    /\ ops < MaxOps
    /\ Cardinality(Free) >= 2
    /\ LET n == Fresh1 u == Fresh2 IN
       /\ IF root = NoNode
          THEN Commit(n, [kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = "Prim"], n, {})
          ELSE Commit(u,
                      [kid EXCEPT ![n] = <<>>, ![u] = <<root, n>>],
                      [knd EXCEPT ![n] = "Prim", ![u] = "Bool"],
                      n, {})
    /\ UNCHANGED clip

\* Drag a shape from the palette onto empty canvas, or click a palette entry
\* with nothing selected (addNodeFromData with targetId = null, :429).
DropOnCanvas ==
    /\ ops < MaxOps
    /\ Cardinality(Free) >= 2
    /\ \E k \in Droppable :
         LET n == Fresh1 u == Fresh2 IN
         IF root = NoNode
         THEN Commit(n, [kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = k], n, {})
         ELSE IF Capacity[k] = 0
              THEN Commit(u,
                          [kid EXCEPT ![n] = <<>>, ![u] = <<root, n>>],
                          [knd EXCEPT ![n] = k, ![u] = "Bool"],
                          n, {})
              \* An operation dropped on empty canvas falls through every
              \* branch and does nothing at all -- silently (:431-435).
              ELSE Commit(root, kid, knd, sel, {})
    /\ UNCHANGED clip

\* Drag a shape from the palette onto a node in the tree, or click a palette
\* entry while a node is selected, or import a mesh (addNodeFromData, :438).
DropOnNode ==
    /\ ops < MaxOps
    /\ Cardinality(Free) >= 2
    /\ root # NoNode
    /\ \E k \in Droppable, t \in Live :
         LET n  == Fresh1
             u  == Fresh2
             isPrim == Capacity[k] = 0          \* expectedChildren(k) === 0
             tIsPrim == knd[t] = "Prim"         \* NODE_KINDS.primitives only
             tExpect == Capacity[knd[t]]
             tRoom == Len(kid[t]) < tExpect \/ EmptyIdx(kid, t) > 0
             \* wrap: the new operation takes the target's place, target
             \* becomes its child. Same ids, so nothing is duplicated.
             wrapKid  == [SetSlot(kid, t, n) EXCEPT ![n] = <<t>>]
             wrapRoot == IF t = root THEN n ELSE root
             uniKid   == [SetSlot(kid, t, u) EXCEPT ![n] = <<>>, ![u] = <<t, n>>]
             uniRoot  == IF t = root THEN u ELSE root
         IN IF ~isPrim /\ tIsPrim
            THEN Commit(wrapRoot, wrapKid, [knd EXCEPT ![n] = k], n, {})
            ELSE IF isPrim /\ tIsPrim
            THEN Commit(uniRoot, uniKid, [knd EXCEPT ![n] = k, ![u] = "Bool"], n, {})
            \* `targetExpected === 0` (:467) is meant to catch primitives, but
            \* a primitive target was already handled above. What actually
            \* reaches it is a Leaf -- text or an imported mesh.
            ELSE IF tRoom \/ tExpect = 0
            THEN Commit(root, [AddPreferSlot(kid, t, n) EXCEPT ![n] = <<>>],
                        [knd EXCEPT ![n] = k], n, {})
            ELSE IF ~isPrim
            THEN Commit(wrapRoot, wrapKid, [knd EXCEPT ![n] = k], n, {})
            \* A shape dropped on a full operation is appended past its
            \* arity (:483).
            ELSE Commit(root, [AddPreferSlot(kid, t, n) EXCEPT ![n] = <<>>],
                        [knd EXCEPT ![n] = k], n, {})
    /\ UNCHANGED clip

\* Drag one node in the tree onto another (moveNode, :494).
DragMove ==
    /\ ops < MaxOps
    /\ root # NoNode
    /\ \E s \in Live, t \in Live :
         /\ s # t
         \* findNode(sourceNode, targetId) -- refuse to move into own subtree.
         /\ t \notin Desc(s)
         /\ RemovedRoot(s) # NoNode
         /\ ~RemoveNeedsId(s) \/ Free # {}
         /\ LET rk == RemovedKid(s)
                rn == RemovedKnd(s)
            \* The source subtree is re-attached under the target. Note what
            \* is *not* done: RemovedKid promoted the source's only child into
            \* the source's old slot, and nothing detaches it from the source.
            IN Commit(RemovedRoot(s), AddPreferSlot(rk, t, s), rn, sel, {})
    /\ UNCHANGED clip

\* Press the X on a row, or hit Delete/Backspace (removeNode, :263).
Delete ==
    /\ ops < MaxOps
    /\ root # NoNode
    /\ \E x \in Live :
         /\ ~RemoveNeedsId(x) \/ Free # {}
         /\ Commit(RemovedRoot(x), RemovedKid(x), RemovedKnd(x),
                   KeepSel(x), IntendedLoss(x))
    /\ UNCHANGED clip

\* The duplicate button, or Cmd-D (duplicateSelected, :543).
(***************************************************************************)
(* The copy is modelled as a single fresh node rather than a deep clone of  *)
(* the subtree. `reassignIds` gives the clone entirely fresh ids, so its    *)
(* internal shape can neither collide with nor overflow anything; the only  *)
(* structural question is where the copy is attached, and that is faithful. *)
(***************************************************************************)
Duplicate ==
    /\ ops < MaxOps
    /\ sel \in Reach
    /\ Cardinality(Free) >= 2
    /\ LET d == Fresh1 u == Fresh2 IN
       IF sel = root
       THEN Commit(u, [kid EXCEPT ![d] = <<>>, ![u] = <<root, d>>],
                   [knd EXCEPT ![d] = knd[sel], ![u] = "Bool"], d, {})
       ELSE LET p == ParentOf(kid, sel)
            \* Appended to the parent unconditionally (:560-563) -- no slot
            \* preference, no arity check.
            IN Commit(root, [kid EXCEPT ![d] = <<>>, ![p] = kid[p] \o <<d>>],
                      [knd EXCEPT ![d] = knd[sel]], d, {})
    /\ UNCHANGED clip

\* AddNodeMenu -> wrapSelected (:338), and the gizmo's implicit wrap
\* (GizmoController.ts:222).
(***************************************************************************)
(* The real action picks between wrapping the target and inserting inside   *)
(* it by testing the *specific* kinds involved (translate wraps outside,    *)
(* rotate and scale insert inside). Arity cannot express that, so the model *)
(* offers both branches nondeterministically wherever the real code could   *)
(* take either. Both are reachable; neither is invented.                    *)
(***************************************************************************)
Wrap ==
    /\ ops < MaxOps
    /\ sel \in Reach
    /\ Free # {}
    /\ \E k \in Operators :
         LET w == Fresh1 IN
         \/ /\ Commit(IF sel = root THEN w ELSE root,
                      [SetSlot(kid, sel, w) EXCEPT ![w] = <<sel>>],
                      [knd EXCEPT ![w] = k], w, {})
         \/ /\ Capacity[knd[sel]] = 1
            /\ Len(kid[sel]) > 0
            /\ Commit(root,
                      [kid EXCEPT ![w] = kid[sel], ![sel] = <<w>>],
                      [knd EXCEPT ![w] = k], w, {})
    /\ UNCHANGED clip

\* Cmd-C (copySelected, :516).
Copy ==
    /\ ops < MaxOps
    /\ sel \in Reach
    /\ clip' = knd[sel]
    /\ UNCHANGED <<root, kid, knd, sel, lost>>
    /\ ops' = ops + 1

\* Cmd-V (pasteToSelected, :523).
Paste ==
    /\ ops < MaxOps
    /\ clip # "Unused"
    /\ Free # {}
    /\ LET n == Fresh1 IN
       IF root = NoNode
       THEN Commit(n, [kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = clip], n, {})
       ELSE /\ sel \in Reach
            \* Appended unconditionally, exactly as duplicate does (:534-537).
            /\ Commit(root,
                      [kid EXCEPT ![n] = <<>>, ![sel] = kid[sel] \o <<n>>],
                      [knd EXCEPT ![n] = clip], n, {})
    /\ UNCHANGED clip

Done == (ops >= MaxOps \/ Free = {}) /\ UNCHANGED vars

Next ==
    \/ Select \/ AddPrimitive \/ DropOnCanvas \/ DropOnNode
    \/ DragMove \/ Delete \/ Duplicate \/ Wrap \/ Copy \/ Paste
    \/ Done

Init ==
    /\ root = NoNode
    /\ kid  = [n \in Nodes |-> <<>>]
    /\ knd  = [n \in Nodes |-> "Unused"]
    /\ sel  = NoNode
    /\ clip = "Unused"
    /\ lost = {}
    /\ ops  = 0

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(*                             P R O P E R T I E S                          *)
-----------------------------------------------------------------------------

TypeOK ==
    /\ root \in Nodes \cup {NoNode}
    /\ knd \in [Nodes -> Kinds]
    /\ sel \in Nodes \cup {NoNode}
    /\ clip \in Kinds

(***************************************************************************)
(* IsATree -- the document is a tree: every node in it occupies exactly one *)
(* slot. A node in two slots is a node with two parents, which for this     *)
(* code means the same *id* in two places: `findNode` returns only the      *)
(* first, `updateInTree` rewrites both, and an edit aimed at one occurrence *)
(* silently lands on the other as well.                                     *)
(***************************************************************************)
Slots(n) == {<<p, i>> \in Reach \X (1..MaxNodes) :
                /\ i <= Len(kid[p])
                /\ kid[p][i] = n}

IsATree == \A n \in Reach : Cardinality(Slots(n)) + (IF root = n THEN 1 ELSE 0) = 1

(***************************************************************************)
(* Acyclic -- no node is its own descendant. `findNode`, `updateInTree`,    *)
(* `cloneTree` and `toSDFNode` all recurse without a visited set, so a      *)
(* cycle is not a wrong render, it is a hung tab.                           *)
(***************************************************************************)
Acyclic == \A n \in Reach : n \notin Desc(n)

(***************************************************************************)
(* WithinCapacity -- no node carries more children than its kind can use.   *)
(*                                                                         *)
(* This is the invariant with teeth. `toSDFNode` (convert.ts:97-165) reads  *)
(* `children[0]` and `children[1]` and nothing further, so a third operand  *)
(* under a union, or any child of a `text` or `mesh` node, is dropped on    *)
(* the floor. Worse, `incompleteNodeIds` only flags nodes with *too few*    *)
(* children (operations.ts:109), so the tree shows no warning either: the   *)
(* shape is in the outline, and simply is not in the model.                 *)
(***************************************************************************)
WithinCapacity == \A n \in Reach : Len(kid[n]) <= Capacity[knd[n]]

(***************************************************************************)
(* SelectionValid -- the selected id, if any, is a node that exists.        *)
(*                                                                         *)
(* The store already knows this matters: `surviving` (:85) exists to stop   *)
(* undo leaving a dangling id, and its comment says a dangling id "makes    *)
(* every findNode consumer silently no-op" -- the property panel goes       *)
(* blank, the gizmo detaches, paste and duplicate quietly do nothing.       *)
(***************************************************************************)
SelectionValid == sel = NoNode \/ sel \in Reach

(***************************************************************************)
(* NoSilentLoss -- no edit destroys work it was not asked to destroy.       *)
(***************************************************************************)
NoSilentLoss == lost = {}

====
