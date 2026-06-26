# Dynamic Dispatch & Proxies — Junior Level

> **Topic:** [Dynamic Dispatch & Proxies](README.md)
> **Focus:** What does it mean to *intercept* a method call instead of writing the method? The proxy — a stand-in object that catches every call and decides what to do.

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

> Focus: **What is the difference between writing a method and intercepting a call to it?**

Almost all the code you've written so far is *static*: you write a method named `save()`, and when someone calls `user.save()`, the method named `save` runs. The method exists, ahead of time, in the source. The compiler or interpreter can point at the line.

This topic is about the *other* way. Instead of writing each method, you write **one piece of code that runs for every call**, looks at *which* method was asked for, and **synthesizes** the behavior on the fly. The object that does this is called a **proxy** — a stand-in that sits in front of a "real" object (or in front of *nothing at all*) and intercepts every method or attribute access. The proxy can then **forward** the call to the real object, **augment** it (log it, time it, cache it), or **block** it entirely.

This is a **metaprogramming** idea: you are writing code that *handles* calls rather than code that *is* the call. The classic name is the **Proxy pattern**, but here we care about the dynamic, language-level mechanisms that make a single object able to answer for methods that were never written.

In one sentence: **a proxy is a receptionist for an object — every call goes through it first, and the receptionist decides whether to forward it, change it, or refuse it.**

> 🎓 **Why this matters for a junior:** You already use proxies every day without knowing it. When Spring wraps your service so `@Transactional` opens a database transaction, that's a proxy. When Mockito hands you a `mock(UserService.class)` that records calls, that's a proxy. When Vue's reactivity re-renders the page after you set `state.count = 5`, that's a proxy intercepting the write. Learning the mechanism turns "magic" into "oh, *that's* how it works."

This page covers: what interception means, the difference between a real method and an intercepted call, the basic proxy across JavaScript, Python, Java, and Ruby, and the first big trap (calling a method on yourself can *bypass* the proxy). Deeper levels go into bytecode generation, AOP internals, and performance.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to define and call a method/function in at least one of JavaScript, Python, Java, or Ruby.
- **Required:** What an *object* and an *attribute/field* are.
- **Required:** What an *interface* is (a list of method signatures with no bodies), at least in Java terms.
- **Helpful but not required:** A vague idea of what "reflection" means (inspecting types/methods at runtime).
- **Helpful but not required:** Having seen a `@decorator` (Python) or `@Annotation` (Java) before.

You do **not** need to know:

- Bytecode, ASM, or how a class file is structured (that's `senior.md`/`professional.md`).
- The vtable / inline-cache machinery the runtime uses for ordinary virtual calls — that's a *different* topic. Here we mean **interception**, not the CPU-level dispatch.
- AOP weaving internals or Spring's proxy chain (that's `middle.md` onward).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dispatch** | Choosing which code runs in response to a call. "Static" dispatch is decided ahead of time; here we mean *programmatic, intercepted* dispatch. |
| **Proxy** | A stand-in object that receives calls meant for another object (or for nothing) and decides what to do with them. |
| **Target / subject** | The "real" object a proxy stands in front of and usually forwards to. May not exist (a *virtual* proxy creates it on demand). |
| **Interception** | Catching a method/attribute access *before* it reaches a real method, so your code runs instead of (or around) it. |
| **Synthesize behavior** | Produce a method's effect at runtime even though no method with that name was written. |
| **Forwarding / delegation** | The proxy passing the call along to the target, possibly after doing extra work. |
| **Trap (JS)** | A handler function on a JavaScript `Proxy` (like `get`, `set`, `apply`) that runs when that kind of operation happens. |
| **`__getattr__` (Python)** | A method Python calls **only when an attribute is missing** — your hook for synthesizing attributes. |
| **`method_missing` (Ruby)** | A method Ruby calls when an object receives a message (method call) it has no method for. |
| **InvocationHandler (Java)** | The interface whose single `invoke(...)` method receives every call made to a JDK dynamic proxy. |
| **Cross-cutting concern** | A behavior (logging, timing, transactions, security) that applies to *many* methods. Proxies are how you add it in one place. |
| **AOP** | Aspect-Oriented Programming — a style built on intercepting calls to inject cross-cutting concerns. Often implemented with proxies. |
| **Self-invocation** | An object calling its own method via `this`/`self` — which often *skips* the proxy wrapped around it. A famous trap. |

