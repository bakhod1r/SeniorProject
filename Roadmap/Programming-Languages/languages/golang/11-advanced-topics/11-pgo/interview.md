# Profile-Guided Optimization (PGO) — Interview Questions

A set of interview-style questions on Go's PGO, with concise but complete answers.

---

## Q1. What is Profile-Guided Optimization in Go?

PGO is a build mode in which the Go compiler reads a CPU profile (in the standard pprof format) and uses the sample data to make smarter optimization decisions — chiefly raising the inline budget at hot call sites and speculatively devirtualizing interface calls dominated by one concrete type. The compiler still produces a valid, deterministic binary; only the optimizer's choices change.

---

## Q2. When did PGO go GA in Go?

Go 1.21, released August 2023. Go 1.20 shipped a preview. Since 1.21, `-pgo=auto` is the default for `go build`.

---

## Q3. What file format does PGO consume?

A standard pprof CPU profile: gzipped protobuf following the schema at `github.com/google/pprof/blob/main/proto/profile.proto`. The exact format produced by `runtime/pprof.StartCPUProfile`, `net/http/pprof`'s `/debug/pprof/profile` endpoint, or `go test -cpuprofile`.

---

## Q4. Where does the compiler look for the profile?

For `-pgo=auto` (the default), the compiler looks for a file named exactly `default.pgo` next to the `main` package's source files. Not the module root, not anywhere on the import path — adjacent to `main`. For `-pgo=<path>`, the path is used verbatim.

---

## Q5. What are the three forms of the `-pgo` flag?

| Form | Behavior |
|------|----------|
| `-pgo=auto` | Use `default.pgo` next to `main` if present; otherwise no PGO. **Default.** |
| `-pgo=off` | Disable PGO regardless of file presence. |
| `-pgo=<path>` | Use the explicit file at `<path>`. |

---

## Q6. What does the compiler actually do with the profile?

Two primary optimizations:

1. **Inlining**: For each call site, the compiler computes its share of total samples. Hot call sites get a raised inline budget, so larger functions get inlined that the heuristic alone would reject.
2. **Devirtualization**: For each interface call site, the compiler looks at the runtime dispatch distribution recorded by the profile. If one concrete type dominates (e.g., >80 % of calls), it emits a type-check fast-path that dispatches directly (and can then be inlined), falling back to interface dispatch on the cold branch.

Secondary effects include block ordering and register-allocation hints, but inlining and devirtualization dominate the measurable wins.

---

## Q7. What kind of CPU savings should I expect?

Typical reported figures: **2 % to 10 %** CPU savings on real-world Go services. The bulk of teams see 3–7 %. Numerical kernels already mostly inlined see less; interface-heavy RPC code sees more.

---

## Q8. What kinds of code don't benefit from PGO?

- **cgo-heavy code**: the C side isn't compiled by Go; PGO doesn't reach it.
- **Reflection-based dispatch**: not statically resolvable, so devirtualization can't fire.
- **Allocation-bound / GC-dominated workloads**: PGO does not affect GC; the percentage saved is small.
- **Tight numerical kernels already inlined**: not much left for PGO to do.
- **Startup-only workloads**: PGO is a steady-state optimization; short-lived processes get little.

---

## Q9. How do I capture a profile from a running service?

Standard `net/http/pprof` setup:

```go
import _ "net/http/pprof"

go func() { _ = http.ListenAndServe("127.0.0.1:6060", nil) }()
```

Then:

```bash
curl -o default.pgo "http://localhost:6060/debug/pprof/profile?seconds=60"
```

A 60-second window at peak load is the common recipe.

---

## Q10. Should the profile live in the repo? Won't it bloat the history?

Yes, commit it. A typical profile is tens of KiB to a few MiB. Git stores it as binary; no LFS needed. The benefit — reproducible PGO builds for every checkout — outweighs the storage cost.

---

## Q11. How often should I refresh the profile?

Practical cadences:

