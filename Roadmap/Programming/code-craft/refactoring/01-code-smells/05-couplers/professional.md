# Couplers — Professional Level

> Runtime cost of dispatch through chains, JIT inlining of forwards, distributed call costs.

---

## Table of Contents

1. [Cost model](#cost-model)
2. [Method chains and JIT inlining](#method-chains-and-jit-inlining)
3. [Forwards and devirtualization](#forwards-and-devirtualization)
4. [Demeter violations and bytecode](#demeter-violations-and-bytecode)
5. [Distributed message chains: latency and tracing](#distributed-message-chains-latency-and-tracing)
6. [False sharing in tightly coupled classes](#false-sharing-in-tightly-coupled-classes)
7. [Profiling Coupler-related issues](#profiling-coupler-related-issues)
8. [Review questions](#review-questions)

---

## Cost model

| Operation | Cost (rough) |
|---|---|
| Local field access | 1 cycle |
| Direct method call (devirtualized) | 1-2 cycles |
| Virtual method call (monomorphic) | 1-2 cycles + IC guard |
| Virtual method call (megamorphic) | 5-15 cycles + cache miss |
| Method call across module boundary | Same as above |
| RPC (in-DC) | ~1ms (1,000,000 cycles) |
| RPC (cross-DC) | ~50ms (50,000,000 cycles) |

> **Implication:** in-process Couplers (Feature Envy, Hide Delegate) have runtime cost in nanoseconds. Distributed Couplers (cross-service Message Chains) have cost in milliseconds — 6 orders of magnitude difference.

---

## Method chains and JIT inlining

A 4-link chain `a.b().c().d().e()` is 4 method calls. The JIT can inline each call if:

- Each method is small enough (`MaxInlineSize`).
- Each call site is monomorphic.

If all 4 inline, the chain becomes a sequence of field accesses — same speed as `a.b.c.d.e`.

If one link in the chain is megamorphic or too large, the chain breaks at that link. The remaining calls are real method dispatches.

### Hide Delegate vs chain — runtime?

Hide Delegate:
- Caller calls `a.aggregateMethod()`.
- `aggregateMethod()` internally does `b().c().d().e()`.
- Same 4 method calls, just packaged.

If the JIT inlines `aggregateMethod()` into the caller, the result is identical to the original chain. **Hide Delegate is free at runtime.** The benefit is purely structural.

### What can hurt

If `aggregateMethod()` contains a polymorphic call site, packaging may move the megamorphism behavior. E.g., the chain `a.getRouter().getRoute(req)` is monomorphic per call site (different routes, but always returning a Route). Packaging into `a.routeFor(req)` may not change anything. But moving logic *into* a polymorphic class can introduce megamorphism.

---

## Forwards and devirtualization

A Middle Man's `forward(args)` calls `delegate.real(args)`. JIT sees:

- Field load (delegate).
- Method call.

If the delegate is `final` (or effectively final via constructor injection + immutability), the JIT can devirtualize and inline. The forward is free.

If the delegate is mutable (assignable post-construction), the JIT may not devirtualize. The forward becomes a real method call.

### Implication

Use `final` (or `record` fields, or Kotlin `val`) for delegated dependencies in Middle Men. The JIT optimizes them away.

---

## Demeter violations and bytecode

A chain `a.getB().getC().getD().doIt()` compiles to:

```
aload_1               // load a
invokevirtual A.getB  // call a.getB()
invokevirtual B.getC  // call b.getC()
invokevirtual C.getD  // call c.getD()
invokevirtual D.doIt  // call d.doIt()
```

4 `invokevirtual` instructions. Each can be inlined or not by JIT.

A delegating method:

```java
class A {
    public int doIt() {
        return getB().getC().getD().doIt();
    }
}

a.doIt();
```

Bytecode of caller: `invokevirtual A.doIt` — one call. JIT inlines `A.doIt` into caller (now sees the chain), then inlines each step in the chain. End result: same machine code.

> The "structural improvement" of Hide Delegate is *invisible to the runtime* once JIT optimizes. It exists for *humans*.

---

## Distributed message chains: latency and tracing

A 4-service chain `A → B → C → D → response` has compounding latency:

- Each hop: 1ms internal RPC.
- Total: 4ms minimum, plus retries, plus serialization, plus tail latency multiplication.

For tail latency: if each service has p99=10ms, the chain's p99 is *not* 10ms — it's worse. The probability that *any* hop is slow grows with chain length. A 4-hop chain has p99 closer to 40ms.

### Tracing

OpenTelemetry, Datadog APM, Jaeger, Zipkin: all build traces showing the full call graph. Look for:

- **Long chains**: > 4 sequential calls.
- **High fan-out**: one call making many parallel sub-calls (often fine).
- **Hot edges**: the same A→B call repeated millions of times per minute.

Refactoring opportunity: replace synchronous chains with events; replace repeated A→B with caching at A.

### Idempotency

Chains are at risk of partial failure: A→B succeeds, A→C fails. A retries the whole chain; B sees a duplicate. Without idempotency, B does the work twice.

Cure: idempotency keys (every call carries a unique ID; B dedupes by ID). This is mandatory for chains; optional for single calls.

---

## False sharing in tightly coupled classes

If two classes share an instance via mutable state, and they live on different threads, false sharing can occur:

```java
class Pair {
    volatile int counterA;
    volatile int counterB;
}
```

`counterA` and `counterB` likely live in the same cache line. Threads writing to A and B respectively cause cache line invalidation per write — both threads run slower.

**Cure:** padding (`@Contended`) or splitting:

```java
class CounterA { @Contended volatile int value; }
class CounterB { @Contended volatile int value; }
```

This is most relevant when Inappropriate Intimacy means two classes share state across threads.

---

## Profiling Coupler-related issues

### JFR / async-profiler

Look for:

- **Wide flame frames** at points like `Foo.getBar()`, `Bar.getBaz()`, etc. — chains that didn't inline.
- **High allocation rate at chain navigation** — temporary objects allocated mid-chain (`getX()` returning new instances).
- **Megamorphic call sites** highlighted by JIT compilation logs (`-XX:+PrintInlining`).

### Distributed tracing

- **Span depth** (chain length): high values are red flags.
- **Span duration distribution**: if one hop dominates, the chain's value is in question.
- **Synchronous vs asynchronous spans**: tracing tools show this; aim to convert sync chains to async fan-outs.

---

## Review questions

1. **Hide Delegate adds a method call. Is it slower than the chain?**
   No, in most cases. JIT inlines the new method into callers, then inlines the chain's links. Same machine code.

2. **A 4-service synchronous chain has p99 = 100ms. Diagnosis?**
   Tail latency multiplication. Each service's p99 contributes; chain is dominated by the slowest. Cures: parallelize where possible, cache, switch to events for non-critical paths.

3. **`final` field on a delegate — why does it matter for JIT?**
   `final` allows the JIT to assume the field doesn't change post-construction; can devirtualize calls through it. Without `final`, the JIT may have to re-check or treat the call as dynamic.

4. **Saga pattern — relate to Couplers.**
   Sagas replace synchronous chains (which are tight Couplers) with chains of *events* + compensating actions. Each step is independent. The overall transaction is "eventually consistent" rather than ACID. Trades runtime coupling for eventual consistency complexity.

5. **`@Contended` annotation — when?**
   When two fields on the same object are written concurrently from different threads. Prevents false sharing by padding the field into its own cache line.

6. **Idempotency in chains — is it mandatory?**
   For chains with retry logic or "at-least-once" semantics: yes. Without it, retries cause duplicate work. With idempotency keys, retries are safe — work is done once even if requested N times.

7. **API gateway as Middle Man — runtime cost?**
   Gateways add ~10-50ms per request (auth, rate-limit, route lookup, network hop). For high-throughput internal services, this matters; for user-facing APIs (where overall latency budget is hundreds of ms), it's acceptable.

8. **Method chains in Java streams — runtime cost?**
   Each operator (`filter`, `map`, etc.) is lazily applied during the terminal operation. The chain is fused — single iteration through the source. Stream overhead per element is ~5-10ns; for 1M elements, ~5-10ms total. Often acceptable.

9. **Tightly coupled microservices — measure with what tool?**
   Distributed tracing (Jaeger, Datadog APM). Looks for chains > 3 hops; calls between services that are hot; latency tails.

10. **A profile shows 30% time in `BeanWrapper.getPropertyValue` (Spring). Diagnosis?**
    Spring's reflection-heavy property access. Every "Inappropriate Intimacy" via Spring Data JPA or similar may call this. Cure: use compile-time alternatives where critical (e.g., explicit setters), avoid reflection-driven access in hot paths.

---

> **Next:** [interview.md](interview.md) — Q&A.
