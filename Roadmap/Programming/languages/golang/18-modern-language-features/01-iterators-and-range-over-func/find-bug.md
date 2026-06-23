# Iterators & Range-over-Func — Find the Bug

> Each snippet contains a real-world bug related to Go 1.23 range-over-func iterators. An iterator is `iter.Seq[V]` = `func(yield func(V) bool)` (or `iter.Seq2[K,V]`); you call `yield` per value, and `if !yield(v) { return }` is the contract. `iter.Pull` converts a push iterator to a `(next, stop)` pull pair and you must call `stop()`. Find the bug, explain it, fix it.

---

## Bug 1 — Ignoring `yield`'s return value

```go
func Count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            yield(i) // bug
        }
    }
}

// for v := range Count(10) { if v == 3 { break } }
// panic: range function continued iteration after function for loop body returned false
```

**Bug:** The iterator never checks `yield`'s `bool`. When the consumer `break`s, `yield` returns `false`, but the loop keeps calling it. The second call after `false` panics.

**Fix:** guard every `yield`.

```go
for i := 0; i < n; i++ {
    if !yield(i) {
        return
    }
}
```

---

## Bug 2 — Cleanup after the loop instead of `defer`

```go
func Lines(path string) iter.Seq[string] {
    return func(yield func(string) bool) {
        f, _ := os.Open(path)
        sc := bufio.NewScanner(f)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return // bug: f is never closed on early break
            }
        }
        f.Close() // only runs if the loop finishes normally
    }
}
```

**Bug:** `f.Close()` is after the loop. On an early `break`, the iterator returns before reaching it — the file descriptor leaks. Under load this exhausts FDs.

**Fix:** `defer` the close right after acquiring it.

```go
f, err := os.Open(path)
if err != nil { return }
defer f.Close() // runs on normal end, early break, AND panic
```

---

## Bug 3 — Forgetting `stop()` after `iter.Pull`

```go
func first(seq iter.Seq[int]) (int, bool) {
    next, _ := iter.Pull(seq) // bug: stop discarded
    return next()
}
```

**Bug:** `iter.Pull` runs the producer on a parked goroutine. Discarding `stop` and returning after one `next()` leaves the producer blocked forever — a goroutine leak that also never runs the producer's `defer`s.

**Fix:** capture and `defer stop()`.

```go
next, stop := iter.Pull(seq)
defer stop()
return next()
```

---

## Bug 4 — `defer stop()` registered too late

```go
next, stop := iter.Pull(seq)
v, ok := next()
if !ok {
    return // bug: returns before defer stop() — leak
}
defer stop()
```

**Bug:** The early `return` happens *before* `defer stop()` is registered, so `stop()` is never called on that path. The producer goroutine leaks.

**Fix:** register the defer on the line immediately after `iter.Pull`, before any branch.

```go
next, stop := iter.Pull(seq)
defer stop() // first thing
v, ok := next()
if !ok {
    return
}
```

---

## Bug 5 — Letting `yield` escape the iterator

```go
func Broken(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        go func() {
            for i := 0; i < n; i++ {
                yield(i) // bug: called from another goroutine, after iterator returns
            }
        }()
        // iterator returns immediately
    }
}
// panic: range function continued iteration after whole loop exit
```

**Bug:** `yield` is only valid during the iterator's own call. Here the iterator spawns a goroutine and returns; the goroutine calls the captured `yield` afterwards, tripping the "whole loop exit" panic. Push iterators are synchronous — no goroutine needed.

**Fix:** call `yield` synchronously in the iterator body.

```go
return func(yield func(int) bool) {
    for i := 0; i < n; i++ {
        if !yield(i) {
            return
        }
    }
}
```

---

## Bug 6 — Recursive iterator drops the stop signal

```go
func (n *Node) walk(yield func(int) bool) {
    if n == nil {
        return
    }
    n.Left.walk(yield)
    yield(n.Val)      // bug: return value ignored
    n.Right.walk(yield)
}
```

**Bug:** In a recursive tree walk, ignoring `yield`'s return means a consumer `break` does not unwind the recursion. The walk keeps calling `yield` after it returned `false` — panic. The recursion must thread the bool back up.

**Fix:** return a `bool` from `walk` and check it.

