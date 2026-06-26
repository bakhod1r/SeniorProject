# Reflection — Senior Level

> **Topic:** [Reflection](README.md)
> **Focus:** Why reflection is slow at the runtime/JIT level, and the machinery that claws performance back — Java `MethodHandle`, `LambdaMetafactory`, `invokedynamic` — plus reflection vs. code generation as competing strategies, and how reflection breaks inlining, dead-code elimination, and tree-shaking.

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
13. [Performance Engineering](#performance-engineering)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Why is reflection slow at the machine level, and what does the platform offer to make reflective dispatch nearly as fast as direct calls?**

By the senior level you can use reflection correctly and cache it. Now you need to reason about it the way a runtime engineer does. Three threads run through this page:

1. **The cost has a cause.** Reflective calls defeat the optimizer's most valuable tools — **inlining**, **devirtualization**, and **escape analysis** — because the call target is opaque until runtime, and arguments get boxed into `Object[]`/`interface{}`. Understanding *why* tells you exactly what to fix.
2. **The platform fights back.** Java didn't stop at `Method.invoke`. `MethodHandle` gives a typed, JIT-friendly call primitive; `LambdaMetafactory` + `invokedynamic` let you *spin a real lambda* that calls a method as fast as a direct call after warmup. This is how modern serializers, records, and lambdas avoid the reflection tax.
3. **Reflection vs. code generation is an architectural fork.** Serde (Rust) and many Java/Go libraries *generate code at compile time*; Jackson and `encoding/json` *reflect at runtime*. The choice trades startup, binary size, and tool-friendliness against flexibility and build simplicity. Seniors pick deliberately.

A fourth, easily-missed point ties it together: **reflection breaks whole-program reasoning.** Dead-code elimination, tree-shaking, devirtualization, and aggressive inlining all assume "if no source references this, it's unused." A reflective call by string violates that assumption, which is why reflective code resists optimization *and* trips up shrinkers like ProGuard and bundlers.

In one sentence: **the senior level is about the optimizer's-eye view — why reflection is opaque, how `MethodHandle`/`invokedynamic` restore transparency, and when to abandon reflection for codegen.**

---

## Prerequisites

- **Required:** `middle.md` — settability rules, the `Class`/`Field`/`Method` model, caching.
- **Required:** A working model of a JIT/optimizing compiler: inlining, devirtualization, escape analysis, deopt.
- **Required:** Familiarity with boxing/autoboxing and its allocation cost.
- **Helpful:** Bytecode literacy (what `invokevirtual` vs. `invokedynamic` mean).
- **Helpful:** Having profiled a reflection-heavy serializer or DI container under load.

You do **not** need: the module-system operational details or GraalVM native-image config (that's `professional.md`), though they connect directly to this page's ideas.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`Method.invoke` (Java)** | The classic reflective call. Boxes args into `Object[]`, performs access checks, returns `Object`. Opaque to the JIT. |
| **`MethodHandle` (Java)** | A typed, directly-executable reference to a method/field/constructor, produced via `MethodHandles.Lookup`. Designed to be JIT-friendly and inlinable when the handle is a stable constant. |
| **`invokedynamic` (indy)** | A JVM bytecode that, on first execution, calls a *bootstrap method* to link the call site to a `CallSite`/`MethodHandle`, then runs at near-direct speed thereafter. The backbone of lambdas and string concatenation. |
| **`LambdaMetafactory`** | The bootstrap used by `invokedynamic` for lambdas; can synthesize an implementation of a functional interface that invokes a target method — turning reflection into a real, fast call. |
| **`CallSite`** | The mutable link target an `invokedynamic` site points at; can be a `ConstantCallSite` (fixed) or `MutableCallSite` (relinkable). |
| **Inlining** | Replacing a call with the callee's body so the optimizer can see through it. Reflective calls block this. |
| **Devirtualization** | Turning a virtual/interface call into a direct one when the target is known. Reflection hides the target, preventing it. |
| **Escape analysis** | Proving an object doesn't escape so it can be stack-allocated or scalar-replaced. Boxing in reflective calls defeats it. |
| **Boxing** | Wrapping a primitive/value in a heap object (`int`→`Integer`, args→`Object[]`). The hidden allocation cost of reflection. |
| **Dead-code elimination (DCE)** | Removing code with no reachable references. Reflective references are invisible to it, so it can over-remove or be disabled. |
| **Tree-shaking** | The JS/bundler analog of DCE; dynamic property access (`obj[name]`) defeats it. |
| **Code generation (codegen)** | Producing source/bytecode at build time to do a job reflection would otherwise do at runtime. |
| **Closed-world assumption** | The premise (used by GraalVM native-image, shrinkers) that all reachable code is known at build time. Reflection violates it unless declared. |

---

## Core Concepts

### 1. Why `Method.invoke` is slow: the optimizer goes blind

Consider `m.invoke(target, args)`. To the JIT, this is a call into a generic dispatch routine whose *actual* target is a field of the `Method` object, unknown at compile time. Four optimizations evaporate:

- **No inlining.** The JIT can't substitute the callee body — it doesn't statically know the callee. So the call stays a real call with full overhead.
- **No devirtualization.** Even if there's only one possible target, the reflective layer hides it.
- **Boxing kills escape analysis.** Arguments must be packed into `Object[]`, and primitive results boxed. Those allocations escape into the reflective machinery, so escape analysis can't elide them.
- **Per-call checks.** Access verification and argument-shape checks run unless suppressed (`setAccessible`, or amortized by the implementation).

The result is the 10–100× figure from `middle.md` — and crucially, *most of it is structural*, not just lookup. Caching the `Method` removes lookup but leaves boxing and opacity. To remove those, you need a fundamentally different primitive.

### 2. `MethodHandle`: a call the JIT can actually see

A `MethodHandle` is a typed, directly-invocable reference. You obtain it through a `Lookup`:

```java
MethodHandles.Lookup lk = MethodHandles.lookup();
MethodHandle mh = lk.findVirtual(User.class, "greet",
        MethodType.methodType(String.class));
String s = (String) mh.invoke(user);
```

Why it's faster than `Method.invoke`:

- **Typed signature.** A `MethodHandle` carries an exact `MethodType`; with `invokeExact`, no boxing or runtime type juggling is needed.
- **JIT transparency.** When a handle is stored in a `static final` field (a *constant* handle), the JIT can treat it like a known target and **inline through it**. This is the key: a *constant* `MethodHandle` is nearly as optimizable as a direct call.
- **Adapters without reflection.** `MethodHandles.insertArguments`, `asType`, `filterArguments` let you adapt signatures at link time, not per call.

The caveat: handles are fast *when constant*. A `MethodHandle` pulled from a `HashMap` each call is better than `Method.invoke` but not magic — the JIT can't constant-fold it. The big wins come from `invokedynamic`, which makes the handle a true constant at the call site.

### 3. `invokedynamic` + `LambdaMetafactory`: manufacturing a direct call

This is the modern trick that powers high-performance serializers and is *how Java lambdas themselves work*. The idea: instead of reflectively invoking a getter a million times, **synthesize a small class (a lambda) once** that calls the getter directly, then call *that* at full speed.

```java
// One-time: build a Function<User,String> that calls User::getName directly.
MethodHandles.Lookup lk = MethodHandles.lookup();
MethodHandle target = lk.findVirtual(User.class, "getName",
        MethodType.methodType(String.class));

CallSite site = LambdaMetafactory.metafactory(
        lk, "apply",
        MethodType.methodType(Function.class),                 // factory type
        MethodType.methodType(Object.class, Object.class),     // erased SAM sig
        target,                                                 // impl
        MethodType.methodType(String.class, User.class));      // instantiated sig

@SuppressWarnings("unchecked")
Function<User, String> getName = (Function<User, String>) site.getTarget().invoke();

// Hot path: a real, inlinable virtual call — NOT reflection.
String name = getName.apply(user);
```

After this one-time setup, `getName.apply(user)` is an ordinary interface call the JIT inlines and devirtualizes. Benchmarks routinely show this approaching hand-written getter speed, an order of magnitude over `Method.invoke`. Libraries like Jackson (afterburner/blackbird modules), and the JDK's own record/lambda machinery, use exactly this pattern. `invokedynamic` is what links such call sites lazily and caches the result.

### 4. Reflection vs. code generation: the architectural fork

The same job — "serialize any struct" — has two implementations:

- **Reflective (runtime).** Walk fields at runtime via `reflect`/`Class`. *Pros:* zero build-time machinery, works on types loaded later, simple. *Cons:* slower steady state, slow startup (scanning), opaque to shrinkers/native-image, boxing.
- **Generated (compile time).** A macro/annotation-processor/`go:generate` emits exact serialization code per type. *Pros:* direct-call speed, no runtime metadata, tool-visible (DCE/tree-shaking work), native-image-friendly. *Cons:* build complexity, code bloat, must know types at build time.

Concretely: **Serde** (Rust) and **easyjson**/**ffjson** (Go), Java annotation processors, and `System.Text.Json` source generators all *generate*. **Jackson**, `encoding/json`, and `System.Text.Json`'s reflection mode *reflect*. The senior decision rule: if you control the types at build time and care about startup/throughput/native-image, **generate**; if you must handle arbitrary or late-bound types and value build simplicity, **reflect** (and then cache/`invokedynamic` your way to acceptable speed).

### 5. Reflection breaks whole-program reasoning

A reflective call by string is invisible to static analysis. The consequences ripple:

- **Dead-code elimination / shrinkers (ProGuard, R8).** They may remove a method that's only called reflectively, breaking the app — hence "keep rules." Or, conservatively, they keep everything, bloating output.
- **Tree-shaking (JS bundlers).** `obj[dynamicName]()` defeats it; the bundler can't prove what's used.
- **Devirtualization / inlining.** The optimizer can't specialize a call whose target is data.
- **Obfuscation.** Renaming a field breaks any reflective access keyed on the old string.
- **Refactoring tools.** "Rename symbol" misses reflective string references — silent breakage.

This is the deep reason native-image and shrinkers need explicit *reflection configuration*: you must hand the closed-world analyzer the list of reflectively-accessed members it can't infer. (`professional.md` covers the operational side.)

---

## Real-World Analogies

**`Method.invoke` vs. `MethodHandle` vs. lambda = three ways to deliver a package.** `Method.invoke` is mailing a parcel through a sorting center every time — looked up, scanned, boxed, routed. A constant `MethodHandle` is a dedicated courier with your address memorized. The `LambdaMetafactory` lambda is building a private road straight to the door once, then driving it forever. Same destination; wildly different steady-state cost.

**Codegen vs. reflection = prefab vs. on-site carpentry.** Generated code is prefabricated panels built in the factory (compile time): fast to assemble on site, but the factory must know the design in advance. Reflection is carpenters measuring and cutting on site (runtime): adapts to any house that shows up, but slower and noisier every single build.

**Reflection vs. the shrinker = a guest list the bouncer can't see.** DCE/tree-shaking is a bouncer removing anyone not on the guest list. Reflective calls invite people by whispering names at runtime — the bouncer never hears them, so either the bouncer wrongly turns them away (breakage) or stops checking IDs entirely (bloat). The "keep rules" / reflection config is handing the bouncer the secret list.

---

## Mental Models

**Model 1: "Opacity is the enemy."** Every reflection cost traces back to one thing: the call target is *data*, not *code the compiler can see*. Inlining, devirtualization, escape analysis, DCE, tree-shaking — all need transparency. The performance toolkit (`MethodHandle`, `invokedynamic`, codegen) is fundamentally about *restoring transparency* at a known point in time.

**Model 2: "Pay the reflection tax once, at link time."** The winning pattern is always: do the slow, opaque reflective resolution *once* during setup, and emit a *fast, transparent artifact* (a constant handle, a synthesized lambda, generated code) that the hot path uses. Reflection at boot, direct calls in steady state.

**Model 3: "Closed world vs. open world."** Reflection assumes an *open world* — types and members discoverable at runtime. Optimizers and native-image assume a *closed world* — everything knowable at build time. Friction between these is the source of every shrinker break and native-image config file. Choose your world consciously.

**Model 4: "Boxing is the silent allocator."** Even after you fix lookup, `Method.invoke`'s `Object[]` packing and primitive boxing keep allocating. Profiling a reflective hot path, the allocation rate often surprises people more than the CPU time. Typed `MethodHandle`s with `invokeExact` are the cure.

---

## Code Examples

### Example 1: Benchmark shape — direct vs. invoke vs. handle vs. lambda

```java
// Sketch (use JMH for real numbers). Relative ballpark after warmup:
//   direct call          : 1x   (baseline)
//   constant MethodHandle : ~1–2x
//   LambdaMetafactory SAM : ~1x  (inlines to a direct call)
//   cached Method.invoke  : ~10–30x, plus allocations from boxing
//   uncached reflection   : ~50–100x+
direct      : return user.getName();
mhConstant  : return (String) NAME_MH.invokeExact(user);   // static final handle
lambda      : return NAME_FN.apply(user);                  // from LambdaMetafactory
reflectCold : return userClass.getMethod("getName").invoke(user);
```

The lesson: **caching alone gets you to ~10–30×; only `MethodHandle`/lambda gets you back to ~1×.** That gap is the boxing + opacity tax.

### Example 2: A serializer that builds accessors once (the production pattern)

```java
final class FieldAccessor {
    final String key;
    final Function<Object, Object> getter; // built via LambdaMetafactory, NOT reflective

    FieldAccessor(String key, Function<Object, Object> getter) {
        this.key = key; this.getter = getter;
    }
}

// At type-registration time: reflect ONCE to discover getters,
// then synthesize a fast lambda per getter.
List<FieldAccessor> buildAccessors(Class<?> type) { /* reflect + LambdaMetafactory */ }

// Hot path: zero reflection.
void writeJson(Object obj, List<FieldAccessor> accessors, JsonWriter w) {
    for (FieldAccessor a : accessors) {
        w.name(a.key).value(a.getter.apply(obj)); // direct virtual call
    }
}
```

This is, in spirit, how Jackson's blackbird/afterburner and similar fast serializers operate: reflect at registration, run lambdas at runtime.

### Example 3: Go has no `MethodHandle` — so the fix is caching + codegen

Go's `reflect` has no equivalent to `invokedynamic`. The two senior moves are:

```go
// 1) Cache a compiled per-type plan (encoding/json does exactly this).
type fieldEnc struct {
    index []int
    key   string
    encode func(v reflect.Value, b *bytes.Buffer)
}
// Build []fieldEnc ONCE per type, store in a sync.Map keyed by reflect.Type.

// 2) Or eliminate reflection entirely with code generation:
//    //go:generate easyjson -all model.go
//    which emits MarshalJSON/UnmarshalJSON with direct field access.
```

`encoding/json` itself caches a per-type encoder so it doesn't re-walk fields each call. When that isn't fast enough, the ecosystem reaches for codegen (`easyjson`, `ffjson`, protobuf's generated marshalers) — Go's answer to the reflection tax is "reflect once and cache, or generate."

### Example 4: How a shrinker breaks — and the keep rule

```java
// Only ever called reflectively:
public class Handler {
    public void onEvent() { ... } // no static caller anywhere
}
dispatcher.invoke(Class.forName(cfg.handler), "onEvent");
```

ProGuard/R8 sees `onEvent` as unreferenced and strips it → `NoSuchMethodException` at runtime. The fix is a keep rule telling the shrinker not to touch reflectively-used members:

```
-keep class com.example.Handler { public void onEvent(); }
```

This is the everyday face of "reflection violates the closed-world assumption."

---

## Pros & Cons

**Pros (at this level)**

- **`MethodHandle`/`invokedynamic` recover near-direct speed** while keeping reflective flexibility at setup time.
- **Reflect-once-then-emit-fast-artifact** is a clean, profilable architecture.
- **Codegen alternative** removes the tax entirely when you control build-time types.

**Cons**

- **`MethodHandle`/`LambdaMetafactory` are intricate** — easy to get the `MethodType` wiring wrong, and they're Java-specific.
- **The fast path only pays off if the handle/lambda is constant/reused** — naive use is barely better than `invoke`.
- **Opacity persists** for tooling: even fast reflective dispatch is invisible to DCE/tree-shaking/native-image without config.
- **Codegen adds build complexity** and can bloat binaries.

---

## Use Cases

- **High-performance serializers** (Jackson blackbird, fast JSON in Go via codegen) that must do millions of field accesses/sec.
- **DI containers** that synthesize fast accessors at startup instead of `invoke`-ing per request.
- **ORM materialization** of result sets into objects at scale.
- **Record/lambda machinery** in the JDK itself (built on `invokedynamic`).
- **RPC frameworks** binding methods once and dispatching fast thereafter.
- **Deciding the reflect-vs-generate split** for a new library — an explicit senior design call.

---

## Coding Patterns

**Pattern 1: Reflect at registration, emit a fast accessor.** Discover members reflectively once; produce a `MethodHandle`/lambda/generated function the hot path uses.

**Pattern 2: Make handles constant.** Store `MethodHandle`s in `static final` fields or per-type immutable plans so the JIT can constant-fold and inline them.

**Pattern 3: Prefer `invokeExact` with precise `MethodType`** to avoid boxing and runtime adaptation.

**Pattern 4: Cache per-`Type` plans, never per-call lookups.** A `sync.Map`/`ClassValue` keyed by type holds the compiled plan.

**Pattern 5: Choose codegen when the closed world is known.** Native-image targets, startup-sensitive services, and shrinker-heavy builds favor generation over reflection.

**Pattern 6: Ship reflection config / keep rules alongside reflective code.** Treat the closed-world declarations as part of the library's contract.

---

## Best Practices

- **Profile allocations, not just CPU.** Reflective hot paths often bleed through boxing; a flat CPU profile can hide a churning allocator.
- **Use `ClassValue` (Java) for per-type caches** — it's designed for exactly this and is classloader-safe.
- **Wrap `MethodHandle`/`LambdaMetafactory` behind a tested factory.** The wiring is error-prone; isolate it.
- **Document the reflect-vs-generate decision** in the library README so users understand startup/size trade-offs.
- **Provide keep rules / native-image config** with any reflective library you publish.
- **Benchmark against a direct-call baseline with JMH** (warmed up), not microbenchmarks that the JIT folds away.

---

## Edge Cases & Pitfalls

- **Non-constant `MethodHandle`s don't inline.** Pulling a handle from a map per call leaves most of the win on the table.
- **`invoke` vs. `invokeExact`.** `invokeExact` requires the call's static signature to *exactly* match the handle's `MethodType`, or it throws `WrongMethodTypeException`. `invoke` adapts (and boxes). Choose deliberately.
- **`LambdaMetafactory` signature wiring is finicky.** The erased vs. instantiated `MethodType`s must be right or you get linkage errors at runtime.
- **Shrinkers over-strip reflectively-used members.** Always supply keep rules; test the shrunk artifact, not just the debug build.
- **Native-image silently no-ops missing reflection config** until the reflective call runs and throws — test the native binary.
- **`ClassValue`/`ClassLoader` leaks.** Per-type caches can pin classloaders in app servers; use weak keys or `ClassValue`.
- **Generated code drift.** If codegen isn't run on every build, generated marshalers go stale against the type — wire it into the build, not a manual step.

---

## Performance Engineering

- **Hierarchy of cost (Java):** direct ≈ constant `MethodHandle`/lambda < cached `Method.invoke` (≈10–30× + alloc) < uncached reflection (≈50–100×+). Pick the rung your latency budget needs.
- **Eliminate boxing first.** It's frequently the dominant cost in reflective serialization; typed handles or codegen remove it.
- **Move work to startup.** Reflect, scan, and synthesize at boot; keep steady state direct. Watch that this doesn't blow the cold-start budget for serverless (where codegen/AOT may win instead).
- **Measure the whole picture:** throughput, p99 latency, allocation rate, *and* startup time. Reflection trades these against each other; a win on one can be a loss on another.
- **In Go:** there is no JIT relinking trick — your levers are per-type caching and codegen. Accept that pure `reflect` will not match generated code.

---

## Test Yourself

1. Name the four optimizer capabilities reflective `Method.invoke` defeats, and why.
2. Why is a *constant* `MethodHandle` much faster than one fetched from a map per call?
3. Explain how `LambdaMetafactory` + `invokedynamic` turn a reflective getter into a near-direct call.
4. What's the difference between `invoke` and `invokeExact` on a `MethodHandle`?
5. Give the senior decision rule for choosing reflection vs. code generation.
6. Why must shrinkers (ProGuard/R8) and GraalVM native-image be *told* about reflective members?
7. Go has no `invokedynamic`. What are your two performance levers for reflective serialization?
8. Why can caching a `Method` still leave you 10–30× slower than direct?

<details>
<summary>Answers</summary>

1. Inlining (target unknown statically), devirtualization (target hidden), escape analysis (boxed args/results escape into the reflective machinery), and per-call access/shape checks — all because the call target is data, not statically-visible code.
2. A constant handle (e.g. `static final`) lets the JIT constant-fold and inline through it as if it were a direct call; a map-fetched handle is an opaque value the JIT can't specialize.
3. You reflect once to get a `MethodHandle` to the getter, then `LambdaMetafactory` synthesizes a class implementing a functional interface (e.g. `Function`) that calls it directly; `invokedynamic` links the call site lazily. The hot path is then an ordinary, inlinable interface call.
4. `invokeExact` requires the static call signature to match the handle's `MethodType` exactly (no boxing/adaptation); `invoke` adapts the signature at runtime, boxing as needed.
5. If you control the types at build time and care about startup/throughput/native-image/shrinking, generate code; if you must handle arbitrary or late-bound types and value build simplicity, reflect (then cache/`MethodHandle` to acceptable speed).
6. Reflective calls by string are invisible to closed-world analysis, so without explicit config they're either wrongly stripped (breakage) or force conservative keep-everything (bloat / failed native-image).
7. Per-type caching of a compiled encoder plan (what `encoding/json` does) and code generation (`easyjson`/protobuf-style marshalers).
8. Caching removes lookup but not boxing of args/results nor the optimizer opacity (no inlining/devirtualization), which together still dominate.

</details>

---

## Cheat Sheet

| Mechanism (Java) | Speed (warm) | Boxing? | Inlinable? | When |
|---|---|---|---|---|
| `Method.invoke` (uncached) | ~50–100×+ | yes | no | one-off, setup only |
| `Method.invoke` (cached + accessible) | ~10–30× | yes | no | low-frequency reflective calls |
| `MethodHandle` (constant) | ~1–2× | no (`invokeExact`) | yes | hot reflective dispatch |
| `LambdaMetafactory` SAM | ~1× | no | yes | serializers/DI fast paths |
| Generated code | 1× (baseline) | no | yes | build-time types, native-image |

**Decision:** known closed world + startup/size/throughput sensitive → **codegen**. Arbitrary/late types + build simplicity → **reflect, cache, then `MethodHandle`/lambda**.

**Always:** reflect at boot → emit fast artifact for steady state · ship keep rules / native-image reflection config · profile allocations, not just CPU.

---

## Summary

Reflection is slow because the call target is *data*, which blinds the optimizer: no inlining, no devirtualization, no escape analysis, plus boxing and checks. Caching the `Method` removes only the lookup — the structural tax (boxing + opacity) remains, leaving you ~10–30× off direct. The platform's answer is to **restore transparency at a known time**: a *constant* `MethodHandle` is JIT-inlinable, and `LambdaMetafactory` + `invokedynamic` synthesize a real lambda once that then runs at near-direct speed — the pattern behind fast serializers and Java's own lambdas. The unifying architecture is **reflect at boot, emit a fast artifact, run direct calls in steady state.**

The deeper truth is that reflection assumes an **open world** while optimizers, shrinkers, and native-image assume a **closed world** — which is why reflective code resists DCE/tree-shaking/inlining and needs explicit keep rules and reflection config. When you control the types at build time, **code generation** sidesteps the whole conflict at the cost of build complexity. Seniors make this reflect-vs-generate choice deliberately, profile allocations as carefully as CPU, and treat closed-world declarations as part of a reflective library's contract. The `professional.md` level takes these principles into production: the JPMS module system, GraalVM native-image config, and reflection-driven security incidents.

---

## Further Reading

- JEP 309/277 and the `invokedynamic`/`MethodHandle` design docs; `java.lang.invoke` package and `LambdaMetafactory` Javadoc.
- John Rose's writings on `invokedynamic` and the "Da Vinci Machine."
- Jackson's blackbird/afterburner modules — read how they generate accessors.
- Go: `encoding/json`'s per-type encoder cache; `easyjson`/protobuf generated marshalers for the codegen contrast.
- Then `professional.md` for the module system, native-image reflection config, and security.
