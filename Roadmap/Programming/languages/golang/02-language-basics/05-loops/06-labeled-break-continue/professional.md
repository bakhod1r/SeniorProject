# Go Labeled Break and Continue — Professional / OSS Patterns

## 1. Overview

This document surveys real production uses of labelled `break`/`continue` across the Go standard library, well-known OSS projects, and lint rules that affect their style. The goal is to show where labelled jumps are idiomatic, where they signal a refactor opportunity, and what tooling exists to enforce a consistent style.

---

## 2. Standard Library Patterns

### 2.1 `net/http` — Server Shutdown

`src/net/http/server.go` contains many `for { select { ... } }` loops that need a label to break out cleanly. A characteristic shape:

```go
// Sketch matching the style used in net/http
Loop:
for {
    select {
    case <-srv.getDoneChan():
        break Loop
    case c := <-conns:
        go c.serve(ctx)
    }
}
```

The label here is the only correct way out. A plain `break` would only exit the `select`.

### 2.2 `encoding/json` — Decoder State Machine

`src/encoding/json/decode.go` and related files use labelled loops for parsing object members and array elements. The decoder's state-machine loops over tokens, using `break` to exit the current container and `continue` to advance to the next member.

A representative pattern (paraphrased):

```go
// Read object members
ObjLoop:
for d.opcode != scanEndObject {
    if d.opcode != scanBeginLiteral {
        // ...
        break ObjLoop
    }
    // ...
    d.scanWhile(scanSkipSpace)
    if d.opcode == scanEndObject {
        break ObjLoop
    }
    // continue ObjLoop on comma
}
```

The label clarifies that the parser is exiting the object-level scan, not just an inner conditional.

### 2.3 `cmd/compile/internal` — Walk Pass

`src/cmd/compile/internal/walk/stmt.go` itself uses labelled `break` and `continue` to traverse statement trees. The compiler is its own user.

### 2.4 `runtime` — Scheduler

`src/runtime/proc.go` uses labelled loops in the scheduler — for example, when the run queue check or the network poller integration requires breaking out of a multi-level loop on shutdown or stop-the-world.

### 2.5 `bufio.Scanner` Token Loops

`src/bufio/scan.go` uses simple labelled loops inside the `Scan` flow when buffer growth and refills require non-trivial early exits.

---

## 3. OSS Project Patterns

### 3.1 Kubernetes API Server

The Kubernetes apiserver (`kubernetes/staging/src/k8s.io/apiserver`) makes heavy use of `for { select { } }` loops in:

- **Watch handlers**: clients receive events; the loop exits on `ctx.Done()` or stream end via `break Loop`.
- **Workqueue processors**: the worker pulls items, processes, and exits on shutdown signals via `break Loop`.

Without the label, the workers would hang on shutdown.

### 3.2 Prometheus TSDB Tombstones

In `prometheus/tsdb/tombstones`, scanning a sorted list of tombstones uses labelled `continue` to skip to the next series when the current series is fully covered:

```go
SeriesLoop:
for _, ref := range refs {
    for _, t := range tombstones[ref] {
        if t.Mint > maxTime {
            continue SeriesLoop
        }
        // ...
    }
    // process ref
}
```

The label keeps the per-series logic tight.

### 3.3 etcd MVCC Compaction

etcd's compaction in `mvcc/kvstore_compaction.go` walks revisions across keys, using a labelled break to exit the entire scan when a budget is exhausted:

```go
Compact:
for _, key := range keys {
    for _, rev := range revisions[key] {
        if budget <= 0 {
            break Compact
        }
        // ...
        budget--
    }
}
```

### 3.4 Consul Service Discovery

Consul's service-watch loop uses `for { select { } }` with a label `Loop:` to exit on agent shutdown.

### 3.5 CockroachDB SQL Planner

In `cockroachdb/cockroach`, the SQL planner uses labelled loops in expression-tree traversal. When a particular subtree exceeds depth or matches a stop condition, a labelled break exits the recursion driver loop.

---

## 4. When To Use a Label vs. Refactor

### 4.1 Label Wins When the Inner Block Uses Many Outer Locals

```go
total := 0
errors := 0
warnings := 0
Scan:
for _, batch := range batches {
    for _, item := range batch.Items {
        if item.Critical {
            errors++
            break Scan
        }
        if item.Warn {
            warnings++
            continue
        }
        total += item.Qty
    }
}
```

Extracting the inner block would require passing/returning `total`, `errors`, `warnings`. The label is cleaner.

### 4.2 Refactor Wins When the Inner Block Is Self-Contained

