# Logic Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Logic Programming
> *You don't tell the computer how to find the answer. You tell it what's true — and it works out the rest.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Facts: Stating What's True](#core-concept-1--facts-stating-whats-true)
5. [Core Concept 2 — Rules: Deriving New Truths](#core-concept-2--rules-deriving-new-truths)
6. [Core Concept 3 — Queries: Asking Questions](#core-concept-3--queries-asking-questions)
7. [Core Concept 4 — Unification: Two-Way Pattern Matching](#core-concept-4--unification-two-way-pattern-matching)
8. [Core Concept 5 — Backtracking: Finding *All* the Answers](#core-concept-5--backtracking-finding-all-the-answers)
9. [The Same Problem: Imperative vs Logic](#the-same-problem-imperative-vs-logic)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Every program you've written so far told the machine *how* to do something. Loop over this list. Check that condition. Increment that counter. Return when you hit the answer. You were the choreographer; the computer followed your steps.

Logic programming throws that away. Here is the whole idea in one sentence:

> **You state facts and rules. You ask a question. An engine searches for an answer that follows logically from what you stated.**

You never write a loop. You never write a search. You don't describe *how* to find the answer at all — you describe *what would make something true*, and a built-in engine figures out the rest by trying possibilities and backing out of dead ends.

Consider a family tree. In an imperative language you'd build dictionaries, write a function to walk parent links, loop up two levels to find grandparents, and handle the bookkeeping. In a logic language you write this:

```prolog
parent(tom, bob).          % a fact: tom is a parent of bob
parent(bob, ann).          % a fact: bob is a parent of ann

grandparent(X, Z) :-       % a rule: X is a grandparent of Z
    parent(X, Y),          %   IF X is a parent of some Y
    parent(Y, Z).          %   AND that Y is a parent of Z

?- grandparent(tom, Who).  % a query: who are tom's grandchildren?
% Who = ann.
```

That's a complete program. There is no loop finding `Y`. There is no search code. The engine *invented* the intermediate person `bob` on its own, by trying every fact until two of them lined up. You stated a definition of "grandparent" as pure logic, and asking the question *ran* it.

> **The mindset shift:** stop writing the steps that find an answer. Start writing the *conditions under which an answer is true* — and let the engine do the finding.

---

## Prerequisites

- **Required:** You can read basic code — variables, functions, conditionals. Examples are in **Prolog** (the classic logic language) with occasional **Python** or **SQL** for contrast.
- **Required:** You've written a nested loop that searches for a combination (e.g., "find two items that sum to a target"). Logic programming automates exactly this kind of search.
- **Helpful:** You've written an SQL `JOIN`. A logic rule is very close in spirit to a join — it relates facts together.
- **Helpful:** You've read [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) and know the imperative ↔ declarative spectrum. Logic programming sits at the far declarative end.
- **Not required:** Any formal logic, Prolog installation, or math background. Everything is explained from zero.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fact** | An unconditional statement that something is true: `parent(tom, bob).` |
| **Rule** | A conditional statement: "head is true *if* body is true," written `head :- body.` |
| **Query** | A question you ask the engine: `?- grandparent(tom, X).` — "is this provable, and for which values?" |
| **Clause** | A fact or a rule. A program is a collection of clauses. |
| **Atom** | A specific, fixed value — a constant. In Prolog, lowercase: `tom`, `bob`, `red`. |
| **Variable** | A placeholder the engine can fill in. In Prolog, **Capitalized**: `X`, `Who`, `Person`. |
| **Predicate** | A named relation, like `parent` or `grandparent`. The "verb" of the program. |
| **Unification** | Two-way pattern matching: making two terms identical by choosing values for variables. |
| **Backtracking** | When a path fails (or you ask for more answers), the engine rewinds and tries another. |
| **Horn clause** | The logical form a fact/rule takes: "this is true if these are all true." The math behind it. |

> The two words to lock in now: a **fact** is "this is just true," and a **rule** is "this is true *when* that is." Everything else is the engine searching through your facts and rules to answer a **query**.

---

## Core Concept 1 — Facts: Stating What's True

A **fact** is the simplest thing you can write: an unconditional assertion. You're populating a tiny database of truths.

```prolog
% Each line is one fact. The period ends it.
parent(tom, bob).
parent(tom, liz).
parent(bob, ann).
parent(bob, pat).
parent(pat, jim).

male(tom).
male(bob).
female(liz).
female(ann).
```

Read `parent(tom, bob).` as **"tom is a parent of bob."** The word `parent` is a **predicate** — a relation. The lowercase words `tom` and `bob` are **atoms** — specific, fixed names (like string constants). The order matters and is your convention: here it means *parent(Parent, Child)*. You decide what each position means and stay consistent.

A few things that trip up newcomers immediately:

- **Lowercase = a specific thing. Capitalized = a variable.** `tom` is *the* person tom. `X` is "some person, to be determined." This single rule of Prolog syntax is doing a lot of work — get it wrong and your program means something completely different.
- **Facts have no inherent meaning to the engine.** `parent(tom, bob)` could mean tom parents bob, or bob parents tom, or tom and bob are in a "parent" relationship of any kind. The *meaning* lives in your head and your rules; the engine only knows the symbols.
- **A set of facts is a database.** This isn't a metaphor — these facts *are* a relational table. `parent` is a two-column table; each fact is a row.

```sql
-- The same facts as a SQL table, for comparison:
-- parent(Parent, Child)
INSERT INTO parent VALUES ('tom', 'bob'), ('tom', 'liz'), ('bob', 'ann');
```

The parallel to SQL is not an accident. We'll return to it — but already you can see that *facts are data*.

---

## Core Concept 2 — Rules: Deriving New Truths

Facts alone are just a lookup table. The power arrives with **rules**, which define new truths *in terms of* existing ones.

```prolog
% X is a grandparent of Z  IF  X is a parent of Y  AND  Y is a parent of Z.
grandparent(X, Z) :-
    parent(X, Y),
    parent(Y, Z).
```

Decode the syntax piece by piece:

- `grandparent(X, Z)` is the **head** — the thing this rule defines.
- `:-` is read as **"if"** (or "is implied by"). The body to its right is the condition.
- The comma `,` is read as **"and"**. Every goal in the body must hold.
- `X`, `Y`, `Z` are **variables** — the engine will find values that make the whole thing true. Note `Y` appears in the body but *not* the head: it's an intermediate the engine must discover.

This one rule now defines grandparenthood for *every* pair in your database — present and future. Add a new `parent` fact and grandparent relationships update automatically; you wrote no code to maintain them. That's the leverage: **a rule is a definition, not a procedure.**

Rules compose. Define one relation, then build others on top:

```prolog
% A sibling shares a parent (and isn't themselves).
sibling(A, B) :-
    parent(P, A),
    parent(P, B),
    A \= B.            % \= means "must NOT unify" — A and B are different

% An ancestor is a parent, OR a parent of an ancestor. (Recursion!)
ancestor(X, Z) :- parent(X, Z).
ancestor(X, Z) :- parent(X, Y), ancestor(Y, Z).
```

The `ancestor` rule is two clauses with the same head — read the two as **"OR"**: X is an ancestor of Z if [first clause] *or* [second clause]. The second clause calls `ancestor` again: recursion. There's no base-case-then-loop ritual like in imperative recursion — you state the two ways something can be true, and the engine handles the unrolling. Notice you wrote *no termination logic*: the first clause (the non-recursive one) is what stops the recursion when it succeeds.

> **Key insight:** a rule reads like a sentence of logic — "*head* is true if *this* and *this*." Multiple rules with the same head are alternatives ("or"). That's the entire grammar of derivation.

---

## Core Concept 3 — Queries: Asking Questions

You've stated facts and rules. **Running** the program means asking a **query** — and the engine searches your clauses for a proof.

```prolog
?- parent(tom, bob).
% true.                        % a fact exists — yes.

?- parent(tom, jim).
% false.                       % no fact and no rule makes this provable.

?- grandparent(tom, ann).
% true.                        % proved via tom→bob→ann.
```

Those are **yes/no** queries — "is this provable?" But the real magic is putting a *variable* in the query. Now you're not asking "is this true?" — you're asking **"for what values is this true?"**

```prolog
?- parent(tom, Child).
% Child = bob ;                % press ; to ask for the next answer
% Child = liz.

?- grandparent(Who, ann).
% Who = tom.                   % who is ann's grandparent?

?- grandparent(tom, Grandkid).
% Grandkid = ann ;
% Grandkid = pat ;
% Grandkid = jim.              % ALL of tom's grandchildren, found automatically
```

This is the feature that has no clean equivalent in imperative code. The query `parent(tom, Child)` doesn't ask you to write a loop over children — it asks the engine to find *every* `Child` that makes `parent(tom, Child)` a true fact. You ask once; the engine enumerates all solutions.

And queries are **multi-directional**. The exact same `parent` predicate answers all of these:

```prolog
?- parent(tom, X).     % tom's children?    → X = bob ; X = liz
?- parent(X, ann).     % ann's parents?     → X = bob
?- parent(X, Y).       % ALL parent pairs?  → enumerates every one
```

In Python you'd write a *different function* for "children of X" versus "parent of Y." In Prolog there is one relation, and which positions you leave as variables decides which question you're asking. The relation runs "in any direction."

---

## Core Concept 4 — Unification: Two-Way Pattern Matching

How does the engine match a query like `parent(tom, Child)` against the fact `parent(tom, bob)`? Through **unification** — the single most important mechanism in logic programming.

Unification asks: *can these two terms be made identical by choosing values for the variables?* It's pattern matching, but **two-way** — variables on either side can get filled in.

```
Query: parent(tom, Child)
Fact:  parent(tom, bob)

Step 1: predicate names match?  parent = parent  ✓
Step 2: first arguments match?  tom = tom         ✓  (both fixed atoms, equal)
Step 3: second arguments match? Child = bob       ✓  (Child is a variable → bind Child = bob)

Result: UNIFIES, with Child = bob.
```

The rules of unification are short:

- **Atom vs same atom** → match (`tom` with `tom`).
- **Atom vs different atom** → fail (`tom` with `bob` cannot be made equal).
- **Variable vs anything** → match, and the variable is **bound** to that thing (`Child` becomes `bob`).
- **Two variables** → match, and they become linked (whatever one becomes, so does the other).
- **Compound terms** → match if the names match and all parts unify recursively.

The "two-way" part is what makes it more than ordinary assignment:

```prolog
?- foo(X, blue) = foo(red, Y).
% X = red,
% Y = blue.        % BOTH sides had a variable; both got filled in.
```

Neither side is "the value" and the other "the pattern." The engine finds the most general way to make them equal, binding variables on whichever side needs it. That symmetry is exactly why a single Prolog relation can run in multiple directions — unification doesn't care which argument is the "input."

> **Mental model:** unification is solving a tiny equation. `Child = bob` is "what makes these equal? Child must be bob." The engine solves these micro-equations constantly as it tries to prove your query.

---

## Core Concept 5 — Backtracking: Finding *All* the Answers

A query usually has *several* possible answers, and clauses can fail partway. **Backtracking** is the engine's strategy: when it hits a dead end, it rewinds to the last choice and tries the next option.

Walk through `?- grandparent(tom, G).` against our facts (`parent(tom,bob)`, `parent(tom,liz)`, `parent(bob,ann)`, `parent(bob,pat)`, `parent(pat,jim)`):

```
Goal: grandparent(tom, G)
Rule: grandparent(X,Z) :- parent(X,Y), parent(Y,Z).
Bind X=tom, Z=G. Now prove:  parent(tom, Y), parent(Y, G).

Try parent(tom, Y):
  → Y = bob.   Now prove parent(bob, G):
       → G = ann.   ✓ SOLUTION: G = ann.   (report it)
   ── ask for more (;) → BACKTRACK into parent(bob, G):
       → G = pat.   ✓ SOLUTION: G = pat.   (report it)
   ── ask for more → parent(bob, G) exhausted. BACKTRACK into parent(tom, Y):
  → Y = liz.   Now prove parent(liz, G):
       → liz has no children. FAIL. BACKTRACK.
  → parent(tom, Y) exhausted.  Done.

Answers: G = ann ; G = pat.
```

Notice what the engine did *for free*:

- It **tried each parent of tom** (`bob`, then `liz`) without you writing a loop.
- When `liz` led nowhere, it **abandoned that path** and moved on — no exception, no manual cleanup, it just *unwinds* and continues.
- It found **every** solution by exhaustively exploring, then stopped.

This is a depth-first search over a tree of choices, run by the engine. You described the tree implicitly (through your facts and rules); backtracking walks it. The combination of **unification** (matching) and **backtracking** (trying alternatives) *is* how a logic program computes. There is nothing else.

```
The two-engine summary:
  UNIFICATION  decides whether the current step can match.
  BACKTRACKING decides what to try when a step fails or you want another answer.
  Together they search for a PROOF of your query.
```

---

## The Same Problem: Imperative vs Logic

> Task: **given parent facts, list every grandparent–grandchild pair.**

```python
# IMPERATIVE (Python) — you write the search by hand.
parents = [("tom","bob"), ("tom","liz"), ("bob","ann"),
           ("bob","pat"), ("pat","jim")]

result = []
for (p1, c1) in parents:          # outer loop: each parent link
    for (p2, c2) in parents:      # inner loop: each parent link again
        if c1 == p2:              # the middle person lines up?
            result.append((p1, c2))
# You wrote two loops, a join condition, and the result bookkeeping.
```

```prolog
% LOGIC (Prolog) — you write the DEFINITION; the engine searches.
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).

?- grandparent(GP, GC).
% GP = tom, GC = ann ;
% GP = tom, GC = pat ;
% GP = bob, GC = jim.
```

```sql
-- DECLARATIVE (SQL) — also "what, not how", and revealingly similar.
SELECT a.parent AS gp, b.child AS gc
FROM   parent a JOIN parent b ON a.child = b.parent;
```

Look at what changed:

- **Imperative**: two visible loops and an `if` join condition. *You* are the search engine.
- **Logic**: one line defining what "grandparent" *means*. No loops, no join condition written by hand — the matched variable `Y` *is* the join, and backtracking *is* the nested loop.
- **SQL**: strikingly close to the Prolog rule. The self-join `ON a.child = b.parent` plays the exact role of the shared variable `Y`. This is not a coincidence — logic programming and relational databases are deeply related (more in [middle](middle.md) and [professional](professional.md)).

The Prolog and SQL versions describe the *relationship*; the database engine and the Prolog engine each supply the search. That's the declarative payoff: less code, no search bugs, and the same definition runs "in any direction."

---

## Real-World Examples

You meet logic-programming ideas more often than you'd think — usually wearing a different name:

| Thing you've used | The logic-programming idea inside it |
|---|---|
| A SQL query with `JOIN`s | Relating facts (rows) by shared values — exactly what unification does. |
| A type checker that *infers* types | Solving constraints by unification; Prolog's unification was literally borrowed for this. |
| A package manager resolving dependencies | Searching for an assignment that satisfies all the rules (versions) — backtracking. |
| A linter / static analyzer (CodeQL, Soufflé) | Querying your code as a database of facts with logic rules. |
| A spam / access-control rule engine | "Deny *if* condition A and condition B" — Horn clauses by another name. |
| A configuration validator | "This config is valid *if* these constraints hold." |
| `make` figuring out what to rebuild | Rules with conditions; the tool searches the dependency graph. |

Logic programming as a *full language* (Prolog) is niche today. But logic-programming *engines* are embedded all over modern infrastructure — databases, type systems, build tools, and code analysis. Learning the paradigm makes those tools legible. We trace exactly where it lives in production in [professional.md](professional.md).

---

## Mental Models

- **The detective, not the patrol route.** Imperative code is a patrol route: walk this street, then that one, in order. Logic programming is a detective given facts and rules of deduction — "the butler had motive, the butler had opportunity, therefore..." You supply the evidence and the logic; the detective (engine) does the deducing.
- **A spreadsheet of truths that completes itself.** You type in some cells (facts) and some formulas (rules). Asking a query is like reading a cell whose value the system computes from everything else — you never filled it in by hand.
- **Unification is solving for the variable.** Every match is a tiny "make these equal — what must the variable be?" The engine is constantly solving these micro-equations.
- **Backtracking is a maze with breadcrumbs.** At each junction the engine tries a path, dropping a breadcrumb. Hit a wall, follow the breadcrumb back to the last junction, take the next path. It will find *every* exit if you keep asking.
- **A rule is a JOIN you named.** A shared variable across two goals is the join key. If you know SQL self-joins, you already half-understand Prolog rules.

---

## Common Mistakes

- **Lowercase vs Capitalized confusion.** `parent(X, bob)` and `parent(x, bob)` are completely different: `X` is a variable to be filled in; `x` is a fixed atom named "x". This is the #1 beginner bug. **Variables are Capitalized; atoms are lowercase.**
- **Thinking facts have built-in meaning.** `parent(tom, bob)` doesn't mean anything to the engine — *you* decided the first arg is the parent. Mix up your argument order across facts and your rules silently produce nonsense.
- **Expecting execution order to read like a recipe.** A rule body `parent(X,Y), parent(Y,Z)` *looks* like "do this then that," but it's really "find values making BOTH true," explored with backtracking. The engine may try, fail, and retry many times — it's a search, not a script.
- **Forgetting that a relation runs in all directions.** Newcomers write `parent(tom, X)` and think "X is output." But `parent(X, bob)` makes `X` the output instead. There is no fixed input/output — it depends on which arguments you leave unbound.
- **Assuming one answer.** A query with a variable can have many solutions. `parent(tom, X)` gives `bob` *and* `liz`. If you only handle the first, you've missed the rest — remember the `;` that asks for more.
- **Confusing "false" with "false in the world."** Prolog's `false` means **"not provable from what you stated"** — the *closed-world assumption*. `parent(tom, jim)` is `false` only because no fact/rule proves it, not because it's cosmically untrue. (Much more on this in [middle.md](middle.md).)

---

## Test Yourself

1. In your own words: what's the difference between a **fact** and a **rule**? Give one of each for a "friends" relation.
2. Why is `X` different from `x` in Prolog? What does each represent?
3. Trace by hand: given `parent(a,b). parent(b,c).` and `grandparent(X,Z) :- parent(X,Y), parent(Y,Z).`, what does `?- grandparent(a, W).` return, and what value does the *hidden* variable `Y` take?
4. What is **unification**, in one sentence? Why is it called "two-way"?
5. The query `?- parent(P, ann).` and `?- parent(tom, C).` use the *same* predicate. Explain how one predicate answers two different questions.
6. What does **backtracking** do when a goal fails? When does the engine stop?
7. Why might `?- parent(tom, jim).` return `false` even in a world where tom really is jim's parent? (Hint: closed-world assumption.)

> Try each before moving on. If #3 or #4 is fuzzy, re-read [Unification](#core-concept-4--unification-two-way-pattern-matching) and [Backtracking](#core-concept-5--backtracking-finding-all-the-answers).

---

## Cheat Sheet

```
LOGIC PROGRAMMING = state facts + rules, ask a query, engine searches for a PROOF.
You write WHAT is true. The engine finds the HOW (no loops, no search code).

THE THREE PIECES:
  FACT    parent(tom, bob).              "this is unconditionally true"
  RULE    gp(X,Z) :- parent(X,Y),        "head is true IF body is true"
                     parent(Y,Z).         ( :- = if,  , = and )
  QUERY   ?- gp(tom, W).                  "is this provable? for which W?"

SYNTAX TRAPS:
  tom   lowercase  = ATOM (a fixed value)
  X     Capital    = VARIABLE (engine fills it in)
  :-    "if"        ,  "and"     ;  "or" (between answers)    \=  "must differ"

THE TWO ENGINES:
  UNIFICATION   two-way pattern match; make terms equal by binding variables.
                Child = bob   means   "bind Child to bob".
  BACKTRACKING  hit a dead end → rewind to last choice → try the next.
                Finds ALL solutions by exhaustive depth-first search.

MULTI-DIRECTIONAL:
  parent(tom, X)   → tom's children      (X is the "output")
  parent(X, ann)   → ann's parents       (X is now the "output")
  ONE relation, many questions — depends which args you leave unbound.

REMEMBER:
  false = "not provable from what you stated" (closed-world), not "cosmically false".
  A query can have MANY answers — press ; for the next.
  A rule is basically a named SQL JOIN; a shared variable is the join key.
```

---

## Summary

**Logic programming** flips the script of everything you've written before: instead of telling the machine *how* to compute an answer, you state **facts** (`parent(tom, bob).`) and **rules** (`grandparent(X,Z) :- parent(X,Y), parent(Y,Z).`), then ask a **query** (`?- grandparent(tom, W).`). A built-in engine answers by searching for a **proof** that follows logically from what you stated. Two mechanisms do all the work: **unification**, a two-way pattern match that makes terms equal by binding variables, and **backtracking**, which rewinds and retries whenever a path fails — together finding *every* answer with no loop or search code from you. Because a relation has no fixed inputs and outputs, the same predicate runs "in any direction," and a rule reads like a sentence of logic — strikingly close to an SQL `JOIN`. You won't write whole systems in Prolog, but the ideas live inside databases, type checkers, dependency resolvers, and code analyzers — so learning them makes a swath of modern tooling suddenly make sense.

---

## Further Reading

- William Clocksin & Christopher Mellish, *Programming in Prolog* — the classic, gentle introduction; start here.
- Ulle Endriss, *Lecture Notes on Prolog* (free online) — concise, rigorous, exercise-driven.
- [SWI-Prolog](https://www.swi-prolog.org/) — install it and try the family-tree examples; the online "SWISH" notebook runs in a browser with no setup.
- *Learn Prolog Now!* (Blackburn, Bos, Striegnitz) — free, interactive, the most-recommended modern intro.

---

## Related Topics

- [03 — Declarative Programming](../03-declarative-programming/) — the broader "what, not how" family logic programming belongs to.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where logic programming sits on the imperative ↔ declarative spectrum.
- [13 — Constraint Programming](../13-constraint-programming/) — logic programming's close cousin: state constraints, let a solver search.
- [15 — Symbolic Programming](../15-symbolic-programming/) — "code as data" and term rewriting, which share logic programming's roots.
- **Next:** [middle.md](middle.md) — how the search *actually* works: SLD resolution, the cut, recursion, and the closed-world assumption.
