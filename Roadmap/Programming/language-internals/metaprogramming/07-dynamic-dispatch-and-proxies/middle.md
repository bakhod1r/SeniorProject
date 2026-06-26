# Dynamic Dispatch & Proxies — Middle Level

> **Topic:** [Dynamic Dispatch & Proxies](README.md)
> **Focus:** Going from "what is a proxy" to *how the machinery works* — JDK dynamic proxies vs class proxies, JS traps and `Reflect`, Python's attribute protocol, Ruby dynamic methods, and the proxy-driven frameworks (Spring AOP, mocking, lazy loading) you actually use.

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

> Focus: **How is interception actually implemented, and which mechanism does each framework choose — and why?**

At the junior level a proxy was "a receptionist." At this level you need to know the *kinds* of receptionists, because the kind decides what you can and can't intercept:

- **Interface proxies** (Java `java.lang.reflect.Proxy`) generate a class implementing your interfaces and route every interface method to one handler. They can't intercept calls made through the concrete type, and they can't proxy a class with no interface.
- **Class proxies** (CGLIB, ByteBuddy, ASM) generate a **subclass** of the target at runtime, overriding its methods to call your interceptor. They work on concrete classes but can't override `final` methods (you can't override what can't be overridden).
- **Attribute/metaobject hooks** (Python `__getattr__`/`__getattribute__`/`__setattr__`/`__call__`, Ruby `method_missing`, JS `Proxy` traps) intercept at the language's metaobject protocol level rather than by generating a new type.

This distinction explains real behavior: why `@Transactional` on a `private` or `final` method silently does nothing, why self-invocation bypasses your aspect, why Mockito can't mock a `final` class without its inline mock maker, and why Vue 3 switched from `Object.defineProperty` to `Proxy` to support array-index and new-property reactivity.

In one sentence: **the proxy mechanism you pick determines the *seam* — the exact set of calls you can intercept — and most "why didn't my aspect fire?" bugs are seam bugs.**

---

## Prerequisites

- **Required:** Comfortable reading and writing Java interfaces and classes; JavaScript objects/functions; Python classes; basic Ruby.
- **Required:** You've read `junior.md` (proxy basics, the three actions, self-invocation).
- **Required:** Know what reflection is — `Method.invoke`, `getattr`, `obj.send`.
- **Helpful:** You've used Spring, Mockito, or Hibernate and wondered how a method got "wrapped."
- **Helpful:** A sense of what a *decorator/annotation* marks (`@Transactional`, `@Cacheable`).

