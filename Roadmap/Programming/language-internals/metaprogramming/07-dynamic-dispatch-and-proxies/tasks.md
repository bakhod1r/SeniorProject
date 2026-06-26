# Dynamic Dispatch & Proxies — Hands-On Tasks

> **Topic:** [Dynamic Dispatch & Proxies](README.md)

---

## Introduction

Proxies are best learned by building one, then deliberately triggering the failure
modes that bite real systems — the self-invocation bypass, the `__getattribute__`
recursion, the identity break. These exercises span JS (`Proxy`/`Reflect`), Python
(`__getattr__`/`__getattribute__`), and a Java-flavored AOP scenario you can do in
Java or reason about. The goal is to make the magic legible: you should be able to say
exactly what gets intercepted and what slips past.

Tick a self-check box when you can explain *which calls are intercepted and which are
not*, not merely when the demo runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — A forwarding JS Proxy

Wrap an object in a `Proxy` whose `get`/`set` traps log access and then forward via
`Reflect`. Confirm the wrapped object behaves identically plus logging.

**Self-check:**
- [ ] Reads and writes work exactly as before, with a log line each.
- [ ] I used `Reflect.get`/`Reflect.set` for the default behavior and can explain why.

### Task 2 — Python `__getattr__` synthesizes methods

Write a class whose `__getattr__` returns a function for any unknown name (a fake RPC
client). Show that `client.do_thing(1)` works without `do_thing` being defined.

**Self-check:**
- [ ] Undefined method names are synthesized on demand.
- [ ] I can explain that `__getattr__` fires only for *missing* attributes.

---

## Core

### Task 3 — Timing proxy over an interface (Java or pseudo)

Use `java.lang.reflect.Proxy` + an `InvocationHandler` to wrap a service interface so
every call is timed. (Or implement the equivalent with a JS `Proxy` `apply`/function
trap.)

**Self-check:**
- [ ] Every interface method is timed without modifying the implementation.
- [ ] I can explain why JDK proxies need an *interface* and what I'd use for a concrete class (CGLIB/ByteBuddy).

### Task 4 — Reproduce the self-invocation trap

Create a class with `outer()` calling `this.inner()`, where `inner()` carries
cross-cutting advice (a transaction/log decorator applied via a proxy). Show the advice
on `inner()` does NOT run when called from `outer()`.

**Self-check:**
- [ ] `inner()`'s advice runs when called through the proxy directly, but NOT via `this.inner()` from `outer()`.
- [ ] I can explain the bypass and name two fixes (self-reference to the proxy / boundary restructuring / weaving).

### Task 5 — `__getattr__` vs `__getattribute__` recursion

Implement attribute logging two ways: once with `__getattr__` (works fine), once with
a naive `__getattribute__` (watch it infinite-loop), then fix the second with
`super().__getattribute__`.

**Self-check:**
- [ ] The naive `__getattribute__` recurses; the fixed version delegates to `super()`.
- [ ] I can articulate why `__getattr__` is the safer default.

---

## Advanced

### Task 6 — Reactive object via Proxy

Build a `reactive(obj, onChange)` using a JS `Proxy` so plain assignment
(`state.count++`) triggers `onChange`, including for a newly added property and an
array index write — the things Vue 2's `defineProperty` couldn't catch.

**Self-check:**
- [ ] Property add and array index assignment both trigger `onChange`.
- [ ] I can explain why `Proxy` catches these where `Object.defineProperty` didn't.

### Task 7 — Break and explain identity

Wrap an object in a proxy and show how `instanceof`/`isinstance`, `==`/identity, and
(in Java) `equals` can behave unexpectedly versus the unwrapped target. Then make the
proxy as transparent as you can.

**Self-check:**
- [ ] I demonstrated at least one identity/type surprise.
- [ ] I can explain why this is the root of Hibernate `instanceof`/`equals` proxy bugs.

### Task 8 — Dynamic finder with honest reflection

Implement `find_by_<field>(value)` synthesis (Ruby `method_missing` or Python
`__getattr__`). Then make reflection honest (`respond_to_missing?` / careful
`hasattr`) and show a typo no longer silently succeeds.

**Self-check:**
- [ ] Dynamic finders work; `respond_to?`/`hasattr` agree with reality.
- [ ] I can explain the typo-swallowing danger of unguarded `method_missing`.

---

## Capstone

### Task 9 — A mini-AOP framework, with the traps documented

Build a small AOP utility that, given a target object, returns a proxy applying a chain
of advice (log → time → retry) around each method. Then:

1. Demonstrate it working on a service.
2. Demonstrate the **self-invocation** limitation and document the fix.
3. Demonstrate what happens with a `final`/non-interceptable method.
4. Ensure exceptions propagate unwrapped and identity is preserved as much as possible.

Write a short "operator's note" listing exactly what your proxy can and cannot
intercept.

**Self-check:**
- [ ] Advice composes correctly around interceptable methods.
- [ ] My note correctly states the self-invocation and non-overridable-method limits.
- [ ] Exceptions and (where possible) identity survive the proxy.

---

## Self-Assessment

You own this topic when you can:

- [ ] Explain proxy-based interception versus vtable dispatch.
- [ ] Choose JDK vs subclass proxies (interface vs class, `final`/`private` limits).
- [ ] Use JS `Proxy`+`Reflect` and Python `__getattr__` correctly, avoiding `__getattribute__` recursion.
- [ ] Diagnose the self-invocation trap and proxy identity/`instanceof` breaks.
- [ ] Build a coarse-grained AOP/logging proxy and state precisely what it intercepts.
