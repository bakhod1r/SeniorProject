# Profile-Guided Optimization (PGO) — Junior

## 1. What is PGO?

PGO stands for **Profile-Guided Optimization**. The idea is simple: you tell the Go compiler which parts of your program actually run hot, and the compiler uses that information to make smarter choices — chiefly *which functions to inline*. Without PGO, the compiler guesses based on source heuristics. With PGO, it has measured data.

The profile is the same kind of CPU profile you already capture with `pprof`. Nothing new to learn on the data side.

PGO became **generally available in Go 1.21** (August 2023). Since then it has been a stable, supported build mode.

---

## 2. Why bother?

Real Go services have reported **2 % to 10 % CPU savings** after enabling PGO. That is real money at scale and a low-effort change: you commit one file and add one flag.

You don't need to rewrite code. You don't need to think about which functions are hot — the profile tells the compiler.

---

## 3. The simplest possible example

Imagine this tiny program in `./cmd/myapp/main.go`:

```go
package main

import (
    "fmt"
    "strings"
)

func transform(s string) string {
    var b strings.Builder
    for _, r := range s {
        if r >= 'a' && r <= 'z' {
            b.WriteRune(r - 'a' + 'A')
        } else {
            b.WriteRune(r)
        }
    }
    return b.String()
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        _ = transform("hello, world")
    }
    fmt.Println("done")
}
```

It's a hot loop. PGO can probably inline `transform` more aggressively if we feed it a profile.

---

## 4. The three-step workflow

Every PGO workflow has three steps.

1. **Capture** a CPU profile while the program is doing something representative.
2. **Save** the profile as `default.pgo` next to your `main` package.
3. **Rebuild** with `go build -pgo=auto` (or just `go build`, since `auto` is now the default).

That's it. The binary you get is the PGO-optimized one.

---

## 5. Capturing a profile

### From a `go test`

The easiest source is a benchmark.

```bash
go test -bench=. -cpuprofile=cpu.pgo -benchtime=10s ./...
```

This writes `cpu.pgo` in the current directory.

### From a running server

If your service exposes `net/http/pprof`:

```bash
curl -o cpu.pgo http://localhost:6060/debug/pprof/profile?seconds=60
```

This grabs 60 seconds of live data.

---

## 6. Saving the profile

Move (or copy) the profile to the directory of your `main` package:

```bash
mv cpu.pgo cmd/myapp/default.pgo
```

The filename **must be** `default.pgo`. The compiler looks for that exact name.

Commit it to Git like a normal file:

```bash
git add cmd/myapp/default.pgo
git commit -m "pgo: initial profile"
```

Yes, it's a binary blob. Yes, you commit it. It's small (typically tens of KiB).

---

## 7. Building with PGO

Just run a normal build:

```bash
go build ./cmd/myapp
```

Since Go 1.21, the default is `-pgo=auto`, which means "use `default.pgo` if it's there". You don't need to add anything.

To be explicit:

```bash
go build -pgo=auto ./cmd/myapp
```

Or, to turn it off:

```bash
go build -pgo=off ./cmd/myapp
```

---

## 8. Verifying it worked

`go version -m` shows the build settings baked into the binary:

```bash
go version -m ./myapp | grep pgo
```

You should see something like:

```
build   -pgo=/abs/path/to/cmd/myapp/default.pgo
```

If it says `-pgo=off`, PGO was not used.

---

## 9. Measuring the improvement

Write a benchmark, build with and without PGO, and compare.

```bash
# baseline
go test -bench=. -count=10 -pgo=off ./... > old.txt

# pgo
go test -bench=. -count=10 -pgo=auto ./... > new.txt

# compare
benchstat old.txt new.txt
```

You're looking for a `~ -5 %` (or similar) on the time line for hot benchmarks. If you see no change, the workload may not be PGO-friendly (see senior notes).

---

## 10. What changes inside the binary?

You can't see PGO's choices directly, but you can see *symptoms*:

- Hot functions get inlined into their callers, so the binary may be slightly **larger**.
- The binary runs slightly **faster** on the same workload.

`go tool objdump -s 'transform' myapp` is one way to peek; you may find that the function call has disappeared (inlined) at the call site.

---

## 11. Common mistakes for beginners

| Mistake | Symptom | Fix |
|---------|---------|-----|
| File named `cpu.pgo` instead of `default.pgo` | PGO silently disabled | Rename to `default.pgo` |
| Profile in the repo root, not next to `main` | PGO silently disabled | Move to `cmd/<app>/default.pgo` |
| Profile from a microbenchmark | No improvement, or regression | Capture from real load |
| Build with `-pgo=off` by accident | No improvement | Drop the flag |

---

## 12. Mental model

Think of PGO as: *"You captured 60 seconds of your real workload, the compiler then rewrites itself slightly to make exactly that workload fast."*

It's the same compiler, the same Go source, the same semantics — only the optimizer's choices change.

---

## 13. Summary

PGO is a low-cost, high-value optimization. The workflow is: capture a CPU profile under realistic load → save it as `default.pgo` in your `main` package directory → run `go build`. The default since Go 1.21 means PGO is automatic if the file is present. Typical gain is a few percent CPU on real services. You don't need to change your code at all.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- Go blog: PGO in Go 1.21: https://go.dev/blog/pgo
- `pprof` basics: https://go.dev/blog/pprof
