# Deterministic Testing — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why does my concurrent test pass on my laptop but fail in CI? How do I write a test that does the same thing every time?"

A test is supposed to be a contract: "this code, given this input, produces this output." Sequential tests honour the contract by default. Concurrent tests do not, because the Go scheduler is free to interleave goroutines in any order the runtime finds convenient, and that order changes between runs.

Consider a test that starts a goroutine to update a counter and then reads the counter. Sometimes the goroutine runs first and the read sees the new value. Sometimes the read runs first and sees the old value. Same code, same input, two different outputs. That is a **flaky test**. Flaky tests are not a quirk; they are a signal that you are testing a property the code does not actually guarantee, or that you are reading state at the wrong moment.

The cure is **determinism**: design the test so that no matter how the scheduler interleaves goroutines, the test sees the same result. This is harder than it sounds, but the tools and the discipline are learnable.

After reading this file you will:

- Know why the same concurrent test can produce different outputs on different runs.
- Know the cardinal rule: **never use `time.Sleep` to synchronise a test**.
- Know how to use channels and `sync.WaitGroup` to create explicit synchronisation points.
- Know how to run a test 100 times in a row to catch flakes early (`-count=100`).
- Be able to rewrite your first flaky test into a deterministic one.
- Recognise the warning signs of a non-deterministic test design.

You do not need to know about `testing/synctest`, fake clocks, or harness design yet. Those come at middle, senior, and professional levels. This file is about the moment you write `go f()` inside a test and realise you have no idea whether `f` has finished.

---

## Prerequisites

- **Required:** Go 1.18+; 1.22+ is ideal because `t.Run` and subtests are well-supported. For `testing/synctest` content later, Go 1.24+.
- **Required:** Comfort with the `testing` package: `func TestXxx(t *testing.T)`, `t.Fatal`, `t.Errorf`, table tests, `go test ./...`.
- **Required:** A working mental model of goroutines and channels at junior level. If you do not know how `chan struct{}` is used as a signal, read `01-goroutines/01-overview` and `03-channels/01-overview` first.
- **Required:** Familiarity with `sync.WaitGroup` and `sync.Mutex`. You should be able to write `wg.Add(1); go func() { defer wg.Done(); ... }(); wg.Wait()` without looking it up.
- **Helpful:** Some prior pain. Most engineers learn determinism the hard way, after a flaky test wakes them at 3 a.m. If you have already lived that, the lessons stick.

You do not need to have seen `testing/synctest`, `clockwork`, or `goleak` before. We will introduce each one when it appears.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Flaky test** | A test that passes and fails on the same code, depending on timing, scheduler choice, or external state. Flakiness is a defect in the test, not a "transient." |
| **Determinism** | The property of producing the same output on every run for the same input. A deterministic test is reproducible. |
| **Scheduler non-determinism** | The Go runtime is free to choose any legal interleaving of goroutines. Your test must not depend on a specific one. |
| **Synchronisation point** | An explicit moment where the test goroutine waits for another goroutine to reach a known state. Channels, `WaitGroup.Wait`, and condition variables create synchronisation points. |
| **Sleep-based synchronisation** | Using `time.Sleep` to "wait long enough" for a goroutine to do something. This is the most common cause of flaky tests and is forbidden. |
| **Quiescent state** | A moment when all goroutines in the test are blocked or idle. Some tools (notably `testing/synctest`) let you detect this. |
| **Test barrier** | A channel or `WaitGroup` used solely to coordinate goroutines inside a test. Not part of the code under test. |
| **`testing/synctest`** | An experimental Go 1.24+ package that gives tests a controlled scheduler and a virtual clock. |
| **Fake clock** | A `Clock` interface implementation that the test advances manually, instead of using real wall-clock time. |
| **`-count=N`** | A `go test` flag that runs each test N times. Useful for catching flakes that only show up sometimes. |
| **`-race`** | The race detector. Complements determinism: a deterministic test that races is still wrong. |
| **`GOMAXPROCS`** | The number of OS threads available to run goroutines. Setting it to 1 reduces but does not eliminate non-determinism. |

---

## Core Concepts

### The scheduler is free; your test cannot be