You do **not** yet need: raw bytecode reading, ASM visitor APIs, JIT deoptimization, or invokedynamic internals (those are `senior.md`/`professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **JDK dynamic proxy** | `java.lang.reflect.Proxy.newProxyInstance` — generates a class implementing given **interfaces**, routing all calls to an `InvocationHandler`. |
| **InvocationHandler** | The interface with `Object invoke(Object proxy, Method method, Object[] args)` — receives every proxied call. |
| **CGLIB** | "Code Generation Library." Creates a runtime **subclass** of a concrete class, overriding non-final methods to call a `MethodInterceptor`. |
| **ByteBuddy** | A modern, fluent bytecode-generation library; the engine behind newer Mockito and Hibernate proxying. |
| **ASM** | A low-level bytecode framework (visitor over class structure). CGLIB and ByteBuddy build on it. |
| **MethodInterceptor (CGLIB)** | `intercept(obj, method, args, methodProxy)` — CGLIB's per-call hook; `methodProxy.invokeSuper` calls the real (super) method. |
| **AOP** | Aspect-Oriented Programming — modularizing cross-cutting concerns (tx, logging, security) as *aspects* applied via proxies (Spring) or weaving (AspectJ). |
| **Advice** | The code an aspect runs around a join point: `@Before`, `@After`, `@Around`. |
| **Self-invocation** | An internal `this.method()` call that bypasses the surrounding proxy, so advice doesn't run. |
| **`__getattr__`** | Python hook called **only when normal attribute lookup fails**. |
| **`__getattribute__`** | Python hook called on **every** attribute access; overriding it is powerful and recursion-prone. |
| **`__call__`** | Makes an instance callable like a function: `obj()` runs `obj.__call__()`. |
| **JS trap** | A handler on a `Proxy`'s handler object: `get`, `set`, `has`, `deleteProperty`, `apply`, `construct`, etc. |
| **`Reflect`** | A JS namespace whose methods mirror each trap and perform the *default* operation. The forwarding companion to `Proxy`. |
| **Revocable proxy** | `Proxy.revocable(target, handler)` — a proxy plus a `revoke()` that disables it (all traps throw afterward). |
| **Dynamic finder** | A method synthesized from its name (ActiveRecord `find_by_name`) via `method_missing`. |
| **LazyInitializationException** | Hibernate error from using a lazy proxy after its session/transaction closed. |

---

## Core Concepts

### 1. Interface proxy vs class proxy — the central fork

```text
JDK dynamic proxy (interface)        CGLIB / ByteBuddy (class)
──────────────────────────────       ──────────────────────────────
generates: class $Proxy0             generates: class Foo$$EnhancerBy...
implements: your interface(s)        extends:    Foo  (subclass!)
intercepts: interface methods        intercepts: overridable methods
can't proxy a class w/o interface    can't override final/private/static
route: InvocationHandler.invoke      route: MethodInterceptor.intercept
```

Spring decides automatically: if your bean implements an interface, it uses a JDK proxy by default; otherwise it uses CGLIB. (`proxyTargetClass=true` forces CGLIB even for interface beans.) Knowing which one you got explains a lot of "but it worked locally" bugs.

### 2. What you can and cannot intercept (the "seam")

A class proxy works by **overriding**. Therefore it cannot intercept:

- **`final` methods** — can't be overridden, so the interceptor never sees them.
- **`private` methods** — not part of the override surface; also invoked via `this`, so self-invocation rules apply.
- **`static` methods** — not virtual; no instance to wrap.
- **Constructors / field access** — a method proxy intercepts *methods*, not field reads.

An interface proxy is even narrower: only methods declared on the proxied interface are visible. Anything you call through the concrete type isn't proxied at all.

### 3. Self-invocation, mechanically

A proxy `P` wraps target `T`. External code holds `P`. `P.placeOrder()` runs advice, then forwards to `T.placeOrder()`. Inside `T.placeOrder()`, the call `charge()` is really `this.charge()` where `this == T` (not `P`). So it goes directly to `T.charge()` — the proxy `P` is never consulted, and the advice on `charge` (a second `@Transactional`, say) never runs.

Fixes you should know:
- Inject the bean into itself and call through the injected (proxied) reference.
- Use `AopContext.currentProxy()` (Spring) to get the proxy and call through it (requires `exposeProxy=true`).
- Split the two methods into **two beans** so the call crosses a proxy boundary.
- Use compile/load-time weaving (AspectJ) instead of proxies — weaving rewrites the call site itself, so even self-calls are advised.

### 4. The Python attribute protocol, ordered

When you write `obj.x`, Python runs roughly:

1. `type(obj).__getattribute__(obj, "x")` — the *always-called* entry point.
2. That default implementation searches data descriptors, the instance `__dict__`, then non-data descriptors / class attributes.
3. **Only if all of that raises `AttributeError`** does Python call `obj.__getattr__("x")` (if defined).

So `__getattr__` is the "fallback for missing names," and `__getattribute__` is the "intercept absolutely everything." `__setattr__` intercepts every assignment; `__call__` makes the instance itself callable. To build a proxy that forwards *everything* (even existing names) you override `__getattribute__` — and must be careful to use `object.__getattribute__(self, ...)` internally to avoid infinite recursion.

### 5. JS traps + `Reflect` as the forwarding default

A JS `Proxy` handler can define many traps; the common ones:

| Trap | Fires on | Default via |
|------|----------|-------------|
| `get` | `obj.x`, `obj.method` | `Reflect.get` |
| `set` | `obj.x = v` | `Reflect.set` |
| `has` | `"x" in obj` | `Reflect.has` |
| `deleteProperty` | `delete obj.x` | `Reflect.deleteProperty` |
| `apply` | `fn(...args)` (function target) | `Reflect.apply` |
| `construct` | `new Ctor(...args)` | `Reflect.construct` |
| `ownKeys` | `Object.keys`, spread | `Reflect.ownKeys` |

The discipline: in every trap you don't fully override, **return `Reflect.<trap>(...)`** so the default semantics are preserved. `Reflect` exists precisely so you don't reimplement object internals by hand (and so `set` correctly returns a boolean, `receiver` is threaded through, etc.).

### 6. The frameworks, decoded

- **Spring AOP** wraps beans in a proxy; `@Transactional`/`@Cacheable`/`@Async` are advice applied around the proxied methods. Self-invocation and final/private methods are the classic non-firing causes.
- **Mockito** generates a subclass (ByteBuddy) whose every method is intercepted to record the call and return a stubbed/`null`/default value. `when(mock.foo()).thenReturn(x)` programs the interceptor.
- **Hibernate lazy loading** returns a proxy (CGLIB/ByteBuddy) for an associated entity. The proxy holds only the id; the first method call triggers a SQL `SELECT`. If the session is closed by then, you get `LazyInitializationException`.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Interface proxy** | A temp who can do exactly the jobs on a posted job description (interface) and nothing else. |
| **Class proxy (subclass)** | An understudy trained to be a *specific* actor, who can cover any scene the actor can — except scenes locked by contract (final methods). |
| **`final` method** | A line in the contract marked "only the star performs this" — no understudy allowed. |
| **Self-invocation** | The actor improvising backstage; the understudy and the stage manager (proxy) never see it. |
| **`Reflect`** | The stagehand's default cue sheet: "if no special note, do the standard thing." |
| **Revocable proxy** | A keycard you can deactivate remotely; after revocation, every door it opened is now locked. |
| **Lazy proxy** | A "ship when ordered" catalog item — looks in stock, but the warehouse only fetches it the moment you actually open the box. |
| **Mockito mock** | A crash-test dummy shaped exactly like the real part, recording every force applied to it. |

---

## Mental Models

### The "Where's the Seam?" Model

Before adding an aspect, ask: *through which reference does the call travel, and does that reference pass through the proxy?* External call through the proxied bean → advised. Internal `this` call → not advised. A `final` method → no seam to override → never advised. Most AOP confusion dissolves once you locate the seam.

### The "Generated Subclass" Model (class proxies)

A CGLIB/ByteBuddy proxy is a **real subclass** with overridden methods like:

```text
class Foo$$Enhancer extends Foo {
    @Override Object bar(args) {
        return interceptor.intercept(this, barMethod, args, superCallHelper);
    }
}
```

That immediately explains the limits: `final` can't be overridden, `private` isn't in the override set, `static` isn't virtual, and the constructor runs (Spring uses Objenesis to skip it for some cases). It also explains why `getClass()` returns `Foo$$EnhancerBy...`, not `Foo`.

### The "Two Flavors of Hook" Model (revisited, precise)

- **Missing-only** (`__getattr__`, `method_missing`): fires after normal lookup fails. Safe; existing members keep working.
- **Everything** (`__getattribute__`, JS `get`): fires on every access. Maximum power, recursion danger, performance cost on the hot path.

Choose missing-only unless you must shadow real members; reach for everything only when building a true full-transparency proxy or a reactive system.

---

## Code Examples

### Java — JDK proxy, timing every interface method

```java
import java.lang.reflect.*;

interface Repo { String find(int id); void save(String s); }

class RealRepo implements Repo {
    public String find(int id) { return "row-" + id; }
    public void save(String s) { /* ... */ }
}

class TimingHandler implements InvocationHandler {
    private final Object target;
    TimingHandler(Object target) { this.target = target; }
    public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
        long t0 = System.nanoTime();
        try {
            return m.invoke(target, args);                  // forward
        } finally {
            System.out.printf("%s took %d ns%n", m.getName(), System.nanoTime() - t0);
        }
    }
}

