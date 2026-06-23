# Premature Abstraction at Scale — Optimize This

> **Category:** [Anti-Patterns at Scale](../README.md) → **Premature Abstraction at Scale**
> **Covers (collectively):** Speculative Generality · Wrapper-itis & needless indirection · Premature decoupling & one-implementation interfaces · The Wrong Abstraction · AHA / Rule of Three / YAGNI as the cure

The previous practice files trained you to *spot* over-abstraction. This one is about **measuring** what it costs and reclaiming it. Premature abstraction isn't only a readability tax — when the indirection sits on a hot path it is a *performance* tax you can put a number on: extra allocations from boxing, virtual or reflective dispatch the CPU can't predict, and inlining the compiler can't perform because the concrete type is hidden behind generality.

Each case below is over-abstracted code on a hot path. We **inline to the concrete case**, then **measure the win** — fewer allocations, less dispatch, and (not incidentally) clearer code. The discipline is the same one the rest of the chapter preaches: *measure before and after*; a simplification that "should" be faster but isn't is just a different guess.

> **Ground rule:** every claim of "faster" in this file is backed by a benchmark you can run. Numbers shown are representative (Go 1.22 / JDK 21 / CPython 3.12 on a modern x86 laptop) — yours will differ, but the *shape* of the win (allocations, dispatch, inlining) is what transfers.

---

## Table of Contents

