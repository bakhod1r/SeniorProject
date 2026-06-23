---
layout: default
title: Find Bug
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/find-bug/
---

# tunny — Find the Bug

This file contains 12 buggy code snippets. Each one looks reasonable but has at least one significant bug.

For each, read the code, find the bug(s), and write down your diagnosis. Then read the explanation.

The bugs are a mix: goroutine leaks, race conditions, panics, deadlocks, performance disasters, and subtle correctness issues.

---

## Bug 1 — The Pool in the Handler

```go
func resize(w http.ResponseWriter, r *http.Request) {
    pool := tunny.NewFunc(4, doResize)
    defer pool.Close()

    body, _ := io.ReadAll(r.Body)
    out := pool.Process(body).([]byte)
    w.Write(out)
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** Pool is created per request. Each request spawns 4 worker goroutines and then closes them. The cost of pool construction (4 goroutines starting up) is paid every request. The whole point of a pool — reusing workers — is destroyed.

**Fix:** Hoist the pool to package level or a struct field, initialised once at startup. Pass it into the handler via closure or struct.

```go
type Server struct {
    pool *tunny.Pool
}

func (s *Server) resize(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    out := s.pool.Process(body).([]byte)
    w.Write(out)
}
```

---

## Bug 2 — Closing Twice

```go
func process() {
    pool := tunny.NewFunc(4, work)
    defer pool.Close()
    // ... do work
    pool.Close()
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** `Close` is called explicitly and then again by `defer`. The second `Close` panics with "close of closed channel".

**Fix:** Remove one of the two calls. Almost always: keep the `defer`, remove the explicit `Close`.

---

## Bug 3 — The Shared Buffer

```go
var sharedBuf bytes.Buffer

pool := tunny.New(4, func() tunny.Worker {
    return &worker{buf: &sharedBuf}
})
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** All 4 workers hold a pointer to the same buffer. When they call `buf.Write` concurrently, they race. Output is corrupted and/or the program panics.

**Fix:** Per-worker buffer:

```go
pool := tunny.New(4, func() tunny.Worker {
    return &worker{buf: &bytes.Buffer{}}
})
```

---

## Bug 4 — The Stale Cancel

```go
type worker struct {
    cancel context.CancelFunc
}

func (w *worker) Process(p any) any {
    ctx, cancel := context.WithCancel(context.Background())
    w.cancel = cancel
    return doWork(ctx, p)
}

func (w *worker) Interrupt() {
    if w.cancel != nil {
        w.cancel()
    }
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** Two bugs.

1. Race: `Process` writes `w.cancel` without synchronization; `Interrupt` reads it without synchronization. Race detector catches this.
2. Stale state: after `Process` returns, `w.cancel` still points at the old cancel. If `Interrupt` runs after `Process` (e.g. a delayed deadline fire), it cancels a no-op CancelFunc — harmless but indicative.

**Fix:** Add a mutex; set `w.cancel = nil` after Process completes.

```go
type worker struct {
    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *worker) Process(p any) any {
    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()
    return doWork(ctx, p)
}

func (w *worker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}
```

---

## Bug 5 — Unbounded Body

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    result := pool.Process(body)
    w.Write(result.([]byte))
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** `io.ReadAll` reads the entire body. An attacker can send a 100 GB body and OOM the process before reaching `Process`.

**Fix:** Wrap with `http.MaxBytesReader`:

```go
r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024) // 10 MB cap
body, err := io.ReadAll(r.Body)
if err != nil {
    http.Error(w, "body too large", 413)
    return
}
```

---

## Bug 6 — The Recursive Pool

```go
pool := tunny.NewFunc(4, func(p any) any {
    job := p.(Job)
    sub := pool.Process(job.SubJob) // recursive call
    return process(job, sub)
})
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** Deadlock under load. If all 4 workers are processing top-level jobs that each call `pool.Process` for sub-jobs, no workers are free to serve the sub-jobs. The system stops making progress.

**Fix:** Use a separate pool for sub-jobs, or restructure so sub-work runs inline (without re-entering the pool).

---

## Bug 7 — Mutex Held During Process

```go
var mu sync.Mutex

mu.Lock()
result := pool.Process(payload)
mu.Unlock()
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** The mutex is held for the duration of the Process call. If `Process` blocks (waiting for a worker, or doing actual work), the mutex is held throughout. Other goroutines wanting the mutex are blocked, even if they could otherwise run.

**Fix:** Release the mutex before calling Process if the protected state is not needed during the call:

```go
mu.Lock()
payload := buildPayload()
mu.Unlock()

result := pool.Process(payload)

mu.Lock()
processResult(result)
mu.Unlock()
```

---

## Bug 8 — Captured Loop Variable

```go
for i := 0; i < 10; i++ {
    go func() {
        result := pool.Process(i)
        fmt.Println(result)
    }()
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** The goroutine captures `i` by reference. By the time the goroutines run, `i` is likely 10. All goroutines may print the same value.

(In Go 1.22+, loop variables are per-iteration. This bug exists only in Go ≤ 1.21.)

**Fix:** Shadow the variable:

```go
for i := 0; i < 10; i++ {
    i := i // shadow
    go func() {
        result := pool.Process(i)
        fmt.Println(result)
    }()
}
```

Or use the modern form: in Go 1.22+ this is automatic.

---

## Bug 9 — Worker Spawns Background Goroutine

```go
type worker struct{}

func (w *worker) Process(p any) any {
    go func() {
        // do something asynchronously
        sendMetric()
    }()
    return work(p)
}

func (w *worker) BlockUntilReady() {}
func (w *worker) Interrupt()        {}
func (w *worker) Terminate()        {}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** Each `Process` spawns a fire-and-forget goroutine. These goroutines have no lifecycle. If `sendMetric` blocks, they accumulate indefinitely. Even if it does not block, they outlive `Process` and may outlive the pool.

**Fix:** Make the background work synchronous (run it inside `Process`), or track lifetimes explicitly (worker-level `sync.WaitGroup`, exit signal).

---

## Bug 10 — Worker Modifies Payload

```go
pool := tunny.NewFunc(4, func(p any) any {
    s := p.(*State)
    s.Count++
    return s
})

state := &State{Count: 0}
go pool.Process(state)
go pool.Process(state)
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** Two goroutines pass the same `*State` to the pool. Both workers modify `s.Count` concurrently. Race condition on `s.Count`.

**Fix:** Either:

1. Pass values, not pointers (the worker mutates a copy):

```go
type State struct { Count int }
pool.Process(state) // by value
```

2. Synchronize access:

```go
s := p.(*State)
atomic.AddInt64(&s.Count, 1)
```

3. Give each call its own state.

---

## Bug 11 — Forgetting to Close on Error

```go
func main() {
    pool := tunny.NewFunc(4, work)

    cfg, err := loadConfig()
    if err != nil {
        log.Fatal(err)
    }

    defer pool.Close()
    // ...
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** `defer pool.Close()` is placed AFTER the `log.Fatal` line. If `loadConfig` fails, `log.Fatal` exits the program before `defer` registers. The pool's workers leak — but since the process exits, it does not matter. However, the pattern is fragile.

The real issue: the `defer` should be immediately after `NewFunc` so it covers all error paths.

**Fix:**

```go
pool := tunny.NewFunc(4, work)
defer pool.Close()

cfg, err := loadConfig()
if err != nil {
    log.Fatal(err)
}
// ...
```

For programs that exit via `log.Fatal`, this matters less because the process tears down. For non-fatal error paths, it matters a lot.

---

## Bug 12 — Wrong Type Assertion

```go
pool := tunny.NewFunc(4, func(p any) any {
    s := p.(string)
    return len(s)
})

n := pool.Process("hello").(int)
fmt.Println(n)
// later:
n2 := pool.Process(42).(int)
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** The second call passes `42` (int) to a pool expecting `string`. Inside `Process`, `p.(string)` panics. The panic crashes the entire process (tunny does not catch panics).

**Fix:** Defensive type assertion with comma-ok form:

```go
s, ok := p.(string)
if !ok {
    return fmt.Errorf("expected string, got %T", p)
}
return len(s)
```

Better: wrap the pool in a typed adapter so the compiler enforces the type.

---

## Summary

Twelve bugs covering the common categories:

- Pool lifecycle (created in handler, double-close, no defer)
- Sharing state (shared buffer, mutated payload, mutex during Process)
- Cancellation (stale cancel, race between Process and Interrupt)
- Resource exhaustion (unbounded body, recursive pool)
- Goroutine leaks (background goroutines, captured loop variables)
- Type safety (wrong type assertion, panic from bad input)

If you can spot all twelve at a glance, you have internalised the major tunny pitfalls.

---

## Bonus Bug — A Subtle One

```go
pool := tunny.New(4, func() tunny.Worker {
    return &myWorker{buf: make([]byte, 64*1024)}
})

func (w *myWorker) Process(p any) any {
    data := p.([]byte)
    copy(w.buf, data) // copy
    return w.buf      // return!
}
```

**What is wrong?**

(scroll down)

.

.

.

.

.

.

.

.

.

.

**Diagnosis:** The worker returns its own internal buffer. The caller receives a slice pointing into the worker's memory. On the next `Process` call, the worker overwrites that memory. The previous caller's result is corrupted.

**Fix:** Copy before returning:

```go
out := make([]byte, len(data))
copy(out, w.buf[:len(data)])
return out
```

This is a classic shared-buffer bug. Surprisingly common in production code.

---

## Closing Notes

These bugs are all from real production code (or close adaptations). Each has caused real outages.

The pattern: simple-looking code with non-obvious concurrency issues. The remedy: careful review, race detector in CI, paranoid panic recovery.

Read this file again in 6 months. You will spot bugs in your own code that you missed today.

End of find-bug exercises.

---

## Appendix — A Few More to Practice

### Mini-bug 1

```go
type w struct{}
func (w) Process(p any) any { return nil }
func (w) BlockUntilReady() {}
func (w) Interrupt()       {}
// missing Terminate!
```

Does not compile. The compiler enforces all four methods.

### Mini-bug 2

```go
pool := tunny.NewFunc(0, work)
```

Panics: pool size must be >= 1.

### Mini-bug 3

```go
pool := tunny.NewFunc(4, nil)
```

Panics: nil function.

### Mini-bug 4

```go
result := pool.Process(nil)
result.(int) // nil cannot be cast to int
```

Panics: type assertion failure. Always check with comma-ok form.

### Mini-bug 5

```go
go func() {
    pool.Close()
}()
pool.Process(x)
```

Race between `Close` and `Process`. May panic.

These mini-bugs round out the set. Spot them in real code.

---

End of find-bug.