---

## Core Concepts

### 1. A method that runs vs. a call that's intercepted

Picture an ordinary class:

```text
class Calculator:
    def add(self, a, b): return a + b
```

When you call `calc.add(2, 3)`, the *named* method `add` runs. There is a body. You can read it.

Now picture an object with **no `add` method at all**, but with one special hook:

```text
class Magic:
    def __getattr__(self, name):
        return lambda *args: f"you asked for {name} with {args}"
```

When you call `magic.add(2, 3)`, Python can't find a method `add`, so it calls the hook `__getattr__("add")`, which *manufactures* a function on the spot. The behavior of `add` was **synthesized at runtime** — nobody wrote it. That is the heart of this topic.

### 2. The proxy: one object standing in for another

A **proxy** wraps a **target** and intercepts everything:

```text
   caller  ──►  PROXY  ──►  TARGET (real object)
                  │
                  ├─ before: log, check permission, start timer
                  ├─ forward the call
                  └─ after: stop timer, cache result, log result
```

From the caller's side, the proxy looks *exactly* like the target — same methods, same interface. The caller doesn't know it's talking to a stand-in. That transparency is the whole point: you can slip a proxy in front of any object and add behavior without changing the caller or the target.

### 3. The three things a proxy can do with a call

Every intercepted call gives the proxy three choices:

| Choice | What it means | Example |
|--------|---------------|---------|
| **Forward** | Pass the call to the target unchanged | A transparent wrapper |
| **Augment** | Do extra work before/after forwarding | Logging, timing, caching, transactions, retries |
| **Block / replace** | Don't forward at all; return something else or throw | A security proxy that denies access; a mock that returns a canned value |

### 4. Why this is "metaprogramming"

You are writing code that operates on *calls and method names as data*, not code that hard-codes each method. One small `invoke`/`__getattr__`/`method_missing`/`get`-trap handles **any** method — including methods that don't exist yet. The behavior is generated, not declared. That's the metaprogramming angle: programs writing (the effect of) program parts at runtime.

### 5. The interface vs. class distinction (Java preview)

In Java this split matters a lot. The built-in `java.lang.reflect.Proxy` can only proxy **interfaces** — it generates a class implementing your interfaces and routes every call to one `InvocationHandler`. To proxy a **concrete class** (no interface) you need a library (CGLIB, ByteBuddy) that *subclasses* the class at runtime. Keep this in your head: **JDK proxy = interfaces only; library proxy = subclass a class.**

### 6. The big first trap: self-invocation

A proxy wraps `realObject`. The proxy intercepts external calls. But what happens when a method *inside* `realObject` calls **another of its own methods** via `this`? The call goes straight to the real method — it never goes back out through the proxy. So the augmentation (logging, the transaction) **does not happen** for the internal call. This is the single most surprising proxy bug for juniors, and it bites real Spring applications constantly. We'll see it concretely below.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Proxy** | A receptionist who takes every call to the CEO and decides whether to forward, take a message, or say "no." |
| **Forward** | The receptionist simply transfers the call to the CEO's line. |
| **Augment** | The receptionist logs the caller's name and the time, *then* transfers the call. |
| **Block** | The receptionist says "the CEO isn't taking calls from vendors." |
| **Virtual proxy** | An understudy who only "becomes" the lead actor the moment the curtain rises (lazy creation). |
| **Remote proxy** | A local order desk that looks like the warehouse but actually phones a warehouse across the country. |
| **`method_missing`** | A clerk who, when asked for a form they don't stock, *writes one for you on the spot* based on the name you said. |
| **Self-invocation trap** | The CEO walking into the back office and talking to themselves — the receptionist never hears it, so it isn't logged. |
| **Synthesize behavior** | A vending machine that doesn't have a "hot chocolate" button but, when you type "hot chocolate," mixes one anyway. |
| **`Reflect` (JS)** | The receptionist's default script: "if I have no special instruction, just do exactly what was asked." |

---

## Mental Models

### The Receptionist Model

