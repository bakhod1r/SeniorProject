## `//go:linkname` Directive — Optimization

## 1. Why developers reach for linkname

The directive is almost always chosen for one of four reasons. Each has a more boring, more stable alternative that should be tried first.

| Motivation | Typical target | Better alternative |
|------------|----------------|--------------------|
| Avoid the cost of a public-API wrapper | `runtime.nanotime` | `time.Since(t)` — already monotonic since Go 1.9 |
| Get a very cheap random number | `runtime.fastrand` | `math/rand/v2` (Go 1.22+) is comparably fast |
| Avoid a mutex's full sync code path | `sync.runtime_Semacquire` | `sync.Mutex` — already calls this internally |
| Read runtime state for diagnostics | `runtime.activeModules`, `runtime.gcController` | `runtime/metrics` (Go 1.16+) exposes most of this |

Before any micro-optimization through `//go:linkname`, benchmark against the alternative. The performance gap is usually small enough that the maintenance cost wipes it out over a single Go release cycle.

---

## 2. The real cost of "going through the front door"

A common claim: "calling `time.Now().UnixNano()` is too slow; I need `runtime.nanotime`."

Let's check.

```go
func BenchmarkTimeNow(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = time.Now().UnixNano()
    }
}

import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

func BenchmarkRuntimeNano(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = runtimeNano()
    }
}
```

Typical results on an Apple M-series, Go 1.22:

```
BenchmarkTimeNow-10           53.2 ns/op
BenchmarkRuntimeNano-10        7.8 ns/op
```

The linkname version is roughly 7× faster. **But the absolute cost of `time.Now()` is still 53 nanoseconds**. If you call it once per HTTP request, the difference is unmeasurable. If you call it a billion times in a tight inner loop, the difference is 45 seconds — measurable but still small in most production contexts.

The optimization is real when:
- You are in a profiler hot path that calls it many millions of times.
- The function is on a critical-latency path where every nanosecond matters (HFT, networking).
- You have already optimized everything else.

Otherwise the optimization is theatrical.

---

## 3. `runtime.fastrand` and the random-number question

Pre-Go 1.22 the canonical cheap random was:

```go
import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

This is a per-P PRNG (Wyrand/xorshift family). It is non-cryptographic, very fast, and has no central state. Typical performance: ~1 ns/call.

The official replacement, `math/rand/v2` (Go 1.22+), uses a similar algorithm with public API:

```go
import "math/rand/v2"

func cheapRand() uint32 { return rand.Uint32() }
```

Benchmarks across Go 1.22+:

```
BenchmarkFastrand-10           1.05 ns/op
BenchmarkRandV2Uint32-10       1.18 ns/op
BenchmarkRandV1Int63-10       18.40 ns/op   // v1, with global mutex
```

`math/rand/v2` is within 15% of the linkname version. The v1 difference was real; the v2 difference is noise for most workloads. There is essentially no remaining reason to reach for `runtime.fastrand` on Go 1.22+.

If you still need it (pre-1.22 codebase, build-tag-gated):

```go
//go:build !go1.22

import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() uint32

func cheapRand() uint32 { return fastrand() }
```

```go
//go:build go1.22

import "math/rand/v2"