When you write `go f()` inside a test, the Go runtime does not promise when `f` runs. It may run before the next line of the test, or after, or interleaved with it. Two consecutive test runs can pick two different interleavings. If the test assertion depends on a specific interleaving, the test is non-deterministic.

```go
func TestCounter_Flaky(t *testing.T) {
    var c int
    go func() { c++ }()
    if c != 1 {
        t.Fatal("expected 1, got", c)
    }
}
```

This test will almost always fail, because the goroutine has not run yet. The naive "fix" is to add `time.Sleep(10 * time.Millisecond)`. That makes the test pass *most* of the time on *some* machines. On a slow CI runner under load it will fail again. The real fix is to wait for the goroutine explicitly.

### A test is a contract; flakiness violates the contract

Every test answers a yes-or-no question: "does the code under test satisfy this property?" Flakiness turns the answer into "sometimes yes, sometimes no." That is not a test — that is a coin flip. Worse, flaky tests train engineers to retry on red, which masks real regressions.

A team that tolerates flakes will eventually ship a bug because nobody trusted the failing test. Deterministic testing is therefore not an aesthetic preference; it is a safety property of your engineering culture.

### The cardinal rule: never `time.Sleep` to synchronise

If you find yourself writing `time.Sleep` inside a test for any reason other than "I am explicitly testing time-dependent behaviour with a fake clock," stop. You are about to ship a flaky test.

Sleep is a guess. "100 milliseconds ought to be enough." On a 32-core M3 with no load, yes. On a CI runner under contention, no. On a Raspberry Pi, definitely not. Sleep does not synchronise; it merely makes the bug less frequent.

The replacement is always a real synchronisation primitive: a channel, a `WaitGroup`, a `sync.Cond`, or `testing/synctest.Wait`. We will see each.

### Synchronisation barriers are explicit in the test

A barrier is a point where the test pauses until the system under test (or a helper goroutine) reaches a known state. The simplest barrier in Go is a channel:

```go
done := make(chan struct{})
go func() {
    work()
    close(done)
}()
<-done // barrier: wait until work() returns
```

After `<-done` returns, you know `work()` has finished. The next assertion can read state safely. The test now produces the same result every run, regardless of how the scheduler interleaves things.

### Quiescent state: "every goroutine is blocked"

A more sophisticated barrier asks: "is every goroutine in my test currently blocked, waiting for something?" If yes, the system has reached a stable point, and the test can observe state. The runtime cannot detect this directly in arbitrary code, but `testing/synctest.Wait` (Go 1.24+) does exactly this inside a synctest bubble.

At junior level you do not need synctest; channels and WaitGroups cover 90% of cases. But know the term: when a senior engineer says "wait for quiescence," they mean "wait until no goroutine is making progress."

### `-count=N` catches flakes early

A test that fails 1 time in 1000 looks green most of the time. To find it, run:

```
go test -count=100 -run TestSpecific ./mypackage
```

If any of the 100 runs fails, the test is flaky. Modern CI pipelines run a "stress" job nightly with `-count=100` or `-count=1000`. Flakes uncovered in stress are fixed before they show up in regular CI.

Combine with `-race` for double the signal:

```
go test -count=100 -race -run TestSpecific ./mypackage
```

If 100 runs pass under `-race`, you have strong evidence the test is both correct and stable.

### The race detector and determinism are complementary

The race detector finds *data races* — concurrent accesses to the same variable, at least one of which is a write, without a happens-before edge. A deterministic test can still race; a non-racing test can still flake. You need both:

- `-race` to prove the code is correctly synchronised.
- Deterministic test design to prove the test always observes the same outcome.

A passing `go test -race -count=100` is the gold standard at junior level.

---

## Real-World Analogies

### A flaky test is a coin toss labelled "yes"

Imagine asking a friend "do you want pizza?" and they flip a coin, then say "yes" or "no" based on the flip. The answer is meaningless. A flaky test is the same: the green tick tells you nothing because the next run might be red. Determinism removes the coin.

### Synchronisation is a doorbell, not a watch

Sleeping `100ms` then knocking is like saying "I think they will be home in 100 milliseconds; let me knock now." A doorbell is different: you press it, and they answer when they are ready. Channels and WaitGroups are doorbells. `time.Sleep` is a watch — and the watch is wrong.