Hold this picture: every object *could* have a receptionist (proxy) in front of it. The caller always talks to the receptionist. The receptionist has a single rule book (`invoke` / the trap / `__getattr__` / `method_missing`) that runs for *every* request, looks at the request's name and arguments, and decides: forward, augment, or refuse. When you "add logging to a service without touching the service," you're hiring a receptionist.

### The "Method Name as a String" Model

In normal code the method name is baked into the call site. In an intercepted call, the method name arrives as **data** — a string `"save"`, a `Method` object, a Ruby symbol `:save`. Your one handler receives the name and dispatches on it however it likes (look it up, forward it, build a SQL query from it). When you find yourself thinking "I wish I could write one function that handles `findByName`, `findByEmail`, `findByAnything`," you want this.

### The "Missing vs. Every" Model (Python especially)

There are two flavors of interception, and confusing them causes infinite loops:

- **Intercept only what's missing** — Python `__getattr__`, Ruby `method_missing`. Cheap and safe: real methods still run normally; your hook only fires for *unknown* names.
- **Intercept everything** — Python `__getattribute__`, the JS `get` trap. Powerful but dangerous: it fires even for attributes that exist, so a naive implementation that does `self.x` re-triggers itself forever.

Default to the "only what's missing" flavor unless you truly need the "every access" one.

---

## Code Examples

We'll build the same idea — **a logging proxy that wraps a real object and prints every method call** — in four languages.

### JavaScript — the `Proxy` object

```javascript
const realService = {
  greet(name) { return `Hello, ${name}`; },
  add(a, b) { return a + b; },
};

const loggingProxy = new Proxy(realService, {
  get(target, prop, receiver) {
    const orig = Reflect.get(target, prop, receiver);
    if (typeof orig !== "function") return orig;
    return function (...args) {
      console.log(`-> calling ${String(prop)}(${args.join(", ")})`);
      const result = orig.apply(target, args);
      console.log(`<- ${String(prop)} returned ${result}`);
      return result;
    };
  },
});

loggingProxy.greet("Ada");   // logs the call, forwards, logs the return
loggingProxy.add(2, 3);      // same
```

The `get` **trap** runs every time you read a property (including a method) off the proxy. `Reflect.get` is the "default behavior" helper: it does exactly what would have happened without a proxy. We wrap functions to log around them and leave plain values alone.

### Python — `__getattr__` (intercept only missing attributes)

```python
class LoggingProxy:
    def __init__(self, target):
        # Store target WITHOUT triggering __getattr__ later.
        object.__setattr__(self, "_target", target)

    def __getattr__(self, name):
        # Only called because LoggingProxy itself has no attribute `name`.
        attr = getattr(self._target, name)
        if not callable(attr):
            return attr
        def wrapper(*args, **kwargs):
            print(f"-> {name}{args}")
            result = attr(*args, **kwargs)
            print(f"<- {name} returned {result!r}")
            return result
        return wrapper


class RealService:
    def greet(self, who): return f"Hello, {who}"
    def add(self, a, b): return a + b


p = LoggingProxy(RealService())
p.greet("Ada")   # __getattr__("greet") fires; greet isn't on LoggingProxy
p.add(2, 3)
```

Key point: `__getattr__` is called **only when normal attribute lookup fails**. Because `LoggingProxy` has no `greet`, Python falls back to `__getattr__("greet")`, which forwards to the real target. If we had defined `greet` on `LoggingProxy`, the hook would *not* fire for `greet`.

### Java — `java.lang.reflect.Proxy` (interfaces only)

```java
import java.lang.reflect.*;

interface Service {
    String greet(String who);
    int add(int a, int b);
}

class RealService implements Service {
    public String greet(String who) { return "Hello, " + who; }
    public int add(int a, int b) { return a + b; }
}

public class Demo {
    public static void main(String[] args) {
        Service real = new RealService();

        Service proxy = (Service) Proxy.newProxyInstance(
            Service.class.getClassLoader(),
            new Class<?>[]{ Service.class },
            (InvocationHandler) (prox, method, methodArgs) -> {
                System.out.println("-> " + method.getName());
                Object result = method.invoke(real, methodArgs); // forward
                System.out.println("<- returned " + result);
                return result;
            });

        proxy.greet("Ada");
        proxy.add(2, 3);
    }
}
```

