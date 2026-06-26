# Dynamic Dispatch & Proxies — Professional Level

> **Topic:** [Dynamic Dispatch & Proxies](README.md)
> **Focus:** Proxies in production frameworks — AOP, lazy loading, mocking, reactivity — and the failure modes that bite real systems.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Where Proxies Power Real Frameworks](#where-proxies-power-real-frameworks)
3. [The Self-Invocation Trap](#the-self-invocation-trap)
4. [Code Examples](#code-examples)
5. [Performance](#performance)
6. [Best Practices](#best-practices)
7. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
8. [War Stories](#war-stories)
9. [Summary](#summary)

---

## Introduction

A proxy is a stand-in object that intercepts the operations performed on it and
decides what to do — forward, augment, block, or synthesize. As metaprogramming, it
is the mechanism by which a framework adds behavior to *your* objects without you
writing that behavior into them: the transaction that begins before your method runs,
the entity field that loads from the database the first time you touch it, the mock
that records the calls your test makes, the reactive object that re-renders the UI
when you assign to a property. At the professional tier the goal is to understand
which proxy technology a framework uses, what it can and cannot intercept, and the
handful of failure modes (self-invocation, broken identity, mangled stack traces)
that turn the magic into a debugging session.

---

## Where Proxies Power Real Frameworks

- **AOP / cross-cutting concerns (Spring).** `@Transactional`, `@Cacheable`,
  `@Async`, `@Retryable`, security checks — Spring wraps your bean in a proxy whose
  interceptor opens a transaction (or checks the cache) before delegating to your
  method. JDK dynamic proxies handle interface-typed beans; CGLIB/ByteBuddy subclass
  proxies handle class-typed beans.
- **Lazy loading (Hibernate/JPA).** A `@OneToMany` collection or a lazily-fetched
  entity is a proxy; touching it triggers a query. Touch it after the session closes
  and you get `LazyInitializationException`.
- **Mocking (Mockito, unittest.mock, Sinon).** A mock is a proxy that records
  invocations and returns stubbed values; `verify(mock).foo()` reads the recorded
  calls. Mockito uses ByteBuddy to subclass the mocked type at runtime.
- **Reactivity (Vue 3, MobX, Solid stores).** Vue 3 wraps reactive state in a JS
  `Proxy` whose `get` trap tracks dependencies and `set` trap triggers re-render —
  replacing Vue 2's `Object.defineProperty` approach and gaining the ability to detect
  property addition and array index writes.
- **Remote/RPC stubs.** A client stub is a proxy that turns a method call into a
  network request — gRPC clients, JDK proxies over an `InvocationHandler` that
  serializes and sends.

---

## The Self-Invocation Trap

The single most important production pitfall with subclass/interface proxies:
**a proxy only intercepts calls that go *through* the proxy reference.** When a method
on the target calls `this.otherMethod()`, that call goes directly to the target — not
the proxy — so the cross-cutting behavior is bypassed.

```java
@Service
class OrderService {
    @Transactional
    public void outer() { this.inner(); }   // calls inner() on `this`, NOT the proxy

    @Transactional(propagation = REQUIRES_NEW)
    public void inner() { ... }              // its @Transactional is SILENTLY IGNORED
}
```

`inner()`'s transactional advice never runs because `this.inner()` skips the proxy.
This is the source of countless "why isn't my `@Transactional`/`@Cacheable`/`@Async`
working?" bugs. Fixes: inject a self-reference to the proxy, restructure so the call
crosses a bean boundary, or use AspectJ load-time/compile-time weaving (which modifies
the bytecode directly and has no proxy boundary). The same trap exists for any
proxy-based AOP. Also: `final` methods and `private` methods can't be overridden by a
subclass proxy, so their advice silently doesn't apply.

---

## Code Examples

JS `Proxy` + `Reflect` (the reactivity primitive), forwarding by default and adding
behavior:

```js
function observable(target, onChange) {
  return new Proxy(target, {
    get(t, k, r) { track(k); return Reflect.get(t, k, r); },          // dependency tracking
    set(t, k, v, r) {
      const ok = Reflect.set(t, k, v, r);                              // default behavior
      onChange(k, v);                                                  // augmentation
      return ok;
    },
  });
}
```

`Reflect` gives the exact default operation each trap is overriding, so you augment
rather than reimplement — the idiomatic pairing.

Python `__getattr__` as a lazy RPC client (only called for *missing* attributes):

```python
class RpcClient:
    def __getattr__(self, name):              # synthesizes a method per call name
        def call(*args): return self._send(name, args)
        return call
```

Note `__getattr__` fires only when normal lookup fails; `__getattribute__` fires on
*every* access and is a recursion footgun.

---

## Performance

- Every intercepted call pays overhead: a reflective `Method.invoke`, an extra stack
  frame, trap dispatch. For hot paths this matters — proxies are great for
  coarse-grained boundaries (a service method) and poor for tight inner loops.
- Subclass-proxy creation (CGLIB/ByteBuddy) generates a class at runtime — startup
  and metaspace cost; mocking thousands of types in a test suite is measurable.
- JS `Proxy` adds a per-operation trap cost; reactivity frameworks limit what they
  wrap (e.g. shallow vs deep reactive) to control it.
- Proxies defeat JIT inlining across the boundary, so the optimizer can't flatten the
  intercepted call.

---

## Best Practices

- **Know what your framework's proxy can intercept** (interface vs class, public vs
  `final`/`private`) before relying on an annotation.
- **Never assume `this.method()` is advised** — design so cross-cutting calls cross a
  proxy boundary, or use weaving.
- **Pair JS `Proxy` traps with `Reflect`** so the default behavior is exact.
- **Avoid `__getattribute__`** unless you truly must intercept *all* access; prefer
  `__getattr__` for the missing-attribute case and guard against recursion.
- **Keep proxies coarse-grained**; don't wrap hot inner objects.
- **Document the magic** — a proxied bean's stack trace is full of
  `$$EnhancerBySpringCGLIB$$` frames; tell readers where the real method is.

---

## Edge Cases & Pitfalls

- **Self-invocation bypass** (above) — the #1 AOP bug.
- **`final`/`private`/static methods** can't be subclass-proxied; their advice
  silently doesn't apply.
- **Identity & equality break:** a proxy is not the target; `==`, `instanceof`/
  `isinstance`, `equals`, and hashing can behave unexpectedly. Hibernate proxies
  failing `instanceof` checks is classic.
- **`LazyInitializationException`:** touching a lazy proxy after the persistence
  context closed.
- **`__getattribute__` infinite recursion:** accessing `self.x` inside it re-enters
  it; you must call `super().__getattribute__`.
- **`method_missing` typo-swallowing:** undefined methods silently become dynamic
  lookups; pair with `respond_to_missing?`.
- **Mangled stack traces:** generated proxy classes pollute traces and confuse
  "go to definition."

---

## War Stories

- **The silent `@Transactional`:** a service's `outer()` called `this.inner()` where
  `inner()` was `@Transactional(REQUIRES_NEW)`; the new transaction never started, so
  a failure that should have rolled back only the inner unit corrupted the outer one.
  Root cause: self-invocation bypassing the proxy.
- **Vue 2 → Vue 3 reactivity:** Vue 2 (`Object.defineProperty`) couldn't detect newly
  added properties or direct array index assignment, forcing `Vue.set`; Vue 3's
  `Proxy` traps fixed it by intercepting all property operations — a textbook proxy
  upgrade.
- **Mockito metaspace blowup:** a large suite mocking many distinct classes generated
  thousands of ByteBuddy subclasses, inflating metaspace and slowing CI until mocks
  were reused and scope-narrowed.

---

## Summary

Proxies are how frameworks bolt behavior onto your objects without touching their
source — the engine of AOP, lazy loading, mocking, RPC stubs, and modern reactivity.
The professional essentials: know which proxy mechanism a framework uses and what it
can intercept (interface vs class, public vs `final`); internalize the self-invocation
trap that silently disables annotation magic; pair JS `Proxy` with `Reflect`; avoid
`__getattribute__` recursion; and remember that proxies cost per-call performance,
break identity, and clutter stack traces. Used at coarse boundaries with eyes open,
they're indispensable; used carelessly, they're a debugging tax.
