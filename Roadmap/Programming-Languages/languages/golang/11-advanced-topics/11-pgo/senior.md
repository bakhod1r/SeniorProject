# Profile-Guided Optimization (PGO) — Senior

## 1. The mental model

PGO is not magic; it is the compiler making a few specific, well-defined decisions differently because it has a measured workload to optimize for. To use it effectively, you should be able to describe in one paragraph *exactly* what the compiler does with the profile.

> The compiler aggregates the CPU samples per function and per call edge. For each call site, it asks: "is this site hot enough that inlining the callee would pay for the code-size growth?" Without a profile, the answer is a fixed budget heuristic. With a profile, the answer is "yes if the site's sample share exceeds a small threshold." Separately, for each interface call site, the compiler asks: "does one concrete type dominate?" If yes, it speculatively devirtualizes the call. Inlining and devirtualization together account for most of PGO's measured gains.

Everything else — block ordering, register hints, hot/cold split — is secondary in current Go versions.

---

## 2. Function-level hotness, edge profile

The compiler builds two views from the profile:

| View | What it answers |
|------|-----------------|
| **Function hotness** | What fraction of total samples landed inside function F? |
| **Edge profile** | What fraction of samples taken inside F came from a call by site S? |

Function hotness drives the "is this worth inlining at all" decision. Edge profile drives the per-site decision — `funcA` may be very hot overall but called from twenty sites, none of which alone justifies the inline. Conversely, `funcB` may be cold overall but hot from one site.

Edge profile is also what enables devirtualization: the compiler needs to know which concrete type was dispatched at each interface call site, which it derives from the sample stacks.

---

## 3. Inlining beyond the budget

Without PGO, the inliner has a numeric budget (roughly proportional to function size). Functions over the budget are not inlined.

With PGO, the budget for *hot* call sites is multiplied. The current implementation roughly doubles the budget for sites in the top percentile of edge hotness. This unlocks inlining of larger functions that the heuristic alone would reject.

Net effect on binary size: 1–3 % growth is typical. If you see > 10 % growth, your profile may be over-aggressive (too many "hot" sites because the workload is too narrow).

---

## 4. Devirtualization: real-world picture

Devirtualization is where the headline numbers come from for interface-heavy code. Consider:

```go
type Storage interface {
    Get(key string) ([]byte, error)
}

func handle(s Storage, k string) []byte {
    v, _ := s.Get(k)
    return v
}
```

If 95 % of `handle` calls in production pass a `*RedisStorage`, the compiler emits:

```
if rs, ok := s.(*RedisStorage); ok {
    rs.Get(k)            // direct, inlinable
} else {
    s.Get(k)             // fallback
}
```

The direct branch can now be inlined, the interface dispatch (an itab lookup plus indirect call) is replaced by a type-tag check on the common path. The cost on the cold branch is one extra type check.

If two types share the hot path 60/40, the compiler will not devirtualize: the type-check failure rate would be high enough to eat the benefit.

---

## 5. Profile representativeness — the central concern

The single most common mistake with PGO is feeding the compiler a profile that doesn't reflect production. Three failure modes:

1. **Profile from a microbenchmark.** A benchmark inflates one function's share of samples to ~100 %, leading the compiler to inline it absurdly and starve everything else. The resulting binary may run slower on real traffic.
2. **Profile from startup.** A 5-second capture immediately after process start measures init code, not steady-state. Hot init paths get inlined, real hot paths don't.
3. **Profile from a different region/tier.** EU traffic at 02:00 has a different mix from US traffic at 14:00. A profile from one applied to the other can give you a small loss instead of a small win.

Industry guidance: capture from real traffic, at peak hours, for at least 30–60 seconds, ideally aggregated across multiple instances and merged.

---

## 6. Multiple binaries, multiple profiles

A monorepo with `cmd/api`, `cmd/worker`, `cmd/cli` needs **three** profiles. Each binary has its own call graph and hotness distribution.

```
cmd/api/default.pgo       (from prod API traffic)
cmd/worker/default.pgo    (from worker job execution)
cmd/cli/default.pgo       (from typical CLI invocations, or omit)
```

For the CLI, often the cost-benefit doesn't favor PGO at all — its CPU profile is dominated by startup and argument parsing. Omit `default.pgo` for that binary; `-pgo=auto` will simply build without PGO.

---

## 7. Multiple deployment regions

If you operate in `us-east`, `eu-west`, `ap-south`, do you ship one binary or three?

Most teams ship one. The profile differences across regions are usually smaller than the noise. The practical recipe:

1. Capture profiles from each region.
2. Merge with `go tool pprof -proto a.pgo b.pgo c.pgo > merged.pgo`.
3. Use the merged profile.

You lose the very last sliver of region-specific optimization but get one binary to QA and ship. The trade is almost always worth it.

