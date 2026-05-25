# Profile-Guided Optimization (PGO) — Middle

## 1. The capture step, in depth

A PGO profile is a CPU profile produced exactly the same way you already produce one for `pprof`. The only requirement is that the profile reflects the workload you actually want optimized.

### 1.1 From `go test -cpuprofile`

```bash
go test -run=^$ -bench=. -cpuprofile=cpu.pgo -benchtime=60s ./pkg/hot
```

Notes:

- `-run=^$` skips tests, only runs benchmarks.
- `-benchtime=60s` ensures enough samples. The Go scheduler samples CPU at ~100 Hz, so 60 seconds gives ~6000 samples per active goroutine — usually plenty.
- The output `cpu.pgo` lives where you ran `go test`; move it to the `main` package directory.

### 1.2 From a running server

```go
import _ "net/http/pprof"

go func() {
    _ = http.ListenAndServe("127.0.0.1:6060", nil)
}()
```

Then from your laptop:

```bash
curl -o default.pgo "http://prod-pod:6060/debug/pprof/profile?seconds=60"
```

Tunnel it via `kubectl port-forward` if you're on Kubernetes:

```bash
kubectl port-forward pod/my-app-xyz 6060:6060
curl -o default.pgo "http://localhost:6060/debug/pprof/profile?seconds=60"
```

60 seconds is the conventional length. Shorter (30 s) misses tail behavior; longer (5 min) gives a more stable profile but slows the capture loop.

---

## 2. The profile format

The PGO file is a standard pprof CPU profile: gzipped protobuf, the schema of which lives at https://github.com/google/pprof/blob/main/proto/profile.proto.

Inspect a profile like any other:

```bash
go tool pprof -top default.pgo
go tool pprof -list 'package\\.Function' default.pgo
```

If `go tool pprof` can open it, the Go compiler can use it. The two consumers share a parser.

You can also merge multiple profiles:

```bash
go tool pprof -proto profile1.pgo profile2.pgo > merged.pgo
mv merged.pgo default.pgo
```

This is the standard way to combine multiple capture sessions (different times of day, different regions).

---

## 3. `-pgo=auto` versus an explicit path

```bash
# auto: look for default.pgo next to main
go build -pgo=auto ./cmd/myapp

# explicit: any path
go build -pgo=./profiles/peak.pgo ./cmd/myapp

# disabled
go build -pgo=off ./cmd/myapp
```

`-pgo=auto` is the default since Go 1.21. Two reasons to use an explicit path:

1. **CI**: build artifacts assemble a profile in a known location not adjacent to source.
2. **A/B comparison**: build two binaries, one with each profile, compare.

The path is resolved at build time and embedded into the build cache key.

---

## 4. Where does `default.pgo` go?

For a single-binary repo:

```
.
├── go.mod
├── main.go
├── default.pgo          ← here, next to main
└── ...
```

For a multi-binary repo (`cmd/` convention):

```
.
├── go.mod
├── cmd/
│   ├── server/
│   │   ├── main.go
│   │   └── default.pgo  ← one per binary
│   └── worker/
│       ├── main.go
│       └── default.pgo
└── ...
```

Each binary gets its own profile. They have different hot paths, so a single shared profile is usually wrong.

---

## 5. The profile-match algorithm

When the compiler reads `default.pgo`, it walks every sample and looks up the function by name in the current build. The matching rules:

| Sample function | Build function | Outcome |
|-----------------|----------------|---------|
| `pkg.Foo` exists in build | `pkg.Foo` | Sample applied |
| `pkg.Foo` renamed to `pkg.FooV2` | (none) | Sample ignored |
| `pkg.Foo` deleted | (none) | Sample ignored |
| `pkg.NewBar` not in profile | exists | No data; default heuristics |

The compiler tolerates **a lot** of mismatch. A profile from three months ago, with half its samples referencing dead functions, still produces a valid binary — just with diminished benefit. The compiler logs a warning when the mismatch fraction is high:

```
warning: profile has 53% stale samples; consider refreshing
```

(Exact wording varies by Go version.) That number is your signal that the profile is too old.

---

## 6. What the compiler actually optimizes

