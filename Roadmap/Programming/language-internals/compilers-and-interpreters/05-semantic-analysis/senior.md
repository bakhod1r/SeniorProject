# Semantic Analysis — Senior Level

> **Topic:** [Semantic Analysis](README.md)
> **Focus:** Attribute grammars, multi-pass architecture, control-flow-based checks, exhaustiveness, and error recovery that scales to a real language.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **The theory and architecture that make a checker correct, multi-pass, and survivable — not just a single recursive walk.**

The middle level gave you a working analyzer: a scoped symbol table, a bottom-up type checker, an `ErrorType` sentinel, and structured diagnostics. That analyzer is correct for a small language with a clean grammar and a forgiving user. The senior level is about what happens when the language gets real and the inputs get hostile.

Three forces drive the senior content. The first is **theory you can name**: the informal "compute a type from the children's types" is one half of an **attribute grammar** — a *synthesized* attribute. The other half, *inherited* attributes (the expected type pushed *down* from a parent, the current return type, the enclosing loop), is what turns a one-directional walk into a checker that handles bidirectional type checking, match exhaustiveness against an expected type, and contextual rules. Knowing the synthesized/inherited distinction lets you reason about *which* information flows *which way* and therefore how many passes you need.

The second force is **architecture**. A real front end is not one pass. It is a pipeline of passes: collect declarations, resolve types of signatures, type-check bodies, run control-flow checks (definite assignment, reachability, exhaustiveness), and lower. Each pass has a precondition (the previous pass's output) and a postcondition (what it guarantees the next pass). Getting the pass boundaries right is the single biggest determinant of whether the checker stays maintainable as the language grows.

The third force is **error recovery that actually helps**. The middle-level `ErrorType` quarantine stops cascades inside an expression. A real compiler must also recover at the statement and declaration level: a malformed `let`, a function whose body has ten errors, a type that references an undefined type. The senior goal is a compiler that, given a file with a dozen genuine mistakes, reports a dozen *real* diagnostics — no fewer (don't bail early) and no more (no cascades) — and never crashes.

This page also adds the control-flow-based checks that the middle level only gestured at: definite assignment as a proper forward dataflow problem, reachability/dead-code, and `match`/`switch` exhaustiveness — checks that cannot be done with scoping alone because they depend on *paths through the program*.

---

## Prerequisites

Before reading this page you should be comfortable with:

- The middle-level material in full: rich symbol records, scoped symbol tables (hash-per-scope and chained), the resolve-then-declare ordering, two-pass forward references, bottom-up type checking with `ErrorType`, assignability vs. equality, and structured diagnostics.
- Basic graph thinking: nodes, edges, traversal, fixpoint iteration. Control-flow checks are dataflow over a graph.
- Recursion and the visitor pattern, including threading context *down* a walk (not just returning values *up*).
- A working idea of subtyping (`A <: B`) and of generic/parametric types at the surface level — enough to know they exist and complicate assignability.
- Reading code in Python, Java, Rust, and Go at the level used in the examples.

You do **not** need:

- The full theory of type inference (unification, constraint generation, Hindley–Milner). That lives in the type-systems material; here we do *checking* with local, bidirectional inference at most.
- The internals of borrow checking or trait/overload resolution algorithms — those are professional-level here.
- Any IR/codegen detail beyond "the next pass consumes the typed AST."

---

## Glossary

| Term | Definition |
|------|-----------|
| **Attribute grammar** | A grammar whose nodes carry *attributes* computed by rules; the formalism behind semantic analysis. |
| **Synthesized attribute** | An attribute computed from a node's *children* and passed *up* (e.g., the type of an expression). |
| **Inherited attribute** | An attribute passed *down* from a node's parent/context (e.g., expected type, current return type). |
| **S-attributed** | A grammar using only synthesized attributes; computable in one bottom-up pass. |
| **L-attributed** | A grammar where inherited attributes depend only on the parent and left siblings; computable in one left-to-right depth-first pass. |
| **Bidirectional type checking** | Mixing *synthesis* (infer a type up) and *checking* (verify against an expected type pushed down). |
| **Pass** | One traversal of the AST with a defined precondition and postcondition. |
| **Phase ordering** | The sequence of passes and the dependencies between them. |
| **Control-flow graph (CFG)** | A graph of basic blocks with edges for possible control transfers; the substrate for flow-based checks. |
| **Dataflow analysis** | Computing facts (e.g., "definitely assigned") at each program point via fixpoint over the CFG. |
| **Definite assignment** | A forward dataflow check: a local must be assigned on every path before it is read. |
| **Reachability** | Whether control can reach a statement; unreachable statements are dead code. |
| **Exhaustiveness** | Whether a `match`/`switch` covers every possible value of the scrutinee's type. |
| **Usefulness (of a pattern)** | Whether a `match` arm can ever match a value not matched by earlier arms; the algorithm behind exhaustiveness. |
| **Error recovery** | Continuing after an error, at expression / statement / declaration granularity, to report more real errors. |
| **Poison value / ErrorType** | A sentinel attached to an already-failed node so later rules stay silent. |
| **Cascade** | A flood of secondary errors caused by one real error; the thing recovery exists to prevent. |
| **Salvage** | Recovery that substitutes a plausible value (e.g., an inferred type) so downstream passes can proceed. |

---

## Core Concepts

### 1. Attribute grammars: the formal shape of the whole phase

Semantic analysis is, formally, the evaluation of an **attribute grammar**. Each grammar production has *semantic rules* that compute attributes on the parse/AST nodes. There are two flows:

- **Synthesized attributes** flow *up*. A node computes them from its children. The type of `a + b` from the types of `a` and `b` is synthesized. So is "this block returns on all paths" computed from its statements.
- **Inherited attributes** flow *down*. A node receives them from its parent or context. The *expected type* of an expression (from the variable it's assigned to), the *current function's return type*, "are we inside a loop?", and the symbol table in scope are all inherited.

```text
            assignment  (inherited: nothing; synthesized: void)
           /          \
   target:Name      value:Expr
   syn type=Float    INHERITED expected=Float ──┐
                     syn type=Int               │
                     check: assignable(Int,Float)? yes (widen)
                     └────── synthesized flows up; expected flows down
```

Why this matters: the number of passes you need is determined by how attributes depend on each other. If everything is synthesized (**S-attributed**), one bottom-up pass suffices. If inherited attributes depend only on the parent and left siblings (**L-attributed**), one left-to-right depth-first pass suffices — and most practical checkers are L-attributed by construction (the symbol table and expected type are exactly such inherited attributes). When attributes have cyclic or right-to-left dependencies (a name used before its definition, mutually recursive types), you need *multiple passes* or a fixpoint. The synthesized/inherited vocabulary is how compiler engineers *talk about* and *plan* the number and order of passes.

### 2. Bidirectional type checking: synthesis meets checking

The middle-level checker was pure synthesis: every expression computed its own type upward. Real languages need the other direction too. Consider an empty array literal:

```text
let xs: List<int> = [];
```

`[]` has no inherent element type — synthesis alone yields `List<?>`. But the annotation `List<int>` is an *inherited* expected type pushed down. **Bidirectional type checking** formalizes this: two judgments, *synthesize* (`e ⇒ T`, infer the type up) and *check* (`e ⇐ T`, verify against an expected type down). Lambdas, literals, `null`/`None`, and generic calls are checked against an expected type; variables, applications, and annotated expressions synthesize. This is how TypeScript, Rust, Swift, and Kotlin do local inference without full global unification, and it maps perfectly onto inherited (expected type, down) plus synthesized (actual type, up) attributes.

### 3. Phase ordering: the pipeline of passes

A maintainable front end is a sequence of passes, each with a contract:

```text
Pass 0  Parse                 -> AST with spans
Pass 1  Collect declarations  -> top-level names/types in symbol table (no bodies)
Pass 2  Resolve type refs     -> every type annotation resolved to a real type
Pass 3  Resolve names (bodies) -> every Name node has a binding
Pass 4  Type-check            -> every expression has a type; assignability checked
Pass 5  Control-flow checks   -> definite assignment, reachability, exhaustiveness
Pass 6  Lower / decorate      -> typed AST handed to IR generation
```

The dependencies are real: you cannot type-check a body (4) before type references in signatures are resolved (2); you cannot run definite assignment (5) before names and types are known (3, 4). Collapsing passes for speed is the usual source of "works until the language grows a feature." Separating them makes each pass a small, testable function with a precondition it can assert. Mutually recursive declarations are exactly why passes 1–2 precede 3–4: collect *all* signatures, *then* check bodies.

### 4. Control flow is a graph, and some checks live on it

Scoping answers "is this name visible here?" It cannot answer "is this variable assigned on every path that reaches this read?" or "can this statement ever execute?" Those are **control-flow** questions, and they require a **control-flow graph (CFG)**: basic blocks (straight-line code) connected by edges for branches, loops, returns, and exceptions.

```text
   x = ?            B0: enter
   if c             B0 -> B1 (c true), B0 -> B2 (c false)
   B1: x = 1        B1 -> B3
   B2: (nothing)    B2 -> B3
   B3: use(x)       is x assigned on every path into B3?
                    path through B2 never assigned x -> ERROR
```

You build the CFG from the AST (or from a lowered IR), then run **dataflow analysis**: each program point gets a set of facts, computed by iterating to a fixpoint over the graph.

### 5. Definite assignment as forward dataflow

Definite assignment (Java, C#) is a *forward, must* dataflow problem. The fact at each point is "the set of locals definitely assigned on *every* path reaching here." Transfer functions:

- An assignment `x = e` adds `x` to the out-set.
- A read of `x` requires `x` in the in-set, else it's an error.
- At a merge point (after `if`/loops), the in-set is the **intersection** of predecessors' out-sets — "must" analysis: assigned only if assigned on *all* incoming paths.

For loops you iterate to a fixpoint (the back-edge feeds the loop head's in-set). The middle-level "intersect the branches" trick was this analysis specialized to a single `if`; the senior version handles loops, early returns, `break`/`continue`, and `throw` by giving each its correct CFG edges (e.g., a `return` has no edge to the following statement, which is exactly why code after it is unreachable).

### 6. Reachability and dead-code detection

Reachability is the dual question, computed on the same CFG: a statement is **reachable** if some path from entry reaches its block. After an unconditional `return`, `break`, `continue`, `throw`, or an infinite loop with no `break`, the following statements are **unreachable**. Languages differ on severity: Java makes unreachable statements a *compile error*; Rust and Go warn (Go errors on "missing return" but warns on some dead code via vet); C is silent in the standard but compilers warn. Reachability also feeds the "missing return" check: a value-returning function is valid only if control cannot *fall off the end* — i.e., the exit block is unreachable or every path returns.

### 7. Exhaustiveness checking for pattern matching

`match`/`switch` over a sum type (enum, ADT, sealed class) should cover every case. **Exhaustiveness** is the check that it does; it is computed by a *usefulness* algorithm (Maranget's): for the implicit "wildcard" arm after the user's arms, ask "is there any value the existing arms don't match?" If yes, the match is non-exhaustive and you can even synthesize a *witness* — a concrete uncovered pattern — for the diagnostic.

```rust
enum Shape { Circle, Square, Triangle }
match s {
    Shape::Circle => ...,
    Shape::Square => ...,
    // ERROR: non-exhaustive; `Triangle` not covered
}
```

The same algorithm catches **unreachable arms** (an arm matched entirely by earlier arms is "useless") and **redundant guards**. Rust, OCaml, Haskell, and Swift do this; C-style `switch` historically does not, which is why `default:` and `-Wswitch` exist. Exhaustiveness is a synthesized property of the match node computed from its arms and the scrutinee's type — and it's a major safety feature: adding a variant to the enum makes every non-exhaustive match a compile error, forcing you to handle the new case.

### 8. Error recovery at three granularities

The middle-level `ErrorType` recovers within an *expression*. A senior checker recovers at three levels:

- **Expression level.** Poison the node with `ErrorType`; every rule short-circuits on it. (Already covered.)
- **Statement level.** A statement with an unrecoverable error is *skipped* — analyze the next statement with the scope state unchanged. A malformed `let x =` (no initializer) still inserts `x` with `ErrorType` so later uses resolve.
- **Declaration level.** A function whose signature is malformed still gets inserted with a best-effort signature (parameters typed `ErrorType`), so calls elsewhere don't cascade. A type referencing an undefined type resolves to `ErrorType`, and *fields of that type* still get checked.

The unifying principle is **salvage**: at every failure, substitute the most plausible value (`ErrorType`, a synthetic symbol, a recovered signature) so that *subsequent* analysis proceeds and finds *independent* errors, while the poison sentinel keeps *dependent* errors silent. The metric of a good recovery strategy: error count tracks the number of *independent* mistakes, not the depth of the AST.

### 9. The output contract: a fully decorated, validated AST

After all passes, the AST is decorated: every `Name` has a binding, every expression a type, every `match` a verified-exhaustive flag, every block a "returns-on-all-paths" bit. Equally important is the *contract* the front end gives the back end: **if there were no errors, every invariant codegen relies on holds** — names resolve, types are consistent, control flow is well-formed. Codegen then never needs to handle "what if undefined" — it trusts the front end. (If there *were* errors, the front end typically stops before codegen; the decorated-but-poisoned AST exists only to maximize diagnostics, not to be compiled.)

---

## Real-World Analogies

| Analogy | Maps to |
|---|---|
| A spreadsheet: some cells compute from cells above (synthesized), some take a target from the header (inherited) | Synthesized vs. inherited attributes |
| An assembly line where each station assumes the previous finished its job | Phase ordering with preconditions |
| A road map asking "can you reach this town from the capital?" | Reachability on the CFG |
| "Was the parcel signed for at every checkpoint on the route?" | Definite assignment (must, intersect over paths) |
| A checklist that must cover every species in the zoo, or it's incomplete | Exhaustiveness over a sum type |
| A triage nurse who treats every distinct patient, not the same one ten times | Error recovery: independent errors, no cascades |
| A "fill in the missing value with a sensible default" form field | Salvage during recovery |

---

## Mental Models

**Model 1 — "Up is what you are; down is what's expected."** Synthesized attributes flow *up* and describe what a node *is* (its type, whether it returns). Inherited attributes flow *down* and describe what the context *expects* (expected type, return type, in-loop). Every semantic rule is a relationship between these two flows. Bidirectional type checking is just both arrows at one node.

**Model 2 — "Passes are functions with contracts."** Treat each pass as `f: AST_with_invariant_k -> AST_with_invariant_{k+1}`. Write down each pass's precondition and postcondition. Bugs cluster where a pass assumes an invariant the previous pass didn't actually guarantee. Phase ordering is just topologically sorting these contracts.

**Model 3 — "Scoping is local; flow is global."** If a check can be answered by "what's visible here," it's a scoping/typing check and lives in the recursive walk. If it needs "what happened on the paths that got here," it's a dataflow check and lives on the CFG. Definite assignment, reachability, and "missing return" are the global ones; name resolution and arity are the local ones.

**Model 4 — "Recovery is salvage, not suppression."** Don't *suppress* errors after the first; *salvage* the broken node with a plausible substitute so analysis continues and finds *new, independent* errors, while the sentinel keeps *dependent* errors quiet. The target: one diagnostic per real mistake.

---

## Code Examples

### Example 1: Inherited "expected type" — bidirectional checking

```python
def check(node, expected):           # `expected` is an INHERITED attribute (down)
    if node.kind == "ArrayLit":
        if expected and expected.is_list():
            elem = expected.elem
            for e in node.elements:
                check(e, elem)        # push element type DOWN
            node.type = expected      # adopt the expected type
            return node.type
        # no expectation: synthesize from elements, or error if empty
        if not node.elements:
            error("cannot infer type of empty array", node.span)
            node.type = ERROR; return ERROR
        t = synth(node.elements[0])
        for e in node.elements[1:]:
            if not assignable(synth(e), t):
                error("array elements have differing types", e.span)
        node.type = List(t); return node.type
    # ... other forms fall back to synth() ...

def synth(node):                      # SYNTHESIZED type (up), no expectation
    return check(node, expected=None)
```

`let xs: List<int> = []` calls `check([], List<int>)`: the inherited `List<int>` supplies the element type that synthesis alone couldn't produce. This is the inherited/synthesized split made concrete.

### Example 2: A pass pipeline with explicit contracts

```python
def analyze(program):
    diags = Diagnostics()
    table = SymbolTable()

    collect_declarations(program, table, diags)   # post: top-level names present
    resolve_type_refs(program, table, diags)      # pre: names present; post: types resolved
    resolve_names(program, table, diags)          # pre: types resolved; post: bindings set
    type_check(program, diags)                     # pre: bindings set; post: every expr typed
    control_flow_checks(program, diags)            # pre: typed; checks DA, reachability, match
    return diags  # if empty, the AST is a valid, decorated input for codegen
```

Each function asserts its precondition (e.g., `type_check` asserts every `Name` has a binding) so a contract violation fails loudly during development instead of producing a mysterious crash three passes later.

### Example 3: Definite assignment as forward dataflow

```python
# Forward MUST analysis: fact = set of locals assigned on EVERY path to a point.

def definite_assignment(cfg, diags):
    IN  = {b: set() for b in cfg.blocks}
    OUT = {b: set() for b in cfg.blocks}
    IN[cfg.entry] = set()

    changed = True
    while changed:                                # iterate to fixpoint (handles loops)
        changed = False
        for b in cfg.blocks_in_rpo():             # reverse postorder converges fast
            preds = cfg.predecessors(b)
            new_in = (set.intersection(*[OUT[p] for p in preds])  # MUST = intersect
                      if preds else set())
            new_out = transfer(b, new_in, diags)  # add assignments; check reads
            if new_in != IN[b] or new_out != OUT[b]:
                IN[b], OUT[b] = new_in, new_out
                changed = True

def transfer(block, assigned_in, diags):
    assigned = set(assigned_in)
    for stmt in block.stmts:
        for use in reads_of(stmt):
            if use.local and use.name not in assigned:
                diags.error(f"variable '{use.name}' may not be assigned", use.span)
        if stmt.kind == "Assign" and stmt.target.is_local:
            assigned.add(stmt.target.name)
    return assigned
```

The intersection at merges is the "must on every path" rule; the fixpoint loop is what lets it handle loops correctly (a `break` out of a loop and a back-edge into it both contribute edges). The middle-level single-`if` version is this with one merge and no iteration.

### Example 4: Reachability and the "missing return" check (Go-flavored)

```go
// A block "completes normally" if control can flow off its end.
// A value-returning function is well-formed iff its body does NOT complete normally.

func completesNormally(s Stmt) bool {
    switch s := s.(type) {
    case *Return, *Break, *Continue, *Throw:
        return false                       // these transfer control away
    case *Block:
        for i, inner := range s.Stmts {
            if !completesNormally(inner) {
                if i < len(s.Stmts)-1 {
                    diag(s.Stmts[i+1].Span(), "warning", "unreachable code")
                }
                return false               // a non-completing stmt ends the block
            }
        }
        return true
    case *If:
        if s.Else == nil {
            return true                    // no else: the false path completes
        }
        return completesNormally(s.Then) || completesNormally(s.Else)
    case *Infinite: // for {}  with no break
        return false
    default:
        return true
    }
}

func checkReturns(fn *Func) {
    if fn.ReturnType != Void && completesNormally(fn.Body) {
        diag(fn.Body.CloseBrace, "error", "missing return")
    }
}
```

`completesNormally` is a synthesized attribute over statements, and "missing return" falls straight out of it: a non-void function whose body *can* complete normally has a path with no `return`.

### Example 5: Exhaustiveness via usefulness, simplified

```python
# Sum type `T` has a known finite set of constructors.
# A match is exhaustive iff a wildcard arm AFTER the user's arms would be USELESS
# (i.e., the user's patterns already cover everything).

def missing_cases(scrutinee_type, arms):
    if scrutinee_type.is_enum():
        all_ctors = set(scrutinee_type.constructors)        # e.g. {Circle,Square,Triangle}
        covered = set()
        for arm in arms:
            if arm.pattern.is_wildcard():
                return set()                                 # wildcard covers the rest
            covered.add(arm.pattern.constructor)
        return all_ctors - covered                           # uncovered = a witness set
    if scrutinee_type.is_bool():
        needed = {True, False}
        return needed - {a.pattern.value for a in arms if a.pattern.is_literal()}
    # for open/infinite types (int, string) a wildcard is REQUIRED
    if not any(a.pattern.is_wildcard() for a in arms):
        return {"_"}    # needs a default
    return set()

def check_match(node):
    missing = missing_cases(node.scrutinee.type, node.arms)
    if missing:
        node.exhaustive = False
        error(f"non-exhaustive match; missing: {sorted(missing)}", node.span)
    else:
        node.exhaustive = True
    # also flag arms that can never match (useless), omitted for brevity
```

The real algorithm (Maranget) handles nested patterns, ranges, and guards via matrix specialization, but the principle is identical: compute what's left uncovered, and if nonempty, that set *is* the diagnostic's witness. The synthesized `node.exhaustive` flag is what later phases (and the safety guarantee "adding a variant breaks the build") rely on.

### Example 6: Statement- and declaration-level recovery

```python
def analyze_decl(decl, table, diags):
    if decl.kind == "Func":
        # Salvage a signature even if a parameter type is undefined,
        # so CALLS to this function elsewhere don't cascade.
        params = []
        for p in decl.params:
            ty = resolve_type(p.type_ann, table, diags)   # may report + return ERROR
            params.append(ty)                              # ERROR is a fine placeholder
        ret = resolve_type(decl.ret_ann, table, diags) if decl.ret_ann else VOID
        table.insert(Symbol(decl.name, "func", FuncType(params, ret), decl.span))
        # Body errors are INDEPENDENT of signature errors; check the body regardless.
        try:
            check_body(decl.body, FuncType(params, ret), table, diags)
        except UnrecoverableStmt:
            pass   # skip the rest of the body; we already inserted the signature

def analyze_block(block, table, diags):
    for stmt in block.stmts:
        try:
            analyze_stmt(stmt, table, diags)
        except UnrecoverableStmt as e:
            diags.error(e.message, e.span)
            # SKIP this statement, keep the scope, continue with the next one
            continue
```

The design rule: a failure in one declaration or statement must not prevent analysis of the *independent* ones. Salvage the broken piece, keep the scope consistent, move on.

---

## Pros & Cons

| Aspect | Pros | Cons |
|---|---|---|
| Attribute-grammar framing | Clarifies which info flows which way; guides pass count | Pure attribute-grammar tooling is rarely used in production |
| Bidirectional checking | Local inference without global unification; great diagnostics | Two judgments to keep consistent; subtle around generics |
| Explicit multi-pass pipeline | Each pass small, testable, with assertable contracts | More code; must keep partial state coherent between passes |
| CFG-based checks | Correctly handle loops, early returns, breaks | Building/maintaining a CFG is real engineering |
| Exhaustiveness checking | Turns "added a variant" into a compile error; huge safety win | The full usefulness algorithm is intricate (nested patterns, guards) |
| Three-level recovery | Error count tracks real mistakes; no crashes | Salvage logic is easy to get subtly wrong (over/under-reporting) |

---

## Use Cases

- **A production-grade front end** for a statically typed language: pipeline of passes, CFG-based flow checks, exhaustiveness, robust recovery.
- **A type checker for a dynamic language** (gradual typing: TypeScript, Sorbet, mypy): bidirectional checking shines where annotations are partial.
- **A linter that reasons about control flow**: unreachable code, definitely-null dereferences, missing return.
- **A safe-by-construction DSL**: exhaustiveness over the DSL's variants prevents whole classes of "forgot a case" bugs.
- **An IDE service**: the same multi-pass, recovery-tolerant analyzer powers error squiggles and quick-fixes on every keystroke, where recovery quality directly shapes the user experience.

---

## Coding Patterns

- **Attribute threading.** Pass inherited attributes (expected type, return type, in-loop, symbol table) *down* as parameters or a context object; return synthesized attributes (type, completes-normally) *up*.
- **Check vs. synthesize split.** Two entry points: `check(node, expected)` and `synth(node)`. Literals, lambdas, and empty collections route to `check`; variables and applications to `synth`.
- **Pass contracts as assertions.** Each pass asserts its precondition at entry. Cheap; catches phase-ordering bugs immediately.
- **CFG once, many analyses.** Build the CFG a single time; run definite assignment, reachability, and any other flow check over the same graph.
- **Fixpoint with reverse postorder.** Iterate dataflow over blocks in RPO for fast convergence; loop until no set changes.
- **Witness-producing checks.** When a check fails, produce a concrete counterexample (an uncovered pattern, an unassigned-on-this-path variable) for the diagnostic, not just a boolean.
- **Salvage at every failure.** On any error, substitute a plausible value (`ErrorType`, recovered signature, synthetic symbol) and continue.

---

## Clean Code

- **One pass, one file/function, one contract.** Resist merging passes "for speed." Each pass should be readable in isolation with its pre/postcondition documented at the top.
- **Make the CFG a first-class structure,** not implicit in the recursion. Flow checks are far clearer as explicit graph algorithms than as ad-hoc flags threaded through a tree walk.
- **Separate "report" from "decide."** A check function decides (returns the missing cases, the unassigned reads); a thin layer turns decisions into diagnostics. This keeps checks unit-testable without a diagnostics sink.
- **Inherited attributes are explicit parameters, not globals.** Threading `expected` and `return_type` as parameters keeps each node's rule self-contained and reentrant.
- **Name the recovery substitutions.** `ErrorType`, `RECOVERED_SIGNATURE`, `SYNTHETIC_SYMBOL` — distinct, greppable sentinels make the recovery strategy auditable.
- **Witnesses in messages.** "non-exhaustive; missing `Triangle`" beats "non-exhaustive match." The witness you already computed *is* the better message.

---

## Best Practices

| Practice | Why |
|---|---|
| Frame the design in synthesized/inherited terms before coding | Tells you how many passes and which direction info flows |
| Use bidirectional checking for local inference | Handles empty literals, lambdas, generics without global unification |
| Order passes by dependency and assert preconditions | Prevents "works until a feature is added" phase-ordering bugs |
| Do flow checks on a CFG, not via tree-walk flags | Correctly handles loops, breaks, early returns, throws |
| Iterate dataflow to a fixpoint in reverse postorder | Correct for loops; converges quickly |
| Compute and report witnesses (uncovered case, unassigned path) | Turns vague errors into actionable ones |
| Recover at expression, statement, AND declaration level | Error count tracks real mistakes, not AST depth |
| Salvage with plausible substitutes; never throw past one error | Maximizes independent diagnostics; never crashes |
| Stop before codegen if any error occurred | The poisoned AST is for diagnostics, not compilation |
| Make exhaustiveness an error, not a warning, for sealed types | Adding a variant should break every unhandled match |

---

## Edge Cases & Pitfalls

- **Mutually recursive declarations.** `A` references `B` and `B` references `A`. A single pass fails on whichever comes first. Collect *all* signatures (pass 1) before checking any body (pass 4).
- **Definite assignment across loops.** A naive single pass mishandles a variable assigned inside a loop body but read after. You need the fixpoint with the back-edge contributing to the loop head's in-set.
- **`break`/`continue`/`throw` edges in the CFG.** Forgetting these makes reachability and definite assignment wrong: code after a `throw` is unreachable; a `break` skips the rest of the loop body.
- **Exhaustiveness with guards.** `Some(x) if x > 0 =>` does *not* cover all `Some`, because the guard can fail. A guarded arm cannot make a match exhaustive on its own.
- **Inherited type from a poisoned context.** If the expected type is `ErrorType`, *checking* against it must succeed silently (don't report a mismatch against a type that's already an error).
- **Reachability vs. "obviously infinite" loops.** `while (true) {}` makes the following code unreachable, but `while (cond) {}` does not — even if `cond` is always true at runtime; the checker reasons syntactically, not about runtime values.
- **Over-recovery.** Salvaging too aggressively (e.g., inventing a type for *every* failure) can suppress *real, independent* errors. Salvage only the broken node; let independent code report its own problems.
- **Pass that mutates state a later pass re-reads.** If pass 3 mutates a symbol's type and pass 4 assumes the original, you get heisenbugs. Keep pass outputs additive (decorate) where possible.

---

## Common Mistakes

1. Doing everything in one pass and then failing the first time a feature needs forward references or mutual recursion.
2. Implementing flow checks (definite assignment, reachability) with ad-hoc boolean flags on a tree walk instead of a CFG, then getting loops and early returns wrong.
3. Forgetting `break`/`continue`/`throw`/`return` edges, so dead code and unassigned-variable checks misfire.
4. Treating type checking as purely synthesized, then being unable to type empty literals, lambdas, or generic calls.
5. Letting an `ErrorType` *expected* type produce a spurious mismatch diagnostic.
6. Bailing out of analysis on the first error (no statement/declaration recovery), so users fix-and-recompile repeatedly.
7. Over-recovering and hiding real, independent errors behind aggressive salvage.
8. Computing exhaustiveness but ignoring guards, wrongly accepting a guarded match as total.
9. Not producing a witness, so "non-exhaustive match" leaves the user guessing which case is missing.
10. Skipping the precondition asserts between passes, so phase-ordering bugs surface as distant, confusing crashes.

---

## Tricky Points

- **L-attributed is the sweet spot.** Most real checkers are L-attributed (inherited attributes depend only on parent and left siblings), which is exactly why a single left-to-right depth-first walk handles both the symbol table (inherited) and types (synthesized) — *except* for forward references, which break left-to-right dependency and force the extra collect pass.
- **"Must" vs. "may" decides the merge operator.** Definite assignment is a *must* analysis (intersect at merges). A *may* analysis (e.g., "this variable might be null") *unions* at merges. Picking the wrong lattice/merge silently inverts the check.
- **A non-void function is valid iff its body cannot complete normally — that's reachability, not a return-count.** "Has at least one return" is neither necessary (an infinite loop needs none) nor sufficient (a return in only one branch isn't enough).
- **Exhaustiveness is what makes sum types safe to extend.** The compile error on `match` after adding a variant is the *entire point* of sealed/enum types for evolution. Demoting it to a warning quietly removes that guarantee.
- **Recovery quality is a UX property, not a correctness one.** A checker that's correct but bails on the first error is *correct and unusable*. In IDEs, recovery quality dominates perceived quality.
- **Bidirectional checking blurs "infer" and "check."** Whether a node infers or is checked depends on context, not on the node kind alone — the same lambda synthesizes in one position and is checked in another.

---

## Test Yourself

1. Classify each as synthesized or inherited: the type of `a + b`; the expected type of a function argument; "does this block return on all paths"; the symbol table in scope; the current function's return type.
2. Why is definite assignment a *forward must* analysis, and what is the merge operator at an `if`/`else` join? How does that change for "variable may be null"?
3. Give a function body that has *no* explicit `return` yet correctly type-checks as a non-void function. What property of the body makes it valid?
4. Why do mutually recursive types force a multi-pass design? Which passes, in what order?
5. Explain how exhaustiveness checking turns "added a new enum variant" into a compile-time forcing function, and why guards can't contribute to exhaustiveness.
6. Define the three granularities of error recovery and give a concrete salvage substitute for each.
7. Show a 4-line program where "has at least one `return`" wrongly accepts a non-void function that can fall off the end.

<details>
<summary>Answers</summary>

1. `a+b` type: synthesized. Argument's expected type: inherited. "Returns on all paths": synthesized. Symbol table in scope: inherited. Current return type: inherited.
2. It's forward (facts flow entry→exit, following control flow) and *must* (a variable counts as assigned only if assigned on *every* path), so the merge is **intersection**. "May be null" is a *may* analysis: the merge is **union** (null if null on *any* path).
3. A body ending in `while (true) { ... }` with no `break`, or one whose every branch `return`s/`throw`s. It's valid because it *cannot complete normally* — control never falls off the end.
4. `A` mentions `B` and vice versa; whichever is checked first references an undefined name. Pass 1 collects *both* type names/signatures; pass 2/3 then resolve references; pass 4 checks bodies. Collect-before-check breaks the cycle.
5. Sealed/enum matches must be exhaustive; adding a variant makes every match that lacked a wildcard non-exhaustive → compile error → you must handle it. Guards can fail at runtime, so a guarded arm doesn't guarantee its constructor is covered; it can't make a match total.
6. Expression: poison with `ErrorType`. Statement: skip the statement but keep scope; for `let x =` with a bad initializer, insert `x` as `ErrorType`. Declaration: insert a recovered signature (params/ret as `ErrorType`) so external calls don't cascade.
7. `int f(boolean c) { if (c) return 1; }` — has a `return`, but the `c == false` path falls off the end. "Has a return" accepts it; the correct reachability check ("body must not complete normally") rejects it.

</details>

---

## Tricky Questions

**Q1.** A reviewer asks why your checker needs five passes when a tree-walking interpreter resolves names in one. What's the principled answer?
**A.** The interpreter only needs *left-to-right, already-defined* names (it can even resolve at runtime). A static checker must support forward references and mutual recursion (signatures used before they're textually defined) and run flow analyses (definite assignment, reachability) that depend on a complete, typed AST. Those dependencies are not L-attributed, so they cannot all be computed in one left-to-right pass; the pass split is the dependency graph made explicit.

**Q2.** Definite assignment passes on x86 builds of your test but a colleague's port reports a false "may be unassigned." Could the architecture matter?
**A.** No — definite assignment is a static, machine-independent analysis over the CFG. A discrepancy means the *CFG construction* differs (e.g., one build models a `throw` or `break` edge the other doesn't), or the fixpoint iteration order/termination differs. The bug is in the analysis or CFG, not the target.

**Q3.** Why is exhaustiveness computed by an algorithm about *usefulness* rather than just "count the constructors"?
**A.** Counting works only for flat enums. Real patterns nest (`Some(Ok(x))`), include literals, ranges, tuples, and guards. Usefulness (Maranget) generalizes "is anything left uncovered?" to arbitrary pattern matrices by specialization, and it simultaneously detects unreachable (useless) arms — one algorithm for both.

**Q4.** Your match-exhaustiveness check accepts `match x { Some(v) if v > 0 => ..., None => ... }` as total. Bug?
**A.** Yes. The `Some` arm has a guard that can fail, so values like `Some(-1)` are unmatched. A guarded arm cannot establish that its constructor is fully covered; the match is non-exhaustive and should report `Some(_)` (with the guard false) as the witness.

**Q5.** After one undefined-type error in a struct's first field, your compiler emits twenty errors about every other field. What recovery layer is missing?
**A.** Declaration-level salvage. Resolve the undefined field type to `ErrorType` and keep checking the *other*, independent fields. With the sentinel suppressing dependent errors and salvage allowing independent ones, the count drops to one real error (the undefined type) plus any genuinely separate field problems.

**Q6.** You move reachability before type checking to "fail fast on dead code." What breaks?
**A.** Reachability for constructs like `while (true)` or pattern matches may depend on resolved types (e.g., whether a called function is `noreturn`, or whether a match is exhaustive and thus has no fall-through). Running it before typing violates its precondition. Flow checks belong *after* names and types are resolved.

---

## Cheat Sheet

```text
SEMANTIC ANALYSIS — SENIOR

ATTRIBUTE GRAMMARS
  synthesized = up   (what a node IS: its type, "returns on all paths")
  inherited   = down (what's EXPECTED: expected type, return type, in-loop, table)
  S-attributed -> 1 bottom-up pass ; L-attributed -> 1 L->R DFS pass
  forward refs / mutual recursion -> break L-attributed -> EXTRA collect pass

BIDIRECTIONAL CHECKING
  synth(e) => T        (variables, applications, annotated)
  check(e, T)          (literals, lambdas, empty collections, generic calls)

PASS PIPELINE (each: precondition -> postcondition)
  parse -> collect decls -> resolve type refs -> resolve names
        -> type-check -> control-flow checks -> lower
  collect-before-check breaks mutual-recursion cycles

CONTROL FLOW (needs a CFG, not tree flags)
  definite assignment : FORWARD MUST ; merge = INTERSECT ; fixpoint for loops
  reachability        : statements after return/break/throw/while(true) = dead
  missing return      : non-void body must NOT "complete normally"
  may-be-null         : FORWARD MAY ; merge = UNION

EXHAUSTIVENESS
  usefulness algorithm: is a trailing wildcard still useful? -> missing cases
  produce a WITNESS (the uncovered pattern) for the message
  guards do NOT contribute to coverage
  sealed/enum -> make it an ERROR (adding a variant must break the build)

ERROR RECOVERY (3 levels) = SALVAGE, not suppress
  expression : ErrorType sentinel, short-circuit every rule
  statement  : skip stmt, keep scope; bad `let x=` -> x : ErrorType
  declaration: recovered signature (params/ret = ErrorType)
  GOAL: error count == # of INDEPENDENT mistakes ; never crash
```

---

## Summary

- Semantic analysis is, formally, **attribute-grammar evaluation**: **synthesized** attributes flow *up* (a node's type, "returns on all paths"); **inherited** attributes flow *down* (expected type, return type, in-loop, symbol table). The flow structure tells you how many passes you need.
- **Bidirectional type checking** combines *synthesis* (infer up) and *checking* (verify against an expected type pushed down), giving local inference for empty literals, lambdas, and generics without global unification.
- A real front end is a **pipeline of passes**, each with a precondition and postcondition; correct **phase ordering** (collect signatures before checking bodies) is what makes forward references and mutual recursion work.
- Some checks are **global** and live on a **control-flow graph**: **definite assignment** (forward *must*, intersect at merges, fixpoint for loops), **reachability** / dead code, and the **"missing return"** check (a non-void body must not *complete normally*).
- **Exhaustiveness** of `match`/`switch` is computed by a *usefulness* algorithm that yields a concrete **witness**; making it an error turns "added a variant" into a compile-time forcing function. Guards never contribute to coverage.
- **Error recovery** works at three granularities — expression (`ErrorType`), statement (skip-but-keep-scope), declaration (recovered signature) — and is fundamentally **salvage**: substitute a plausible value so analysis finds *independent* errors while the sentinel suppresses *dependent* ones. The target is one diagnostic per real mistake, and never a crash.
- The output is a **fully decorated, validated AST**, and the contract to the back end is that — absent errors — every invariant codegen relies on already holds.

---

## What You Can Build

- **A multi-pass front end** with explicit pass contracts: collect declarations, resolve type references, resolve names, type-check, run flow checks, lower.
- **A bidirectional type checker** with `synth`/`check` judgments that types empty literals, lambdas, and generic calls against expected types.
- **A CFG builder** from the AST (with `break`/`continue`/`return`/`throw` edges) and a **dataflow engine** that runs definite assignment and reachability as fixpoint analyses.
- **A "missing return" / unreachable-code checker** built on a `completesNormally` synthesized attribute.
- **An exhaustiveness checker** for a small ADT language that reports the missing pattern as a witness and flags unreachable arms.
- **A three-level recovery harness** whose diagnostic count, on a corpus of buggy programs, tracks the number of independent mistakes rather than AST depth.

---

## Further Reading

- *Compilers: Principles, Techniques, and Tools* (the Dragon Book) — Aho, Lam, Sethi, Ullman. The syntax-directed-translation chapter is the canonical treatment of synthesized/inherited attributes, S- and L-attributed grammars.
- *Engineering a Compiler* — Cooper & Torczon. Strong chapters on attribute grammars, context-sensitive analysis, and dataflow.
- Luca Cardelli — *Type Systems* (handbook chapter). The reference framing of checking vs. inference.
- Benjamin Pierce — *Types and Programming Languages*. The bidirectional-checking and algorithmic-typing material.
- Luc Maranget — *Warnings for Pattern Matching* (JFP 2007). The usefulness/exhaustiveness algorithm used by OCaml, Rust, and others.
- *The Java Language Specification*, chapters on Definite Assignment and Unreachable Statements — precise, real-world specifications of flow-based checks.
- *Modern Compiler Implementation* — Appel. Semantic analysis, dataflow, and liveness.

---

## Related Topics

- The previous phase, **parsing**, supplies the AST with source spans that every pass here decorates.
- The deeper theory of types — inference, subtyping, soundness, polymorphism — lives in the **type-systems** material; this page applies its *checking* side.
- **Control-flow and dataflow analysis** underlie definite assignment, reachability, and exhaustiveness, and recur in optimization.
- The next phase, **intermediate-representation generation**, consumes the validated, decorated AST produced here.
- **Static analyzers and linters** reuse this same machinery (CFG, dataflow, exhaustiveness) without code generation.

---

## Diagrams & Visual Aids

### Synthesized up, inherited down

```text
                 let xs : List<int> = [ ]
                          │ inherited       │ inherited expected = List<int>
                          │ (annotation)    ▼
                          │           (ArrayLit)
                          │            elem expected = int  (pushed down)
                          ▼            synthesized type = List<int>  (flows up)
                  binding xs : List<int>
       DOWN: expected type, return type, symbol table, in-loop
       UP:   actual type, "completes normally", "exhaustive"
```

### The pass pipeline and its dependencies

```text
parse ─► collect decls ─► resolve type refs ─► resolve names ─► type-check
                                                                     │
                                          control-flow checks ◄──────┘
                                          (definite assign,
                                           reachability,
                                           exhaustiveness)
                                                  │
                                                  ▼
                                          lower / decorate ─► IR generation

each arrow = "postcondition of left  IS  precondition of right"
```

### Definite assignment over a CFG (forward MUST, intersect at merge)

```text
        B0: int x;            assigned={}
       /            \
   B1: x = 1      B2: (skip)   assigned={x}      assigned={}
       \            /
        B3: use(x)             IN = OUT(B1) ∩ OUT(B2) = {x} ∩ {} = {}
                               read of x not in {} -> ERROR
```

### Reachability / "completes normally"

```text
  fn f() -> int {
      if c { return 1; }   then: does NOT complete normally
      // no else            implicit else: COMPLETES normally
  }                         body completes normally  ->  MISSING RETURN

  fn g() -> int {
      while true { ... }    no break  ->  does NOT complete normally
  }                         body cannot fall off the end  ->  OK (no return needed)
```

### Exhaustiveness witness

```text
  enum Shape { Circle, Square, Triangle }
  match s {
      Circle => ..., Square => ...,
  }
  covered = {Circle, Square}
  all     = {Circle, Square, Triangle}
  missing = all - covered = {Triangle}   <- WITNESS in the diagnostic
  -> error: non-exhaustive match; missing: `Triangle`
```

### Recovery: error count tracks independent mistakes

```text
   undefined `zog` in  a + (b * zog) + c
        zog            -> ErrorType        [1 reported]
        b * zog        -> ErrorType        [silent: dependent]
        a + (...)      -> ErrorType        [silent: dependent]
        (...) + c      -> ErrorType        [silent: dependent]
   meanwhile an UNRELATED `int x = "hi"` two lines down -> [1 reported]
   total = 2 = number of INDEPENDENT mistakes, not AST depth
```
