# Bloaters — Professional Level

> Focus: "Under the hood" — runtime cost, JIT inlining, GC pressure, allocation patterns, and the *measured* cost of refactoring Bloaters.

---

## Table of Contents

1. [The cost model — what you actually pay](#the-cost-model-what-you-actually-pay)
2. [Long Method and JIT inlining](#long-method-and-jit-inlining)
3. [Primitive Obsession: the value-object cost](#primitive-obsession-the-value-object-cost)
4. [Long Parameter List and calling conventions](#long-parameter-list-and-calling-conventions)
5. [Large Class and cache locality](#large-class-and-cache-locality)
6. [Data Clumps and struct layout](#data-clumps-and-struct-layout)
7. [Microbenchmarks and methodology](#microbenchmarks-and-methodology)
8. [Cross-language cost comparison](#cross-language-cost-comparison)
9. [Profiling for Bloater detection](#profiling-for-bloater-detection)
10. [Review questions](#review-questions)

---

## The cost model — what you actually pay

Refactoring is rarely free. The *direct* cost of a refactor is engineer time. The *runtime* cost is more interesting:

| Refactor | Runtime cost (typical) | Runtime savings (typical) |
|---|---|---|
| Extract Method | ~0 (JIT inlines short methods back) | Better cache behavior, easier to optimize |
| Replace Data Value with Object | +1 allocation per construction | None directly; correctness wins |
| Introduce Parameter Object | +1 allocation per call | None directly |
| Extract Class | Unchanged (same fields, just reorganized) | Better locality if fields cluster |
| Replace Method with Method Object | +1 allocation per call (the method object) | Many — phases now individually optimizable |

> **Rule:** the cost of refactoring Bloaters is mostly about *allocation pressure* and *call-site dispatch*. Modern JITs (HotSpot, V8, Go's compiler with PGO) eliminate most of this in hot paths. Cold paths pay the cost but it's negligible.

---

## Long Method and JIT inlining

### HotSpot's inlining rules

The HotSpot JVM aggressively inlines small methods. Key parameters (HotSpot defaults):

- **`MaxInlineSize` = 35** bytes of bytecode. Methods smaller than this are inlined eagerly even when not yet "hot."
- **`FreqInlineSize` = 325** bytes. Hot methods up to this size are inlined.
- **`MaxInlineLevel` = 9** (Java 11+: 15). Maximum nested inlining depth.
- **`InlineSmallCode` = 2000** bytes (compiled native size cap for inlining).

**Implication:** `Extract Method` on a 400-line method into 5 small methods is *free* in hot paths — HotSpot inlines them all back into one giant compiled blob. The bytecode looks split; the machine code looks like the original.

### When extraction *hurts*

Extracted methods stop being inlined when:

- The extracted method's bytecode > `MaxInlineSize` and the method isn't called frequently enough to be classified hot.
- The call site is **megamorphic** (4+ different concrete types), so HotSpot can't predict the target.
- The extracted method calls something else that exceeds inline depth.

Detect with `-XX:+PrintInlining`:

```
@ 12   com.example.Order::computeSubtotal (45 bytes)   inline (hot)
@ 23   com.example.Order::computeDiscount (220 bytes)  too big
@ 34   com.example.Order::computeTax (80 bytes)        callee is too large
```

`too big` and `callee is too large` mean the extraction is *not* free in this hot path.

### Mitigation for hot Long Methods

If a refactor hurts a hot path:

1. **Inline annotations:** `@ForceInline` (HotSpot internal API, available via `--add-exports`); `@inline` in Kotlin and Scala.
2. **Manual fusion:** keep the method long *only in the hottest path*; extract elsewhere.
3. **Compile-time inlining:** Kotlin `inline fun`, Scala `@inline`, GraalVM native-image profile-guided optimization.

### V8 and JavaScript

V8 (Chrome, Node) uses similar logic but inlining limits depend on the optimizer (Maglev, TurboFan):

- TurboFan inlines aggressively across functions; small functions essentially disappear.
- Megamorphic call sites force a deopt — same cost penalty as HotSpot.

### Go inlining

Go's compiler inlines based on **complexity score** (roughly: AST nodes weighted). Functions with score > 80 (default) are not inlined. Inspect with `go build -gcflags='-m'`:

```
./order.go:42:6: cannot inline computeDiscount: function too complex: cost 92 exceeds budget 80
./order.go:55:6: can inline computeSubtotal with cost 28
```

Go's inliner is **less aggressive** than HotSpot — extracted helpers are more likely to remain real calls. This means Long Method refactoring in Go has measurably more cost than in Java for hot paths.

> **Mitigation:** mark hot helpers with the `//go:inline` directive (Go 1.21+) or merge them back during profile-guided builds.

---

## Primitive Obsession: the value-object cost

Replacing `String userId` with `UserId` introduces an object allocation. The cost varies wildly by language and JIT.

### Java — escape analysis

HotSpot's **escape analysis** (EA) detects objects whose lifetime is bounded to a single method. EA can:

1. **Stack allocate** the object (no GC pressure).
2. **Scalar replace** — eliminate the object entirely; treat its fields as separate locals.

A typical `Email` value class used in a hot path is fully scalar-replaced. Result: **zero allocation** at runtime, even though the source code allocates.

```java
final class Email {
    private final String value;
    public Email(String v) { this.value = v; }
    public boolean isInternal() { return value.endsWith("@example.com"); }
}

// In a hot path:
boolean ok = new Email(rawString).isInternal();
// After EA: equivalent to `boolean ok = rawString.endsWith("@example.com");`
// Zero allocation. Verify with -XX:+PrintEscapeAnalysis.
```

**EA fails when:**

- The object escapes to a field, an array, a thread-shared collection, or is returned across method boundaries.
- The method isn't compiled (cold path).
- Polymorphism prevents the JIT from knowing the exact type.

### Java — value classes (Project Valhalla)

Java is gradually adopting **primitive classes** (Project Valhalla, target Java 22+). A primitive class behaves as a flat value:

```java
public primitive class UserId {
    private final long id;
    public UserId(long id) { this.id = id; }
}

// At runtime: laid out flat, no allocation, no header.
// `UserId[]` is a true contiguous array of longs.
```

Until Valhalla ships in your runtime, rely on EA + scalar replacement for the same effect in hot paths.

### Java — records (Java 16+)

`record Email(String value) {}` is a regular class with auto-generated equals/hashCode/toString. No special memory layout — allocation is the same as a normal class. EA still applies.

### Kotlin — inline classes / value classes

Kotlin's `value class` (formerly `inline class`) generates **zero-overhead** wrappers at the bytecode level:

```kotlin
@JvmInline
value class Email(val value: String)

fun process(e: Email) { /* ... */ }
// Compiles to: fun process(e: String) { /* ... */ }
// The Email wrapper is erased; `e` is a String at the JVM level.
```

This is the recommended cure for Primitive Obsession in Kotlin — full type safety, zero runtime cost.

### Go — named types

Go's named types (`type UserID string`, `type Money int64`) are **zero-cost**. They share the underlying memory layout with the base type but are distinct at compile time:

```go
type UserID string

func get(id UserID) {}

func main() {
    var s string = "abc"
    get(s)         // compile error
    get(UserID(s)) // explicit conversion required
}
```

No allocation. No method-call overhead. The conversion is a no-op at runtime.

### Python — overhead

Every Python object has a header (typically 16 bytes on 64-bit CPython for a basic object, more with `__dict__`). Wrapping a `str` email in an `Email` class adds:

- Extra heap allocation (~50 bytes for a small object).
- Attribute lookup overhead on every access.

Mitigations:

- `@dataclass(frozen=True, slots=True)` — `slots=True` removes `__dict__`, halving the per-instance memory.
- For very hot paths, consider PyPy (JIT) or just keep the primitive.

### Go — escape analysis

Go's escape analysis decides whether a value lives on the stack or the heap. A value object that doesn't escape stays on the stack — zero GC cost.

```go
type Email struct{ value string }

func process(raw string) bool {
    e := Email{value: raw}
    return strings.HasSuffix(e.value, "@example.com")
    // `e` does not escape — stack allocated.
}
```

Verify with `go build -gcflags='-m'`:

```
./email.go:5:7: e does not escape
```

### Allocation cost summary

| Language | Cost of value-object cure | Mitigation |
|---|---|---|
| Java (HotSpot 17+) | ~0 in hot paths (EA + scalar replacement) | Use `final` fields; avoid storing in fields |
| Java (Valhalla, Java 22+) | 0 with `primitive class` | Native value semantics |
| Kotlin | 0 with `value class` | First-class language feature |
| Go | 0 with named types; ~0 with structs that don't escape | Inspect with `gcflags='-m'` |
| Python | ~50 bytes/instance | `@dataclass(slots=True)`; PyPy |
| Rust | 0 with `newtype` (`struct Email(String)`) | Native zero-cost abstraction |
| TypeScript | 0 with branded types (compile-time only) | `type Email = string & { __brand: 'Email' }` |

---

## Long Parameter List and calling conventions

### Register vs. stack passing

Most modern ABIs (System V AMD64, AArch64, ARM64) pass the first 4–8 parameters in **registers**; subsequent ones go on the **stack**.

| ABI | Integer/pointer registers | Float registers |
|---|---|---|
| System V AMD64 (Linux/macOS) | rdi, rsi, rdx, rcx, r8, r9 (6) | xmm0–xmm7 (8) |
| Windows x64 | rcx, rdx, r8, r9 (4) | xmm0–xmm3 (4) |
| AArch64 (ARM64) | x0–x7 (8) | v0–v7 (8) |

A method with 4 parameters is faster than a method with 12 in a tight loop — not because of parameter validation, but because parameters 5+ get pushed/popped on every call.

### Parameter object: same cost or better?

A single `ReportRequest` parameter passes one pointer (8 bytes on 64-bit) regardless of how many fields the request contains. Even if the parameter object has 14 fields, the call site passes one register's worth.

The trade-off:
- **Saves:** 13 register-passes per call.
- **Adds:** 1 dereference per field access inside the callee.

In hot inner loops with simple field types, this is a wash. In typical business code, the parameter object is *faster* because of better cache locality.

### Boxing in JVM

If the original 12-parameter method passed `Integer`, `Long`, `Double` boxed objects, replacing them with a parameter object can **eliminate boxing** if the parameter object uses primitive fields. The parameter object becomes a single allocation; the original was 12.

---

## Large Class and cache locality

### Cache lines and field layout

A typical cache line is 64 bytes. A class with 30 fields occupies ~240+ bytes (assuming each field is 8 bytes plus a 16-byte header). That's **4 cache lines**.

If a method only touches fields A, B, C (12 bytes total), the CPU still loads the whole cache line containing A. If A, B, C are interspersed across multiple cache lines, the method causes 3 cache-line loads instead of 1.

**Fix via Extract Class:** group co-accessed fields into a sub-object. The sub-object lives in fewer cache lines.

### False sharing

If two threads access different fields of the same class concurrently, and those fields share a cache line, every write invalidates the other thread's view. This is **false sharing** — a major performance problem.

Mitigations:
- `@Contended` annotation in Java (`sun.misc.Contended` in Java 8, `jdk.internal.vm.annotation.Contended` in Java 9+).
- Manual padding (`long pad1, pad2, pad3, pad4, pad5, pad6, pad7`).
- Extract Class so that contended fields live in different objects.

A Large Class is *more vulnerable* to false sharing because it has more concurrently-accessed fields packed into close memory.

### JOL (Java Object Layout)

Inspect actual layout with [JOL](https://openjdk.org/projects/code-tools/jol/):

```
java -jar jol-cli.jar internals com.example.Customer
```

```
com.example.Customer object internals:
 OFFSET  SIZE                TYPE DESCRIPTION       VALUE
      0    12                     (object header)
     12     4                int  age              0
     16     8               long  customerId       0
     24     4   java.lang.String  email            null
     ...
```

Use this to verify that Extract Class actually reduced the per-instance footprint.

---

## Data Clumps and struct layout

### Packing in Go and C

A data clump expressed as a `struct` is laid out contiguously in memory:

```go
type Address struct {
    Street string  // 16 bytes (pointer + length on 64-bit)
    City   string  // 16
    State  string  // 16
    Zip    string  // 16
    Country string // 16
}
// Total: 80 bytes, contiguous.
```

When a method takes an `Address`, all fields are in the same cache lines. When the same fields were 5 separate parameters, they came from various locations in the caller's stack/registers.

**Result:** in a tight loop iterating over many addresses, `[]Address` outperforms 5 parallel `[]string` slices because of locality.

### Field reordering for size

Go and C don't reorder fields automatically — declaration order is layout order. Padding is inserted to satisfy alignment.

Bad layout:
```go
type Bad struct {
    Flag    bool   // 1 byte + 7 bytes padding (alignment for int64)
    Counter int64  // 8 bytes
    Active  bool   // 1 byte + 7 bytes padding (alignment at end)
}
// Total: 24 bytes
```

Better:
```go
type Good struct {
    Counter int64  // 8 bytes
    Flag    bool   // 1 byte
    Active  bool   // 1 byte + 6 bytes padding
}
// Total: 16 bytes
```

When refactoring Data Clumps in Go, sort fields **largest to smallest** to minimize padding. Tools: `fieldalignment` (`golang.org/x/tools/go/analysis/passes/fieldalignment`).

### Java field layout

JVM lays out fields by JVM internal logic — typically `long`/`double` first, then references, then `int`/`float`, then `short`/`char`, then `byte`/`boolean`. You cannot directly control layout (without `@Contended` or special tooling). This usually produces a near-optimal layout automatically.

---

## Microbenchmarks and methodology

### JMH (Java)

Standard tool for JVM benchmarks. Skeleton for benchmarking value-object overhead:

```java
@State(Scope.Benchmark)
public class EmailBench {
    String raw = "user@example.com";
    
    @Benchmark
    public boolean primitive() {
        return raw.endsWith("@example.com");
    }
    
    @Benchmark
    public boolean valueObject() {
        return new Email(raw).isInternal();
    }
}
```

Run with `-prof gc` to see allocation rate. With escape analysis, both should show ~0 allocation in `valueObject`.

### `testing.B` (Go)

```go
func BenchmarkPrimitive(b *testing.B) {
    raw := "user@example.com"
    for b.Loop() {
        _ = strings.HasSuffix(raw, "@example.com")
    }
}

func BenchmarkValueObject(b *testing.B) {
    raw := "user@example.com"
    for b.Loop() {
        _ = NewEmail(raw).IsInternal()
    }
}
```

Run with `go test -bench=. -benchmem` to see allocations per op.

### `pyperf` / `pytest-benchmark` (Python)

Python doesn't have a JIT in CPython, so the cost is *not* dominated by allocation — it's dominated by attribute lookups. Use `dis` to compare:

```python
import dis
dis.dis(lambda: raw.endswith("@example.com"))
dis.dis(lambda: Email(raw).is_internal())
```

The wrapped version has ~3× more bytecode ops in CPython.

### Pitfalls

- **Dead code elimination:** if you don't consume the result, the JIT/compiler may delete the work.
- **Warm-up:** JIT-based runtimes need warm-up iterations before the JIT compiles the hot path. JMH handles this; manual benchmarks often don't.
- **Single-thread bias:** measurements taken on a single core ignore cache contention that appears in production multi-threading.

---

## Cross-language cost comparison

A canonical operation: "validate and store 1 million emails."

| Language | Primitive impl | Value-object impl | Overhead |
|---|---|---|---|
| Java 17 (HotSpot) | 22 ms | 23 ms | ~5% (EA scalar replaces) |
| Java 22 (Valhalla preview) | 22 ms | 22 ms | 0% (true value type) |
| Kotlin (`value class`) | 22 ms | 22 ms | 0% (compile-time erased) |
| Go 1.22 | 18 ms | 18 ms | 0% (named type, zero-cost) |
| Rust | 12 ms | 12 ms | 0% (`newtype` zero-cost) |
| Python 3.12 | 480 ms | 720 ms | ~50% (real allocation cost) |
| Python 3.12 + `slots=True` | 480 ms | 600 ms | ~25% |
| TypeScript (Node 20) | 35 ms | 35 ms | 0% (branded type, compile-only) |

**Takeaway:** in JVM and Go, value-object refactoring is essentially free. In Python, it has measurable cost — usually still worth paying, but verify in hot paths.

---

## Profiling for Bloater detection

### Async-profiler (JVM)

Generates flame graphs showing where time is spent. A Long Method shows up as a wide flame; extracting reveals which sub-phase actually dominates.

```bash
async-profiler -d 60 -f profile.html <pid>
```

### perf (Linux)

System-wide profiling. Useful for identifying hot Long Methods at machine-code granularity:

```bash
perf record -g ./my-app
perf report
```

### pprof (Go)

```go
import _ "net/http/pprof"

// Then:
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30
```

The flame graph reveals which functions are hot — and which extracted helpers were never called (dead code, candidate for deletion).

### `py-spy` (Python)

Sampling profiler that doesn't require code modifications:

```bash
py-spy record -o profile.svg --pid <pid>
```

Reveals attribute-lookup hotspots — common when Primitive Obsession was applied carelessly.

---

## Review questions

1. **A team replaces `String userId` with `UserId` value object. Latency increases 3% on a hot path. Diagnosis?**
   Likely escape analysis failed — `UserId` is escaping (stored in a field, returned across methods, or used in a polymorphic call site). Verify with `-XX:+PrintEscapeAnalysis` (HotSpot) or `gcflags='-m'` (Go). Fix: keep `UserId` constructions local; if it must be stored, accept the cost or use Kotlin/Valhalla.

2. **`@JvmInline value class` in Kotlin — when does it leak as a real allocation?**
   When the value class is used in a context requiring a boxed reference: nullable types (`UserId?`), generic parameters (`List<UserId>`), or interfaces. The JVM has no representation for "nullable inline value," so it boxes. Java code interoperability also boxes.

3. **Why does Extract Method on a 200-line method *sometimes* hurt JIT performance?**
   Extracted methods that exceed `MaxInlineSize` (35 bytes) and aren't hot enough for `FreqInlineSize` won't be inlined. The original 200-line method was a single compilation unit; the split version has un-inlined call boundaries. Detect with `-XX:+PrintInlining`. Fix: keep extracted helpers small enough, or merge back in hot paths only.

4. **Why is `[]Address` faster than 5 parallel `[]string` slices in Go?**
   Cache locality. `[]Address` is a contiguous block of `Address` values, each holding all 5 fields. Iterating accesses each address's fields from the same cache line. With 5 parallel slices, the CPU loads from 5 separate memory regions per element, multiplying cache misses.

5. **A 50-field god class shows high garbage collection pressure. Refactor strategy?**
   The fields themselves don't cause GC pressure (they're already allocated). What causes pressure is short-lived methods on the class that allocate. Profile allocations (JFR / async-profiler `-e alloc`); split out the high-allocating methods first. Extract Class on the rest improves locality but doesn't directly help GC.

6. **Cognitive complexity says a method has score 25; cyclomatic says 8. Which to trust for performance?**
   Neither is a performance metric. Both are maintainability metrics. For *performance*, look at the method's bytecode size and call frequency — that determines JIT inlining behavior. Cognitive complexity correlates loosely with size, but the right tool for performance is a profiler.

7. **Why is Python's `@dataclass(slots=True)` important for value-object refactoring?**
   Without `slots`, every dataclass instance has a `__dict__` for arbitrary attribute storage. That's roughly 50 extra bytes per instance and a hash-table lookup per attribute access. `slots=True` declares the fields explicitly; the instance stores them in fixed offsets like a C struct. Memory and access cost both drop ~50%.

8. **A method takes 20 parameters; a colleague proposes a `varargs Object[]` to avoid the smell. Why is this worse?**
   `Object[]` defeats type checking, forces boxing for primitives, allocates an array per call (+ potentially for each boxed value), and hides the smell — readers can't tell what to pass without finding the implementation. Three regressions for zero gain. The right cure is parameter object.

9. **In a Spring Boot app, you Extract Method on a controller method. Latency drops 5%. Plausible?**
   Yes, indirectly. The original method may have been too large for HotSpot to compile to C2 (`-XX:CompileCommand=print`); extraction may have made each piece compilable. Or the original had cold conditional branches that polluted profile data; extraction lets the JIT specialize the hot path. Verify with JFR's "JIT Compilation" view.

10. **A profiler shows 3% CPU in `Email.<init>` constructor. Refactor or leave?**
    Investigate first. 3% in a constructor often means the constructor is doing real work (validation, regex). Two cures: (a) cache validated emails (a small LRU); (b) move expensive validation out of the hot path. Removing the value object to "save" 3% sacrifices type safety for a small win — usually wrong unless the path is in the absolute critical-tens-of-ns budget.

---

> **Next:** [interview.md](interview.md) — 50+ Q&A across all levels for interview prep.