func cheapRand() uint32 { return rand.Uint32() }
```

This pattern — linkname for older Go, public API for newer — is the most defensible production use of the directive.

---

## 4. Mutex internals — what `sync.Mutex` already does

Many "I need a fast mutex" attempts end up reimplementing what `sync.Mutex` already does internally. The mutex's slow path goes:

```
sync.Mutex.Lock
  → runtime_SemacquireMutex (via //go:linkname)
    → runtime semaphore code
      → goroutine park
```

If you wrap your own `//go:linkname runtime_SemacquireMutex` you are not saving anything; you are reproducing the same call chain with more lines of code and more maintenance burden.

The places where a custom synchronization primitive is faster than `sync.Mutex`:

- Spinlocks for very short critical sections on dedicated cores.
- Lock-free data structures using `atomic.Pointer[T]`.
- Bounded queues using `chan` with the runtime's already-optimized scheduling.

None of these require `//go:linkname`. `atomic.Pointer[T]` (Go 1.19+) and the runtime's existing channel implementation cover most of the design space.

---

## 5. Inlining: linkname kills it

A `//go:linkname` declaration has no Go body in your package. The compiler therefore cannot inline the call.

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

func hot() int64 { return runtimeNano() }   // never inlines
```

Compare with calling a small Go function:

```go
func nanoWrap() int64 { return time.Now().UnixNano() }

func hot() int64 { return nanoWrap() }      // nanoWrap may inline; UnixNano may inline
```

Inlining matters in the same loops where you were considering the linkname for speed. If the loop body is small enough that a 50 ns function call dominates, then the 5-10 ns of call overhead the compiler could have inlined away might also matter. Linkname forecloses that optimization.

To check:

```bash
go build -gcflags="-m=2" 2>&1 | grep -E '(inline|nanotime)'
```

---

## 6. The `//go:noescape` companion

When linking to a function that takes pointer arguments, the compiler conservatively assumes the function lets those pointers escape. Adding `//go:noescape` overrides that assumption:

```go
import (
    _ "unsafe"
    "unsafe"
)

//go:noescape
//go:linkname memmove runtime.memmove
func memmove(dst, src unsafe.Pointer, n uintptr)
```

Without `//go:noescape`, any caller passing a stack-local pointer to `memmove` would have that local moved to the heap by escape analysis. With it, the local stays on the stack.

You must be **certain** the linked function actually does not retain its arguments. For runtime utility functions like `memmove`, that is a safe assumption. For higher-level functions, read the runtime source first.

---

## 7. Quantifying the upside — a checklist

Before adding a `//go:linkname` for performance, confirm:

| Step | Result |
|------|--------|
| Profile shows the public-API call is in the top three CPU consumers | Yes |
| Benchmark of the public API vs the linkname target shows ≥ 2× speedup | Yes |
| The benchmarked speedup represents > 1% of total program CPU | Yes |
| The linkname target exists in every Go version the project supports | Yes |
| The signature has been stable for the last three Go releases | Yes |
| A fallback path exists for Go versions where the linkname is unavailable | Yes |

If any answer is "no", the directive is the wrong optimization. Try the public API, profile again, and look elsewhere.

---

## 8. Cases where the perf is real

A non-exhaustive list of cases where `//go:linkname` produces a meaningful, measurable optimization:

| Use | Why measurable |
|-----|----------------|
| `runtime.nanotime` inside a profiler sampling routine | Called per stack sample at hundreds of kHz |
| `runtime.memmove` via `//go:noescape` for cgo data copying | Avoids heap allocation per call |
| `runtime.activeModules` for stack-walking debuggers | The runtime offers no public equivalent |
| `runtime.startNanoTime` for wall-clock-to-monotonic conversion | Needed for timestamp normalization in tracing |

Note that all of these are tooling and observability, not application logic. Application logic is almost never the right place for linkname-driven optimization.

---

## 9. Comparison with cgo

For raw performance, `cgo` is **slower** than a linkname into the runtime:

| Mechanism | Per-call overhead |
|-----------|-------------------|
| `//go:linkname` into runtime | 1–5 ns (just the function call) |
| Normal Go function call | 1–3 ns (often inlined to 0) |
| `cgo` call | 80–200 ns (stack swap, goroutine binding) |

So `//go:linkname` is fast for the same reason normal Go calls are fast — it stays inside the Go runtime's calling convention. `cgo` crosses the boundary, which is the expensive part.

If you are choosing between `cgo` and `//go:linkname` for performance, the linkname wins on speed but loses on stability. If you can avoid both via a public Go API, do that.

---

## 10. Optimization without linkname

Often what looks like a need for linkname is solved by a different optimization entirely:

- **Cache the result.** If you are reading `runtime.nanotime` repeatedly inside the same operation, read it once and pass it around.
- **Batch the work.** A single call per batch beats many small calls regardless of the per-call cost.
- **Use `sync.Pool`.** Allocation churn often dominates the time you thought was a function-call cost.
- **Avoid the hot path.** Move expensive work behind a `sync.Once` or a startup phase.
- **Compile the right `GOARCH`.** Sometimes the "slowness" is an unrelated `GOAMD64=v1` baseline that `GOAMD64=v3` fixes.

Each of these tends to produce larger speedups than `//go:linkname`, with none of the stability cost.

---

## 11. Measuring before and after

The minimum-credibility benchmark for a linkname optimization:

```bash
go test -bench=. -benchmem -count=10 -run=^$ ./... > old.txt
# apply the linkname change
go test -bench=. -benchmem -count=10 -run=^$ ./... > new.txt
benchstat old.txt new.txt
```

`benchstat` reports geomean differences with statistical significance. Anything under p < 0.05 with at least 5% improvement is plausible; anything else is noise. Many "optimizations" disappear under `benchstat`.

For end-to-end checks, also profile under `pprof` and confirm the linkname-driven function moves down the CPU chart. If it does not, the optimization did not affect what you thought it affected.

---

## 12. Summary

`//go:linkname` is a performance optimization with a long tail of maintenance cost. The functions people most commonly want — fast monotonic time, fast random, mutex internals — are either accessible via stable public APIs (`time.Since`, `math/rand/v2`, `sync.Mutex`) or are already what the standard library calls under the hood. Reach for the directive only after benchmarking confirms a real, sustained gap; gate it behind build tags; pair it with `//go:noescape` where applicable; and write the migration plan to the public API at the same time. Optimization without measurement is decoration; with measurement, linkname is sometimes the right answer in tooling and observability hot paths, rarely in application logic.

---

## Further reading
- `time` package monotonic clock notes: https://pkg.go.dev/time#hdr-Monotonic_Clocks
- `math/rand/v2`: https://pkg.go.dev/math/rand/v2
- `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