@SuppressWarnings("unchecked")
static <T> T timed(Class<T> iface, T target) {
    return (T) Proxy.newProxyInstance(
        iface.getClassLoader(), new Class<?>[]{iface}, new TimingHandler(target));
}
```

`m.invoke(target, args)` is the reflective forward. Note `InvocationTargetException`: a checked exception thrown by the *target* arrives wrapped — unwrap `getCause()` to rethrow the real exception.

### Java — CGLIB-style class proxy (no interface needed)

```java
import net.sf.cglib.proxy.*;

class Service {           // concrete class, no interface
    public String hello(String n) { return "hi " + n; }
    public final String fixed() { return "cannot be proxied"; } // final!
}

Service proxy = (Service) Enhancer.create(Service.class, (MethodInterceptor)
    (obj, method, args, methodProxy) -> {
        System.out.println("-> " + method.getName());
        Object r = methodProxy.invokeSuper(obj, args);   // calls real super method
        System.out.println("<- " + method.getName());
        return r;
    });

proxy.hello("Ada");   // intercepted
proxy.fixed();        // NOT intercepted — final method, can't be overridden
```

`methodProxy.invokeSuper(obj, args)` is the CGLIB way to invoke the original method (the overridden `super`). Calling `method.invoke(obj, args)` here would recurse into the proxy forever.

### Python — full-transparency proxy via `__getattribute__`

```python
class TracingProxy:
    def __init__(self, target):
        object.__setattr__(self, "_target", target)

    def __getattribute__(self, name):
        # Use object.__getattribute__ for OUR OWN internals to avoid recursion.
        if name in ("_target", "__class__", "__init__"):
            return object.__getattribute__(self, name)
        target = object.__getattribute__(self, "_target")
        attr = getattr(target, name)         # forwards EVERYTHING, even existing names
        if callable(attr):
            def wrapper(*a, **k):
                print(f"-> {name}")
                return attr(*a, **k)
            return wrapper
        return attr


