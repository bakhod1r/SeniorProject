# Concurrent Fuzzing — Tasks

> Hands-on exercises. Each task includes a brief description, the code skeleton, and acceptance criteria. Solutions left as an exercise; representative solution sketches are provided after each task.

## Table of Contents

1. [Task 1: First fuzz target](#task-1-first-fuzz-target)
2. [Task 2: Fuzz a round-trip encoder](#task-2-fuzz-a-round-trip-encoder)
3. [Task 3: Fuzz a concurrent counter](#task-3-fuzz-a-concurrent-counter)
4. [Task 4: Fuzz a concurrent map](#task-4-fuzz-a-concurrent-map)
5. [Task 5: Fuzz a state machine](#task-5-fuzz-a-state-machine)
6. [Task 6: Stress-replay a fuzz finding](#task-6-stress-replay-a-fuzz-finding)
7. [Task 7: CI integration sketch](#task-7-ci-integration-sketch)
8. [Task 8: Corpus from production samples](#task-8-corpus-from-production-samples)
9. [Task 9: Use `rapid` for a state machine](#task-9-use-rapid-for-a-state-machine)
10. [Task 10: Combine with linearisability checking](#task-10-combine-with-linearisability-checking)

---

## Task 1: First fuzz target

**Goal:** Write a `FuzzReverse` for a string-reversal function and find the classic UTF-8 bug.

**Setup:**

```go
package strs

func Reverse(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}
```

**Task:**

1. Create `strs_fuzz_test.go` in the same package.
2. Write `FuzzReverse` with at least 5 seeds, including ASCII, empty, and unicode strings.
3. Assert that `Reverse(Reverse(s)) == s`.
4. Run `go test -fuzz=FuzzReverse -fuzztime=10s`.
5. Observe the failure. Read the reproducer in `testdata/fuzz/FuzzReverse/`.

**Acceptance:**

- Failure is found within 10 seconds.
- Reproducer file is committed.
- You can explain in one sentence why the invariant is violated. (Hint: invalid UTF-8.)

**Solution sketch:**

```go
func FuzzReverse(f *testing.F) {
    for _, s := range []string{"hello", "", "a", "abc", "test"} {
        f.Add(s)
    }
    f.Fuzz(func(t *testing.T, s string) {
        if !utf8.ValidString(s) {
            t.Skip()
        }
        if got := Reverse(Reverse(s)); got != s {
            t.Errorf("Reverse(Reverse(%q)) = %q", s, got)
        }
    })
}
```

Without `t.Skip()` on invalid UTF-8, the fuzzer finds `[]byte("\xc0")` immediately. With it, the invariant holds. The point of the exercise is to *see* the failure, then decide how to handle invalid input (skip, fix, or document).

---

## Task 2: Fuzz a round-trip encoder

**Goal:** Find a JSON round-trip mismatch by fuzzing.

**Setup:** Use the standard library's `encoding/json`.

**Task:**

1. Write `FuzzJSONRoundTrip` that:
   - Decodes the input as `any` (i.e. `interface{}`).
   - On decode error, returns (valid behaviour).
   - Re-encodes the value.
   - Re-decodes the re-encoded bytes.
   - Asserts the two decoded values are `reflect.DeepEqual`.
2. Seed with at least 5 JSON snippets including `null`, `[]`, `{}`, numbers, strings.
3. Run with `-fuzztime=30s`.

**Acceptance:**

- The fuzzer finds at least one round-trip mismatch within 30 seconds.
- You can articulate why (likely: `json.Number` precision, `1e100` vs `inf`, key ordering, integer overflow into float).

**Solution sketch:**

```go
func FuzzJSONRoundTrip(f *testing.F) {
    for _, s := range []string{`null`, `[]`, `{}`, `1`, `"a"`, `[1, "two"]`} {
        f.Add([]byte(s))
    }
    f.Fuzz(func(t *testing.T, data []byte) {
        var a any
        if err := json.Unmarshal(data, &a); err != nil {
            return
        }
        out, err := json.Marshal(a)
        if err != nil {
            t.Fatalf("marshal: %v", err)
        }
        var b any
        if err := json.Unmarshal(out, &b); err != nil {
            t.Fatalf("re-unmarshal: %v", err)
        }
        if !reflect.DeepEqual(a, b) {
            t.Fatalf("mismatch:\n a=%#v\n b=%#v", a, b)
        }
    })
}
```

Likely findings: `1e100` decodes to `float64(1e100)` which marshals back to the same value but compares only up to float precision. For some inputs, `json.Number` mode is necessary. The point: round-trip-equality requires careful definition.

---

## Task 3: Fuzz a concurrent counter

**Goal:** Find a missing lock or atomic operation in a counter.

**Setup:**

```go
package counter

type Counter struct {
    n int
}

func (c *Counter) Inc()       { c.n++ }
func (c *Counter) Dec()       { c.n-- }
func (c *Counter) Value() int { return c.n }
```

Yes, this is deliberately broken (no synchronisation).

**Task:**

1. Write `FuzzCounterConservation` that:
   - Takes `uint64 ops` as the fuzz parameter.
   - Spawns 32 goroutines that increment or decrement based on bits of `ops`.
   - Computes the expected value.
   - Asserts the final counter equals the expected value.
2. Run `go test -fuzz=FuzzCounterConservation -fuzztime=30s -race`.
3. Observe the race report. Note the offending input.

**Acceptance:**

- A race is reported within seconds.
- The offending input is saved in `testdata/fuzz/FuzzCounterConservation/`.
- You can fix the counter (add `sync.Mutex` or use `sync/atomic`) and re-run; the race disappears.

**Solution sketch (fixed counter):**

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc()       { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Dec()       { c.mu.Lock(); c.n--; c.mu.Unlock() }
func (c *Counter) Value() int { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

After this change, both `-race` and the conservation invariant hold.

---

## Task 4: Fuzz a concurrent map

**Goal:** Decode a fuzz `[]byte` into a stream of map operations, run them concurrently, assert no race.

**Setup:**

```go
package smap

import "sync"

type Map struct {
    mu sync.RWMutex
    m  map[string]int
}

func New() *Map { return &Map{m: map[string]int{}} }

func (s *Map) Set(k string, v int) {
    s.mu.Lock()
    s.m[k] = v
    s.mu.Unlock()
}

func (s *Map) Get(k string) (int, bool) {
    // Bug: forgot to lock.
    v, ok := s.m[k]
    return v, ok
}
```

**Task:**

1. Define an encoding from `[]byte` to a list of `{kind, key, val}` operations. Each operation consumes a fixed number of bytes; leftover bytes are dropped.
2. Write `FuzzMapConcurrent` that spawns 4 goroutines, each consuming a quarter of the operations.
3. Run `-fuzz=FuzzMapConcurrent -fuzztime=30s -race`.
4. Observe the race in `Get` and `Set`.
5. Fix `Get` to take `mu.RLock()`.

**Acceptance:**

- The race detector reports `Get` racing with `Set` within seconds.
- After adding `RLock`, the race disappears.

**Solution sketch — decoder:**

```go
type op struct {
    kind byte // 0 = set, 1 = get
    key  string
    val  int
}

func decode(data []byte) []op {
    var out []op
    for len(data) >= 3 {
        b := data[0]
        data = data[1:]
        kind := b & 1
        keyLen := int((b >> 1) & 0x07)
        if len(data) < keyLen+1 {
            return out
        }
        key := string(data[:keyLen])
        data = data[keyLen:]
        val := int(int8(data[0]))
        data = data[1:]
        out = append(out, op{kind: kind, key: key, val: val})
    }
    return out
}
```

---

## Task 5: Fuzz a state machine

**Goal:** Fuzz a small finite state machine — a coffee-machine controller.

**Setup:** A state machine with states `idle`, `brewing`, `done`, `error`. Operations: `start`, `pour`, `clean`, `tick`. Some transitions are valid, others are not. Invariant: from any reachable state, `start` then `tick`*N then `pour` then `clean` returns to `idle`.

```go
type cm struct {
    state string
    mu    sync.Mutex
}

func (c *cm) op(name string) (ok bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    switch c.state + "/" + name {
    case "idle/start":    c.state = "brewing"
    case "brewing/tick":  // remain
    case "brewing/pour":  c.state = "done"
    case "done/clean":    c.state = "idle"
    default:              return false
    }
    return true
}
```

**Task:**

1. Encode a sequence of operations as `[]byte` (one byte per op, low 2 bits select operation).
2. Write `FuzzCoffeeMachine` that runs the sequence sequentially in one goroutine. (Sequential first.)
3. Assert: number of `start` actions accepted equals number of `clean` actions accepted (each brew cycle starts and ends once).
4. Then write `FuzzCoffeeMachineConcurrent` that runs operations from 2 goroutines under `-race`.
5. Observe: the simple invariant breaks under concurrency. Why?

**Acceptance:**

- Sequential fuzz target passes for any input.
- Concurrent fuzz target fails because two goroutines can both observe state `idle`, both try to `start`, one fails (which is correct), but operation counts now diverge from any sensible "cycle" count.
- You learn: invariants for sequential systems are not invariants for concurrent ones.

**Reflection:** the lesson is that meaningful invariants for concurrent systems are *post-hoc properties of the history*, not running counters. Use this when designing real concurrent fuzz tests.

---

## Task 6: Stress-replay a fuzz finding

**Goal:** Take a previously fuzz-found failing input and turn it into a stress test.

**Task:**

1. Pick a saved reproducer from any earlier task — for example, `testdata/fuzz/FuzzMapConcurrent/<hash>`.
2. Read the file. Note the byte sequence.
3. Write a regular `TestRegression_MapConcurrent_2026_05_12(t *testing.T)` that:
   - Embeds the byte sequence directly in the test source.
   - Loops 10,000 times, each iteration constructing a fresh map and running the operations across 4 goroutines.
   - Fails if any iteration races.
4. Wrap with `if testing.Short() { t.Skip() }`.
5. Run `go test -race -run=Regression_MapConcurrent`.

**Acceptance:**

- The stress test reliably reproduces the race in seconds (assuming the fix is reverted).
- After the fix, the stress test passes.

**Solution sketch:**

```go
func TestRegression_MapConcurrent_2026_05_12(t *testing.T) {
    if testing.Short() {
        t.Skip()
    }
    raw := []byte{0x01, 'a', 0x05, 0x03, 'a', 0x00 /* ... */}
    for i := 0; i < 10_000; i++ {
        m := New()
        ops := decode(raw)
        var wg sync.WaitGroup
        for w := 0; w < 4; w++ {
            wg.Add(1)
            go func(slice []op) {
                defer wg.Done()
                for _, o := range slice {
                    if o.kind == 0 {
                        m.Set(o.key, o.val)
                    } else {
                        m.Get(o.key)
                    }
                }
            }(slicePart(ops, w, 4))
        }
        wg.Wait()
    }
}
```

---

## Task 7: CI integration sketch

**Goal:** Write a GitHub Actions workflow that fuzzes each target nightly.

**Task:**

1. List your fuzz targets and their packages.
2. Define a matrix job that runs one fuzz target per matrix entry.
3. Each job: `go test -run=^$ -fuzz=^FuzzXxx$ -fuzztime=10m -race ./pkg`.
4. On failure, upload `pkg/testdata/fuzz/` as an artifact.
5. Schedule with `cron: '0 3 * * *'`.

**Acceptance:**

- The workflow file is valid YAML.
- A manual trigger runs all fuzz targets in parallel.
- A nightly failure produces an artifact with the new reproducer.

**Solution sketch:**

```yaml
name: fuzz-nightly
on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:
jobs:
  fuzz:
    strategy:
      matrix:
        target:
          - { pkg: ./parser,  fn: FuzzParse }
          - { pkg: ./decoder, fn: FuzzDecode }
          - { pkg: ./queue,   fn: FuzzQueueConcurrent }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: go test -run=^$ -fuzz=^${{ matrix.target.fn }}$ -fuzztime=10m -race ${{ matrix.target.pkg }}
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: fuzz-failure-${{ matrix.target.fn }}
          path: ${{ matrix.target.pkg }}/testdata/fuzz/
```

---

## Task 8: Corpus from production samples

**Goal:** Bootstrap a fuzz target's corpus from real-world data.

**Setup:** Imagine you have a directory `prod-samples/` with 100 sample HTTP request bodies (anonymised).

**Task:**

1. Place them under `parser/testdata/samples/*.bin` in your repo.
2. Modify `FuzzParse` to load them as seeds at fuzz-target start.
3. Run `-fuzz=FuzzParse -fuzztime=1m` and compare coverage / iteration rate before and after.

**Acceptance:**

- The fuzz target loads the samples without panicking.
- Coverage on the first iteration is meaningfully higher than with synthetic seeds.
- Mutation discovers new failures faster, if any.

**Solution sketch:**

```go
func FuzzParse(f *testing.F) {
    matches, err := filepath.Glob("testdata/samples/*.bin")
    if err != nil {
        f.Fatal(err)
    }
    for _, p := range matches {
        b, err := os.ReadFile(p)
        if err != nil {
            f.Fatal(err)
        }
        f.Add(b)
    }
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = Parse(data)
    })
}
```

---

## Task 9: Use `rapid` for a state machine

**Goal:** Re-implement Task 5 using `pgregory.net/rapid`'s state machine API.

**Task:**

1. Add `pgregory.net/rapid` to your `go.mod`.
2. Define a `coffeeMachine` struct with methods `Start`, `Pour`, `Clean`, `Tick`.
3. Each method advances a model state and asserts the SUT (system-under-test) result matches.
4. Use `rapid.Check(t, func(rt *rapid.T) { rt.Repeat(rapid.StateMachineActions(m)) })`.
5. Compare: how does shrinking behave when there is a bug? How does the failing-action sequence compare to the native fuzzer's reproducer?

**Acceptance:**

- You have a working `rapid` state-machine test for the coffee machine.
- You can describe one difference in failure-reporting between native and `rapid` (e.g. `rapid` shrinks to a minimal action sequence; the native fuzzer shrinks to a minimal byte slice).

---

## Task 10: Combine with linearisability checking

**Goal:** Use `porcupine` to check linearisability of a KV store.

**Task:**

1. Add `github.com/anishathalye/porcupine` to your `go.mod`.
2. Define a sequential `kvModel` for a single-key-set-get store.
3. Modify `FuzzKVConcurrent` to record each operation's start time, end time, input, output.
4. After the workload, call `porcupine.CheckOperations(kvModel, history)`.
5. If the result is non-linearisable, fail the test.

**Acceptance:**

- The fuzz target compiles and runs.
- A deliberately racy KV store fails the linearisability check within seconds.
- A correctly-locked KV store passes.

**Solution sketch:**

```go
var kvModel = porcupine.Model{
    Init: func() any { return map[string]int{} },
    Step: func(state, in, out any) (bool, any) {
        s := state.(map[string]int)
        i := in.(kvInput)
        o := out.(kvOutput)
        switch i.op {
        case "set":
            ns := copyMap(s)
            ns[i.key] = i.val
            return true, ns
        case "get":
            v, ok := s[i.key]
            return v == o.val && ok == o.ok, s
        }
        return false, s
    },
}

func FuzzKVConcurrent(f *testing.F) {
    f.Add([]byte{0x00, 'k', 0x01, 0x00, 'k'})
    f.Fuzz(func(t *testing.T, data []byte) {
        kv := NewKV()
        ops := decodeKV(data)
        if len(ops) == 0 {
            t.Skip()
        }
        history := make([]porcupine.Operation, 0, len(ops))
        var mu sync.Mutex
        var wg sync.WaitGroup
        for _, o := range ops {
            wg.Add(1)
            go func(o kvOp) {
                defer wg.Done()
                start := time.Now().UnixNano()
                var out kvOutput
                switch o.kind {
                case "set":
                    kv.Set(o.key, o.val)
                case "get":
                    v, ok := kv.Get(o.key)
                    out = kvOutput{val: v, ok: ok}
                }
                end := time.Now().UnixNano()
                mu.Lock()
                history = append(history, porcupine.Operation{
                    ClientId: 0,
                    Input:    kvInput{op: o.kind, key: o.key, val: o.val},
                    Output:   out,
                    Call:     start,
                    Return:   end,
                })
                mu.Unlock()
            }(o)
        }
        wg.Wait()
        if !porcupine.CheckOperations(kvModel, history) {
            t.Fatalf("not linearisable")
        }
    })
}
```

---

## Summary

The tasks progress from a one-line invariant on `Reverse` through a full linearisability-checked KV store. By Task 6 you have a complete loop: fuzz, find, fix, stress-replay, commit. By Task 10 you have integrated the most sophisticated property check in the Go ecosystem. If you can solve all ten tasks, you have working knowledge sufficient to introduce fuzzing to any concurrent codebase. The recurring theme: small invariants find a lot; rich invariants (linearisability) find subtle ordering bugs; the race detector amplifies both classes; persistent corpora make every find a forever-regression.
