---- MODULE NodeTreeFixed ----
(***************************************************************************)
(* `NodeTree` with the four repairs. All five properties hold.             *)
(*                                                                         *)
(* The changes, each marked FIX below:                                     *)
(*                                                                         *)
(*   1. `moveNode` detaches the source subtree instead of deleting it with *)
(*      the promote-sole-child rule, which left the promoted child in the  *)
(*      document twice.                                                    *)
(*   2. Every place that attached a child -- move, duplicate, paste,       *)
(*      add-child, drop -- goes through one `Attach`, which fills a vacated *)
(*      slot, else appends if the kind has room, else unions in place.     *)
(*      Nothing is ever appended past its arity.                           *)
(*   3. The drop target is classified by arity, not by membership of       *)
(*      `NODE_KINDS.primitives`, so `text` and `mesh` are treated as the   *)
(*      leaves they are.                                                   *)
(*   4. Promotion on delete counts real children, not placeholders; and    *)
(*      the selection is clamped to the new tree on every commit.          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxNodes, MaxOps

Nodes  == 1..MaxNodes
NoNode == 0

Kinds == {"Prim", "Leaf", "Bool", "Mod", "Empty", "Unused"}

Capacity == [Prim |-> 0, Leaf |-> 0, Bool |-> 2, Mod |-> 1, Empty |-> 0, Unused |-> 0]

Droppable == {"Prim", "Leaf", "Bool", "Mod"}
Operators == {"Bool", "Mod"}

VARIABLES root, kid, knd, sel, clip, lost, ops

vars == <<root, kid, knd, sel, clip, lost, ops>>

-----------------------------------------------------------------------------

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

Free   == {n \in Nodes : knd[n] = "Unused"}
Fresh1 == CHOOSE n \in Free : \A m \in Free : n <= m
Fresh2 == LET F2 == Free \ {Fresh1} IN CHOOSE n \in F2 : \A m \in F2 : n <= m

GCkid(r, f) == [n \in Nodes |-> IF n \in ReachOf(r, f) THEN f[n] ELSE <<>>]
GCknd(r, f, k) == [n \in Nodes |-> IF n \in ReachOf(r, f) THEN k[n] ELSE "Unused"]

Drop(s, i)      == SubSeq(s, 1, i - 1) \o SubSeq(s, i + 1, Len(s))
ParentOf(f, x)  == IF \E p \in Reach : x \in ChildSet(f, p)
                   THEN CHOOSE p \in Reach : x \in ChildSet(f, p)
                   ELSE NoNode
IdxOf(f, p, x)  == CHOOSE i \in 1..Len(f[p]) : f[p][i] = x
SetSlot(f, x, v) == LET p == ParentOf(f, x)
                    IN IF p = NoNode THEN f ELSE [f EXCEPT ![p][IdxOf(f, p, x)] = v]

EmptyIdxIn(f, k, n) ==
    IF \E i \in 1..Len(f[n]) : k[f[n][i]] = "Empty"
    THEN CHOOSE i \in 1..Len(f[n]) :
           /\ k[f[n][i]] = "Empty"
           /\ \A j \in 1..Len(f[n]) : k[f[n][j]] = "Empty" => i <= j
    ELSE 0

EmptyIdx(f, n) == EmptyIdxIn(f, knd, n)

-----------------------------------------------------------------------------
(* FIX 2 -- the one way to attach a child.                                  *)
(*                                                                          *)
(* Fill a slot a previous delete vacated; else append if the kind still has *)
(* room; else the target is full, so it is replaced in place by a union of  *)
(* itself and the newcomer. The third case is what the old code lacked: it  *)
(* appended regardless, producing children `toSDFNode` never reads.         *)
(*                                                                          *)
(* Unioning in place also removes the root special case -- `SetSlot` is a   *)
(* no-op at the root and `r` moves to the new union -- and it is the same   *)
(* gesture `addPrimitive` and the primitive-on-primitive drop already make, *)
(* so it needs no new idea in the UI.                                       *)
(*                                                                          *)
(* Returns the (root, kid, knd) triple; `u` is a spare id for the union.    *)

Attach(f, k, r, t, c, u) ==
    LET e == EmptyIdxIn(f, k, t)
    IN IF e > 0
       THEN [r |-> r, f |-> [f EXCEPT ![t][e] = c], k |-> k]
       ELSE IF Len(f[t]) < Capacity[k[t]]
       THEN [r |-> r, f |-> [f EXCEPT ![t] = f[t] \o <<c>>], k |-> k]
       ELSE [r |-> IF t = r THEN u ELSE r,
             f |-> [SetSlot(f, t, u) EXCEPT ![u] = <<t, c>>],
             k |-> [k EXCEPT ![u] = "Bool"]]

-----------------------------------------------------------------------------
(* Deletion.                                                                *)

RealKids(x) == {i \in 1..Len(kid[x]) : knd[kid[x][i]] # "Empty"}

\* FIX 4 -- promote on the count of *real* operands. A boolean that lost one
\* operand still has two children, one of them an `_empty` placeholder, and
\* the old `Len(kid[x]) = 1` test therefore refused to promote the survivor
\* and destroyed it instead.
Promote(x) == IF Cardinality(RealKids(x)) = 1
              THEN kid[x][CHOOSE i \in RealKids(x) : TRUE]
              ELSE NoNode

IntendedLoss(x) ==
    LET pr == Promote(x)
    IN IF pr # NoNode THEN ((Desc(x) \cup {x}) \ (Desc(pr) \cup {pr}))
       ELSE Desc(x) \cup {x}

\* Unlink x from its parent. A boolean keeps its arity by parking an `_empty`
\* in the vacated slot; anything else closes the gap. `promote` distinguishes
\* delete (which pulls a sole survivor up into the gap) from move (which must
\* leave the source's subtree strictly alone).
UnlinkRoot(x, pr) == IF x = root THEN pr ELSE root

UnlinkKid(x, pr, e) ==
    LET p == ParentOf(kid, x)
    IN IF x = root THEN kid
       ELSE IF pr # NoNode THEN SetSlot(kid, x, pr)
       ELSE IF knd[p] = "Bool" THEN [kid EXCEPT ![p][IdxOf(kid, p, x)] = e]
       ELSE [kid EXCEPT ![p] = Drop(kid[p], IdxOf(kid, p, x))]

UnlinkKnd(x, pr, e) ==
    LET p == ParentOf(kid, x)
    IN IF x # root /\ pr = NoNode /\ knd[p] = "Bool"
       THEN [knd EXCEPT ![e] = "Empty"]
       ELSE knd

NeedsSlot(x, pr) == x # root /\ pr = NoNode /\ knd[ParentOf(kid, x)] = "Bool"

-----------------------------------------------------------------------------
(* FIX 4 (second half) -- the selection is clamped here, in the one place    *)
(* every mutator already funnels through, rather than at the handful of      *)
(* call sites that happened to remember. `surviving` (modelerStore.ts:85)    *)
(* was already doing this for undo and redo; nothing else did.               *)

Commit(r, f, k, s, il) ==
    LET nr == ReachOf(r, f)
        gone == {n \in Reach : n \notin nr /\ knd[n] # "Empty"}
    IN /\ root' = r
       /\ kid'  = GCkid(r, f)
       /\ knd'  = GCknd(r, f, k)
       /\ sel'  = IF s \in nr THEN s ELSE NoNode
       /\ lost' = lost \cup (gone \ il)
       /\ ops'  = ops + 1

-----------------------------------------------------------------------------
(*                                A C T I O N S                             *)
-----------------------------------------------------------------------------

Select ==
    /\ ops < MaxOps
    /\ \E n \in Live \cup {NoNode} :
         /\ sel' = n
         /\ UNCHANGED <<root, kid, knd, clip, lost>>
    /\ ops' = ops + 1

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

\* Unchanged, deliberately: an operation dragged to empty canvas falls through
\* every branch and does nothing. The model reports it, and it stays -- it
\* loses nothing and breaks nothing, and the behaviour is asserted by
\* "ignores a dropped operation with no target on an existing tree".
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
              ELSE Commit(root, kid, knd, sel, {})
    /\ UNCHANGED clip

\* FIX 3 -- `tIsLeaf` asks the arity question (`expectedChildren(k) === 0`),
\* the same question asked of the dropped node, instead of asking whether the
\* kind is listed in `NODE_KINDS.primitives`. `text` and `mesh` answer the two
\* differently, and answering the second was how they acquired children.
DropOnNode ==
    /\ ops < MaxOps
    /\ Cardinality(Free) >= 2
    /\ root # NoNode
    /\ \E k \in Droppable, t \in Live :
         LET n  == Fresh1
             u  == Fresh2
             isPrim  == Capacity[k] = 0
             tIsLeaf == Capacity[knd[t]] = 0
             wrapKid  == [SetSlot(kid, t, n) EXCEPT ![n] = <<t>>]
             wrapRoot == IF t = root THEN n ELSE root
             uniKid   == [SetSlot(kid, t, u) EXCEPT ![n] = <<>>, ![u] = <<t, n>>]
             uniRoot  == IF t = root THEN u ELSE root
             at == Attach([kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = k], root, t, n, u)
         IN IF ~isPrim /\ tIsLeaf
            THEN Commit(wrapRoot, wrapKid, [knd EXCEPT ![n] = k], n, {})
            ELSE IF isPrim /\ tIsLeaf
            THEN Commit(uniRoot, uniKid, [knd EXCEPT ![n] = k, ![u] = "Bool"], n, {})
            \* An operation dropped on a full operation still wraps it: that
            \* is a deliberate gesture, not an overflow.
            ELSE IF ~isPrim /\ EmptyIdx(kid, t) = 0 /\ Len(kid[t]) >= Capacity[knd[t]]
            THEN Commit(wrapRoot, wrapKid, [knd EXCEPT ![n] = k], n, {})
            ELSE Commit(at.r, at.f, at.k, n, {})
    /\ UNCHANGED clip

\* FIX 1 -- the source is unlinked with `pr = NoNode`: no promotion, so its
\* subtree travels with it intact and nothing is left behind wearing its ids.
\* FIX 2 -- and it lands through `Attach`, so it cannot be parked under a
\* sphere or appended as a third operand.
DragMove ==
    /\ ops < MaxOps
    /\ root # NoNode
    /\ Cardinality(Free) >= 2
    /\ \E s \in Live, t \in Live :
         /\ s # t
         /\ t \notin Desc(s)
         /\ s # root
         /\ LET e  == Fresh1
                u  == Fresh2
                dk == UnlinkKid(s, NoNode, e)
                dn == UnlinkKnd(s, NoNode, e)
                at == Attach(dk, dn, root, t, s, u)
            IN Commit(at.r, at.f, at.k, sel, {})
    /\ UNCHANGED clip

Delete ==
    /\ ops < MaxOps
    /\ root # NoNode
    /\ \E x \in Live :
         /\ ~NeedsSlot(x, Promote(x)) \/ Free # {}
         /\ LET pr == Promote(x) e == Fresh1
            IN Commit(UnlinkRoot(x, pr), UnlinkKid(x, pr, e), UnlinkKnd(x, pr, e),
                      sel, IntendedLoss(x))
    /\ UNCHANGED clip

\* FIX 2 -- the copy lands through `Attach` on the *parent*, so a full parent
\* unions rather than growing a third operand.
Duplicate ==
    /\ ops < MaxOps
    /\ sel \in Reach
    /\ Cardinality(Free) >= 2
    /\ LET d == Fresh1 u == Fresh2 IN
       IF sel = root
       THEN Commit(u, [kid EXCEPT ![d] = <<>>, ![u] = <<root, d>>],
                   [knd EXCEPT ![d] = knd[sel], ![u] = "Bool"], d, {})
       ELSE LET p  == ParentOf(kid, sel)
                at == Attach([kid EXCEPT ![d] = <<>>], [knd EXCEPT ![d] = knd[sel]],
                             root, p, d, u)
            IN Commit(at.r, at.f, at.k, d, {})
    /\ UNCHANGED clip

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

Copy ==
    /\ ops < MaxOps
    /\ sel \in Reach
    /\ clip' = knd[sel]
    /\ UNCHANGED <<root, kid, knd, sel, lost>>
    /\ ops' = ops + 1

\* FIX 2 -- likewise through `Attach`.
Paste ==
    /\ ops < MaxOps
    /\ clip # "Unused"
    /\ Cardinality(Free) >= 2
    /\ LET n == Fresh1 u == Fresh2 IN
       IF root = NoNode
       THEN Commit(n, [kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = clip], n, {})
       ELSE /\ sel \in Reach
            /\ LET at == Attach([kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = clip],
                                root, sel, n, u)
               IN Commit(at.r, at.f, at.k, n, {})
    /\ UNCHANGED clip

\* addChildToSelected -- the store API the AI chat and tests drive. Same
\* attach policy as everything else.
AddChild ==
    /\ ops < MaxOps
    /\ sel \in Reach
    /\ Cardinality(Free) >= 2
    /\ \E k \in Droppable :
         LET n == Fresh1
             u == Fresh2
             at == Attach([kid EXCEPT ![n] = <<>>], [knd EXCEPT ![n] = k], root, sel, n, u)
         IN Commit(at.r, at.f, at.k, n, {})
    /\ UNCHANGED clip

Done == (ops >= MaxOps \/ Cardinality(Free) < 2) /\ UNCHANGED vars

Next ==
    \/ Select \/ AddPrimitive \/ DropOnCanvas \/ DropOnNode
    \/ DragMove \/ Delete \/ Duplicate \/ Wrap \/ Copy \/ Paste \/ AddChild
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

TypeOK ==
    /\ root \in Nodes \cup {NoNode}
    /\ knd \in [Nodes -> Kinds]
    /\ sel \in Nodes \cup {NoNode}
    /\ clip \in Kinds

Slots(n) == {<<p, i>> \in Reach \X (1..MaxNodes) :
                /\ i <= Len(kid[p])
                /\ kid[p][i] = n}

IsATree == \A n \in Reach : Cardinality(Slots(n)) + (IF root = n THEN 1 ELSE 0) = 1

Acyclic == \A n \in Reach : n \notin Desc(n)

WithinCapacity == \A n \in Reach : Len(kid[n]) <= Capacity[knd[n]]

SelectionValid == sel = NoNode \/ sel \in Reach

NoSilentLoss == lost = {}

(***************************************************************************)
(* NoStrayPlaceholder -- `_empty` exists to hold a boolean's slot open. It  *)
(* has no meaning anywhere else, and `isTreeValid` rejects any tree         *)
(* containing one outside that position (operations.ts:88).                *)
(***************************************************************************)
NoStrayPlaceholder ==
    \A n \in Reach : knd[n] = "Empty" =>
        \E p \in Reach : /\ n \in ChildSet(kid, p)
                         /\ knd[p] = "Bool"

====