class Service:
    version = "1.0"
    def hello(self, n): return f"hi {n}"


p = TracingProxy(Service())
print(p.version)   # intercepted (a real class attribute) — __getattr__ would NOT see this
p.hello("Ada")     # intercepted
```

Contrast with `__getattr__`, which would *not* intercept `version` (it exists). This is the key middle-level distinction. The `object.__getattribute__` calls on our own internals are what break the recursion.

### Python — callable objects and `__call__`

```python
class RetryProxy:
    def __init__(self, fn, attempts=3):
        self.fn, self.attempts = fn, attempts
    def __call__(self, *a, **k):           # instance behaves like a function
        last = None
        for _ in range(self.attempts):
            try:
                return self.fn(*a, **k)
            except Exception as e:
                last = e
        raise last

flaky = RetryProxy(some_flaky_function)
flaky(42)   # runs RetryProxy.__call__
```

### JavaScript — validation + default forwarding with `Reflect`

```javascript
function validated(target, rules) {
  return new Proxy(target, {
    set(obj, prop, value, receiver) {
      const rule = rules[prop];
      if (rule && !rule(value)) {
        throw new TypeError(`invalid value for ${String(prop)}: ${value}`);
      }
      return Reflect.set(obj, prop, value, receiver);   // default behavior
    },
  });
}

