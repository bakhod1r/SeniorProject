# What Metaprogramming Is — Senior Level

> **Topic:** [What Metaprogramming Is](README.md)
> **Focus:** Metaprogramming as a design discipline — staging theory, the power/comprehensibility trade as an explicit engineering decision, how real frameworks compose techniques, and how to reason about the *whole pipeline* a piece of magic flows through.

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
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **When you own the architecture, metaprogramming stops being a feature you use and becomes a budget you allocate.** How do you decide *whether*, *which technique*, and *which stage* — and how do you keep the cost from compounding?

A senior engineer's relationship to metaprogramming is fundamentally different from a junior's. The junior asks "how does this magic work?" The senior asks "should this be magic at all, and if so, *where in the pipeline does it belong, who pays for it, and who maintains it?*" Metaprogramming is one of the highest-leverage and highest-risk tools in software: it can collapse thousands of lines of boilerplate into a single declaration, and it can also create a codebase that only its author understands, where stack traces lie, IDEs are blind, and a "simple" change cascades through generated artifacts nobody reads.

This page treats metaprogramming as a **design discipline**. The central idea is **staging**: every metaprogram runs at some stage of the pipeline (read, expand, type-check, compile, link, load, run), and the entire engineering calculus — performance, safety, debuggability, build complexity, security — follows from *which stage* you chose and *how many stages* the value flows through. The senior skill is to reason about that pipeline end-to-end: a Rust serde annotation, for example, is read at compile time by a proc-macro, which generates trait impls, which are type-checked, which are monomorphized, which become machine code — and a single layer of that chain breaking produces an error far from your `#[derive(Serialize)]`. Owning the architecture means owning that whole chain.

We'll also confront the field's defining tension head-on: **generative power and DRY-ness vs comprehensibility, debuggability, and tooling.** This is not a trade you make once; it's a budget you spend continuously, and seniors are the ones who decide how much of it the team can afford.

> 🏗️ **Why this matters at the senior level:** You set the conventions. If you allow unrestrained runtime intercession, you'll get a codebase with action-at-a-distance bugs. If you forbid all metaprogramming, you'll drown in boilerplate and lose to teams using serde and Spring. The job is to draw the line deliberately — which techniques, which stages, which guardrails — and to make that line legible to everyone who comes after you.

---

## Prerequisites

- **Required:** Fluency with the taxonomy and the stage chain from the middle level (reflection, macros, codegen, annotations, metaclasses, proxies, templates; compile-time vs runtime).
- **Required:** You've debugged at least one framework whose behavior came from reflection, annotations, or generated code.
- **Required:** A working model of a build pipeline (parse → expand → type-check → compile → link → load → run) and of how at least one optimizer (dead-code elimination, monomorphization, inlining) transforms code.
- **Helpful:** Exposure to one mature metaprogramming-heavy framework's internals (Spring, Hibernate, serde, Django, gRPC tooling).
- **Helpful:** Familiarity with how reflection interacts with AOT compilation, tree-shaking, or obfuscation in your stack.

You do **not** need:

- To have implemented a macro expander or reflection runtime — those are the implementation-focused topics of this section.
- Formal staging-calculus theory (we use the engineering intuition, not the type theory).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Staging** | Structuring computation across pipeline stages; deciding what runs early (to generate) vs late (to execute). |
| **Stage chain** | The ordered phases a value/code flows through: read → expand → type-check → compile → link → load → run. |
| **Multi-stage programming (MSP)** | Programming where stages are explicit and type-checked; some code's job is to emit later-stage code. |
| **Monomorphization** | Generating a specialized concrete copy of generic code per type (Rust, C++ templates). A compile-time generative act. |
| **Hygiene** | A macro guarantee that introduced identifiers cannot capture or be captured by user identifiers. |
| **Phase separation** | Keeping meta-level dependencies (needed at build) distinct from object-level dependencies (needed at run). |
| **Reflection-config / keep-rules** | Declarations telling an AOT optimizer not to strip code reached only by name at runtime. |
| **Action at a distance** | Behavior changed somewhere remote from where you read, via intercession (monkeypatch, advice, metaclass). |
| **Closed-world vs open-world** | Whether the full set of types/usages is known at build (closed; enables codegen/AOT) or only at runtime (open; forces reflection). |
| **Provenance / source map** | The mapping from generated/expanded code back to the human-written source that produced it. |
| **Capability** | What a metaprogramming mechanism is *allowed* to do (read types? mutate classes? run arbitrary code?). |
| **Self-invocation** | A method on an object calling another method on the same object, often bypassing a wrapping proxy. |
| **Quasiquotation** | Building code from a template with splice points for computed fragments. |

