# Constraint Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Constraint Programming
> *You don't write the search. You write down what must be true, and a solver finds values that make it true.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Variables, Domains, Constraints](#core-concept-1--variables-domains-constraints)
5. [Core Concept 2 — "What Must Be True," Not "How to Search"](#core-concept-2--what-must-be-true-not-how-to-search)
6. [Core Concept 3 — The Solver Is the Engine](#core-concept-3--the-solver-is-the-engine)
7. [The Same Problem Two Ways](#the-same-problem-two-ways)
8. [Real-World Examples](#real-world-examples)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Think about how you'd write a Sudoku solver. The instinct most of us learn first is: pick a cell, try a number, check if it breaks any rule, if it does back up and try the next number, repeat. That's *you* writing the search — every loop, every "try this, undo that, try the next." It works, but you're doing all the bookkeeping, and the code is mostly machinery, not problem.

Constraint programming flips this. You write down the *rules* of Sudoku — "every row has the digits 1–9, all different"; "every column, all different"; "each 3×3 box, all different"; "these given cells have these fixed values" — and then you hand that to a **solver**. The solver does the trying-and-backtracking for you, far more cleverly than a hand loop, and gives you back a filled grid. You never wrote a loop. You described the *finished puzzle's properties*, and the machine found a grid with those properties.

> **The mindset shift:** stop thinking "how do I search for the answer?" Start thinking "what is true about the answer?" Name the unknowns, say what they're allowed to be, state the relationships they must satisfy — and let a solver do the searching.

This is the same "declarative" idea you met with SQL ("describe the rows you want, the engine finds them"), pushed to a harder class of problem: puzzles, schedules, assignments, layouts — anything where the answer is "a set of values that all fit together."

---

## Prerequisites

- **Required:** You can read basic code (variables, loops, conditionals, lists). Examples use **Python** and a little **MiniZinc** (a small language built just for stating constraints).
- **Required:** You've written at least one nested-loop or recursive search by hand — a brute-force "try every combination," or a backtracking solver. The whole point lands when you've felt the pain of writing that search yourself.
- **Helpful:** You've written an SQL query, so the idea of "describe what you want, an engine produces it" isn't new.
- **Not required:** Any math beyond "an inequality like `x ≤ y`" and "two things being different." No optimization theory, no logic background.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Variable** | An unknown the solver must assign a value to (e.g., the number in a Sudoku cell, the start time of a task). Not the same as a programming variable you assign yourself. |
| **Domain** | The set of values a variable is *allowed* to take (e.g., `1..9`, or `{red, green, blue}`). |
| **Constraint** | A rule relating one or more variables that any solution must satisfy (`x ≠ y`, `start + duration ≤ deadline`, "all different"). |
| **Model** | The whole problem written declaratively: the variables, their domains, and the constraints. |
| **Solver** | The engine that searches for an assignment of values to variables satisfying every constraint. |
| **Solution** | An assignment of a value (from its domain) to every variable such that all constraints hold. |
| **CSP** | *Constraint Satisfaction Problem* — find **any** assignment that satisfies all constraints. |
| **Satisfiable / infeasible** | A model is satisfiable if at least one solution exists; infeasible if none does. |
| **Objective (optional)** | A quantity to minimize or maximize (cost, time) when you want the *best* solution, not just any. |

> The three words to lock in: **variables**, **domains**, **constraints**. A model is nothing but those three, and a solver is the thing that turns them into an answer.

---

## Core Concept 1 — Variables, Domains, Constraints

Every constraint model is built from exactly three ingredients. Learn to spot them in any problem:

**1. Variables — the unknowns.** What are you solving *for*? In Sudoku, it's the value of each empty cell. In scheduling, it's the start time of each task. In map coloring, it's the color of each region. You name them; you don't assign them — the solver will.

**2. Domains — what each unknown is allowed to be.** A Sudoku cell's domain is `1..9`. A region's color domain is `{red, green, blue}`. A task's start time might be `0..100`. The domain bounds the search: the solver only ever considers values inside it.

**3. Constraints — the relationships that must hold.** This is where the actual problem lives. "These two cells must differ." "This task must finish before that one starts." "No two adjacent regions share a color." Each constraint is a statement that some combination of variable values is *required* (or *forbidden*).

Here's the whole thing in MiniZinc — a tiny language designed for nothing but this — for a toy problem: pick two numbers between 1 and 10 that differ and sum to 12.

```minizinc
var 1..10: x;            % variable x, domain 1..10
var 1..10: y;            % variable y, domain 1..10

constraint x != y;       % they must differ
constraint x + y == 12;  % they must sum to 12

solve satisfy;           % find ANY assignment that works
```

There is no loop, no "try x=1, then x=2." You stated *what must be true* about `x` and `y`, and `solve satisfy` asks the solver to find values. It might return `x=2, y=10` (or another valid pair). That's the entire shape of constraint programming — and every bigger problem is just more variables and more constraints of the same kind.

---

## Core Concept 2 — "What Must Be True," Not "How to Search"

The hardest mental adjustment is giving up control of the *search*. In ordinary code you say, step by step, how to find the answer. In a constraint model you say nothing about searching — you describe only the *answer's properties*, and trust the solver to find something matching.

Compare the two stances on N-Queens (place N chess queens on an N×N board so none attacks another):

- **Imperative stance (you write the search):** "Place a queen in column 0, row 0. Check the rows and diagonals already used. If it's safe, move to column 1 and try each row. If you get stuck, back up and move the previous queen down a row. Keep a `used_rows` set, two diagonal sets…" — pages of bookkeeping.

- **Constraint stance (you write the truths):** "Each column has one queen at some row (`queen[c]` ∈ `1..N`). No two queens share a row. No two queens share a diagonal." Three facts. Done.

```minizinc
int: n = 8;
array[1..n] of var 1..n: queen;    % queen[c] = the row of the queen in column c

constraint all_different(queen);                          % no shared row
constraint all_different([queen[c] + c | c in 1..n]);     % no shared "/" diagonal
constraint all_different([queen[c] - c | c in 1..n]);     % no shared "\" diagonal

solve satisfy;
```

`all_different` is a constraint meaning "these values are pairwise distinct." Notice what's *absent*: there's no order of trying, no undo, no recursion. You asserted three properties of a valid board, and the solver produces a board with those properties. **That absence is the paradigm.** You traded control over *how* for a description of *what*.

> **Key insight:** "declarative" here doesn't mean magic. The solver still tries values and backtracks — but *someone wrote that search engine once*, very well, so you don't write it for every new puzzle. You bring the problem; the solver brings the search.

---

## Core Concept 3 — The Solver Is the Engine

When you call `solve`, a real program — the **solver** — takes over. You don't have to know its internals yet (the [middle](middle.md) level opens that box), but three things are worth knowing now so the paradigm doesn't feel like a black box:

1. **It searches smartly, not blindly.** A naive brute force would try every combination of values — astronomically many. A real solver constantly *narrows the domains*: the moment you fix one Sudoku cell to `7`, it removes `7` from the domain of every cell in that row, column, and box. That eliminates huge swaths of the search before any guessing happens. (This is called *propagation*; you'll meet it formally at the middle level.)

2. **It backtracks for you.** When a guess leads to a dead end (some variable's domain becomes empty — no legal value left), the solver undoes the guess and tries another, automatically. The exact thing you'd hand-code in a backtracking loop, it does internally.

3. **It can tell you "no solution exists."** If you've over-constrained the problem (asked for something impossible), the solver reports *infeasible* rather than looping forever. That's a real answer too — "your requirements contradict each other."

You'll meet several flavors of solver as you go: **finite-domain CP solvers** (like the one in Google OR-Tools), **SAT solvers** (for pure true/false logic), and **SMT solvers** (logic plus arithmetic). They differ in what kinds of constraints they handle, but the *contract* is the same everywhere: you hand over variables + domains + constraints; they hand back a solution or "infeasible."

---

## The Same Problem Two Ways

> Task: **solve a small Sudoku.** Below: the hand-written backtracking you'd normally write, then the constraint model. Watch the code shrink and the *problem* become visible.

```python
# 1. HAND-WRITTEN BACKTRACKING — you write the entire search.
def solve(board):
    pos = find_empty(board)              # find next blank cell
    if pos is None:
        return True                      # no blanks left → solved
    r, c = pos
    for val in range(1, 10):             # try each candidate
        if is_valid(board, r, c, val):   # you wrote is_valid: checks row, col, box
            board[r][c] = val            # place it
            if solve(board):             # recurse
                return True
            board[r][c] = 0              # UNDO — backtrack
    return False                         # no value worked here
# Plus find_empty() and is_valid() — dozens more lines of search machinery.
```

```python
# 2. CONSTRAINT MODEL (Google OR-Tools, Python CP-SAT) — you write the RULES.
from ortools.sat.python import cp_model

m = cp_model.CpModel()
# 9x9 grid of variables, each with domain 1..9
cell = [[m.new_int_var(1, 9, f"c{r}{c}") for c in range(9)] for r in range(9)]

for r in range(9):
    m.add_all_different(cell[r])                                   # each row, all different
for c in range(9):
    m.add_all_different([cell[r][c] for r in range(9)])            # each column, all different
for br in range(3):
    for bc in range(3):                                            # each 3x3 box, all different
        m.add_all_different([cell[3*br+i][3*bc+j] for i in range(3) for j in range(3)])

# givens: clue at (0,0) is 5, etc.
m.add(cell[0][0] == 5)

solver = cp_model.CpSolver()
solver.solve(m)        # the solver does ALL the searching and backtracking
# read answers with solver.value(cell[r][c])
```

Look at what changed:

- **The backtracking version** is mostly *search plumbing* — `find_empty`, `is_valid`, place, recurse, undo. The Sudoku rules are buried inside `is_valid`. If you change the puzzle (say, add a diagonal rule), you edit the search code.
- **The constraint version** *is* the rules: "each row all different," "each column all different," "boxes all different," "this cell is 5." There is no search code at all. Adding a diagonal rule is one more `add_all_different(...)` line — the solver figures out the rest.

Same answer. One version makes you the search engine; the other makes you the *problem describer* and rents a search engine.

---

## Real-World Examples

| Thing | Why it's a constraint problem |
|---|---|
| **Sudoku / KenKen / logic puzzles** | "These cells must all differ / sum to N" — pure constraints over small domains. |
| **Exam & class timetabling** | Assign each class a room and time so nothing clashes — variables (time/room), constraints (no two classes in one room at once, teacher not double-booked). |
| **Shift / nurse rostering** | Assign people to shifts respecting coverage minimums, max hours, days off — a constraint problem solved daily in hospitals and call centers. |
| **Seating / table assignment** | Seat guests so feuding pairs aren't together and each table is full — "these two not at the same table" constraints. |
| **Sports league scheduling** | Build a fixture list where each team plays each other, no team plays twice in a day, venues don't clash. |
| **Package managers (apt, npm, Cargo)** | Choose versions of dependencies that all satisfy each other's version requirements — a real constraint/SAT problem under the hood (more on this at higher levels). |

The common signature: **"find an assignment of values that satisfies a pile of must-hold rules."** When you see that shape, a solver is often a better tool than a hand-rolled loop.

---

## Mental Models

- **The restaurant order, harder version.** SQL was "I'll have the salmon" — describe the dish, the kitchen cooks it. Constraint programming is "I'll have a meal under \$30, no nuts, that pairs with this wine" — describe the *constraints* on an acceptable meal, and let the kitchen find one that fits. You never name a specific dish; you name the rules a good dish must obey.
- **The crossword vs. the dictionary.** Writing the search by hand is filling the crossword letter by letter, erasing and retrying. A constraint model is handing the grid and the clues to a friend who's very fast at crosswords and getting back a filled one. You supplied the *clues* (constraints), not the *filling-in* (search).
- **Hiring a search engine.** Every backtracking loop you've written is a tiny, one-off, hand-built search engine. A solver is a world-class search engine you can rent for *any* problem just by describing it. Stop rebuilding the engine for each puzzle; describe the puzzle and plug in the engine.

---

## Common Mistakes

- **Trying to control the search.** Beginners write constraints *and* try to tell the solver what order to try values, as if it were a loop. Resist it. State the truths; let the solver search. (There *are* ways to guide search — that's an advanced tuning topic, not a starting move.)
- **Forgetting a domain.** A variable with no stated domain (or one far too wide) makes the solver flounder. Always ask: what's the smallest set of values this unknown could legitimately take?
- **Under-constraining and being surprised by "weird" answers.** If you forget a rule, the solver happily returns a "solution" that violates the rule you didn't write. The solver only honors constraints you actually stated. A surprising answer usually means a missing constraint, not a buggy solver.
- **Over-constraining into infeasibility.** Add contradictory rules ("x must be 5" and "x must be even" with domain `{1,3,5}`) and the solver returns *infeasible*. That's correct — your requirements conflict. Re-read them.
- **Confusing a constraint variable with a normal variable.** `var 1..9: x` is *not* `x = 5`. You're not assigning `x`; you're declaring an unknown the solver will assign. This trips up everyone at first.
- **Reaching for a solver when a loop is obviously enough.** Summing a list or finding a max doesn't need a constraint solver. The paradigm shines on combinatorial *search/assignment* problems, not on every computation.

---

## Test Yourself

1. Name the three ingredients of every constraint model, and give an example of each from Sudoku.
2. What's the difference between a constraint *variable* (`var 1..9: x`) and a normal program variable you assign yourself?
3. In the N-Queens model, where is the *search* written? (Trick question — answer carefully.)
4. You model a scheduling problem and the solver returns a result that double-books a room. The solver isn't buggy — so what's wrong?
5. What does it mean for a model to be *infeasible*, and why is that a useful answer rather than a failure?
6. Give one problem shape where a constraint solver fits well, and one where a plain loop is clearly the better tool.

> Try each before reading on. If #3 or #4 is fuzzy, re-read [What Must Be True](#core-concept-2--what-must-be-true-not-how-to-search) and [Common Mistakes](#common-mistakes).

---

## Cheat Sheet

```
CONSTRAINT PROGRAMMING = describe the answer's properties; a SOLVER finds values.

A MODEL HAS THREE PARTS:
  variables    the unknowns to solve for         (Sudoku cell, task start time)
  domains      the values each may take           (1..9, {red,green,blue})
  constraints  rules every solution must satisfy  (x != y, all_different, a <= b)

THE SHIFT:
  imperative  → you write HOW to search (place, check, undo, retry)
  constraint  → you write WHAT is true; the solver does the searching

THE SOLVER:
  narrows domains (propagation) → backtracks on dead ends → returns a solution
  or reports INFEASIBLE if the constraints contradict each other

CSP = "find ANY assignment satisfying all constraints."
(optionally add an OBJECTIVE to find the BEST one — see middle/senior levels)

REMEMBER:
  a surprising answer usually means a MISSING constraint
  don't fight the solver for control of the search
  use it for combinatorial assignment/search — not for every loop
```

---

## Summary

**Constraint programming** is the paradigm where you describe a problem as **variables** (the unknowns), their **domains** (allowed values), and **constraints** (rules every solution must satisfy) — and a **solver** searches for an assignment that makes all the constraints true. You write *what must be true about the answer*, not *how to search for it*; the solver handles the trying, narrowing, and backtracking that you'd otherwise hand-code in a brute-force or backtracking loop. This is the declarative idea you saw in SQL, pushed to combinatorial problems: puzzles, timetables, rosters, assignments, layouts. The skill you're starting to build is *recognizing the "find values that all fit together" shape* and reaching for a solver instead of rebuilding a search engine by hand every time. A surprising solution means a missing constraint; an impossible one is reported honestly as *infeasible*.

---

## Further Reading

- *The MiniZinc Handbook* (minizinc.org) — the friendliest on-ramp; a whole tutorial built around writing your first constraint models.
- Google **OR-Tools** "CP-SAT" Python tutorials — the most accessible production-grade solver, with copy-paste examples (Sudoku, N-Queens, scheduling).
- Stuart Russell & Peter Norvig, *Artificial Intelligence: A Modern Approach*, the **Constraint Satisfaction Problems** chapter — the canonical textbook intro to CSPs, variables/domains/constraints, and backtracking + propagation.
- [03 — Declarative Programming](../03-declarative-programming/) — the broader "describe what, not how" family this belongs to.

---

## Related Topics

- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where constraint programming sits on the imperative ↔ declarative spectrum.
- [03 — Declarative Programming](../03-declarative-programming/) — the parent idea: state the goal, let an engine find the path.
- [04 — Logic Programming](../04-logic-programming/) — Prolog/Datalog, a close cousin; constraint logic programming blends the two.
- [`middle.md`](middle.md) — CSPs formally, constraint propagation and arc consistency, global constraints, and a first look at SAT and SMT.
- **Backtracking search** (DSA) — the hand-written search the solver automates; understanding it makes the solver's job concrete.
