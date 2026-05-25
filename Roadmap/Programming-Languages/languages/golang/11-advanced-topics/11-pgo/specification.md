# Profile-Guided Optimization (PGO) — Specification

> **Focus:** Precise reference for how the Go toolchain consumes a CPU profile to drive compiler optimization decisions.
>
> **Sources:**
> - Official PGO documentation: https://go.dev/doc/pgo
> - Go 1.21 release notes: https://go.dev/doc/go1.21#pgo
> - Go 1.22 release notes: https://go.dev/doc/go1.22#compiler
> - Design document: https://go.googlesource.com/proposal/+/master/design/55022-pgo-implementation.md
> - `cmd/go` documentation: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching

---

## 1. What PGO is

Profile-Guided Optimization (PGO) is a build mode in which the Go compiler reads a runtime CPU profile and uses the per-function and per-edge sample counts to make smarter optimization decisions. The compiler still produces a valid, deterministic binary; PGO only changes *which* legal optimization choices it makes.

| Property | Value |
|----------|-------|
| Introduced | Go 1.20 (preview) |
| Stable / GA | Go 1.21 |
| Profile format | pprof CPU profile (gzipped protobuf) |
| Default flag | `-pgo=auto` since Go 1.21 |
| Default file | `default.pgo` in the main package directory |
| Typical gain | 2–10 % CPU on realistic workloads |
| Build determinism | Yes — same source + same profile → same binary |

PGO is sometimes called *feedback-directed optimization* (FDO) in compiler literature.

---

## 2. The `-pgo` flag forms

`go build` and `go test` accept `-pgo` with three forms.

| Form | Behavior |
|------|----------|
| `-pgo=auto` | Look for `default.pgo` next to the `main` package; use it if present, build without PGO otherwise. **Default since Go 1.21.** |
| `-pgo=off` | Disable PGO entirely, even if `default.pgo` exists. |
| `-pgo=<path>` | Use the explicit profile file. Useful for A/B builds and CI. |

The flag is also exposed through `go env GOFLAGS` and `go.work` `-pgo` lines.

---

## 3. Where the profile lives

| File | Convention |
|------|------------|
| `default.pgo` | Next to the `main` package source, **committed to VCS**. |
| `cmd/server/default.pgo` | One profile per binary in a multi-binary repo. |
| Any path | Supplied explicitly via `-pgo=<path>`. |

The profile is binary; commit it as-is and let Git treat it as a binary blob. Typical size is 50 KiB to a few MiB.

---

## 4. Profile format

A PGO profile is a regular pprof CPU profile — the same format produced by `runtime/pprof.StartCPUProfile`, `net/http/pprof`, or `go test -cpuprofile`.

| Property | Value |
|----------|-------|
| Container | gzip-compressed protobuf (`profile.proto`) |
| Sample unit | `samples/count` and `cpu/nanoseconds` |
| Required samples | At least a few hundred for usefulness; thousands for stability |
| Mergeable | Yes, via `go tool pprof -proto a.pgo b.pgo > merged.pgo` |

The compiler does not care which sampler produced the profile, only that the sample data references functions present in the build.

---

## 5. What the compiler does with the profile

| Decision | Without PGO | With PGO |
|----------|-------------|----------|
| Inlining budget | Fixed budget per call site | Budget raised for hot call sites |
| Hot/cold split | Not performed | Cold paths placed out-of-line |
| Devirtualization | Only when the concrete type is statically known | Speculatively done for interface calls whose target is dominated by one concrete type at runtime |
| Register allocation | Hotness-agnostic | Biased toward hot blocks |
| Basic-block ordering | Source-order heuristics | Profile-driven layout |

The largest gains come from **inlining hot functions across package boundaries** and **devirtualizing interface calls** that have one dominant target.

---

## 6. Devirtualization in detail

For an interface call `iface.Method(args)` where the profile shows that 90 %+ of calls dispatch to a single concrete type `*T`, the compiler rewrites the call as:

```go
if concrete, ok := iface.(*T); ok {
    concrete.Method(args)        // direct, inlinable
} else {
    iface.Method(args)           // fallback
}
```

The direct call can then be inlined. This single transformation accounts for a large share of PGO's measured speedup on real services.

---

## 7. Build-cache interaction

| Aspect | Behavior |
|--------|----------|
| Cache key | Includes the SHA-256 of the profile file |
| Stale profile | Allowed: profile may reference functions that no longer exist |
| Cold rebuild | Slightly slower than non-PGO builds (5–20 % more compile time) |
| Warm rebuild | Cached as long as profile + source are unchanged |

A change to `default.pgo` invalidates the cached build of every package that participates in PGO decisions — not only the `main` package.

---

## 8. Profile-version compatibility

The PGO file format is forward and backward compatible across Go releases: a profile captured on Go 1.21 can be used to build with Go 1.24. Sample-to-function matching is name-based, so functions that have been renamed since the profile was captured are silently ignored.

| Source change | Effect |
|---------------|--------|
| Function unchanged | Profile entry applies |
| Function renamed | Old entry ignored; no error |
| Function deleted | Old entry ignored; no error |
| New function | No profile data; default heuristics |
| Function body changed | Entry still applies; samples still used |

The compiler emits a build warning if more than half the samples in the profile refer to functions absent from the build.

---

## 9. When PGO does and does not help

| Workload | Expected effect |
|----------|-----------------|
| HTTP service with rich call graph | +3 to +8 % CPU |
| RPC server with interface-heavy hot path | +5 to +10 % CPU |
| Tight numerical kernel already inlined | < +1 %, sometimes regression |
| cgo-heavy program | No effect on cgo time |
| Allocation-bound program | No effect; GC is unaffected by PGO |
| Startup-dominated CLI | No effect at runtime; affects only steady state |

PGO is a steady-state optimization. It does not change garbage collection, scheduling, or the language semantics in any way.

---

## 10. Inputs and outputs at a glance

```
[source tree]    [default.pgo]
       \            /
        \          /
         go build -pgo=auto
                |
                v
         [optimized binary]
```

The binary is byte-identical for identical source + profile, given the standard reproducible-build settings (`-trimpath`, fixed toolchain version, fixed `GOFLAGS`).

---

## 11. Non-goals and limitations

- PGO does **not** affect garbage collection, escape analysis, or the goroutine scheduler.
- It does **not** rewrite control flow into something the source did not express; all decisions remain legal optimizations.
- It does **not** require runtime instrumentation; the same profile that pprof captures is consumed verbatim.
- It cannot recover from a profile captured on a wildly different workload — a microbenchmark profile applied to a real service can produce *worse* code than no PGO.

---

## 12. Related references

- Official PGO guide: https://go.dev/doc/pgo
- Go 1.21 release notes (PGO GA): https://go.dev/doc/go1.21#pgo
- `cmd/compile` PGO source: https://github.com/golang/go/tree/master/src/cmd/compile/internal/pgo
- pprof profile format: https://github.com/google/pprof/blob/main/proto/profile.proto
- Pyroscope continuous profiling: https://pyroscope.io
- Parca continuous profiling: https://www.parca.dev
