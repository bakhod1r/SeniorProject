# Semantic Analysis — Professional Level

> **Topic:** [Semantic Analysis](README.md)
> **Focus:** Borrow checking, overload/trait resolution, generics, module/import resolution, query-driven incremental analysis, and the contract handed to the back end.

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

> Focus: **The semantic checks that production languages actually ship — and the architecture that makes them fast, incremental, and trustworthy.**

The senior level made the front end a disciplined pipeline: attribute flows, multi-pass ordering, CFG-based flow checks, exhaustiveness, and salvage-based recovery. That architecture is the skeleton of every serious compiler. The professional level fleshes it out with the checks that define *modern* languages — the ones that are genuinely hard, genuinely valuable, and genuinely the source of most of a compiler team's engineering time.

Four bodies of work dominate. First, **resolution that disambiguates, not just looks up**: overload resolution (Java, C++, Swift) and trait/typeclass method resolution (Rust, Haskell, Go interfaces) where a single name `print` or `+` could mean many different declarations and semantic analysis must pick *the* one, by argument types, by specificity, by coherence rules — often interleaved with type inference rather than after it. Second, **generics**: typing a body once but checking every instantiation, enforcing bounds, handling variance, and deciding between monomorphization and a uniform representation. Third, **ownership and borrow checking as semantic analysis** — Rust's flagship contribution, where the type checker also proves a memory-safety property (no aliasing-plus-mutation, no use-after-move, no dangling reference) via a flow-sensitive analysis over lifetimes/regions. Fourth, **module and import resolution**: name resolution across compilation units, with visibility/access control, re-exports, glob imports, cyclic-import handling, and the separate-compilation contract.

