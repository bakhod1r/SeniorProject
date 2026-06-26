# Semantic Analysis — Tasks

> **Topic:** [Semantic Analysis](README.md)
> **Focus:** Build the phase that proves a parsed program *means* something — a scoped symbol table, a type checker, flow-based checks, and resolution — through graded, self-checkable exercises.

---

## Table of Contents

1. [How to Use These Tasks](#how-to-use-these-tasks)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Self-Assessment Checklist](#self-assessment-checklist)

---

## How to Use These Tasks

These tasks build one small analyzer incrementally. Each task states a **goal**, a **self-check** (how to know you're done), and a **hint** (folded). Solutions are given **sparsely** — only where a concrete answer prevents going down the wrong path; elsewhere the self-check is the answer.

- Pick any language. The examples assume you have a parser producing an AST with **source spans** (line, column range) on every node. If you don't, fake the AST as nested dicts/records — the semantics is what matters, not the parser.
- Work in order within a tier; later tasks reuse earlier code (the symbol table, the diagnostics list, the `ErrorType` sentinel).
- After each tier, run the **self-assessment checklist** at the end.
- "Diagnostics" throughout means a structured record `{severity, message, span, notes[]}` collected into a list — never `throw` on the first error.

Assumed mini-language (extend as needed):

```text
program  := item*
item     := func | letDecl
func     := "func" NAME "(" params ")" (":" TYPE)? block
letDecl  := ("let" | "const") NAME (":" TYPE)? "=" expr
stmt     := letDecl | assign | ifStmt | whileStmt | return | break | exprStmt | block
expr     := INT | STRING | BOOL | NAME | expr OP expr | NAME "(" args ")"
TYPE     := "int" | "string" | "bool" | NAME
```

---

## Warm-Up

### Task W1 — Flat symbol table

**Goal.** Implement a non-scoped symbol table with `declare(name, info)` and `lookup(name)`. `declare` errors on redeclaration; `lookup` returns the info or signals "undefined."

**Self-check.** Declaring `x` then `x` again reports a redeclaration. Looking up an undeclared `y` reports "undefined variable `y`." Looking up a declared `x` returns its info.

<details><summary>Hint</summary>
A single dictionary `name -> info`. `declare` checks membership first; `lookup` returns `None` (let the caller diagnose) rather than throwing.
</details>

---

### Task W2 — Declarations vs. uses

**Goal.** Given a tiny statement list (`let count = 0; count = count + 1; print(count);`), classify each name occurrence as a *declaration* or a *use*.

**Self-check.** `count` in `let count` is a declaration; the three other `count` occurrences and `print` are uses. Your classifier should not call anything in `let X = ...`'s left position a "use."

<details><summary>Hint</summary>
The left side of a `let`/`const` and a function's name are declarations; everything in an expression position (including the target of an `assign`, which is a use *and* a write) is a use.
</details>

---

### Task W3 — Scope as a stack of dictionaries

**Goal.** Implement `enter_scope()`, `exit_scope()`, scoped `declare`, and `lookup` (innermost-to-outermost) using a stack of dictionaries.

**Self-check.** For `let x=1; { let x=2; LOOKUP(x); } LOOKUP(x);` the first lookup finds the inner `x` (value 2), the second finds the outer `x` (value 1). `exit_scope` makes the inner `x` disappear.

<details><summary>Hint</summary>
`enter_scope` pushes `{}`; `lookup` iterates `reversed(scopes)` and returns the first hit; `exit_scope` pops. Redeclaration check looks only at `scopes[-1]`.
</details>

---

### Task W4 — Predict the output

**Goal.** Without running code, state what these print and why:

```text
let x = 1;
{ let x = 99; print(x); }
print(x);
```

**Self-check.** Prints `99` then `1`. The inner `let x` *shadows* the outer one inside the block; outside, the outer `x` (untouched) is visible. If you wrote `99` then `99`, you've confused shadowing with reassignment.

---

### Task W5 — Bottom-up type of an expression

**Goal.** Write `type_of(node)` for literals, names (type from the symbol table), and `+`. `int + int = int`, `string + string = string`, anything else is a type error.

**Self-check.** `5 + 3` → `int`. `"a" + "b"` → `string`. `5 + "x"` → a "cannot add `int` and `string`" diagnostic. The leaves return types directly; `+` derives its type from its operands.

<details><summary>Hint</summary>
Recurse into both operands first, then apply the rule. A `Name`'s type is `lookup(name).type`.
</details>

---

## Core

### Task C1 — Rich symbol records

**Goal.** Upgrade the symbol table to store a record per name: `{name, kind, type, decl_span, mutable, used}`. `kind` ∈ {var, const, func, param}. Set `mutable` from `let` vs `const`. Set `used = True` inside `lookup`.

**Self-check.** A `const` symbol has `mutable == False`. After a program uses `x` once, `x.used == True`; a never-used `y` stays `False`.

---

### Task C2 — Name resolution walk with recovery

**Goal.** Write a recursive resolver over the AST that: enters/exits scopes around blocks; for `let`, **resolves the initializer first, then declares**; for a `Name`, looks it up and *decorates* the node with its binding, or — on failure — reports "undefined variable" and binds it to a synthetic `ERROR_SYMBOL`.

**Self-check.** `let x = x + 1` (no outer `x`) reports exactly *one* undefined-`x` error (the recovery symbol stops re-reporting). `{ let y=1; } print(y)` reports `y` undefined. A redeclaration in the same block reports once and continues.

<details><summary>Hint</summary>
The order in the `Let` handler is the whole point: `resolve(node.value)` *then* `current.insert(...)`. Wrap `enter`/`exit` in `try/finally` so an early return can't leak a scope.
</details>

<details><summary>Solution sketch (the load-bearing ordering)</summary>

```python
def resolve(self, node):
    if node.kind == "Let":
        self.resolve(node.value)          # 1) initializer sees the OUTER scope
        sym = Symbol(node.name, "const" if node.is_const else "var",
                     None, node.span, mutable=not node.is_const)
        try: self.current.insert(sym)     # 2) THEN the new name becomes visible
        except Redeclared as e:
            self.diag("error", f"'{node.name}' already declared", node.span,
                      notes=[("first declared here", e.first_span)])
    elif node.kind == "Name":
        sym = self.current.lookup(node.name)
        if sym is None:
            self.diag("error", f"undefined variable '{node.name}'", node.span)
            node.binding = ERROR_SYMBOL   # recovery: later uses won't re-error
        else:
            node.binding = sym
```
</details>

---

### Task C3 — Type checker with ErrorType

**Goal.** Write a checker that types every expression bottom-up and stamps `node.type`. Support `+`, comparison (`==`, `<` → `bool`), names, literals, and calls. Introduce a single `ERROR` type: any rule whose operand is `ERROR` returns `ERROR` and emits **nothing**.

**Self-check.** In `a + (b * zog)` where `zog` is undefined, you get exactly *one* diagnostic (the undefined `zog` from resolution), not a cascade of "type mismatch" up the tree — because every enclosing node short-circuits on `ERROR`.

<details><summary>Hint</summary>
The first line of every operator rule: `if ERROR in (lt, rt): node.type = ERROR; return ERROR`. The undefined name's binding is `ERROR_SYMBOL`, whose type is `ERROR`, so the quarantine flows up automatically.
</details>

---

### Task C4 — Directional assignability

**Goal.** Implement `assignable(from, to)` that is *not* equality: `int` is assignable to `float` (widening); `float` is **not** assignable to `int`; equal types are assignable; `ERROR` is assignable to/from anything (to avoid re-reporting). Use it to check `let f: float = 3` (OK) and `let i: int = 3.5` (error).

**Self-check.** `assignable("int","float")` is `True`, `assignable("float","int")` is `False`, `assignable("int","int")` is `True`. `let f: float = 3` type-checks; `let i: int = 3.5` reports a narrowing error.

<details><summary>Hint</summary>
A small `SUBTYPES` set `{("int","float")}` plus the equality and `ERROR` short-circuits. Note the asymmetry — that's the point.
</details>

---

### Task C5 — Call arity and argument types

**Goal.** For a call `f(args...)`, resolve `f`, verify it's a function, check the argument count matches, and check each argument is `assignable` to its parameter type. Emit precise diagnostics ("expected 2 arguments, got 3"; "argument has type `string`, expected `int`").

**Self-check.** Calling a 2-param function with 3 args reports the arity error; passing a `string` where `int` is expected reports the type error *at the argument's span*. Calling a non-function (`x(1)` where `x` is a var) reports "not a function."

---

### Task C6 — Const-correctness and break/return context

**Goal.** (a) Reject assignment to a `const` (use the `mutable` flag). (b) Track a small context as you walk: a loop-depth counter and the current function's return type. Reject `break`/`continue` when loop-depth is 0, and reject `return v` whose `v` isn't assignable to the current return type (and `return;` in a non-void function).

**Self-check.** `const PI = 3.14; PI = 3` reports "cannot assign to const `PI`." A top-level `break` reports "break outside loop." `func f(): int { return "x"; }` reports a return-type mismatch.

<details><summary>Hint</summary>
Increment loop-depth on entering a `while`/`for`, decrement on exit (try/finally). Set `current_return` when entering a function body. These are *inherited* attributes threaded down the walk.
</details>

---

### Task C7 — Two-pass forward references

**Goal.** Make file-scope functions order-independent: a `collect` pass inserts every function's *signature* into the global scope; a `check` pass then walks bodies. Demonstrate that `main` can call `helper` defined *below* it.

**Self-check.** With `helper` written after `main`, your single-pass version reported `helper` undefined; the two-pass version resolves it. Mutually recursive `even`/`odd` also resolve.

<details><summary>Hint</summary>
Pass one only reads signatures (name, param types, return type) — it does *not* descend into bodies. Pass two does the resolution + type checking of bodies, with all signatures already present.
</details>

---

## Advanced

### Task A1 — Definite assignment over `if`/`else`

**Goal.** Implement Java-style definite assignment for straight-line code plus `if`/`else`: track the set of locals assigned on *every* path; a read of a not-definitely-assigned local is an error. At an `if`/`else` join, the assigned set is the **intersection** of the two branches' sets.

**Self-check.** `int x; if (c) x=1; use(x);` → error (only the `then` path assigns). Adding `else x=2;` → OK (both paths assign, intersection includes `x`). A `use(x)` *inside* the `then` after `x=1` is fine.

<details><summary>Hint</summary>
Carry an `assigned` set through the walk. An `if` runs each branch on a *copy*, then sets `assigned = assigned ∪ (then_set ∩ else_set)`; an `else`-less `if` intersects the `then` set with the *unchanged* set (the implicit empty-else path).
</details>

<details><summary>Solution sketch</summary>

```python
def da_if(stmt, assigned):
    check_reads(stmt.cond, assigned)
    then_set = walk_branch(stmt.then, set(assigned))
    else_set = walk_branch(stmt.els,  set(assigned)) if stmt.els else assigned
    return assigned | (then_set & else_set)     # assigned only if on BOTH paths
```
</details>

---

### Task A2 — Definite assignment with loops (fixpoint)

**Goal.** Extend A1 to `while` loops by building a tiny CFG and running the analysis as a **forward must dataflow** to a fixpoint (loop bodies may execute zero times; the back-edge feeds the loop head). Handle `break`/`continue` edges.

**Self-check.** `int x; while (c) { x = 1; } use(x);` → error (the loop may run zero times, so `x` may be unassigned). `int x; x = 0; while (c) { x = 1; } use(x);` → OK. A `break` mid-loop is modeled as an edge to after the loop.

<details><summary>Hint</summary>
Initialize each block's IN to "everything assigned" except entry (= empty), iterate `IN[b] = ∩ OUT[preds]` and `OUT[b] = transfer(b, IN[b])` until no set changes. Reverse-postorder block order converges fast. A zero-trip loop means the loop-head's predecessors include the pre-loop block whose set may lack the loop-body assignments.
</details>

---

### Task A3 — Reachability and "missing return"

**Goal.** Compute, for each statement, whether control can reach it; warn on unreachable statements (after `return`/`break`/`continue`/an infinite loop). Then implement "missing return": a non-void function is valid iff its body **cannot complete normally**.

**Self-check.** Code after an unconditional `return` warns "unreachable." `func f(): int { if (c) return 1; }` reports "missing return" (the false path falls off the end). `func g(): int { while (true) {} }` is OK with no `return`.

<details><summary>Hint</summary>
Write `completes_normally(stmt)` as a synthesized attribute: `return`/`break`/`continue` → `False`; a block completes normally iff all its statements do (and a non-completing statement makes its successors unreachable); `if` with no `else` completes normally; `while(true)` with no `break` does not. "Missing return" = non-void function whose body `completes_normally`.
</details>

---

### Task A4 — Match exhaustiveness with a witness

**Goal.** Add an enum/sum type and a `match`. Check exhaustiveness: compute the set of constructors not covered by any arm; if non-empty, report it as a **witness** ("non-exhaustive; missing: `Triangle`"). A wildcard `_` arm covers the rest. Also flag an arm that can never match (covered entirely by earlier arms) as "unreachable arm."

**Self-check.** For `enum Shape {Circle,Square,Triangle}`, a match on `Circle`/`Square` reports missing `Triangle`. Adding a `Triangle` arm or a `_` makes it exhaustive. A second `Circle` arm after the first reports "unreachable arm."

<details><summary>Hint</summary>
For a flat enum: `missing = all_constructors - {arm.ctor for non-wildcard arms}`; a wildcard short-circuits to exhaustive. Unreachable arm: its constructor already appeared in an earlier arm (or an earlier wildcard preceded it).
</details>

---

### Task A5 — Bidirectional checking for empty literals

**Goal.** Add `check(node, expected)` alongside `synth(node)`. Make an empty array literal `[]` type-check *only* when an expected `List<T>` is pushed down (so `let xs: List<int> = []` works) and report "cannot infer type of empty array" when there's no expectation.

**Self-check.** `let xs: List<int> = []` → `xs : List<int>`. A bare `let xs = []` (no annotation) → "cannot infer type of empty array." `let xs: List<int> = [1, "a"]` → element-type error against the expected `int`.

<details><summary>Hint</summary>
`check([], List<int>)` adopts the expected type and pushes the element type `int` down to each element. `synth([])` with elements infers from the first element; `synth([])` with no elements is the error case. Variables and calls *synthesize*; literals and empty collections are *checked*.
</details>

---

### Task A6 — Overload resolution

**Goal.** Allow multiple functions with the same name. For a call, compute the **candidate set** (same name), filter to **applicable** (arity + each arg assignable to the param), then pick the **most specific** (candidate whose params are each assignable to the other candidates' params). Report "no matching overload" or "ambiguous call" (listing candidates) when there's no unique best.

**Self-check.** With `print(string)` and `print(object)` (string <: object) and a `string` argument, you pick `print(string)`. With overloads that tie across two parameters, you report ambiguity and name the competing candidates.

<details><summary>Hint</summary>
"More specific" is a partial order — it can be a tie with multiple parameters, which is genuine ambiguity. The `best` set is candidates that dominate every other applicable candidate; require `len(best) == 1`.
</details>

---

## Capstone

### Task CAP — A complete semantic analyzer for a small language

**Goal.** Combine everything into a front end that takes a parsed AST and produces either a list of diagnostics *or* a fully decorated, typed AST. It must implement, as an ordered pipeline of passes with clear pre/postconditions:

1. **Collect declarations** — insert all file-scope function and type signatures (forward references, mutual recursion).
2. **Resolve names** — bind every use; recover undefined names to an error symbol.
3. **Type-check** — type every expression bottom-up with an `ERROR` sentinel; check assignability (directional), call arity + argument types, const-correctness, and `break`/`return` context; resolve overloads.
4. **Control-flow checks** — definite assignment (with loops), reachability / missing-return, and match exhaustiveness with witnesses.
5. **Decorate** — leave on the AST: a binding on every name, a type on every expression, an `exhaustive` flag on every match. This is the artifact a code generator would consume.

It must:
- Carry **source spans** on every diagnostic (render `file:line:col` with a caret).
- **Recover** at expression, statement, and declaration level — never crash, never stop at the first error.
- Make the diagnostic count track the number of *independent* mistakes.

**Self-check.** Run it on a corpus of small programs:
- A correct program → zero diagnostics; every expression node has a non-`ERROR` type and every name a real binding.
- A program with one undefined variable buried in a deep expression → exactly one diagnostic (no cascade).
- A program with a non-exhaustive match → a diagnostic naming the missing case.
- A non-void function whose body can fall off the end → "missing return."
- `const X = 1; X = 2;` → "cannot assign to const `X`."
- A 10-error program → ~10 diagnostics, each pointing at a distinct real mistake.
- Forward reference: `main` calling a `helper` defined below it → resolves cleanly.

**Stretch goals.**
- Add **cross-module resolution**: multiple files/modules, `import`, visibility (resolvable vs. accessible), and two-phase interface-first resolution that detects import cycles.
- Add a tiny **borrow check**: a `&`/`&mut` reference type and a flow analysis enforcing "many shared XOR one mutable, no use-after-move," using your CFG and liveness.
- Make the analyzer **query-driven**: memoize `type_of`/`resolve` with dependency tracking and re-analyze only affected nodes after a simulated edit.
- Emit a **typed IR** where every call is resolved to a concrete target and every coercion is an explicit node — the handoff to codegen.

<details><summary>Hint — architecture</summary>

- Make each pass a function `pass(ast, table, diags)` that asserts its precondition (e.g., type-check asserts every `Name` has a binding). Bugs in phase ordering then fail loudly instead of crashing three passes later.
- Build the CFG once; run definite assignment and reachability over the same graph.
- Keep the `ERROR` sentinel and `assignable`/`ERROR`-short-circuiting uniform across *every* rule — one missed short-circuit reintroduces cascades.
- Decorate, don't rebuild: add `node.binding`, `node.type`, `node.exhaustive` fields; never replace nodes, so diagnostics and later passes still see the original shape.
- Stop before "decorate is consumed" if any error occurred — the poisoned AST exists to maximize diagnostics, not to be compiled.

</details>

---

## Self-Assessment Checklist

After completing a tier, confirm you can do the following from memory:

**After Warm-Up:**
- [ ] Explain why a flat symbol table breaks the moment a language has blocks.
- [ ] Implement scoped `enter`/`exit`/`declare`/`lookup` with innermost-first search.
- [ ] Predict the output of a shadowing program and explain why shadowing ≠ reassignment.
- [ ] Type a small expression bottom-up and identify where a type error arises.

**After Core:**
- [ ] Justify the resolve-initializer-then-declare ordering with the `let x = x` example.
- [ ] Explain the `ErrorType` sentinel and what cascade appears without it.
- [ ] Write a *directional* `assignable` and give a pair legal one way, illegal the other.
- [ ] Check call arity + argument types and report errors at the right spans.
- [ ] Enforce const-correctness and `break`/`return` context using walk-carried state.
- [ ] Make file-scope functions order-independent with a two-pass design.

**After Advanced:**
- [ ] Explain why definite assignment is a *forward must* dataflow problem (intersect at merges).
- [ ] Run definite assignment to a fixpoint over a loop and explain the zero-trip case.
- [ ] State the "missing return" rule as "body must not complete normally," not "has a return."
- [ ] Compute match exhaustiveness and produce a *witness* for the missing case.
- [ ] Use bidirectional checking to type an empty literal against an expected type.
- [ ] Resolve an overload via candidate → applicable → most-specific, and detect ambiguity.

**After Capstone:**
- [ ] Order a multi-pass pipeline by data dependencies and state each pass's pre/postcondition.
- [ ] Recover at expression, statement, and declaration level so error count tracks independent mistakes.
- [ ] Produce a fully decorated, typed AST and describe exactly what a code generator consumes from it.
- [ ] (Stretch) Explain cross-module resolution (resolvable vs. accessible), a minimal borrow check, and why a query-driven design enables incremental analysis.

---
