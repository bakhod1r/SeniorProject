# Dynamic Dispatch & Proxies — Senior Level

> **Topic:** [Dynamic Dispatch & Proxies](README.md)
> **Focus:** The interception machinery at depth — runtime bytecode generation (ASM/ByteBuddy/CGLIB), proxy invariants and membranes, the metaobject protocols that make synthesis possible, and the design trade-offs of building your own proxy layer.

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
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **If you had to build the proxy layer that Spring/Mockito/Hibernate is built on, what would you need to get right?**

A senior engineer treats "proxy" not as a pattern from a textbook but as a **runtime code-synthesis problem with hard correctness invariants**. The interesting questions stop being "how do I log a method" and become:

- How is the proxy class actually *materialized* — what bytecode is emitted, by what (ASM → CGLIB/ByteBuddy), into which classloader, and what does that cost in metaspace and JIT warm-up?
- What invariants must a transparent proxy preserve so that callers genuinely cannot tell? (The JS `Proxy` spec encodes these as **invariants** that traps must respect; violating them throws.)
- How do you proxy a whole **object graph** safely — the **membrane** pattern — so that values crossing the boundary are themselves wrapped, identity is preserved within the membrane, and revocation cuts the entire graph at once?
- When does interception break **identity, equality, hashing, serialization, and `instanceof`**, and how do production frameworks paper over it?

In one sentence: **a production-grade proxy is a generated type (or a metaobject hook) that must be indistinguishable from its target on the happy path, predictable on the unhappy path, and cheap enough to sit on every call.**

