# Concurrent Fuzzing — Find the Bug

> Real fuzz failure reports, with diagnosis and fix. Each scenario is presented as the fuzzer would surface it: a stack trace, the offending input, and a question. The diagnosis follows after a deliberate pause.

## Table of Contents

1. [Scenario 1: A panic in a parser](#scenario-1-a-panic-in-a-parser)
2. [Scenario 2: A race in a "thread-safe" counter](#scenario-2-a-race-in-a-thread-safe-counter)
3. [Scenario 3: A race in a "thread-safe" cache](#scenario-3-a-race-in-a-thread-safe-cache)
4. [Scenario 4: A timeout (suspected deadlock)](#scenario-4-a-timeout-suspected-deadlock)
5. [Scenario 5: A round-trip mismatch in JSON](#scenario-5-a-round-trip-mismatch-in-json)
6. [Scenario 6: A non-deterministic failure](#scenario-6-a-non-deterministic-failure)
7. [Scenario 7: A non-linearisable history](#scenario-7-a-non-linearisable-history)
8. [Scenario 8: Bug found in the fuzz harness itself](#scenario-8-bug-found-in-the-fuzz-harness-itself)

---

## Scenario 1: A panic in a parser

### Report

```
--- FAIL: FuzzParseHeader (0.02s)
    --- FAIL: FuzzParseHeader (0.00s)
        panic: runtime error: index out of range [0] with length 0 [recovered]
            panic: runtime error: index out of range [0] with length 0

        goroutine 7 [running]:
        ...
        myapp/parser.ParseHeader(...)
            /home/me/myapp/parser/header.go:42
        myapp/parser.FuzzParseHeader.func1(0xc000012340, {0x0, 0x0, 0x0})
            /home/me/myapp/parser/header_fuzz_test.go:23

    Failing input written to testdata/fuzz/FuzzParseHeader/a3f7e1...
```

### The code

```go
func ParseHeader(data []byte) (Header, error) {
    if data[0] == 0x80 {
        return Header{}, errInvalid
    }
    // ...
}
```

### The input

```
go test fuzz v1
[]byte("")
```

### Question

Why does the fuzzer fail on the seemingly-simple empty input? What is the fix?

---

**Diagnosis:** The function indexes `data[0]` without checking length. On an empty slice, `data[0]` panics. The fuzzer feeds an empty slice as one of its first mutations.

**Fix:**

```go
func ParseHeader(data []byte) (Header, error) {
    if len(data) == 0 {
        return Header{}, errEmpty
    }
    if data[0] == 0x80 {
        return Header{}, errInvalid
    }
    // ...
}
```

**Regression:** the empty-input reproducer is now committed under `testdata/fuzz/FuzzParseHeader/`. Any future regression that re-introduces the missing length check is caught instantly.

---

## Scenario 2: A race in a "thread-safe" counter

### Report

```
==================
WARNING: DATA RACE
Write at 0x00c000018028 by goroutine 8:
  myapp/counter.(*Counter).Inc()
      /home/me/myapp/counter/counter.go:18 +0x44

Previous read at 0x00c000018028 by goroutine 9:
  myapp/counter.(*Counter).Value()
      /home/me/myapp/counter/counter.go:32 +0x44

Goroutine 8 (running) created at:
  myapp/counter.FuzzCounterReads.func1.1()
      /home/me/myapp/counter/counter_fuzz_test.go:25 +0x144
...
==================
--- FAIL: FuzzCounterReads (0.03s)
    Failing input written to testdata/fuzz/FuzzCounterReads/4b2e9c...

FAIL
exit status 66
```

### The code

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *Counter) Value() int {
    return c.n  // <-- no lock here
}
```

### Question

`Inc` holds the lock. Why is the race detector unhappy about `Value`?

---

**Diagnosis:** `Value` reads `c.n` without acquiring `mu`. A concurrent `Inc` writes `c.n` under the lock, but a concurrent `Value` reads outside the lock. There is no happens-before edge between the write and the read; the race detector flags it correctly.

**Fix:**

```go
func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

Or use `sync/atomic`:

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()   { c.n.Add(1) }
func (c *Counter) Value() int { return int(c.n.Load()) }
```

**Lesson:** "thread-safe" must apply to *all* methods, not just the obvious mutators. Reads need synchronisation too.

---

## Scenario 3: A race in a "thread-safe" cache

### Report

```
==================
WARNING: DATA RACE
Write at 0x00c0000a4060 by goroutine 12:
  runtime.mapassign_faststr()
      /usr/local/go/src/runtime/map_faststr.go:208 +0x0
  myapp/cache.(*Cache).Put()
      /home/me/myapp/cache/cache.go:34 +0xfc

Previous read at 0x00c0000a4060 by goroutine 13:
  runtime.mapaccess2_faststr()
      /usr/local/go/src/runtime/map_faststr.go:13 +0x0
  myapp/cache.(*Cache).Get()
      /home/me/myapp/cache/cache.go:25 +0xa8
==================
```

### The code

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    if v, ok := c.m[k]; ok {
        c.mu.Unlock()
        return v, true
    }
    return "", false  // <-- forgot to unlock!
}

func (c *Cache) Put(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}
```

### Question

The race detector points at the `map` assignment. But the bug is elsewhere. Where?

---

**Diagnosis:** `Get` returns without unlocking on the cache-miss path. The next `Put` blocks forever waiting for the mutex — but the race detector still sees a race because the previous successful `Get` *did* unlock and another goroutine's `Get` raced with a third goroutine's `Put`. The mutex is occasionally not held when it should be.

Actually, look more carefully: the bug is that the `Unlock` is *only* in the hit branch. On miss, `Unlock` never runs, so the next caller's `Lock` blocks. But once unblocked (after a long wait or a `panic`), the state is corrupt. The race detector picks up the race because the mutex protection is inconsistent.

**Fix:**

```go
func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.m[k]
    return v, ok
}
```

**Lesson:** prefer `defer mu.Unlock()` over manual `mu.Unlock()`. Manual unlock is one early-return away from a leak.

---

## Scenario 4: A timeout (suspected deadlock)

### Report

```
panic: test timed out after 10m0s
        running tests:
                FuzzPipeline (10m0s)

goroutine 1 [chan receive, 10 minutes]:
  testing.(*F).Fuzz(...)
      /usr/local/go/src/testing/fuzz.go:200 +0x4cc
  myapp.FuzzPipeline(0xc000012340)
      /home/me/myapp/pipeline_fuzz_test.go:18 +0x12c
```

### The code

```go
func RunPipeline(in []byte) []byte {
    ch1 := make(chan byte)
    ch2 := make(chan byte)
    done := make(chan []byte)

    go func() {
        for _, b := range in {
            ch1 <- b
        }
        close(ch1)
    }()

    go func() {
        for b := range ch1 {
            ch2 <- b * 2
        }
        // forgot to close(ch2)
    }()

    go func() {
        var out []byte
        for b := range ch2 {
            out = append(out, b)
        }
        done <- out
    }()

    return <-done
}
```

### Question

Why does the fuzz target time out?

---

**Diagnosis:** The middle goroutine never closes `ch2`. The third goroutine `for b := range ch2` blocks forever waiting for either a value or a close. The main goroutine blocks on `<-done`. Deadlock.

The fuzzer hit this on any non-empty input. The timeout caught it.

**Fix:**

```go
go func() {
    defer close(ch2)
    for b := range ch1 {
        ch2 <- b * 2
    }
}()
```

**Lesson:** every goroutine that sends on a channel should be responsible for closing it (when the channel will be ranged over). The fuzzer's timeout-based hang detection caught this; without `-fuzz`, this bug might lurk for months until a downstream consumer happened to range over an unclosed channel.

---

## Scenario 5: A round-trip mismatch in JSON

### Report

```
--- FAIL: FuzzJSONRoundTrip (0.05s)
    --- FAIL: FuzzJSONRoundTrip (0.00s)
        round_trip_test.go:24: round-trip mismatch
            first:  map[string]interface{}{"a":1.7976931348623157e+308}
            second: map[string]interface{}{"a":+Inf}

    Failing input written to testdata/fuzz/FuzzJSONRoundTrip/8c4d1e...
```

### The input

```
go test fuzz v1
[]byte("{\"a\":1.7976931348623157e+308}")
```

### Question

Both values look reasonable. What is the actual round-trip mismatch?

---

**Diagnosis:** `1.7976931348623157e+308` is the maximum representable `float64`. `json.Unmarshal` produces exactly this. `json.Marshal` emits `1.7976931348623157e+308` again. *But* the decimal-to-binary conversion on re-decode loses precision and lands on `+Inf` because the re-emitted string had a final rounding step on the boundary.

This is a *known* limitation of round-trip equality for floats. The fix is not to "fix" the encoding but to relax the invariant:

```go
if !valuesEqualOrBothInf(a, b) {
    t.Fatalf("mismatch")
}
```

Or use `json.Number` mode so the value stays a string:

```go
dec := json.NewDecoder(bytes.NewReader(data))
dec.UseNumber()
var a any
dec.Decode(&a)
```

**Lesson:** round-trip invariants must account for the precision and semantics of the format. JSON does *not* promise float round-tripping near the limits. A "failure" here is the fuzzer correctly identifying a real semantic limitation of the format.

---

## Scenario 6: A non-deterministic failure

### Report

```
--- FAIL: FuzzPipeline (0.43s)
    pipeline_fuzz_test.go:31: expected ok, got !ok
    Failing input written to testdata/fuzz/FuzzPipeline/9d2b73...
```

You re-run:

```
$ go test -run=FuzzPipeline/9d2b73 -race ./pipeline
PASS
ok      myapp/pipeline    0.012s
```

### Question

The fuzzer found a failure but you cannot reproduce it. What is wrong?

---

**Diagnosis:** The fuzz function depends on non-determinism somewhere. Likely candidates:

1. **Time.** The fuzz body or system under test uses `time.Now()`, `time.Sleep`, or a deadline.
2. **Unseeded `rand`.** A `rand.Intn` somewhere uses the default `Source`, which is seeded fresh each process. Different runs differ.
3. **Scheduler-dependent assertions.** An assertion runs before a `WaitGroup` has actually waited (rare but possible).
4. **Map iteration order.** Two iterations over the same `map` produce different orders. Iterating *and* asserting on order is non-deterministic.

**Diagnostic strategy:**

1. Re-run with `-count=100`: `go test -run=FuzzPipeline/9d2b73 -count=100 -race`. If 5/100 fail, the bug is real but rare.
2. Audit the fuzz function and SUT for `time.Now`, `rand`, map iteration.
3. Stub time with a fake clock; seed `rand` from the fuzz input; sort map iterations.
4. Re-run the fuzzer; the next failure should reproduce.

**Fix sketch:**

```go
f.Fuzz(func(t *testing.T, seed int64, data []byte) {
    rng := rand.New(rand.NewSource(seed))
    clk := newFakeClock()
    p := NewPipeline(WithRand(rng), WithClock(clk))
    _ = p.Run(data)
})
```

**Lesson:** non-determinism in fuzz targets is the highest-priority bug class. It obscures every future fuzz failure. Fix it before anything else.

---

## Scenario 7: A non-linearisable history

### Report (from `porcupine`)

```
--- FAIL: FuzzKVLinearisability (1.21s)
    kv_fuzz_test.go:62: history is not linearisable

    Operations:
      [#0 set("k", 1)         start=...  end=...]
      [#1 get("k") -> 0       start=...  end=...]
      [#2 set("k", 2)         start=...  end=...]
      [#3 get("k") -> 1       start=...  end=...]   ← problem

    No serial order is consistent with these intervals.
```

### The code

```go
type KV struct {
    mu sync.Mutex
    m  map[string]int
    // Custom Get that snapshots without lock for "performance":
}

func (kv *KV) Get(k string) int {
    return kv.m[k]  // <-- unlocked
}
```

### Question

Why is the history not linearisable?

---

**Diagnosis:** Operation #3 reads `1`. For a linearisable schedule, op #3 must take effect at some point between its start and its end. But by the real-time order, op #2 (set 2) starts before op #3 returns. So #3 either observes `0`, `1`, or `2` — but it must observe a value consistent with the most recent `set` in its history.

Possible serial orders:
- `set 1, get -> 0, set 2, get -> 1`: invalid, the first `get` should see `1`, not `0`.
- `get -> 0, set 1, get -> 1, set 2`: invalid, the second `get` overlaps with `set 2` which is after `set 1`, so seeing `1` is allowed only if `set 2` has not yet happened — but #2 started before #3 returned.

The unlocked `Get` is reading from a stale snapshot of the map header. There is no consistent serial schedule. The KV store is not linearisable.

**Fix:** lock `Get`:

```go
func (kv *KV) Get(k string) int {
    kv.mu.Lock()
    defer kv.mu.Unlock()
    return kv.m[k]
}
```

Or use `sync.RWMutex`'s `RLock` if reads vastly dominate.

**Lesson:** linearisability checking is a powerful tool. A history of just 4 operations exposes the inconsistency. Without it you would only see "weird reads sometimes." The fuzzer + porcupine combo gives you both inputs and proofs.

---

## Scenario 8: Bug found in the fuzz harness itself

### Report

```
--- FAIL: FuzzQueueConcurrent (0.01s)
    panic: runtime error: index out of range [3] with length 2 [recovered]
        panic: runtime error: index out of range [3] with length 2

    goroutine 17 [running]:
    myapp/queue.decodeOps(...)
        /home/me/myapp/queue/queue_fuzz_test.go:18
```

The panic is in `decodeOps`, *inside the fuzz test file*, not in the system under test.

### The code

```go
func decodeOps(data []byte) []op {
    var out []op
    for i := 0; i < len(data); i += 4 {
        out = append(out, op{
            kind: data[i],
            key:  string(data[i+1 : i+3]),
            val:  int(data[i+3]),
        })
    }
    return out
}
```

### Question

What is wrong?

---

**Diagnosis:** The decoder indexes `data[i+3]` without checking `i+3 < len(data)`. On the last partial chunk, it panics. The fuzzer found an input like `[0x00, 0x01]` (length 2) and the loop tried to read `data[1:3]` (out of bounds).

**Fix:**

```go
func decodeOps(data []byte) []op {
    var out []op
    for i := 0; i+4 <= len(data); i += 4 {
        out = append(out, op{
            kind: data[i],
            key:  string(data[i+1 : i+3]),
            val:  int(data[i+3]),
        })
    }
    return out
}
```

**Lesson:** the decoder must be total. Any panic in the harness obscures the system under test. Write a tiny fuzz test that exercises *just the decoder* (`f.Fuzz(func(t *testing.T, data []byte) { decodeOps(data) })`) to validate this property.

This is also a reason to make harness code as boring as possible. Bugs in the harness produce mysterious-looking fuzz reports that waste hours of debugging.

---

## Summary

Eight scenarios, each a real-world shape of fuzz failure: panic in a parser, data race on shared state, partial unlock paths, deadlock from unclosed channels, semantic round-trip mismatches at float boundaries, non-deterministic failures that signal a hidden time/rand dependency, linearisability violations under concurrent execution, and bugs in the fuzz harness itself. The recurring diagnostic moves are: (1) reproduce locally with `go test -run=FuzzXxx/<hash>`, (2) read the input and the stack trace together, (3) ask whether the bug is in the SUT or the harness, (4) check for non-determinism if reproduction fails, (5) commit the reproducer and a stress-replay test. Master these moves and triage time drops from hours to minutes.
