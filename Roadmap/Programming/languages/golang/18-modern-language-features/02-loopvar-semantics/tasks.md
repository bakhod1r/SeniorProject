# Loop Variable Semantics (Go 1.22) — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end. You will need both a Go 1.22+ toolchain and the ability to edit the `go` directive in `go.mod` to flip between behaviors.

---

## Easy

### Task 1 — Reproduce the classic bug, then fix it by version

Create a module with `go 1.22` in `go.mod`. Write:

```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }()
}
```

(wrap in a `sync.WaitGroup` so the program waits). Run it — observe `0 1 2`. Now edit `go.mod` to `go 1.21` and run again — observe `3 3 3`.

**Goal.** See with your own eyes that the `go` directive, not the toolchain, controls the behavior.

---

### Task 2 — The `&v` pointer bug

Write a loop that appends `&v` to a slice of `*int`, ranging over `[]int{10, 20, 30}`, then prints all dereferenced pointers. Run under `go 1.22` (expect `10 20 30`) and under `go 1.21` (expect `30 30 30`).

**Goal.** Internalize that `&v` addresses the per-iteration variable in 1.22 and the shared variable pre-1.22.

---

### Task 3 — `&v` vs `&slice[i]`

Extend Task 2. Add a second slice built with `&nums[i]` instead of `&v`. Confirm that `&nums[i]` prints `10 20 30` under *both* directives, because it addresses the actual slice element, not the loop variable.

**Goal.** Distinguish the loop-copy address from the element address.

---

### Task 4 — Closures collected in a slice

Build a `[]func()` in a loop over `[]string{"a","b","c"}`, each closure printing the loop variable. Call them all afterward. Compare output under both directives (`a b c` vs `c c c`).

**Goal.** See the closure-capture form of the bug, distinct from goroutines.

---

### Task 5 — The redundant `v := v`

Take the Task 1 loop and add `i := i` as the first line of the body. Run under `go 1.21` (now prints `0 1 2`) and under `go 1.22` (still `0 1 2`). Conclude that the shadow is the old fix and is redundant under 1.22.

**Goal.** Understand why `v := v` was needed and why it no longer is.

---

## Medium

### Task 6 — Range-over-integer capture

Use the Go 1.22 `for i := range 10` form, launching a goroutine per iteration that prints `i`. Confirm you get `0..9` (in some order) under `go 1.22`. Then ask: what would this even compile to under `go 1.21`? (Answer: `range 10` is also a 1.22 feature, so the file requires 1.22 — note the version coupling.)

**Goal.** Connect the new range-over-integer form to per-iteration semantics.

---

### Task 7 — Parallel table-driven tests

Write a table-driven test with `t.Run(tc.name, func(t *testing.T) { t.Parallel(); ... })`, *without* `tc := tc`. Make the table have two cases with different expected values. Run under `go 1.22` (both cases tested correctly) and `go 1.21` (both subtests see the last `tc` — the test silently checks one case twice).

**Goal.** Experience the single most damaging real-world form of the bug.

---

### Task 8 — Enumerate affected loops with `-d=loopvar`

Take a small program with several loops, some capturing and some not. Build with:

```bash
go build -gcflags=all=-d=loopvar=2 ./... 2>&1 | grep loopvar
```

Match each reported file:line to a *capturing* loop, and confirm non-capturing loops are not reported.

**Goal.** Use the compiler diagnostic that drives real migrations.

---

### Task 9 — Confirm zero cost for non-capturing loops

Write a hot numeric loop (`for i := 0; i < n; i++ { sum += i }`). Build with `-gcflags=-m` under both directives and confirm no `moved to heap` for `i`. Optionally diff `-gcflags=-S` assembly between directives for this function and confirm it's identical.

**Goal.** Verify the performance contract: non-capturing loops are free.

---

### Task 10 — Observe the per-iteration allocation

Write a loop that captures `v` in an escaping closure (append the closure to a slice). Build with `-gcflags=-m` and find the `moved to heap: v` line. Under `go 1.21`, replace the capture with `v := v` and confirm the *same* escape message — proving the cost is identical.