```go
// Before
Search:
for _, row := range grid {
    for _, v := range row {
        if v == target {
            result = v
            break Search
        }
    }
}

// After
result, ok := find(grid, target)

func find(grid [][]int, t int) (int, bool) {
    for _, row := range grid {
        for _, v := range row {
            if v == t {
                return v, true
            }
        }
    }
    return 0, false
}
```

The helper's name documents the intent (`find`) and `return` plays the role of `break Search`.

### 4.3 Both Are Acceptable for `for { select { } }` Quit

```go
Loop:
for {
    select {
    case <-quit: break Loop
    case j := <-jobs: handle(j)
    }
}
```

vs.

```go
func runUntilQuit(jobs <-chan Job, quit <-chan struct{}) {
    for {
        select {
        case <-quit: return
        case j := <-jobs: handle(j)
        }
    }
}
```

The function form may be cleaner if the loop is the entire body. The label form is fine when there is more work after the loop.

---

## 5. Lint Rules and Style

### 5.1 `staticcheck` SA5004

`SA5004: "for { select { ... default: } }" should not have an empty default that prevents blocking`

Not directly about labels, but related: the canonical labelled-break-from-select pattern intentionally has no `default:`. SA5004 catches the mistake of adding a `default:` that defeats the blocking semantics.

### 5.2 `staticcheck` and Unused Labels

Unused labels are caught by the **compiler itself** (not staticcheck) — `label X defined and not used`. No lint rule needed.

### 5.3 `revive` Style Rules

`revive` does not have a dedicated rule for labels. Style guidelines recommend:

- Capitalize label names.
- Keep label names short (one or two words).
- Use distinct names when multiple labels exist in a function.

### 5.4 `gocritic` and Refactoring Hints

`gocritic` may warn on patterns like flag-variable simulation:

```go
done := false
for ... {
    for ... {
        if cond { done = true; break }
    }
    if done { break }
}
```

Some linters suggest a labelled break here.

### 5.5 `golangci-lint` Composite

A typical project configuration includes both `staticcheck` and `revive`. Together they catch the most common label-related issues, but the compiler does the heavy lifting.

---

## 6. Code Review Heuristics

When reviewing labelled `break`/`continue`:

1. **Is the label necessary?** A `for { select { ... } }` loop almost always wants one for clean shutdown.
2. **Is the label name descriptive?** `Loop` is fine for `for-select` quit. `Search`, `Scan`, `Group` are good for nested-loop exits.
3. **Could extraction be cleaner?** If the inner block is large or self-contained, a helper with `return` may be better.
4. **Does the labelled exit leave invariants consistent?** Look for partial writes followed by `break L`.
5. **Are there multiple labels?** If yes, ensure their names do not collide visually.

---

## 7. Testing Labelled Paths

Always test the early-exit path:

```go
func TestSearchFound(t *testing.T) {
    g := [][]int{{1, 2}, {3, 4}, {5, 6}}
    i, j, ok := searchGrid(g, 4)
    if !ok || i != 1 || j != 1 {
        t.Errorf("got %d,%d,%v want 1,1,true", i, j, ok)
    }
}

func TestSearchNotFound(t *testing.T) {
    g := [][]int{{1, 2}, {3, 4}}
    if _, _, ok := searchGrid(g, 99); ok {
        t.Error("found should be false")
    }
}
```

Both the labelled-break path and the no-match path must be exercised.

For `for { select { } }` loops, write a test that closes the quit channel and asserts the goroutine exits within a deadline:

```go
func TestWorkerExits(t *testing.T) {
    quit := make(chan struct{})
    done := make(chan struct{})
    go func() {
        runWorker(quit)
        close(done)
    }()
    close(quit)
    select {
    case <-done:
    case <-time.After(time.Second):
        t.Fatal("worker did not exit")
    }
}
```

If the label is wrong (or missing), the test detects the leak.

---

## 8. Performance Notes

### 8.1 Identical Code Generation

```go
// Version A: labelled
Outer:
for _, x := range xs {
    if cond(x) {
        break Outer
    }
}

// Version B: unlabelled
for _, x := range xs {
    if cond(x) {
        break
    }
}
```

Both produce the same machine code. A label adds zero cost.

### 8.2 Flag-Variable Penalty

The flag-variable anti-pattern adds a branch per outer iteration:

```go
done := false
for ... {
    for ... {
        if cond { done = true; break }
    }
    if done { break }      // extra branch every outer iteration
}
```

A labelled break avoids the per-iteration check. The savings are tiny but real.

### 8.3 `for { select { } }` Latency

The label has no impact on `select` latency. The cost of labelled break is one unconditional jump after `select` returns.

---

