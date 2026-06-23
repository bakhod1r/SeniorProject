# Detecting Goroutine Leaks — Optimization Exercises

> Each exercise gives a working but suboptimal detection setup, a target metric, and asks you to improve. The goal is to internalise the cost models of leak detection — when a tool is too slow, too noisy, too expensive, or insufficiently early — and tune the system accordingly.

---

## Easy

### Exercise 1 — Reduce overhead of `NumGoroutine` in a hot loop

**Starting code:**

```go
func processRequest(r *Request) {
    g := runtime.NumGoroutine()
    if g > 10000 {
        log.Warnf("high goroutine count: %d", g)
    }
    handleBusinessLogic(r)
}
```

**Baseline.** `processRequest` is on the hot path, 50k QPS. `NumGoroutine` is called on every request. Profile shows the call accounts for 0.8% of CPU.

**Target.** Reduce CPU overhead to ≤ 0.05%.

**Constraints.** Still log a warning if the count is genuinely high.

<details><summary>Solution</summary>

Sample at a coarser interval. Either use a ticker or sample once per N requests:

```go
var sampleCounter uint64

func processRequest(r *Request) {
    if atomic.AddUint64(&sampleCounter, 1) % 1000 == 0 {
        g := runtime.NumGoroutine()
        if g > 10000 {
            log.Warnf("high goroutine count: %d", g)
        }
    }
    handleBusinessLogic(r)
}
```

`NumGoroutine` is now called 50 times per second instead of 50,000. The overhead drops 1000-fold. The information loss is acceptable — a leak does not change in a millisecond, and the metric pipeline (Prometheus) is already scraping at coarser intervals.
</details>

---

### Exercise 2 — Cut the size of `debug=2` dumps

**Starting code:**

```go
func dumpGoroutines() {
    f, _ := os.Create("dump.txt")
    pprof.Lookup("goroutine").WriteTo(f, 2)
    f.Close()
}
```

**Baseline.** On a server with 200k goroutines, `dump.txt` is 80 MB.

**Target.** Useful diagnostic file ≤ 1 MB.

<details><summary>Solution</summary>

Use `debug=1`, not `debug=2`. `debug=1` aggregates identical stacks. On 200k goroutines with 50 unique stack signatures, the output is roughly 50 blocks — under 100 KB.

```go
pprof.Lookup("goroutine").WriteTo(f, 1)
```

If you need full per-goroutine info, capture the protobuf form (`debug=0`) — it gzip-compresses well, often under 1 MB at 200k goroutines.
</details>

---

### Exercise 3 — Avoid `goleak` false positives in race-mode tests

**Starting code:**

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

**Baseline.** Tests pass under `go test`. Under `go test -race`, one test fails with a race-detector internal goroutine reported as leaked.

**Target.** Tests pass under both `go test` and `go test -race`.

**Constraints.** Do not blanket-ignore. Do not drop `-race` from CI.

<details><summary>Solution</summary>

First, upgrade `go.uber.org/goleak` to its latest release; the maintainers track new runtime helpers.

If still failing, identify the exact top-function and add a targeted ignore with a comment:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        // Race detector spawns its own background goroutine in some Go versions.
        // Remove this ignore when go.uber.org/goleak ships a version that handles it natively.
        goleak.IgnoreTopFunction("runtime.racefiniGoroutine"),
    )
}
```

Document the version of Go and `goleak` in a comment so the next maintainer knows when to re-evaluate.
</details>

---

## Medium

### Exercise 4 — Slope-based alert without alert flapping

**Starting code (Prometheus rule):**

```yaml
- alert: GoroutineLeak
  expr: deriv(go_goroutines[5m]) > 1
  for: 1m
```

**Baseline.** The alert fires every time the server takes a burst of traffic (10–20 times per day). Each is a false positive: the slope settles back within 2 minutes.

**Target.** ≤ 1 false positive per day. Still catch real leaks within 15 minutes.

<details><summary>Solution</summary>

The 5-minute window is too short — bursts of traffic spike it. Widen the window and increase the `for` duration so transients are filtered:

```yaml
- alert: GoroutineLeak
  expr: deriv(go_goroutines[30m]) > 0.5
  for: 10m