**Goal.** See that 1.22 automated the `v := v` allocation, not added a new one.

---

## Hard

### Task 11 — Three-clause loop with body mutation

Write `for i := 0; i < 6; i++ { if i == 2 { i++ }; capture(i) }` where `capture` stores `i` in a slice via a closure. Predict and verify the captured values under `go 1.22`. Confirm the body's `i++` still skips an iteration (control flow preserved) while each capture is per-iteration.

**Goal.** Understand the sync-back: body mutations affect progression, captures are per-iteration.

---

### Task 12 — Mixed-module behavior

Create two modules in a workspace (or as a main module + a local `replace`d dependency): one with `go 1.22`, one with `go 1.21`. Put an identical capturing loop in each, exposed via a function. Call both from the 1.22 main. Confirm the 1.21 module's loop still exhibits the old behavior even though the binary was built with a 1.22 toolchain.

**Goal.** Prove per-module gating in a single build.

---

### Task 13 — Migration with isolated commits

Take a small repo on `go 1.21` with a couple of capturing loops (some buggy, one with `v := v`). Perform a disciplined migration: (1) bump the directive in one commit, run tests; (2) in a *separate* commit, remove the now-redundant `v := v`. Verify tests pass at each step and that `git bisect` could isolate the behavior change.

**Goal.** Practice the senior migration discipline of isolating the bump from cleanup.

---

### Task 14 — Range-over-func capture

Write an iterator `func Count(n int) func(yield func(int) bool)` and consume it with `for v := range Count(3)`. Inside the loop, capture `v` in a goroutine. Confirm under `go 1.23` that each goroutine sees its own value, demonstrating per-iteration semantics compose with range-over-func.

**Goal.** Confirm the per-iteration rule extends to iterators.

---

### Task 15 — Directive-aware vet

Put a `go func(){ println(i) }()` capture inside a loop. Run `go vet ./...` with the module at `go 1.21` (expect a `loopclosure` warning) and at `go 1.22` (expect no warning). Explain the difference.

**Goal.** See that `go vet` is language-version-aware.

---

## Bonus / Stretch

### Task 16 — Build a migration audit script

Write a shell/Go tool that, given a directory of Go modules, for each one runs `go build -gcflags=all=-d=loopvar=2` and reports the count of affected loops per module. Use it to rank modules by migration risk.

**Goal.** Operational tooling for a fleet migration.

---

### Task 17 — `defer`-in-loop interaction

Write a loop over open files that does `defer f.Close()`. Under `go 1.22`, confirm each `f` is correct (the right file closes), but also demonstrate that all `Close` calls still happen at *function* return, not iteration end (e.g. by printing inside the deferred closure). Separate the two concerns.

**Goal.** Distinguish the loopvar fix from the unchanged `defer` timing.

---

### Task 18 — `GOEXPERIMENT=loopvar` archaeology

If you have a Go 1.21 toolchain available, build a 1.21-directive module twice: once normally (old behavior) and once with `GOEXPERIMENT=loopvar` (new behavior forced regardless of directive). Observe the output flip. Explain how this preview let the community validate the change before 1.22.

**Goal.** Understand the historical preview mechanism.

---

### Task 19 — Version-independent code

Rewrite a capturing loop in the bulletproof, version-independent style (`go func(x){...}(v)`). Confirm it prints the correct per-iteration values under *both* `go 1.21` and `go 1.22`. Discuss when this style is worth keeping (shared libs targeting old consumers).

**Goal.** Master the pattern that's correct under any directive.

---

### Task 20 — Find a real masked bug

In any existing pre-1.22 codebase you have access to, search for loops that capture the loop variable in `go`/`defer`/closures (or run `-d=loopvar=2`). For each, reason about whether bumping to 1.22 would *fix* a latent bug or *change* intended behavior. Write a one-paragraph recommendation per loop.

**Goal.** Apply the judgment a real migration requires.

---

## Solutions (sketched)

