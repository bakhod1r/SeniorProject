# Race Detector — Middle

## 1. What `-race` costs you

The race detector instruments every memory access. The price is concrete:

| Resource | Typical overhead |
|----------|------------------|
| CPU | 2x to 20x slowdown |
| Memory | 5x to 10x more RSS |
| Binary size | Roughly 2x larger |
| Startup | Slower (extra runtime init) |

Because of this, the rule of thumb is: **run with `-race` in tests and CI by default, sometimes in staging, never in production by default.** Always-on production race detection exists at some shops, but only when the workload can absorb the cost; for most services it would push tail latency and memory beyond what is acceptable.

---

## 2. How it works at a high level

The detector keeps **shadow memory** that records the last N memory accesses (reads and writes) to each byte, including which goroutine performed each access and a logical timestamp. When your program accesses memory, the instrumentation checks the shadow:

1. Was there a previous *write* to this byte by a *different* goroutine?
2. If yes, is there a **happens-before** edge between that previous access and the current one (a mutex unlock/lock pair, a channel send/recv, an atomic, a `sync.Once`, etc.)?
3. If there is no such edge — that is a data race; print a report.

The happens-before relation is built from Go's synchronization primitives. Channels, mutexes, `sync.WaitGroup`, `sync.Once`, and `sync/atomic` all create edges the detector recognizes. Plain shared variables do not.

---

## 3. False negatives, no false positives

A property worth memorizing: **every race the detector reports is a real data race.** It does not invent races. But it can miss races that this particular run never exercised — if two goroutines could race in principle but the timing never happened, the detector sees nothing.

Implications for daily work:
- Re-run flaky test suites with `-race -count=10` to widen the window of observed interleavings.
- Use `t.Parallel()` aggressively so the same process runs many tests concurrently — more interleavings per CI minute.
- A green `-race` run is evidence, not proof. The race might still be there.

---

## 4. Running `-race` in CI

The minimum useful policy:

```yaml
# .github/workflows/test.yml
- name: Tests with race detector
  run: go test -race -count=1 ./...
```

Refinements that pay off:

```bash
go test -race -timeout=10m -count=1 ./...
go test -race -shuffle=on ./...     # randomize test order
go test -race -run=TestConcurrent -count=20 ./...  # stress one test
```

Two practical concerns in CI:
- The cost is real — race jobs are 2–5x slower than non-race ones. Many teams run race on every PR and non-race separately for quick feedback.
- `GOMAXPROCS` matters. The detector benefits from real parallelism; a 1-CPU runner observes fewer interleavings than a 4-CPU runner.

---

## 5. Running a race-instrumented binary in staging

You can ship a `-race` binary to a staging environment to catch races that only happen with realistic traffic patterns, durations, or data shapes:

```bash
go build -race -o staging-app ./cmd/server
./staging-app                          # run in staging
GORACE="log_path=/var/log/race halt_on_error=0" ./staging-app
```

When the detector observes a race it writes a report to the configured `log_path` (or stderr). Set `halt_on_error=0` so the process keeps serving traffic after a race report; set it to `1` if you would rather crash and have a postmortem.

Typical staging cadence: bake a `-race` build for a few hours under load, grep the logs for `DATA RACE`, file bugs, ship the normal build. Avoid this for serious load tests — the timings are not representative.

---

## 6. Interpreting reports across goroutine creation chains

Real reports often involve goroutines spawned deep in a call chain:

```
WARNING: DATA RACE
Write at 0x00c000100000 by goroutine 14:
  main.(*Cache).Set()
      /app/cache.go:42 +0x5c

Previous read at 0x00c000100000 by goroutine 9:
  main.(*Cache).Get()
      /app/cache.go:28 +0x44

Goroutine 14 (running) created at:
  net/http.(*Server).Serve()
      /usr/local/go/src/net/http/server.go:3105 +0x404

Goroutine 9 (finished) created at:
  net/http.(*Server).Serve()
      /usr/local/go/src/net/http/server.go:3105 +0x404
```

The "created at" frames pointing to `net/http.Serve` mean both racing goroutines are HTTP request handlers — typical for a shared cache without locking. The fix lives in `cache.go`, not in `net/http`. Always read the **user-code** frames first; the runtime/library frames just tell you who scheduled the goroutine.

---

## 7. A "real-world" example: shared config map

```go
var cfg = map[string]string{}

func reloadConfig() {
    new := loadFromDisk()
    cfg = new            // write
}

func handler(w http.ResponseWriter, r *http.Request) {
    v := cfg["timeout"]  // read
    _ = v
}
```

Looks fine. Until `reloadConfig` runs from a SIGHUP goroutine while requests are in flight — then `handler`'s map read races with the assignment in `reloadConfig`. The detector reports a write/read race on the map header. (Map *operations* have their own concurrency rules that produce different panics, but even pointer-to-map reassignment without synchronization races.)

Fixes range from `sync.RWMutex` around access, to `atomic.Value` holding a `map[string]string`, to immutable snapshots passed via channels. Each is a real engineering choice.

---

## 8. What the detector does **not** catch

- **Logical races** that are not data races: two correct, locked operations whose ordering happens to produce a wrong business answer.
- **Deadlocks** — those are a different runtime check (`fatal error: all goroutines are asleep`).
- **Memory leaks** or goroutine leaks.
- **Races below the visible Go heap**: cgo memory, mmap'd regions, signal handlers writing into Go memory.

For those you reach for other tools (`go vet`, `staticcheck`, goroutine profiles, sanitizers).

---

## 9. Quick decision table

| Scenario | Use `-race`? |
|----------|--------------|
| `go test ./...` on a PR | Yes |
| Nightly long-running soak tests | Yes |
| A benchmark you actually trust the numbers from | No |
| Reproducing a flaky concurrency bug locally | Yes, with `-count=N` |
| Container image you ship to customers | No |
| Staging canary to catch real-traffic races | Yes (with `GORACE` log path) |

---

## 10. Summary

The race detector is dynamic instrumentation backed by shadow memory and a happens-before tracker. It costs 2–20x CPU and 5–10x memory, never produces false positives, but misses races whose timing never occurred. Run it on every test in CI, occasionally on a staging build under real traffic, and read reports from the user-code frames outward. The detector observes; it does not prove — so combine it with stress (`-count`, `-shuffle`, `t.Parallel`) to widen the interleavings it can witness.

---

## Further reading
- Official guide: https://go.dev/doc/articles/race_detector
- The Go Memory Model: https://go.dev/ref/mem
- `go help testflag`