```go
func (n *Node) walk(yield func(int) bool) bool {
    if n == nil { return true }
    if !n.Left.walk(yield) { return false }
    if !yield(n.Val) { return false }
    return n.Right.walk(yield)
}
```

---

## Bug 7 — `go.mod` not at 1.23

```go.mod
module example.com/app

go 1.22
```

```bash
$ go build ./...
./main.go:12:14: cannot range over Count(5) (variable of type iter.Seq[int]):
    requires go1.23 or later
```

**Bug:** Range-over-func is gated on the module's *language version*. With `go 1.22` in `go.mod`, the `for range f` syntax is rejected even on a 1.23+ toolchain.

**Fix:** raise the directive (and document the minimum toolchain).

```go.mod
go 1.23
```

---

## Bug 8 — Wrong arity: `slices.Values` vs `slices.All`

```go
s := []string{"a", "b", "c"}
for i, v := range slices.Values(s) { // bug
    fmt.Println(i, v)
}
// compile error: range over slices.Values(s) permits only one iteration variable
```

**Bug:** `slices.Values` is a `Seq[V]` — one value per step. Using two loop variables is a compile error. The index+value helper is `slices.All` (`Seq2[int, V]`).

**Fix:** pick the helper that matches the arity you want.

```go
for v := range slices.Values(s) { ... }      // values only
for i, v := range slices.All(s) { ... }       // index + value
```

---

## Bug 9 — Mutating a map while ranging its iterator

```go
for k := range maps.Keys(m) {
    if shouldDrop(k) {
        delete(m, k) // bug: mutating the map during iteration
    }
}
```

**Bug:** `maps.Keys(m)` yields keys by ranging the live map. Deleting from `m` during iteration is the same hazard as a plain `for k := range m` with concurrent mutation — undefined which keys you see, and unsafe under concurrent access. The iterator does not snapshot the map.

**Fix:** collect first, then mutate.

```go
for _, k := range slices.Collect(maps.Keys(m)) {
    if shouldDrop(k) {
        delete(m, k)
    }
}
```

---

## Bug 10 — Assuming sorted order from a map iterator

```go
for k, v := range maps.All(config) {
    writeLine(k, v) // bug: output order is randomised
}
```

**Bug:** `maps.All` (like `maps.Keys`/`maps.Values`) yields in unspecified, randomised order. Code that needs deterministic output (config files, golden tests) will be flaky.

**Fix:** sort the keys, then look up values.

```go
for _, k := range slices.Sorted(maps.Keys(config)) {
    writeLine(k, config[k])
}
```

---

## Bug 11 — Calling the iterator instead of ranging it

```go
seq := Count(3)
seq() // bug: nil yield — panic, or does nothing useful
```

```
panic: runtime error: invalid memory address or nil pointer dereference
```

**Bug:** `Count(3)` returns an iterator function. Calling it with no argument (or trying to "run" it) is wrong — it expects a `yield`. You consume it by ranging over it, which supplies `yield`.

**Fix:** range over it (or `slices.Collect` it).

```go
for v := range Count(3) { use(v) }
// or
vals := slices.Collect(Count(3))
```

---

## Bug 12 — Single-use iterator ranged twice

```go
it := Lines(file) // wraps a bufio.Scanner: single-use
total := 0
for range it { total++ }     // counts all lines
for range it { total++ }     // bug: yields nothing; scanner exhausted
```

**Bug:** The iterator wraps a `*bufio.Scanner`, which is single-pass. The second range produces nothing because the underlying scanner is already at EOF. The type `iter.Seq[string]` does not reveal this.

**Fix:** collect once if you need multiple passes, and document the iterator as single-use.

```go
lines := slices.Collect(Lines(file))
for range lines { ... }
for range lines { ... } // fine — slice is restartable
```

---

## Bug 13 — Combinator forgets to thread the error

```go
func Map[A, B any](seq iter.Seq2[A, error], f func(A) B) iter.Seq2[B, error] {
    return func(yield func(B, error) bool) {
        for a, _ := range seq { // bug: drops the error
            if !yield(f(a), nil) {
                return
            }
        }
    }
}
```

**Bug:** The `Map` combinator over a `Seq2[A, error]` discards the incoming error (`_`) and always yields `nil`. A decode error upstream is silently swallowed; the consumer never sees it.