### Tests are a fence, not a net

A non-deterministic test is a net with holes: some bugs pass through. A deterministic test is a fence: nothing gets past it that does not satisfy the property under test. You want fences, not nets.

### A scheduler is a referee with no calls to make

Imagine a sports referee who has no formal rules to enforce: they simply decide each play in whatever order amuses them. That is the Go scheduler from a test's perspective. The test must produce the right answer regardless of which order the referee picks.

---

## Mental Models

### The "snapshot at a barrier" model

Concurrent state is constantly changing. The test only observes it at specific moments — at barriers. Choose those moments deliberately. Between barriers, treat state as undefined. After a barrier, treat state as readable.

```
[start] ---- goroutine work ---- [barrier: <-done] ---- [assert]
```

The assertion runs after the barrier, never between. If you find yourself asserting in the middle, you are asking the scheduler to be your friend. It will not be.

### The "drain everything" model

Many concurrent systems are pipelines: input flows in, output flows out. To test them deterministically, drain the output before asserting. Close the input, wait for the output channel to close, then assert on the collected results. No timing involved.

### The "controlled goroutine" model

The system under test should never spawn an unbounded number of goroutines that the test cannot wait for. If it does, refactor: expose a `Close()` or a `Wait()` so the test has a barrier. If you cannot refactor (third-party code), wrap it.

### The "virtual time" model

Real time is hostile to determinism. Virtual time, where the test controls the clock, is friendly. Replace `time.Now`, `time.After`, `time.NewTimer` with a `Clock` interface. The test injects a fake clock and calls `clock.Advance(5 * time.Second)` to make a timeout fire. We meet this in middle.md.

---

## Pros & Cons

### Pros of deterministic tests

- **Reproducible failures.** A failing test fails the same way every time, so you can debug it.
- **CI confidence.** Green builds mean working code, not lucky scheduling.
- **Faster.** Deterministic tests do not need long sleeps; they often run in microseconds.
- **Stress-resistant.** They pass under load, on slow runners, on 1 CPU, on 64 CPUs.
- **Cheaper.** No retry storms, no on-call wakeups for "the flaky one."

### Cons of deterministic tests

- **More test code.** A channel-based barrier is more lines than `time.Sleep(100*time.Millisecond)`.
- **Requires designing code for testability.** Hard-coded `time.Now` calls have to be refactored. Internal-only goroutines need an observation point.
- **Steeper learning curve.** Engineers must understand channels, WaitGroups, and ideally `testing/synctest` to write good tests.
- **Sometimes overkill for trivial code.** A sequential function test does not need any of this.

The net is overwhelmingly positive on any non-trivial codebase. Flaky tests cost more than careful tests.

---

## Use Cases

- **Testing a worker pool.** Submit N tasks, close the input, drain the output, assert.
- **Testing a producer-consumer.** Use channel close as the completion barrier.
- **Testing a cache with TTL.** Inject a fake clock; advance time to expire entries; assert.
- **Testing a retry-with-backoff loop.** Inject a fake clock; advance time across each backoff; assert the call count.
- **Testing a rate limiter.** Inject a fake clock; advance time to refill the bucket.
- **Testing a debouncer / throttle.** Same — fake clock, no real sleeps.
- **Testing a circuit breaker.** Force opens/closes by injecting failures; advance clock to expire the open state.
- **Testing context cancellation.** Cancel; wait on a done channel; assert.

If a behaviour depends on either goroutine scheduling or wall-clock time, deterministic testing is the right approach.

---

## Code Examples

### Example 1: The classic flaky test

```go
// BAD: relies on the goroutine running before the assertion.
func TestSet_Flaky(t *testing.T) {
    s := NewSet()
    go s.Add(42)
    if !s.Contains(42) {
        t.Fatal("expected 42 in set")
    }
}
```

This test passes maybe 10% of the time. The goroutine has barely started by the time `Contains` runs. Even with `time.Sleep(10*time.Millisecond)` it stays flaky under load.

### Example 2: Channel barrier

```go
// GOOD: explicit barrier.
func TestSet_Deterministic(t *testing.T) {
    s := NewSet()
    done := make(chan struct{})
    go func() {
        s.Add(42)
        close(done)
    }()
    <-done
    if !s.Contains(42) {
        t.Fatal("expected 42 in set")
    }
}
```

