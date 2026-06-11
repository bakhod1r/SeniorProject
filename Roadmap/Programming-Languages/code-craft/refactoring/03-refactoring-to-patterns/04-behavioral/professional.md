# Refactoring Toward Behavioral Patterns — Professional Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Every behavioral pattern replaces a branch with an **indirection** — a virtual call, an object lookup, a notification fan-out. Indirection is rarely free. This file is about the *runtime* consequences: dispatch cost, allocation pressure, memory leaks (especially the Observer listener leak — the one that takes down production), state-machine performance, and the cases where the honest senior answer is "the conditional was faster and clearer; the pattern is over-engineering."

The governing principle: **refactor for design first, measure before you let performance veto it.** Most of the costs below are negligible until proven otherwise by a profiler — but they are real, they compound at scale, and a professional knows where to look.

---

## Virtual dispatch cost

Replacing `switch` with polymorphism (Strategy, State, Command) swaps a jump table for a **virtual method call**. What that costs:

- **A monomorphic call site** — one where the JIT sees a single concrete type — is essentially free. HotSpot inlines it after profiling; the indirection disappears. Most Strategy/State call sites in steady state are monomorphic or **bimorphic** (two types), both of which the JIT handles with inline caches and guards, often inlining both.
- **A megamorphic call site** — where many concrete types flow through the same `strategy.calculate(...)` — defeats inlining. The JIT falls back to a vtable/itable lookup: an indirect branch the CPU's branch-target predictor may mispredict. A mispredicted indirect branch costs ~10–20 cycles. A well-predicted `switch` on a dense `int` can be a single, correctly-predicted jump.
- **Interface dispatch (`itable`) is slightly costlier than class dispatch (`vtable`)** in the megamorphic case, because resolving which method an interface call targets is more work than indexing a class's vtable.

Net: for cold or low-frequency code, virtual dispatch cost is irrelevant — design wins. For a *megamorphic call in a tight inner loop*, a Strategy can measurably lose to a `switch`. The fix is usually not "remove the pattern" but "split the hot path so each call site sees one type," or keep the conditional exactly there.

```java
// If this runs 10^9 times and `op` cycles through 8 strategy types,
// the call site is megamorphic — measure before assuming the Strategy is fine.
for (Tick t : ticks) result += strategy.apply(t);   // megamorphic? profile it.
```

---

## Strategy / Command object allocation

Two allocation traps:

**1. Allocating a new strategy/command per call.** A factory that does `new WeightBasedShipping()` on every request creates garbage for stateless objects that could be singletons.

```java
// BAD: a fresh stateless strategy per call -> needless allocation + GC pressure.
ShippingStrategy s = new WeightBasedShipping();
// GOOD: stateless strategies are flyweights — allocate once, share forever.
private static final ShippingStrategy WEIGHT = new WeightBasedShipping();
```

Stateless strategies, commands, and Null Objects should be **singletons/flyweights**. They hold no per-call state, so one instance serves all callers and all threads. This is the single biggest allocation win in pattern-heavy code.

**2. Capturing lambdas.** Lambdas are a lightweight Strategy/Command, but a *capturing* lambda allocates a new object each evaluation, while a *non-capturing* one is cached:

```java
list.sort((a, b) -> a.id() - b.id());          // non-capturing -> cached, no alloc
list.sort((a, b) -> a.compareBy(field));        // captures `field` -> allocates per call
```

In a hot loop, a captured lambda is a hidden allocation. Hoist the comparator out of the loop, or make it non-capturing.

**3. Command queues and undo stacks retain memory.** A Command that captures a large receiver/argument keeps it alive as long as it's on the undo stack. A 10,000-entry undo history of commands each pinning a document snapshot (Command+Memento) is a real memory cost — bound the history depth and consider storing *diffs* rather than full snapshots.

---

## Observer: fan-out cost and the listener leak

Observer is where behavioral refactoring meets production incidents.

### Fan-out cost

