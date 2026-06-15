# Loop Variable Semantics (Go 1.22) — Find the Bug

> Each snippet contains a real-world bug related to loop variable semantics. Go 1.22 makes each iteration get a fresh instance of the loop variable (gated on the module's `go` directive being ≥ 1.22); before that, the variable was shared across iterations. Many bugs below are the classic capture bug under an old directive; others are subtler — assuming the wrong thing about the gate, the cost, or adjacent features like `defer`. Find the bug, explain it, fix it.

---

## Bug 1 — Goroutine capture under a `go 1.21` module

```go
// go.mod says: go 1.21
func fanOut(items []string) {
    var wg sync.WaitGroup
    for _, it := range items {
        wg.Add(1)
        go func() {
            defer wg.Done()
            process(it)
        }()
    }
    wg.Wait()
}
```

**Bug:** Under the `go 1.21` directive, `it` is a single shared variable. All goroutines capture the same `it`, which holds the *last* item by the time they run. Most items are processed multiple times and earlier ones are skipped.

**Fix:** raise the directive to `go 1.22`, which makes `it` per-iteration — or, version-independently, pass the value as an argument:

```go
go func(s string) { defer wg.Done(); process(s) }(it)
```

The argument form is correct under any directive.

---

## Bug 2 — "I installed Go 1.22, so I'm fine"

```go
// go.mod still says: go 1.20
for i := 0; i < n; i++ {
    handlers = append(handlers, func() { route(i) })
}
```

```bash
$ go version
go version go1.22.0 darwin/arm64
$ # handlers all call route(n)
```

**Bug:** The developer upgraded the *toolchain* to 1.22 but the *module's `go` directive* is still 1.20. The behavior is gated on the directive, not the installed compiler, so the loop still uses shared-variable semantics and every handler captures the final `i`.

**Fix:** bump the directive (after running the test suite):

```
// go.mod
go 1.22
```

The toolchain version is irrelevant; the directive is the switch.

---

## Bug 3 — Removing `v := v` while still on an old directive

```go
// go.mod: go 1.21  (a shared library targeting old consumers)
for _, cfg := range configs {
-   cfg := cfg
    go apply(cfg)   // wait, apply takes cfg by value — see below
}
```

Actually the loop captures in a closure:

```go
for _, cfg := range configs {
    go func() { apply(cfg) }()   // cfg := cfg was just deleted
}
```

**Bug:** Someone "modernized" the code by deleting the `cfg := cfg` shadow, assuming 1.22 semantics. But this module's directive is still `go 1.21`, so the shadow was *load-bearing*. Removing it reintroduces the classic capture bug.

**Fix:** either restore the shadow, or (better, if the module can move) bump the directive to `go 1.22` so the shadow is genuinely redundant. Never remove `v := v` from code that still builds under a < 1.22 directive.

---

## Bug 4 — `&v` stored across iterations

```go
// go.mod: go 1.21
func index(records []Record) map[string]*Record {
    out := map[string]*Record{}
    for _, r := range records {
        out[r.ID] = &r
    }
    return out
}
```

**Bug:** `&r` is the address of the single shared loop variable. After the loop, every map entry points to the *same* `r`, which holds the last record. The map is corrupt — every key maps to the final record.

**Fix:** under `go 1.22` this is automatically correct (each `&r` is distinct). Version-independently, copy explicitly or index the slice:

```go
r := r          // explicit per-iteration copy (works on any directive)
out[r.ID] = &r
// or:
out[records[i].ID] = &records[i]   // address the actual element
```

---

## Bug 5 — Parallel subtests without per-iteration `tc`

```go
// go.mod: go 1.21
func TestCases(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            assertEqual(t, transform(tc.in), tc.want)
        })
    }
}
```

**Bug:** `t.Parallel()` defers each subtest until the loop completes. Under the old directive, all subtests share one `tc` and see the *last* case. The suite silently tests one case `len(cases)` times — green CI, zero real coverage of the other cases.

**Fix:** bump the module to `go 1.22` (each subtest gets its own `tc`), or add `tc := tc` for old directives. The 1.22 bump is the durable fix and removes the footgun for all future tests.

---

## Bug 6 — Assuming the bug is gone in a dependency

```go
// your module: go 1.22
// dependency github.com/legacy/lib: go 1.20
results := legacylib.MapConcurrently(items, fn) // internally captures a loop var
```

**Bug:** You bumped *your* module to 1.22 and assumed all loop-capture bugs in the build are fixed. But the dependency's own `go` directive is 1.20, so *its* internal loops still use shared-variable semantics. The per-module gate leaves the dependency's bug intact.

**Fix:** you cannot fix it from your module — the gate is per module. Options: upgrade to a dependency version whose directive is ≥ 1.22, file an upstream issue, or avoid the buggy API. Do not assume your directive bump heals dependencies.

---

## Bug 7 — Treating a new allocation as a regression and reverting

```go
// after bumping go.mod from 1.21 to 1.22, a profile shows new allocations:
for _, job := range jobs {
    queue = append(queue, func() { run(job) }) // moved to heap: job
}
```

```
git revert <the directive bump>   // "to fix the allocation regression"
```

**Bug:** The "regression" is correctness. Pre-1.22 this loop was *buggy* — every queued closure captured the same `job` and ran the last one repeatedly. The per-iteration allocation is the real cost of doing the right thing (identical to what `job := job` would have cost). Reverting the bump reinstates the bug to save an allocation.

**Fix:** keep the bump. If the allocation matters in a hot path, eliminate the *capture*, not the correctness:

```go
queue = append(queue, makeRunner(job)) // makeRunner takes job by value
```

---

## Bug 8 — `for {}` "fix" that does nothing

```go
// go.mod: go 1.21
i := 0
for {
    if i >= 3 { break }
    go func() { fmt.Println(i) }()
    i++
}
```

```
// someone "bumped to 1.22 to fix it" but output is still 3 3 3
```

**Bug:** This is a `for {}` loop with `i` declared *outside* the loop. There is no loop-declared variable, so the Go 1.22 change does not apply — `i` is a normal outer variable shared by all goroutines. Bumping the directive changes nothing here.

**Fix:** the change only affects variables declared *by* the `for` clause with `:=`. Use a proper loop variable, or pass by argument:

```go
for i := 0; i < 3; i++ {        // now i is loop-declared
    go func() { fmt.Println(i) }() // per-iteration under 1.22
}
// or, any version:
go func(n int) { fmt.Println(n) }(i)
```

---

## Bug 9 — `&v` vs `&slice[i]` confusion after migration

```go
// go.mod: go 1.22
func zeroOut(nums []int) {
    for _, v := range nums {
        p := &v
        *p = 0       // intends to zero the slice
    }
    // nums is unchanged!
}
```

**Bug:** Under 1.22, `&v` is the address of the per-iteration *copy*, not the slice element. Writing through it zeroes the copy and leaves `nums` untouched. (Pre-1.22 it would have zeroed only the shared copy too — still not the slice.) The migration didn't cause this; it's a misunderstanding of what `&v` addresses.

**Fix:** address the element via index:

```go
for i := range nums {
    nums[i] = 0
}
```

`&v` is never the element's address, in any Go version.

---

## Bug 10 — `defer` in a loop assumed to run per iteration

```go
// go.mod: go 1.22
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()              // each f is correct now...
        if err := handle(f); err != nil { return err }
    }
    return nil
}
```

**Bug:** The 1.22 fix ensures each `f` is per-iteration, so the right file is closed — but all `defer f.Close()` calls still run at *function return*, not at iteration end. Processing thousands of paths holds thousands of file descriptors open until `processAll` returns, risking "too many open files." The loopvar fix is unrelated to `defer` timing.

**Fix:** close within the iteration, e.g. via a helper:

```go
for _, p := range paths {
    if err := func() error {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()              // runs at the closure's return = per iteration
        return handle(f)
    }(); err != nil {
        return err
    }
}
```

---

## Bug 11 — Three-clause loop with a captured counter under old directive

```go
// go.mod: go 1.18
func schedule(n int) []func() int {
    var tasks []func() int
    for i := 0; i < n; i++ {
        tasks = append(tasks, func() int { return i })
    }
    return tasks
}
// every task returns n, not its index
```

**Bug:** The three-clause loop's `i` is shared under the 1.18 directive, so every captured closure returns the final `i` (which is `n`). Callers expecting task `k` to return `k` get `n` everywhere.

**Fix:** bump to `go 1.22` (per-iteration `i`), or capture explicitly:

```go
i := i
tasks = append(tasks, func() int { return i })
```

This is the three-clause form of the same bug — easy to forget it's affected too.

---

## Bug 12 — Range-over-func capture assumed broken

```go
// go.mod: go 1.23
func collect(seq func(func(int) bool)) []func() int {
    var fs []func() int
    for v := range seq {
        v := v                       // defensive shadow
        fs = append(fs, func() int { return v })
    }
    return fs
}
```

**Bug:** Not a correctness bug — but the `v := v` is redundant noise. Under `go 1.23`, the range-over-func loop variable `v` is per-iteration just like any range variable; each yielded value already gets its own `v`. The defensive shadow is leftover habit.

**Fix:** drop the shadow in a 1.23 module:

```go
for v := range seq {
    fs = append(fs, func() int { return v })
}
```

Per-iteration semantics compose with iterators; no workaround is needed.

---

## Bug 13 — `GOFLAGS=-lang` or build-tag pinning hides the gate

```bash
# CI sets, for unrelated reasons:
$ export GOFLAGS=-gcflags=-lang=go1.21
$ go build ./...   # module go.mod says go 1.22
# loops behave as 1.21 — shared variable — in a "1.22" module
```

**Bug:** A stray `-lang=go1.21` override forces the compiler to treat the package as language version 1.21, disabling per-iteration semantics even though `go.mod` declares 1.22. The build silently runs old loop behavior. Output diverges from a normal `go build`.

**Fix:** remove the override; let the `go` directive drive `-lang`:

```bash
$ unset GOFLAGS
$ go build ./...
```

Never pin `-lang` below the module's directive — it reintroduces the bug invisibly. Audit `GOFLAGS` and CI env when behavior contradicts `go.mod`.

---

## Bug 14 — Mixing the gate up with closure-by-value belief

```go
// go.mod: go 1.22
total := 0
adders := []func(){}
for _, n := range []int{1, 2, 3} {
    adders = append(adders, func() { total += n })
}
for _, a := range adders { a() }
fmt.Println(total) // developer expected 6, got 6 — but reasons about it wrongly
```

**Bug:** The *output* is correct (`6`), but the developer's mental model is wrong: they believe 1.22 made the closure capture `n` *by value* at append time. It did not. Each closure still captures its per-iteration `n` *by reference*; the value happens to be fixed because that iteration's `n` is never reassigned. The distinction bites when they later mutate the loop variable in the body and expect the old captured value.

**Fix (of the model):** 1.22 changes *which* variable is captured (a fresh one per iteration), not *how* (still by reference). If you mutate the per-iteration variable after capturing, the closure sees the mutation:

```go
for _, n := range nums {
    f := func() { use(n) }
    n = transform(n)   // f now sees the transformed n — still by reference
    register(f)
}
```

---

## Bug 15 — Assuming `range` over a map element is addressable

```go
// go.mod: go 1.22
func bump(m map[string]int) []*int {
    var ps []*int
    for _, v := range m {
        ps = append(ps, &v)
    }
    return ps
}
```

**Bug:** Two layers. (1) `&v` is the per-iteration variable's address (correct and distinct under 1.22), so each pointer is independent — good. But (2) if the developer *intended* to get pointers into the map, that's impossible: map elements are not addressable in Go, so `&m[k]` doesn't even compile, and `&v` only ever points at a copy. The returned pointers don't alias the map.

**Fix:** if you need stable, independent pointers to the values, `&v` under 1.22 is actually fine (each is a distinct copy). If you needed to *mutate the map through the pointer*, you cannot — reassign via the map instead: `m[k] = newVal`. Be explicit about which you want.

---

## Bug 16 — Linter false positive after migration

```yaml
# .golangci.yml — still enabled after the repo moved to go 1.22
linters:
  enable:
    - exportloopref
    - scopelint
```

```
$ golangci-lint run
loop.go:12: exporting a pointer for the loop variable v (scopelint)
```

**Bug:** The repo migrated to `go 1.22`, so capturing the loop variable is correct — but `exportloopref`/`scopelint` are loop-capture linters built for the old semantics and aren't directive-aware. They flag now-correct code, producing noise and failing CI for the wrong reason.

**Fix:** remove the obsolete linters once the repo is fully on `go 1.22`:

```yaml
linters:
  disable:
    - exportloopref
    - scopelint
```

`go vet`'s `loopclosure` is directive-aware and stays silent on 1.22 code; rely on it instead.

---

## Bug 17 — Capturing the index but not the value, then mutating the slice

```go
// go.mod: go 1.22
func deferredReads(xs []int) []func() int {
    var fns []func() int
    for i := range xs {
        fns = append(fns, func() int { return xs[i] })
    }
    // caller later mutates xs...
    return fns
}
```

**Bug:** `i` is per-iteration and captured correctly, so each closure reads a distinct index. But the closures capture `xs` (the slice header) too, and read `xs[i]` *at call time*. If the caller mutates `xs` after `deferredReads` returns, the closures observe the new values — which may or may not be intended. The loopvar fix made `i` correct; it does nothing about the live read of a shared, mutable slice.

**Fix:** if you want the value frozen at loop time, capture the value, not the index:

```go
for _, v := range xs {
    fns = append(fns, func() int { return v }) // v frozen per iteration
}
```

Per-iteration `i` is not the same as snapshotting the data it indexes.

---

## Bug 18 — Forward-compat file constraint missing

```go
//go:build go1.20   // upper bound left from an old copy-paste
package worker

func spawn(items []int) {
    for _, it := range items {
        go func() { handle(it) }()   // wants per-iteration capture
    }
}
```

```
// even in a go 1.22 module, this file behaves as 1.20 → shared variable
```

**Bug:** A leftover `//go:build go1.20` constraint pins this *file's* language version below the module's directive (the build system uses the per-file constraint). The file compiles as 1.20, so the capture uses shared-variable semantics despite the module being on 1.22.

**Fix:** remove or correct the stale build constraint so the file inherits the module's `go 1.22` directive:

```go
package worker   // no spurious version constraint
```

Per-file `//go:build go1.NN` constraints affect the effective language version — audit them when a file's loop behavior contradicts the module.

---

## Bug 19 — Re-introducing the bug by "simplifying" a worker pool

```go
// go.mod: go 1.22  (correct as written)
for _, w := range workers {
    go w.Run(ctx)            // method value on the per-iteration w — fine
}

// "simplified" to:
for _, w := range workers {
    go func() { w.Run(ctx) }()   // also fine under 1.22...
}
```

**Bug:** Both versions are correct under 1.22 — this is a trap question. The subtle issue: if this file is ever *copied into a module on an older directive* (a common refactor across a polyrepo), the closure form silently breaks while the method-value form `go w.Run(ctx)` stays correct because it evaluates `w.Run` (binding the current `w`) at the `go` statement.

**Fix (defensive):** prefer the form that's correct under any directive when code may migrate between modules. `go w.Run(ctx)` evaluates the receiver eagerly; the closure form relies on per-iteration semantics. Know the difference so a cross-module copy doesn't regress.

---

## Bug 20 — Expecting `continue` to leak the last value

```go
// go.mod: go 1.22
var last *Item
for _, it := range items {
    if !it.Valid {
        continue
    }
    last = &it
}
use(last) // intends "address of the last valid item"
```

**Bug:** Under 1.22, `&it` is per-iteration, so `last` correctly points to the last *valid* item's distinct variable — actually fine. The trap is the developer's worry that `continue` or per-iteration semantics would corrupt `last`. It won't: `last` is an outer variable assigned the address of whichever iteration's `it` ran last through the assignment. Under *pre-1.22*, however, `&it` would be the shared variable and `last` would point at the final *iterated* item (valid or not, holding the last loop value) — a real bug there.

**Fix (for old directives) / clarity:** copy the value into the outer variable explicitly to make intent unambiguous across versions:

```go
var last Item
found := false
for _, it := range items {
    if it.Valid { last = it; found = true }
}
if found { use(&last) }
```

---

## Summary

Loop variable bugs cluster around three misunderstandings:

1. **The gate.** The behavior is controlled by the module's `go` directive (and per-file `//go:build go1.NN` constraints and any `-lang` override), *not* the installed toolchain. Bumping the toolchain alone fixes nothing; a stray `-lang` or stale build constraint can silently keep old semantics; a 1.22 module does not heal a 1.21 dependency. Always reason from the effective language version.
2. **What changed vs. what didn't.** 1.22 makes the `for`-declared variable per-iteration — for both `range` and three-clause forms. It does *not* change closure capture from by-reference to by-value, does *not* affect `for {}` loops with externally-declared variables, does *not* change `defer` timing, and does *not* make `&v` address a slice element. Match the fix to the actual mechanism.
3. **Cost vs. correctness.** A new per-iteration allocation after migration is the real cost of correctness (identical to old `v := v`), not a regression to revert. Remove redundant `v := v` and obsolete loop-capture linters only once fully on ≥ 1.22 — and never strip the shadow from code that still builds under an older directive.

Treat the `go` directive as the source of truth for loop semantics, write version-independent code (`go f(x){...}(v)` or eager method values) when code may cross module boundaries, and keep the loopvar fix mentally separate from `defer`, addressability, and slice-aliasing concerns.