Now the test always passes: the assertion runs strictly after `Add` returns.

### Example 3: `sync.WaitGroup` for N goroutines

```go
// GOOD: wait for many goroutines at once.
func TestSet_ManyAdds(t *testing.T) {
    s := NewSet()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            s.Add(v)
        }(i)
    }
    wg.Wait()
    if got := s.Len(); got != 100 {
        t.Fatalf("expected 100, got %d", got)
    }
}
```

`wg.Wait()` is the barrier; the assertion runs after every Add returns.

### Example 4: Closing a channel as a "done" signal

```go
// GOOD: drain channel to learn when work is done.
func TestPipeline(t *testing.T) {
    in := make(chan int)
    out := process(in) // process closes out when in is closed

    go func() {
        for _, v := range []int{1, 2, 3} {
            in <- v
        }
        close(in)
    }()

    var got []int
    for v := range out {
        got = append(got, v)
    }
    want := []int{2, 4, 6}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v want %v", got, want)
    }
}
```

Range over `out` completes exactly when `out` is closed. No sleep.

### Example 5: Detecting flakes with `-count`

```bash
$ go test -count=100 -race -run TestPipeline ./worker
ok      example.com/worker      0.412s
```

100 consecutive runs, all pass, race-free. Confidence: high.

### Example 6: A test that should not exist

```go
// VERY BAD.
func TestSomething(t *testing.T) {
    go startWorker()
    time.Sleep(2 * time.Second)
    // assertion
}
```

Two seconds of sleep is two seconds of test budget wasted, and it is still flaky. Refactor `startWorker` to return a "ready" channel or accept a `done` channel.

### Example 7: Sleep replaced by Wait

```go
// BEFORE
func TestStart(t *testing.T) {
    s := NewServer()
    go s.Run()
    time.Sleep(100 * time.Millisecond) // hope server has started
    s.Ping()
}

// AFTER
func TestStart(t *testing.T) {
    s := NewServer()
    ready := make(chan struct{})
    go func() {
        s.RunWithReady(ready)
    }()
    <-ready
    s.Ping()
}
```

Now the server reports when it is ready. The test waits for that signal, not a guess.

### Example 8: Setting GOMAXPROCS=1 (limited help)

```go
func TestMain(m *testing.M) {
    runtime.GOMAXPROCS(1)
    os.Exit(m.Run())
}
```

This reduces parallelism but does not eliminate non-determinism: the scheduler still preempts. Use it as a *signal* that you are over-relying on parallel execution, not as a fix.

### Example 9: Repeating a test programmatically

```go
func TestRepeat(t *testing.T) {
    for i := 0; i < 100; i++ {
        t.Run(fmt.Sprintf("iter-%d", i), func(t *testing.T) {
            // body
        })
    }
}
```

Equivalent to `-count=100` but visible in test output. Use sparingly; CI flag is cleaner.

### Example 10: A handler with deterministic shutdown

```go
type Worker struct {
    in   chan Task
    done chan struct{}
}

func New() *Worker {
    w := &Worker{
        in:   make(chan Task, 10),
        done: make(chan struct{}),
    }
    go w.loop()
    return w
}

func (w *Worker) loop() {
    defer close(w.done)
    for t := range w.in {
        t.Run()
    }
}

func (w *Worker) Submit(t Task) { w.in <- t }
func (w *Worker) Close()        { close(w.in) }
func (w *Worker) Wait()         { <-w.done }

func TestWorker(t *testing.T) {
    w := New()
    w.Submit(Task{ID: 1})
    w.Close()
    w.Wait()
    // safe to assert side effects of Task.Run now
}
```

The `Wait` method is the test barrier. No sleeping, no guessing.

---

## Coding Patterns

### Pattern 1: "Done" channel from goroutine

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

The smallest, most-used pattern. Works for one goroutine.

### Pattern 2: WaitGroup for many

```go
var wg sync.WaitGroup
for _, x := range inputs {
    wg.Add(1)
    go func(x Input) {
        defer wg.Done()
        process(x)
    }(x)
}
wg.Wait()
```

For N independent goroutines launched in a loop.