Underpinning all of it is an architectural shift the modern era forced: **incrementality**. A batch pipeline recomputes everything on every build; an IDE must re-analyze on every keystroke. The answer the industry converged on is **query-driven, demand-based analysis with memoized results** (Rust's `rustc` queries + Salsa, Roslyn's red-green trees, Swift's request-evaluator). Semantic analysis stops being "run these passes in order" and becomes "answer the question `type_of(node)`, memoizing and invalidating as the source changes."

This page also closes the loop the whole topic has been building toward: precisely what semantic analysis *hands to* code generation — the decorated AST or typed IR, the binding and type information codegen relies on, the lowering decisions (where monomorphization happens, how method dispatch is resolved to a concrete target) made here so the back end can be dumb and fast.

---

## Prerequisites

Before reading this page you should be comfortable with:

- All senior-level material: synthesized/inherited attributes, multi-pass pipelines with contracts, bidirectional checking, CFG/dataflow (definite assignment, reachability), exhaustiveness, and three-level error recovery.
- Subtyping and variance at a working level (covariance, contravariance, invariance) and what a type parameter with a bound is.
- The vocabulary of ownership/lifetimes at the user level — enough to have written or read Rust references, even if you've never built a checker for them.
- Module systems in at least one language (Java packages, Rust crates/modules, Go packages, ML modules) including visibility modifiers.
- Reading code in Rust, Java, Haskell, Go, and C++ at the level used in the examples.

You do **not** need:

- The full inference theory (unification, constraint solving, higher-rank/dependent types). That is the type-systems material; here we focus on how *checking and resolution* integrate it.
- The internals of any specific compiler, though `rustc`, `roslyn`, `swiftc`, and GHC are referenced as exemplars.
- Back-end/codegen detail beyond the handoff contract this page defines.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Overload resolution** | Choosing one declaration among several with the same name, by argument types/specificity. |
| **Trait / typeclass resolution** | Finding the implementation of an interface method for a concrete type (Rust traits, Haskell classes, Go interfaces). |
| **Coherence** | The guarantee that there is at most one chosen implementation for a given type/trait pair, globally. |
| **Candidate set** | The implementations/overloads in scope that could apply before disambiguation. |
| **Specificity / best match** | The ranking used to pick one candidate when several apply. |
| **Monomorphization** | Generating a separate specialized copy of a generic for each concrete type argument. |
| **Type erasure** | Compiling generics to one copy that ignores the type argument at runtime (Java, by default). |
| **Variance** | How subtyping of a parameter relates to subtyping of the constructed type (co/contra/invariant). |
| **Bound** | A constraint on a type parameter (`T: Ord`, `T extends Comparable`). |
| **Ownership** | The rule that each value has one owner; the owner's scope end frees it. |
| **Borrow** | A temporary reference: shared (`&`, many, read-only) or mutable (`&mut`, one, exclusive). |
| **Lifetime / region** | The span of code over which a reference is valid; borrow checking proves references don't outlive their referent. |
| **NLL** | Non-Lexical Lifetimes — borrow checking based on actual use ranges (a liveness/dataflow analysis), not lexical scopes. |
| **Move** | Transfer of ownership; the source becomes invalid (use-after-move is an error). |
| **Visibility / access control** | Which names a module exposes (`pub`, `public`, exported-by-capitalization in Go). |
| **Re-export** | Exposing an imported name as part of your own module's interface. |
| **Query-driven analysis** | Computing semantic facts on demand, memoized, with fine-grained invalidation. |
| **Red-green trees** | Roslyn's immutable-syntax representation enabling incremental reuse. |

---

## Core Concepts

### 1. Resolution as disambiguation, interleaved with inference

The junior/middle picture — "look the name up, get its declaration" — assumes each name has exactly one declaration. Modern languages routinely break that:

- **Overloading.** `print(int)`, `print(String)`, `print(Object)` all exist. The call `print(x)` must select one *based on the argument's type*. The algorithm collects a **candidate set** (all `print`s visible), filters to those *applicable* (each argument assignable to the corresponding parameter), then picks the **most specific** (a partial order: `print(String)` is more specific than `print(Object)` because `String <: Object`). Ambiguity (no unique best) is an error.
- **Traits / typeclasses / interfaces.** `x.area()` where `area` comes from a `Shape` trait: resolution must find the `impl Shape for Circle` (Rust), the `instance Shape Circle` (Haskell), or confirm `Circle` satisfies the `Shape` interface (Go). This is *not* a symbol-table lookup; it's a search over implementations, constrained by **coherence** (at most one impl per type/trait, enforced by orphan rules).

Crucially, resolution and type inference are **mutually dependent and often interleaved**. You can't pick the overload without the argument types; sometimes you can't fully infer an argument type without knowing which overload (and thus which expected parameter type) applies. Real compilers run a constraint-based loop: gather candidates, propagate the constraints each imposes, and converge. The clean phase separation of the senior level bends here — typing and resolution share a fixpoint.

### 2. Generics: check once, instantiate everywhere

A generic `fn max<T: Ord>(a: T, b: T) -> T` is type-checked **once**, against the *bound* `T: Ord` (the body may only use operations the bound guarantees — here, comparison). Then each *use site* `max(3, 4)` or `max("a", "b")` is checked by **instantiation**: substitute the concrete type for `T` and verify it satisfies the bound (`int: Ord`, `String: Ord`). Two semantic obligations:

- **Bound satisfaction at the use site.** `max(Point, Point)` errors if `Point` isn't `Ord`. The error is reported at the *call*, but it references the *declaration's* bound.
- **Variance.** Given `List<T>`, is `List<Cat> <: List<Animal>`? Depends on how `T` is used. If only produced (read), covariant; if only consumed (written), contravariant; if both, invariant. Getting variance wrong is a *soundness* hole (the classic Java array-covariance `ArrayStoreException`).

The *representation* decision — **monomorphization** (Rust, C++ templates: one specialized copy per type, fast but code-bloating) vs. **erasure** (Java: one copy, type arguments forgotten at runtime, small but limited) vs. **dictionary passing** (Haskell, Swift: pass the trait/witness as a hidden argument) — is partly a semantic-analysis decision because it determines what information the typed AST must carry into codegen.

### 3. Borrow checking is semantic analysis

Rust's borrow checker is the clearest demonstration that "semantic analysis" extends well past names and types into proving *safety properties*. After type checking, the borrow checker proves three things, all flow-sensitively over the CFG:

1. **No use-after-move.** Once a value is moved out of a variable, the source is invalid; reading it is an error. This is a *forward* analysis tracking which paths leave a place moved.
2. **Aliasing XOR mutation.** At any point, a place may have *many* shared borrows (`&`) *or* exactly *one* mutable borrow (`&mut`), never both. Overlapping conflicting borrows are an error.
3. **No dangling references.** A reference must not outlive the data it points to. This is the **lifetime/region** constraint: the borrow's region must be contained in the referent's.

Modern Rust uses **Non-Lexical Lifetimes (NLL)**: a borrow lives only over the program region where the reference is *actually used* (a liveness dataflow analysis), not until the end of its lexical scope. This is why code that the old lexical checker rejected now compiles — the borrow "ends" at its last use. Borrow checking is thus a *family of dataflow analyses* layered on the typed AST/MIR, and it's the senior-level CFG/dataflow machinery turned up to a memory-safety proof.

### 4. Access control and visibility

Name resolution across module boundaries must also enforce **visibility**: a name may be *resolvable* (it exists) yet *inaccessible* (private). The check has two parts — does the name exist in the target module, and is the referencing site permitted to see it? Languages encode visibility differently: Rust `pub`/`pub(crate)`, Java `public`/`protected`/`package`/`private`, C++ `public`/`protected`/`private` plus `friend`, Go's capitalization rule (exported iff the identifier starts uppercase). Subtleties: a `protected` member is accessible from subclasses but not arbitrary code; a `pub` field of a `pub(crate)` struct is only as visible as the struct; re-exports (`pub use`) can widen visibility deliberately. Access control runs *after* resolution finds the candidate and *before* (or alongside) type checking uses it.

### 5. Module / import resolution and separate compilation

Resolving names *across files* adds machinery beyond a single scope tree:

- **Import resolution.** `use foo::bar` / `import x.y.Z` / `from m import n` maps an external path to a symbol in another module's table. Glob imports (`use foo::*`) bring in many names and create **ambiguity** rules (a glob-imported name loses to an explicit local one).
- **Cyclic imports.** Module `A` imports `B` and `B` imports `A`. Languages handle this differently: some forbid it (Go errors on import cycles), some allow it with care (Python via deferred binding, Java freely since classes are resolved lazily). The resolver must detect cycles and either break them (two-phase: declare all module interfaces, then resolve bodies — the same collect-then-check pattern, now across modules) or report them.
- **Separate compilation.** Each module is analyzed against the *interfaces* (signatures) of its dependencies, not their bodies. This requires a stable **module interface artifact** (`.hi` files in GHC, `.rlib`/crate metadata in Rust, `.class` signatures in Java). Semantic analysis emits and consumes these interfaces; that's what makes incremental, parallel, and distributed builds possible.

### 6. Query-driven, incremental analysis

A batch front end recomputes the whole pipeline on each invocation — fine for `cc -c`, fatal for an editor that must respond in milliseconds per keystroke. The modern architecture inverts control: instead of *pushing* data through passes, the compiler *pulls* answers via **queries**:

```text
type_of(node) -> asks resolve(node) -> asks parse(file) -> ...
each query result is MEMOIZED ; an edit INVALIDATES only the queries whose
inputs changed, and transitively their dependents.
```

`rustc` is built on a query system (with Salsa-style incrementality in `rust-analyzer`); Roslyn uses **red-green trees** (immutable green nodes shared across edits, red nodes for position); Swift uses a request-evaluator. The semantic facts — `type_of`, `resolve`, `borrowck`, `is_exhaustive` — become memoized queries with tracked dependencies. The win: edit one function body and only that function's (and its dependents') analyses rerun. This is the single biggest architectural difference between a 1990s batch compiler and a 2020s language server, and it reshapes how every check above is structured (each must be expressible as a pure, memoizable function of its inputs).