```

The 30-minute derivative smooths over bursts; the 10-minute `for` ensures the slope is sustained. The threshold drops from 1/s to 0.5/s because a wider window has lower noise.

Alternative: combine with a baseline comparison.

```yaml
- alert: GoroutineLeak
  expr: |
    go_goroutines > 1.5 * avg_over_time(go_goroutines[24h])
    and deriv(go_goroutines[15m]) > 0
  for: 10m
```

This fires only when count is 50% above the 24-hour average *and* still rising.
</details>

---

### Exercise 5 — Capture profile on-demand without exposing pprof to the public

**Starting code:**

```go
func main() {
    http.Handle("/", appHandler())
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

You imported `_ "net/http/pprof"` and the package's init registered on `http.DefaultServeMux`. Now `/debug/pprof/...` is reachable on port 8080, which is public.

**Target.** `/debug/pprof/...` reachable only on `127.0.0.1:6060`. Public traffic on 8080 sees no pprof.

<details><summary>Solution</summary>

Use a separate mux for the public listener; serve pprof on its own private listener:

```go
func main() {
    publicMux := http.NewServeMux()
    publicMux.Handle("/", appHandler())
    go func() { log.Fatal(http.ListenAndServe(":8080", publicMux)) }()

    // pprof is on DefaultServeMux because of the side-effect import
    go func() { log.Fatal(http.ListenAndServe("127.0.0.1:6060", nil)) }()

    select {}
}
```

Now port 8080 has only the app; port 6060 (localhost-only) has pprof. From inside the container or via `kubectl port-forward`, you can reach pprof; from outside the host you cannot.
</details>

---

### Exercise 6 — Reduce the storage footprint of continuous profiling

**Starting code.** Pyroscope scrapes every service's goroutine profile every 10 seconds. Storage cost is $1500/month.

**Target.** ≤ $500/month, without losing the ability to detect leaks within 30 minutes.

<details><summary>Solution</summary>

Two levers:

1. **Scrape interval.** Drop from 10s to 60s. Storage drops 6x. Leak detection latency rises from 10s to 60s — still well under 30 minutes.
2. **Retention.** Drop high-resolution retention from 30 days to 7 days, with downsampled retention to 90 days. Pyroscope and Grafana Profiles support this.
3. **Sample fewer services.** If 80% of leaks have historically come from 20% of services, scrape those 20% at 60s and the rest at 5 minutes.

Combined, $500/month is achievable. The trade-off is recovering finer-grained data for older incidents — a price worth paying for the cost savings.
</details>

---

### Exercise 7 — Cut `goleak.VerifyTestMain` test-run time

**Starting code.** `goleak.VerifyTestMain` is in every package. After every test run, `goleak` polls for ~100 ms waiting for goroutines to exit. With 200 packages, the test suite spends 20 seconds in `goleak` post-run alone.

**Target.** ≤ 5 seconds total `goleak` overhead.

<details><summary>Solution</summary>

`goleak.VerifyTestMain` polls because some goroutines exit asynchronously. The default poll budget can be reduced if your tests are well-disciplined (no asynchronous cleanup).

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m, goleak.Cleanup(func(_ error) {}))
}
```

If your code is mostly synchronous, set `GOLEAK_TIMEOUT` (custom option in some forks) lower, or accept the poll budget.

The biggest gain: refactor tests so cleanup is synchronous. A `Server.Stop()` that calls `wg.Wait()` before returning means `goleak` finds no leaks immediately, with no polling needed.
</details>

---

## Hard

### Exercise 8 — Build a CI leak-budget gate

**Starting code.** CI runs `go test ./...`. `goleak` is in every `TestMain`. Failures are intermittent because some tests legitimately leak briefly during shutdown.

**Target.** A CI step that fails only when leaks exceed a budget — say, ≤ 5 leaked goroutines per package, ≤ 10 packages with any leaks total.

<details><summary>Solution</summary>

Replace `VerifyTestMain`'s hard fail with a custom checker that counts leaks and emits them to a JSON report:

```go
package internal

import (
    "encoding/json"
    "os"
    "runtime"
    "runtime/pprof"
    "strings"
    "testing"

    "go.uber.org/goleak"
)