The two big wheels:

### 6.1 Aggressive inlining for hot paths

Without PGO, the compiler has a fixed inlining budget per call site. A function "too expensive" by that budget is never inlined, even if it's called a million times per second.

With PGO, the budget is raised for hot call sites. Calls that the profile shows as accounting for, say, 5 % of total samples get a higher inline budget, often enough to inline functions that would otherwise be rejected.

### 6.2 Devirtualization of interface calls

```go
type Reader interface {
    Read(p []byte) (int, error)
}

func process(r Reader) { ... }
```

If the profile shows that almost all calls to `process` pass a `*os.File` for `r`, the compiler rewrites the call:

```go
// approximate compiler-internal pseudo-code
if f, ok := r.(*os.File); ok {
    f.Read(p)              // direct call, can be inlined
} else {
    r.Read(p)              // fallback to interface dispatch
}
```

The direct call can then be inlined; the interface dispatch falls through only on the rare type. Combined with inlining, this is where the bulk of the typical 5 % comes from.

---

## 7. Expected gains by workload

| Workload type | Typical gain | Why |
|---------------|--------------|-----|
| HTTP service, JSON-heavy | +3 to +7 % | Many inlinable hot functions |
| RPC server with interfaces | +5 to +10 % | Devirtualization wins |
| Numerical / SIMD-like | 0 to +2 % | Already mostly inlined |
| cgo-bound | ~0 % | C side untouched |
| Allocation-bound (GC-dominated) | ~0 % | GC unaffected |
| CLI tool (short-lived) | ~0 % | Steady-state opt only |

These are anecdotal industry figures; your numbers will differ. Measure, don't assume.

---

## 8. Verifying PGO is actually applied

```bash
go version -m ./bin/myapp | grep pgo
```

Expected output:

```
        build   -pgo=/abs/path/to/cmd/myapp/default.pgo
```

If you see `-pgo=off`, PGO is disabled. If the line is missing entirely, you're on a Go version older than 1.21.

Also useful: dump the inline tree to see what the compiler did differently.

```bash
go build -gcflags='-m=2' -pgo=auto ./cmd/myapp 2> with_pgo.txt
go build -gcflags='-m=2' -pgo=off  ./cmd/myapp 2> without_pgo.txt
diff with_pgo.txt without_pgo.txt | head -50
```

You should see additional `inlining call to <hot function>` lines in the PGO version.

---

## 9. Benchmark the change

```bash
go test -bench=. -count=10 -pgo=off  -benchtime=2s ./pkg/hot > old.txt
go test -bench=. -count=10 -pgo=auto -benchtime=2s ./pkg/hot > new.txt
benchstat old.txt new.txt
```

Read the `delta` column: negative numbers (in ns/op) are improvements. Statistical significance matters — `benchstat` reports a p-value; ignore "improvements" with high variance.

A meaningful PGO improvement is consistent across multiple runs and visible to `benchstat` as `p < 0.05`.

---

## 10. Refreshing the profile

The profile becomes stale over time as code changes. Practical cadences:

| Cadence | Suitable for |
|---------|--------------|
| Per release | Steady release train (every 1–2 weeks) |
| Weekly | Fast-moving code |
| Monthly | Mature, slow-changing service |
| On big refactors | When you delete or restructure hot code |

A simple shell script that pulls a fresh profile from prod and commits it as a PR is a one-evening job, and most teams that adopt PGO end up with one.

---

## 11. Summary

The PGO workflow at a working-developer level: capture a 60-second CPU profile under realistic load, save it as `default.pgo` next to the `main` package, build with `go build` (which now uses `-pgo=auto` by default). The compiler matches sample functions by name, tolerates stale entries, and applies the profile to raise inline budgets for hot call sites and speculatively devirtualize interface calls. Verify with `go version -m`, benchmark with `benchstat`, refresh on a regular cadence.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- Go 1.21 release notes: https://go.dev/doc/go1.21#pgo
- `pprof` profile format: https://github.com/google/pprof/blob/main/proto/profile.proto
- Compiler inlining docs: https://github.com/golang/go/wiki/CompilerOptimizations