### 7. The handoff to code generation

This is where the entire topic lands. After all analysis succeeds, semantic analysis produces the artifact codegen consumes — typically a **typed, decorated AST** or a **typed IR** in which:

- Every `Name` node has a **resolved binding** to a concrete declaration (across modules).
- Every expression has a **concrete type** — for generics, the *instantiated* type (post-monomorphization) or enough info to do erasure/dictionary passing.
- Every method/overload call is **resolved to a specific target** (the exact `impl`, the exact overload, the exact vtable slot), so codegen never re-disambiguates.
- Every coercion (widening, boxing, deref) is made **explicit** as an inserted node, so codegen doesn't infer them.
- Verified properties (exhaustiveness, definite assignment, borrow safety) are *assumed*, letting codegen omit runtime checks the front end already proved unnecessary.

The contract is the same one stated since the junior page, now precise: **codegen trusts that the front end proved validity, and the decorated artifact carries every decision codegen needs so the back end can be a mechanical lowering.** The "decorate the AST; codegen consumes the typed AST" promise is fulfilled here.

---

## Real-World Analogies

| Analogy | Maps to |
|---|---|
| A hiring committee shortlisting then ranking candidates for one role | Overload resolution: candidate set then most-specific |
| A specialty referral matched to a clinic that accepts your exact insurance | Trait resolution constrained by coherence/orphan rules |
| A blueprint reused per building lot, each verified against the lot's zoning | Generics: check once, instantiate per use under bounds |
| A library that lends a book to many readers OR one editor with the pen | Shared (`&`) vs. mutable (`&mut`) borrows: many readers XOR one writer |
| A keycard that lists which doors you may open, regardless of which exist | Access control: resolvable vs. accessible |
| A switchboard connecting calls across buildings using a directory of extensions | Cross-module import resolution |
| A spreadsheet that recomputes only the cells affected by your edit | Query-driven incremental analysis |
| A fully dimensioned, materials-listed shop drawing handed to the builder | The typed AST handed to codegen |

---

## Mental Models

**Model 1 — "Resolution is a search with a ranking, not a lookup."** Once names overload or come from traits, picking the right declaration is a filtered, ranked search (candidates → applicable → most specific) entangled with type inference. Stop thinking "map.get(name)"; think "constraint-satisfying best match."

**Model 2 — "A generic is a contract; an instantiation is a proof obligation."** The declaration's bounds are a contract the body relies on; each use site must *prove* its concrete type discharges those bounds. Errors split cleanly: body errors (violating the contract internally) at the declaration, instantiation errors (failing to meet the bound) at the use.

**Model 3 — "Borrow checking is a safety proof riding on the CFG."** It reuses the senior-level dataflow machinery (liveness, forward/backward analyses over the CFG) but the *fact* being computed is "is this access aliasing-safe / not-after-move / not-dangling?" Same engine, a memory-safety theorem as the output.

**Model 4 — "Demand, don't push."** In a modern front end, you don't run passes; you answer queries. Every check is a pure function of memoized inputs, so an edit invalidates only what truly changed. Designing checks to be query-shaped (no hidden global mutation) is what makes incrementality possible.

**Model 5 — "The typed artifact is a settled contract."** Everything ambiguous has been decided before codegen: which overload, which impl, which instantiation, which coercion. The back end inherits a world with no remaining semantic choices.

---

## Code Examples

### Example 1: Overload resolution — candidates, applicable, most specific

```python
def resolve_overload(name, arg_types, scope):
    candidates = scope.lookup_all(name)          # ALL decls with this name
    applicable = [c for c in candidates
                  if len(c.params) == len(arg_types)
                  and all(assignable(a, p) for a, p in zip(arg_types, c.params))]
    if not applicable:
        error(f"no overload of '{name}' matches ({', '.join(arg_types)})")
        return ERROR_CANDIDATE
    # "most specific": c1 beats c2 if every c1 param is assignable to the c2 param
    def more_specific(c1, c2):
        return all(assignable(p1, p2) for p1, p2 in zip(c1.params, c2.params))
    best = [c for c in applicable
            if all(more_specific(c, other) for other in applicable if other is not c)]
    if len(best) != 1:
        error(f"ambiguous call to '{name}'; candidates: {applicable}")
        return ERROR_CANDIDATE
    return best[0]
```

```text
print(String) , print(Object)   and a call print(someString)
  candidates  = both
  applicable  = both (String assignable to String AND to Object)
  most specific = print(String)   (String <: Object, so String beats Object)
```

The "most specific" partial order is where the real subtlety lives: with multiple parameters it can be a tie (one overload better on arg 1, the other on arg 2) → genuine ambiguity → error. C++, Java, and Swift each have pages of rules refining this.

### Example 2: Trait resolution with a coherence (orphan) check