const user = validated({}, { age: (v) => Number.isInteger(v) && v >= 0 });
user.age = 30;     // ok
user.age = -1;     // throws
```

### JavaScript — revocable proxy (capability you can switch off)

```javascript
const { proxy, revoke } = Proxy.revocable({ secret: 42 }, {});
console.log(proxy.secret);  // 42
revoke();
console.log(proxy.secret);  // TypeError: Cannot perform 'get' on a revoked proxy
```

Revocable proxies are how you hand out a temporary capability and later guarantee no further access (the basis of the membrane pattern, covered at senior level).

### Ruby — dynamic finders (the ActiveRecord trick, in miniature)

```ruby
class Collection
  def initialize(records) = @records = records

  def method_missing(name, *args)
    if name.to_s =~ /^find_by_(\w+)$/
      field = $1.to_sym
      @records.find { |r| r[field] == args.first }
    else
      super
    end
  end

  def respond_to_missing?(name, include_private = false)
    name.to_s.start_with?("find_by_") || super
  end
end

people = Collection.new([{ name: "Ada", age: 36 }, { name: "Linus", age: 54 }])
people.find_by_name("Ada")   # => {name: "Ada", age: 36}, method synthesized from the name
people.find_by_age(54)       # => {name: "Linus", age: 54}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Interface proxy (JDK)** | No extra dependency; pure JDK; clean. | Interface-only; can't proxy concrete classes; only interface methods. |
| **Class proxy (CGLIB/ByteBuddy)** | Works on concrete classes; intercepts overridable methods. | Can't touch `final`/`private`/`static`; subclass changes `getClass()`; heavier. |
| **Metaobject hooks (Python/Ruby/JS)** | Extremely flexible; no codegen; synthesize anything. | "Every access" hooks are slow and recursion-prone; can swallow typos. |
| **AOP via proxies** | One aspect → many methods; declarative. | Self-invocation/final blind spots; debugging through generated frames. |
| **Reflection-based forward** | Generic — one handler for all methods. | Reflective `invoke` is slower than a direct call; wraps exceptions. |

---

## Use Cases

- **Transactions / caching / retry / security** as aspects (Spring `@Transactional`, `@Cacheable`, `@Retryable`, `@PreAuthorize`).
- **Mocking** — generate a proxy that records interactions and returns stubs (Mockito, `unittest.mock`).
- **Lazy loading** — return a proxy that fetches the real data on first use (Hibernate associations).
- **Reactive state** — wrap data in a `Proxy` to track reads and trigger updates on writes (Vue 3, MobX-style).
- **Dynamic finders / DSLs** — synthesize methods from names (`find_by_*`, fluent query builders) via `method_missing`/`__getattr__`.
- **Remote stubs** — make a network call look like a local method call; the method name + args become the request payload.
- **Input validation / observable objects** — intercept `set` to validate or notify listeners.

---

## Coding Patterns

### Pattern 1: Forward through the right "super" call

In a class proxy, forward to the *original* method, not back through the proxy:
- CGLIB: `methodProxy.invokeSuper(obj, args)`
- ByteBuddy with `@SuperCall`: invoke the captured `Callable`
- Never `method.invoke(obj, args)` on the proxy itself — infinite recursion.

### Pattern 2: Always restore default with `Reflect` (JS)

Override only the trap you need; delegate the rest to `Reflect.<trap>`. This keeps `receiver`, return-value contracts, and prototype chains correct.

### Pattern 3: Guard internal access in `__getattribute__`

Route your own bookkeeping attributes through `object.__getattribute__`/`object.__setattr__` so the proxy's machinery doesn't intercept itself into recursion.

### Pattern 4: Pair the missing-hooks

`method_missing` ↔ `respond_to_missing?` (Ruby). In Python, if you synthesize attributes via `__getattr__`, consider implementing `__dir__` so introspection/autocomplete still works.

### Pattern 5: Break self-invocation deliberately

When advice *must* apply to internal calls, cross a proxy boundary: separate beans, self-injection, `AopContext.currentProxy()`, or switch to AspectJ weaving.

---

## Best Practices

