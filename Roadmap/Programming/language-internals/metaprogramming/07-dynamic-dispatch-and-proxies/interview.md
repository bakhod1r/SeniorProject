# Dynamic Dispatch & Proxies — Interview Questions

> **Topic:** [Dynamic Dispatch & Proxies](README.md)

---

## Introduction

These questions test whether a candidate understands proxies as the metaprogramming
technique of *intercepting and synthesizing behavior* — distinct from the low-level
vtable dispatch of the runtime. Strong answers can explain JDK vs CGLIB/ByteBuddy
proxies, the JS `Proxy`/`Reflect` pairing, Python `__getattr__` vs `__getattribute__`,
Ruby `method_missing`, and — above all — the self-invocation trap that silently
disables proxy-based AOP.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is a proxy, in the metaprogramming sense?**

A stand-in object that intercepts operations (method calls, property access)
performed on it and decides what to do — forward to a target, augment with extra
behavior, block, or synthesize a response. It lets you add behavior to an object
without modifying the object's own code.

## Question 2

**How is this different from the dynamic dispatch a vtable does?**

Vtable dispatch is the runtime *resolving which existing method to call* on a virtual
call — a fixed, compiler-generated mechanism. Proxy-based dispatch is *metaprogramming*:
it intercepts the call to run arbitrary logic and may synthesize a method that was
never statically defined. One selects among defined methods; the other manufactures or
wraps behavior.

## Question 3

**Name the canonical use cases for proxies.**

Cross-cutting concerns / AOP (logging, timing, transactions, caching, retry, security),
lazy initialization/loading, remote proxies (RPC stubs), virtual and protection
proxies, mocking in tests, and reactive/observable objects. The common thread:
intercept access to inject behavior.

## Question 4

**What's the difference between a virtual proxy, a protection proxy, and a remote
proxy?**

A virtual proxy defers creation/loading of an expensive object until first use (lazy
loading); a protection proxy enforces access control before delegating; a remote proxy
represents an object in another process/machine, turning calls into messages (RPC
stubs). All three share the "stand-in that intercepts" shape.

---

## Language-Specific

## Question 5

**Java: JDK dynamic proxy vs CGLIB/ByteBuddy — when is each used?**

JDK `java.lang.reflect.Proxy` proxies **interfaces** only, routing every call through
an `InvocationHandler.invoke`. CGLIB/ByteBuddy generate a **subclass** at runtime, so
they can proxy concrete classes (no interface needed) but can't override `final`/
`private`/static methods. Spring uses JDK proxies when the bean is interface-typed and
CGLIB/ByteBuddy when it's class-typed.

## Question 6

**JS: what are `Proxy` and `Reflect`, and why are they used together?**

`Proxy` wraps a target with traps (`get`, `set`, `has`, `deleteProperty`, `apply`,
`construct`, …) that intercept operations. `Reflect` provides the *default*
implementation of each operation, so inside a trap you call `Reflect.get(...)` to do
the normal thing and add your behavior around it — augmenting rather than
reimplementing. Vue 3 reactivity is built on this.

## Question 7

**Python: `__getattr__` vs `__getattribute__`?**

`__getattr__` is called **only when normal attribute lookup fails** (the attribute is
missing) — ideal for synthesizing attributes/methods on demand. `__getattribute__` is
called on **every** attribute access, is far more powerful and far more dangerous
(easy infinite recursion — you must delegate to `super().__getattribute__`), and is
rarely needed.

## Question 8

**Ruby: how does `method_missing` implement dynamic dispatch?**

When a message isn't matched by a defined method, Ruby calls `method_missing(name,
*args)`, letting the object synthesize behavior (ActiveRecord `find_by_email`). It must
be paired with `respond_to_missing?` so `respond_to?` and `Method` objects reflect the
dynamic methods honestly.

## Question 9

**Go has no `method_missing`/proxy interception. How do Go programs get similar
results?**

Through interfaces plus struct embedding/composition (promoted methods) and explicit
wrapper types, plus a bit of `reflect` for generic tooling. The lack of dynamic
interception is deliberate — Go favors explicit, statically-checkable code over
runtime magic.

---

## Tricky / Trap

## Question 10

**Your `@Transactional` annotation on a method isn't taking effect. Most likely
cause?**

Self-invocation: the method is called via `this.method()` from another method of the
same bean, so the call bypasses the Spring proxy and the transactional advice never
runs. Same for `@Cacheable`/`@Async`. Fix by crossing a proxy boundary (self-injection,
restructuring) or using AspectJ weaving.

## Question 11

**Why might a `@Transactional` on a `final` or `private` method silently do nothing?**

A CGLIB/ByteBuddy subclass proxy overrides methods to add advice, but it can't override
`final`, `private`, or static methods — so there's no interception point and the advice
is silently skipped.

## Question 12

**A Hibernate-loaded entity fails an `instanceof SomeClass` check or `equals`. Why?**

It's a lazy-loading proxy (a generated subclass), not a direct instance, so identity-
and type-sensitive operations can behave unexpectedly; `instanceof` against the concrete
class or naive `equals`/`==` may fail. Use the entity's interface, `Hibernate.unproxy`,
or id-based equals.

## Question 13

**Why is overriding `__getattribute__` to add logging dangerous?**

It runs on *every* attribute access, so any `self.x` inside it re-invokes it →
infinite recursion (you must call `super().__getattribute__('x')`), and it adds cost
to all access. `__getattr__` (missing-only) is almost always the right hook.

## Question 14

**What's the cost of `method_missing` beyond performance?**

It swallows typos: a misspelled method name silently routes to `method_missing` (e.g.
a dynamic-finder attempt) instead of raising `NoMethodError`, hiding bugs. And without
`respond_to_missing?`, reflection lies about which methods exist.

---

## Design

## Question 15

**Design a logging/timing proxy that wraps any service interface. What mechanism per
language?**

Java: `Proxy.newProxyInstance` with an `InvocationHandler` that times around
`method.invoke(target, args)` (interfaces) or ByteBuddy for classes. JS: a `Proxy`
with an `apply`/`get`-returns-wrapped-function trap using `Reflect`. Python: `__getattr__`
returning a wrapper, or a class decorator. Keep it coarse-grained (service boundary),
preserve identity/signature where possible, and ensure exceptions propagate unwrapped.

## Question 16

**You need reactive objects (re-run code when a field changes). Proxy or explicit
setters? Trade-offs.**

A `Proxy` (Vue 3 style) is transparent — plain property assignment triggers reactivity,
including new properties and array indices — but adds per-access trap cost and can
surprise on identity/serialization. Explicit setters/signals (Solid, MobX actions) are
more verbose but more predictable and faster. Choose Proxy for ergonomic transparency,
explicit for performance and clarity; many frameworks offer both shallow and deep modes
to bound the cost.
