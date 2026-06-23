# Profile-Guided Optimization (PGO) — Optimize

## 1. Goal of this file

This file is about **extracting more from PGO** than the default 2–5 % most teams get. The premise: you already have a working PGO pipeline; you want to push the gain to the higher end of the 5–10 % range. The levers are:

1. Make the profile more representative.
2. Make the workload more PGO-friendly.
3. Pair PGO with complementary build flags.
4. Audit the resulting binary to confirm the wins happened where you expected.

---

## 2. Representativeness: the dominant factor

Almost all "PGO gave me 1 %" stories trace back to the profile not matching the workload. Steps to fix:

| Step | Why |
|------|-----|
| Capture at **peak hour** | Hot paths at peak differ from those at 03:00 |
| Capture for **≥ 60 seconds** | < 30 s misses tail behavior |
| Capture from **multiple pods** and merge | Single pod is noisy; one slow client can skew |
| Exclude **deploy/restart window** | Init code is not your steady-state path |
| Re-capture after **major refactors** | Stale profile leaves money on the table |

Combine all five: aggregated, peak-hour, steady-state, post-warmup profile from many instances. This is the configuration the Go team's PGO documentation effectively recommends.

---

## 3. Sample count is what makes the profile stable

The compiler uses sample counts. A profile with 50 samples is statistically noisy; a profile with 50 000 samples is stable.

| Capture window | Approx samples (single pod) | Stability |
|----------------|----------------------------|-----------|
| 10 s | ~1 000 | Very noisy |
| 30 s | ~3 000 | Noisy |
| 60 s | ~6 000 | Useable |
| 5 min | ~30 000 | Stable |
| 5 pods × 60 s merged | ~30 000 | Stable |

Aim for **30 000+ aggregated samples**. Below that, you may see inline decisions flip between profile refreshes for non-reasons.

---

## 4. Workload-side optimization: write PGO-friendly code

Some code patterns offer more for PGO to optimize than others. To maximize gains:

| Pattern | Why PGO helps |
|---------|---------------|
| Interface call with one dominant implementation | Devirtualization opportunity |
| Small accessor functions called millions of times | Inlining frees up time |
| Hot loops calling stable utility functions | Cross-package inlining |
| Generic functions with one heavy instantiation | Per-instantiation inlining |

Anti-patterns where PGO has nothing to do:

| Pattern | Why PGO doesn't help |
|---------|---------------------|
| cgo-bound hot path | C code not compiled by Go |
| Reflection-based dispatch (`reflect.Call`) | Not statically resolvable |
| Plugin / shared-library code | Different compilation unit |
| Allocation-bound (GC-dominated) | GC is unaffected by PGO |
| Already monomorphic, single function | Nothing to specialize |

If your hot path falls in the right column, PGO will tell you so by giving you 0 %. Move on to other optimizations (allocation reduction, SIMD via `golang.org/x/sys`, syscalls).

---

## 5. Devirtualization wins: how to set them up

Devirtualization is the highest-leverage PGO mechanism. Set up your code so it can fire:

```go
// Good for PGO: one dominant impl at runtime
type Cache interface { Get(string) []byte }

func handle(c Cache, k string) []byte {
    return c.Get(k)
}

// At runtime: 95% of calls pass *RedisCache → PGO devirtualizes
```

Anti-pattern:

```go
// Bad for PGO: roughly equal mix of three impls
// → compiler will not devirtualize
```

If you have legitimate polymorphism (multiple impls used roughly equally), PGO can't help that call site. Consider whether a generic function or a switch over a typed enum would let you avoid the interface entirely.

---

## 6. The interplay with `-gcflags`

`-gcflags` and `-pgo` are independent but interact.

| Flag combo | Effect |
|------------|--------|
| `-pgo=auto` (default) | PGO applies; inlining active |
| `-pgo=auto -gcflags="-l"` | Inlining off; PGO mostly inert |
| `-pgo=auto -gcflags="all=-N -l"` | Both inlining and optimization off; PGO inert. Debug only. |
| `-pgo=auto -gcflags="-m=2"` | PGO applies; you see inline decisions in stderr |
| `-pgo=auto -gcflags="-d=pgodebug=1"` | PGO applies; compiler prints debug info about PGO choices |

For audit work:

```bash
go build -pgo=auto -gcflags='-m=2 -d=pgodebug=1' ./cmd/myapp 2> pgo-trace.txt
```

`pgodebug=1` makes the compiler list every site where PGO made a decision: budget increases, devirtualization choices, etc.

---

## 7. Pairing PGO with bench-driven optimization

PGO is not a substitute for hand optimization; it is a multiplier. The workflow:

1. Profile and bench the service as-is.
2. Find the top three CPU hot spots.
3. Hand-optimize each (allocation reduction, algorithm change, sync.Pool, etc.).
4. Re-bench, confirm wins.
5. *Then* enable PGO.

PGO on top of hand-tuned code typically yields the higher end of the gain range (7–10 %). PGO on top of un-optimized code is muddled by larger inefficiencies and looks smaller (2–4 %).

Order matters: optimize first, PGO last.

---

## 8. Generic instantiation effects

Generic functions are instantiated per type-arg combination. Each instantiation is a distinct symbol from PGO's perspective.

