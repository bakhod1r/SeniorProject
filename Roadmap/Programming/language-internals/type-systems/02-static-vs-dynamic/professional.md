# Static vs Dynamic Typing — Professional Level

> **Topic:** [Static vs Dynamic Typing](README.md)
> **Focus:** The engineering consequences that decide real systems — performance, the empirical bug-rate evidence, the industry's static-over-dynamic trend, and what it actually takes to migrate a large Python/JS codebase.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **When the architecture review asks "static or dynamic, and why," what evidence and engineering reality do you bring?** Performance characteristics, the (genuinely mixed but trending-positive) research on bugs, the reason every major dynamic language is bolting on static checking, and the playbook for migrating a million-line codebase without stopping the world.

By this level the *mechanics* are settled. The professional questions are economic and empirical:

- **Performance:** static typing isn't just a correctness tool — it's a *performance* enabler. Knowing a value's type at compile time lets the compiler do **monomorphization**, **inlining**, and **field-offset addressing**, and skip **runtime type tags and checks** entirely. Dynamic languages pay a per-operation tax — but modern JITs (V8, PyPy, the JVM) claw most of it back with **inline caches** and **hidden classes / shapes**, which is why "dynamic = slow" is a decade out of date. You need to articulate *where* the costs are and *how* JITs recover them.
- **Does it actually reduce bugs?** This is where seniors who've read the literature separate from those repeating folklore. The empirical record is **mixed but trends positive**, especially for *large, long-lived, multi-contributor* codebases — and the most-cited industrial results (the TypeScript/Flow study finding ~15% of public bugs were preventable by types) come with real caveats about what "preventable" means.
- **The industry trend is unmistakable and one-directional:** TypeScript ate JavaScript; mypy/Pyright are standard at scale; Stripe built Sorbet for Ruby; Meta built Hack for PHP; Instagram, Dropbox, and others publicly migrated. *Nobody* is building a static-to-dynamic migration tool. Understanding *why* the gradient points one way is core professional judgment.
- **Migration is a discipline, not a flag.** Turning on a type checker over a large dynamic codebase is a multi-quarter program with its own failure modes (the `any` flood, the unsound boundary, the stub-quality problem). You need the playbook.

> 🎓 **Why this matters for a professional:** You will own the call on language and type-discipline for systems that outlive your tenure, and you'll defend it to people who hold strong priors in both directions. "I prefer types" is not an argument. "Here's the JIT cost model, here's what the bug research actually shows and its limits, here's why every comparable org migrated *toward* static and what it cost them" — that's an argument. This page is that argument, with its caveats intact.

---

## Prerequisites

- **Required:** `junior.md`, `middle.md`, `senior.md` — especially soundness, erasure vs reification, gradual typing, and the `any` boundary.
- **Required:** A working mental model of how a JIT works (interpret → profile → compile hot paths) and what a CPU cache line is.
- **Required:** Experience operating a real codebase of nontrivial size in at least one dynamic language.
- **Helpful:** Having read or skimmed at least one empirical typing study, or having lived through a TypeScript/mypy adoption.

You do **not** need to know:

- The internal IR of a specific JIT compiler.
- The statistical methods of the empirical studies in depth (we discuss their *claims and caveats*).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Monomorphization** | Compiling a generic/polymorphic function into a separate specialized copy per concrete type, enabling inlining and zero dispatch. Rust, C++ templates, some Swift. |
| **Boxing** | Wrapping a value in a heap object carrying a type tag (so it can be treated uniformly/dynamically), vs. an unboxed raw machine value. |
| **Type tag** | Runtime metadata on a (reified) value identifying its type; read on every dynamic operation. |
| **Inline cache (IC)** | A JIT optimization caching the resolved type/method at a call site so repeat executions skip the lookup. Monomorphic/polymorphic/megamorphic. |
| **Hidden class / shape / map** | A JIT's runtime structure assigning fixed field offsets to objects with the same layout, turning dynamic property access into a fast offset read. |
| **Speculation / deopt** | A JIT compiles assuming observed types hold; if an assumption breaks, it **deoptimizes** back to the interpreter. |
| **Stub / `.d.ts` / `.pyi`** | External type declarations for code whose source isn't annotated (libraries) — the boundary quality determines migration safety. |
| **`any` flood** | The failure mode where a migration types everything as `any` to silence errors, producing the appearance of types with none of the safety. |
| **DefinitelyTyped / typeshed** | Community repositories of type stubs for the JS and Python ecosystems. |
| **Strict mode** | The strongest checker configuration (`strict: true`, `--strict`, `strictNullChecks`) — where most of the safety actually lives. |
| **Ratchet** | A CI policy that lets type coverage only increase, never regress, during a long migration. |