### Pattern 3: Drain output channel

```go
out := pipeline(in)
var results []Out
for r := range out {
    results = append(results, r)
}
```

Producer must close `out` when input is exhausted. Once closed, the loop exits and the test can assert.

### Pattern 4: Ready channel

```go
ready := make(chan struct{})
go server.RunWithReady(ready)
<-ready
// safe to talk to server
```

For "start a server, then talk to it" patterns.

### Pattern 5: Context cancellation barrier

```go
ctx, cancel := context.WithCancel(context.Background())
go run(ctx)
cancel()
// wait for goroutine to acknowledge
<-doneCh
```

Cancel and wait. Do not assume cancellation is instant.

### Pattern 6: One-shot worker invocation

```go
result := make(chan Out, 1)
go func() {
    result <- doWork()
}()
got := <-result
```

Pattern when you want a goroutine for its side effect of running concurrently with other test setup, but you still need its result. Use buffer 1 to avoid leak if test fails.

### Pattern 7: Re-run for stability

```bash
go test -count=20 -race ./...
```

Always re-run new concurrent tests at least 20 times locally before pushing.

---

## Clean Code

- A test reads top to bottom: setup, action, **barrier**, assertion. The barrier line should be visible and well-named.
- Use a helper function for repeated patterns. `waitDone(t, done)` reads better than open-coding `<-done`.
- Never embed `time.Sleep` calls in helper functions either; the smell propagates.
- Prefer one goroutine spawn per test when possible. Many goroutines means many synchronisation points to manage.
- Name channels by purpose: `ready`, `done`, `errs`. `ch1`, `ch2` is a smell.
- Keep test goroutines short. If a test goroutine has more than 20 lines, extract it.
- Treat test helpers like production code: review them, refactor them, write them once.

---

## Product Use / Feature

Deterministic testing is a process choice, not a product feature. Its product impact is reduced incident rates:

- **No "flaky test" Slack channel.** Every red is a real defect.
- **Faster pipelines.** Sleep-free tests cut CI time dramatically.
- **Higher trust in test suite.** Engineers fix the failure instead of clicking "retry."
- **Safer refactors.** Deterministic tests catch behavioural regressions immediately.

When you onboard a new engineer, "we never `time.Sleep` in tests" is one of the first rules. It compounds.

---

## Error Handling

### Always check goroutine errors

If a goroutine can error, propagate the error through a channel and check it in the test:

```go
errs := make(chan error, 1)
go func() {
    errs <- work()
}()
if err := <-errs; err != nil {
    t.Fatal(err)
}
```

A silently swallowed goroutine error is invisible in the test.

### Use `t.Helper()` in test helpers

```go
func waitDone(t *testing.T, done <-chan struct{}, timeout time.Duration) {
    t.Helper()
    select {
    case <-done:
    case <-time.After(timeout):
        t.Fatalf("goroutine did not finish in %v", timeout)
    }
}
```

`t.Helper()` makes failure messages point at the calling line, not the helper.

### Bound your barriers with timeouts (carefully)

If your barrier blocks forever, the test hangs and CI times out unhelpfully. Add a long, generous timeout — at least 10× expected — to surface a real bug as a fast failure:

```go
select {
case <-done:
case <-time.After(5 * time.Second):
    t.Fatal("goroutine never finished")
}
```

5 seconds is a "something is wrong" fence, not a synchronisation primitive. It must never fire under normal operation.

---

## Security Considerations

Determinism is not directly a security topic, but two notes:

- **Flaky tests hide regressions.** A test that masks a real failure as "flaky" can let a security bug ship. Treat every red as a real failure first.
- **`runtime.Gosched` and `time.Sleep` in production code interact with concurrency-attack timing.** Tests that depend on sleeps can mask race-condition exploits. Use the race detector religiously.

---

## Performance Tips

- Sleep-free tests are dramatically faster. A test that sleeps 100ms × 200 tests = 20 seconds wasted per CI run.
- `t.Parallel()` is safe in deterministic tests because each test owns its synchronisation. In sleep-based tests, parallel runs amplify flakiness.
- `-count=N` with `N=20`–`100` is cheap when tests are fast. Make your tests fast and run them many times.
- Avoid global state in tests; it forces serialisation. Per-test fixtures parallelise.