```python
# A trait impl registry, keyed by (trait, type). Coherence = at most one entry.
class ImplRegistry:
    def __init__(self): self.impls = {}            # (trait, type) -> impl

    def register(self, trait, ty, impl, local_crate):
        # Orphan rule: you may only impl a trait for a type if YOU define
        # the trait OR the type. Prevents two crates adding conflicting impls.
        if not (trait.crate == local_crate or ty.crate == local_crate):
            error(f"orphan impl: neither {trait} nor {ty} is local")
            return
        key = (trait, ty)
        if key in self.impls:
            error(f"conflicting impls of {trait} for {ty}")   # coherence violation
            return
        self.impls[key] = impl

    def resolve_method(self, ty, method):
        for (trait, t), impl in self.impls.items():
            if t == ty and method in impl.methods:
                return impl.methods[method]      # the unique target for codegen
        error(f"no method '{method}' for type {ty}")
        return ERROR
```

Coherence (one impl per `(trait, type)`) is what lets `x.area()` resolve to a *single* concrete function — without it, two libraries could each define `Shape for Circle` and the call would be ambiguous *globally*. The orphan rule is the mechanism that guarantees coherence under separate compilation.

### Example 3: Generic instantiation with bound checking

```python
def check_generic_call(decl, type_args, arg_types):
    # decl: fn max<T: Ord>(a: T, b: T) -> T
    subst = dict(zip(decl.type_params, type_args))     # T -> concrete

    # 1) every type argument must satisfy its bound
    for tp, ty in subst.items():
        for bound in tp.bounds:                         # e.g. Ord
            if not satisfies(ty, bound):
                error(f"`{ty}` does not satisfy bound `{bound}` "
                      f"required by `{decl.name}`")
    # 2) the (substituted) parameter types must accept the arguments
    for at, pt in zip(arg_types, decl.params):
        expected = substitute(pt, subst)                # T -> ty
        if not assignable(at, expected):
            error(f"argument `{at}` not assignable to `{expected}`")
    # 3) the call's result type is the substituted return type
    return substitute(decl.ret, subst)
```

```text
max(3, 4)        T=int   ; int: Ord ? yes  ; result int
max(p1, p2)      T=Point ; Point: Ord ? NO  -> error AT THE CALL,
                                              citing max's `T: Ord` bound
```

The error is reported at the use site but references the declaration's contract — the hallmark of generics: the body was checked once against the bound; each instantiation re-checks the bound.

### Example 4: Borrow checking — aliasing XOR mutation (sketch)

```python
# Flow-sensitive: at each program point, track live borrows of each place.
# Rule: a place may have many SHARED borrows OR one MUT borrow, never both.

def check_borrows(cfg):
    for point in cfg.points():
        live = live_borrows_at(point)        # NLL: borrows whose last use is >= here
        for place in places_touched_at(point):
            muts    = [b for b in live if b.place == place and b.kind == "mut"]
            shareds = [b for b in live if b.place == place and b.kind == "shared"]
            if muts and (shareds or len(muts) > 1):
                error(f"cannot borrow `{place}` mutably while it is also borrowed",
                      point.span)
            if accesses_moved(place, point):
                error(f"use of moved value `{place}`", point.span)
```

```rust
let mut v = vec![1, 2, 3];
let r = &v[0];        // shared borrow of v, lives until r's last use
v.push(4);            // ERROR: needs &mut v, but a shared borrow (r) is still live
println!("{}", r);    // r's last use -> under NLL the shared borrow ends HERE
```

Move `println!` *above* `v.push(4)` and it compiles: NLL ends the shared borrow at `r`'s last use, so the mutable borrow no longer overlaps. Borrow checking is precisely this overlap analysis over the CFG with liveness.

### Example 5: Cross-module resolution with visibility

```python
def resolve_path(path, current_module, modules):
    # path like  foo::bar::Baz
    mod = modules[path.head]                        # resolve the module
    for segment in path.middle:
        mod = mod.submodule(segment) or error_undef(segment)
    sym = mod.lookup(path.last)
    if sym is None:
        error(f"no `{path.last}` in module `{mod.name}`")
        return ERROR
    if not visible_from(sym, current_module):       # resolvable != accessible
        error(f"`{path.last}` is private to `{mod.name}`")
        return ERROR
    return sym

def visible_from(sym, site):
    if sym.visibility == "public":   return True
    if sym.visibility == "crate":    return site.crate == sym.crate
    if sym.visibility == "private":  return site.module == sym.module
```

The two-step — find it, *then* check you're allowed to see it — is universal. A common bug is conflating the two: reporting "no such name" for a name that exists but is private produces a misleading diagnostic; "exists but is private" is the right message.

### Example 6: A query-driven type_of with memoization

```python
class QueryEngine:
    def __init__(self):
        self.cache = {}              # query -> result
        self.deps  = {}              # query -> set of queries it read

    def type_of(self, node):
        if node in self.cache:
            return self.cache[node]
        deps = set()
        ty = self._compute_type(node, deps)   # records sub-queries into `deps`
        self.cache[node] = ty
        self.deps[node]  = deps
        return ty

    def invalidate(self, changed_node):
        # invalidate the node and everything transitively depending on it
        dirty = {changed_node}
        for q, ds in self.deps.items():
            if ds & dirty:
                dirty.add(q)
                self.cache.pop(q, None)
```