---

## Core Concepts

### 1. Why Static Types Make Code Faster

A statically known type is *information the compiler can spend*. With it, several optimizations become possible that are hard or impossible without it:

- **No runtime type checks/tags.** If the compiler *knows* `x` is an `int`, it emits an integer `add` directly — no "what type is `x`? does it support `+`? dispatch to its `__add__`" at runtime. Dynamic languages do exactly that dispatch on *every* operation.
- **Unboxed representations.** A statically typed `int` can live in a register or a flat array slot as raw bytes. A dynamically typed `int` is often **boxed** — a heap object with a type tag — so arrays of them are arrays of pointers (cache-hostile, allocation-heavy).
- **Field access by fixed offset.** A static `struct`/class has a known layout; `p.x` compiles to "load from `p + 8`." A dynamic object is typically a hash map of names → values; `p.x` is a dictionary lookup (until a JIT optimizes it — see hidden classes).
- **Monomorphization & inlining.** Knowing concrete types lets the compiler generate a specialized copy of a generic function and **inline** it, removing call overhead and enabling further optimization. This is why Rust/C++ generics are zero-cost and Java's erased generics (boxed, virtual dispatch) often aren't.
- **Devirtualization.** Static type info lets the compiler prove which concrete method a call resolves to and inline it, eliminating the vtable indirection.

The headline: **static typing converts runtime decisions into compile-time facts, and facts are free at runtime.**

### 2. What Dynamic Typing Pays — and How JITs Claw It Back

Naively interpreted, dynamic code pays a tax on every operation: read both operands' type tags, look up the operation, possibly box/unbox, dispatch. A property access `obj.x` is a hash lookup. This is real, and it's why a naive interpreter (CPython) is ~10–100× slower than native for tight numeric loops.

But the modern story is **JIT recovery**, and a professional must explain it:

- **Hidden classes / shapes / maps (V8, SpiderMonkey, HotSpot for objects):** the JIT observes that objects created the same way share a layout, assigns them a *hidden class* with **fixed field offsets**, and turns `obj.x` from a dict lookup into a single offset load — *as fast as a static field access* — as long as the object's shape is stable.
- **Inline caches (ICs):** at a call/access site, the JIT caches "last time, the receiver was hidden-class H and the method was at offset N." If the next receiver matches (the *monomorphic* common case), it skips the lookup entirely. Sites stay fast while *monomorphic*; they degrade through *polymorphic* (a few shapes) to *megamorphic* (many shapes → back to slow lookup).
- **Speculative type specialization + deopt:** the JIT compiles a hot loop assuming the types it has observed (e.g., "this array holds only small ints"), producing near-native code. If an assumption is violated (someone puts a string in the array), it **deoptimizes** back to the interpreter and recompiles. PyPy and V8 live on this.

The professional synthesis: **a warm JIT on type-stable dynamic code approaches static-language speed. The gaps that remain are (a) warmup cost, (b) the boxing/cache-locality penalty for heterogeneous data, (c) megamorphic sites, and (d) the JIT's inability to assume stability the way a static compiler can *prove* it.** "Dynamic is inherently slow" is wrong; "dynamic makes peak, predictable, low-warmup performance harder" is right.

### 3. The Empirical Question: Do Static Types Reduce Bugs?

This is the most-debated and most-folklore-ridden claim in the whole topic. The honest professional answer: **the evidence is mixed but trends positive, with the strongest signal for large, long-lived, collaborative codebases — and every study has methodological caveats.**

What the literature actually shows:

- **The most-cited industrial result** (Gao, Bird, Barr, *To Type or Not to Type*, ICSE 2017): they took public JavaScript bugs that had fixes, stripped the fix, and asked whether adding **TypeScript or Flow** annotations would have caught the bug at compile time. Result: **~15% of the public bugs in their corpus were detectable by types.** That's a meaningful fraction *and* it's only the bugs that (a) were public, (b) had a clear fix, and (c) are the *kind* a type checker catches — it's a lower bound on one slice, not "types cut bugs by 15%."
- **Controlled experiments are genuinely mixed.** Several small lab studies (Hanenberg et al. and others) found *no* significant development-time advantage for static typing on small tasks, and sometimes a *cost*. Others found benefits for *maintenance*, *API discovery*, and *fixing type errors faster*. The signal is weak and task-dependent at small scale.
- **The effect grows with scale and lifetime.** Where studies and industry reports converge is that static typing's payoff is **superlinear in codebase size, team size, and code age** — exactly the regime where you can't hold the whole program in your head and the compiler's whole-program check substitutes for the reviewer who's left the company. The bug-catching value of "the compiler lists every caller affected by this rename" is hard to measure in a 2-hour lab task and enormous in a 5-year codebase.

The defensible professional statement: *"Types don't reliably make a 200-line script better, and the controlled evidence at small scale is mixed. For large, long-lived, multi-team systems, the weight of evidence and near-universal industry behavior favors static checking — primarily through refactoring safety, API documentation, and catching the `null`/wrong-shape class of error before production."* Never oversell it; never cite "15%" without its caveats.

### 4. The Industry Trend: Dynamic Languages Bolting On Static Checking

The market has voted, and the vote is one-directional:

- **TypeScript over JavaScript** — now the default for serious frontend/Node work; JS-without-types is increasingly the exception in large orgs.
- **mypy / Pyright over Python** — type hints (PEP 484) went from experimental (2014) to ubiquitous; Dropbox (mypy's birthplace), Instagram, and others run strict checking at scale.
- **Sorbet over Ruby** — Stripe built it for a multi-million-line monolith because the dynamic discipline stopped scaling with the team.
- **Hack over PHP** — Meta's gradually-typed PHP dialect, born of the same pressure at facebook.com scale.
- **Flow** (Meta's JS checker), **TypeScript-checked JS** via JSDoc, **RBS/Steep** for Ruby — the same pattern repeats.

The *why* is the professional insight: these are all **large, long-lived, high-headcount** codebases where the costs dynamic typing defers (the production `undefined`/`None` crash, the terrifying refactor, the "what shape is this dict?" archaeology) **grew faster than the codebase**, while the benefits dynamic typing front-loads (fast prototyping) stopped mattering for code that's a decade old. The gradient points toward static *because the cost structure of large systems rewards paying early*. Crucially, they all chose **gradual** static typing — bolt-on, not rewrite — because the gradual guarantee (`middle.md`) made it economically feasible. Nobody migrates the other way because there's no analogous pressure pulling a large static codebase toward dynamic.

### 5. The Refactor Made Safe by Types (a Concrete Professional Win)

The single most reliable, least-disputed benefit of static typing in a large codebase is **refactoring safety**. Rename a field, change a function's signature, split a type — and the compiler produces an exhaustive list of every site that must change. In a dynamic codebase, you have grep, your tests, and prayer; a missed call site ships and crashes on the path your tests didn't cover.

```typescript
// Rename `User.name` -> `User.fullName`. The compiler flags ALL of these, statically:
function greet(u: User) { return `Hi ${u.name}`; }   // ERROR after rename — fix here
// ...and the other 412 call sites across the monorepo, before any of them runs.
```

The dynamic equivalent: `grep -r '\.name'` (false positives galore — every object has *some* `.name`), run the test suite (covers the paths it covers), deploy, and find the missed one in Sentry next Tuesday. This is why even teams that love dynamic prototyping reach for types once code calcifies — *refactoring is where the deferred cost comes due, and types are the prepayment.*

### 6. The Production Crash a Type Would Have Caught

The counterpart of the safe refactor is the crash that motivates the whole migration. Every large dynamic codebase has a graveyard of these:

```python
# The path nobody tested. find_account returns None for closed accounts.
acct = find_account(user_id)
balance = acct.balance          # AttributeError: 'NoneType' object has no attribute 'balance'
                                # Fires in prod, for closed accounts only, at month-end batch.
```

```javascript
// config.retries is sometimes undefined (older config format)
for (let i = 0; i < config.retries; i++) { ... }  // undefined -> loop never runs, silent data loss
// or: someObject.handler()  ->  "undefined is not a function"
```

A static system that **tracks nullability** (`strictNullChecks`, `Optional[Account]` + mypy, Kotlin `Account?`) turns each of these into a *compile error on the laptop*: "object is possibly `undefined`" / "`Account | None` has no attribute `balance`." The professional framing isn't "types prevent all bugs" — it's "types convert a specific, *very common, very expensive* class of bug (the unhandled empty/wrong-shape value on an untested path) from a 2 a.m. page into a red squiggle." That class is large enough, and that conversion valuable enough, to justify the migration cost in most large systems.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Static types enabling speed** | A factory line built for one exact part: no measuring each item, every station pre-positioned — fast because the shape is known in advance. |
| **Dynamic per-op type check** | A general-purpose workshop measuring every item before each cut — flexible, but slower per item. |
| **JIT inline cache / hidden class** | The workshop noticing it's been cutting the same part all morning, pre-setting the jigs, and matching the factory's speed — until a different part arrives and it has to reset. |
| **Deoptimization** | That reset: an unexpected part forces the workshop back to measure-everything mode. |
| **Empirical bug research caveats** | Drug trials that show a real but modest effect, larger in chronic cases (big codebases) than acute ones (scripts) — and you must read the methods before quoting the headline. |
| **Refactor safety** | A blueprint change that auto-highlights every wall, pipe, and wire affected — versus walking the building hoping to spot them all. |
| **`any` flood during migration** | Painting over rot to pass inspection — the report says "renovated," the structure is unchanged. |
| **The industry trend** | Every large city eventually adding building codes: fine to skip for a shed, non-negotiable for a skyscraper full of tenants. |

---

## Mental Models

### The "Information You Can Spend" Model (performance)

A statically known type is *currency the compiler spends* to buy speed: spend "it's an int" to buy an unboxed register operation; spend "it's this concrete class" to buy devirtualization and inlining; spend "this generic is instantiated at `i32`" to buy monomorphization. Dynamic code starts the runtime *broke* — it must *earn* the information by observing types at runtime (the JIT's job) before it can spend it, and a deopt is going bankrupt and starting over. This frames the whole performance discussion: static gets the information for free up front; dynamic must mine it at runtime and can lose it.

### The "Cost Curve Crossover" Model (the trend)

Plot two cost curves against codebase size/age. Dynamic typing's cost starts low (fast to write) and rises steeply (untested-path crashes, scary refactors, shape archaeology grow with the code). Static typing's cost starts higher (annotations, conservatism) and rises *slowly* (the compiler absorbs the growth). The curves **cross** somewhere in the large/long-lived regime — and that crossover point is exactly where every major org migrated. Your job in an architecture review is to estimate where a given system sits relative to the crossover, not to argue an absolute.

### The "Prepayment" Model (refactoring and crashes)

Static typing is **prepaying** the cost of every future rename and every unhandled-`None`. You pay annotation cost now to avoid (a) manual refactor archaeology and (b) production crashes later. For code that won't change and won't run the risky path, the prepayment is wasted (scripts). For code that will be refactored for years and run every path eventually (platforms), the prepayment is deeply in the money. Match the discipline to whether the future costs you're prepaying will actually materialize.

---

## Code Examples

### The performance gap, concretely (and the JIT closing it)

```python
# CPython, no JIT: every += dispatches on type tags, ints are boxed objects.
def sum_squares(n):
    total = 0
    for i in range(n):
        total += i * i      # each op: tag-check, dispatch, box/unbox, alloc
    return total
# ~10-50x slower than the equivalent C/Go/Rust loop, dominated by per-op dynamic dispatch.
```

```python
# PyPy (tracing JIT): observes total/i stay ints, specializes the loop to unboxed integer
# arithmetic, and runs within a small factor of native — same SOURCE, JIT recovered the cost.
```

```rust
// Rust: type known at compile time. Unboxed i64 in a register, no checks, monomorphized,
// auto-vectorizable. The compiler "spent" the static type to buy native speed for free.
fn sum_squares(n: i64) -> i64 {
    (0..n).map(|i| i * i).sum()
}
```

### Hidden classes / shapes: why object access *can* be fast in JS

```javascript
// V8 assigns a hidden class. Create objects the SAME way and `.x` becomes a fixed-offset load.
function makePoint(x, y) { return { x, y }; }   // all share hidden class C0 -> {x:0, y:8}
const pts = Array.from({length: 1e6}, (_, i) => makePoint(i, i));
let s = 0;
for (const p of pts) s += p.x;   // monomorphic site: IC caches offset -> ~static speed

// ...but break the shape and you fall off the fast path:
pts[500000].z = 1;               // new hidden class -> site goes polymorphic/megamorphic -> slow
```

The professional lesson encoded here: dynamic *peak* performance exists but is **fragile** — it depends on type/shape stability the programmer must maintain implicitly, whereas static typing *guarantees* the stability the optimizer needs.

### The nullability win, made static

```python
# mypy with strict optional: the crash becomes a build error.
from typing import Optional

def find_account(uid: int) -> Optional["Account"]:
    ...

acct = find_account(uid)
print(acct.balance)
# mypy error: Item "None" of "Optional[Account]" has no attribute "balance"
# -> forces:  if acct is not None: print(acct.balance)
```

```typescript
// strictNullChecks: same class of bug, same compile-time catch.
function find(id: number): Account | undefined { ... }
const a = find(id);
console.log(a.balance);   // TS error: 'a' is possibly 'undefined'
```

### The `any` flood anti-pattern (what a bad migration produces)

```typescript
// Migration done wrong: errors silenced with `any`/`@ts-ignore` to "finish" fast.
function process(data: any) {                  // any in
    // @ts-ignore
    return data.items.map((x: any) => x.value); // any out
}
// Type coverage report: "100% of functions annotated." Actual safety: ~zero.
// The build is green and the production crashes are identical to the untyped version.
```

---

## Pros & Cons

| Aspect | Static (esp. at scale) | Dynamic (esp. small/early) |
|--------|------------------------|----------------------------|
| **Peak performance** | Predictable, no warmup, monomorphized, unboxed. | JIT can approach it but with warmup + fragility. |
| **Performance predictability** | High — the compiler *proved* the layout. | Lower — depends on type/shape stability; deopts. |
| **Bug prevention (large/long-lived)** | Strong, evidence-supported for the null/shape/rename classes. | Defers these to runtime/production. |
| **Bug prevention (small/short scripts)** | Marginal; controlled evidence mixed. | Fine — the deferred cost may never come due. |
| **Refactoring safety** | The killer feature — exhaustive, compiler-verified. | grep + tests + hope. |
| **Time-to-first-running-code** | Slower — fight the checker. | Fastest. |
| **Onboarding to a large codebase** | Types document shapes; IDE navigates precisely. | Read code / run it to learn shapes. |
| **Migration cost** | N/A (born static). | Real, multi-quarter, with `any`-flood failure modes. |

---

## Use Cases

- **Choose static (or migrate to it) when** the system is large, long-lived, multi-team, refactored often, or has expensive failures — platforms, infrastructure, payment/financial logic, widely-depended-on libraries. The cost-curve crossover is behind you.
- **Stay dynamic when** code is small, short-lived, exploratory, or shape-varies-by-input — data science notebooks, one-off automation, glue scripts, early-stage prototypes whose design is still molten. The prepayment wouldn't pay back.
- **Choose gradual static-over-dynamic when** you have a large *existing* dynamic codebase you can't rewrite — adopt TypeScript/mypy/Sorbet/Hack, type the hot and bug-prone modules first, and ratchet coverage up. This is the dominant real-world scenario at established companies.
- **Optimize for JIT-friendliness when** stuck with dynamic performance needs: keep object shapes stable, keep call sites monomorphic, avoid heterogeneous arrays, warm up hot paths — you're hand-maintaining the type stability a static compiler would guarantee.

---

## Coding Patterns

### Pattern 1: Migrate in strictness tiers, ratchet forward

Start the checker in its most permissive mode to get a green build, then enable strict flags (`strictNullChecks` first — highest ROI) module by module. Add a CI **ratchet**: the count of `any`/`type: ignore`/untyped functions may only decrease. Coverage climbs monotonically; nobody can regress it under deadline pressure.

### Pattern 2: Type the boundaries before the internals

Annotate public function signatures, module interfaces, and data models first — they constrain the most call sites and give the checker the most leverage. Internal locals can ride on inference.

### Pattern 3: Validate-and-narrow at every dynamic edge

External data (HTTP, JSON, DB rows, config) enters as `unknown`/`Any`; run it through a validator (Zod, pydantic, dataclasses + checks) into a precise type *once*, at the edge. This closes the erasure leak (`senior.md`) that would otherwise make your types decorative.

### Pattern 4: Keep object shapes stable for the JIT (dynamic perf)

When performance matters in dynamic code: initialize all fields in the constructor, don't add/delete properties after creation, keep arrays homogeneous, and keep hot call sites monomorphic. You're manually preserving the layout stability the JIT's hidden classes and inline caches depend on.

### Pattern 5: Invest in stub quality

A migration is only as safe as the types of the libraries you call. Use/maintain high-quality stubs (DefinitelyTyped, typeshed); a wrong stub is worse than no stub because it asserts a false guarantee the checker then trusts.

---

## Best Practices

- **Sell migrations on refactoring safety and the null/shape crash class, not on "fewer bugs" in the abstract.** Those are the defensible, evidence-backed, and viscerally-felt wins. Cite the TypeScript/Flow ~15% result *with* its caveats; don't pretend it's "15% fewer bugs."
- **Turn on strict null checking first.** It targets the single most common, most expensive runtime type crash and delivers the most safety per unit of migration effort.
- **Track `any` as technical debt with a budget.** A migration that floods `any` is theater. Measure real coverage (non-`any` data flow), not "percent annotated."
- **Don't promise performance you can't guarantee in dynamic code.** A JIT *can* hit near-native speed but won't *predictably* — if you need bounded, warmup-free latency, that's an argument for a statically typed language, not a JIT.
- **Match discipline to lifetime and scale.** Don't impose strict static typing on a throwaway script; don't run a 10-year platform on untyped dynamic code. Estimate where the system sits on the cost-curve crossover.
- **Make the migration incremental and reversible-safe.** Lean on the gradual guarantee: type module by module, keep the build green throughout, never big-bang.
- **Keep humans in the loop on the empirical claim.** The honest position is "mixed evidence at small scale, positive at large scale, strong industry signal." Anyone who tells you the research is settled in either direction hasn't read it.

---

## Edge Cases & Pitfalls

- **The `any` flood.** The most common migration failure: silence errors with `any`/`@ts-ignore` to ship, producing the *appearance* of types and *none* of the safety. Guard with coverage metrics and a ratchet.
- **Wrong stubs are worse than no stubs.** An incorrect `.d.ts`/`.pyi` makes the checker confidently endorse a falsehood — a silent unsound boundary. Audit critical stubs.
- **JIT warmup and tail latency.** A tracing JIT is slow until hot and can **deoptimize** mid-run, causing latency spikes — a real problem for short-lived processes (serverless) and latency-SLO services. Static/AOT code has no warmup.
- **Megamorphic call sites silently kill dynamic perf.** A site that sees many object shapes falls off the inline-cache fast path back to slow lookup — invisible in code, visible only in a profiler.
- **Erased annotations don't validate runtime input.** A perfectly typed Python/TS codebase still crashes on malformed external data unless you *validate* at the edge — the types were erased before that data arrived (`senior.md`).
- **Overselling the bug research backfires.** Quoting "types reduce bugs 15%" as settled fact invites a teammate who read the paper to discredit your whole argument. Lead with the caveats; you'll be more persuasive.
- **Static typing can slow a genuinely exploratory phase.** In the molten early design of a feature, fighting the checker over shapes that change daily is real friction — a legitimate reason to prototype dynamically and type later.
- **Migration touches culture, not just code.** Teams that prized dynamic terseness resist; the migration needs buy-in, tooling, and exemplar modules, or it stalls at 30% coverage and `any` everywhere.

---

## Test Yourself

1. List four concrete optimizations a statically known type enables (e.g., unboxing) and explain why each is hard or impossible without the static type.
2. Explain how hidden classes and inline caches let a JIT make dynamic `obj.x` access nearly as fast as a static field access — and what breaks the fast path.
3. What is deoptimization, and why does it make dynamic-language *latency* less predictable than static-language latency even when *throughput* is comparable?
4. State the claim of the *To Type or Not to Type* (Gao et al.) study and three caveats that mean it is *not* "types cut bugs by 15%."
5. Why is the empirical signal for static typing stronger for large, long-lived codebases than for small lab tasks? Frame it with the cost-curve crossover.
6. Name four major dynamic languages that bolted on static checking and the org/pressure behind each. Why is the migration gradient one-directional?
7. Describe the `any` flood failure mode and two controls (metric + policy) that prevent it during a migration.
8. A team wants to type their 800k-line Python codebase. Give your migration playbook: order of operations, first strict flag, boundary strategy, and how you'd measure progress.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│         PERFORMANCE · EVIDENCE · TREND · MIGRATION               │
├──────────────────────────────────────────────────────────────────┤
│ STATIC TYPES BUY SPEED (info the compiler spends):               │
│   no runtime tag/check · unboxed values · fixed field offsets    │
│   monomorphization + inlining · devirtualization                 │
│ DYNAMIC PAYS per-op (tag check, dispatch, box, dict lookup)      │
│   JIT CLAWS BACK: hidden classes (offset access) +               │
│     inline caches (mono fast, mega slow) + speculation/deopt     │
│   => warm JIT ~ native; gaps = warmup, locality, deopt, megamo.  │
├──────────────────────────────────────────────────────────────────┤
│ DOES STATIC REDUCE BUGS? mixed but trends positive               │
│   Gao et al. ICSE'17: ~15% of public JS bugs catchable by TS/Flow│
│     (lower bound on one slice — NOT "15% fewer bugs")            │
│   small lab studies: mixed / sometimes no effect                 │
│   payoff is SUPERLINEAR in size, team, age                       │
│   biggest real wins: REFACTOR SAFETY + null/shape crash class    │
├──────────────────────────────────────────────────────────────────┤
│ INDUSTRY TREND (one-directional, all GRADUAL):                   │
│   TS<-JS · mypy/Pyright<-Python · Sorbet<-Ruby · Hack<-PHP       │
│   why: large+old+multi-team -> dynamic's deferred costs exceed   │
│         its front-loaded benefits; cost curves CROSS             │
│   nobody migrates static -> dynamic                              │
├──────────────────────────────────────────────────────────────────┤
│ MIGRATION PLAYBOOK:                                              │
│   permissive build green -> strictNullChecks FIRST               │
│   type boundaries/signatures before internals                    │
│   validate+narrow at every dynamic edge (unknown, not any)       │
│   RATCHET: any/ignore count only decreases                       │
│   measure real coverage (non-any flow), beware the `any` flood   │
│   beware wrong stubs (worse than none)                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Static typing is a performance enabler, not just a correctness tool.** A statically known type lets the compiler skip runtime type tags/checks, use **unboxed** values and **fixed field offsets**, and perform **monomorphization, inlining, and devirtualization** — "facts are free at runtime." Dynamic code pays a per-operation tax (tag check, dispatch, boxing, dict lookup), but modern **JITs claw most of it back** with **hidden classes** (offset-based property access), **inline caches** (fast while monomorphic), and **speculative specialization** (with **deopt** when assumptions break). "Dynamic is slow" is outdated; "dynamic makes *predictable, warmup-free, peak* performance harder" is accurate.
- **The empirical bug question is mixed but trends positive.** The most-cited industrial study (Gao et al., ICSE 2017) found ~15% of public JS bugs were catchable by TypeScript/Flow — a meaningful but heavily-caveated lower bound, not "15% fewer bugs." Small controlled studies are mixed; the signal is **superlinear in codebase size, team size, and age**. The defensible, evidence-backed wins are **refactoring safety** and catching the **`null`/wrong-shape-on-an-untested-path** crash class before production.
- **The industry trend is unmistakable and one-directional:** every major dynamic language bolted on *gradual* static checking — **TypeScript** over JS, **mypy/Pyright** over Python, **Sorbet** over Ruby, **Hack** over PHP — driven by *large, long-lived, multi-team* codebases where dynamic typing's deferred costs (production crashes, terrifying refactors, shape archaeology) outgrew its front-loaded benefits. The cost curves **cross** in the large/old regime, which is exactly where everyone migrated. Nobody migrates the other way.
- **Migration is a multi-quarter discipline, not a flag.** Go permissive-then-strict (enable `strictNullChecks` first), type **boundaries before internals**, **validate-and-narrow** at every dynamic edge (because erased annotations don't check runtime input), and install a **ratchet** so `any`/`ignore` counts only fall. The defining failure mode is the **`any` flood** — types in name only — so measure *real* coverage (non-`any` data flow) and audit library **stubs** (a wrong stub is worse than none).
- The professional's posture: **match the type discipline to the system's size, lifetime, and failure cost; argue from the JIT cost model and the caveated evidence, not from preference; and when migrating, lean on the gradual guarantee to do it incrementally and safely.**
