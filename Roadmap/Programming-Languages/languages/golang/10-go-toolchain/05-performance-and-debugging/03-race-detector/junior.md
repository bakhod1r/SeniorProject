# Race Detector — Junior

## 1. What is a data race?

A **data race** happens when two goroutines access the same memory location concurrently, **at least one of the accesses is a write**, and there is **no synchronization** (no mutex, channel, atomic, or other happens-before edge) ordering them.

Data races are undefined behavior in Go. The program might appear to work for years and then corrupt data, hang, or crash on a different CPU, OS, or compiler version. The compiler does not stop you from writing them.

The **race detector** is a runtime tool, built into the Go toolchain, that watches your program while it runs and prints a report whenever it observes a data race.

---

## 2. Enabling it

Add `-race` to any of the standard build/run/test commands:

```bash
go test -race ./...        # most common: run all tests with the detector
go run -race main.go       # run a program with the detector
go build -race -o app .    # build a race-instrumented binary
go install -race ./cmd/x   # install with the detector
```

`-race` must come **before** the package or file, not after. `go run main.go -race` passes `-race` to your program as an argument and the detector is **not** enabled.

---

## 3. A minimal program that races

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var counter int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // read-modify-write with no synchronization
        }()
    }
    wg.Wait()
    fmt.Println("counter:", counter)
}
```

Run normally — output looks plausible but is wrong:

```bash
$ go run main.go
counter: 873   # sometimes 1000, sometimes not
```

Run with the detector:

```bash
$ go run -race main.go
==================
WARNING: DATA RACE
Read at 0x00c000014098 by goroutine 8:
  main.main.func1()
      /tmp/main.go:13 +0x44

Previous write at 0x00c000014098 by goroutine 7:
  main.main.func1()
      /tmp/main.go:13 +0x58
...
==================
Found 1 data race(s)
```

---

## 4. Reading a race report

Every report has the same shape:

```
WARNING: DATA RACE
<Read or Write> at <address> by goroutine <N>:
  <stack trace of the current access>

Previous <read or write> at <address> by goroutine <M>:
  <stack trace of the conflicting access>

Goroutine N (running) created at:
  <stack trace of where goroutine N was spawned>

Goroutine M (finished) created at:
  <stack trace of where goroutine M was spawned>
```

The four blocks to read, in order:
1. **What** kind of access caused the report (read or write) and **where** in your code.
2. The **previous conflicting access** at the same address.
3. **Where each goroutine was created** — usually the most useful clue for *who* is racing.

If both accesses are reads, you do **not** get a report — reads do not race with reads.

---

## 5. Supported platforms

The race detector ships with the standard Go toolchain on these OS/arch combinations:

| OS | Architectures |
|----|---------------|
| linux | amd64, arm64, ppc64le, s390x |
| darwin (macOS) | amd64, arm64 |
| freebsd | amd64 |
| netbsd | amd64 |
| windows | amd64, arm64 |

If `-race` is not supported on your target, `go build -race` fails with a clear error. For other platforms (e.g., 32-bit, mobile, WASM), the race detector is not available.

---

## 6. The cost of `-race`

You pay for the instrumentation:

| Cost | Typical factor |
|------|---------------|
| Memory | 5x–10x more |
| CPU | 2x–20x slower |
| Binary size | noticeably larger |

That is fine for tests, debugging, and CI. It is **not** fine for hot production code by default. Treat `-race` as a development and testing tool.

---

## 7. The detector only finds races it actually observes

The race detector is dynamic, not static. It watches the actual memory accesses your program performs **during this run**. A race that depends on a code path you never executed, or on timing that never happened, will not show up. So:

- A clean run with `-race` is **not** a proof of correctness.
- Run your tests under `-race` repeatedly, ideally with `-count=N` and `t.Parallel()`, to exercise different interleavings.
- The flip side is reassuring: **when the detector fires, the race is real**. There are essentially no false positives.

---

## 8. A first fix: use a mutex

```go
var (
    mu      sync.Mutex
    counter int
)

go func() {
    defer wg.Done()
    mu.Lock()
    counter++
    mu.Unlock()
}()
```

Now every read and write happens inside the lock, so the detector sees the happens-before edge and reports no race. The final `counter` is always `1000`.

You will learn other fixes (channels, `sync/atomic`, immutable snapshots) later; the mutex is the easiest to start with.

---

## 9. When to reach for `-race`

| Situation | Use `-race`? |
|-----------|--------------|
| Local test of code with goroutines | Yes |
| `go test ./...` in CI | Yes |
| Debugging "it works most of the time" bugs | Yes |
| Running a benchmark for speed | No (it skews timings) |
| Production traffic | Not by default (see senior/professional pages) |

A good habit: any test file that spawns goroutines is run with `-race` in CI. It is the cheapest concurrency bug insurance you can buy.

---

## 10. Summary

A data race is two goroutines touching the same memory with at least one write and no synchronization. Go's race detector, enabled with `-race` on `test`, `run`, `build`, or `install`, instruments your binary so the runtime can report races it observes. Reports name the two conflicting accesses and the goroutines that performed them. The detector has real cost (5–10x memory, 2–20x CPU) but no false positives, runs on the common 64-bit OSes, and is the standard way to find concurrency bugs in Go.

---

## Further reading
- Official guide: https://go.dev/doc/articles/race_detector
- `go help testflag` (look for `-race`)
- The Go Memory Model: https://go.dev/ref/mem