1. [Case 1 — The reflection-based generic dispatcher (Go)](#case-1--the-reflection-based-generic-dispatcher-go)
2. [Case 2 — The deep wrapper chain on a hot read path (Go)](#case-2--the-deep-wrapper-chain-on-a-hot-read-path-go)
3. [Case 3 — The "configurable" field-mapper that reimplements assignment (Java)](#case-3--the-configurable-field-mapper-that-reimplements-assignment-java)
4. [How to Measure (so you don't guess)](#how-to-measure-so-you-dont-guess)
5. [Summary](#summary)
6. [Related Topics](#related-topics)

---

## Case 1 — The reflection-based generic dispatcher (Go)

**The abstraction.** An event dispatcher was built "generic" — handlers are stored as `any` and invoked through `reflect.Call`, "so the dispatcher never needs to know concrete handler types." It runs on every inbound event (the service's hottest path). In reality there are a handful of handlers, all `func(Event) error`, registered once at startup.

```go
// BEFORE — reflection on the hot path.
type Dispatcher struct {
    handlers map[string]any
}

func (d *Dispatcher) Register(event string, handler any) {
    d.handlers[event] = handler
}

func (d *Dispatcher) Dispatch(event string, payload any) error {
    h, ok := d.handlers[event]
    if !ok {
        return fmt.Errorf("no handler for %q", event)
    }
    fn := reflect.ValueOf(h)
    args := []reflect.Value{reflect.ValueOf(payload)} // boxes payload + allocates slice
    out := fn.Call(args)                              // reflective call
    if len(out) > 0 && !out[0].IsNil() {
        return out[0].Interface().(error)
    }
    return nil
}
```

**Why it's slow (and why it can panic).** Three costs, all paid per event:

1. **Allocation.** `reflect.ValueOf(payload)` boxes the argument into an `interface{}`, and `[]reflect.Value{...}` heap-allocates a slice for the argument list. `fn.Call` allocates again for the return values.
2. **Reflective dispatch.** `reflect.Value.Call` walks the function's type descriptor, type-checks each argument at runtime, and dispatches indirectly — far more work than a direct call, and unpredictable for the branch predictor.
3. **No inlining.** The compiler can't see through `reflect.Call`, so the handler body can never be inlined into the hot loop.

And the generality is a correctness hazard: a payload whose dynamic type doesn't match the handler's parameter **panics at runtime** — an error a typed signature makes impossible.

```go
// AFTER — a typed func map. Same behavior, no reflection.
type Handler func(Event) error

type Dispatcher struct {
    handlers map[string]Handler
}

func (d *Dispatcher) Register(event string, h Handler) { d.handlers[event] = h }

func (d *Dispatcher) Dispatch(event string, e Event) error {
    h, ok := d.handlers[event]
    if !ok {
        return fmt.Errorf("no handler for %q", event)
    }
    return h(e) // direct, typed, inlinable, cannot panic on type mismatch
}
```

**The benchmark.**

```go
func BenchmarkDispatch(b *testing.B) {
    d := newDispatcher()
    d.Register("order.shipped", handleShipped)
    e := Event{ID: "e1"}
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = d.Dispatch("order.shipped", e)
    }
}
```

**Representative results:**

| Version | ns/op | B/op | allocs/op |
|---|---:|---:|---:|
| BEFORE (reflection) | ~310 | 112 | 4 |
| AFTER (typed map)   | ~12  | 0   | 0 |

**The win.** ~25× faster per dispatch and **zero allocations** (the reflection version allocated four times per event — argument box, argument slice, return slice, error boxing). On a service doing 50k events/sec, the BEFORE version spends ~15 ms/sec just on dispatch overhead and generates ~5.6 MB/sec of garbage for the collector to chase; the AFTER version's overhead is in the noise. The typed version is also *shorter* and **cannot panic on a type mismatch** — the generality removed both the speed and the safety. This is the recurring irony: the abstract version is slower *and* more dangerous, traded for a flexibility (heterogeneous handler signatures) that the codebase never used.

> Reflection earns its keep for *genuinely* heterogeneous, compile-time-unknown signatures — a serialization or RPC library. A fixed set of `func(Event) error` handlers is not that case; the generality was speculative.

---

## Case 2 — The deep wrapper chain on a hot read path (Go)

**The abstraction.** A cache lookup travels through four pass-through layers — `Facade → Service → Manager → Store` — added "for separation of concerns." Only the `Store` does work (a map read under a lock). The lookup is on the request hot path.

```go
// BEFORE — four layers, three of them pure forwarders.
type CacheFacade struct{ svc *CacheService }
func (f *CacheFacade) Get(k string) (string, bool) { return f.svc.Get(k) }

type CacheService struct{ mgr *CacheManager }
func (s *CacheService) Get(k string) (string, bool) { return s.mgr.Get(k) }

type CacheManager struct{ store *CacheStore }
func (m *CacheManager) Get(k string) (string, bool) { return m.store.Get(k) }

type CacheStore struct {
    mu sync.RWMutex
    m  map[string]string
}
func (c *CacheStore) Get(k string) (string, bool) {
    c.mu.RLock()
    v, ok := c.m[k]
    c.mu.RUnlock()
    return v, ok
}
```

**Why it's slow — and why "the compiler inlines it" isn't automatic here.** Each forwarder is a method call through a pointer field. Go *can* inline small leaf methods, but inlining is budgeted and **disabled past a depth/complexity threshold**; pointer-indirected method chains through separately-allocated structs frequently *don't* fully inline, especially once the methods are non-trivial or the call sites are hot enough to matter. Even when they do inline, the human cost is unconditional: every `Get` is four files and three "go to definition" hops to reach the one line that matters, and every layer is a struct you must allocate and wire at startup.

```go
// AFTER — the layers that do nothing are gone.
type CacheStore struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *CacheStore) Get(k string) (string, bool) {
    c.mu.RLock()
    v, ok := c.m[k]
    c.mu.RUnlock()
    return v, ok
}
// Callers hold a *CacheStore directly: store.Get(k)
```

**The benchmark** (forcing the no-inline case with `//go:noinline` on the forwarders, to model the realistic "didn't inline" scenario):

| Version | ns/op | allocs/op |
|---|---:|---:|
| BEFORE (4 layers, not inlined) | ~28 | 0 |
| AFTER (direct store) | ~9 | 0 |

**The win.** ~3× on the dispatch overhead *when the chain doesn't inline* — and on a path called millions of times per second that is real CPU. When it *does* inline, the runtime win shrinks toward zero, but the **comprehension and wiring win remains**: one type instead of four, one file instead of four, no startup graph of `Facade{Service{Manager{Store}}}` to construct. The honest summary: wrapper-itis's runtime cost is *conditional* (it depends on whether the compiler defeats it), but its complexity cost is *unconditional*. Remove empty layers for the certain readability win; the speed is a frequent bonus.

> The rule isn't "no layers" — it's "no *empty* layers." A `CacheService` that adds TTL, metrics, or a singleflight to collapse stampedes *earns* its place. One that does `return next.Get(k)` does not.

---

## Case 3 — The "configurable" field-mapper that reimplements assignment (Java)

**The abstraction.** Mapping a `UserRow` to a `UserDto` was made "configurable" via a reflection-driven field-copy engine "so we never have to hand-write mappers." It runs on every row of every list endpoint — squarely a hot path.

```java
// BEFORE — reflection-based generic mapper on the hot path.
public final class GenericMapper {
    public static <T> T map(Object src, Class<T> targetType, Map<String,String> fieldMap)
            throws Exception {
        T target = targetType.getDeclaredConstructor().newInstance();
        for (var entry : fieldMap.entrySet()) {
            Field sf = src.getClass().getDeclaredField(entry.getKey());
            Field tf = targetType.getDeclaredField(entry.getValue());
            sf.setAccessible(true);
            tf.setAccessible(true);
            tf.set(target, sf.get(src));      // reflective get + set, boxing primitives
        }
        return target;
    }
}

// Called per row:
//   var dto = GenericMapper.map(row, UserDto.class,
//                 Map.of("id","id","name","name","email","email"));
```

**Why it's slow — and fragile.** Per row, the engine does `getDeclaredField` lookups (string-keyed reflection, no caching), `setAccessible` calls, reflective `get`/`set` (which **box** primitive `id`/`age` into `Integer`), and constructs the target via reflection. None of it is type-checked: a typo in `fieldMap`, a renamed field, or a type mismatch becomes a **runtime `NoSuchFieldException`/`IllegalArgumentException`** instead of a compile error. The "configurability" is never exercised — every call passes the same constant `fieldMap`.

```java
// AFTER — the mapper is three assignments.
public final class UserMapper {
    public static UserDto toDto(UserRow row) {
        UserDto dto = new UserDto();
        dto.setId(row.getId());
        dto.setName(row.getName());
        dto.setEmail(row.getEmail());
        return dto;
    }
}
// Caller: var dto = UserMapper.toDto(row);
```

**The benchmark** (JMH, mapping one row):

| Version | ns/op | alloc B/op |
|---|---:|---:|
| BEFORE (reflection) | ~620 | 240 |
| AFTER (hand-written) | ~6 | 16 |

**The win.** ~100× faster and ~15× less allocation per row. On a list endpoint returning 1,000 rows, the BEFORE mapper adds ~0.6 ms of pure reflection overhead and ~240 KB of garbage *per request*; the AFTER mapper is effectively free. The hand-written mapper is also **compile-time-checked** — rename `UserRow.email` and the build fails at the mapper instead of in production on the first request — and JIT-inlinable into the calling loop, which the reflective version can never be.

> The trap to avoid in the other direction: a *real* mapping library (MapStruct, generated at compile time) is a legitimate tool when you have dozens of mappers, because it generates the plain-assignment code above *for* you with compile-time checking. The anti-pattern here is the *hand-rolled runtime-reflection* mapper for **one** mapping — speculative generality that's slower, unsafe, and configures something nobody varies.

---

## How to Measure (so you don't guess)

Inlining a "should be faster" abstraction without measuring is the same sin as abstracting on a hunch. Tooling per language:

- **Go.** `go test -bench=. -benchmem` for ns/op and allocs/op; `-benchmem` is non-negotiable for these cases since the win is usually *allocations*. Confirm inlining with `go build -gcflags='-m'` (look for `inlining call to ...` or `cannot inline`). Profile allocations with `go test -bench=. -memprofile=mem.out` then `go tool pprof`.
- **Java.** **JMH** is the only honest microbenchmark tool on the JVM — naive `System.nanoTime()` loops are wrecked by JIT warmup and dead-code elimination. Use `@BenchmarkMode(AverageTime)`, a `Blackhole` to consume results, and `-prof gc` for allocation rate. Inspect inlining with `-XX:+PrintInlining`.
- **Python.** `timeit` for wall-clock, `tracemalloc` or `pympler` for allocations, and `py-spy`/`cProfile` for where the time goes. Reflection-style (`getattr`/`setattr`) overhead shows up clearly here too.

**The protocol:** benchmark BEFORE, make the change, benchmark AFTER on the *same* machine and inputs, and report ns/op **and** allocs/op. If the AFTER isn't actually faster (sometimes the compiler already inlined the abstraction away), keep the change anyway *for the readability win* — but say so honestly rather than claiming a speedup you didn't get.

---

## Summary

- Premature abstraction on a hot path is a **measurable** cost: boxing/allocations, reflective or virtual dispatch the CPU can't predict, and inlining the compiler can't do because the concrete type is hidden.
- **Reflection-based generic dispatch** (Cases 1 & 3) is the worst offender — ~25× to ~100× slower than the concrete form, allocation-heavy, *and* it converts compile errors into runtime panics. Inline to a typed func/method and the speed and safety both return.
- **Wrapper-itis** (Case 2) has a *conditional* runtime cost (depends on whether the compiler inlines through the chain) but an *unconditional* complexity cost. Remove empty layers for the certain readability win; the speedup is a frequent bonus.
- **Always measure before/after** with allocation counts, on the same machine and inputs. A simplification that "should" be faster but isn't is just another guess — keep it for clarity, but don't claim a speedup you can't show.
- The mirror-image trap: a *real* compile-time tool (MapStruct, generated code) or a *justified* boundary layer (caching, metrics) earns its keep. The anti-pattern is hand-rolled *runtime* generality for a case nobody varies.

---

## Related Topics

- [Premature Abstraction → Find the Bug](find-bug.md) — Snippet 6 is the reflection dispatcher this file benchmarks.
- [Over-Engineering → Optimize This](../../01-development/03-over-engineering/optimize.md) — the in-the-file performance view of premature optimization and abstraction.
- [Premature Abstraction → Tasks](tasks.md) — inlining wrappers and one-impl interfaces by hand.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — confirm a path is actually hot before optimizing it.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/junior.md) — apply the inlining across many call sites mechanically.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-level over-abstraction.
- Level files: [`senior.md`](senior.md) — the cost model behind these measurements.