`Proxy.newProxyInstance` generates a brand-new class at runtime that implements `Service` and routes **every** method to the single `invoke` lambda. Note it requires the *interface* `Service` — you cannot proxy `RealService` directly this way.

### Ruby — `method_missing`

```ruby
class LoggingProxy
  def initialize(target)
    @target = target
  end

  def method_missing(name, *args, &block)
    if @target.respond_to?(name)
      puts "-> #{name}#{args}"
      result = @target.send(name, *args, &block)
      puts "<- #{name} returned #{result.inspect}"
      result
    else
      super  # let Ruby raise NoMethodError normally
    end
  end

  def respond_to_missing?(name, include_private = false)
    @target.respond_to?(name, include_private) || super
  end
end

class RealService
  def greet(who) = "Hello, #{who}"
  def add(a, b) = a + b
end

p = LoggingProxy.new(RealService.new)
p.greet("Ada")
p.add(2, 3)
```

`method_missing` fires for any message `LoggingProxy` can't answer itself. We forward to the target and log around it. The paired `respond_to_missing?` keeps `p.respond_to?(:greet)` honest — always define it alongside `method_missing`.

### The self-invocation trap (Java, conceptual)

```java
class OrderService {
    public void placeOrder()  { /* ... */ charge(); }   // internal call via `this`
    public void charge()      { /* meant to be "logged"/"transactional" */ }
}
```

If a proxy wraps `OrderService` to log/transact every method, calling `proxy.placeOrder()` *is* logged — but the internal `charge()` is a plain `this.charge()` that **never goes back through the proxy**, so it is **not** logged or transacted. Remember this; it's the #1 proxy gotcha and the senior levels return to it.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Reuse** | Add one behavior (logging, timing, auth) to many methods in *one* place. | Hidden behavior — the augmentation isn't visible at the call site. |
| **Decoupling** | Caller and target don't know the proxy exists; you can slip it in or out. | Surprises during debugging: stack traces and step-through jump through generated code. |
| **Flexibility** | Handle methods that don't exist yet (dynamic finders, RPC stubs). | Typos can be silently swallowed (`method_missing` "answers" a misspelled call). |
| **Lazy/remote** | Defer expensive creation or hide a network hop behind a normal-looking object. | Breaks identity: a proxy is *not* the same object (`==`, `instanceof`, `is` can lie). |
| **Testing** | Mock frameworks generate proxies so you can fake any dependency. | Overhead: every call pays an interception cost (reflection, indirection). |

---

## Use Cases

Proxies and dynamic interception are the right tool when:

- **You need a cross-cutting concern on many methods** — logging, timing, caching, retries, security checks, transactions. Write it once in the interceptor.
- **You want lazy initialization** — a *virtual proxy* that builds the expensive object only on first real use (Hibernate's lazy-loaded entities work this way).
- **You're hiding a network call** — a *remote proxy* / RPC stub looks like a local object but actually sends a request. The method name and arguments become the request.
- **You're mocking in tests** — Mockito (`mock(Foo.class)`), Python's `unittest.mock.Mock`, and friends generate proxies that record and fake calls.
- **You want reactive objects** — frameworks like Vue 3 wrap your data in a `Proxy` so that reading a field tracks a dependency and writing one triggers re-render.
- **You want dynamic, name-driven methods** — ActiveRecord's `find_by_name`/`find_by_email` are synthesized by `method_missing`; an ORM column accessor by Python `__getattr__`.

It's the **wrong** tool when:

- The behavior is specific to one method — just write the method.
- You're in a hot loop where the interception overhead dominates.
- The team can't tell where behavior comes from — too much "magic" hurts maintainability.

---

## Coding Patterns

### Pattern 1: Wrap-and-forward (the canonical proxy)

```python
def __getattr__(self, name):
    attr = getattr(self._target, name)     # find it on the real object
    if not callable(attr):
        return attr
    def wrapper(*a, **k):
        # ...before...
        r = attr(*a, **k)                  # forward
        # ...after...
        return r
    return wrapper
```

Find it on the target, optionally wrap, forward. This shape repeats in every language.

### Pattern 2: Use the "default behavior" helper (JS `Reflect`)

In a JS trap, don't reimplement the operation by hand — call the matching `Reflect` method:

```javascript
get(target, prop, receiver) { return Reflect.get(target, prop, receiver); }
set(target, prop, val, receiver) { return Reflect.set(target, prop, val, receiver); }
```

`Reflect` mirrors every trap with the *exact default behavior*, so your proxy stays correct when you only want to augment one operation.

### Pattern 3: Always pair `method_missing` with `respond_to_missing?` (Ruby)

If `method_missing` answers a name, `respond_to?` must agree, or duck-typing checks elsewhere break:

```ruby
def respond_to_missing?(name, include_private = false)
  @target.respond_to?(name, include_private) || super
end
```

### Pattern 4: Guard `__getattr__`/`method_missing` against unknowns

Don't answer *everything* — forward to `super`/raise for names the target genuinely lacks, so a typo still fails loudly instead of returning a silent `nil`.

---

## Best Practices

- **Prefer the "only what's missing" hook** (`__getattr__`, `method_missing`) over the "every access" hook (`__getattribute__`) unless you genuinely need to intercept existing attributes too.
- **Keep the interceptor small and fast.** It runs for *every* call. No heavy work, no surprising side effects beyond the documented one.
- **Make the proxy transparent.** It should behave like the target for normal use; document the one thing it adds.
- **Fail loudly on truly unknown methods.** A proxy that silently swallows typos is a debugging nightmare.
- **Document that it's a proxy.** A reader who sees `userService` should be able to discover that it's wrapped with transactions/logging.
- **Don't rely on identity through a proxy.** `proxy == target` is usually false; `instanceof`/`isinstance` may not hold for the concrete class.
- **Be aware of self-invocation.** If internal calls must also be intercepted, you need a different design (we cover the fixes in higher levels).

---

## Edge Cases & Pitfalls

- **Self-invocation bypass.** `this.otherMethod()` inside a proxied object skips the proxy. The augmentation silently doesn't happen for internal calls.
- **`__getattr__` vs `__getattribute__`.** `__getattr__` fires only on *missing* attributes; `__getattribute__` fires on *all* of them and is easy to send into infinite recursion (if its body touches `self.x`, that's another access that re-calls it).
- **Infinite recursion in `__getattr__` too.** If `__getattr__` references `self._target` but `_target` was never set (e.g., set via normal assignment that *also* routed oddly), the lookup for `_target` itself triggers `__getattr__` again. Set it with `object.__setattr__` in `__init__`.
- **Silent typo swallowing.** `method_missing` (or a too-eager `__getattr__`) can "answer" `usr.naem` and return `nil`, hiding a misspelling. Always guard with `respond_to?`/an explicit allowlist.
- **Broken identity and equality.** A proxy is a different object than its target. `is`/`==`/`instanceof`/`isinstance` may give surprising answers. Don't use a proxy as a map key expecting target identity.
- **JDK proxy needs an interface.** `java.lang.reflect.Proxy` can't wrap a concrete class with no interface — you'll need CGLIB/ByteBuddy (covered later).
- **Confusing stack traces.** Errors inside a proxied call show generated frames (`$Proxy12`, `invoke`, lambda frames). They look alien the first time.
- **Forgetting `respond_to_missing?`.** Then `obj.respond_to?(:foo)` says `false` even though `obj.foo` works — duck typing elsewhere breaks.

---

## Test Yourself

1. In your own words, what are the *three* things a proxy can do with an intercepted call? Give a real example of each.
2. In the Python example, why does `__getattr__("greet")` fire? What would happen if `LoggingProxy` also defined its own `greet` method?
3. Why can `java.lang.reflect.Proxy` only proxy interfaces? What do you need to proxy a concrete class?
4. Write (on paper) the interleaving of console output for `loggingProxy.add(2, 3)` in the JS example. Which lines come from the trap and which from the real method?
5. Explain the self-invocation trap to a teammate using the receptionist analogy.
6. In Ruby, what breaks if you implement `method_missing` but forget `respond_to_missing?`? Show a concrete call that lies.
7. Why is `__getattribute__` more dangerous than `__getattr__`? Sketch the infinite-recursion path.
8. Name three things you use daily that are secretly proxies.

---

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────────┐
│                    DYNAMIC DISPATCH & PROXIES                       │
├────────────────────────────────────────────────────────────────────┤
│ Proxy = stand-in object; intercepts every call to a target.        │
│ It can:  FORWARD  ·  AUGMENT (log/time/cache/tx)  ·  BLOCK/REPLACE  │
├────────────────────────────────────────────────────────────────────┤
│ Language hooks:                                                     │
│   JS      new Proxy(target, { get, set, has, apply, ... })         │
│           + Reflect.* = the default behavior                        │
│   Python  __getattr__   (ONLY on missing attrs — safe)             │
│           __getattribute__ (ALL access — recursion danger)         │
│           __call__ / __setattr__ / __getitem__                      │
│   Java     java.lang.reflect.Proxy + InvocationHandler.invoke      │
│            (INTERFACES ONLY; classes need CGLIB/ByteBuddy)          │
│   Ruby     method_missing  (+ ALWAYS respond_to_missing?)          │
│   Go       no method_missing — uses embedding + interfaces         │
├────────────────────────────────────────────────────────────────────┤
│ The big traps:                                                     │
│   * self-invocation: this.other() skips the proxy                  │
│   * __getattribute__ infinite recursion                            │
│   * proxy breaks ==, is, instanceof, identity                      │
│   * typos silently swallowed by method_missing                     │
├────────────────────────────────────────────────────────────────────┤
│ Daily proxies you already use:                                     │
│   Spring @Transactional · Mockito mocks · Hibernate lazy loading   │
│   Vue 3 reactivity · RPC stubs · ActiveRecord find_by_xxx          │
└────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Dynamic dispatch & proxies (the metaprogramming angle)** is about **intercepting** method/attribute access and **synthesizing** behavior at runtime, instead of writing each method statically.
- A **proxy** is a stand-in object that catches every call to a target and can **forward**, **augment**, or **block** it — transparently, so the caller can't tell.
- Each language has a hook: JS `Proxy` traps (with `Reflect` as the default-behavior companion), Python `__getattr__` (missing only) vs `__getattribute__` (all access), Java `java.lang.reflect.Proxy` + `InvocationHandler` (interfaces only), Ruby `method_missing` (+ `respond_to_missing?`).
- **Go deliberately has no `method_missing`** — it favors embedding/composition and interfaces instead.
- The biggest junior trap is **self-invocation**: an object calling its own method via `this`/`self` bypasses the proxy, so the added behavior silently doesn't happen.
- Other pitfalls: `__getattribute__` recursion, broken identity/equality, swallowed typos, and confusing stack traces.
- You already rely on proxies daily: Spring `@Transactional`, Mockito mocks, Hibernate lazy loading, Vue reactivity, RPC stubs, ActiveRecord dynamic finders. This topic turns that magic into mechanism.

---

## What You Can Build

- **A logging proxy** that wraps any object and prints every method call and return value, in your language of choice. Stress it with an object that has 10 methods.
- **A timing proxy** that measures and reports how long each method took. Compare with and without the proxy to feel the overhead.
- **A caching proxy** for an expensive pure function: forward on a miss, return the stored result on a hit.
- **A read-only / protection proxy** that allows getters but throws on any method whose name starts with `set`.
- **A tiny "ORM-ish" object** in Python where `user.name` and `user.email` are synthesized by `__getattr__` from a dict, and any other attribute raises.
- **A `find_by_*` clone** in Ruby: a `method_missing` that turns `find_by_email("a@b.c")` into a filtered search over an in-memory array.

---

## Further Reading

- *Design Patterns* — Gamma, Helm, Johnson, Vlissides. The original "Proxy" pattern chapter.
- *MDN — `Proxy` and `Reflect`* — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
- *Python Data Model* — `__getattr__`, `__getattribute__`, `__call__`. https://docs.python.org/3/reference/datamodel.html
- *Metaprogramming Ruby* — Paolo Perrotta. The clearest treatment of `method_missing` and friends.
- *Java `java.lang.reflect.Proxy` Javadoc* — https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/reflect/Proxy.html
- *Spring Framework Reference — "Understanding AOP Proxies"* — the canonical self-invocation explanation.

---

## Related Topics

- This folder, next levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling metaprogramming topics live alongside this one in the same section: reflection, decorators/annotations, code generation, and macros all build on or complement runtime interception.
- The runtime-systems treatment of *virtual method dispatch* (vtables, inline caches) is a different topic; this page is about programmatic interception, not the CPU-level mechanism.
