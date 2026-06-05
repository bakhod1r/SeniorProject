# SSA Backend — Find the Bug

Fourteen scenarios where the optimizer did *not* do what the author expected —
usually "why is there still a bounds check / nil check / why didn't this fold?"
Each is **code → symptom → cause → fix**. The symptom is what you'd see in
`ssa.html`, the `check_bce/debug=1` output, or `-S` assembly. The recurring lesson:
the compiler eliminates a check only when it can *prove* the condition; vague or
indirect code denies it the facts.

Standing diagnostic commands:

```shell
go build -gcflags='-d=ssa/check_bce/debug=1' .   # surviving bounds checks
go build -gcflags='-m -m' .                       # inlining / escape
GOSSAFUNC=Fn go build . && open ssa.html          # per-pass dump
go build -gcflags=-S . 2>asm.s                     # final assembly
```

---

## 1. The `<=` off-by-one loop

```go
func sum(s []int) (t int) {
    for i := 0; i <= len(s); i++ {   // BUG: <= not <
        t += s[i]
    }
    return
}
```

**Symptom:** `check_bce` reports `Found IsInBounds` on the `s[i]` line; also a real
out-of-range panic at runtime.
**Cause:** with `<=`, `i` can equal `len(s)`, so `i < len(s)` is *not* provable —
because it's false. The prover correctly refuses to drop the check.
**Fix:** use `i < len(s)`, or `for i := range s`. The check then folds away.

---

## 2. Indexing with an unrelated variable

```go
func copyAt(dst, src []byte, j int) {
    for i := range src {
        dst[j] = src[i]   // check on dst[j] stays
    }
}
```

**Symptom:** `src[i]` has no check (proven by `range`), but `dst[j]` keeps one.
**Cause:** `j` has no proven relation to `len(dst)`; the prover has no fact tying
them together.
**Fix:** establish the bound once before the loop: `_ = dst[j]` hoisted out, or
`dst = dst[:j+1]`, or restructure so the index derives from `range`.

---

## 3. The "BCE hint" written in the wrong order

```go
func first4(s []int) (a, b, c, d int) {
    a = s[0]
    b = s[1]
    c = s[2]
    d = s[3]
    if len(s) < 4 { return }   // BUG: check after the accesses
    return
}
```

**Symptom:** all four indices keep bounds checks.
**Cause:** the prover walks forward; a length fact established *after* the accesses
can't retroactively cover them.
**Fix:** put the guard first: `if len(s) < 4 { return }` (or `_ = s[3]`) *before*
the indexing. One check then dominates and covers `s[0..3]`.

---

## 4. Re-slicing inside the loop kills the proof

```go
func walk(s []int) {
    for i := range s {
        s = s[:len(s)]   // BUG: reassigns s each iteration
        use(s[i])
    }
}
```

**Symptom:** `s[i]` keeps a check even though `i` came from `range`.
**Cause:** the `range` fact is about the *original* `s`; reassigning `s` to a new
SSA value breaks the link between `i` and the current `s`'s length.
**Fix:** don't reassign the slice you're ranging. Range over a stable slice; if you
must reslice, range over the resliced value directly.

---

## 5. Bound stored through a struct field

```go
type buf struct{ b []byte }
func (x *buf) at(i int) byte {
    if i < len(x.b) {     // checked against x.b...
        return x.b[i]     // ...but check may remain
    }
    return 0
}
```

**Symptom:** the index still shows `IsInBounds`.
**Cause:** between the `len(x.b)` guard and the load, `x.b` is two pointer
loads (`x` then `.b`); the prover can't always guarantee the second load reads the
same slice header (aliasing/escape uncertainty).
**Fix:** snapshot into a local: `b := x.b; if i < len(b) { return b[i] }`. Now the
guard and the index reference one SSA slice value.

---

## 6. The mask the prover can't bound

```go
func hash(tab []int, k uint) int {
    return tab[k & 0xff]   // expect: in bounds if len(tab) >= 256
}
```

**Symptom:** check kept unless `len(tab)` is provably ≥ 256.
**Cause:** `k & 0xff` is provably in `[0,255]`, but the prover needs the *length*
side too. With an arbitrary `tab`, `len(tab)` is unknown, so it can't fold.
**Fix:** assert the size once: `tab = tab[:256]` (or `_ = tab[255]`). The
`(IsInBounds (And ...) (Const64 [c])) && ... < d` rule then folds it to `true`.

---

## 7. "Missed CSE" across a call

```go
func g(a, b int) int {
    x := expensive(a, b)
    log()                 // a call
    y := expensive(a, b)  // expect CSE — but recomputed
    return x + y
}
```