func ReportLeaks(m *testing.M, pkgName string) {
    code := m.Run()

    var sb strings.Builder
    _ = pprof.Lookup("goroutine").WriteTo(&sb, 2)
    leaks := countLeaks(sb.String())

    f, _ := os.OpenFile("leak-report.jsonl", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    defer f.Close()
    _ = json.NewEncoder(f).Encode(map[string]any{
        "pkg":   pkgName,
        "leaks": leaks,
    })

    os.Exit(code)
}
```

Then a separate CI step parses `leak-report.jsonl` and applies the budget. PRs that exceed the budget fail; PRs within the budget pass with a warning.

This trades absolute correctness for operational practicality. Use it as a stepping-stone toward strict `VerifyTestMain`.
</details>

---

### Exercise 9 — Cross-replica leak attribution

**Starting code.** A service has 30 replicas. One pod's `go_goroutines` is climbing; 29 are flat. The on-call gets a single page that does not say which pod.

**Target.** The alert names the specific pod and includes its goroutine profile URL.

<details><summary>Solution</summary>

In the alert routing, include the `instance` label:

```yaml
- alert: GoroutineLeak
  expr: deriv(go_goroutines[15m]) > 0.5
  for: 10m
  annotations:
    summary: "Goroutine leak on {{ $labels.instance }}"
    description: |
      Pod {{ $labels.instance }} of {{ $labels.service }} is leaking.
      Profile: http://prometheus/api/profile/{{ $labels.instance }}/goroutine
      Dashboard: http://grafana/d/leaks?var-pod={{ $labels.instance }}
```

Alertmanager forwards this to PagerDuty/Slack with the pod identity. On-call clicks the link, gets the profile, has the answer in seconds.

The "profile URL" requires standing up a service that proxies `/debug/pprof/goroutine` from any pod through Kubernetes API. Several open-source pprof exporters do this; or write a 50-line proxy yourself.
</details>

---

### Exercise 10 — Reduce STW pause time for goroutine profile capture

**Starting code.** A service has 5 million goroutines (rare but real, e.g. a fan-out broker). `pprof.Lookup("goroutine").WriteTo(_, 0)` causes a 300 ms latency blip on every capture.

**Target.** Sub-50 ms STW pause.

<details><summary>Solution</summary>

This is a hard problem and Go runtime maintainers have made progress in 1.19+. Options:

1. **Upgrade Go.** Go 1.19+ changes the goroutine profile collection to not require a full STW; it preempts goroutines individually. This alone can drop the pause by 5x or more.
2. **Cap captures.** Sample only N goroutines instead of all. The Go runtime offers no first-class way to do this; you would have to implement it as a wrapper that breaks the iteration early — losing some samples.
3. **Avoid full captures during high-traffic windows.** Only capture during off-peak.
4. **Architect away from 5M goroutines.** Often the right answer: fan-out brokers can be redesigned with pools and channels rather than one goroutine per stream.

Option 1 is the cheap win. Options 3–4 are the structural answers.
</details>

---

### Exercise 11 — Detect leaks earlier by reducing test-run latency

**Starting code.** A monorepo has 800 Go packages. Full test suite takes 20 minutes. A new leak takes 20 minutes to surface after PR push.

**Target.** Surface new leaks within 5 minutes of push.

<details><summary>Solution</summary>

A few techniques:

1. **Affected-package detection.** Run only the packages whose files changed (or whose dependents changed). For a typical PR, this is a few packages, not all 800. Tools like `bazel`, `nx`, or custom Go-affected-pkgs scripts do this.
2. **Parallel CI.** Shard the test run across 10 runners; total wall time drops 10x.
3. **`-short` mode.** Mark slow tests with `t.Skip(testing.Short())` and run with `-short` in PR CI. Run the full suite (including slow tests) on merge to main.
4. **Leak-only fast pass.** A `TestMain` that uses `goleak.VerifyTestMain` but skips heavy tests (`-run TestQuickLeakCheck.*`) for a 30-second leak smoke test.

Combined, you can usually get a leak smoke test under 5 minutes.
</details>

---

### Exercise 12 — Profile capture without `net/http/pprof` for a binary that has no HTTP server

**Starting code.** A CLI batch job with no HTTP server has memory growth. You suspect leaks but cannot easily curl an endpoint.

**Target.** Capture a goroutine profile to disk on demand.

<details><summary>Solution</summary>

Option 1: signal handler.

```go
import (
    "os"
    "os/signal"
    "runtime/pprof"
    "syscall"
)

func init() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            f, err := os.Create(fmt.Sprintf("/tmp/goroutines-%d.txt", time.Now().Unix()))
            if err != nil {
                continue
            }
            _ = pprof.Lookup("goroutine").WriteTo(f, 2)
            f.Close()
        }
    }()
}
```

Now `kill -USR1 <pid>` writes a dump.

Option 2: `gops` agent.

```go
import "github.com/google/gops/agent"