- **Know which proxy you got.** Log `bean.getClass()` once; `$Proxy` = JDK, `$$Enhancer`/`$$ByteBuddy` = class proxy.
- **Don't mark methods you want advised as `final`/`private`.** They silently escape class proxies.
- **Keep advice idempotent and cheap.** It runs on every call and is shared across many methods.
- **Unwrap `InvocationTargetException`.** Rethrow `getCause()` so callers see the real exception, not the reflection wrapper.
- **Prefer missing-only hooks** unless full transparency is required.
- **Use `Reflect` in JS traps** for any operation you don't fully replace.
- **Watch lazy-proxy lifetimes.** Access lazy associations inside the transaction/session, or fetch eagerly/with a DTO, to avoid `LazyInitializationException`.
- **Document the magic.** A reader should be able to find that a bean/object is proxied and what the advice does.

---

## Edge Cases & Pitfalls

- **`@Transactional` on a `private`/`final` method, or self-invoked** — advice doesn't run; no error, just no transaction.
- **JDK proxy and `getClass()`/`instanceof`** — the proxy is `$Proxy0 implements Repo`, not `RealRepo`. Code that downcasts to the concrete type breaks.
- **CGLIB final-method blindness** — overridable methods are advised; `final` ones silently aren't.
- **`__getattr__` won't see existing attributes** — if you expected to intercept a real field, you need `__getattribute__` (and its recursion discipline).
- **`__getattribute__` infinite recursion** — any `self.foo` inside it re-enters; always use `object.__getattribute__`.
- **JS `set` trap must return `true`** — a falsy return throws in strict mode (`'set' on proxy: trap returned falsish`). `Reflect.set` returns the right boolean.
- **`this`/`receiver` identity** — inside a method reached through a proxy, `this` may be the target, not the proxy (key to the self-invocation trap).
- **Mockito can't mock `final` by default** — needs the inline mock maker (ByteBuddy agent) to mock final classes/methods/statics.
- **Hibernate `LazyInitializationException`** — touching a lazy proxy after the session closes throws; a notorious detached-entity bug.
- **Swallowed typos** — an over-eager `method_missing`/`__getattr__` answers misspelled names; guard with `respond_to?`/allowlists.

---

## Test Yourself