---

## Core Concepts

### 1. Staging Is the Master Concept

At senior level, stop thinking "compile-time or runtime" as a binary and start thinking of the **full stage chain** and how *a single feature flows across it*. A `#[derive(Serialize)]` is not "compile-time metaprogramming" — it is a value that originates at read-time (the attribute), is consumed at macro-expansion (proc-macro emits an `impl`), is checked at type-check, is specialized at monomorphization, and is finally executed at runtime. Each stage is an opportunity for power *and* a place where errors can surface confusingly.

The senior questions are:

- **At which stage does each piece of meta-work belong?** (The earliest stage that has the necessary information.)
- **How many stages does the value cross, and is the provenance preserved across them?** (Can a runtime error point back to the human source?)
- **What is the cost at each stage?** (Build time, binary size, startup time, per-call time.)

Mastering staging is mastering metaprogramming. Everything else is detail.

### 2. The Power/Comprehensibility Trade Is a Budget, Not a Switch

The field's defining tension: metaprogramming buys **generative power and DRY-ness**; it spends **comprehensibility, debuggability, and tooling**. Crucially, this is not a one-time decision — it's a *budget* that depletes as you add magic:

- The first derive macro is pure win. The fiftieth bespoke proc-macro in a codebase is a maintenance tax.
- One well-known framework's reflection is fine (everyone understands Spring). A homegrown reflective DI container is a liability nobody but its author can debug.

Seniors allocate this budget. A useful framing: **every unit of metaprogramming should buy more than it costs, where "cost" is measured in the comprehension of the *least experienced person who will maintain it*, not the author.** Cleverness that only the author understands is debt, not equity.

### 3. Closed-World vs Open-World Decides the Technique

A deep architectural fork:

- **Closed-world:** the full set of types and usages is known at build time. This *enables* code generation, AOT compilation, monomorphization, and whole-program optimization. Rust, C++, and AOT-compiled Java (GraalVM native-image) live here. Metaprogramming can be pushed early and the runtime pays nothing.
- **Open-world:** new types/plugins/classes appear at runtime. This *forces* reflection and dynamic dispatch, because you cannot generate code for types you haven't seen. JVM with dynamic class loading, Python, and plugin architectures live here.

Many real systems are mostly closed with open edges. The senior move is to *minimize the open-world surface*: do as much as possible at build time (closed), and confine runtime reflection to the genuinely dynamic boundary (plugin loading, deserialization of unknown shapes). This is why "reflection-config" files exist — they re-close a partially-open world for an AOT optimizer.

### 4. How Real Frameworks Compose Techniques

No serious framework uses one technique; they *compose* them across stages. Reading a framework is reading its staging:

- **Spring (Java):** annotations (data) + classpath scanning via reflection (runtime discovery) + dynamic proxies / bytecode generation (runtime intercession for transactions, AOP) + increasingly, annotation processing and AOT for native images (shifting work earlier). The same `@Transactional` is processed differently depending on the deployment target's stage budget.
- **Hibernate (Java):** annotations/XML mapping + runtime reflection to read/write fields + proxies for lazy loading + bytecode enhancement (build- or load-time) to instrument entities.
- **serde (Rust):** `#[derive]` proc-macros generate `Serialize`/`Deserialize` impls at compile time → fully closed-world, zero runtime reflection, monomorphized per type. The *entire* serialization decision is made before the program runs.
- **Django / Rails:** metaclasses and dynamic method generation at class-creation time (runtime) build models, query APIs, and admin interfaces from declarations. Open-world and gloriously dynamic.
- **gRPC / protobuf:** schema → build-time code generation of typed stubs. Closed-world, visible, checked-in (or build-step) artifacts.
- **Mocking libraries:** runtime proxies / bytecode generation to synthesize stand-ins.

The pattern: **the framework absorbs the metaprogramming so its users only see a declaration.** Senior framework authors carry the staging complexity so application authors don't have to. Senior application authors, in turn, choose frameworks partly by *which stage* they do their magic at, because that dictates startup time, native-image compatibility, and debuggability.

### 5. Reflection vs AOT: The Modern Battleground

