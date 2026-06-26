# Intermediate Representations — Professional Level

> **Topic:** [Intermediate Representations](README.md)
> **Focus:** Designing, evolving, and operating IRs as long-lived infrastructure — multi-level IR architecture and MLIR dialects, the IR-as-contract problem across teams and versions, verification/fuzzing/serialization stability, the cost models that decide where information must live, and the organizational and performance trade-offs senior architects actually litigate.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Architecting a Multi-Level IR](#architecting-a-multi-level-ir)
6. [Mental Models](#mental-models)
7. [Code & Design Examples](#code--design-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [War Stories](#war-stories)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)

---

## Introduction

> Focus: **At this level the IR is not a data structure you build once — it is infrastructure you design, version, verify, fuzz, document, and defend for a decade against pressure from a dozen teams.** The questions stop being "what is SSA" and become "how many IR levels, where does each piece of information live, what is the stability contract, and who gets to change it."

The senior level made you fluent in real IRs. The professional level asks the harder question: if you were *responsible* for one, how would you keep it correct, fast, evolvable, and sane while front-end teams, optimization teams, and back-end teams all push on it simultaneously? Every property the senior page listed — target-independent, analyzable, SSA, typed, verifiable — is in constant tension with the others and with shipping. Add more type information and you catch more bugs but slow construction and constrain front ends. Add more IR levels and each optimization gets the right altitude but you multiply lowering passes, verifiers, and the surface where information silently leaks between levels. Make the textual/binary format stable and you enable separate compilation, caching, and distributed builds — but now you can never *remove* an opcode without a deprecation campaign, because somewhere a cached `.bc` from last quarter still references it.

This is the domain of the people who designed LLVM's bitcode-compatibility policy, who decided rustc needed MIR as a distinct analysis IR, who built MLIR so that domain teams could *add their own IR levels* without forking the compiler, and who, at V8, ultimately decided sea-of-nodes' maintainability cost outweighed its optimization ceiling and built Turboshaft. These are architecture-and-organization decisions with multi-year half-lives. The recurring themes: **the IR is a contract** (between front and back ends, between passes, and across versions of your own compiler when bitcode is cached); **information has a cost and a location** (what must the mid-level IR carry, what can it forget, and what is irrecoverable once lowered); **verification and differential testing are non-negotiable** at scale (a silent miscompile in a compiler used by thousands of projects is a five-alarm fire); and **extensibility is an architecture, not a feature** (MLIR's dialects exist because "add a new abstraction level" was happening anyway, badly, via forks). This page is about owning those decisions.

---

## Prerequisites

- Everything in the senior level: LLVM IR, GCC's GENERIC/GIMPLE/RTL, JVM bytecode, rustc MIR, Cranelift/CLIF, sea of nodes, MLIR dialects, Cytron SSA construction, IR verification.
- SSA, dominance, dominator trees, dominance frontiers, out-of-SSA, critical edges (middle level).
- The pass-manager model and analysis invalidation.
- Practical exposure to at least one real IR's dumps (`-emit-llvm`, `-fdump-tree-*`, `--emit=mir`, `javap -c`).
- Comfort thinking about compilers as *products with users* (other teams, downstream projects, cached artifacts), not just algorithms.

---

## Glossary

| Term | Meaning |
|------|---------|
| **IR contract** | The set of invariants and guarantees the IR promises to its producers (front ends), consumers (passes, back ends), and persisted artifacts (bitcode/serialized IR). |
| **Bitcode compatibility** | A policy guaranteeing that serialized IR from older compiler versions can still be read (auto-upgraded) by newer ones. LLVM maintains backward compatibility for bitcode. |
| **Auto-upgrade** | A reader-side mechanism that rewrites deprecated/old IR constructs into current ones on load, decoupling on-disk format from in-memory IR. |
| **Verifier** | A pass enforcing IR invariants; the line of defense that converts miscompiles into localized assertions. |
| **Differential testing** | Comparing outputs across optimization levels, IR encodings (text↔bitcode round-trip), or compilers to surface miscompiles (e.g., Csmith, Alive2). |
| **Translation validation** | Proving (per-compilation) that a transform preserved semantics — e.g., Alive2 checking an LLVM peephole is correct. |
| **Dialect (MLIR)** | A namespaced, independently-versioned IR sublanguage (ops/types/attrs) representing one abstraction level or domain. |
| **Progressive lowering** | Descending one abstraction level at a time, each step small and verifiable, ideally reusing shared lowerings. |
| **Information loss** | What a lowering irrevocably discards (e.g., loop structure, source-level types, alias facts). Determines where an optimization *must* run. |
| **Metadata** | Non-semantic-but-useful annotations attached to IR (debug info, TBAA alias info, profile counts, `!range`). Droppable without changing meaning, but valuable. |
| **Canonicalization** | Rewriting equivalent IR into a single normal form so later passes have fewer cases to handle. |
| **Effect system / memory model in IR** | How the IR encodes side effects, ordering, atomics, and aliasing so the optimizer can move/eliminate operations soundly. |
| **OSR / deopt** | On-stack replacement / deoptimization: JIT mechanisms tying optimized IR back to interpreter state; constrain how aggressively IR can be reordered. |
| **Stable ID / provenance** | A durable handle from IR back to source (debug locations, value provenance) needed for diagnostics, sanitizers, and pointer-provenance reasoning. |

---

## Core Concepts

### 1. The IR is a contract with three audiences (and time)

An owned IR answers to:

- **Producers** — every front end that emits it. They want expressiveness and stability of the *input* contract; a breaking IR change forces every front end to update in lockstep.
- **Consumers** — every analysis/transform pass and every back end. They rely on invariants (SSA holds, types are sound, the CFG is well-formed, dominators are valid here). Weakening an invariant can silently break dozens of passes that assumed it.
- **Persisted artifacts** — if you serialize IR (LLVM bitcode, a cached MIR, a Wasm module), *past versions of yourself* are now a consumer. A `.bc` produced six months ago by an older compiler may be linked today (ThinLTO, distributed/cached builds). This forces **backward-compatibility policy** and **auto-upgrade**.

The professional discipline is to treat these as a *versioned interface*, not an implementation detail. LLVM, for instance, guarantees that older bitcode loads into newer LLVM (with auto-upgrade rewriting deprecated constructs); the textual `.ll` form is explicitly *less* stable, which is itself a deliberate contract decision (text is for humans and tests, bitcode is the durable wire format).

### 2. Information has a location and a cost

Every optimization needs certain facts, and facts live at certain altitudes:

- **Loop structure** is obvious in high-level IR, recoverable (via loop analysis) in mid-level CFG/SSA, and *gone* once lowered to flat machine code. So loop optimizations must run before that information is lost — or be re-derived at cost.
- **Source-level types and aliasing intent** (e.g., C's strict aliasing, Rust's `&mut` exclusivity) are present at the front end and must be *encoded as IR metadata* (TBAA, `noalias`) to survive lowering, because the optimizer otherwise cannot prove two pointers don't alias.
- **Overflow/UB facts** (`nsw`, `nuw`, `poison`) are front-end knowledge encoded into the IR so the mid-level optimizer can exploit them soundly.
- **Profile data** (branch weights, call counts) is metadata threaded through so PGO/FDO passes can prioritize.

The architectural question for any IR feature is therefore: **does this information need to survive to the pass that uses it, and if so, is it carried as a first-class construct, as droppable metadata, or re-derived by analysis?** Getting this wrong means either an optimization that can never fire (information lost too early) or an IR bloated with facts nobody consumes.

### 3. Verification, canonicalization, and the correctness budget

At scale, correctness is engineered, not hoped for:

- **Verifier** — enforces invariants after every transform in debug/CI builds. The non-negotiable floor.
- **Canonicalization** — collapses equivalent IR into one form (e.g., `x + 0 → x`, constants on the right, a single canonical loop shape) so downstream passes handle fewer cases and pattern-matching is reliable. MLIR makes canonicalization a first-class, per-op concept.
- **Translation validation / formal tooling** — tools like **Alive2** check that LLVM peephole optimizations are semantically correct (including UB/poison semantics), and **Csmith**-style random program generators feed **differential testing** across optimization levels and compilers. These catch the miscompiles that slip past unit tests.

A professional treats the verifier + canonicalizer + differential/translation-validation tooling as a *correctness budget*: how much of it you can afford to run continuously, and where you spend it (every commit vs nightly fuzzing).

### 4. The IR's memory/effect model is part of its semantics

Beginners think of an IR as "instructions." A production IR must precisely define **side effects, ordering, atomics, and aliasing**, because every "can I move/delete this?" optimization is a question about effects. LLVM encodes this through memory attributes, `atomic` orderings mirroring the C/C++ memory model, `noalias`/`readonly`/`readnone`, and TBAA metadata. Get the effect model wrong and the optimizer will, entirely "correctly" per the IR's stated rules, delete a volatile store or reorder across a fence — a real miscompile. The IR's semantics are *the contract for soundness*, and they must be written down, not folklore.

### 5. Extensibility as architecture: why MLIR exists

The pre-MLIR reality was that every domain that needed a higher-level abstraction (ML frameworks, hardware synthesis, polyhedral loop optimizers) either forked LLVM, bolted ad-hoc passes on, or built a private IR and a fragile bridge. MLIR's thesis: **make adding an IR level a supported, first-class operation.** A **dialect** is an independently-defined, independently-verified set of ops/types/attributes; dialects coexist in one module and lower into one another through shared infrastructure (rewrite patterns, a common verifier, a common pass manager, location/debug propagation). This turns "we need a new abstraction level" from a fork into a plugin. The professional lesson is not "use MLIR" but **design for extension**: assume someone will need a level you didn't anticipate, and make that addition cheap and verifiable rather than a fork.

### 6. Compile-time is a first-class output

Peak runtime performance is one axis; **compile time and predictability** are another, and for many users the dominant one. Cranelift exists because Wasm JITs and debug builds need *fast, predictable* compilation more than they need the last 10% of runtime speed. ThinLTO exists because monolithic LTO didn't scale to large programs. A professional IR architect treats compile-time, memory footprint of the IR, and determinism (reproducible builds) as outputs to be measured and budgeted — not afterthoughts. "The IR is 3x larger and constructs 2x slower but enables one more optimization" is a trade you must quantify, not assume.

---

## Architecting a Multi-Level IR

When you design the IR stack for a new compiler, the recurring decisions are:

1. **How many levels?** Too few and one IR juggles language-specific and machine-specific concerns (bugs, complexity). Too many and you pay for every lowering, verifier, and inter-level leak. GCC chose three; LLVM is effectively two (front-end-emitted LLVM IR + machine IR / SelectionDAG/GlobalISel), increasingly augmented by MLIR above it; rustc inserts MIR as an analysis level above LLVM IR. Decide by *which optimizations and analyses need which altitude*.

2. **Where does each analysis run?** Borrow checking → a high, control-flow-explicit level (MIR). Inlining/GVN/LICM → mid-level SSA. Register allocation/scheduling → low-level machine IR. Map each analysis to the altitude where its required information still lives.

3. **What's the SSA encoding?** φ-functions (LLVM, GIMPLE) vs block parameters (Cranelift, MLIR, Swift SIL). Block parameters compose better with generic argument handling and avoid special-casing φ in every pass.

4. **What's the stability contract per level?** In-memory IR can churn freely. A serialized level (bitcode, cached MIR, Wasm) needs a versioning + auto-upgrade policy. Decide *which* levels are persisted before you ship, because retrofitting stability is brutal.

5. **How is the effect/memory model specified?** Write down side-effect, ordering, atomic, and aliasing semantics explicitly. This is the soundness contract; folklore here causes miscompiles.

6. **How do you verify and test it?** Per-op verifiers, a module verifier, round-trip (print→parse→print) testing, differential testing across opt levels, and — if you can afford it — translation validation on the riskiest passes.

7. **Who owns it and how does it evolve?** A breaking IR change touches every producer and consumer. Establish an RFC/deprecation process before the IR has many stakeholders, not after.

---

## Mental Models

### The "IR is an API with SLAs" model

Treat the IR like a public API. It has producers and consumers, versioned guarantees, deprecation policies, and breaking-change costs. The serialized form has the strongest SLA (old artifacts must keep loading); the in-memory form has the weakest (refactor freely). Every IR change is an API change — scope it, communicate it, and provide a migration path (auto-upgrade is the IR's "deprecation shim").

### The "altitude ledger" model

For every piece of information the optimizer might need, keep a mental ledger: at what altitude is it *born* (front end, an analysis), at what altitude is it *consumed* (which pass), and at what altitude is it *destroyed* (which lowering). If consumption is below birth, fine. If consumption is below destruction, you have a bug-in-waiting: the optimization can never fire because the info is already gone. The ledger tells you what must be carried as metadata across a lowering boundary.

### The "correctness budget" model

You cannot run every verification tool on every build. Model verification as a budget: cheap invariant verifier on every commit; round-trip and canonicalization checks in CI; expensive differential fuzzing and translation validation nightly or on release branches. Spend the budget where miscompiles are most likely (new peepholes, UB-sensitive transforms) and most costly (anything shipped to thousands of downstreams).

### The "extension is the default request" model

Assume the next big ask is "support abstraction level X we didn't plan for" — a new accelerator, a new language feature, a new domain. If adding a level means forking the compiler, you've already lost. Architect so a new level is a dialect/plugin with its own verifier and lowerings, reusing shared infrastructure. MLIR is one answer; the principle outlives any framework.

---

## Code & Design Examples

### Example 1: Carrying alias intent across a lowering boundary (metadata)

A front end knows two pointers can't alias (Rust `&mut`, C `restrict`). If that knowledge isn't encoded, the mid-level optimizer must assume they might, and it can't reorder/eliminate loads:

```llvm
; Without noalias, the optimizer must assume %p and %q may overlap.
define void @copy(ptr %p, ptr %q) {
  ...
}

; With noalias, the load through %q can be hoisted/CSE'd across the store to %p.
define void @copy(ptr noalias %p, ptr noalias %q) {
  ...
}
```

The `noalias` attribute is front-end knowledge *encoded into the IR contract* so it survives to the pass that needs it. Drop it and a whole class of optimizations silently dies — an "altitude ledger" failure.

### Example 2: An effect fact that licenses (or forbids) a transform

```llvm
; A plain store can be eliminated if provably dead.
store i32 0, ptr %x

; A volatile store must NEVER be removed or reordered: it's an observable effect.
store volatile i32 0, ptr %x

; An atomic store participates in the memory model; ordering constrains motion.
store atomic i32 0, ptr %x release, align 4
```

The IR's effect model is what makes these three semantically different to the optimizer. A miscompile here (treating volatile as plain) is exactly the kind of bug the *written-down* memory model and the verifier exist to prevent.

### Example 3: A canonicalization that pays for itself downstream

```text
Before canonicalization:        After:
  %a = add i32 0, %x              %a = %x            ; identity folded
  %b = mul i32 %y, 2             %b = shl i32 %y, 1  ; strength-reduced/canonical
  %c = icmp eq i32 %z, %w        (constant on a fixed side, commutative ops normalized)
```

By normalizing equivalent forms into one, every downstream pattern-matcher handles fewer cases and fires more reliably. MLIR elevates this to a per-op `fold`/`canonicalize` hook; LLVM does it in InstCombine/InstSimplify.

### Example 4: Auto-upgrade as the IR's deprecation shim

```text
Old bitcode (v14) references a now-removed intrinsic:  @llvm.foo.legacy(...)
New compiler (v18) on load:  auto-upgrade rewrites it -> @llvm.foo.v2(...)
Result: a 2-year-old cached .bc still links into today's ThinLTO build.
```

This single mechanism is what lets the *in-memory* IR evolve while the *on-disk* contract stays stable. Designing it in early is cheap; bolting it on after artifacts proliferate is not.

### Example 5: Choosing the analysis altitude (rustc MIR)

Borrow checking needs control-flow-explicit, simplified Rust with explicit moves/drops — so rustc lowers HIR→**MIR** specifically to host that dataflow, *then* lowers MIR→LLVM IR for codegen. The design choice is "create an analysis-purpose IR level at the altitude where the needed information (places, moves, drop points, lifetimes) is explicit," rather than trying to borrow-check the AST (too unstructured) or LLVM IR (too low; Rust types already erased).

---

## Pros & Cons

| Decision | Pros | Cons |
|----------|------|------|
| **More IR levels** | Each optimization/analysis at its right altitude; cleaner passes | More lowerings, verifiers, inter-level leaks; more compile time |
| **Richer types in IR** | Verifier catches more; better lowering | Slower construction; constrains front ends; bigger IR |
| **Serialized/stable IR** | Separate compilation, caching, ThinLTO, distributed builds | Permanent backward-compat burden; auto-upgrade machinery |
| **Extensible (dialects)** | New levels without forks; ecosystem leverage | Infra complexity; governance of who adds what |
| **Aggressive effect modeling** | Sound, powerful optimization | Easy to misspecify; subtle miscompiles if wrong |
| **Compile-time-first IR (Cranelift)** | Fast, predictable, great for JIT/debug | Lower peak runtime performance |
| **Translation validation / fuzzing** | Catches miscompiles tests miss | Expensive; needs budget and infra |

---

## Use Cases

- **Owning a language's compiler back end**: choosing LLVM vs Cranelift vs a custom MLIR pipeline, and defining the analysis levels (à la MIR) your language's semantics require.
- **Building a domain-specific compiler** (ML, DSP, HDL): stacking MLIR dialects with progressive lowering rather than one monolithic IR.
- **Operating a compiler at scale**: bitcode compatibility policy, auto-upgrade, ThinLTO caching, reproducible builds.
- **Hardening correctness**: standing up differential testing (Csmith-style), translation validation (Alive2-style), and a continuously-run verifier.
- **Performance engineering**: deciding where information must live so an optimization can fire; budgeting compile time vs runtime.
- **JIT architecture**: tiered IRs (interpreter → baseline → optimizing), deopt/OSR ties from optimized IR back to interpreter state, and when sea-of-nodes' freedom is worth its maintainability cost.

---

## Coding Patterns

### Pattern 1: Per-op verifier + module verifier, always on in CI

```text
each op defines verify():   shape, types, operand counts, region constraints
module verifier:            SSA dominance, terminators, phi/block-arg arity,
                            type consistency across the whole module
CI: run verifier after EVERY pass in assert builds
```

### Pattern 2: Round-trip and differential testing in the pipeline

```text
round-trip:    IR --print--> text --parse--> IR' ; assert IR == IR'
differential:  for opt in {O0,O1,O2,O3}: run(program, opt) -> same observable result
fuzz:          Csmith-style generator -> compile at all opt levels -> compare
validate:      Alive2-style check on risky peepholes (UB/poison-aware)
```

### Pattern 3: Encode front-end knowledge as IR facts, not comments

```text
aliasing intent  -> noalias / restrict / TBAA metadata
overflow facts   -> nsw / nuw / poison
value ranges     -> !range metadata
profile data     -> branch_weights / function-entry counts
```

If the optimizer can't see it in the IR, it doesn't exist.

### Pattern 4: Lower progressively, reuse shared lowerings

```text
domain dialect -> structured-control-flow dialect -> llvm dialect -> LLVM IR
each arrow: small, separately tested, verifiable; reuse common patterns across dialects
```

### Pattern 5: Treat the serialized format as a versioned protocol

```text
on write: tag with format version
on read:  if older, run auto-upgrade rewrites to current
policy:   never silently change serialized semantics; deprecate, shim, then remove
```

---

## Best Practices

- **Write down the IR's semantics — especially the effect/memory model.** Soundness is a specification, not folklore. Volatile, atomic, aliasing, and UB must be defined, not assumed.
- **Run the verifier after every pass in assert/CI builds.** Convert miscompiles into localized assertions at the offending pass.
- **Keep an explicit altitude ledger.** Know where each fact is born, consumed, and destroyed; carry across lowerings only what's actually consumed downstream.
- **Make the serialized format a versioned contract with auto-upgrade.** Decide which levels persist *before* artifacts proliferate; never break old artifacts silently.
- **Invest in differential testing and (for risky passes) translation validation.** Csmith/Alive2-style tooling catches the bugs unit tests can't.
- **Canonicalize aggressively.** Fewer equivalent forms means simpler, more reliable downstream passes.
- **Budget compile time and IR memory as outputs.** Measure them; a "free" optimization that doubles compile time often isn't worth it.
- **Architect for extension.** Assume a new abstraction level will be requested; make it a dialect/plugin, not a fork.
- **Govern IR changes like an API.** RFCs, deprecation windows, migration shims; a breaking change touches every producer and consumer.
- **Propagate provenance/debug locations through every lowering.** Diagnostics, sanitizers, and reproducible debugging depend on the IR→source link surviving.

---

## Edge Cases & Pitfalls

- **Information destroyed before its consumer runs** (the altitude-ledger bug): an optimization that *can never fire* because the lowering above it already discarded the needed fact. Silent, and shows up as "the compiler should have optimized this but didn't."
- **Effect-model misspecification**: treating a volatile/atomic/observable op as pure; the optimizer "correctly" eliminates or reorders it per the (wrong) rules. A genuine miscompile.
- **Serialized-format drift**: changing bitcode/Wasm/cached-MIR semantics without versioning; old artifacts now mean something different. Breaks caching, ThinLTO, distributed builds non-deterministically.
- **Verifier gaps**: an invariant assumed by many passes but not actually *checked*; a transform violates it and the failure manifests far downstream.
- **Metadata treated as load-bearing**: optimizers may drop metadata; if correctness (not just performance) depends on metadata that's allowed to vanish, you have a soundness bug. Metadata must be *droppable without changing meaning*.
- **Canonicalization loops / non-confluence**: two canonicalizers that undo each other, or a rewrite that never reaches a fixpoint — infinite compile or non-deterministic output.
- **Deopt/OSR vs aggressive reordering**: optimizing IR so freely that you can't reconstruct interpreter state at a deopt point; tier transitions and exceptions become unsound.
- **Cross-level type erasure**: an analysis needs a source-level type already erased at this altitude; either move the analysis up or carry the type as metadata.
- **Irreducible control flow at scale**: front ends emitting `goto`/computed-jump spaghetti that defeats reducible-loop assumptions; node-splitting blows up code size.

---

## Common Mistakes

1. Treating the IR as an implementation detail rather than a versioned, multi-audience contract.
2. Losing information (loop structure, types, alias intent) before the optimization that needs it can run.
3. Leaving the effect/memory model implicit, then shipping a volatile/atomic miscompile.
4. Shipping a serialized IR with no version field or auto-upgrade path.
5. Relying on metadata for correctness when metadata is allowed to be dropped.
6. Not running the verifier after every pass, then debugging a miscompile across the whole pipeline.
7. Skipping differential/fuzz testing and discovering miscompiles in the field.
8. Over-leveling the IR (too many altitudes) and drowning in lowering/verifier overhead.
9. Under-leveling (one IR for everything) and mixing language- and machine-specific concerns.
10. Forking the compiler to add an abstraction level instead of designing for extension.
11. Optimizing only for runtime, ignoring compile time / IR memory / determinism as outputs.
12. Breaking the IR-as-API contract without an RFC, deprecation window, or migration shim.

---

## Tricky Points

- **LLVM's stability contract is asymmetric**: bitcode is backward-compatible (old loads into new via auto-upgrade); textual `.ll` is deliberately *not* a stable interface. That asymmetry is a design choice (durable wire format vs human/test format), not an accident.
- **Metadata is, by definition, semantically inert** — droppable without changing meaning. The instant correctness depends on it, you've violated its contract.
- **Canonicalization must be confluent and terminating**, or you get non-deterministic builds or infinite loops; this is a real engineering constraint, not a nicety.
- **The effect model *is* the optimization contract.** Every "can I move/delete this?" reduces to "what effects does the IR say this has?" Misspecify effects and you've authorized miscompiles.
- **A new IR level is the most expensive kind of change** because it multiplies lowerings, verifiers, and the inter-level leak surface — yet sometimes it's exactly right (MIR for borrow check). The skill is knowing which.
- **Sea-of-nodes' optimization ceiling and its maintenance floor are the same property** (floating nodes). V8's Turboshaft retreat is the canonical "we paid too much for the ceiling" decision.
- **Reproducible builds constrain the IR**: any nondeterminism (hash-set iteration order, pointer-address-dependent decisions) leaks into output and breaks caching/bit-identical builds.
- **Provenance must survive lowering** for sanitizers, debuggers, and (increasingly) pointer-provenance semantics; an optimization that breaks provenance silently breaks tooling and, in some models, correctness.

---

## War Stories

- **The optimization that could never fire.** A team noticed a guaranteed-redundant load was never eliminated. Cause: the front end's `noalias` intent was dropped during an early lowering, so the mid-level optimizer conservatively assumed aliasing. The fix wasn't in the optimizer — it was carrying the fact across the lowering boundary. Lesson: *altitude ledger*.
- **The volatile that vanished.** A peephole pattern matched a store-then-store and removed the first, not realizing one was `volatile`. Tests passed (no observable difference in the test harness); a device driver in the field lost a register write. Lesson: *the effect model is the contract; the verifier and tests must encode it.*
- **The cached bitcode that meant something else.** A semantics tweak to an instruction shipped without a format-version bump. Distributed-build caches still held old `.bc`; linking old + new produced subtly wrong code, non-deterministically depending on cache hits. Lesson: *serialized IR is a versioned protocol; auto-upgrade or bust.*
- **Sea of nodes, the maintainability bill.** V8's TurboFan delivered top-tier performance via sea-of-nodes, but the team found the graph IR hard to reason about, extend, and debug; they invested in **Turboshaft**, a more conventional CFG-based IR, trading a sliver of optimization freedom for maintainability and developer velocity. Lesson: *the most powerful IR is not always the right one; total cost of ownership counts.*
- **Alive2 finds the "obvious" peephole wrong.** Several long-standing LLVM peepholes turned out to be unsound under poison/undef semantics — found not by tests but by translation validation. Lesson: *for UB-sensitive transforms, formal tooling earns its keep.*

---

## Test Yourself

1. You're designing the IR stack for a new systems language with a borrow-checker-like analysis. How many IR levels, and at what altitude does the borrow analysis run? Justify via the altitude ledger.
2. Your mid-level optimizer never eliminates a provably-dead load. List three IR-design reasons (information loss, missing metadata, effect-model conservatism) and how you'd diagnose which it is.
3. Specify the minimum effect model your IR needs to *soundly* support dead-store elimination in the presence of volatile and atomic stores.
4. You must ship a serialized IR. Design the versioning + auto-upgrade policy and state exactly what you guarantee to (a) producers, (b) consumers, (c) old on-disk artifacts.
5. Argue when adding a new IR level pays for itself versus when it's over-engineering. Give a concrete example of each.
6. Design a correctness budget: which verification/fuzz/validation tools run per-commit, in CI, and nightly, and why.
7. Explain why canonicalization must be confluent and terminating, and give an example of a non-confluent rewrite pair.
8. Make the case both for and against sea-of-nodes for a new top-tier JIT, in terms of total cost of ownership (cite the Turboshaft decision).

---

## Cheat Sheet

```
+------------------------------------------------------------------+
|          INTERMEDIATE REPRESENTATIONS — PROFESSIONAL            |
+------------------------------------------------------------------+
| IR = CONTRACT (3 audiences + time)                              |
|   producers (front ends) | consumers (passes/back ends)         |
|   persisted artifacts (old bitcode/MIR/Wasm = future consumer)  |
|   serialized form: versioned + AUTO-UPGRADE; text != stable     |
|                                                                  |
| INFORMATION HAS ALTITUDE                                         |
|   born (front end/analysis) -> consumed (pass) -> destroyed(low) |
|   if consumed below destroyed -> opt can NEVER fire             |
|   carry survivors as metadata (TBAA/noalias/nsw/!range/profile) |
|                                                                  |
| EFFECT MODEL = OPTIMIZATION CONTRACT                            |
|   plain | volatile (never remove/reorder) | atomic (ordering)   |
|   misspecify -> "correct" miscompile                            |
|                                                                  |
| CORRECTNESS BUDGET                                              |
|   per-commit : verifier after every pass                       |
|   CI         : round-trip print/parse, canonicalization        |
|   nightly    : differential (Csmith) + translation valid (Alive2)|
|                                                                  |
| ARCHITECTURE                                                    |
|   how many levels? map each analysis to its altitude           |
|   SSA encoding: phi vs block-params                            |
|   canonicalize (confluent + terminating)                       |
|   design for EXTENSION (dialects, not forks)                   |
|   compile-time / IR-size / determinism are OUTPUTS             |
|                                                                  |
| WAR-STORY LESSONS                                               |
|   dropped noalias -> dead opt   | vanished volatile -> miscompile|
|   unversioned bitcode -> nondet | sea-of-nodes -> TCO retreat   |
+------------------------------------------------------------------+
```

---

## Summary

- A production IR is a **versioned contract** with three audiences — producers (front ends), consumers (passes/back ends), and persisted artifacts (old serialized IR is a future consumer) — plus time itself; serialized forms demand backward compatibility and **auto-upgrade**, while in-memory and textual forms can churn.
- **Information has altitude and cost.** Map every fact (loop structure, types, alias intent, overflow/UB, profile) from where it's born to where it's consumed to where it's destroyed; carry across lowerings only what downstream passes actually use, as first-class constructs or droppable metadata.
- The IR's **effect/memory model is its soundness contract.** Volatile, atomic, and aliasing semantics must be written down; misspecification authorizes "correct" miscompiles.
- Correctness at scale is **engineered**: an always-on verifier, aggressive (confluent, terminating) canonicalization, and a budgeted ladder of round-trip, differential (Csmith-style), and translation-validation (Alive2-style) testing.
- **Multi-level IR architecture** is a series of trade-offs: how many altitudes, where each analysis runs (rustc's MIR for borrow checking is the model), φ vs block-parameter SSA, and which levels are serialized. Too few levels mixes concerns; too many multiplies overhead and inter-level leaks.
- **Extensibility is an architecture, not a feature** — MLIR's dialects make "add a new IR level" a plugin instead of a fork; design for the abstraction level you didn't anticipate.
- **Compile time, IR memory, and determinism are first-class outputs.** Cranelift exists for fast/predictable compilation; reproducible builds constrain IR nondeterminism.
- The recurring senior-architect lessons — dropped alias facts killing optimizations, vanished volatiles causing miscompiles, unversioned bitcode causing nondeterminism, and sea-of-nodes' optimization ceiling not justifying its maintenance floor (V8's Turboshaft) — all reduce to treating the IR as **owned, contractual, sound-by-specification infrastructure**.