This level covers the generation pipeline, the metaobject protocols (Python descriptors/`__getattribute__`, Ruby's method-lookup chain, JS proxy invariants), membranes and revocation, and the cross-cutting damage to identity/equality that every proxy author must manage.

---

## Prerequisites

- **Required:** Solid grasp of `middle.md` — interface vs class proxies, the seam, self-invocation, the per-language hooks.
- **Required:** Comfortable with Java reflection, classloaders at a conceptual level, and the idea of bytecode.
- **Required:** Understand descriptors (Python), method resolution order, and prototype chains (JS).
- **Helpful:** You've debugged a real AOP/lazy-loading/mocking issue in production.
- **Helpful:** Familiarity with `equals`/`hashCode` contracts and serialization frameworks.

You do **not** strictly need raw ASM opcode fluency, but you should be willing to read a small ASM/ByteBuddy snippet.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bytecode generation** | Emitting a new class at runtime (an in-memory `byte[]`) and loading it, so it behaves like a compiled class. |
| **ASM** | A small, fast bytecode library: a visitor over class/method/field structure. The substrate beneath CGLIB and ByteBuddy. |
| **ByteBuddy** | A high-level, type-safe DSL for generating/redefining classes; engine of modern Mockito and Hibernate enhancement. |
| **Objenesis** | A library that instantiates a class **without running its constructor** (used by Spring/Mockito to materialize proxies). |
| **Metaobject protocol (MOP)** | The set of hooks a language exposes for customizing object behavior (attribute access, method lookup, call). |
| **Descriptor (Python)** | An object implementing `__get__`/`__set__`/`__delete__`; the mechanism behind methods, `property`, `classmethod`. |
| **Proxy invariant (JS)** | A rule a trap must obey to stay consistent with the target (e.g., can't report a non-configurable, non-writable property as a different value). Violations throw `TypeError`. |
| **Membrane** | A transitive proxy boundary: any object reachable through a proxied object is itself proxied, with consistent identity and shared revocation. |
| **Wrapping identity** | The requirement that the *same* target seen twice through a membrane yields the *same* wrapper (a `WeakMap` cache). |
| **invokedynamic** | A JVM instruction (`indy`) enabling efficient dynamic call sites via `MethodHandle`s; a faster path than reflection for some interception. |
| **MethodHandle** | A typed, directly-invokable reference to a method; faster than `Method.invoke`. |
| **Deoptimization** | The JIT discarding optimized code when an assumption (e.g., a monomorphic call site) breaks — megamorphic proxied calls can suffer. |
| **Revocation** | Disabling a proxy so all further operations throw; central to capability security and membranes. |

---

## Core Concepts

### 1. The generation pipeline: from "intercept" to a real class

A class proxy is a *new type* synthesized at runtime:

```text
ByteBuddy / CGLIB DSL
        │  (describe: subclass T, override methods, delegate to interceptor)
        ▼
   ASM emits a byte[]  (a valid .class image in memory)
        │
        ▼
   ClassLoader.defineClass  (loaded into a classloader, often a child/wrapper)
        │
        ▼
   Objenesis or constructor  → an instance materialized
        │
        ▼
   JIT compiles the hot interceptor path after warm-up
```

Consequences a senior must reason about: **metaspace pressure** (each generated class consumes metaspace; thousands of proxies/mocks can leak if classloaders aren't released), **warm-up cost** (the first calls are interpreted/slow), **classloader visibility** (the generated class must "see" the interfaces/types it references), and **named-module/`--add-opens`** issues on modern JDKs when reflecting into closed packages.

### 2. Reflective invoke vs MethodHandle vs direct override

Three forwarding mechanisms, increasing speed:

- **`Method.invoke`** — fully reflective, slowest, wraps target exceptions in `InvocationTargetException`. Fine for cold paths.
- **`MethodHandle` / `invokedynamic`** — typed handle resolved once, invoked nearly as fast as a direct call; the modern high-performance interception substrate.
- **Overridden method calling `super`** (CGLIB `invokeSuper`, ByteBuddy `@SuperCall`) — essentially a direct virtual call; fastest forward.

Production frameworks moved toward `MethodHandle`/generated dispatch precisely to keep interception off the slow reflective path.

### 3. JS proxy invariants (the spec's correctness contract)

A JS `Proxy` is not a free-for-all. The spec enforces **invariants** so a proxy can't lie in ways that would corrupt the language's guarantees:

- If a property is **non-configurable and non-writable** on the target, the `get` trap **must** return the same value.
- `getOwnPropertyDescriptor` can't report a non-configurable property as configurable.
- `deleteProperty` can't claim to delete a non-configurable property.
- `has` can't hide a non-configurable own property.
- `ownKeys` must include all non-configurable own keys and respect extensibility.

Violating an invariant throws `TypeError`. This is why `Reflect` matters: forwarding to `Reflect` automatically satisfies invariants. A senior building a proxy framework respects these or hits non-obvious throws on frozen/sealed objects.

### 4. The membrane pattern

A single proxy wraps one object. A **membrane** wraps a *graph*: whenever a proxied object returns another object (from a getter, method result, or argument going the other way), that object is *also* wrapped — recursively — so nothing un-proxied leaks across the boundary. Two requirements:

- **Identity preservation:** the same target wrapped twice must yield the same wrapper (cache in a `WeakMap`), or `===`/`is` comparisons inside the membrane break.
- **Shared revocation:** one `revoke()` disables the *entire* membrane at once (capability cutoff).

Membranes are how you sandbox untrusted code, build secure compartments, and implement transparent lazy/transactional boundaries over object graphs.

### 5. The metaobject protocols, compared

| Language | Lookup hook | "Everything" hook | Notes |
|----------|-------------|-------------------|-------|
| Python | `__getattr__` (missing) | `__getattribute__` (all) + **descriptors** | Methods are non-data descriptors; `property` is a data descriptor. |
| Ruby | `method_missing` | (no global one) + `respond_to_missing?` | `define_method` can *materialize* a real method after first miss (caching). |
| JS | `Proxy` `get` trap | `Proxy` `get`/`has`/etc. | Constrained by invariants; `Reflect` for defaults. |

The "synthesis" in *dynamic dispatch & proxies* is exactly the act of answering through these hooks for names that have no statically-written method.

### 6. Identity, equality, hashing, serialization — the collateral damage

Interception breaks the things that assume an object *is* itself:

- **`instanceof`/`isinstance`/`is_a?`** — a class proxy passes `instanceof Target` (it's a subclass) but a JDK interface proxy does **not** pass `instanceof RealClass`.
- **`equals`/`hashCode`** — Hibernate proxies override these to forward to the underlying entity; naive proxies break `Set`/`Map` membership.
- **Identity (`==`/`is`)** — a proxy is a different object; identity maps and `==`-by-reference checks misbehave. Membranes need the wrapper cache to restore *relative* identity.
- **Serialization** — serializing a proxy serializes the generated class, which the deserializer may not have. Frameworks register custom serializers or unwrap to the target first.
- **`getClass()`/`toString()`** — return the generated type name unless overridden, leaking implementation detail into logs.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Bytecode generation** | A factory that, on demand, fabricates a brand-new machine part to spec while the line is running. |
| **Membrane** | An airlock around an entire wing: anything entering or leaving is sealed in a suit; one switch evacuates the whole wing. |
| **Wrapping identity** | The airlock keeps a register so the *same* person always gets the *same* suit — colleagues still recognize each other. |
| **Proxy invariants (JS)** | Building codes the airlock must obey; you can customize the door, but you cannot make a load-bearing wall vanish. |
| **MethodHandle vs reflection** | A direct dial line vs going through a switchboard operator for every call. |
| **Deoptimization** | A highway that was widened for predictable traffic suddenly narrowing when traffic becomes chaotic (megamorphic). |
| **Revocation** | Burning the only bridge: every path through it is instantly cut. |

---

## Mental Models

### The "Generated Type Has a Real Cost" Model

Every CGLIB/ByteBuddy proxy and every Mockito mock is a *new class* in metaspace, JIT-compiled after warm-up, loaded by *some* classloader. Hold the cost in mind: thousands of distinct generated classes (e.g., a test suite that mocks heavily, or a per-request proxy) can pressure metaspace and pin classloaders, causing leaks. The fix is class reuse/caching and bounded generation.

### The "Invariant-Preserving Mirror" Model (JS)

Think of a transparent proxy as a mirror that must reflect the target *accurately enough* that the language's guarantees still hold. The JS engine actively checks the mirror against the target for frozen/non-configurable properties. Forward to `Reflect` and the mirror stays honest for free; hand-roll the trap and you must uphold the invariants yourself.

### The "Boundary, Not a Point" Model (membranes)

A single proxy is a point of interception; a membrane is a *boundary* with a topology. Reason about what crosses it in *both* directions (return values out, arguments in), maintain a wrapper cache for identity, and treat `revoke()` as a global cut. This is the model behind secure sandboxes and transparent persistence/transaction boundaries over object graphs.

---

## Code Examples

### ByteBuddy — generate a logging subclass at runtime

```java
import net.bytebuddy.ByteBuddy;
import net.bytebuddy.implementation.MethodDelegation;
import net.bytebuddy.implementation.bind.annotation.*;
import static net.bytebuddy.matcher.ElementMatchers.*;

public class Logged {
    public static class Interceptor {
        @RuntimeType
        public static Object intercept(@Origin String method,
                                       @SuperCall java.util.concurrent.Callable<?> zuper)
                throws Exception {
            System.out.println("-> " + method);
            try { return zuper.call(); }            // direct super call, not reflection
            finally { System.out.println("<- " + method); }
        }
    }

    static <T> Class<? extends T> proxyType(Class<T> type) {
        return new ByteBuddy()
            .subclass(type)
            .method(isPublic().and(not(isFinal())))   // only overridable methods
            .intercept(MethodDelegation.to(Interceptor.class))
            .make()
            .load(type.getClassLoader())
            .getLoaded();
    }
}
```

`@SuperCall Callable` captures a direct invocation of the original method — far faster than `Method.invoke`, and it never recurses into the proxy. `not(isFinal())` makes the seam explicit: final methods are not woven.

### Java — forwarding with a MethodHandle (faster than reflection)

```java
import java.lang.invoke.*;
import java.lang.reflect.*;

class HandleHandler implements InvocationHandler {
    private final Object target;
    private final java.util.Map<Method, MethodHandle> cache = new java.util.HashMap<>();
    HandleHandler(Object target) { this.target = target; }

    public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
        MethodHandle h = cache.computeIfAbsent(m, mm -> {
            try { return MethodHandles.lookup().unreflect(mm).bindTo(target); }
            catch (IllegalAccessException e) { throw new RuntimeException(e); }
        });
        return args == null ? h.invoke() : h.invokeWithArguments(args);
    }
}
```

Resolving the `MethodHandle` once and reusing it avoids the per-call reflective overhead and the `InvocationTargetException` wrapping that `Method.invoke` imposes.

### JavaScript — an identity-preserving membrane with shared revocation

```javascript
function makeMembrane(rootTarget) {
  const wrappers = new WeakMap();   // target -> wrapper, preserves identity
  let revoked = false;

  function wrap(target) {
    if (target === null || (typeof target !== "object" && typeof target !== "function")) {
      return target;                       // primitives cross unchanged
    }
    if (wrappers.has(target)) return wrappers.get(target);

    const handler = {
      get(t, prop, receiver) {
        if (revoked) throw new Error("membrane revoked");
        return wrap(Reflect.get(t, prop, receiver));   // wrap values crossing OUT
      },
      apply(t, thisArg, args) {
        if (revoked) throw new Error("membrane revoked");
        // unwrap args crossing IN, wrap the result crossing OUT
        return wrap(Reflect.apply(t, thisArg, args));
      },
    };
    const proxy = new Proxy(target, handler);
    wrappers.set(target, proxy);
    return proxy;
  }

  return { proxy: wrap(rootTarget), revoke() { revoked = true; } };
}

const realApi = { config: { name: "svc" }, getConfig() { return this.config; } };
const { proxy, revoke } = makeMembrane(realApi);
console.log(proxy.getConfig() === proxy.config); // true — identity preserved inside membrane
revoke();
// proxy.config now throws everywhere reachable through the membrane
```

This captures the three membrane essentials: transitive wrapping (the returned `config` is itself a proxy), identity preservation (the `WeakMap` makes the two views compare equal), and one-switch revocation.

### Python — a descriptor-based lazy proxy (synthesis on first access)

```python
class Lazy:
    """A descriptor that materializes the real value on first access, then caches it."""
    def __init__(self, factory):
        self.factory = factory
        self.name = None
    def __set_name__(self, owner, name):
        self.name = name
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        value = self.factory()                 # the expensive call happens HERE, once
        obj.__dict__[self.name] = value        # shadow the descriptor: future reads are direct
        return value


class Report:
    rows = Lazy(lambda: expensive_query())     # not run until report.rows is touched
```

This is the metaobject-protocol version of a virtual proxy: the descriptor intercepts the *first* read, synthesizes the value, then writes it into the instance dict so the descriptor is bypassed afterward — zero per-access overhead after warm-up.

### Ruby — `method_missing` that promotes to a real method (self-healing dispatch)

```ruby
class Lazy
  def initialize(loader) = @loader = loader

  def method_missing(name, *args, &blk)
    if @loader.respond_to?(name)
      # define a real method so the NEXT call skips method_missing entirely
      self.class.define_method(name) do |*a, &b|
        @loader.public_send(name, *a, &b)
      end
      @loader.public_send(name, *args, &blk)
    else
      super
    end
  end

  def respond_to_missing?(name, include_private = false)
    @loader.respond_to?(name, include_private) || super
  end
end
```

The first call to an unknown method falls into `method_missing`, which *materializes* a real method via `define_method`; every subsequent call dispatches directly. This is the standard trick to avoid paying the `method_missing` cost forever — the same idea as Python's descriptor caching above.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Bytecode-generated proxies** | Near-native forward speed; works on concrete classes. | Metaspace cost; warm-up; classloader/module access issues; debugging through generated frames. |
| **MethodHandle/indy forwarding** | Much faster than reflection; no exception wrapping. | More complex; must manage handle caching and bootstrap. |
| **Membranes** | Strong isolation; transactional/secure boundaries over whole graphs. | Subtle identity/`WeakMap` management; performance per crossing; revocation semantics to get right. |
| **Metaobject hooks** | No codegen; ultimate flexibility; self-healing dispatch via define-method/descriptor caching. | "Every access" hooks are slow and recursion-prone; introspection (`dir`, autocomplete) degrades. |
| **JS Proxy** | Spec-enforced invariants keep it sound. | Invariants throw on frozen/sealed targets; per-op overhead; some operations (private fields) don't trap. |

---

## Use Cases

- **High-performance interception layers** (RPC stubs, ORMs, AOP) where per-call cost matters → MethodHandle/generated dispatch, not reflection.
- **Secure sandboxes / plugin isolation** → membranes with revocation.
- **Transparent persistence/transaction boundaries** over object graphs → membrane-style proxies that intercept reads/writes and flush at the boundary.
- **Lazy graphs** (Hibernate, GraphQL dataloaders) → virtual proxies materializing on first touch, with identity preserved.
- **Reactive systems at scale** (Vue 3, signals) → `Proxy`-based dependency tracking with careful invariant handling.
- **Mocking/test doubles** → generated subclasses; understand metaspace impact in large suites.

---

## Coding Patterns

### Pattern 1: Cache generated classes and handles

Generate one proxy class per (target type, advice) pair and reuse it; cache `MethodHandle`s per `Method`. Never regenerate per instance/call.

### Pattern 2: Forward to `Reflect` to satisfy invariants (JS)

Any trap that isn't a full override must end in `Reflect.<trap>(...)`. This is the only reliable way to honor non-configurable/frozen-property invariants.

### Pattern 3: Preserve identity in membranes with a `WeakMap`

`target → wrapper` cache so the same target always yields the same proxy. Without it, `===`/`is` inside the membrane silently breaks.

### Pattern 4: Promote dynamic dispatch to real methods after first use

Ruby `define_method` / Python descriptor caching: pay the synthesis cost once, then dispatch directly. Avoids permanent `method_missing`/`__getattribute__` overhead.

### Pattern 5: Override identity/equality deliberately

If callers compare or hash proxied objects, forward `equals`/`hashCode`/`==`/`__eq__` to the target (as Hibernate does) — or document loudly that you don't.

---

## Best Practices

- **Bound proxy generation.** Reuse generated classes; watch metaspace; release classloaders that own per-request proxies.
- **Prefer `MethodHandle`/`@SuperCall` over `Method.invoke`** on hot paths; reserve reflection for cold/setup code.
- **Always forward to `Reflect` in partial JS traps** to keep invariants intact.
- **Design membranes around identity and revocation up front** — retrofitting a `WeakMap` and revocation into a leaky boundary is painful.
- **Decide and document the identity story.** What does `==`/`instanceof`/serialization do through your proxy? Make it explicit.
- **Unwrap before serialization.** Serialize the target, not the generated class.
- **Mind named modules / `--add-opens`.** Reflective/bytecode access into closed packages fails loudly on modern JDKs.
- **Benchmark the megamorphic case.** A proxy that sees many concrete types at one call site can defeat the JIT's inline cache; measure, don't assume.

---

## Edge Cases & Pitfalls

- **Metaspace leak from runaway generation** — per-instance or per-request proxy/mocks pinning classloaders; OOM in metaspace.
- **JS invariant violations** — a `get` trap returning a different value for a non-configurable, non-writable property throws `TypeError`; sealing/freezing a target then proxying surprises people.
- **Membrane identity loss** — forgetting the wrapper cache → the same target appears as two different objects; `===` and `Set` membership break.
- **Private fields don't trap (JS)** — `#field` access uses an internal slot the `get` trap can't see; membranes can't fully wrap classes using private fields.
- **`MethodHandle` access on closed packages** — `IllegalAccessException`/`InaccessibleObjectException` under the module system without `--add-opens`.
- **Deoptimization on megamorphic proxied sites** — one generic call site handling many types loses inlining; throughput drops.
- **Serialization of proxies** — the deserializer lacks the generated class; serialize the unwrapped target or register a resolver.
- **`equals`/`hashCode` asymmetry** — `proxy.equals(target)` true but `target.equals(proxy)` false unless both sides cooperate; breaks `Set`/`Map`.
- **Descriptor/`define_method` shadowing surprises** — promoting to a real method changes future dispatch; if the target is later swapped, the cached method is stale.
- **Constructor side effects skipped** — Objenesis-created proxies never ran the constructor; fields the real logic relies on may be unset.

---

## Test Yourself

1. Walk the full pipeline from "I want to proxy class `Foo`" to "I have an instance," naming each tool (ByteBuddy/ASM/classloader/Objenesis) and the cost it introduces.
2. State three JS proxy invariants. Why does forwarding to `Reflect` satisfy them automatically?
3. What are the two non-negotiable properties of a correct membrane? What breaks if each is missing?
4. Compare `Method.invoke`, `MethodHandle.invoke`, and a `@SuperCall` for forwarding: speed, exception behavior, recursion risk.
5. Explain how a Python descriptor or Ruby `define_method` turns a *dynamic* dispatch into a one-time cost. Why is the second call cheap?
6. Your test suite mocks thousands of classes and metaspace climbs steadily. Diagnose it in terms of generated classes and classloaders.
7. Why can a JS membrane fail to fully wrap a class that uses `#private` fields?
8. A serialized proxy fails to deserialize on another node. Explain why and give two fixes.

---

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────────────┐
│                 PROXIES AT DEPTH — SENIOR LEVEL                          │
├────────────────────────────────────────────────────────────────────────┤
│ Generation pipeline:                                                    │
│   DSL (ByteBuddy/CGLIB) → ASM byte[] → defineClass → Objenesis/ctor      │
│   costs: metaspace · JIT warm-up · classloader visibility · modules     │
├────────────────────────────────────────────────────────────────────────┤
│ Forward speed:  Method.invoke  <  MethodHandle/indy  <  @SuperCall      │
│   (reflective, wraps exc)         (typed, fast)         (direct super)   │
├────────────────────────────────────────────────────────────────────────┤
│ JS Proxy invariants (forward to Reflect to satisfy):                    │
│   * non-config non-writable get must match                              │
│   * can't hide non-config own keys / report wrong descriptors           │
│   #private fields do NOT trap                                           │
├────────────────────────────────────────────────────────────────────────┤
│ MEMBRANE = transitive proxy boundary                                    │
│   1. wrap everything crossing OUT and IN                                │
│   2. WeakMap target→wrapper  (identity preserved)                       │
│   3. one revoke() cuts the whole graph                                  │
├────────────────────────────────────────────────────────────────────────┤
│ Self-healing dispatch: Ruby define_method / Python descriptor caching   │
│   pay synthesis ONCE, then dispatch directly                            │
├────────────────────────────────────────────────────────────────────────┤
│ Collateral damage: instanceof · ==/is · equals/hashCode · serialization │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A production proxy is **runtime code synthesis**: ByteBuddy/CGLIB describe a subclass, ASM emits bytecode, a classloader defines it, Objenesis/constructor instantiates it, and the JIT warms the interceptor path. Each step has a real cost (metaspace, warm-up, classloader/module visibility).
- Forwarding speed ranges from **`Method.invoke`** (reflective, exception-wrapping) through **`MethodHandle`/invokedynamic** to a direct **`@SuperCall`/`invokeSuper`**. Hot paths should avoid reflection.
- JS `Proxy` is bound by **invariants** that keep it sound against frozen/non-configurable targets; forwarding to **`Reflect`** satisfies them automatically. `#private` fields don't trap.
- A **membrane** extends a single proxy to a whole graph: transitive wrapping both directions, **identity preservation via a `WeakMap`**, and **shared revocation**. It's the basis of sandboxes and transparent persistence/transaction boundaries.
- The metaobject protocols (Python descriptors/`__getattribute__`, Ruby `method_missing`/`define_method`, JS traps) let you **synthesize** behavior — and you can **promote** a dynamic dispatch into a real cached method to pay the cost only once.
- Interception inflicts **collateral damage** on identity, equality/hashing, `instanceof`, and serialization; mature frameworks forward `equals`/`hashCode` (Hibernate), unwrap before serializing, and document their identity story.

---

## What You Can Build

- **A minimal ByteBuddy/CGLIB AOP engine**: annotation-driven `@Timed`/`@Logged` advice applied to overridable methods, with a generated-class cache; measure metaspace growth.
- **A JS membrane library**: transitive wrapping, `WeakMap` identity, `revoke()`, and a test proving `===` holds inside and throws after revocation.
- **A MethodHandle-based dynamic proxy** that benchmarks forward latency against a `Method.invoke` version.
- **A lazy object graph** in Python using descriptors, with identity preserved across repeated access and a flag proving the factory runs exactly once.
- **A self-healing Ruby proxy** that promotes `method_missing` hits into real methods and benchmarks call N=1 vs N=2.
- **A serialization-safe proxy**: detect a proxy, unwrap to the target on the write path, and re-proxy on read.

---

## Further Reading

- *ByteBuddy tutorial & Javadoc* — `MethodDelegation`, `@SuperCall`, `@Origin`. https://bytebuddy.net/#/tutorial
- *ASM User Guide* — https://asm.ow2.io/
- *Tom Van Cutsem — "Membranes in JavaScript"* and the harmony-reflect work; the canonical membrane references.
- *ECMAScript spec — Proxy internal methods and invariants* — https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots
- *Java `MethodHandles`/`invokedynamic`* — JSR-292 background; John Rose's blog.
- *Python Descriptor HowTo Guide* — https://docs.python.org/3/howto/descriptor.html
- *Hibernate User Guide — bytecode enhancement & proxies* — lazy loading internals.
- *Mockito inline mock maker design notes* — ByteBuddy-based mocking of finals/statics.

---

## Related Topics

- This folder, other levels: [`junior.md`](junior.md), [`middle.md`](middle.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling metaprogramming topics in this section — runtime code generation, reflection, and AST/bytecode manipulation — supply the generation substrate that proxies depend on.
- The runtime-systems coverage of vtables/inline caches and JIT deoptimization complements the performance discussion here; that topic explains *how* dispatch is optimized, while this one is about *intercepting and synthesizing* it.
