# Semantic Analysis — Interview Level

> **Topic:** [Semantic Analysis](README.md)
> **Focus:** Interview questions on the phase that proves a parsed program *means* something — name resolution, symbol tables, type checking, flow-based checks, borrow checking, and resolution.

---

## Table of Contents

1. [Conceptual](#conceptual)
2. [Language-Specific](#language-specific)
3. [Tricky / Trap](#tricky--trap)
4. [Design](#design)

---

## Conceptual

## Question 1

**What does semantic analysis check that parsing does not?**

Parsing proves a program is *grammatically* well-formed — that the tokens form a valid tree. Semantic analysis proves it *means* something valid: that every name resolves to a declaration (name resolution), that types are compatible (type checking), and that contextual rules hold (no `break` outside a loop, no read of an unassigned variable, exhaustive `match`, no assignment to a constant). The parser is happy with `x = y + zog` as `id = id + id`; semantic analysis is the phase that notices `zog` was never declared or that `y + zog` mixes incompatible types. Most compile errors a programmer actually sees — undefined variable, type mismatch, out of scope — are semantic, not syntactic.

## Question 2

**Explain a symbol table and why it must be scoped.**

A symbol table maps each name to information about it: its declaration site, kind (variable, function, type, const), type, mutability, and so on. It must be *scoped* because the same name can mean different things in different regions — an `x` inside a block can be a different variable from an `x` outside it. A flat dictionary can't tell them apart. The standard model is a stack (while walking) or tree (if kept) of per-scope tables: entering a block pushes a scope, leaving pops it, declarations insert into the innermost scope, and lookups search innermost-to-outermost. Searching innermost-first is exactly what implements **shadowing** — the nearest declaration wins.

## Question 3

**What is the difference between a declaration and a use, and what is name resolution?**

A *declaration* introduces a name (`let x = 5`, `func foo()`, `class Dog`). A *use* refers to an existing name (`print(x)`, `foo()`). **Name resolution** (binding) is drawing an arrow from every use back to the declaration it refers to, using the symbol table. If no visible declaration exists, that's the "undefined variable" error. After resolution, each use node is decorated with a binding to its declaration.

## Question 4

**Describe bottom-up type checking.**

The type checker walks each expression and computes a type from the types of its children. Leaves return their type directly: a literal `5` is `int`, `"hi"` is `string`, and a name's type comes from its resolved symbol. Internal nodes derive their type by applying the operator's rule: `int + int → int`, `int + string → type error`. A function call's type is its declared return type, after checking arity and that each argument is assignable to its parameter. The result is a *typed AST* where every expression node knows its type.

## Question 5

**What is the output of semantic analysis, and how does the next phase use it?**

The output is a **decorated (typed) AST**: the same tree the parser built, now annotated — every name use has a resolved binding, every expression has a computed type, and verified properties (exhaustiveness, definite assignment) are recorded. Code generation consumes this decorated AST and *trusts* that semantic analysis already proved everything valid, so it can lower the program mechanically without re-checking names or types. The contract is: if there were no errors, every invariant codegen relies on holds.

## Question 6

**Why does semantic analysis sometimes need more than one pass?**

For **forward references** and **mutual recursion**. Inside a block, locals usually follow declare-before-use, so one downward pass works. But at file or class scope you can call a function defined later, or have two mutually recursive types/functions. A single top-to-bottom pass would see the name undefined at its first use. The fix is two passes: pass one collects all top-level declarations (signatures only), pass two checks bodies — now every name is already in the table regardless of textual order.

## Question 7

**What is the difference between type checking and type inference?**

Type checking *verifies* types that are mostly written down: given annotations, confirm the program obeys the type rules. Type inference *deduces* types that weren't written: figure out the type of a variable or expression from context. They sit on a spectrum — most real checkers do *local* inference (e.g., inferring the type of a `let` from its initializer, or an element type via bidirectional checking) while requiring annotations elsewhere. Full global inference (Hindley–Milner) is the deep end and belongs to type-systems theory; semantic analysis usually does checking plus enough local inference to be ergonomic.

## Question 8

**What is lexical (static) scope versus dynamic scope?**

**Lexical scope** is determined by where code is *written* in the source — visibility follows the textual nesting of blocks and functions, decided entirely at compile time. It's the default in essentially every modern language and is what name resolution implements with the scope stack. **Dynamic scope** resolves a name by walking the *runtime call stack* — a use refers to the most recent binding active when execution reaches it, which can't be determined statically. Dynamic scope is rare (some Lisp dialects, shell variables) because it makes code hard to reason about; lexical scope won.

## Question 9

**What is an attribute grammar, and what are synthesized vs. inherited attributes?**

An attribute grammar attaches *attributes* to AST nodes, computed by semantic rules. **Synthesized** attributes flow *up*: a node computes them from its children (the type of `a + b` from the types of `a` and `b`; "does this block return on all paths"). **Inherited** attributes flow *down*: a node receives them from its parent or context (the expected type pushed onto an expression, the current function's return type, "are we inside a loop"). The direction of attribute dependencies determines how many passes you need — purely synthesized (S-attributed) needs one bottom-up pass; most checkers are L-attributed (one left-to-right pass) except where forward references break left-to-right order.

## Question 10

**Why is "definite assignment" not a scoping check, and what kind of check is it?**

Scoping answers "is this name visible here?" Definite assignment answers "is this variable assigned on *every path* that reaches this read?" — which depends on control flow, not just visibility. It's a **forward, must dataflow analysis** over the control-flow graph: each program point tracks the set of locals assigned on all incoming paths, merging by *intersection* at join points (assigned only if assigned on every path). Loops require iterating to a fixpoint. Java and C# enforce it; it's why `int x; if (c) x = 1; use(x);` is rejected (the `c == false` path leaves `x` unassigned).

---

## Language-Specific

## Question 11

**(C/C++) How does C's notion of "declaration before use" interact with semantic analysis, and what problem do forward declarations solve?**

C traditionally requires a name be *declared* before use in the source order (within a translation unit). Calling a function before the compiler has seen its declaration historically meant an implicit-`int` declaration (a footgun, removed in C99 for functions; using an undeclared identifier is now an error). **Forward declarations** (function prototypes, `struct Foo;`) solve mutual reference: they introduce the name and signature into the symbol table early so later uses resolve, with the definition supplied elsewhere. Semantically, a prototype inserts a symbol whose body is checked separately — C's manual version of the collect-then-check two-pass that other languages do automatically.

## Question 12

**(C++) What is overload resolution, and what makes it hard?**

Given several functions with the same name, overload resolution picks the one to call based on the argument types. It proceeds in stages: gather the *candidate set* (all visible overloads), filter to those *viable* (arity matches and each argument can convert to the parameter), then select the *best* by a partial order over implicit conversion sequences (an exact match beats a promotion beats a standard conversion beats a user-defined conversion). It's hard because the conversion ranking is intricate, templates add deduction, multiple parameters can tie (one overload better on arg 1, another on arg 2 → ambiguous), and it interacts with ADL (argument-dependent lookup), making the candidate set itself nontrivial to compute.

## Question 13

**(Java) Explain definite assignment and erasure as two distinct semantic-analysis responsibilities.**

**Definite assignment** is a flow-based check: the compiler proves every local is assigned before it's read on all paths, rejecting `int x; System.out.println(x);`. It's specified precisely in the JLS as a forward analysis with rules for each construct. **Erasure** is how Java compiles generics: type parameters are checked at compile time but *erased* at runtime — `List<String>` and `List<Integer>` become the same `List` class, with casts inserted where needed. Semantic analysis enforces the generic typing rules (bounds, assignability) statically, then erasure throws the type arguments away for the runtime. The consequence is no runtime generic type info (hence `new T[]` is illegal and `instanceof List<String>` is not allowed).

## Question 14

**(Java vs. C++) Contrast erasure with monomorphization for generics.**

**Erasure** (Java) compiles a generic to a *single* copy that forgets type arguments at runtime — small code, but no runtime type information and no specialization. **Monomorphization** (C++ templates, Rust) generates a *separate specialized copy* per concrete type argument — `Vec<int>` and `Vec<String>` become distinct code — giving full optimization and zero-cost abstraction at the price of code bloat and longer compile times. A third option, **dictionary passing** (Haskell typeclasses, Swift), keeps one copy but passes the witness/operations as a hidden argument. The choice is partly a semantic-analysis decision because it dictates what the typed artifact must carry into codegen.

## Question 15

**(Rust) Explain borrow checking as a form of semantic analysis.**

After type checking, Rust's borrow checker proves a memory-safety property *statically* via flow analysis over the CFG. Its rules: at any point a value may have many shared borrows (`&`) or exactly one mutable borrow (`&mut`) but never both; a value can't be used after it's moved; and a reference can't outlive its referent. This is genuinely semantic analysis — it's not about syntax or even basic types, but about proving the program's *use of memory* is sound. Modern Rust uses **Non-Lexical Lifetimes**: a borrow lives only over the region where the reference is actually *used* (a liveness dataflow result), not until its lexical scope ends, which lets more correct programs compile.

## Question 16

**(Rust) Why does this fail to borrow-check, and how do you fix it?**

```rust
let mut v = vec![1, 2, 3];
let first = &v[0];
v.push(4);
println!("{}", first);
```

`&v[0]` creates a shared borrow of `v` that, under NLL, lives until `first`'s last use — the `println!`. `v.push(4)` needs a *mutable* borrow of `v`, which overlaps the still-live shared borrow, violating "shared XOR mutable." The fix is to ensure the borrows don't overlap: move the `println!` before the `push`, so `first`'s last use (and thus the shared borrow) ends before the mutable borrow begins. Alternatively, copy the value out (`let first = v[0];`) so no borrow is held across the mutation.

## Question 17

**(Rust) What is the orphan rule and why does it exist?**

The orphan rule says you may implement a trait for a type only if you define the trait *or* the type in your own crate. It exists to guarantee **coherence**: there is at most one implementation of a given trait for a given type across the entire program. Without it, two separate crates could each add `impl Display for Vec<T>` with different behavior, and a program depending on both would have no coherent way to resolve `vec.to_string()`. The orphan rule makes coherence *provable* under separate compilation — without whole-program analysis — at the cost of forbidding some impls users might want.

## Question 18

**(Go) How does Go handle name visibility and forward references differently from C?**

Go encodes visibility by **capitalization**: an identifier is exported from its package iff it starts with an uppercase letter — no `public`/`private` keywords. For **forward references**, Go does package-level two-pass resolution: you can reference a function, type, or variable declared *anywhere* in the package, regardless of file or textual order, because the compiler collects all package-level declarations before checking bodies. (Local variables inside a function still follow declare-before-use.) Go also *forbids import cycles* between packages outright, detecting them during resolution and erroring, which simplifies its module model.

## Question 19

**(Go) How does interface satisfaction differ from Java/Rust trait conformance, semantically?**

Go uses **structural** interface satisfaction: a type satisfies an interface if it has the required methods — there is no `implements` declaration. Semantic analysis checks, at each assignment/conversion to an interface type, that the concrete type's method set includes the interface's methods. This is *implicit* conformance computed structurally. Java (`implements`) and Rust (`impl Trait for Type`) use **nominal** conformance: the type must *declare* that it implements the interface/trait. Structural satisfaction means a type can satisfy an interface it never knew about; nominal requires an explicit, checked declaration and enables coherence rules.

## Question 20

**(Haskell) What is typeclass resolution and how does dictionary passing relate to it?**

A typeclass (e.g., `Ord a`) is a set of operations a type must provide. When you call a class method like `compare x y`, the compiler must find the `instance Ord T` for the concrete type — this is **typeclass resolution**, analogous to trait resolution. It's implemented by **dictionary passing**: the compiler turns the constraint `Ord a` into a hidden parameter — a *dictionary* (a record of the instance's method implementations) — passed at the call site. So `compare` becomes "look up `compare` in the `Ord` dictionary you were handed." This is how Haskell gets ad-hoc polymorphism with one compiled copy of generic code (versus monomorphization), and resolution must find or construct the right dictionary, recursively (an `Ord [a]` instance may need an `Ord a` dictionary).

## Question 21

**(Haskell/Rust) What is exhaustiveness checking, and why is it valuable?**

Exhaustiveness checking verifies that a `match`/`case` over a sum type (ADT, enum, sealed class) covers every possible value; a non-exhaustive match is an error (Haskell with `-Wincomplete-patterns`, Rust always). It's computed by a *usefulness* algorithm that asks whether any value is left unmatched and can produce a *witness* — the missing case. Its value is that adding a new variant to the type turns every previously-exhaustive match that doesn't handle it into a compile error, *forcing* you to handle the new case everywhere. It converts "I forgot a case" from a runtime bug into a compile-time obligation.

---

## Tricky / Trap

## Question 22

**In `let x = x + 1;`, what does the right-hand `x` refer to?**

In most languages, the *outer* `x` (or it's an undefined-variable error if none exists) — *not* the variable being declared. The reason is ordering in the analyzer: the initializer `x + 1` is resolved *before* the new `x` is inserted into the scope, so the new binding isn't visible inside its own initializer. This is why your walker must "resolve the right-hand side, then declare the left-hand name." (Functions are the deliberate exception: a function's name is inserted before its body is checked, so recursion works.) The trap is assuming the new `x` is in scope immediately.

## Question 23

**You report five "type mismatch" errors for a program with a single undefined variable. What's the bug?**

You're missing an **ErrorType sentinel / error recovery**. The one undefined name produced an unknown type that propagated up into every enclosing expression, each of which then re-reported a mismatch — a cascade. The fix: when a subexpression has already failed, give it a special `ErrorType` and make every type rule short-circuit on it (if an operand is `ErrorType`, return `ErrorType` and emit *no* new error). Also bind the undefined name to a synthetic `ErrorType` symbol so its other uses don't re-error. Then the error count tracks the number of *independent* mistakes, not the depth of the AST.

## Question 24

**Why can you call a function before it's defined in Java, but not read a local variable before its declaration?**

Because they're resolved by different mechanisms. Class members (methods, fields) are collected in a *separate pass* before any method body is checked, so a method can call another method defined later in the class — order-independent. Local variables inside a method body follow strict top-to-bottom *declaration order* within a single pass, so reading a local before its `int x = ...` is an error. Same language, two rules, both correct — the difference is collect-then-check at class scope versus single-pass declaration order for locals.

## Question 25

**Is "undefined variable" a syntax error or a semantic error? What about "missing semicolon"?**

"Undefined variable" is a **semantic** error: the grammar is perfectly fine (`print(zog)` parses), and the error appears only when name resolution fails to find `zog`. "Missing semicolon" is a **syntax** error: it's caught by the parser because the token stream doesn't form a valid statement. The trap is assuming the compiler's most common errors are syntactic — they're overwhelmingly semantic (undefined names, type mismatches, scope errors), produced by this phase.

## Question 26

**Your `assignable` check uses `==` and rejects `let f: float = 3;`. What's wrong?**

Assignability is **directional**, not equality. A value of type `from` is assignable to a slot of type `to` if `from == to` *or* `from` is a subtype/widening of `to`. `int` is assignable to `float` (widening), so `let f: float = 3` is legal even though `int != float`. Using `==` rejects every legal widening and subtype assignment. The fix is a directional `assignable(from, to)` predicate that handles widening and subtyping — and note it's *asymmetric*: `assignable(int, float)` is true but `assignable(float, int)` is false (narrowing, an error).

## Question 27

**A function has a `return` statement but the compiler says "missing return." How is that possible?**

Because "has a return" is the wrong criterion — the real rule is *the body must not be able to complete normally* (fall off the end). Consider `int f(boolean c) { if (c) return 1; }`: it *has* a `return`, but the `c == false` path reaches the end of the body with no return. The compiler computes reachability over the control-flow graph and finds a path that falls off the end of a non-void function. The trap is thinking a single `return` anywhere is enough; you need *every path* to return (or diverge), which is a reachability property, not a count.

## Question 28

**Rust code that compiled last week now fails to borrow-check after you only moved a `println!` statement. Did the borrow checker break?**

No — borrow checking is *flow-sensitive*, so moving a *use* changes results. Under NLL, a borrow lives from its creation until its *last use*. Moving a reference's last use to a later point *extends* the borrow's live region; if it now overlaps a conflicting (mutable) borrow, the program is correctly rejected. Moving a use *earlier* is, conversely, exactly how you fix such errors — it shrinks the live region. The trap is treating borrow checking as syntactic; it's a dataflow analysis whose result depends on where references are actually used.

## Question 29

**Two parameters named the same, or two `let x` in the same block — which is an error, and why is shadowing in a nested block fine?**

Two parameters with the same name, or two `let x` in the *same* block, are redeclaration errors: both go into the *same* scope's table and collide. But `let x` in a *nested* block that already has an outer `x` is legal **shadowing**: the inner declaration goes into a new, inner scope. The redeclaration check must only inspect the *current* scope for conflicts, never the whole stack — checking the whole stack would wrongly reject legal shadowing. The trap is checking for conflicts across all enclosing scopes instead of just the innermost.

## Question 30

**A dynamically typed language (Python, JavaScript) — does it do semantic analysis at all?**

Yes, just not static *type* checking. It still resolves names (against scopes/environments), and it still enforces non-type rules — `break` outside a loop, `return` outside a function, `yield` outside a generator, duplicate parameter names — at compile/parse time. What it *defers* to runtime is type checking: `5 + "x"` is only caught when the line executes. So "no static types" doesn't mean "no semantic analysis"; it means the type-checking sub-phase is moved to runtime while name resolution and contextual rule checks still happen statically.

---

## Design

## Question 31

**Design a symbol table for a language with nested scopes, shadowing, and forward references at file scope. What are the key decisions?**

Key decisions:
- **Representation**: hash-per-scope with parent links (easy, lookup `O(depth)`) versus one chained table with per-name declaration stacks (lookup `O(1)`, trickier scope-exit). Default to hash-per-scope for a learning/maintainable compiler.
- **Stack vs. tree**: a destructive stack for a one-shot compiler; a persistent parent-linked *tree* if you need to revisit scopes (IDE, multi-pass).
- **Symbol record**: store more than a type — name, kind, type, declaration span, mutability, used-flag — because rules and diagnostics key on these.
- **Lookup direction**: innermost-to-outermost, which implements shadowing.
- **Conflict check**: current scope only, so nested shadowing stays legal.
- **Forward references**: a two-pass design — collect all file/class-scope declarations first, then check bodies.
- **Recovery**: lookup returns "not found" (the caller diagnoses and binds to an error symbol) rather than throwing.

## Question 32

**Design the error-recovery strategy for a compiler so one file with a dozen mistakes yields a dozen useful diagnostics — no more, no fewer.**

Recover at three granularities, all by *salvage* (substitute a plausible value and continue), never by throwing on the first error:
- **Expression level**: poison failed nodes with an `ErrorType` sentinel; every type rule short-circuits on it, emitting nothing — this kills cascades. Bind undefined names to a synthetic `ErrorType` symbol so repeated uses don't re-error.
- **Statement level**: on a malformed statement, report once, skip it, keep the scope consistent, continue with the next. A `let x =` with a bad initializer still inserts `x` as `ErrorType` so later uses resolve.
- **Declaration level**: a function/type with a broken signature still gets inserted with a best-effort (error-typed) signature so *external* references don't cascade; check its independent parts regardless.

The success metric: the diagnostic count equals the number of *independent* mistakes, not the depth of the AST. Every diagnostic carries a source span so it points at the offending code, and the analyzer stops before codegen if any error occurred.

## Question 33

**Design the pass pipeline for a statically typed language with generics, modules, and flow-based checks. Justify the ordering.**

A dependency-ordered pipeline, each pass with a precondition/postcondition:
1. **Parse** → AST with spans.
2. **Collect declarations** (per module/class/file): insert all top-level names and signatures *without* bodies — enables forward references and mutual recursion.
3. **Resolve type references**: resolve every annotation to a concrete type — must precede typing bodies.
4. **Resolve names in bodies**: bind every use — must precede typing (a name's type comes from its binding).
5. **Type-check / resolve overloads & generics**: type every expression, check assignability and bounds; resolution and inference may form a fixpoint here.
6. **Control-flow checks**: definite assignment, reachability, exhaustiveness, borrow checking — require a complete typed AST and a CFG.
7. **Lower / decorate**: emit the typed IR for codegen.

The ordering is forced by data dependencies: you can't type a body before signature types resolve; you can't run flow checks before names and types are known. Each pass asserts its precondition so phase-ordering bugs fail loudly.

## Question 34

**Design name resolution across modules with imports, visibility, and cyclic-import handling.**

Components:
- **Per-module symbol tables** plus a module graph keyed by import paths.
- **Import resolution**: map each `import`/`use` path to a symbol in the target module's table; handle glob imports with the rule that explicit local names win over glob-imported ones.
- **Two-step access**: first *resolve* (does the name exist in the target module?), then *check visibility* (is the referencing site allowed to see it?). Produce distinct diagnostics — "no such name" vs. "private" — and compute *effective* visibility as the minimum along the access path (a `pub` item in a private module is private from outside).
- **Cyclic imports**: use **two-phase, interface-first** resolution — declare every module's exported interface, *then* resolve bodies — which breaks cycles the same way collect-then-check handles forward references within a file. If the language forbids cycles (Go), detect and report them during graph construction.
- **Separate compilation**: emit a stable *module interface artifact* (signatures only) that dependents resolve against, enabling incremental and parallel builds.

## Question 35

**Design a type checker so it can run incrementally in an IDE on every keystroke.**

Restructure the front end from "run passes in order" to **query-driven, demand-based** analysis:
- Express every semantic fact as a **pure, memoized query**: `type_of(node)`, `resolve(node)`, `borrowck(fn)`, `is_exhaustive(match)` — each a function of its inputs with no hidden global mutation.
- **Track dependencies**: record which sub-queries each query reads, so you can invalidate precisely.
- **Invalidate by dependency on edit**: when a source span changes, invalidate only the queries whose inputs changed and, transitively, their dependents — everything else is a cache hit. (Real systems verify validity via a revision counter rather than naive transitive blow-away.)
- **Immutable syntax with structural sharing** (Roslyn-style red-green trees) so unchanged subtrees are reused across edits and identity-based caching works.
- **Robust recovery** is essential: IDE code is incomplete and full of errors on most keystrokes, so the analyzer must salvage and keep producing useful types/bindings for the valid parts.

The payoff: editing one function body re-runs only that function's (and its dependents') analyses, giving millisecond feedback instead of a full rebuild — the architecture behind `rust-analyzer`, Roslyn, and Swift's request-evaluator.

---
