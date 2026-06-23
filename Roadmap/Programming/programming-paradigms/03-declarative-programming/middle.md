# Declarative Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Declarative Programming
> *There is no magic — there is an engine. "Declarative" is a thin surface over imperative code that someone wrote once, very carefully.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Surface and the Engine](#the-surface-and-the-engine)
4. [Inside the SQL Query Planner](#inside-the-sql-query-planner)
5. [Inside the CSS Layout Engine](#inside-the-css-layout-engine)
6. [Inside Make: The Dependency DAG](#inside-make-the-dependency-dag)
7. [Inside React: The Reconciler](#inside-react-the-reconciler)
8. [Referential Transparency & Order-Independence](#referential-transparency--order-independence)
9. [Internal vs External DSLs](#internal-vs-external-dsls)
10. [Functional Programming as Declarative](#functional-programming-as-declarative)
11. [Leaky Abstractions](#leaky-abstractions)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work?**

At the junior level you learned the slogan: *describe the result, an engine supplies the steps*. That's true, but it can leave declarative programming feeling like a black box — as if the computer somehow "just knows" how to produce your result. It doesn't. The honest, demystifying truth is this:

> **There is always imperative code. It's just written once, inside an engine, instead of by you, every time.**

When you write `SELECT ... WHERE ...`, a very real, very imperative program — the **query planner** — reads your query, considers several step-by-step strategies, picks one, and executes it with explicit loops, comparisons, and buffers. The same is true of the browser's layout engine, Make's scheduler, and React's reconciler. Each is a sophisticated imperative program whose *job* is to turn your declarative description into concrete steps.

Understanding that split — **declarative surface, imperative engine** — is what separates someone who *uses* SQL from someone who can reason about *why* a query is slow, *why* CSS specificity surprised them, or *why* React re-rendered. This page opens up four engines so the magic becomes mechanism.

> **The mindset shift:** stop thinking of declarative code as "stating a fact and getting a result for free." Start thinking of it as *handing a specification to a compiler/interpreter that you didn't write* — and ask, every time, "what is the engine actually doing with this?"

---

## Prerequisites

- **Required:** The [junior level](junior.md) — the what-vs-how distinction, SQL/CSS/config examples, idempotence and order-independence.
- **Required:** You can read SQL, CSS, and a `Makefile`, and you've used a `map`/`filter` pipeline.
- **Helpful:** A rough sense of data structures — graphs, trees, and what "a loop with a comparison" costs.
- **Helpful:** [02 — Imperative & Procedural](../02-imperative-and-procedural/) — because the engines are written in exactly that style.

---

## The Surface and the Engine

Every declarative system has the same two-part shape:

```
  YOUR CODE                          THE ENGINE (written once, by others)
  ─────────                          ────────────────────────────────────
  declarative SPECIFICATION   ──►    parse → plan → execute (imperative)
  "what I want"                      explicit loops, comparisons, mutation,
                                     scheduling, optimization
```

| System | Your declarative surface | The imperative engine | What the engine decides |
|---|---|---|---|
| **SQL** | `SELECT ... WHERE ... JOIN` | Query planner + executor | Index vs scan, join order/algorithm, parallelism |
| **CSS** | `display: flex; ...` | Layout + paint engine | Pixel positions, reflow order, what to repaint |
| **Make** | targets + dependencies | DAG scheduler | What to rebuild, in what order, what to skip |
| **React** | JSX (UI = f(state)) | Reconciler (virtual DOM diff) | Which DOM nodes to create/update/remove |
| **Terraform** | desired resources | Plan/apply reconciler | Create vs update vs destroy, dependency order |
| **Regex** | `\d{3}-\d{4}` | NFA/DFA matcher | Backtracking vs automaton, match path |

The crucial realization: **you are programming the engine, not the machine.** Your "code" is *input to another program*. That reframing explains nearly everything about declarative systems — why you can't step through them with a debugger the way you step through a loop, why two engines can run the same SQL at wildly different speeds, and why "optimizing declarative code" means "helping the engine make better choices," not "writing faster steps."

---

## Inside the SQL Query Planner

When you submit a query, the database does **not** just run it top to bottom. It compiles it through a pipeline:

```
SQL text → parse → logical plan → OPTIMIZE → physical plan → execute → rows
```

The interesting stage is **optimize**. Consider:

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND o.total > 1000;
```

This single declarative statement could be executed in many different *imperative* ways, and the planner must choose:

- **Access path:** scan the whole `users` table, or use an index on `country`?
- **Join algorithm:** nested-loop join, hash join, or merge join?
- **Join order:** filter `users` to Japan first (maybe few rows) then join, or join first then filter?
- **Predicate pushdown:** apply `o.total > 1000` *before* the join to shrink the data early?

The planner estimates the cost of each strategy using **table statistics** (row counts, value distributions) and picks the cheapest. You can see its choice:

```sql
EXPLAIN ANALYZE
SELECT u.name, o.total
FROM users u JOIN orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND o.total > 1000;
-- Output shows: Hash Join, Index Scan on users(country), Seq Scan on orders, est. vs actual rows...
```

The same query, unchanged, can switch from an index scan to a full table scan as the data grows — *the planner re-decides*. This is the superpower **and** the catch of declarative code: you don't control the steps, so the engine can optimize them for you, but you also can't simply "fix the loop" when it chooses badly. (Steering the planner is a senior-level skill, covered in [`senior.md`](senior.md).)

> The deep point: SQL is declarative precisely because the *same specification admits many execution plans*, and choosing among them is the engine's job, not yours.

---

## Inside the CSS Layout Engine

CSS feels static — a list of property: value facts. But turning those facts into pixels is a genuine imperative computation the browser runs, called **layout** (or "reflow"):

```
DOM tree + CSSOM  →  render tree  →  LAYOUT (compute boxes)  →  PAINT  →  COMPOSITE
```

When you write:

```css
.sidebar { width: 25%; }
.content { flex: 1; }
```

…the engine must *solve* for actual widths: read the container's width, compute 25% of it, give the rest to `.content`, then recurse into each child to lay out *its* children — a tree-walking algorithm with explicit measurement and placement. The **CSS box model**, **flexbox**, and **grid** are essentially constraint systems the layout engine solves on every change.

This is why two CSS facts that *look* order-independent sometimes aren't — **specificity** and the cascade are the engine resolving conflicts:

```css
/* Which color wins? The engine computes specificity, not source order alone. */
#main .btn   { color: red;   }   /* specificity (1,1,0) — ID + class */
.btn.primary { color: blue;  }   /* specificity (0,2,0) — two classes */
```

`#main .btn` wins because an ID out-weighs two classes, *regardless of which line comes later*. The "cascade" is a precise, imperative conflict-resolution algorithm (origin → specificity → source order) that the engine runs. Understanding that algorithm is the difference between fighting CSS with `!important` and reasoning about it. (You'll meet specificity again as a *leaky abstraction* below.)

---

## Inside Make: The Dependency DAG

Make is one of the purest declarative engines, and one of the easiest to fully understand. You declare **targets**, their **dependencies**, and a **recipe** to build each one:

```makefile
app: main.o util.o          # app depends on two object files
	cc -o app main.o util.o

main.o: main.c util.h       # main.o depends on these sources
	cc -c main.c

util.o: util.c util.h
	cc -c util.c
```

You never wrote "build `main.o`, then `util.o`, then link." You declared a set of *dependency relationships*. Make's engine then:

1. Builds a **directed acyclic graph (DAG)** from your dependency declarations.
2. **Topologically sorts** it to find a valid build order.
3. Compares **timestamps**: it rebuilds a target *only if* a dependency is newer than the target (this is the incremental-build optimization — and an idempotence-like property: running `make` twice does nothing the second time).
4. Runs the recipes in dependency order, possibly **in parallel** (`make -j`) for independent branches.

```
       app
      /    \
  main.o   util.o      Make derives this graph from your rules,
    |    \   |         topo-sorts it, and skips anything up-to-date.
 main.c  util.h util.c
```

The lesson generalizes far beyond Make: **declare a dependency graph, and an engine handles ordering, skipping, and parallelism.** Bazel, Gradle, Terraform, and Kubernetes controllers all share this DNA — you declare relationships, the engine computes the schedule.

---

## Inside React: The Reconciler

React's slogan is *UI = f(state)*: you write a function that, given the current state, *describes* what the UI should look like. You never write DOM-mutation steps. The engine that turns your description into actual DOM edits is the **reconciler**.

```jsx
function Counter({ count }) {
  return <button>Clicked {count} times</button>;   // a DESCRIPTION, not a DOM edit
}
```

When `count` changes from `3` to `4`, React does **not** rebuild the page. The reconciler:

1. Calls your function again to produce a new **virtual DOM** (a lightweight tree describing the desired UI).
2. **Diffs** the new tree against the previous one.
3. Computes the **minimal set of real DOM mutations** to make the browser match — here, just changing one text node from `"3"` to `"4"`.
4. Applies exactly those mutations.

You declared *what the UI is for this state*; the reconciler figured out the imperative `document.createElement` / `node.textContent = ...` steps. This is the same surface/engine split as SQL — and it's why React is squarely a **declarative** library, even though it produces wildly imperative DOM operations under the hood. (Reactive UIs get their own treatment in [05 — Reactive Programming](../05-reactive-programming/).)

---

## Referential Transparency & Order-Independence

Why are declarative descriptions safe for an engine to reorder, parallelize, and cache? Because of **referential transparency**: an expression can be replaced by its value without changing the program's meaning.

A SQL `WHERE age > 18` clause is referentially transparent — it has no side effects and depends only on the row's data, so the engine may evaluate it before or after a sort, on one core or eight, and the answer is identical. A pure CSS rule is the same: `color: blue` is a fact, not an action, so the engine can apply rules in whatever internal order is efficient.

This is the technical *reason* behind the junior-level "hallmarks":

- **Order-independence** comes from the absence of side effects: if writing A then B is indistinguishable from B then A, the engine is free to choose either — or both at once.
- **Idempotence** comes from declaring *state* rather than *transitions*: "should be 3 replicas" can be re-applied any number of times because it asserts a target, not a delta.

The moment you smuggle a side effect into a declarative surface — an `ORDER BY rand()`, a CSS rule that depends on JS having run, a `map` whose callback mutates a global — you *break* referential transparency, and the engine's freedom to reorder turns into a bug. **The discipline that makes declarative code work is keeping the surface free of hidden side effects.** (This connects directly to [pure functions](../../code-craft/functional-programming/02-pure-functions-and-referential-transparency/junior.md).)

---

## Internal vs External DSLs

Most declarative code is written in a **domain-specific language (DSL)** — a small language tuned for one job (querying, layout, builds). DSLs come in two flavors, and knowing the difference clarifies a lot.

**External DSL** — a standalone language with its own grammar and parser, separate from any host language. You write it as text, and a dedicated engine parses it:

```sql
-- SQL is an EXTERNAL DSL: its own grammar, parsed by the database.
SELECT id FROM users WHERE active = true;
```

CSS, HTML, regex, `Makefile` syntax, and HCL (Terraform) are all external DSLs. Pros: maximally tailored syntax, usable by non-programmers, enforceable safety (a SQL engine can't run arbitrary code). Cons: you need a whole parser/engine, and you can't borrow the host language's tooling.

**Internal (embedded) DSL** — a declarative-feeling API built *inside* a general-purpose language, using its syntax:

```python
# SQLAlchemy: an INTERNAL DSL — Python method chaining that reads declaratively.
session.query(User).filter(User.active == True).order_by(User.name)
```

```python
# pandas is also an internal DSL for tabular queries:
df[df.active].sort_values("name")[["id", "name"]]
```

Here there's no separate parser — it's plain Python, so you get IDE autocomplete, type checking, and refactoring for free. The cost: it's constrained by the host language's syntax, and it can leak host-language semantics (a `filter` that secretly runs Python instead of SQL).

> **Why it matters:** when you choose or evaluate a declarative tool, ask which kind it is. External DSLs buy safety and tailored syntax at the cost of tooling; internal DSLs buy tooling and integration at the cost of purity. The same trade-off recurs across query builders, IaC tools, and config systems.

---

## Functional Programming as Declarative

There's a reason FP keeps appearing next to "declarative." A `map`/`filter`/`reduce` pipeline *is* declarative at small scale: you describe a transformation, not an iteration.

```python
# Imperative: you write the loop, the index, the accumulator.
result = []
for o in orders:
    if o.status == "completed":
        result.append(o.amount * 1.1)

# Declarative-functional: you describe WHAT the result is. No loop, no index.
result = [o.amount * 1.1 for o in orders if o.status == "completed"]
```

```javascript
// JavaScript — the same shape with map/filter: a description, not a procedure.
const result = orders
  .filter(o => o.status === "completed")
  .map(o => o.amount * 1.1);
```

The pipeline declares *what* each stage produces; the language's iterator machinery (or a lazy stream engine) supplies the *how* — and is free to fuse stages, run them lazily, or parallelize them. This is exactly the surface/engine split, scaled down to a single expression. It's why FP is often called "declarative programming you can do inside a general-purpose language" — and why this roadmap cross-links heavily to [Functional Programming](../../code-craft/functional-programming/). The boundary is fuzzy on purpose: declarative is a *spectrum*, and functional pipelines sit comfortably on its declarative half.

---

## Leaky Abstractions

The engine is supposed to hide the "how" — but every declarative abstraction **leaks** the underlying imperative reality somewhere, usually around *performance* or *conflict resolution*. Joel Spolsky's "Law of Leaky Abstractions" says all non-trivial abstractions leak; declarative systems are the textbook case. Two you'll hit constantly:

### The N+1 query

An ORM lets you treat database rows as objects — a beautifully declarative surface. But this innocent loop:

```python
for user in User.query.all():          # 1 query: SELECT * FROM users
    print(user.orders)                 # N queries: one SELECT per user!
```

…fires **N+1 queries**: one to load the users, then one *per user* to lazily load their orders. The declarative surface ("just access `.orders`") hides the fact that each access is a round-trip to the database. The abstraction leaked: you must drop a level and tell the engine to *eager-load* (`joinedload`, a `JOIN`) to fix it. You can't fix N+1 without knowing the SQL underneath.

### CSS specificity surprises

```css
.button { color: blue; }
a.button { color: green; }      /* wins over .button — but why? */
```

The declarative surface promises "just set the color." The leak is that conflicting rules are resolved by a **specificity algorithm**, not by what you intended or wrote last. Engineers who don't know the algorithm reach for `!important`, which is fighting the engine instead of understanding it.

> **The senior habit forming here:** trust the abstraction for the common case, but know *which level it leaks at* — almost always performance and conflict resolution — so you can drop down a layer when it does. Every declarative tool has a `EXPLAIN`-equivalent for exactly this reason.

---

## Mental Models

- **You're programming the engine, not the machine.** Your declarative "code" is *input to another program* (the planner, the layout engine, the reconciler). Ask "what does the engine do with this?" rather than "what does the CPU do."
- **The compiler analogy.** A query planner is a compiler from SQL to an execution plan; CSS is compiled to a layout; JSX is compiled to DOM operations. Compilers reorder and optimize freely *because* the input is side-effect-free — same reason engines can.
- **The spectrum, not the switch.** FP pipelines, an ORM query builder, and raw SQL are increasingly declarative points on one line, not separate categories. "How declarative is this?" is a better question than "is this declarative?"
- **Every abstraction leaks at performance.** The engine hides the steps for correctness but exposes them for speed. The leak is the feature that lets you tune — `EXPLAIN`, eager loading, layout profilers exist precisely there.

---

## Common Mistakes

- **Believing the engine is infinitely smart.** Planners use *estimates* and heuristics; they choose badly with stale statistics or unusual data. "It's declarative, so it'll be optimal" is false — declarative means *the engine chooses*, not *the engine always chooses well*.
- **Writing declarative code with hidden side effects.** A `map` whose callback writes to a database, a config template that depends on execution order — these break the referential transparency the engine relies on, and the resulting bugs are baffling because "it should be order-independent."
- **Ignoring the N+1 (and friends).** Trusting an ORM/GraphQL/lazy-stream abstraction without ever looking at the queries it generates. The leak is always at the I/O boundary; you must occasionally look underneath.
- **Fighting the engine instead of steering it.** Sprinkling `!important`, `OPTION (FORCE ORDER)`, or `key` hacks without understanding the resolution algorithm. The fix is to learn the engine's rules, not to override them blindly.
- **Assuming internal and external DSLs are interchangeable.** An ORM query (internal DSL) can silently execute in Python instead of pushing work to the database; raw SQL (external DSL) can't. Know which one you're holding.

---

## Test Yourself

1. Explain the "surface and engine" split. What is the imperative engine for SQL? For CSS? For React?
2. Name three different *execution strategies* a SQL planner might choose for one `JOIN`, and what data it uses to choose.
3. Why is order-independence a *consequence* of referential transparency, not a separate rule?
4. What's the difference between an internal and an external DSL? Give one example of each and one trade-off.
5. What is the N+1 query problem, and why does it count as a "leaky abstraction"?
6. Why can a browser apply CSS rules in any internal order, but `#main .btn` still beats `.btn.primary` regardless of source order?

<details>
<summary>Answers</summary>

1. The **surface** is your declarative description; the **engine** is the imperative program that turns it into steps. SQL's engine is the **query planner + executor**; CSS's is the **layout/paint engine**; React's is the **reconciler** (virtual-DOM diff).
2. For a `JOIN`: **nested-loop**, **hash join**, or **merge join**; and **join order** (which table first). The planner chooses using **table statistics** — row counts and value distributions — to estimate each plan's cost.
3. Because order-independence *requires* that evaluating A-then-B equals B-then-A, which is only guaranteed when expressions have no side effects — i.e., are referentially transparent. No side effects ⇒ reordering is safe ⇒ order-independence.
4. **External DSL:** its own grammar/parser, separate from any host language (SQL, CSS, regex). **Internal DSL:** a declarative-feeling API inside a host language (SQLAlchemy, pandas). Trade-off: external buys tailored syntax + safety but needs its own tooling; internal buys host-language tooling but can leak host semantics.
5. **N+1:** an ORM loop loads a collection (1 query) then triggers one query *per element* to lazily fetch a relation (N queries). It's a leaky abstraction because the declarative surface (`user.orders`) hides that each access is a database round-trip; fixing it requires knowing the SQL and eager-loading.
6. CSS rules are side-effect-free *facts*, so the engine may apply them in any efficient order. But conflicts are resolved by the **specificity algorithm** (ID beats class beats element, with source order only as the final tiebreaker), so `#main .btn` (one ID) out-weighs `.btn.primary` (two classes) no matter where the lines appear.

</details>

---

## Summary

- Declarative programming is a **declarative surface over an imperative engine**. The engine — a query planner, a layout engine, Make's DAG scheduler, React's reconciler — is real, imperative code written once, and your "code" is *input* to it.
- The **SQL planner** compiles your query into one of many possible execution plans, chosen by cost estimates from table statistics — which is exactly *why* SQL is declarative (one spec, many plans) and why you can't just "fix the loop."
- The **CSS engine** solves layout as a constraint system and resolves conflicts with the specificity/cascade algorithm; **Make** derives a dependency DAG, topo-sorts it, and skips up-to-date targets; **React** diffs virtual DOM trees to compute minimal mutations. All four are the same surface/engine pattern.
- **Referential transparency** is the technical reason engines may reorder, parallelize, and cache — and the discipline of keeping side effects *out* of the declarative surface is what keeps order-independence and idempotence true.
- DSLs come in **internal** (embedded in a host language — tooling, leakage) and **external** (standalone grammar — safety, no host tooling) flavors; **functional pipelines** are declarative at small scale.
- Every abstraction **leaks**, almost always at performance and conflict resolution — the N+1 query and CSS specificity are the canonical examples. The skill is trusting the surface while knowing which level it leaks at.
- Next: [`senior.md`](senior.md) — the trade-offs, when the engine is wrong and you must hint it, debugging declarative systems, and the rule of least power.

---

## Further Reading

- Joel Spolsky, *The Law of Leaky Abstractions* (2002) — why every non-trivial abstraction (including all declarative ones) leaks.
- *Designing Data-Intensive Applications* — Martin Kleppmann — Ch. 2–3 cover declarative query languages and how engines execute them.
- *Database Internals* — Alex Petrov — how query planners and execution engines actually turn SQL into steps.
- Martin Fowler, *Domain-Specific Languages* — the definitive treatment of internal vs external DSLs.
- *High Performance Browser Networking* / web.dev rendering guides — the DOM → CSSOM → layout → paint pipeline in detail.

---

## Related Topics

- [`junior.md`](junior.md) — the what-vs-how foundation and the hallmarks of declarative code.
- [`senior.md`](senior.md) — trade-offs, hinting the engine, debugging, and the rule of least power.
- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the style every declarative engine is written in.
- [05 — Reactive Programming](../05-reactive-programming/) — React's reconciler and declarative UIs that react over time.
- [Pure Functions & Referential Transparency](../../code-craft/functional-programming/02-pure-functions-and-referential-transparency/junior.md) — the property that makes engine reordering safe.
- [Map / Filter / Reduce](../../code-craft/functional-programming/04-map-filter-reduce/junior.md) — declarative pipelines inside a general-purpose language.
- [SQL Query Optimization](../../../Architecture/system-design/) — steering the planner once you can read its plans.