---

## Best Practices

1. **Never `time.Sleep` to synchronise.** Period.
2. **Use channels or WaitGroups** as explicit barriers.
3. **Inject time.** Pass a `Clock` interface; test with a fake clock.
4. **Drain output channels** instead of guessing length.
5. **Run new concurrent tests with `-count=50 -race`** before pushing.
6. **Use `t.Helper()`** in synchronisation helpers.
7. **Fail loudly on timeout** rather than hang. Time-out is a bug indicator.
8. **Bound goroutines.** A test that spawns thousands of goroutines is hard to reason about.
9. **Use `t.Parallel()`** for true isolation between deterministic tests.
10. **Treat every flake as a defect.** Fix the test design, not the symptom.

---

## Edge Cases & Pitfalls

### Pitfall 1: Goroutine started before barrier setup

```go
go work() // started here
done := make(chan struct{}) // declared here -- too late
```

If `work` references `done`, this is a nil channel access. Always declare barriers before spawning.

### Pitfall 2: Buffered result channel size 0

```go
result := make(chan Out)
go func() { result <- compute() }()
// if test never reads result, goroutine leaks
```

If your test fails before reading `result`, the goroutine blocks forever. Use buffer 1:

```go
result := make(chan Out, 1)
```

### Pitfall 3: Forgetting to close output channel

If your production code does not close its output channel, the test's `for range out` loop hangs. Either fix the production code or use a context to terminate. Closing is preferred.

### Pitfall 4: `WaitGroup.Add` inside a goroutine

```go
go func() {
    wg.Add(1) // race
    defer wg.Done()
    ...
}()
```

`Add` must run *before* `Wait`, in the spawning goroutine, not inside the spawned goroutine.

### Pitfall 5: Stale state read before the barrier

```go
go func() { c++ }()
val := c // read here is racy
<-done
```

All reads of shared state must come after the barrier, never before. Race detector catches this.

### Pitfall 6: Re-using a closed channel as a barrier

You can `<-` from a closed channel many times — it returns the zero value immediately. That is the *intended* behaviour and makes `close(done)` a great fan-out signal. But do not assume "close" is "send"; you cannot send after close.

### Pitfall 7: A test that only fails on slow machines

Sleeps with short durations work on fast machines and fail on slow ones. CI runners are usually slow under contention. If a test fails only in CI, sleep is the prime suspect.

### Pitfall 8: `GOMAXPROCS=1` is not a fix

It reduces parallelism but the scheduler still preempts and goroutines still interleave. A test that "only passes on `-cpu 1`" still has a bug.

---

## Common Mistakes

1. **Adding `time.Sleep` to "make the test pass."** Now it passes 99% of the time and fails 1% — worse than failing 100%.
2. **Forgetting `wg.Wait()`.** The test ends without waiting; assertion runs on stale state.
3. **`wg.Add(1)` inside the goroutine.** Race with `Wait`.
4. **Closing a channel from the receiver.** Channels are closed by the sender. Closing from the receiver leads to "send on closed channel" panics.
5. **Asserting between two parallel goroutines.** "After the read but before the write" is not a real moment in concurrent code.
6. **Using global state for barriers.** Tests that mutate a package-level `var done chan struct{}` cannot run in parallel.
7. **Ignoring `-race` failures.** A race is always a bug; the test passing is luck.
8. **Trusting `runtime.Gosched()`.** It is a hint to the scheduler, not a synchronisation primitive.
9. **Spawning a goroutine and forgetting to wait.** It runs after the test returns; CI flake.
10. **Using `time.After` without a fake clock.** Real-time-dependent tests are flaky by construction.

---

## Common Misconceptions

- **"Adding more sleep fixes the flake."** No. It reduces frequency, not the bug. Real fix: replace sleep with synchronisation.
- **"Tests with `-race` cannot flake."** Wrong. `-race` finds data races; it does not find scheduling assumptions. A non-racing test can still be flaky.
- **"A flaky test is just a transient."** No. Flakiness is a defect in the test or the code. Treat it as a bug, file it, fix it.
- **"`GOMAXPROCS=1` makes tests deterministic."** No. The scheduler still has freedom; preemption is asynchronous.
- **"If it passes 100 times it is fine."** Better than passing once. Not proof. Use `-race -count=1000` for confidence.
- **"`time.Sleep` is fine if I sleep long enough."** Long enough on your machine. Not on CI. Not on tomorrow's CI.
- **"My test sometimes fails because the system is slow."** Maybe. Or your test makes a timing assumption. Investigate.