The most consequential current tension in mainstream metaprogramming is **runtime reflection vs ahead-of-time compilation**. Reflection assumes an open world and a JIT; AOT (GraalVM native-image, Go's static binaries, Rust) assumes a closed world and strips everything unreached. They collide:

- Code reached *only by reflection* (by string name) looks "unused" to an AOT optimizer and gets stripped → `ClassNotFoundException`/`NoSuchMethodError` in production, not in dev.
- The industry's response is to *shift metaprogramming earlier*: Spring's AOT engine, Quarkus, and Micronaut do at *build time* (via annotation processing and codegen) what classic Spring did via runtime reflection — precisely to be native-image-friendly and start in milliseconds.

A senior must know: **runtime reflection is in tension with AOT, fast startup, and small binaries, and the modern trend is to move metaprogramming from runtime to build time.** When you choose a reflection-heavy approach, you are implicitly choosing a JIT-and-warm-up runtime model.

### 6. Multi-Stage Programming and Monomorphization as Disciplined Generation

Generics-via-monomorphization (Rust, C++) are metaprogramming whether or not the language calls it that: the compiler *generates a specialized copy of code per concrete type*. This is principled, type-checked, hygienic code generation — the safe end of the generative spectrum. Contrast with `eval` (the unsafe end: arbitrary code from a string at runtime, no checking). Most of the senior's job is to keep generation as far toward the *monomorphization/derive* end and as far from the *eval/monkeypatch* end as the problem allows — i.e., **prefer generation that is staged early, hygienic, and type-checked over generation that is late, unhygienic, and unchecked.**

### 7. Provenance: The Debuggability Dimension

The single biggest practical cost of metaprogramming is *lost provenance*: when generated/expanded/proxied code fails, can you trace it back to the human source? Mature systems invest heavily here:

- Rust proc-macros can attach spans so errors point at your code, not the expansion.
- Source maps map transpiled JS back to TypeScript.
- Checked-in generated code gives real file/line numbers in stack traces.
- Java's bytecode enhancement preserves line tables.

When provenance is preserved, metaprogramming's debuggability cost is bounded. When it isn't — a stack trace into anonymous proxy `$Proxy17.run()` with no source — the cost is unbounded. **A senior evaluates a metaprogramming technique partly by how well it preserves provenance**, and refuses techniques that don't where the team can't absorb the debugging cost.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Staging across the pipeline** | A supply chain: raw materials → factory → distribution → store → customer. A defect's cost depends on which stage it's introduced and how far it travels. |
| **Power/comprehensibility budget** | Spice in cooking: a little transforms the dish; too much, and nobody but the chef can eat it. |
| **Closed vs open world** | A catered banquet with a fixed menu (closed: optimize everything in advance) vs. an à la carte kitchen serving unknown orders (open: must improvise at runtime). |
| **Reflection vs AOT** | A pre-assembled flat-pack (AOT: everything cut to size, no offcuts shipped) vs. a workshop that keeps every tool around just in case (reflection: heavier, slower to start, infinitely adaptable). |
| **Provenance / source maps** | A receipt trail: when something's wrong, you can trace the product back to the exact batch and machine. |
| **Action at a distance (intercession)** | A building where someone can silently re-wire any room's light switch from a central panel — convenient, and a nightmare to debug. |
| **Framework absorbing complexity** | A car's automatic transmission: enormous mechanical complexity hidden behind one lever so the driver just goes. |

---

## Mental Models

### The "Trace the Whole Pipeline" Model

For any piece of magic, draw its full journey across stages and ask what each stage costs and whether provenance survives it:

```text
  @annotation / macro / schema
        │  read-time
        ▼
  consumed by [processor | proc-macro | generator | reflection]
        │  expand / generate / scan
        ▼
  produced [impl | stub | proxy | injected method]
        │  type-check / compile / monomorphize
        ▼
  executed at runtime  ──►  does an error here point back to the top?
```

Seniors don't reason about "the annotation"; they reason about the entire chain it triggers. The bug is usually in a stage transition, not in any single stage.

### The "Budget Ledger" Model

Keep a mental ledger for the codebase. Each metaprogramming construct has a *credit* (boilerplate removed, errors prevented) and a *debit* (comprehension lost, debugging cost, build complexity, tooling blindness). A healthy codebase runs a surplus. When you find yourself adding magic whose debit exceeds its credit *for the team that will maintain it*, stop — write the boring code. The ledger, not personal taste, is the arbiter.

### The "Push It Earlier" Model

Default instinct: can this run at an *earlier* stage? Earlier means cheaper at runtime, caught sooner, AOT-friendly. The only reason to run later is information that doesn't exist until later (real config, loaded plugins, deserialized shapes). Model your architecture as a gradient where work flows *upstream* (toward build) unless something forces it downstream (toward runtime). This single instinct correlates with most senior-quality metaprogramming decisions.

### The "Capability, Not Convenience" Model

Evaluate a mechanism by what it is *allowed* to do, not how convenient it is. Introspection (read types) is a small capability — low blast radius. Intercession (rewrite live classes, `eval` arbitrary strings) is a huge capability — unbounded blast radius. Grant the *smallest capability that solves the problem*. A serializer needs introspection, not `eval`. A DI container needs scanning, not monkeypatching. Choosing minimum capability is the security-and-maintainability discipline of metaprogramming.

---

## Code Examples

These illustrate *senior-level decisions*: choosing the stage, preserving provenance, minimizing the open-world surface.

### Rust — Staging Made Explicit: `derive` (compile) vs runtime `Any` (open-world escape hatch)

```rust
use std::any::Any;

// CLOSED-WORLD, compile-time generation: serde-style derive (sketch).
// All serialization code exists before runtime; zero reflection.
#[derive(Debug, Clone)]
struct Config { retries: u32 }

// OPEN-WORLD escape hatch: runtime type inspection via `Any`.
// Use ONLY at the dynamic boundary (plugin registry), never in hot paths.
fn handle(obj: &dyn Any) {
    if let Some(c) = obj.downcast_ref::<Config>() {
        println!("got Config with retries={}", c.retries);
    } else {
        println!("unknown type at the dynamic boundary");
    }
}

fn main() {
    let c = Config { retries: 3 };
    println!("{:?}", c.clone());   // generated Debug + Clone, compile-time
    handle(&c);                    // runtime inspection, confined to the boundary
}
```

The senior point: Rust offers both ends of the spectrum. `#[derive]` is closed-world, compile-time, zero-cost. `dyn Any` is the open-world escape hatch — reserved for the genuinely dynamic edge. Confining `Any` to the boundary keeps the world *mostly closed*.

### Java — The AOT/Reflection Collision (and the keep-rule that fixes it)

```java
// This works under a JIT but BREAKS under native-image / aggressive R8:
// the class is reached only by NAME, so the optimizer thinks it's dead.
Class<?> handler = Class.forName(configValue);     // "com.acme.PaymentHandler"
Object instance = handler.getDeclaredConstructor().newInstance();
```

```json
// reflect-config.json — re-closes the world for the AOT compiler:
[
  {
    "name": "com.acme.PaymentHandler",
    "allDeclaredConstructors": true,
    "allDeclaredMethods": true
  }
]
```

The senior lesson made concrete: **reflection by string name is invisible to closed-world optimizers.** Either supply reflection-config (re-close the world) or — better — replace the reflective lookup with build-time code generation so no keep-rule is needed at all. The modern Spring/Quarkus/Micronaut answer is the latter.

### Python — Intercession with a Capability Boundary

```python
# Monkeypatching is maximal capability (action at a distance).
# A senior confines it: scoped, documented, reversible.
import contextlib

@contextlib.contextmanager
def patched(obj, name, replacement):
    original = getattr(obj, name)
    setattr(obj, name, replacement)
    try:
        yield
    finally:
        setattr(obj, name, original)   # provenance + reversibility

class Clock:
    def now(self): return "real-time"

c = Clock()
with patched(Clock, "now", lambda self: "frozen-time"):
    print(c.now())   # frozen-time  -- only inside this scope
print(c.now())       # real-time    -- restored
```

Python *permits* unrestricted intercession; a senior *constrains* it — scoped, reversible, and explicit — so the action-at-a-distance is bounded and auditable. The contrast with an unscoped, permanent monkeypatch (which silently changes behavior program-wide forever) is the whole point.

### Go — Codegen Over Reflection in the Hot Path

```go
// reflect-based generic encoder: flexible, OPEN-WORLD, but SLOW per call.
func encodeReflect(v any) []byte { /* walks reflect.Value every call */ ; return nil }

//go:generate encoder-gen -type=Order
// generated Order_encode.go: a specialized, allocation-free encoder.
// Same input, work moved from RUNTIME (reflect) to BUILD (codegen).
func (o Order) Encode() []byte { /* generated, no reflection */ ; return nil }
```

Go's idiom encodes the senior trade-off into the language's tooling: reflection for flexibility at the boundary, `go generate` to *shift* the hot-path cost to build time and recover speed with code you can read and step through.

### Java — Proxy Self-Invocation Trap (a staging/semantics edge)

```java
@Service
class Billing {
    @Transactional
    public void charge() { doWork(); }     // proxy wraps charge() — OK

    @Transactional
    public void doWork() { /* ... */ }     // self-call below BYPASSES the proxy
}
// Calling billing.charge() runs doWork() via `this`, NOT through the proxy,
// so doWork()'s @Transactional is silently ignored.
```

A senior must know *why*: the proxy intercepts external calls, but `this.doWork()` is an internal call on the real object, not the proxy. This is a direct consequence of intercession-via-proxy being a runtime wrapper rather than a true language construct — a structural limitation, not a bug, and one you only avoid by understanding the mechanism.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **As a design tool** | Collapses boilerplate; encodes invariants once; powers entire framework ecosystems. | Concentrates knowledge; the "budget" depletes; clever code outlives clever people. |
| **Early staging** (codegen, derive, templates) | Zero runtime cost; AOT/native-image friendly; fast startup; errors caught at build. | Slower builds; provenance must be engineered; build-graph dependencies between generators. |
| **Late staging** (reflection, proxies, eval) | Open-world flexibility; adapts to plugins/config/data; minimal build complexity. | Slow per-call; tension with AOT/tree-shaking; production-time failures; tooling blindness. |
| **Closed-world architecture** | Whole-program optimization, monomorphization, small static binaries. | Can't accommodate runtime-loaded types without re-opening the world. |
| **Open-world architecture** | Plugins, hot-loading, dynamic extension. | Forecloses AOT; pays reflection cost; needs keep-rules under optimization. |
| **Provenance investment** | Bounds debuggability cost; stack traces tell the truth. | Real engineering effort (spans, source maps, checked-in artifacts). |

---

## Use Cases

Senior-level decisions about *where* a capability belongs:

- **Serialization, equality, hashing across many types:** generate at compile time (Rust derive, Java APT). Closed-world, zero-cost, AOT-safe. Use runtime reflection (Go, Python) only when the language's bargain makes it idiomatic and the path is cold.
- **Dependency injection / wiring:** prefer build-time (Dagger, Quarkus, Spring-AOT) over runtime classpath scanning when startup time, native-image, or determinism matter; runtime scanning (classic Spring) when developer ergonomics and an open plugin model dominate.
- **Cross-cutting concerns (transactions, AOP, metrics):** proxies/bytecode at runtime for flexibility; be deliberate about self-invocation and proxy identity. Compile-time weaving when you need it everywhere with zero overhead.
- **Plugin systems:** the *one place* open-world reflection is justified. Confine it to the loader; keep the rest closed.
- **High-throughput encode/decode:** never reflect per call; generate specialized code or monomorphize.
- **DSLs:** compile-time hygienic macros where available; otherwise runtime object models — but weigh the comprehension cost against the team.

The meta-use-case: **decide the stage and the capability before the technique.** The technique falls out of those two choices.

---

## Coding Patterns

### Pattern 1: Stage-first design

Before choosing reflection vs codegen vs macro, decide the *stage*: what's the earliest point that has the information? Then pick the technique that fits that stage. Reversing this (picking a technique, then living with its stage) is how teams end up with runtime reflection where build-time codegen belonged.

### Pattern 2: Minimize the open-world surface

Architect so the world is closed by default and open only at explicit, small boundaries (plugin loader, deserializer of unknown shapes). Everything inside the boundary can be generated/monomorphized/AOT-compiled. This pattern is what makes a codebase native-image-ready and fast-starting.

### Pattern 3: Engineer provenance deliberately

For any generation/expansion, ensure errors point back to human source: proper macro spans, source maps, checked-in generated files with real line tables. Treat provenance as a feature, not an afterthought — it caps your debugging cost.

### Pattern 4: Grant minimum capability

Pick the *least powerful* mechanism that works: introspection over intercession, derive over `eval`, scoped patch over global monkeypatch. Smallest blast radius wins on both security and maintainability.

### Pattern 5: Make the magic legible

Where metaprogramming changes behavior, leave a trail: a documented annotation reader, a comment naming the metaclass/proxy, a `// generated by X — do not edit` header. The reader cannot see the mechanism; tell them.

### Pattern 6: Budget the cleverness against the maintainer

Calibrate every metaprogramming decision to the comprehension of the *least experienced maintainer*, not the author. If only you can debug it, it's debt.

---

## Best Practices

- **Decide stage and capability before technique.** These two choices drive performance, safety, AOT-compatibility, and blast radius; the technique is downstream.
- **Push work upstream.** Run metaprogramming at the earliest stage with sufficient information. Move downstream only for genuinely runtime-only data.
- **Keep the world closed; open it only at named boundaries.** This preserves AOT, monomorphization, and fast startup, and confines reflection to where it's unavoidable.
- **Treat runtime reflection as in tension with AOT.** If you depend on it, own the keep-rules/reflection-config and the warm-up cost — or migrate it to build time.
- **Preserve provenance.** No metaprogramming technique earns its place if its failures can't be traced to source the maintainer can read.
- **Prefer hygienic, type-checked generation** (derive, monomorphization, syntactic macros) over unhygienic/unchecked generation (textual macros, `eval`).
- **Constrain intercession.** Scope it, make it reversible, document it. Unbounded action-at-a-distance is a team-scale hazard.
- **Spend the comprehensibility budget consciously.** Each construct must buy more than it costs *for the maintainer*. When it doesn't, write the boring code.
- **Read frameworks by their staging.** Choose dependencies partly on *where* they do their magic, because that dictates startup, native-image fit, and debuggability.

---

## Edge Cases & Pitfalls

- **Reflection stripped by AOT/tree-shaking.** Code reached only by name is "dead" to closed-world optimizers. Symptom: works in dev (JIT), `NoSuchMethod`/`ClassNotFound` in native/optimized prod. Fix: keep-rules or, better, build-time codegen.
- **Proxy self-invocation.** Internal `this.method()` calls bypass the proxy, silently disabling `@Transactional`/advice on the inner call. A structural property of proxy-based intercession.
- **Compile-time blowup and inscrutable errors.** Heavy TMP / const-eval / generic monomorphization can explode build time, binary size, and error message length. Bound recursion; prefer concepts/`constexpr` to raw TMP.
- **Lost provenance.** A stack trace into `$Proxy17` or an anonymous generated unit with no source mapping makes debugging open-ended. Refuse techniques that can't preserve it where you can't afford the cost.
- **Generator ordering / build-graph hazards.** When one generator's output feeds another, unordered builds are flaky. Make inter-generator dependencies explicit in the build graph.
- **Open-world creep.** A codebase that's "mostly closed" but reflects "just here and there" can't be AOT-compiled and starts slowly. The open surface must be a *deliberate, small boundary*, not scattered.
- **Capability inflation.** Reaching for `eval`/monkeypatching where introspection/derive suffices grants far more capability than the problem needs — a security and maintainability liability.
- **Versioned generated code drift.** Generated artifacts checked in but not regenerated diverge from their source schema/macro; CI must verify regeneration matches.
- **Metaprogramming-induced coupling.** A central macro/metaclass that every type depends on becomes a chokepoint: one change reverberates everywhere, and it's a single point of failure for both builds and understanding.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│            METAPROGRAMMING AS DESIGN DISCIPLINE (senior)               │
├──────────────────────────────────────────────────────────────────────┤
│ MASTER CONCEPT: STAGING                                                │
│   read → expand → type-check → compile → monomorphize → link → run     │
│   A feature FLOWS across stages. Reason about the WHOLE chain.         │
│   Push work UPSTREAM unless runtime-only info forces it downstream.    │
├──────────────────────────────────────────────────────────────────────┤
│ DECIDE IN THIS ORDER:                                                  │
│   1. STAGE     (earliest with enough info)                            │
│   2. CAPABILITY(smallest blast radius: introspect < intercede)        │
│   3. TECHNIQUE (falls out of 1 & 2)                                   │
├──────────────────────────────────────────────────────────────────────┤
│ CLOSED-WORLD (build-time, AOT) vs OPEN-WORLD (runtime, reflection)     │
│   keep the world CLOSED; open only at small named boundaries.         │
│   reflection-by-name ⟂ AOT/tree-shaking → keep-rules or codegen.      │
├──────────────────────────────────────────────────────────────────────┤
│ THE BUDGET: generative power + DRY  vs  comprehension + debug + tools  │
│   each construct must buy more than it costs FOR THE MAINTAINER.       │
├──────────────────────────────────────────────────────────────────────┤
│ PROVENANCE is non-negotiable: failures must trace to human source.    │
│ Prefer hygienic/typed generation (derive, monomorph) over eval.       │
│ Frameworks COMPOSE techniques across stages — read them that way.     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- For a senior, metaprogramming is a **design discipline**, not a feature: you allocate it as a budget and own the whole pipeline a piece of magic flows through.
- **Staging is the master concept.** Every metaprogram runs at a stage, and most flow across several (read → expand → check → compile → monomorphize → run). Reason about the full chain; the bug usually lives in a stage transition.
- Decide in order: **stage** (earliest with enough info), **capability** (smallest blast radius — introspection over intercession, derive over `eval`), then **technique** (which falls out of the first two).
- **Closed-world vs open-world** is the architectural fork: closed enables codegen, AOT, monomorphization, fast startup; open forces reflection. Keep the world closed by default; open it only at small, named boundaries (plugin loader, unknown-shape deserialization).
- **Reflection is in tension with AOT/tree-shaking/native-image.** Reflection-by-name is invisible to closed-world optimizers; the modern trend (Spring-AOT, Quarkus, Micronaut) is to *shift metaprogramming from runtime to build time*.
- **Provenance** — the ability to trace generated/proxied/expanded failures back to human source — bounds metaprogramming's debuggability cost. Engineer it deliberately; refuse techniques that destroy it where you can't absorb the cost.
- The **power/comprehensibility trade is a depleting budget**, measured against the *least experienced maintainer*. Clever code only its author understands is debt.
- Real frameworks (Spring, Hibernate, serde, Django, gRPC) **compose** techniques across stages and **absorb** the metaprogramming so their users see only a declaration. Read and choose them by their staging.

---

## Diagrams & Visual Aids

### A Feature's Full Pipeline (with provenance check)

```text
  @derive / @annotation / schema  ◄── human source (provenance origin)
        │ read-time
        ▼
  consumed by proc-macro / APT / generator / reflection scan
        │ expand · generate · scan
        ▼
  emitted impl / stub / proxy / injected method
        │ type-check
        ▼
  monomorphize / compile
        │
        ▼
  link → load → RUN
        │
        ▼
  ⚠ error here:  can it point back to the human source at the top?
                 YES → bounded debug cost.   NO → unbounded.
```

### Closed-World vs Open-World

```text
   CLOSED WORLD (known at build)            OPEN WORLD (appears at runtime)
   ────────────────────────────            ───────────────────────────────
   all types/usages known          new types / plugins / classes load late
        │                                        │
   enables: codegen, AOT,                  forces: reflection, dynamic
   monomorphization, tree-shake,           dispatch, keep-rules, JIT warm-up
   tiny static binary, ms startup
        │                                        │
   SENIOR MOVE: keep closed by default ── open only at a small named boundary
```

### The Reflection ⟂ AOT Collision

```text
  source: Class.forName("com.acme.X")   ← reached only by NAME
        │
        ▼  closed-world optimizer (native-image / R8)
  "X is never referenced statically → DEAD CODE → strip it"
        │
        ▼  RUNTIME
  ClassNotFoundException   (worked under JIT, fails under AOT)

  FIX A: reflect-config / keep-rule  (re-close the world)
  FIX B: build-time codegen          (no reflection at all — preferred)
```

### Capability Ladder (grant the minimum)

```text
  LOW blast radius                              HIGH blast radius
  ───────────────►──────────────►──────────────►────────────────
  introspection   derive / codegen   proxy / advice   monkeypatch / eval
  (read types)    (typed generation) (wrap calls)     (rewrite live / run strings)

  SENIOR RULE: pick the LEFTMOST mechanism that solves the problem.
```

### The Budget Ledger

```text
   CREDIT (this construct buys)        DEBIT (this construct costs)
   ────────────────────────────        ────────────────────────────
   boilerplate removed                 comprehension lost
   invariant encoded once              debugging difficulty
   errors prevented early              tooling blindness
   framework leverage                  build complexity
            ▲                                   ▲
            └────────── must net POSITIVE ──────┘
              measured for the LEAST experienced maintainer
```