**Fix:** thread the error through unchanged; only transform the value half.

```go
for a, err := range seq {
    if err != nil {
        if !yield(*new(B), err) { return }
        continue
    }
    if !yield(f(a), nil) { return }
}
```

---

## Bug 14 — Reusing a buffer across `yield` calls

```go
func Records(r io.Reader) iter.Seq[[]byte] {
    return func(yield func([]byte) bool) {
        buf := make([]byte, 0, 4096)
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            buf = append(buf[:0], sc.Bytes()...) // reused buffer
            if !yield(buf) { // bug: caller may retain buf
                return
            }
        }
    }
}

// consumer:
var all [][]byte
for b := range Records(r) {
    all = append(all, b) // every entry aliases the same buffer!
}
```

**Bug:** The iterator yields the *same* backing slice every step. A consumer that retains the yielded value (`append(all, b)`) ends up with every element aliasing one buffer, all showing the last record. This is the `bufio.Scanner.Bytes()` aliasing hazard, propagated through the iterator.

**Fix:** yield a fresh copy, or document that the value is only valid until the next iteration.

```go
rec := make([]byte, len(sc.Bytes()))
copy(rec, sc.Bytes())
if !yield(rec) { return }
```

---

## Bug 15 — `iter.Pull` consumer never checks `ok`

```go
next, stop := iter.Pull(Count(3))
defer stop()
for {
    v := first(next()) // bug: ignores the ok bool
    use(v)             // loops forever, using zero values past the end
}
```

**Bug:** `next()` returns `(value, ok)`. Ignoring `ok` means the loop never detects the end of the sequence; after exhaustion `next()` returns `(0, false)` repeatedly and the loop spins forever using zero values.

**Fix:** check `ok` and break.

```go
for {
    v, ok := next()
    if !ok {
        break
    }
    use(v)
}
```

---

## Bug 16 — Concurrent `next`/`stop` from two goroutines

```go
next, stop := iter.Pull(seq)
defer stop()
for i := 0; i < 4; i++ {
    go func() {
        for {
            v, ok := next() // bug: next() called concurrently
            if !ok { return }
            process(v)
        }
    }()
}
```

**Bug:** `next` and `stop` are documented as not safe for concurrent use. Calling `next()` from multiple goroutines corrupts the underlying coroutine state (data race, panics, or lost/duplicated values).

**Fix:** drive the iterator from one goroutine and fan out the *values*, or guard `next` with a mutex.

```go
var mu sync.Mutex
nextSafe := func() (int, bool) {
    mu.Lock(); defer mu.Unlock()
    return next()
}
```

(Better: pull serially on one goroutine and send values to workers over a channel.)

---

## Bug 17 — Infinite iterator collected without a bound

```go
func Naturals() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; ; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

nums := slices.Collect(Naturals()) // bug: never returns; OOM
```

**Bug:** `Naturals()` is infinite. `slices.Collect` drains the iterator fully — over an infinite sequence it never returns and grows the slice until the process is OOM-killed.

**Fix:** bound the sequence before collecting (e.g. with a `Take` combinator).

```go
nums := slices.Collect(Take(Naturals(), 100))
```

---

## Bug 18 — `break` in the iterator instead of honouring `yield`

```go
func evens(s []int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for _, v := range s {
            if v%2 != 0 {
                break // bug: stops the iterator on an odd value
            }
            if !yield(v) {
                return
            }
        }
    }
}
```

**Bug:** The iterator's own `break` stops production at the first odd number — but the intent was to *skip* odds and yield all evens. Control flow inside the iterator was confused with filtering.

**Fix:** `continue` to skip, not `break` to stop.

```go
for _, v := range s {
    if v%2 != 0 {
        continue
    }
    if !yield(v) {
        return
    }
}
```

---

## Bug 19 — Capturing the loop variable's address incorrectly

```go
var ptrs []*int
for v := range Count(3) {
    ptrs = append(ptrs, &v)
}
fmt.Println(*ptrs[0], *ptrs[1], *ptrs[2])
```

**Bug (subtle / version-dependent):** Developers coming from pre-1.22 Go expect all three pointers to alias one reused `v` (printing `2 2 2`). Range-over-func uses per-iteration scoping (Go 1.22+), so each `v` is fresh and this prints `0 1 2`. The "bug" is the *assumption*: code written for old semantics that relied on aliasing is now wrong, and conversely code that needs aliasing won't get it.