### Solution 1
```go
var wg sync.WaitGroup
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); fmt.Println(i) }()
}
wg.Wait()
```
`go 1.22` → `0 1 2`; `go 1.21` → `3 3 3`. Only `go.mod` changed.

### Solution 2
`&v` is the per-iteration variable's address in 1.22 (`10 20 30`) and the shared variable's address pre-1.22 (`30 30 30`).

### Solution 3
`&nums[i]` always yields `10 20 30` — it addresses the slice element, independent of loop semantics.

### Solution 4
Closures capture by reference. Pre-1.22 all reference one `name` (ends "c"); 1.22 each references its own (`a b c`).

### Solution 5
`i := i` shadows into a body-scoped variable — the old manual fix. Redundant in 1.22 because the compiler does it implicitly.

### Solution 6
`for i := range 10` is a 1.22 feature, so the file already requires 1.22; its `i` is per-iteration, capture is safe.

### Solution 7
Without `tc := tc`, pre-1.22 `t.Parallel()` defers all subtests until the loop ends, so all see the last `tc`. 1.22 gives each subtest its own `tc`.

### Solution 8
`-d=loopvar=2` prints only loops whose captured-variable behavior changes. Non-capturing loops are absent from the output.

### Solution 9
No `moved to heap: i`; identical assembly under both directives. Non-capturing loops are zero-cost.

### Solution 10
`moved to heap: v` appears whenever `v` is captured by an escaping closure — identical with explicit `v := v` and with the implicit 1.22 variable.

### Solution 11
`i++` in the body syncs back to control, so iteration `i==2` advances to 3 (skipping). Each capture is the per-iteration `i`: captured values are `0,1,3,4,5`.

### Solution 12
The 1.21 module's loop uses shared-variable semantics (old output) because it's compiled with `-lang=go1.21`, regardless of the 1.22 toolchain. The 1.22 module's identical loop is per-iteration.

### Solution 13
Commit 1: `go 1.21` → `go 1.22`, tests pass (a buggy test may start passing correctly). Commit 2: delete `v := v`, tests still pass. Bisect can isolate commit 1 as the behavior change.

### Solution 14
```go
func Count(n int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ { if !yield(i) { return } }
    }
}
```
`for v := range Count(3) { go func(){ fmt.Println(v) }() }` → each goroutine its own `v` under 1.23.

### Solution 15
`loopclosure` is version-aware: it warns under `go 1.21` (real bug) and is silent under `go 1.22` (now correct).

### Solution 16
```bash
for m in mods/*; do
  n=$( (cd "$m" && go build -gcflags=all=-d=loopvar=2 ./... 2>&1) | grep -c loopvar )
  echo "$n  $m"
done | sort -rn
```

### Solution 17
1.22 closes the correct file each iteration (per-iteration `f`), but all `Close` calls run at function return. The two behaviors are independent: loopvar fixes *which* variable; `defer` timing is unchanged.

### Solution 18
On 1.21, normal build = old behavior; `GOEXPERIMENT=loopvar` build = new behavior forced. The preview let teams test the change before it became the gated default in 1.22.

### Solution 19
```go
for _, v := range items {
    go func(x Item) { use(x) }(v)
}
```
Correct under every directive — the value is copied at call time.

### Solution 20
For each captured loop variable: if downstream code expected per-item values, the bump *fixes* a latent bug (recommend bump + test). If code relied on the final value, hoist an explicit outer variable before bumping.

---

## Checkpoints

After completing the easy tasks: you can reproduce the bug and its fix, flip behavior via the `go` directive, and distinguish `&v` from `&slice[i]`.
After completing the medium tasks: you can use `-d=loopvar=2` and `-gcflags=-m`, see the parallel-test failure, and verify the performance contract.
After completing the hard tasks: you understand the three-clause sync-back, mixed-module gating, the migration discipline, and range-over-func composition.
After completing the bonus tasks: you can audit a fleet for affected loops, separate the `defer` concern, use the historical preview, write version-independent code, and make per-loop migration judgments.