---

## Tricky Points

### `<-time.After(d)` in a `select` leaks a timer

If your test uses `<-time.After(5*time.Second)` as a timeout in a `select`, the timer goroutine stays alive until the duration elapses, even if the other case fires. In tight loops this leaks. Use `time.NewTimer` and `Stop`, or a `context.WithTimeout`.

### `close(nil channel)` panics

If you forget to allocate `done`, `close(done)` panics. Always `done := make(chan struct{})`.

### Reading from a nil channel blocks forever

```go
var ch chan struct{}
<-ch // blocks forever, no panic
```

Test hangs, CI times out without a useful message. Always initialise.

### `t.Parallel` and shared state

If two parallel tests both depend on a global mutable variable, they race even if each is internally deterministic. Each test must own its fixture.

### `t.Cleanup` runs after the test returns

If you register `t.Cleanup(func() { worker.Close() })`, cleanup runs after assertions. Make sure your barrier is *before* the cleanup, not after.

### `go test -run` runs subtests too

`-run TestFoo` runs `TestFoo` and any subtest matching by name. `-run TestFoo$` runs only `TestFoo`. Use the dollar anchor for precise selection.

### Subtests share parent state

Subtests inside `t.Run` share package-level variables. Reset state per subtest or use `t.Cleanup`.

---

## Test

Try these locally; each should pass on first run with `-race -count=20`.

### Test 1: Basic barrier

Write a test for a function `Increment(addr *int, ch chan struct{})` that increments `*addr` and signals on `ch`. The test must verify the increment without using `time.Sleep`.

### Test 2: WaitGroup over 100 goroutines

Write a test that spawns 100 goroutines, each incrementing an atomic counter, and waits for them all to finish. Assert the counter is 100.

### Test 3: Drain a closed channel

Write a function `Squares(n int) <-chan int` that emits `1, 4, 9, ..., n*n` on a channel and closes it. Test that the output is exactly that sequence, in order.

### Test 4: Server ready signal

Write a server type with `RunWithReady(ready chan<- struct{})`. The test spawns the server, waits on `ready`, then pings it. No sleep allowed.

### Test 5: 1000-run stress

Take any test you wrote above and run `go test -count=1000 -race ./...`. Confirm it passes.

---

## Tricky Questions

1. **"My test passes 99 times out of 100. Is that good enough?"** No. One failure per 100 runs is one failure per CI run if CI runs the test 100 times a day. Fix it.
2. **"Why does my test fail only on CI?"** Three usual causes: CI is slower (sleeps too short), CI has more cores (more concurrency), CI is loaded (scheduler timing differs).
3. **"Why does `runtime.Gosched()` not work?"** It is a hint, not a guarantee. The scheduler may or may not switch goroutines.
4. **"Can I use `runtime.GC()` to flush?"** No. GC is unrelated to scheduling.
5. **"Is `select { case <-done: case <-time.After(timeout): }` deterministic?"** Yes, *if* the timeout never fires under normal conditions. The pattern is a deadline, not a synchronisation primitive.
6. **"Should I `t.Parallel()` deterministic tests?"** Yes, when each test owns its state. Parallelism reveals lurking shared-state bugs faster.
7. **"How long should a barrier timeout be?"** 5–10 seconds is a common ceiling. Long enough to absorb a slow CI; short enough to fail fast on a real hang.
8. **"What about `runtime.Goexit()`?"** Terminates the current goroutine. Not a synchronisation tool.

---

## Cheat Sheet