`notify()` is O(number of listeners), executed synchronously on the publisher's thread by default. Consequences:

- A slow listener **blocks the publisher** and every other listener after it. One listener doing synchronous I/O in `onOrderPlaced` adds its latency to the order path.
- Exceptions: without isolation, one listener throwing aborts the rest (see [middle.md](middle.md) for the try/catch-per-listener pattern). But swallowing exceptions hides failures — log and meter them.
- **Re-entrancy / notification storms:** a listener that, while handling an event, triggers another event that re-enters `notify()` can recurse or livelock. Guard against re-entrant notification or use an explicit event queue.
- **Iteration safety:** if a listener adds/removes listeners during notification, naive iteration throws `ConcurrentModificationException`. Use `CopyOnWriteArrayList` (cheap reads, costly writes — fine when subscriptions are rare) or snapshot the list before iterating.

### The lapsed-listener leak (the important one)

This is the most damaging Observer bug and the most common memory leak in long-lived JVM/JS apps:

> A subject holds **strong references** to its observers. If an observer is never unsubscribed, the subject keeps it (and everything it transitively references) alive **forever**. The observer "lapsed" — logically dead, physically retained.

```java
// LEAK: each opened view subscribes but never unsubscribes.
class OrderView {
    OrderView(OrderService svc) {
        svc.addListener(this::refresh);   // svc now strongly references this view
    }
    // ...no removeListener anywhere. Close the view -> still retained by svc.
}
```

Open and close that view 10,000 times and you retain 10,000 views plus their UI trees. The heap climbs, GC pauses lengthen, and eventually `OutOfMemoryError`. It's insidious because the code *works* — it just never frees.

**Fixes, in order of preference:**

1. **Explicit, paired lifecycle.** Whoever subscribes is responsible for unsubscribing — `register` in init, `unregister` in close/dispose, ideally via try-with-resources / a `Subscription` handle returned by `addListener`:
   ```java
   Subscription sub = svc.addListener(this::refresh);
   // later, deterministically:
   sub.cancel();
   ```
   This is the most reliable fix because it's deterministic. Prefer it.
2. **Weak references** (`WeakReference`/weak listener lists, `java.util.WeakHashMap`). The subject holds observers weakly, so GC can reclaim a lapsed observer. Caveat: a listener with *no other strong reference* (e.g. a bare lambda not stored anywhere) gets collected immediately and silently stops firing — weak listeners are subtle and easy to get wrong. Use deliberately, not as a default.
3. **Scoped buses.** Tie subscriptions to a lifecycle scope (request, session, component) that bulk-unsubscribes on teardown — the model behind framework `@PreDestroy` hooks and Android `Lifecycle`-aware observers.

In garbage-collected UI frameworks this leak is endemic: every "my single-page app's memory grows on navigation" bug is usually a lapsed listener (or a closure over a DOM node) somewhere.

---

## State machine performance

State-as-objects vs a `switch`-based state machine:

- **Object-per-state** costs a virtual call per event and (if you allocate states on transition) an allocation per transition. For high-frequency state machines (protocol parsers, game loops at 10^6 transitions/sec), this shows up.
- **Mitigation:** make state objects **stateless singletons** — they hold no instance data, only behavior, so one `Established` instance serves every connection. Then transitions are pointer reassignments, zero allocation:
  ```java
  enum ConnState { CLOSED, LISTEN, ESTABLISHED;  /* behavior via methods */ }
  // or static final singletons; transition = context.state = ESTABLISHED;
  ```
- **The fastest hand-rolled state machines use a transition table** (`int[state][event] -> nextState`) — an array lookup with no virtual dispatch, ideal for parsers/lexers. You lose the readability and per-state behavior encapsulation of the State pattern. This is a deliberate trade: pattern for maintainability, table for raw speed. Most business state machines should use the pattern; a lexer's inner loop should use the table.

---

## Interpreter performance