```go
func Encode[T any](v T) []byte { ... }

// At runtime: Encode[User] is hot, Encode[Order] is cold, Encode[int] is unused.
// PGO will inline Encode[User] aggressively, leave the others alone.
```

To benefit:

- Capture a profile **after** you have a stable set of instantiations.
- If you add a hot instantiation later, refresh the profile.

If you have many cold instantiations and one hot one, your binary doesn't bloat unfairly: PGO budget increases apply only to the hot instantiation.

---

## 9. PGO + `-buildmode` choices

| `-buildmode` | PGO support |
|--------------|-------------|
| `default` (exe) | Yes |
| `pie` | Yes |
| `c-archive` / `c-shared` | Yes for the Go side |
| `plugin` | Yes for the plugin; profile must come from the host process running the plugin |
| `shared` | Yes |

The interesting case is plugins: a profile captured from a host that loads many plugins can still drive optimization of each plugin independently, but you need the captured stacks to actually enter the plugin code paths.

---

## 10. Auditing the result

After enabling PGO, prove the wins happened where you expected.

### 10.1 List inlined functions

```bash
go build -gcflags='-m=2' -pgo=off  ./cmd/myapp 2>off.txt
go build -gcflags='-m=2' -pgo=auto ./cmd/myapp 2>on.txt
diff <(grep "can inline" off.txt | sort) <(grep "can inline" on.txt | sort) | head -50
```

You should see the hot functions in the diff (in the `auto` set, not the `off` set).

### 10.2 Look at machine code

```bash
go tool objdump -s 'myapp/internal/hot.Process' ./bin/myapp | head -40
```

If `Process` was small and hot, you may not even find it in `objdump` — it has been inlined into all its callers.

### 10.3 PGO debug log

```bash
go build -gcflags='-d=pgodebug=1' -pgo=auto ./cmd/myapp 2>pgo.log
grep -E '(inlining|devirtualizing)' pgo.log | head
```

You see lines like:

```
pgo: inlining call to hot.Process at hot/handler.go:42
pgo: devirtualizing iface call to (*Cache).Get at hot/lookup.go:18
```

That's the smoking gun — PGO actually fired on the sites you cared about.

---

## 11. Binary-size budget

PGO grows the binary modestly. Track:

```bash
ls -l ./bin/myapp.no-pgo ./bin/myapp.pgo
go tool nm -size -sort=size ./bin/myapp.pgo | head -20
```

Expected delta: +1 to +3 %. Anomalies:

| Delta | Interpretation |
|-------|----------------|
| < 1 % growth | Inlining had little to do (small wins) |
| 1–3 % growth | Typical, healthy |
| 3–10 % growth | Aggressive inlining; usually OK |
| > 10 % growth | Profile likely too narrow (over-fitted to one path) |

If size growth is large, capture a broader profile (longer window, more pods).

---

## 12. Combining with `GOAMD64=v3` and friends

For latest-generation CPUs, the microarchitecture level matters too.

```bash
GOAMD64=v3 go build -pgo=auto ./cmd/myapp
```

PGO and `GOAMD64` are orthogonal: PGO picks which functions to inline; `GOAMD64` picks which instructions to emit (BMI2, AVX-class). Compose freely. Combined gain is usually additive.

For ARM: `GOARM64=v8.1` and similar.

---

## 13. Continuous A/B in production

The mature setup: a small fraction of pods always run `-pgo=off` as a control. Compare their CPU/latency to PGO pods continuously.

```yaml
# 95% pods: pgo-on
# 5% pods: pgo-off (control)
```

Prometheus diff query:

```promql
avg(rate(container_cpu_usage_seconds_total{pgo="on"}[5m]))
  /
avg(rate(container_cpu_usage_seconds_total{pgo="off"}[5m]))
```

A value steadily below 1.0 (e.g., 0.94) shows PGO saving ~6 % CPU on live traffic. Continuous proof, not a one-shot benchmark.

---

## 14. Edge cases that erode gain

| Pattern | Erosion |
|---------|---------|
| Service shifted from interface dispatch to generics | Devirtualization wins disappear; reconsider |
| Recent refactor removed several hot functions | Profile partially stale; refresh |
| New feature added a parallel cold code path | Compiler spends inline budget on cold code |
| GC pressure increased substantially | PGO % shrinks even though absolute time saved is constant |

When measured gain slips, walk through this list before assuming PGO is broken.

---

## 15. Summary

Maximum PGO gain comes from (a) a representative profile (peak hour, aggregated, 30 000+ samples), (b) PGO-friendly code patterns (single-impl interfaces, small hot functions, generics with one hot instantiation), (c) avoiding patterns PGO cannot help (cgo, reflection, GC-bound), (d) pairing PGO with hand optimization in the right order, (e) auditing the result with `-gcflags='-m=2 -d=pgodebug=1'`. Expect 1–3 % binary size growth and 5–10 % CPU savings on a well-suited workload.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- `pgodebug` flag: search for `pgodebug` in https://github.com/golang/go/tree/master/src/cmd/compile/internal/pgo
- Devirtualization design: https://go.googlesource.com/proposal/+/master/design/55022-pgo-implementation.md
- Continuous profiling for PGO: https://www.polarsignals.com
- `GOAMD64` levels: https://github.com/golang/go/wiki/MinimumRequirements#amd64
