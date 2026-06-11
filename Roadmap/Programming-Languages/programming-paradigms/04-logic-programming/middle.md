# Logic Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Logic Programming
> *The engine isn't magic. It's a depth-first search over a proof tree, driven by one matching algorithm and one rewind rule — and once you can see that tree, Prolog stops surprising you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [SLD Resolution — How a Query Becomes a Proof](#sld-resolution--how-a-query-becomes-a-proof)
4. [The Search Tree, Drawn Out](#the-search-tree-drawn-out)
5. [Unification, Properly — the Most General Unifier](#unification-properly--the-most-general-unifier)
6. [Backtracking Mechanics](#backtracking-mechanics)
7. [Recursion and Lists](#recursion-and-lists)
8. [`append/3` — One Predicate, Many Directions](#append3--one-predicate-many-directions)
9. [The Cut — Controlling the Search](#the-cut--controlling-the-search)
10. [The Closed-World Assumption](#the-closed-world-assumption)
11. [Negation as Failure](#negation-as-failure)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and how do I control it?**

At junior level you learned the three pieces — facts, rules, queries — and the two engines: unification and backtracking. That's enough to *write* logic programs. It is not enough to *understand why yours behaves the way it does* — why it loops forever, why it gives answers in that order, why adding a clause changes everything.

This page opens the box. We'll name the exact procedure the engine runs (**SLD resolution**), draw the **search tree** it walks, define unification precisely (the **most general unifier**), and then meet the two tools that separate people who *use* Prolog from people who *fight* it: the **cut** (`!`), which prunes the search, and **negation as failure**, which is how logic programming says "not" — with a subtle trap built in.

> **The mindset shift:** a logic program is *both* a logical theory (what's true) *and* a search procedure (how the engine looks). The gap between those two readings — declarative meaning vs operational behavior — is where every nontrivial Prolog bug lives. This page teaches you to hold both readings at once.

---

## Prerequisites

- **Required:** [junior.md](junior.md) — facts, rules, queries, unification, backtracking, the closed-world hint.
- **Required:** Comfort with recursion (a function calling itself, base case + recursive case). Prolog leans on it heavily.
- **Helpful:** You've drawn a recursion or call tree before. We'll draw the analogous *proof tree* here.
- **Helpful:** You know what depth-first search is. Prolog's whole execution strategy is DFS over a tree of choices.

---

## SLD Resolution — How a Query Becomes a Proof

The procedure Prolog runs has a name: **SLD resolution** (Selective Linear Definite-clause resolution). You don't need the formal logic to use it, but the operational summary is short and worth memorizing:

> To prove a list of goals: take the **leftmost** goal, find a clause whose head **unifies** with it, replace the goal with that clause's **body** (after applying the bindings), and repeat. Succeed when the goal list is empty. On failure, **backtrack** to the last clause choice.

Step by step, the loop is:

1. **Pick the leftmost goal** in the current goal list. (Prolog always goes left to right.)
2. **Scan clauses top to bottom** for one whose head unifies with that goal. (Prolog always goes top to bottom.)
3. On a match, **apply the bindings** and **replace** the goal with the matched clause's body. A fact has an empty body, so it just disappears (proved).
4. If the goal list is now empty → **success**; report the bindings.
5. If no clause matched → **fail**; backtrack to the most recent choice point and try the *next* clause there.

Two phrases carry enormous weight: **leftmost goal** and **top-to-bottom clauses**. They fix the entire execution order. They are *not* part of the logical meaning of your program — logically, "A and B" equals "B and A" — but they are completely part of how Prolog *runs*. Reorder goals in a body, or reorder clauses in a predicate, and the logic is identical while the behavior (speed, answer order, even termination) can change drastically. Hold onto that tension; it's the recurring theme of [senior.md](senior.md).

---

## The Search Tree, Drawn Out

Make it concrete. Database:

```prolog
parent(tom, bob).
parent(tom, liz).
parent(bob, ann).
parent(bob, pat).

grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
```

Query: `?- grandparent(tom, G).` SLD builds this tree (each node is the current goal list; each branch is a clause choice):

```
                 grandparent(tom, G)
                          |  (only one grandparent clause; X=tom, Z=G)
              parent(tom, Y), parent(Y, G)
                 /                 \
        Y=bob (fact 1)         Y=liz (fact 2)
              |                     |
       parent(bob, G)        parent(liz, G)
         /        \                 |
   G=ann       G=pat          (no parent(liz,_) fact)
  (fact 3)    (fact 4)               |
     |           |                  FAIL ✗
  □ G=ann     □ G=pat
  SOLUTION    SOLUTION
```

Read the tree the way Prolog walks it — **depth-first, left-to-right**:

1. Go down to `parent(tom, Y)`. First matching fact: `Y = bob`. **This is a choice point** — there are more `parent(tom, _)` facts to try later.
2. Now prove `parent(bob, G)`. First match: `G = ann`. Goal list empty → **report `G = ann`**.
3. Ask for more (`;`) → backtrack to the last choice point: `parent(bob, G)` still has `G = pat`. → **report `G = pat`**.
4. More? `parent(bob, G)` exhausted. Backtrack further to `parent(tom, Y)`: try `Y = liz`.
5. Prove `parent(liz, G)` → no such fact → **FAIL**, that whole branch is dead.
6. `parent(tom, Y)` exhausted. Tree fully explored. Done.

**This tree is your debugger.** When a query loops forever, an infinite branch exists. When answers come in a "weird" order, that's the left-to-right, top-to-bottom walk. When it's slow, the tree is too wide or too deep. Learning to sketch this tree — on paper or in your head — is the single highest-leverage skill in becoming fluent. Use Prolog's `trace.` to watch the engine walk it live.

---

## Unification, Properly — the Most General Unifier

Junior level gave you unification as "two-way pattern matching." Here's the precise version. To **unify** two terms is to find a **substitution** (a set of variable→value bindings) that makes them syntactically identical. The algorithm:

- **atom vs the same atom** → succeed, no bindings.
- **atom vs a different atom** (or different arity/functor) → fail.
- **variable `V` vs term `t`** → succeed, binding `V = t` (if `V` is unbound).
- **compound `f(a1..an)` vs `f(b1..bn)`** → unify `a1` with `b1`, `a2` with `b2`, … all must succeed; bindings accumulate.

When a unifier exists, there's a *best* one: the **most general unifier (MGU)** — the substitution that commits to as little as possible. Example:

```prolog
?- point(X, Y) = point(3, Z).
% X = 3, Y = Z.       % MGU: X must be 3; Y and Z are linked but UNCOMMITTED.
```

The engine does *not* arbitrarily pick `Y = 0`. It binds only what's forced (`X = 3`) and links the rest (`Y` and `Z` become the same variable). "Most general" = "leaves the most freedom." This generality is why one Prolog relation answers many queries: it never over-commits, so later goals can still constrain the open variables.

**The occurs check.** A subtlety: should `X = f(X)` unify? Binding `X` to a term *containing X* creates an infinite term. Logically it should fail (the "occurs check"). For speed, standard Prolog **skips this check by default**, so `X = f(X)` "succeeds" and can later loop or crash. It's rarely hit in normal code, but know it exists; `unify_with_occurs_check/2` is the safe version.

---

## Backtracking Mechanics

Backtracking is precise, not vague "trying again." Mechanically:

- A **choice point** is created whenever more than one clause could match a goal (or a built-in like `member/2` has more solutions to offer). The engine records "I'm here, and here are the alternatives I haven't tried."
- On **success**, execution continues forward with the current bindings.
- On **failure** (a goal that can't be proved), the engine **backtracks**: it jumps to the most recent choice point, **undoes all variable bindings made since** that point, and tries the next alternative.
- When you ask for another answer with `;`, that's a *deliberately triggered* backtrack into the last choice point — same machinery.
- When a choice point has no alternatives left, it's discarded and backtracking continues to the *previous* one. When none remain, the query is finished.

The critical detail beginners miss: **bindings are undone on backtrack.** A variable bound to `bob` on one branch becomes unbound again when that branch fails — it is *not* permanently `bob`. Variables are not assignment; they're temporary commitments that the search can retract. This is why you cannot "accumulate a counter" the imperative way; there's nothing that survives a backtrack except what you thread through explicitly (often via recursion arguments).

---

## Recursion and Lists

Prolog has no loops. **Recursion is the only iteration**, and **lists** are the workhorse data structure. A list is written `[a, b, c]`, and the central trick is splitting it into **head** and **tail**:

```prolog
[H | T]        % H is the first element; T is the list of the rest.
[a, b, c]      % unifies with [H|T] giving  H = a,  T = [b, c].
[]             % the empty list — the base case for most recursions.
```

Classic pattern — every list predicate is "base case for `[]`, recursive case peeling off `[H|T]`":

```prolog
% length of a list
len([], 0).                       % empty list has length 0
len([_ | T], N) :-                % peel the head (we don't need its value: _)
    len(T, N0),                   % recurse on the tail
    N is N0 + 1.                  % `is` evaluates arithmetic (N0+1)

% sum of a numeric list
sum([], 0).
sum([H | T], S) :- sum(T, S0), S is S0 + H.

% membership — note it has NO explicit loop and runs in two directions
member(X, [X | _]).               % X is the head → yes
member(X, [_ | T]) :- member(X, T).   % otherwise look in the tail
```

A note on `is`: arithmetic is *not* automatic. `N = N0 + 1` unifies `N` with the *term* `N0 + 1` (literally the structure `+`); `N is N0 + 1` **evaluates** it to a number. Forgetting `is` is a top recurring bug. Arithmetic is the one place Prolog stops being relational and becomes directional — the right side must be fully bound.

`member/2` is worth a second look. With a bound first argument it *checks* membership; with an unbound one it **generates** every element via backtracking:

```prolog
?- member(b, [a,b,c]).   % true.            (checking)
?- member(X, [a,b,c]).   % X=a ; X=b ; X=c. (generating, one per backtrack)
```

Same predicate, two uses, decided entirely by what you leave unbound — the multi-directional property from junior level, now in your own recursive code.

---

## `append/3` — One Predicate, Many Directions

The canonical demonstration of relational power is `append/3`, which relates three lists where the third is the first two concatenated:

```prolog
append([], L, L).                       % [] ++ L is L
append([H | T], L, [H | R]) :-          % (H:T) ++ L is H:(T ++ L)
    append(T, L, R).
```

Two clauses. Now watch one definition answer four different questions, depending on which arguments are bound:

```prolog
% 1. CONCATENATE (the obvious use):
?- append([a,b], [c,d], R).
% R = [a, b, c, d].

% 2. SUBTRACT a known prefix — run it "backwards":
?- append([a,b], X, [a,b,c,d]).
% X = [c, d].

% 3. SPLIT a list every possible way — enumerate via backtracking:
?- append(Front, Back, [a,b,c]).
% Front=[],      Back=[a,b,c] ;
% Front=[a],     Back=[b,c]   ;
% Front=[a,b],   Back=[c]     ;
% Front=[a,b,c], Back=[]      .

% 4. TEST whether a concatenation holds:
?- append([a], [b], [a,b]).
% true.
```

You wrote *one* relation and got concatenation, prefix removal, an all-splits generator, and a checker. In an imperative language each is a separate function. This is the headline feature of logic programming — **a relation has no fixed direction**; "input" and "output" are just which arguments you happen to bind. Use case #3 (the splitter) is how you write surprisingly elegant search code: "split this list into a front and back such that <some property>," and let backtracking try every split.

---

## The Cut — Controlling the Search

The pure declarative ideal has a cost: sometimes the engine explores branches you *know* are pointless, wasting time or producing duplicate/wrong answers. The **cut**, written `!`, is the control valve. It is a goal that always succeeds, but with a side effect:

> **`!` commits to all the choices made since entering the current clause.** It discards the choice points for (a) which clause was selected for this predicate, and (b) the goals to the cut's left in this body. Backtracking can no longer undo them.

Concrete use — `max/3` without re-checking on backtrack:

```prolog
max(X, Y, X) :- X >= Y, !.    % if X>=Y, answer is X — and COMMIT, don't try clause 2
max(_, Y, Y).                 % otherwise the answer is Y
```

Without the cut, `?- max(5, 3, M).` would give `M = 5`, but on backtracking *also* try clause 2 and wrongly offer `M = 3`. The `!` says "once `X >= Y` held, this is *the* answer; stop considering alternatives." It prunes the tree.

Two flavors, by intent:

- **Green cut** — removes choice points that could only fail or duplicate anyway. Pure efficiency; the program's *meaning* is unchanged. The `max` cut above, when paired with mutually exclusive conditions, is roughly green.
- **Red cut** — changes the set of answers; the program now *depends* on the cut for correctness. The `max` example is actually slightly red: clause 2 has no guard, so removing the cut produces a wrong extra answer. Red cuts are powerful and dangerous — they break the clean "logic" reading of your code, so the operational behavior and the declarative meaning diverge.

> **Rule of thumb:** reach for green cuts to prune dead search; treat red cuts as a code smell to isolate and comment. Every cut is a place where your program stopped being pure logic and became a controlled procedure. [senior.md](senior.md) returns to this as the central trade-off of the paradigm.

---

## The Closed-World Assumption

When is something **false** in a logic program? Junior level hinted at the answer; here it is precisely:

> **Closed-World Assumption (CWA):** anything *not provable* from the stated facts and rules is taken to be **false**.

The program's database is assumed to be the *complete* truth about the world. If `parent(tom, jim)` cannot be derived, Prolog concludes it is false — not "unknown," not "I have no data," but **false**. There is no notion of missing information; absence of proof *is* proof of absence.

```prolog
parent(tom, bob).
?- parent(tom, jim).
% false.   % NOT because tom isn't jim's parent in reality —
%          % only because no clause proves it. The DB is "the whole world".
```

This is a *huge* and consequential assumption, and it's the opposite of how an open-world system (like RDF/SPARQL on the semantic web) reasons, where unknown means unknown. The CWA is what makes negation tractable — but it also means **your facts had better be complete**, because the engine will treat every gap as a definite "no." Get a fact missing and you don't get an error; you get a confident wrong answer.

---

## Negation as Failure

Logic programming has no real logical "not." Instead it has **negation as failure** (NAF), written `\+ Goal` (or historically `not(Goal)`):

> **`\+ Goal` succeeds if `Goal` *cannot be proved* (fails), and fails if `Goal` *can* be proved.**

It's negation *defined operationally*, built directly on the closed-world assumption:

```prolog
parent(tom, bob).
parent(tom, liz).

childless(P) :- \+ parent(P, _).    % P is childless if we can't prove P has any child

?- childless(bob).   % true.   (no parent(bob,_) fact)
?- childless(tom).   % false.  (parent(tom,bob) is provable)
```

NAF works well — *as long as the goal is fully ground (no unbound variables)*. The infamous trap is using `\+` with an unbound variable:

```prolog
% WRONG: trying to "find an X that is NOT a parent"
?- \+ parent(X, _).
% false.      % NOT what you wanted!
```

Why `false`? `\+ parent(X, _)` asks "is `parent(X, _)` *unprovable*?" But with `X` unbound, `parent(X, _)` *is* provable (e.g., `X = tom`), so the negation fails immediately. NAF can only tell you "this specific ground fact isn't derivable." It **cannot generate** the things that *don't* hold — there are infinitely many of those, and the engine has no way to enumerate "everything that isn't a parent." The fix is to bind the variable first, then negate:

```prolog
non_parent(X) :- person(X), \+ parent(X, _).   % generate X from a known set, THEN negate
```

Two more reasons NAF is *not* logical negation:

- **It's not symmetric with truth.** `\+ \+ Goal` is not the same as `Goal` — the inner negation throws away any bindings, so double negation acts as a pure "is this provable?" test that leaves no variables bound.
- **It depends on the CWA.** `\+ flies(pig)` is "true" only because you have no rule proving pigs fly — an artifact of an incomplete database, not a logical fact.

> **Takeaway:** `\+` means "**not provable**," not "**false in the world**." Use it on ground goals to test; never use it to *generate* what doesn't hold. This single distinction prevents the most common class of intermediate Prolog bugs.

---

## Common Mistakes

- **Forgetting `is` for arithmetic.** `N = N0 + 1` unifies `N` with the *term* `N0+1`; you almost always want `N is N0 + 1` to evaluate it. And `is` needs its right side fully bound — it's directional, unlike the rest of Prolog.
- **Left-recursion that loops forever.** `ancestor(X,Z) :- ancestor(X,Y), parent(Y,Z).` recurses on `ancestor` *before* consuming any fact, so the search tree has an infinite leftmost branch. Put the base/fact goal **first**: `ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).` Goal order is termination-critical.
- **Red cuts that quietly change answers.** A cut placed to "speed things up" can delete correct solutions. Always re-check that your predicate still gives the same answer *set* with the cut as without (for green cuts) — and if it doesn't, you've written a red cut on purpose and should document it.
- **`\+` with unbound variables.** `\+ parent(X, _)` does not mean "find a non-parent." NAF tests ground goals; it cannot generate. Bind first, negate second.
- **Trusting an incomplete database under CWA.** A missing fact doesn't raise an error — it becomes a confident `false`. Completeness of your facts is a correctness requirement, not a nicety.
- **Reading a rule body as a script.** `a, b, c` is "prove a *and* b *and* c, with backtracking between them," not "do a, then b, then c, once each." The engine may retry `a` many times as later goals fail.

---

## Test Yourself

1. State the SLD resolution loop in your own words. Which goal does Prolog pick, and in what clause order does it search?
2. Draw the search tree for `?- ancestor(a, X).` given `parent(a,b). parent(b,c).` and the *correct* (right-recursive) `ancestor` definition. How many solutions, and in what order?
3. What is the **most general unifier** of `f(X, b)` and `f(a, Y)`? Why "most general"?
4. What exactly does a `!` (cut) discard? Distinguish a green cut from a red cut with an example.
5. Explain the closed-world assumption. Why does it make `parent(tom, jim)` return `false` rather than "unknown"?
6. Why does `?- \+ parent(X, _).` return `false` instead of finding a non-parent? What's the right way to find someone with no children?
7. Run `append/3` "backwards": write the query that, given `[a,b,c,d]`, finds the list `X` such that `[a,b]` ++ `X` = `[a,b,c,d]`.

> If #4 or #6 is shaky, re-read [The Cut](#the-cut--controlling-the-search) and [Negation as Failure](#negation-as-failure) — those two are where intermediate Prolog gets genuinely tricky.

---

## Summary

A logic program runs by **SLD resolution**: take the **leftmost** goal, find the **topmost** clause whose head **unifies** with it, replace the goal with that clause's body, repeat — succeeding on an empty goal list and **backtracking** (undoing bindings) on failure. Drawing that **search tree** turns Prolog from mysterious to mechanical: answer order, slowness, and infinite loops are all visible as the shape of the tree. Unification finds the **most general unifier**, committing only to what's forced — which is exactly why one relation runs in many directions, as `append/3` shows by serving as concatenate, split, and prefix-remove all at once. Recursion over `[H|T]` lists is the only iteration. The **cut** (`!`) prunes the search — green cuts for pure efficiency, red cuts that change answers and should be treated with suspicion. Finally, logic programming reasons under the **closed-world assumption** (unprovable = false) and offers only **negation as failure** (`\+` = "not provable"), which works on ground goals but cannot *generate* what doesn't hold. The deep theme: a clause set is simultaneously a *logical theory* and a *search procedure*, and the distance between those two readings is where every real bug lives — the subject of [senior.md](senior.md).

---

## Further Reading

- Leon Sterling & Ehud Shapiro, *The Art of Prolog* — the definitive intermediate text; SLD, cut, and the declarative/procedural duality done right.
- Richard O'Keefe, *The Craft of Prolog* — how experienced Prolog programmers actually think about control and cut.
- Markus Triska, *The Power of Prolog* (free online) — modern, rigorous, especially strong on why to *avoid* red cuts and prefer logical purity.
- Clocksin & Mellish, *Programming in Prolog*, chapters on backtracking and the cut.

---

## Related Topics

- [junior.md](junior.md) — facts, rules, queries, unification, backtracking (the foundation this page builds on).
- [senior.md](senior.md) — the trade-offs: declarative ideal vs operational reality, performance unpredictability, when logic programming wins.
- [03 — Declarative Programming](../03-declarative-programming/) — the broader declarative family and its shared "describe the what" mindset.
- [13 — Constraint Programming](../13-constraint-programming/) — extends resolution with constraint solving; CLP(FD) replaces blind backtracking with smarter pruning.