- **Per release** (weekly or bi-weekly) for actively developed code.
- **Monthly** for mature, slow-changing services.
- **On large refactors** that delete or rename hot functions.

A staleness warning from the compiler ("> 50 % stale samples") is the prompt to refresh.

---

## Q12. What happens if my profile references functions that no longer exist?

The compiler silently ignores those samples. The build succeeds. The PGO benefit degrades in proportion to the stale fraction. The compiler emits a warning when stale samples cross a threshold (~50 %).

---

## Q13. Is the profile format compatible across Go versions?

Yes. A profile captured under Go 1.21 can drive a Go 1.24 build, and vice versa. Matching is by function name. The format is stable.

---

## Q14. Devirtualization — explain it in detail.

For a call `iface.Method(args)` where the profile shows one concrete type dominates, the compiler rewrites:

```
if c, ok := iface.(*ConcreteType); ok {
    c.Method(args)            // direct, inlinable
} else {
    iface.Method(args)        // fallback to interface dispatch
}
```

The direct branch can then be inlined. The cost is one type-tag check per call. The net win is significant when one type is, say, 90 %+ of calls; it can be a loss if the type distribution is balanced.

---

## Q15. What's the alternative if PGO doesn't help?

Look at the workload composition:

- **cgo-bound** → optimize the C side or remove cgo.
- **Allocation-bound** → `pprof -alloc_objects`, reduce allocations, pool.
- **Syscall-bound** → reduce syscall count, batch I/O.
- **Lock-bound** → profile contention, reduce critical sections.
- **Genuinely fast already** → look at architecture or algorithmic improvements.

PGO is one tool among many. When it gives 0 %, it's telling you the hot path is somewhere PGO can't reach.

---

## Q16. How do I verify PGO actually applied to my build?

```bash
go version -m ./bin/myapp | grep pgo
```

Expected output:

```
build   -pgo=/abs/path/to/cmd/myapp/default.pgo
```

If it shows `-pgo=off` or the line is missing, PGO didn't run.

---

## Q17. What's the relationship between PGO and the build cache?

The profile's SHA is part of every cache key for packages that participate in PGO decisions. Same source + same profile → cache hit. Change the profile → cache miss for affected packages. PGO builds cost slightly more (5–20 %) on a cold cache, identical on a warm cache.

---

## Q18. Can I merge multiple profiles?

Yes:

```bash
go tool pprof -proto a.pgo b.pgo c.pgo > merged.pgo
```

This is the standard way to aggregate profiles from multiple pods or multiple capture windows. Merging is recommended over single-pod capture.

---

## Q19. What about PGO with `-race` builds?

The race detector adds heavy runtime instrumentation. PGO still applies, but its percentage win is dwarfed by the race overhead. The practical answer: ship release builds with `-pgo=auto` (and without `-race`); use `-race` only in CI and dev.

---

## Q20. What's the bootstrap problem for PGO, and how do you solve it?

You can't capture a profile until something is running, but you want PGO from day one. The solution is sequential, not circular:

1. Build and deploy a non-PGO release.
2. Wait for production traffic to reach steady state.
3. Capture a 60-second profile.
4. Commit as `default.pgo`.
5. The next release builds with `-pgo=auto` automatically.

PGO is strictly additive — there is no chicken-and-egg.

---

## 21. Summary

A confident PGO answer covers: what it is (compiler reads runtime CPU profile, raises inline budget and devirtualizes), when it landed (GA 1.21), where the file lives (`default.pgo` next to `main`), what it optimizes (inlining + devirtualization), expected gain (2–10 %), when it doesn't help (cgo, reflection, GC-bound), how to refresh (weekly or per-release), and how to verify (`go version -m`). These nine threads cover most interview prompts.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- Go 1.21 release notes: https://go.dev/doc/go1.21#pgo
- Go blog: PGO design: https://go.dev/blog/pgo
- Devirtualization proposal: https://go.googlesource.com/proposal/+/master/design/55022-pgo-implementation.md