1. Your Spring bean implements an interface. Which proxy type does Spring use by default? What changes if you set `proxyTargetClass=true`?
2. Why can't a CGLIB proxy intercept a `final` method? Tie it to the "generated subclass" mental model.
3. Give the exact `this`-identity reason why self-invocation bypasses advice. Then list three fixes.
4. In Python, write a one-line difference between when `__getattr__` fires and when `__getattribute__` fires for `obj.existing_field`.
5. Why must a JS `set` trap return a boolean? What does `Reflect.set` give you for free?
6. In the CGLIB example, why is `methodProxy.invokeSuper(obj, args)` correct but `method.invoke(obj, args)` a bug?
7. Explain `LazyInitializationException` in terms of the lazy proxy and the session lifetime. How would you avoid it?
8. Implement a Ruby `method_missing` that turns `name=` setters into a hash write, and `name` getters into a hash read. What does `respond_to_missing?` need to allow?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│                 PROXY MECHANISMS — MIDDLE LEVEL                        │
├──────────────────────────────────────────────────────────────────────┤
│ INTERFACE proxy  java.lang.reflect.Proxy → InvocationHandler.invoke   │
│   * interfaces only   * intercepts interface methods                  │
│ CLASS proxy      CGLIB / ByteBuddy → subclass + MethodInterceptor     │
│   * concrete classes  * NOT final/private/static                      │
│   * forward via methodProxy.invokeSuper (NOT method.invoke)           │
├──────────────────────────────────────────────────────────────────────┤
│ Python   __getattr__       missing only (safe)                        │
│          __getattribute__  every access (recursion danger)            │
│          __setattr__ / __call__ / __getitem__                         │
│ JS       Proxy traps get/set/has/deleteProperty/apply/construct       │
│          + Reflect.<trap> = default behavior; set MUST return bool    │
│          Proxy.revocable → revoke()                                   │
│ Ruby     method_missing  (+ respond_to_missing?)  → dynamic finders   │
├──────────────────────────────────────────────────────────────────────┤
│ Frameworks decoded:                                                   │
│   Spring AOP   bean wrapped in proxy; @Transactional = around-advice  │
│   Mockito      ByteBuddy subclass; records calls, returns stubs       │
│   Hibernate    lazy entity = proxy; 1st call = SELECT; closed session │
│                 → LazyInitializationException                          │
├──────────────────────────────────────────────────────────────────────┤
│ Non-firing causes: self-invocation · final/private · wrong proxy type │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The central fork is **interface proxy** (JDK `Proxy`, interfaces only, `InvocationHandler.invoke`) vs **class proxy** (CGLIB/ByteBuddy, subclass a concrete class, `MethodInterceptor.intercept`).
- A class proxy works by **overriding**, so it cannot touch `final`, `private`, or `static` methods — that's the seam, and most "aspect didn't fire" bugs are seam bugs.
- **Self-invocation** bypasses the proxy because the internal call's `this` is the target, not the proxy. Fix with self-injection, `AopContext`, separate beans, or AspectJ weaving.
- Python: `__getattr__` fires only on **missing** attributes; `__getattribute__` fires on **all** access (powerful, recursion-prone — use `object.__getattribute__` internally). `__call__` makes instances callable.
- JS: `Proxy` traps intercept operations; **`Reflect`** mirrors each trap to give default behavior, and the `set` trap must return a boolean. `Proxy.revocable` yields a switch-off-able proxy.
- Ruby: `method_missing` (+ `respond_to_missing?`) powers dynamic finders like `find_by_name`.
- The frameworks you use — Spring AOP, Mockito, Hibernate lazy loading — are all proxies; knowing the mechanism predicts their failure modes (`LazyInitializationException`, un-advised final/self calls, mock-of-final limits).

---

## What You Can Build

- **A JDK-proxy-based "around" timer** that times every interface method and prints a histogram, plus a CGLIB version for a class with no interface — and observe `final` methods escaping.
- **A self-invocation demonstrator** in Spring (or plain CGLIB): show that an internal call skips the advice, then fix it three different ways.
- **A full-transparency Python proxy** via `__getattribute__` that forwards everything and counts calls per method name — without infinite recursion.
- **A validating JS object** that enforces a schema in the `set` trap and forwards reads/writes via `Reflect`.
- **A `find_by_*` dynamic-finder collection** in Ruby with proper `respond_to_missing?`.
- **A lazy proxy** that defers an "expensive" object's construction until the first method call, and prints when the real construction happens.

---

## Further Reading

- *Spring Framework Reference — AOP* — proxy mechanisms, JDK vs CGLIB, self-invocation. https://docs.spring.io/spring-framework/reference/core/aop.html
- *ByteBuddy User Guide* — https://bytebuddy.net
- *CGLIB wiki* — `Enhancer`, `MethodInterceptor`, `MethodProxy`.
- *Mockito — How it works / inline mock maker* — https://javadoc.io/doc/org.mockito/mockito-core/latest/
- *Vue 3 Reactivity in Depth* — why `Proxy` replaced `Object.defineProperty`. https://vuejs.org/guide/extras/reactivity-in-depth.html
- *Python Data Model — attribute access* — https://docs.python.org/3/reference/datamodel.html#customizing-attribute-access
- *MDN — Proxy and Reflect.*

---

## Related Topics

- This folder, other levels: [`junior.md`](junior.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling metaprogramming topics in this section — reflection, runtime code generation, decorators/annotations, and AST manipulation — provide the building blocks (reflective invoke, bytecode generation) that proxies rely on.
- The runtime-systems topic on virtual dispatch (vtables, inline caches) covers the *mechanical* side of method dispatch; this page stays on the *interception/synthesis* side.