**Fix:** rely on per-iteration scoping (correct in 1.23). If you truly need shared state, declare it outside the loop explicitly. Don't carry pre-1.22 mental models into range-over-func.

---

## Bug 20 — Error swallowed because terminal `yield` ignored

```go
func Lines(r io.Reader) iter.Seq2[string, error] {
    return func(yield func(string, error) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text(), nil) {
                return
            }
        }
        yield("", sc.Err()) // bug: return value ignored; also yields ("", nil) on success
    }
}
```

**Bug:** Two problems. First, the terminal `yield` is unconditional — on a successful scan with `sc.Err() == nil`, it yields a spurious `("", nil)` element. Second, its return value is ignored, so if the consumer already stopped, this extra `yield` after `false` panics.

**Fix:** only yield the error when there is one, and the loop has not already stopped.

```go
for sc.Scan() {
    if !yield(sc.Text(), nil) {
        return
    }
}
if err := sc.Err(); err != nil {
    yield("", err) // last statement; no further yields
}
```

---

## Bug 21 — `iter.Pull` driving a producer that re-enters itself

```go
func dedup(seq iter.Seq[int]) iter.Seq[int] {
    return func(yield func(int) bool) {
        next, stop := iter.Pull(seq)
        defer stop()
        seen := map[int]bool{}
        for v := range seq { // bug: ranges seq AND pulls seq — double consumption
            _ = next
            if seen[v] { continue }
            seen[v] = true
            if !yield(v) { return }
        }
    }
}
```

**Bug:** The function both `iter.Pull`s `seq` *and* `for range seq`s it. `seq` is consumed twice (and for a single-use source, the pull goroutine and the range fight over the same stream). The `next`/`stop` are dead weight at best and a double-drive at worst.

**Fix:** pick one driver. For simple dedup, just range:

```go
return func(yield func(int) bool) {
    seen := map[int]bool{}
    for v := range seq {
        if seen[v] { continue }
        seen[v] = true
        if !yield(v) { return }
    }
}
```

---

## Bug 22 — Assuming the experiment flag is still needed

```bash
$ GOEXPERIMENT=rangefunc go build ./...   # on Go 1.23
$ # works, but the flag is meaningless now
$ go vet ./...
# CI inherits GOEXPERIMENT=rangefunc and masks a real config problem
```

**Bug:** `GOEXPERIMENT=rangefunc` was required only in Go 1.22's preview. On 1.23+ the feature is GA and the flag is obsolete. Carrying it in CI/Makefiles is cargo-culting — it can hide that the real gate (the `go` directive) is mis-set, and confuses new contributors.

**Fix:** remove the flag everywhere; rely on `go 1.23` in `go.mod`.

```bash
$ go build ./...   # no GOEXPERIMENT needed
```

Grep your repo: `grep -rn GOEXPERIMENT . | grep rangefunc` and delete the stale entries.

---

## Summary

Range-over-func looks like ordinary loop syntax, but iterators are a *contract* with strict rules. Most iterator bugs come from one of three habits:

1. **Not honouring `yield`'s `bool`.** Every `yield` needs `if !yield(v) { return }`; in recursion, thread the bool back up. Calling `yield` after it returned `false`, or after the iterator returned (letting it escape to a goroutine), panics. This is the single largest bug class.
2. **Mismanaging lifecycle.** Resource cleanup must be `defer`ed *inside* the iterator so it survives early `break` and panic — never after the loop. Every `iter.Pull` needs `defer stop()` on the very next line, or the producer goroutine leaks. `next`/`stop` are not concurrency-safe.
3. **Wrong assumptions about semantics.** Map iterators are unordered and not snapshots; single-use iterators don't replay; `slices.Values` is `Seq` not `Seq2`; infinite iterators can't be `Collect`ed unbounded; per-iteration scoping (1.22+) changed pointer-capture behaviour; and `GOEXPERIMENT=rangefunc` is obsolete on 1.23+.

Treat an iterator as code that calls back into your loop under a precise protocol: guard every `yield`, defer every cleanup, `stop` every pull, and document laziness and reusability. With those habits the feature is invisible and fast.