Tree-walking an AST (`node.interpret(ctx)` recursively) is the slowest evaluation strategy: a virtual call and pointer-chase per node, poor cache locality, no constant folding. For occasional rule evaluation it's fine. For hot evaluation:

- **Compile the AST to a closure** (partial evaluation): walk the tree once, produce a `Function<Context, Boolean>` with the structure baked in; the per-evaluation cost drops to closure calls.
- Or compile to bytecode / use an existing expression engine.

If the implicit-language refactoring from [senior.md](senior.md) is going into a hot path, plan for compilation, not naive interpretation.

---

## When conditionals are actually faster — and the pattern is over-engineering

A professional must be willing to *not* apply the pattern. The conditional wins when:

1. **The branch count is small and stable (2–3) and never grows.** Two strategy classes + an interface + a factory is more code, more indirection, and more files than a four-line `if`. The pattern's benefit (open extension) is worthless if nothing extends.
2. **The call site is hot and megamorphic.** As above, a dense `switch` on an `int`/enum can be a single predicted jump; the megamorphic virtual call mispredicts. In a profiler-proven hot loop, keep the switch.
3. **The variants don't vary independently.** If "the algorithm" and "the data it needs" always change together as a unit (a closed, compiler-checkable set), a sealed-type `switch` with exhaustiveness checking gives you safety *and* speed without the open-ended Strategy machinery.
4. **The indirection obscures more than it reveals.** Eight one-line command classes scattered across eight files can be *harder* to follow than one switch you read top to bottom. Cohesion of "all the actions in one readable place" sometimes beats the decoupling.

Kerievsky's own counterweight is the entire *Refactoring **Away From** Patterns* direction: if a Strategy/State/Command has exactly one implementation, or its flexibility is never used, **inline it back to a conditional**. See [`../05-refactoring-away-from-patterns/junior.md`](../05-refactoring-away-from-patterns/junior.md). Over-engineering is a refactoring smell too.

**Decision rule:** apply the behavioral pattern when variants are *open, numerous, or runtime-swappable*; keep the conditional when they're *closed, few, and hot*. Then profile to confirm.

---

## JIT and branch prediction notes

A few specifics worth carrying:

- **Inline caches:** HotSpot records the receiver type at each call site. Monomorphic → it inlines directly behind a type guard. Bimorphic → two inlined paths. Megamorphic (>2, default threshold) → it gives up and emits a vtable/itable call. So Strategy with **≤2 hot implementations per site** often costs nothing after warmup; the cliff is at megamorphism.
- **Branch prediction:** a `switch` whose branch correlates with recent history predicts well (near-zero cost); a *random* branch mispredicts ~half the time (~15-cycle penalty each). Polymorphic dispatch on a *predictable* type stream also predicts well via the indirect-branch predictor. The performance question is less "switch vs virtual" and more "how predictable is the selection?"
- **Devirtualization:** the JIT can turn a virtual call back into a direct (inlinable) call when it proves only one type reaches the site (CHA — class hierarchy analysis), even deoptimizing if a new type loads. `final` classes/methods and `private`/`static` give it more to work with. So making strategy/state classes `final` is both a correctness signal and a perf hint.
- **Warmup matters in benchmarks:** measuring a pattern's dispatch cost with a cold JIT will mislead you — the interpreter and unoptimized code dominate. Use JMH with proper warmup; never microbenchmark by hand. (See `profiling-techniques`.)

---

## Next

- **[junior.md](junior.md)** — Strategy, State, Template Method.
- **[middle.md](middle.md)** — Command, Null Object, Observer (and the leak's first mention).
- **[senior.md](senior.md)** — Visitor, Interpreter, Chain of Responsibility, pattern interplay.
- **[interview.md](interview.md)** · **[tasks.md](tasks.md)** · **[find-bug.md](find-bug.md)** · **[optimize.md](optimize.md)**.
- Counterweight: **[../05-refactoring-away-from-patterns/junior.md](../05-refactoring-away-from-patterns/junior.md)** — when to remove a behavioral pattern.