Real systems (Salsa, rustc's query engine) track a revision counter and verify dependencies by re-running cheap "is this still valid?" checks rather than naive transitive invalidation, but the shape is this: *compute on demand, memoize, invalidate by dependency*. Every check in this topic — resolution, typing, borrow check, exhaustiveness — becomes such a query.

### Example 7: The handoff — a typed, fully-resolved IR node

```text
Before analysis (parser AST):
    Call { callee: Name("max"), args: [Int(3), Int(4)] }

After semantic analysis (typed, resolved artifact for codegen):
    Call {
        target:    max$int            # monomorphized instance, ONE concrete fn
        callee_ty: fn(int, int) -> int
        args:      [ Int(3): int, Int(4): int ]
        result_ty: int
        coercions: []                 # none needed; explicit if there were
    }
```

Everything codegen could possibly need to decide has been decided: the *exact* function (`max$int`, the `int` monomorphization), the concrete types on every node, no remaining overload/trait ambiguity, coercions made explicit. Codegen lowers this mechanically to machine code or bytecode — it never re-runs resolution or typing. That is the contract semantic analysis exists to deliver.

---

## Pros & Cons

| Aspect | Pros | Cons |
|---|---|---|
| Overloading / trait resolution | Expressive, ergonomic call sites; ad-hoc polymorphism | Resolution entangled with inference; ambiguity rules are intricate |
| Coherence / orphan rules | Guarantees a single global impl; sound separate compilation | Restricts what users can implement; sometimes frustrating |
| Monomorphization | Zero-cost generics; full optimization per instance | Code bloat; longer compiles |
| Erasure | Small code; one copy | Loses type info at runtime; can't specialize |
| Borrow checking | Memory safety without GC, proven at compile time | Steep learning curve; some safe programs rejected; complex implementation |
| Query-driven analysis | Millisecond incremental rebuilds; powers IDEs | Demands pure, dependency-tracked design; harder to write |
| Rich typed-IR handoff | Dumb, fast, trustworthy back end | Front end must materialize every decision; larger artifacts |

---

## Use Cases

- **A systems language with ownership** (Rust-like): borrow checking as the headline semantic feature, layered on type checking.
- **A language with ad-hoc polymorphism** (operator overloading, traits, typeclasses): overload/trait resolution interleaved with inference.
- **A generic-heavy library language**: bound checking, variance, and a chosen monomorphization/erasure/dictionary strategy.
- **A language server / IDE** for any of the above: the whole front end restructured as memoized queries for keystroke-latency feedback.
- **A build system integration**: emitting and consuming module interface artifacts for incremental and distributed compilation.
- **A polyglot transpiler** that must resolve names, methods, and generics across modules before lowering to a target language.

---

## Coding Patterns

- **Candidate-filter-rank.** Resolution = gather candidates, filter to applicable, rank by specificity, demand a unique best. Every overload/trait resolver has this shape.
- **Constraint loop for resolution+inference.** When picking an overload needs argument types and inferring an argument needs the overload, gather constraints and iterate to a fixpoint rather than forcing an order.
- **Substitution for generics.** Represent instantiation as a substitution map `type_param -> concrete`; apply it to parameter and return types; check bounds before applying.
- **Dataflow for safety.** Reuse the CFG/dataflow engine for borrow checking (liveness of borrows, moved-out places) exactly as for definite assignment.
- **Two-step resolution then access.** Resolve the name; *then* check visibility. Keep them separate for accurate diagnostics.
- **Two-phase module resolution.** Declare all module interfaces, then resolve bodies — collect-then-check raised to the module level, which also breaks import cycles.
- **Query + memoize + invalidate.** Express each check as a pure function of memoized inputs with tracked dependencies for incrementality.
- **Lower ambiguity away before codegen.** Resolve every call to a concrete target and insert explicit coercions so the back end has no choices left.

---

## Clean Code

- **One registry per resolution concern.** A trait/impl registry, an overload set per name — explicit structures, not logic smeared through the type checker.
- **Diagnostics that explain the ranking.** "ambiguous: candidates `print(int)` and `print(long)` both apply" beats "ambiguous call." Show the candidates and why none won.
- **Separate "resolvable" from "accessible" in messages.** Privacy errors and undefined-name errors are different user problems; never collapse them.
- **Make instantiation explicit in the IR.** A monomorphized call should name its instance (`max$int`), not leave codegen to recompute it. The artifact should be self-describing.
- **Keep queries pure.** No hidden global mutation inside a query; its result must be a function of its declared inputs, or incremental invalidation silently goes wrong.
- **Insert coercions as real nodes.** A widening or auto-deref should appear as an explicit `Coerce` node, not an implicit assumption codegen must rediscover.

---

## Best Practices

| Practice | Why |
|---|---|
| Model resolution as candidate→applicable→most-specific | The only robust way to handle overloading/traits |
| Enforce coherence via orphan rules | Guarantees a single global impl under separate compilation |
| Check generic bounds at the use site, citing the declaration | Errors land where the user can fix them, with the right reason |
| Get variance right; it is a soundness property | Wrong variance is an unsoundness, not a cosmetic bug |
| Implement borrow/ownership checks as CFG dataflow with NLL | Precise, accepts more safe programs than lexical scoping |
| Resolve names, then enforce visibility, as distinct steps | Accurate "undefined" vs. "private" diagnostics |
| Use two-phase (interface-first) module resolution | Handles cycles and enables separate compilation |
| Structure the front end as memoized queries | Keystroke-latency incremental analysis for tooling |
| Emit module interface artifacts | Enables incremental, parallel, distributed builds |
| Make the codegen handoff fully resolved and explicit | A dumb, fast, trustworthy back end |

---

## Edge Cases & Pitfalls

- **Overload ambiguity from numeric/implicit conversions.** `f(int)` and `f(long)` called with a literal that converts to both — ambiguous unless the language's conversion ranking breaks the tie. These rules are language-specific and a frequent source of surprising errors.
- **Trait method vs. inherent method shadowing.** A type's own method can shadow a trait method of the same name; resolution must prefer the inherent one (Rust) or follow defined precedence — easy to get backwards.
- **Variance unsoundness.** Treating `List<T>` as covariant when it has a mutating method opens `ArrayStoreException`-style holes. Mutable containers must be invariant in their element type.
- **Borrow checker rejecting safe code.** Some provably-safe programs don't fit the analysis (especially before NLL, and around self-referential structures). The fix is sometimes `unsafe` or a redesign — the checker is *conservative*, not omniscient.
- **Self-referential / cyclic data and lifetimes.** A struct holding a reference into itself defeats simple region inference; needs `Pin`, arenas, or indices instead of references.
- **Glob-import collisions.** Two `use a::*; use b::*;` both bringing `Foo` — only an *error if `Foo` is actually used*; mere ambiguity in scope is tolerated until referenced. Resolving this lazily vs. eagerly changes the diagnostics.
- **Cyclic module imports.** Eager resolution deadlocks/loops; you need the two-phase interface-first approach or explicit cycle detection.
- **Incremental invalidation that's too coarse or too fine.** Too coarse → no speedup; too fine but unsound (missing a dependency) → stale, wrong results. Dependency tracking must be exact.

---

## Common Mistakes

1. Treating method/operator resolution as a plain symbol-table lookup when overloading or traits are involved.
2. Sequencing resolution strictly after inference when the two are mutually dependent, then failing on cases that need the loop.
3. Checking generic bounds only at the declaration, not at each instantiation — accepting `max(Point, Point)` for a non-`Ord` `Point`.
4. Getting variance wrong on mutable containers, introducing a soundness hole.
5. Implementing borrow/ownership checks with lexical scopes instead of NLL, rejecting far more safe code than necessary.
6. Conflating "name doesn't exist" with "name is private," producing misleading diagnostics.
7. Resolving imports eagerly and looping on cyclic modules instead of two-phasing.
8. Building a batch-only front end, then being unable to deliver IDE-grade incrementality.
9. Leaving overload/trait/generic decisions unresolved in the AST handed to codegen, forcing the back end to re-disambiguate.
10. Implicit coercions assumed rather than inserted as explicit nodes, so codegen and the type checker can disagree.
11. Impure queries (hidden global mutation) that break incremental invalidation invisibly.

---

## Tricky Points

- **Resolution and inference are a fixpoint, not a sequence.** The textbook "resolve then type" order is a simplification; real languages with overloading + inference interleave them, which is why their specifications are so intricate.
- **The orphan rule exists for coherence, not bureaucracy.** It's what makes "there is exactly one `impl Shape for Circle` in the whole program" *provable* without whole-program analysis — essential for separate compilation.
- **Monomorphization vs. erasure is a semantic decision with runtime consequences.** It dictates whether type arguments survive to runtime (reflection, specialization) and whether the typed IR must carry concrete instances. It's chosen during analysis, not codegen.
- **Borrow checking moved from lexical to non-lexical because lexical was needlessly conservative.** NLL reframes lifetimes as a *liveness dataflow* result — the same machinery as senior-level analyses — which is why it accepts strictly more programs while staying sound.
- **Visibility is checked late and is path-sensitive.** A `pub` item inside a private module is effectively private from outside; effective visibility is the *minimum* along the access path, not the item's own modifier.
- **Incrementality reshapes everything.** Designing checks as pure, memoizable queries is not an optimization bolted on at the end; it changes how you structure resolution, typing, and even diagnostics from the start.
- **The handoff is the whole point.** Every clever check exists so codegen can be trivial. If the back end still has to make semantic decisions, the front end didn't finish its job.

---

## Test Yourself

1. Outline the three stages of overload resolution and give an example where multiple parameters produce a genuine ambiguity.
2. Why must generic bound satisfaction be checked at each instantiation rather than once at the declaration? Where is the error reported, and what does it cite?
3. State the central borrow-checking rule and explain how Non-Lexical Lifetimes let some previously-rejected programs compile.
4. Why does the orphan rule exist, and how does it relate to coherence and separate compilation?
5. Distinguish "resolvable" from "accessible." Give a program where a name exists but is inaccessible, and explain effective visibility along an access path.
6. Why are cyclic module imports handled by a two-phase (interface-first) resolution, and how is that the same pattern as forward-reference handling within a file?
7. Describe what a query-driven front end memoizes and invalidates, and why every check must be a pure function of its inputs.
8. List four things the typed AST/IR must carry so that code generation never has to make a semantic decision.

<details>
<summary>Answers</summary>

1. (a) Collect all candidates with the name; (b) filter to *applicable* (arity + each arg assignable to the param); (c) pick the *most specific*. Ambiguity: `f(int, Object)` and `f(Object, int)` called with `f(int, int)` — each is better on one argument, neither dominates → error.
2. The body is checked once against the bound's *contract*; each use supplies a *different* concrete type that must individually *satisfy* the bound. The error is reported at the **call site** and cites the **declaration's bound** (e.g., "`Point` does not satisfy `Ord` required by `max`").
3. At any point a place may have many shared borrows XOR one mutable borrow, and no use-after-move/dangling. NLL ends a borrow at its *last use* (a liveness result) rather than its lexical scope end, so a later mutable borrow no longer overlaps an earlier shared borrow that's already dead.
4. The orphan rule (you may impl a trait for a type only if you own the trait or the type) guarantees **coherence** (≤ one impl per `(trait, type)`) without whole-program analysis, so separately compiled crates can't add conflicting impls.
5. Resolvable = the name exists in the target module; accessible = the referencing site is permitted to see it. A `private` field exists but errors on access from another module. Effective visibility is the *minimum* along the path: a `pub` item in a private module is private from outside.
6. Module `A`↔`B` cycles can't be resolved by eager body-first resolution. Phase 1 declares all module *interfaces*; phase 2 resolves bodies against those interfaces — breaking the cycle. It's the same collect-then-check used for forward references, lifted from scopes to modules.
7. It memoizes semantic-fact queries (`type_of`, `resolve`, `borrowck`, `is_exhaustive`) with their dependency sets, and on edit invalidates only queries whose inputs changed (transitively). Purity is required so a memoized result is a faithful function of its declared inputs; hidden mutation would make invalidation unsound.
8. Resolved bindings (cross-module), concrete/instantiated types on every node, each call resolved to a specific target (overload/impl/monomorphization), and explicit coercion nodes — plus the assumption of verified properties (exhaustiveness, definite assignment, borrow safety).

</details>

---

## Tricky Questions

**Q1.** A teammate proposes resolving all overloads in a pass strictly *before* type inference "to keep phases clean." Where does this break?
**A.** When choosing the overload depends on argument types *and* an argument's type depends on the chosen overload's expected parameter (e.g., an untyped lambda or numeric literal). The two are mutually dependent and must be solved together as a constraint problem; a strict before/after order rejects valid programs or picks wrong overloads. Modern checkers interleave resolution and inference in a fixpoint.

**Q2.** Your generic `Stack<T>` is treated as covariant, and a user gets a runtime crash storing the wrong element type. What's the root cause and the fix?
**A.** Covariance is unsound for a *mutable* container: covariance permits `Stack<Cat>` where `Stack<Animal>` is expected, then a `push(Dog)` corrupts it. The fix is to make `T` **invariant** for mutable containers (covariant only for read-only views). This is a soundness bug, not a style issue.

**Q3.** Code compiled fine last year now fails to borrow-check after a refactor that only *moved a `println!`*. Is the borrow checker buggy?
**A.** No. Borrow checking is flow-sensitive: moving a use changes the *liveness region* of a borrow. Moving a reference's last use later extends its borrow's region; if that now overlaps a mutable borrow, NLL correctly rejects it. The reverse (moving a use earlier) is exactly how you fix such errors.

**Q4.** A library can't add `impl Display for Vec<T>` and gets an "orphan" error, even though it seems harmless. Why does the language forbid it?
**A.** Both `Display` (std) and `Vec` (std) are foreign to the library. Allowing the impl would let *two* libraries each define `Display for Vec<T>` differently, and a program using both would have no coherent choice. The orphan rule forbids impls where neither the trait nor the type is local, preserving global coherence.

**Q5.** An IDE shows a stale type for a symbol after an edit elsewhere. The compiler is correct in batch mode. What's wrong?
**A.** The incremental dependency tracking is *unsound*: a query depended on the edited input but didn't record that dependency, so its memoized result wasn't invalidated. Either the query read a value it didn't declare as a dependency, or it performed hidden global mutation. Queries must be pure functions of their tracked inputs.

**Q6.** Why is "the typed AST handed to codegen" the natural endpoint of this entire topic, from junior to professional?
**A.** Every level added decisions the front end must settle so the back end needn't: junior resolved names and basic types; middle added the decorated AST; senior verified flow and exhaustiveness; professional resolved overloads, traits, generics, and ownership. The endpoint is an artifact where *no semantic ambiguity remains* — codegen is a mechanical lowering of a fully-decided program. That handoff is the reason semantic analysis exists as a phase.

---

## Cheat Sheet

```text
SEMANTIC ANALYSIS — PROFESSIONAL

RESOLUTION = SEARCH + RANK (not lookup)
  candidates -> applicable (arity + assignable) -> most specific -> unique?
  traits/typeclasses: search impls, constrained by COHERENCE (orphan rule)
  resolution + inference are a FIXPOINT, often interleaved

GENERICS
  check body ONCE against bounds ; check each INSTANTIATION at the use site
  bound error: reported at CALL, cites DECLARATION's bound
  variance: produce->covariant, consume->contravariant, both/mutable->INVARIANT
  representation: monomorphize | erase | dictionary-pass  (a semantic decision)

BORROW / OWNERSHIP CHECKING (= dataflow on the CFG)
  rule: many &shared  XOR  one &mut ; no use-after-move ; no dangling
  NLL: a borrow lives over its USE region (liveness), not lexical scope
  it's a MEMORY-SAFETY PROOF, same engine as definite assignment

MODULES / VISIBILITY
  resolve name  THEN  check visibility (resolvable != accessible)
  effective visibility = MIN along the access path
  cross-module: TWO-PHASE (interfaces first) -> breaks import cycles
  emit/consume module interface artifacts -> separate compilation

INCREMENTAL (query-driven)
  type_of/resolve/borrowck/is_exhaustive = MEMOIZED queries + dep tracking
  edit -> invalidate only dependents ; queries MUST be pure
  rustc queries+Salsa | Roslyn red-green trees | Swift request-evaluator

HANDOFF TO CODEGEN (the point of it all)
  every Name -> resolved binding ; every expr -> concrete type
  every call -> ONE target (overload/impl/monomorphized instance)
  coercions EXPLICIT as nodes ; verified props (exhaustive/DA/borrow) assumed
  => back end is a mechanical, choice-free lowering
```

---

## Summary

- At professional scale, **resolution is disambiguation**: overload resolution (candidate set → applicable → most specific) and trait/typeclass resolution (impl search under **coherence**/orphan rules), and it is **interleaved with type inference** as a fixpoint, not a clean pass.
- **Generics** are checked once against their **bounds** and re-checked at every **instantiation** (errors land at the use site, citing the declaration). **Variance** is a soundness obligation; the **monomorphization vs. erasure vs. dictionary-passing** choice is made during analysis because it shapes the typed artifact.
- **Borrow/ownership checking is semantic analysis** — a flow-sensitive proof over the CFG (many shared XOR one mutable, no use-after-move, no dangling) using **Non-Lexical Lifetimes** (liveness), the senior-level dataflow machinery turned into a memory-safety theorem.
- **Module and import resolution** adds visibility/access control (resolvable ≠ accessible; effective visibility is the minimum along the path), **two-phase interface-first** resolution that breaks cycles, and **module interface artifacts** that enable separate compilation.
- Modern front ends are **query-driven and incremental**: every check is a pure, memoized function of tracked inputs, so an edit invalidates only what changed — the architecture behind responsive language servers.
- The phase's purpose, made precise here, is the **handoff to code generation**: a typed, fully-resolved artifact where every name is bound, every expression typed, every call resolved to a concrete target, and every coercion explicit — so the back end is a mechanical, choice-free lowering. That handoff is why semantic analysis exists.

---

## What You Can Build

- **An overload resolver** with candidate/applicable/most-specific ranking and precise ambiguity diagnostics that list the competing candidates.
- **A trait/impl registry** enforcing coherence via an orphan rule, resolving `x.method()` to a unique concrete target.
- **A generic checker** that checks a body once against bounds and each call by substitution + bound satisfaction, with variance enforcement for containers.
- **A miniature borrow checker** over a CFG with NLL: track live shared/mutable borrows and moved-out places, reporting overlap and use-after-move.
- **A cross-module resolver** with import resolution, glob handling, visibility/access control, and two-phase interface-first resolution that detects and reports import cycles.
- **A query engine** that memoizes `type_of`/`resolve` with dependency tracking and demonstrates keystroke-latency invalidation on an edit.
- **A typed-IR emitter** that lowers a checked AST into a fully-resolved artifact (concrete targets, instantiated types, explicit coercions) ready for a trivial back end.

---

## Further Reading

- *The Rust Reference* and the *rustc dev guide* — the canonical description of trait resolution, coherence/orphan rules, monomorphization, and the borrow checker (Polonius/NLL).
- Niko Matsakis et al. — the **NLL RFC (2094)** and Polonius notes: borrow checking reframed as dataflow.
- *Types and Programming Languages* — Benjamin Pierce. Bounded quantification, variance, and the theory behind generics and subtyping.
- *The Java Language Specification*, chapters on method invocation/overload resolution and on generics/erasure — exacting real-world rules.
- Philip Wadler & Stephen Blott — *How to make ad-hoc polymorphism less ad hoc* (POPL 1989): the typeclass/dictionary-passing foundation.
- Salsa documentation and the **rustc query system** chapter — the modern incremental/query-driven architecture.
- Roslyn's design notes on **red-green trees** — incremental syntax/semantics for IDEs.
- *Engineering a Compiler* — Cooper & Torczon. Linkage, separate compilation, and interprocedural concerns.

---

## Related Topics

- The previous phase, **parsing**, supplies the AST that the whole front end resolves, types, and decorates.
- The deep theory of types — inference, subtyping, variance, parametric and ad-hoc polymorphism — lives in the **type-systems** material; this page integrates its *checking and resolution* side.
- **Control-flow and dataflow analysis** underpins borrow checking, definite assignment, and reachability, and recurs in optimization.
- The next phase, **intermediate-representation / code generation**, consumes the fully-resolved typed artifact this phase produces — the handoff this page makes precise.
- **Runtime systems** handle the dynamic counterparts: dynamic dispatch tables, reflection on retained type info, and the memory management that ownership checking sometimes replaces.
- **Linkers and build systems** consume the module interface artifacts semantic analysis emits to enable separate and incremental compilation.

---

## Diagrams & Visual Aids

### Overload resolution funnel

```text
   all `print` declarations in scope        <- candidates
            │  filter: arity + each arg assignable to param
            ▼
   applicable overloads
            │  rank: most specific (param-by-param subtyping)
            ▼
   unique best?  ── yes ──► chosen target (for codegen)
            │
            └── no (tie / none) ──► AMBIGUOUS / NO MATCH error
```

### Generics: one check, many instantiations

```text
   fn max<T: Ord>(a: T, b: T) -> T      <- checked ONCE against bound `Ord`
        │                │
   max(3,4)  T=int   max("a","b") T=String   max(p,p) T=Point
   int: Ord  ✔        String: Ord ✔           Point: Ord ✘  -> ERROR at call,
                                                              cites `T: Ord`
```

### Borrow checking with NLL

```text
   let r = &v[0];     ── shared borrow of v starts
   ...                   (live while r may still be used)
   v.push(4);         ── needs &mut v
   println!("{}", r); ── r's LAST use  ── shared borrow ends HERE (NLL)

   if push is BEFORE r's last use  -> overlap: &mut while &shared live -> ERROR
   if push is AFTER  r's last use  -> no overlap -> OK
```

### Resolve then check visibility

```text
   path foo::bar::Baz
        │  step 1: RESOLVE  (does Baz exist in foo::bar?)
        ▼
     found Baz
        │  step 2: ACCESS   (is Baz visible from here?)
        ▼
   visible? ── yes ──► use it
        │
        └── no ──► "Baz is private to foo::bar"   (NOT "no such name")
```

### Query-driven invalidation

```text
   edit body of  fn g
        │ invalidate  type_of(g-body), borrowck(g)
        ▼
   queries depending on g (callers' resolution)  -> re-check; most still valid
   everything NOT depending on g                  -> cache hit, untouched
   => milliseconds, not a full rebuild
```

### The endpoint: parser AST -> fully-resolved typed IR

```text
   Call(Name "max", [3, 4])                 (parser: ambiguous, untyped)
            │  resolve overload/trait/generic ; infer types ; insert coercions
            ▼
   Call(target=max$int,                     (codegen input: every decision made)
        result_ty=int, args=[3:int, 4:int],
        coercions=[])
            │  mechanical lowering
            ▼
   machine code / bytecode
```