```
NEVER:                                   ALWAYS:
  time.Sleep(d) in tests                   <-done channel
  go f(); assert                           go f(); <-done; assert
  assume goroutine order                    explicit barrier
  runtime.GOMAXPROCS=1 as a fix             channel/WaitGroup
  ignore -race failures                    fix the race first

BARRIER TOOLBOX:
  close(done) + <-done                Smallest one-shot signal
  wg.Wait()                           N goroutines complete
  for range out                       Drain a closed channel
  <-result                            Single goroutine result
  context.Done()                      Cancellation barrier

FLAKE HUNT:
  go test -count=100 -race ./...
  go test -count=1000 -race -run X ./pkg
  GOTRACEBACK=all on hang
  goleak.VerifyTestMain on leak

GO 1.24+ (preview, see middle.md):
  import "testing/synctest"
  synctest.Run(func() { ... })
  synctest.Wait() // wait for quiescence
```

---

## Self-Assessment Checklist

- [ ] I can name three causes of test flakiness in concurrent Go.
- [ ] I can rewrite a `time.Sleep`-based test into a barrier-based test.
- [ ] I know when to use a `chan struct{}` vs a `WaitGroup`.
- [ ] I know what `-count=N` does and when to use it.
- [ ] I never use `time.Sleep` to synchronise inside a test.
- [ ] I run new concurrent tests with `-race -count=20` minimum.
- [ ] I add `t.Helper()` to synchronisation helpers.
- [ ] I bound barriers with timeouts as a fail-fast measure, not a synchronisation tool.
- [ ] I check goroutine error returns through a channel.
- [ ] I treat every flake as a defect, not a transient.

If you can tick all ten, you are ready for middle.md.

---

## Summary

A concurrent test is deterministic when its outcome does not depend on scheduler choices or wall-clock time. The two enemies are sleep-based synchronisation and timing assumptions. The cure is explicit barriers: channels for one-shot signals, WaitGroups for multi-goroutine completion, ranges over closed channels for pipeline drains. Repeat-run with `-count=N` and `-race` to detect remaining flakiness. Never use `time.Sleep`. Inject time as a dependency. Treat every flake as a defect to fix at the source. Master these patterns and your tests become trustworthy partners instead of nightly headaches.

---

## What You Can Build

- A worker pool with deterministic tests covering submit, drain, close.
- A producer-consumer pipeline whose tests pass under `-count=1000 -race`.
- A cache with TTL whose tests run in microseconds via injected clock (preview — covered in middle.md).
- A test helper library: `waitDone`, `waitWG`, `drainChan` — small, well-named.
- A CI job that runs the test suite with `-race -count=10` nightly to catch flakes.

---

## Further Reading

- The Go blog: "Testing concurrent code in Go".
- `pkg.go.dev/testing` — official `testing` package documentation.
- `pkg.go.dev/sync` — `WaitGroup`, `Mutex`, `Cond`.
- `pkg.go.dev/golang.org/x/sync/errgroup` — error-returning WaitGroup.
- `go.uber.org/goleak` — leak detection that complements determinism.
- Russ Cox: "Bigger, smaller, faster — the future of Go testing" (covers `synctest` motivation).

---

## Related Topics

- [03-waitgroup-in-tests](../03-waitgroup-in-tests/) — deeper coverage of WaitGroup test idioms.
- [04-mocking-time](../04-mocking-time/) — fake clocks in detail.
- [01-race-detector-deep](../01-race-detector-deep/) — complementary tool.
- [05-concurrent-fuzzing](../05-concurrent-fuzzing/) — generative concurrent tests.
- [07-goroutine-lifecycle-leaks](../../07-goroutine-lifecycle-leaks/) — preventing test leaks.

---

## Diagrams & Visual Aids

### The barrier model

```
Test goroutine        Worker goroutine
   |                       |
   | spawn(worker)         |
   |---------------------->|
   |                       |  ... do work ...
   |                       |
   |   close(done) <-------|
   |                       |
   | <-done                | (returned, exit)
   |                       
   | assert                |
   | t.Fatal/Errorf?       
```

### Flaky vs deterministic timeline

```
FLAKY:
  spawn ---?--- assert
        \         |
         goroutine may finish: before, during, after?

DETERMINISTIC:
  spawn ----------- barrier ----- assert
        \          /     \
         goroutine ----- close(done)
```

### Test flake budget

```
1000 tests × 0.1% flake rate × 100 CI runs/day = 100 reds/day
                                                ^ unacceptable

1000 tests × 0%  flake rate × 100 CI runs/day = 0 reds (only real bugs)
                                                ^ goal
```