**Symptom:** `expensive` is called twice in `-S`.
**Cause:** `expensive` isn't pure to the compiler (it may read globals/memory), and
`log()` may modify memory; CSE won't merge values across a memory-changing call.
**Fix:** if it's truly pure, compute once into a local and reuse — the compiler
won't do it for you when memory effects are unknown.

---

## 8. Constant that won't fold (it's not constant)

```go
func area(r int) int {
    pi := 3            // looks constant
    return pi * r * r  // pi*... not folded into a shift/const
}
```

**Symptom:** an `IMUL` by 3 in the asm, author expected a strength-reduced form.
**Cause:** `pi` *is* folded to the literal 3, and `3*r*r` can't be a single
constant because `r` is a variable. There's nothing more to fold; the expectation
was wrong.
**Fix:** none needed — the multiply by a variable is correct. (Misreading "constant
folding" as "loop-invariant magic.")

---

## 9. `float64` reassociation that never happens

```go
func sum3(a, b, c float64) float64 {
    return a + b + c   // expected (a+b)+c reordered for a const-fold
}
```

**Symptom:** no folding even when `b` and `c` are constants.
**Cause:** the compiler will not reassociate floating-point math — it would change
the rounded result and violate IEEE semantics.
**Fix:** group the constants explicitly in source if you want them folded:
`a + (b + c)` with `b,c` constant lets `(b+c)` fold; otherwise accept the order.

---

## 10. Nil check that won't die (interface round-trip)

```go
func f(p *T) int {
    var i interface{} = p
    _ = i
    return p.x + p.y   // expected one NilCheck; sometimes two
}
```

**Symptom:** the `nilcheckelim` column still shows a `NilCheck` for the second use.
**Cause:** boxing `p` into an interface and back can obscure that the same pointer
is reused on the path, defeating dominance-based elimination.
**Fix:** don't round-trip the pointer; use `p` directly between the two field
accesses so one `NilCheck` dominates both.

---

## 11. Pointer reload because of a possible alias

```go
func add(p, q *int) {
    *p = *p + 1
    *q = *q + 1
    *p = *p + 1   // *p reloaded — author expected the value cached
}
```

**Symptom:** an extra `MOVQ (p)` load after the `*q` store.
**Cause:** `p` and `q` might alias; the store through `q` may change `*p`, so the
compiler must reload `*p`.
**Fix:** if they cannot alias by contract, work through locals:
`a := *p; ... ; *p = a + ...` — but only if aliasing is truly impossible.

---

## 12. GOSSAFUNC shows the check — but you misread the column

```go
func sum(s []int) (t int) {
    for i := range s { t += s[i] }
    return
}
```

**Symptom:** "I see `IsInBounds` in `ssa.html`, so BCE failed!"
**Cause:** you read the **`opt`** (early) column, where the check still exists. BCE
happens in **`prove`**; the value is gone in the `prove` column and after.
**Fix:** read the right column. Confirm with `check_bce/debug=1` printing nothing
for that line.

---

## 13. GOSSAFUNC matched nothing (wrong symbol)

```shell
GOSSAFUNC=Method go build .   # type T has method Method
```

**Symptom:** `ssa.html` not produced, or shows an unrelated function.
**Cause:** methods have qualified linker symbols; `Method` alone doesn't match
`(*T).Method`.
**Fix:** `GOSSAFUNC='(*T).Method' go build .` (quote it for the shell). For
generics, the symbol includes the shape instantiation.

---

## 14. "Disabling prove proved nothing"

```shell
go build -gcflags='-d=ssa/prove/off=1' .   # to "measure" prove's value
```

**Symptom:** other unrelated optimizations also change; benchmark swings wildly.
**Cause:** passes feed each other. Turning off `prove` leaves bounds checks in,
which changes the input to later passes (scheduling, regalloc), so the delta isn't
attributable to prove alone.
**Fix:** use `off=1` only for *diagnosis of presence*, never to attribute
performance. To measure prove's value, compare the *asm* with and without and read
which checks reappear — don't trust a single benchmark number.

---

## Summary

- Most "BCE failed" bugs are **off-by-one** (`<=`), **unrelated indices**, or a
  **bound established too late / through an alias**. Hoist the proof and snapshot
  slices/pointers into locals.
- Masks (`k & 0xff`) prove the *index* side; you must also pin the *length* side
  (`s = s[:256]`).
- CSE and load-reuse stop at **calls** and **possible aliasing** — by design.
- Constant folding and FP **reassociation** have hard limits; some "misses" are the
  compiler being correct.
- Nil-check elimination is **dominance-based**; interface round-trips and
  reassignment defeat it.
- Tooling mistakes are real bugs too: read the **`prove`** column, quote method
  symbols for `GOSSAFUNC`, and never attribute perf to a single `off=1` run.
