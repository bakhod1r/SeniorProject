# Multiparadigm in Practice — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Multiparadigm in Practice
> *Junior saw that languages support many paradigms; middle learns **how each language actually blends them** — and the canonical blends every real codebase uses: functional core / imperative shell, declarative-inside-imperative, and paradigm-per-layer.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How Python Blends Paradigms](#how-python-blends-paradigms)
4. [How JavaScript / TypeScript Blends Paradigms](#how-javascript--typescript-blends-paradigms)
5. [How C++ Blends Paradigms](#how-c-blends-paradigms)
6. [The Canonical Blend — Functional Core, Imperative Shell](#the-canonical-blend--functional-core-imperative-shell)
7. [Declarative Inside Imperative — SQL, Regex, Builders](#declarative-inside-imperative--sql-regex-builders)
8. [Data-Oriented Hot Loops Inside an OO App](#data-oriented-hot-loops-inside-an-oo-app)
9. [Paradigm Per Layer](#paradigm-per-layer)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do specific real languages blend paradigms, and what are the standard blends?**

At the junior level you learned that your language is already multiparadigm and that you've been mixing styles by accident. The middle-level job is to make that concrete and deliberate: to look at the languages you actually ship — Python, TypeScript, C++ — and see *which* paradigms each one fuses, *which idiom* each uses to do it, and then to recognize the handful of **standard blends** that show up in nearly every codebase regardless of language.

Those standard blends are the real content here. "Be multiparadigm" is useless advice on its own; what's useful is knowing the *named patterns* that good engineers reach for: a **functional core wrapped in an imperative shell**, a **declarative language embedded inside imperative code** (the SQL in your repository, the regex in your validator), a **data-oriented hot loop hiding inside an object-oriented application**, and the master organizing principle — **a different paradigm per layer** of the system. These aren't exotic; you've seen all of them. Naming them turns "I mix paradigms" into a repeatable design move.

> **The middle mindset shift:** stop asking "what paradigm is my language?" and start asking "what's the right *blend* for this layer, and what idiom does my language give me to express it?"

---

## Prerequisites

- **Required:** [`junior.md`](junior.md) — your language is multiparadigm; the same task in imperative / OO / functional; picking a style per small piece.
- **Required:** Working familiarity with at least one of Python, JavaScript/TypeScript, Java, or C++, and comfort reading the other two from context.
- **Helpful:** You've used `map`/`filter`/comprehensions ([FP → Map/Filter/Reduce](../../code-craft/functional-programming/04-map-filter-reduce/junior.md)), written a class, and embedded a SQL query or regex in application code.
- **Helpful:** A glance at [05 — Reactive](../05-reactive-programming/), [10 — Data-Oriented](../10-data-oriented-programming/), and [11 — Event-Driven](../11-event-driven-programming/), since this page references the blends they appear in.
- **Not required:** The senior-level *judgement* of when each blend is right or wrong — that's [`senior.md`](senior.md). Here we learn the blends; there we learn to choose between them.

---

## How Python Blends Paradigms

Python is the cleanest example of a language that fuses **object-oriented + functional + imperative** without ceremony, because the three share one flat syntax. The signature Python idiom is the **comprehension**: a functional transform (map + filter) wearing imperative-looking clothes, operating over OO objects.

```python
# OO objects, functional transform, imperative readability — one expression.
active_emails = [u.email.lower() for u in users if u.is_active]
#                 ^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^   ^^^^^^^^^^^^
#                 OO attr access    functional map   functional filter
```

Where Python deliberately blends:

- **Functional tools over OO data.** `map`, `filter`, `sorted(key=...)`, `functools.reduce`, generator expressions — all first-class-function machinery (see [FP → First-Class Functions](../../code-craft/functional-programming/01-first-class-and-higher-order-functions/junior.md)) — operate happily on objects with methods. Python doesn't force you to choose FP *or* OO; the idiomatic style is FP transforms *over* OO values.
- **Dataclasses: OO containers, functional usage.** A `@dataclass(frozen=True)` is an OO construct (a class) used in a functional way (immutable value, no behavior). It's the Python idiom for "I want a typed record, not a stateful object."
- **Decorators: higher-order functions wrapping OO methods.** `@property`, `@cached_property`, `@staticmethod` are functional (functions that take and return functions) applied to OO members. The decorator *is* the seam between paradigms.
- **`with` and context managers: imperative resource control, OO implementation.** The imperative "do these steps, then clean up" is expressed through an OO protocol (`__enter__`/`__exit__`).

```python
from dataclasses import dataclass
from functools import reduce

@dataclass(frozen=True)        # OO declaration, used as an immutable VALUE (FP)
class LineItem:
    price: float
    qty: int

def cart_total(items: list[LineItem]) -> float:
    return reduce(lambda acc, it: acc + it.price * it.qty, items, 0.0)  # FP fold over OO values
```

Python's lesson: **the paradigms aren't in separate corners of the language — they're interleaved in every idiomatic line.** A comprehension is the proof.

---

## How JavaScript / TypeScript Blends Paradigms

JavaScript adds two paradigms beyond Python's three: it's **imperative + OO + functional + event-driven + (increasingly) reactive.** That breadth is a direct consequence of the browser: a UI is event-driven by nature, so the language grew an event loop and callbacks as first-class citizens.

```js
// Event-driven (the listener) + functional (the pipeline) + OO (the DOM objects).
button.addEventListener("click", () => {                 // event-driven
  const names = users
    .filter(u => u.active)                               // functional
    .map(u => u.name.toUpperCase());                     // functional, over OO objects
  render(names);                                          // imperative side effect
});
```

Where JS/TS blend:

- **Event-driven is baked in.** `addEventListener`, `Promise`, `async`/`await`, and the event loop mean control flow is often *driven by events*, not by a top-to-bottom script (see [11 — Event-Driven](../11-event-driven-programming/)). `async`/`await` is imperative-looking syntax over an event-driven, callback-based core — itself a paradigm blend.
- **Functional pipelines are the default for data.** `arr.map().filter().reduce()` is the everyday idiom; immutability via spread (`{...obj, x: 1}`) and `const` is the cultural norm in modern code.
- **Reactive on top.** Frameworks like React, RxJS, and Svelte add a **reactive** layer (see [05 — Reactive](../05-reactive-programming/)): you *declare* how UI derives from state, and the framework propagates changes. React is "describe the UI for this state" — declarative/reactive — written in functional components, embedded in an OO/imperative JS runtime.
- **TypeScript adds a generic/type-level paradigm.** Generics, conditional types, and mapped types are a small *declarative, type-level* sublanguage layered on the same code (a cousin of [08 — Generic Programming](../08-generic-programming/)).

```ts
// TS: OO interface (data shape) + functional pipeline + a touch of declarative typing.
interface User { name: string; active: boolean; }

const activeNames = (users: User[]): string[] =>
  users.filter(u => u.active).map(u => u.name);   // FP pipeline, typed declaratively
```

JS/TS's lesson: **the most paradigm-dense language most people use** — and its UI frameworks are themselves blends (functional components describing reactive, declarative UIs over an event-driven runtime).

---

## How C++ Blends Paradigms

C++ is the canonical *deliberately* multiparadigm language — Stroustrup designed it to support **procedural + object-oriented + generic + functional** in one program, and to let you pay only for the paradigm you use ("zero-overhead abstraction"). Modern C++ (11 and later) leans hard into the generic and functional ends.

```cpp
#include <vector>
#include <algorithm>
#include <numeric>

struct Order { double amount; bool completed; };   // procedural/POD data, OO-capable

double completed_revenue(const std::vector<Order>& orders) {
    return std::accumulate(                          // FUNCTIONAL fold...
        orders.begin(), orders.end(), 0.0,
        [](double acc, const Order& o) {             // ...with a lambda (functional)
            return o.completed ? acc + o.amount : acc;
        });
    // std::accumulate / transform / copy_if are GENERIC (templated over iterator type)
}
```

Where C++ blends:

- **Generic programming via templates.** The STL (`vector`, `sort`, `accumulate`, `transform`) is *generic*: algorithms parameterized over types, decoupled from containers via iterators (see [08 — Generic Programming](../08-generic-programming/)). C++20 **concepts** make those type constraints declarative and checkable.
- **Functional via lambdas and ranges.** Lambdas (C++11) and the C++20 **ranges** library bring `map`/`filter`-style pipelines: `views::filter(...) | views::transform(...)` is a lazy functional pipeline.
- **OO where entities have identity and lifetime.** Classes with constructors/destructors (RAII) model resources and entities — OO married to deterministic, imperative resource management.
- **Procedural/imperative for hot paths.** When cache layout and tight loops matter, C++ drops to explicit, data-oriented imperative code (the natural home of [10 — Data-Oriented](../10-data-oriented-programming/)).

```cpp
// C++20 ranges: a lazy FUNCTIONAL pipeline, GENERIC over the element type.
auto long_word_letters =
    std::ranges::fold_left(
        words | std::views::filter([](auto& w){ return w.size() >= 5; })
              | std::views::transform([](auto& w){ return w.size(); }),
        0uz, std::plus{});
```

C++'s lesson: **four paradigms, chosen per region for performance and expressiveness**, with the type system (templates/concepts) acting as a fifth, declarative layer.

---

## The Canonical Blend — Functional Core, Imperative Shell

If you remember one blend from this page, remember this one. **Functional core, imperative shell** (named by Gary Bernhardt) is the single most useful multiparadigm pattern, and it shows up — under various names — in nearly every well-structured codebase.

The idea splits a program into two regions by paradigm:

- **The functional core** is pure: it takes data in, returns data out, no I/O, no mutation of the outside world, no surprises. *All the decision-making logic* — the rules, the calculations, the transformations — lives here. Because it's pure, it's trivially testable (no mocks, no setup), easy to reason about, and easy to parallelize.
- **The imperative shell** is a thin layer at the edges that does the *effects*: reads the request, loads from the database, calls the network, writes the response, mutates state. It's imperative because effects are inherently a sequence of real-world steps. It's kept *thin* so there's little to test imperatively.

```python
# IMPERATIVE SHELL — effects only: read input, call the core, write output.
def handle_checkout(request, db, gateway):
    cart = db.load_cart(request.cart_id)          # effect: read
    decision = price_checkout(cart, db.tax_rules) # ← call into the PURE core
    if decision.approved:
        gateway.charge(decision.total)            # effect: write
        db.mark_paid(cart.id)                     # effect: write
    return decision

# FUNCTIONAL CORE — pure: data in, data out, no I/O, fully testable in isolation.
def price_checkout(cart, tax_rules) -> Decision:
    subtotal = sum(line.price * line.qty for line in cart.lines)   # FP transform
    tax      = subtotal * tax_rules.rate_for(cart.region)
    approved = subtotal > 0 and cart.lines                          # pure rule
    return Decision(approved=approved, total=subtotal + tax)
```

Why this blend wins:

- **The hard part (logic) is pure**, so it's the easy part to test — `price_checkout` needs no database, no network, no mocks. The hard-to-test part (effects) is kept tiny.
- **The paradigms have a clean seam**: the function call boundary between `handle_checkout` (imperative) and `price_checkout` (functional). Each region's rules are clear — the shell may do effects, the core may not.
- **It scales the junior insight**: "functional for transforms, imperative for side effects" applied at *architecture* scale instead of line scale.

> **The blend in one line:** push *decisions* into a pure functional core; keep *effects* in a thin imperative shell; the function boundary between them is the paradigm seam. (Seam placement gets its full treatment at [`senior.md`](senior.md).)

---

## Declarative Inside Imperative — SQL, Regex, Builders

A second everyday blend: dropping a **declarative sublanguage** into the middle of imperative/OO code. You describe *what* you want in a constrained mini-language and let a dedicated engine handle the *how* — then splice the result back into your normal control flow.

You do this constantly:

```python
# DECLARATIVE SQL embedded in IMPERATIVE Python.
def top_customers(db, region):
    rows = db.execute(
        """
        SELECT name, SUM(amount) AS revenue        -- declarative: WHAT, not HOW
        FROM orders WHERE region = ? AND status = 'completed'
        GROUP BY name ORDER BY revenue DESC LIMIT 10
        """,
        [region],
    )
    return [Customer(r.name, r.revenue) for r in rows]   # back to FP/OO
```

```python
# DECLARATIVE regex embedded in IMPERATIVE validation code.
PHONE = re.compile(r"^\+?\d{1,3}[-\s]?\d{3}[-\s]?\d{4}$")   # declarative pattern
def is_valid_phone(s: str) -> bool:
    return PHONE.match(s) is not None                       # imperative usage
```

```python
# DECLARATIVE builder/fluent API — describe a query as data, let it generate SQL.
query = (Query.from_("orders")
              .where(status="completed")
              .group_by("region")
              .order_by("revenue", desc=True))            # WHAT you want; builder does HOW
```

Why this blend works and why it's safe:

- **Least power, locally** (see [01 → senior](../01-overview-and-taxonomy/senior.md)): SQL can't do arbitrary I/O mid-scan, a regex can only match its regular language — so the *engine* is free to optimize, and the *blast radius* is contained. You get a powerful capability without giving the embedded language your whole program's power.
- **The seam is the string boundary** (or the builder call): a clearly visible handoff from your imperative code into the declarative engine and back. You're never confused about which paradigm's rules apply on which side.
- **The engine beats hand-rolling**: a query planner picks a better access path than your hand-written loop; a regex engine matches faster and more correctly than nested `if`s. You're delegating to a specialist, which is exactly when declarative pays off.

> **The blend in one line:** embed a *declarative* mini-language (SQL, regex, a query builder) for the part a specialized engine does better, splice its result back into your imperative/OO flow at a clear string/call seam.

---

## Data-Oriented Hot Loops Inside an OO App

A third blend goes the *opposite* direction from the declarative one — it drops *below* OO into raw imperative, **data-oriented** code, but only in the one place that needs it: the performance-critical hot loop.

Most of an application is comfortably object-oriented: entities with identity, methods, encapsulation. But a small region — a physics step, a pricing engine over millions of rows, an image filter — has a *hot loop* where cache behavior and tight iteration dominate everything else. There, OO's pointer-chasing (an array of `Particle` objects scattered across the heap) is a performance disaster. The fix is to switch *that region* to **data-oriented programming** (see [10 — Data-Oriented](../10-data-oriented-programming/)): lay the data out as flat, contiguous arrays and loop over them imperatively.

```cpp
// OO at the application level: a Simulation object owns the world and exposes methods.
class Simulation {
    // DATA-ORIENTED hot region: structure-of-arrays, not array-of-structs.
    std::vector<float> pos_x, pos_y, vel_x, vel_y;   // contiguous, cache-friendly

public:
    void step(float dt) {                            // imperative, data-oriented hot loop
        for (size_t i = 0; i < pos_x.size(); ++i) {  // flat loop, predictable access
            pos_x[i] += vel_x[i] * dt;               // no virtual calls, no pointer chasing
            pos_y[i] += vel_y[i] * dt;
        }
    }
    // ... the rest of the class is ordinary OO: add_body(), reset(), serialize() ...
};
```

The shape of this blend:

- **OO owns the structure and API** (`Simulation`, its methods, its lifecycle) — that's the right paradigm for an application-level entity.
- **Data-oriented imperative owns the hot loop** — flat arrays, no per-element virtual dispatch, layout chosen for the CPU cache. The paradigm switches *inside* one method because the local shape (a tight numeric loop) demands it.
- **The seam is the method boundary**: outside `step()`, it's OO; inside, it's a data-oriented loop. The class hides the change of paradigm from its callers.

This is the mirror image of functional-core/imperative-shell: there, the *core* is the "different" paradigm; here, a small *hot region* is. Both share the principle: **match the paradigm to the local shape, and fence it behind a clean boundary.**

---

## Paradigm Per Layer

Zoom out from individual blends and a pattern emerges across the whole system: **different layers naturally want different paradigms.** This is the organizing idea that makes a large multiparadigm codebase coherent instead of chaotic.

A typical backend, top to bottom:

| Layer | Natural paradigm | Why |
|---|---|---|
| **Configuration / infrastructure** | Declarative (YAML, Terraform, IaC) | Validated, diffable, no arbitrary logic needed — least power |
| **HTTP / I/O edges (the shell)** | Imperative / event-driven | Effects are sequences of real-world steps; requests arrive as events |
| **Domain model** | Object-oriented | Entities with identity, lifecycle, and invariants (see [OOP](../../object-oriented-programming/)) |
| **Business logic / transforms (the core)** | Functional | Pure rules and calculations, testable in isolation |
| **Data access** | Declarative (SQL) at the boundary, behind an OO repository | A planner optimizes access; the repository hides it |
| **Concurrency** | Actor / CSP or event-driven | Isolated state + messages avoid shared-memory races (see [07 — Actors/CSP](../07-actor-model-and-csp/)) |
| **UI (if any)** | Reactive / declarative | Derived state propagates automatically (see [05 — Reactive](../05-reactive-programming/)) |

The point isn't to memorize this exact table — your system's layers will differ. The point is the *move*: **don't choose one paradigm for the whole system; choose the fitting paradigm for each layer**, and let each layer's code be coherent *within itself*. The config layer is purely declarative; the domain layer is purely OO; the logic layer is purely functional. A reader who knows which layer they're in already knows which paradigm's rules apply.

This is the bridge to the senior level: paradigm-per-layer works only if the **seams between layers are clean and deliberate**. Where the imperative shell calls the functional core, where the OO repository wraps the declarative SQL, where the event-driven edge hands off to the actor concurrency layer — each boundary is a place one paradigm's guarantees end and another's begin. Placing and policing those seams is the senior skill; recognizing that layers *want* different paradigms is the middle one.

> **The principle:** a coherent multiparadigm system isn't paradigm-free or paradigm-uniform — it's **paradigm-per-layer**, each layer internally consistent, with deliberate seams between them.

---

## Common Mistakes

- **Treating a language's *culture* as its *limit*.** "We're a Java shop, so everything is OO" leaves the functional and declarative tools in the box. Idiomatic modern Java/Kotlin/C++ uses all of them per layer.
- **A functional core that isn't actually pure.** A "core" function that secretly logs, reads a clock, or hits a cache isn't a functional core — the impurity leaks back the testability you were buying. Effects belong in the shell, *all* of them.
- **Letting the imperative shell grow fat.** When real logic creeps into the shell ("just one `if` here"), the pure core stops being where decisions live, and you lose the blend's benefit. Keep decisions in the core; keep the shell mechanical.
- **Embedding a declarative language and then fighting its engine.** Hand-tuning generated SQL string-by-string, or building a regex so complex it needs its own parser — at that point you've taken back the *how* you delegated, losing the blend's whole point.
- **Reaching for a data-oriented hot loop everywhere.** Structure-of-arrays in a region that isn't hot is premature optimization that sacrifices OO clarity for a speedup you can't measure. Switch paradigms for performance *only where you've proven it matters*.
- **Mixing paradigms within a single function instead of between layers.** A `map` that mutates, a "domain object" that runs SQL inline — the blends work *between* bounded regions, not smeared inside one unit (see [01 → senior](../01-overview-and-taxonomy/senior.md)).

---

## Test Yourself

1. Name the paradigms Python fuses in a single list comprehension `[u.email for u in users if u.active]`. Which part is functional, which is OO?
2. What two paradigms does JavaScript add *on top* of imperative/OO/functional, and what about the language explains why?
3. Which four paradigms does C++ deliberately support, and which language feature carries the "generic" one?
4. Explain functional-core / imperative-shell. What goes in each, and *why* does putting the logic in the core make testing easier?
5. Give three examples of a *declarative language embedded inside imperative code*. What's the seam in each case?
6. You have an OO application with one physics loop that's too slow. What paradigm do you switch *that loop* to, why, and where's the seam?
7. List four layers of a typical backend and the paradigm each one naturally wants. Why is "one paradigm for the whole system" the wrong default?

> If #4 is fuzzy, re-read [Functional Core, Imperative Shell](#the-canonical-blend--functional-core-imperative-shell); if #7 is, re-read [Paradigm Per Layer](#paradigm-per-layer).

---

## Cheat Sheet

```
HOW REAL LANGUAGES BLEND:
  Python  = OO + FP + imperative      idiom: the comprehension (FP transform over OO data)
  JS/TS   = + event-driven + reactive idiom: .map/.filter pipelines, addEventListener,
                                              React (declarative UI), TS generics (type-level)
  C++     = procedural + OO + generic + FP   idiom: STL/ranges (generic+FP), RAII (OO),
                                              flat loops (data-oriented), concepts (declarative)

THE CANONICAL BLENDS (between bounded regions, never within one unit):

  FUNCTIONAL CORE / IMPERATIVE SHELL
    pure logic (data in → data out) at the center, easy to test
    thin imperative edge does ALL effects (I/O, mutation)
    seam = the function call boundary

  DECLARATIVE INSIDE IMPERATIVE
    embed SQL / regex / query-builder for what an engine does better
    least power locally; seam = the string/builder boundary

  DATA-ORIENTED HOT LOOP INSIDE OO APP
    OO owns structure + API; flat-array imperative loop owns the hot region
    switch paradigm ONLY where profiling proves it; seam = the method boundary

PARADIGM PER LAYER (the organizing principle):
  config → declarative   edges → imperative/event   domain → OO
  logic → functional     data → declarative SQL (behind OO repo)
  concurrency → actor/CSP   UI → reactive
  → don't pick ONE paradigm for the system; pick the right one per layer,
    keep each layer internally consistent, make the seams deliberate.
```

---

## Summary

- Real languages blend specific paradigm sets: **Python** fuses OO + FP + imperative (the comprehension is the proof); **JS/TS** add **event-driven** and **reactive** (and a type-level declarative layer in TS); **C++** deliberately supports procedural + OO + generic + functional, with templates/concepts as a fifth declarative layer.
- The most valuable blend is **functional core, imperative shell**: pure decision-making logic at the center (trivially testable), a thin imperative edge doing all the effects, with the function-call boundary as the paradigm seam. Keep the core pure and the shell thin.
- A second everyday blend is **declarative inside imperative** — embedding SQL, regex, or a query builder for the part a specialized engine does better, spliced back at a clear string/call seam, contained by least power.
- A third is the **data-oriented hot loop inside an OO app** — keeping the application OO but switching one proven-hot region to flat-array imperative code behind a method boundary.
- The organizing principle over all of them is **paradigm per layer**: config declarative, edges imperative, domain OO, logic functional, data declarative, concurrency actor, UI reactive — each layer internally coherent, with deliberate seams between layers. Don't choose one paradigm for the whole system.
- Next: [`senior.md`](senior.md) — the *judgement* of which blend fits which shape, the cost of mixing badly, paradigm boundaries as architectural seams, and deep dives on Rust and Scala as the model multiparadigm languages.

---

## Further Reading

- **Gary Bernhardt — *Boundaries* / "Functional Core, Imperative Shell"** — the talk that named the canonical blend; required viewing.
- **Bjarne Stroustrup — *The Design and Evolution of C++*** — the rationale for designing a deliberately multiparadigm language and "zero-overhead" paradigm mixing.
- **Mike Acton — "Data-Oriented Design and C++" (CppCon 2014)** — why the hot loop wants a different paradigm than the rest of the app.
- **Eric Elliott — *Composing Software*** — functional + OO blending in idiomatic JavaScript.
- **Effective Java (Bloch) / Effective Modern C++ (Meyers)** — both teach, item by item, the multiparadigm idioms of their language.

---

## Related Topics

- [`junior.md`](junior.md) — the reveal that your language is already multiparadigm; one task, three hats.
- [`senior.md`](senior.md) — choosing a blend by problem shape; seams; Rust and Scala deep dives.
- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the "shell" and the hot-loop paradigm.
- [03 — Declarative Programming](../03-declarative-programming/) — the SQL/regex/config you embed.
- [05 — Reactive Programming](../05-reactive-programming/) · [11 — Event-Driven](../11-event-driven-programming/) — the paradigms JS/TS add for UIs.
- [08 — Generic Programming](../08-generic-programming/) — the templates/concepts paradigm C++ and TS add.
- [10 — Data-Oriented Programming](../10-data-oriented-programming/) — the hot-loop paradigm inside an OO app.
- [Object-Oriented Programming](../../object-oriented-programming/) · [Functional Programming](../../code-craft/functional-programming/) — the two paradigms most layers are built from.