func init() {
    _ = agent.Listen(agent.Options{})
}
```

Now `gops stack <pid>` works from another terminal.

Option 3: temp HTTP server bound to localhost only.

```go
go func() {
    _ = http.ListenAndServe("127.0.0.1:0", nil) // ephemeral port
}()
```

Look up the actual port (e.g. from `lsof -i :*` or `gops port`) and curl pprof.

All three avoid exposing anything to the network and add about ten lines of code.
</details>

---

## Stretch

### Exercise 13 — Replace `time.After` everywhere with a linter

**Starting code.** Several leaks have traced back to `time.After` in `select` statements that did not consume its channel. Reviews catch some but not all.

**Target.** A `go vet`-style linter that flags `time.After` inside `select` and proposes `time.NewTimer` + explicit `Stop`.

<details><summary>Solution</summary>

Use `analysispass` with a custom check:

```go
package timeafter

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/ast/inspector"
    "golang.org/x/tools/go/analysis/passes/inspect"
)

var Analyzer = &analysis.Analyzer{
    Name: "timeafterselect",
    Doc:  "flags time.After inside select statements",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:  run,
}

func run(pass *analysis.Pass) (any, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    insp.Preorder([]ast.Node{(*ast.SelectStmt)(nil)}, func(n ast.Node) {
        sel := n.(*ast.SelectStmt)
        for _, c := range sel.Body.List {
            cc := c.(*ast.CommClause)
            ast.Inspect(cc.Comm, func(node ast.Node) bool {
                call, ok := node.(*ast.CallExpr)
                if !ok { return true }
                if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
                    if x, ok := sel.X.(*ast.Ident); ok && x.Name == "time" && sel.Sel.Name == "After" {
                        pass.Reportf(call.Pos(), "time.After inside select leaks; use time.NewTimer with Stop")
                    }
                }
                return true
            })
        }
    })
    return nil, nil
}
```

Wire into your CI's `staticcheck`/`golangci-lint` pipeline. Now every `time.After` in a `select` gets a review comment automatically.
</details>

---

### Exercise 14 — Build a leak-fingerprint database

**Goal.** Every leak incident at your company has a stack signature. Build a tool that:

1. Hashes stack signatures.
2. On any new profile, looks up the hash against the database.
3. Reports "this leak signature was previously seen in incident #2347, fixed in commit abc123."

<details><summary>Solution sketch</summary>

```go
type Signature struct {
    Hash     string // hex of sha256 of top-5 frames
    Frames   []string
}

func hashStack(stack string) string {
    // pull top-5 frames, normalize, hash
}

// Pipeline: 
// - daily job dumps goroutine profile from each service
// - extracts unique signatures
// - compares against a Postgres table of (hash, first_seen_incident, fix_commit)
// - posts a Slack message per matched signature
```

This pays off after about a dozen incidents — the recurrence rate of "same leak class, different code" is surprisingly high.
</details>

---

## Mastery rubric

You have optimised leak detection well when:

- Your `go_goroutines` collection adds less than 0.1% CPU.
- Your slope-based alert has a false-positive rate under 1/day.
- Your CI catches new leaks within 5 minutes of push.
- Your STW pauses during profile capture are sub-100 ms even at high goroutine counts.
- You have a documented incident-response playbook that takes < 15 minutes from page to root cause.

When all five are true, return to the prevention story ([03-preventing-leaks](../03-preventing-leaks/)) to stop the leaks at the source, and the pprof tools deep-dive ([04-pprof-tools](../04-pprof-tools/)) for cross-profile mastery.