## 9. Real-World Code Snippets

### 9.1 etcd-Style Watch Loop

```go
func (s *server) watch(ctx context.Context, key string) {
    events := s.subscribe(key)
    defer s.unsubscribe(events)

Loop:
    for {
        select {
        case <-ctx.Done():
            break Loop
        case ev, ok := <-events:
            if !ok {
                break Loop
            }
            s.deliver(ev)
        }
    }
    s.flush()
}
```

The label is the only correct exit; both `ctx.Done()` and `!ok` need it.

### 9.2 Prometheus-Style Series Filter

```go
SeriesLoop:
for _, ref := range refs {
    metrics := s.getMetrics(ref)
    for _, m := range metrics {
        if m.Stale() {
            continue SeriesLoop
        }
    }
    s.flush(ref, metrics)
}
```

A stale metric causes the entire series to be skipped — `continue SeriesLoop` is exactly that.

### 9.3 Kubernetes-Style Workqueue

```go
func (c *Controller) runWorker(ctx context.Context) {
Loop:
    for {
        item, shutdown := c.queue.Get()
        if shutdown {
            break Loop
        }
        c.process(item)
    }
}
```

Shutdown signals via the queue, and the label terminates the loop.

### 9.4 Compiler-Style Token Loop

```go
Tokens:
for {
    tok := scanner.Next()
    switch tok.Kind {
    case TokEOF:
        break Tokens
    case TokComment:
        continue Tokens
    case TokIdent:
        consumeIdent(tok)
    }
}
```

`break Tokens` exits on EOF; `continue Tokens` skips comments. A plain `break`/`continue` would target the `switch`, which is wrong.

---

## 10. When NOT To Use a Label

### 10.1 Single-Level Loop

No nested structure, no `for { select { } }`:

```go
for _, x := range xs {
    if cond(x) {
        break
    }
}
```

Adding a label here is noise.

### 10.2 The Inner Block Is Reusable

If the inner block has a clear name, extract it:

```go
v, ok := find(xs, target)
```

### 10.3 Deep Nesting

If you find yourself wanting `break OuterMost` from a fourth-level inner loop, the code is too deep. Refactor.

---

## 11. Style Guidelines Summary

1. **Capitalize labels**: `Outer`, `Loop`, `Search`.
2. **Place labels on their own line**.
3. **Use distinct names** when there are multiple labels in a function.
4. **Comment** when the label's role is not obvious.
5. **Prefer labelled break over flag variables**.
6. **Prefer extraction with early return** when the inner block is self-contained.
7. **Always label `for { select { } }` loops** that need to exit on a signal.
8. **Test the labelled-exit path** explicitly.

---

## 12. Self-Assessment Checklist

- [ ] I have read real OSS code that uses labelled break/continue
- [ ] I can identify when a label is the right tool vs. when extraction is better
- [ ] I know the canonical `for { select { } }` quit pattern
- [ ] I follow style guidelines (capitalization, placement, naming)
- [ ] I write tests for labelled-exit paths
- [ ] I avoid flag variables that simulate labelled jumps
- [ ] I know lint rules that interact with labels (SA5004, revive style)

---

## 13. Summary

Labelled `break`/`continue` is alive and well in production Go: standard library parsers and servers, Kubernetes workers, Prometheus tombstones, etcd compaction, CockroachDB planners. The dominant pattern is `for { select { ... } }` quit; the second is nested-loop early exit. Lint rules touch tangential concerns (SA5004 on empty `default:`); the compiler itself catches unused labels. Style guidelines favor capitalized names, distinct identifiers per label, and extraction over labels when the inner block is self-contained. The performance cost is zero — the choice is purely about clarity.

---

## 14. Further Reading

- [`net/http/server.go` — for-select shutdown](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/net/http/server.go)
- [`encoding/json/decode.go` — labelled scan loops](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/encoding/json/decode.go)
- [`cmd/compile/internal/walk/stmt.go`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/walk/stmt.go)
- [Kubernetes apiserver](https://github.com/kubernetes/kubernetes/tree/master/staging/src/k8s.io/apiserver)
- [Prometheus TSDB](https://github.com/prometheus/prometheus/tree/main/tsdb)
- [etcd MVCC](https://github.com/etcd-io/etcd/tree/main/server/mvcc)
- [CockroachDB SQL planner](https://github.com/cockroachdb/cockroach/tree/master/pkg/sql)
- [Effective Go — Control structures](https://go.dev/doc/effective_go#control-structures)
- [`staticcheck` SA5004](https://staticcheck.dev/docs/checks/#SA5004)
- [`revive` rules](https://github.com/mgechev/revive)