If a single region runs a wildly different workload (e.g., one region is your batch-only deployment), give it its own profile and its own build pipeline.

---

## 8. Generic instantiations and PGO

Generic functions are instantiated per type-argument combination. PGO sees each instantiation as a distinct function:

```go
func Sum[T int | float64](xs []T) T { ... }

// Compiler-level: Sum[int] and Sum[float64] are separate symbols.
```

If your profile shows `Sum[int]` is hot but `Sum[float64]` is cold, PGO inlines the `int` one aggressively and leaves the other alone. This is correct and usually desirable.

The implication: if you add a new instantiation between profile capture and build, the new instantiation falls back to default heuristics. Usually not a problem; occasionally noticeable.

---

## 9. PGO interactions with other build flags

| Flag | Interaction |
|------|-------------|
| `-gcflags="all=-N -l"` (debug) | Disables inlining; PGO has no effect |
| `-gcflags="-l"` (no inline) | PGO mostly disabled (inline is the main lever) |
| `-trimpath` | No interaction; safe and recommended |
| `-ldflags="-s -w"` | No interaction; safe |
| `-race` | Compatible; runtime overhead dominates; PGO gain shrinks |
| `-tags=foo` | Selects different source; profile match degrades if tags change hot code |

The combination that actually disables PGO in practice: `-gcflags="all=-N -l"`. Use it for debug builds only; do not deploy.

---

## 10. Cross-version stability

A profile captured on Go 1.21 can drive a Go 1.24 build. The format is stable; matching is by function name; no recompile of the profile is needed.

Two practical implications:

- **Toolchain upgrades** do not invalidate the profile. Upgrade Go, rebuild, ship.
- **Source upgrades** do invalidate parts of the profile when functions are renamed or removed. The compiler tolerates this silently; the warning threshold tells you when to refresh.

---

## 11. The cost: compile time

PGO builds are slower:

| Build | Relative compile time |
|-------|----------------------|
| `-pgo=off`  | 1.00 × |
| `-pgo=auto` (cold cache) | 1.05–1.20 × |
| `-pgo=auto` (warm cache) | 1.00 × |

The warm-cache figure matters in CI when the profile is unchanged: the build cache reuses object files freely. The cold-cache figure matters when the profile is refreshed: you re-pay the full PGO compile-time tax on the first build.

A heavy monorepo with frequent profile refreshes may see CI build times increase by 10 % — usually acceptable.

---

## 12. PGO and JIT-style decisions Go does NOT make

For comparison with JVM/LLVM languages:

| Feature | JVM / LLVM | Go PGO |
|---------|------------|--------|
| Profile-guided code generation | Yes | Yes |
| Tiered compilation | Yes | No |
| On-stack replacement | Yes | No |
| Speculative optimizations with deopt | Yes | No (fixed-shape devirt only) |
| Continuous re-profiling | Optional | No |
| AOT specialization to profile | Yes | Yes |

Go PGO is the AOT-specialization slice only. The Go team picked the cheapest, highest-value subset of PGO and stopped. The result is something operationally simple — one extra file, one extra flag — at the cost of leaving JVM-level wins on the table.

---

## 13. Diagnosing "PGO did nothing"

When `benchstat` shows no improvement after enabling PGO, the diagnostic ladder:

1. **Confirm it ran.** `go version -m ./bin | grep pgo` should show a path, not `off`.
2. **Check stale rate.** Build with `GODEBUG=pgodebug=1` (Go 1.22+) or read the compiler warning; > 50 % stale means the profile is rotten.
3. **Inspect the profile.** `go tool pprof -top default.pgo` — is anything actually hot, or is it flat (no clear hotspots)? Flat profiles offer little to PGO.
4. **Check workload.** Is your hot path inside cgo, syscalls, or the GC? PGO won't help.
5. **Check inline diff.** `diff <(build -gcflags=-m=2 -pgo=off ...) <(build -gcflags=-m=2 -pgo=auto ...)` — if the diff is empty, the profile produced no actionable changes.

---

## 14. Summary

PGO at a senior engineer's level: the compiler builds function-hotness and edge-hotness views from a pprof CPU profile, then raises inline budgets at hot call sites and speculatively devirtualizes interface calls dominated by one concrete type. Real-world gains are bounded by inlining and devirtualization opportunities; cgo, syscalls, GC, and flat profiles get nothing. Multi-binary repos use one profile per binary; multi-region deployments usually merge into one profile. Profile freshness matters but is not catastrophic; the compiler degrades gracefully. The whole apparatus is intentionally simple — one file, one flag, AOT only — and that simplicity is the design.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- Go blog: PGO design and results: https://go.dev/blog/pgo
- Devirtualization design notes: https://go.googlesource.com/proposal/+/master/design/55022-pgo-implementation.md
- Compiler PGO source: https://github.com/golang/go/tree/master/src/cmd/compile/internal/pgo
