# Method Dispatch — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Two Kinds of Dispatch](#two-kinds-of-dispatch)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Static Dispatch in Practice](#static-dispatch-in-practice)
8. [Dynamic Dispatch in Practice](#dynamic-dispatch-in-practice)
9. [Why It Matters](#why-it-matters)
10. [First Benchmark](#first-benchmark)
11. [Reading the Output](#reading-the-output)
12. [Common Mistakes](#common-mistakes)
13. [Common Misconceptions](#common-misconceptions)
14. [Tricky Points](#tricky-points)
15. [Cheat Sheet](#cheat-sheet)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)

---

## Introduction
> Focus: "What happens at runtime when I call `x.Method()`?"

When you write `user.Name()` in Go, you might think the compiler always knows which function to jump to. That is true *most of the time* — but only when the compiler can prove the concrete type of `user`. As soon as the call goes through an interface variable, Go has to consult a small per-interface table at run time to find the right function pointer. That table lookup is called **dynamic dispatch**, and it costs roughly 1-3 nanoseconds plus a branch-prediction hit.

```go
// Case 1 — static dispatch (compiler picks the function)
var u User
u.Name()           // direct call to User.Name

// Case 2 — dynamic dispatch (runtime picks the function)
var n Named = u    // Named is an interface
n.Name()           // looked up via itab.fun[0]
```

This file teaches you the difference between these two cases, why the difference matters in tight loops, and how to use `go build -gcflags='-m'` to confirm what the compiler did.

After reading you will:
- Distinguish a direct call from an interface call
- Understand why `itab` exists and when Go uses it
- Run your first benchmark comparing the two
- Read basic `-gcflags='-m'` output

---

## Prerequisites
- Junior knowledge of methods and interfaces (sections 01 and 04)
- Ability to run `go test -bench=.`
- Basic familiarity with `go build` and command-line flags
- Comfort with `func (r T) M()` syntax

---

## Glossary

| Term | Definition |
|--------|--------|
| **Dispatch** | The process of choosing which function to execute for a call site |
| **Static dispatch** | The compiler hard-codes the call target at compile time |
| **Dynamic dispatch** | The call target is resolved at runtime, usually via a table lookup |
| **Direct call** | Machine instruction that jumps to a fixed address (`CALL fn`) |
| **Indirect call** | Machine instruction that jumps to an address held in a register (`CALL [rax]`) |
| **itab** | "Interface table" — Go's per-(interface, concrete) record holding type info and method pointers |
| **itab.fun[]** | The slot array inside an `itab` that holds method function pointers |
| **Devirtualization** | Compiler optimization that turns a dynamic dispatch into a static one |
| **Inlining** | Replacing a call site with the body of the called function |
| **PGO** | Profile-Guided Optimization — Go 1.21+ uses CPU profiles to guide devirtualization |

---

## Two Kinds of Dispatch

### Static dispatch — the easy case

```go
type Greeter struct{ name string }
func (g Greeter) Hello() string { return "hi " + g.name }

func main() {
    g := Greeter{name: "Ada"}
    println(g.Hello()) // STATIC: compiler knows it's Greeter.Hello
}
```

The compiler sees that `g` has the concrete type `Greeter`. It emits a direct `CALL Greeter.Hello` machine instruction — the CPU jumps to a fixed address. No table lookup. The function may even be **inlined**, which means there is no call instruction at all.

### Dynamic dispatch — through an interface

```go
type Speaker interface{ Hello() string }

func main() {
    var s Speaker = Greeter{name: "Ada"}
    println(s.Hello()) // DYNAMIC: must consult s's itab at runtime
}
```

Now `s` is an interface variable. At the machine-code level, an interface in Go is a two-word value:

```
s = (itab pointer, data pointer)
```

The `itab` holds (among other things) a small array `fun[]` of function pointers, one per interface method. To call `s.Hello()`, the runtime:

1. Loads `s.itab` from memory.
2. Loads `itab.fun[0]` (the Hello slot).
3. Issues an *indirect* `CALL` to that pointer.

That's about three extra memory reads before the jump, and the indirect `CALL` confuses the CPU's branch predictor when the target varies between iterations.

---

## Real-World Analogies

**Phone book vs speed dial.** Static dispatch is speed dial — you press "1" and it rings your contact. Dynamic dispatch is opening a phone book, finding the right name, and reading off the number before dialing. Both work, but speed dial is faster.

**Restaurant order.** Static dispatch is when you walk up to the chef who already knows your favorite dish. Dynamic dispatch is when the waiter takes your generic order, walks back to a kitchen with several stations, and routes it to whichever chef can prepare it.

**GPS shortcut.** Static dispatch is following a memorized route. Dynamic dispatch is checking the navigation app at every intersection.

---

## Mental Models

### Model 1 — Concrete type = direct call

```
   x : Greeter         (concrete)        → CALL Greeter.Hello
   y : Speaker         (interface)       → CALL [y.itab.fun[0]]
```

If you can see the concrete type at the call site, dispatch is static. If you only see an interface, dispatch is dynamic.

### Model 2 — itab is a pre-built dispatch table

```
type itab struct {
    inter *interfacetype
    _type *_type
    hash  uint32
    _     [4]byte
    fun   [N]uintptr // function pointers, one per method
}
```

For *every* (interface, concrete type) pair the program touches, the runtime builds one `itab` lazily on first use and caches it. Subsequent calls reuse the same table.

### Model 3 — The compiler is your ally

The compiler tries hard to *prove* the concrete type behind an interface variable. When it succeeds, it rewrites the dynamic call into a static one. This rewrite is called **devirtualization**, covered later in the senior file.

---

## Static Dispatch in Practice

```go
package main

type Calc struct{ base int }
func (c Calc) Add(x int) int { return c.base + x }

func main() {
    c := Calc{base: 10}
    sum := 0
    for i := 0; i < 1000; i++ {
        sum += c.Add(i)
    }
    println(sum)
}
```

Build it with diagnostics:

```bash
go build -gcflags='-m' main.go
# main.go:4:6: can inline Calc.Add
# main.go:9:14: inlining call to Calc.Add
```

The compiler not only used static dispatch — it inlined the entire body of `Add` into the loop, so there is *no call at all*. This is the cheapest possible form.

---

## Dynamic Dispatch in Practice

```go
package main

type Adder interface{ Add(int) int }

type Calc struct{ base int }
func (c Calc) Add(x int) int { return c.base + x }

func sumWith(a Adder, n int) int {
    sum := 0
    for i := 0; i < n; i++ {
        sum += a.Add(i)
    }
    return sum
}

func main() {
    println(sumWith(Calc{base: 10}, 1000))
}
```

Inside `sumWith`, `a` is an interface — the compiler does not statically know its concrete type. It must emit an indirect call through `a`'s itab on every iteration. With `-gcflags='-m'`:

```bash
# main.go:8:6: cannot inline sumWith: function too complex for inlining
# main.go:11:13: devirtualizing a.Add to Calc (PGO)
```

The second line only appears with PGO enabled (Go 1.21+). Without PGO you stay on the dynamic path.

---

## Why It Matters

A single dynamic dispatch costs ~1-3 nanoseconds on modern x86-64 hardware. That sounds tiny, but consider:

- A web handler doing 10 interface calls per request → ~30 ns. Negligible.
- A JSON encoder calling `Marshaler.MarshalJSON` 100 000 times in a batch → ~300 µs. Visible.
- A serializer in a tight loop hit a billion times during bulk migration → ~3 seconds. Real money.

Beyond raw nanoseconds, the indirect call:
- **Prevents inlining** — the compiler cannot inline through an unknown target.
- **Pollutes the branch predictor** — the CPU guesses the call target; a wrong guess is a pipeline flush (~10-20 ns).
- **Hurts icache** — different concrete types on the same call site mean the CPU bounces between code regions.

---

## First Benchmark

Save this as `dispatch_test.go`:

```go
package dispatch

import "testing"

type Adder interface{ Add(int) int }

type Calc struct{ base int }

func (c Calc) Add(x int) int { return c.base + x }

func BenchmarkStatic(b *testing.B) {
    c := Calc{base: 1}
    sum := 0
    for i := 0; i < b.N; i++ {
        sum += c.Add(i)
    }
    _ = sum
}

func BenchmarkDynamic(b *testing.B) {
    var a Adder = Calc{base: 1}
    sum := 0
    for i := 0; i < b.N; i++ {
        sum += a.Add(i)
    }
    _ = sum
}
```

Run it:

```bash
go test -bench=. -benchmem
# BenchmarkStatic-8     1000000000   0.30 ns/op
# BenchmarkDynamic-8     500000000   2.10 ns/op
```

The static benchmark is dominated by inlining (the loop becomes near-trivial arithmetic). The dynamic benchmark cannot be inlined, so the indirect call dominates.

---

## Reading the Output

`go build -gcflags='-m'` is your single most important tool for dispatch reasoning. Here's a small cheat for the messages you will see:

| Message | Meaning |
|---|---|
| `can inline X` | Method body fits the inline budget |
| `inlining call to X` | Call site was actually inlined |
| `cannot inline X: function too complex` | Body exceeds the budget (~80 nodes since Go 1.22) |
| `cannot inline X: call to ... cannot inline` | A nested call blocks inlining |
| `devirtualizing a.M to T` | PGO turned a dynamic call into a static one |
| `... escapes to heap` | Receiver or argument allocated on heap |

Use `-gcflags='-m=2'` for even more verbose output.

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|------|------|------|
| Wrapping every concrete type in an interface "for cleanliness" | Forces dynamic dispatch even when not needed | Accept concrete type when only one impl exists |
| Asserting through an interface inside a hot loop | Re-runs itab lookup each iteration | Hoist the type assertion outside the loop |
| Storing interface values in `[]interface{}` for math | Each element call is dynamic + each scalar boxes | Use a typed slice (`[]float64`) and a free function |
| Believing "the compiler will inline this" without checking | Often it cannot | Run `-gcflags='-m'` |
| Optimizing dispatch in non-hot code | Wasted effort | Profile first |

---

## Common Misconceptions

**"Methods are always slower than functions."** False. A method on a concrete value compiles to the same code as a free function with that value as its first argument.

**"Interfaces are always slow."** False. A single interface call costs ~1-3 ns. Outside a hot loop, this is invisible.

**"The compiler always devirtualizes."** False. Without PGO, devirtualization happens only when the concrete type is provable from local flow analysis. With many call sites it gives up.

**"Inlining and dispatch are the same thing."** False. A method can be statically dispatched but not inlined (large body). It cannot, however, be inlined without static dispatch.

---

## Tricky Points

### 1. A method value forces an indirect call

```go
fn := c.Add   // method value — closure
fn(3)         // indirect call through the closure
```

`fn` is a small heap object holding the receiver and a function pointer. The call is *not* through an itab, but it is still indirect.

### 2. `interface{}` as a parameter

```go
func dump(v interface{}) { ... }
```

Every call boxes the argument into an `eface` (no method table, just a `_type` pointer and data pointer). If you then type-assert and call methods, that's another dispatch step.

### 3. Interface values cached in fields

```go
type Server struct{ log Logger } // Logger is an interface
```

The itab in `s.log` is fixed once you assign a concrete type to it. The first call after assignment performs a lookup; subsequent calls reuse the cached itab. The CPU's branch predictor learns the target quickly *if it stays the same*.

---

## Cheat Sheet

```
DISPATCH KIND
─────────────────────────────
Concrete value  → static  (CALL fn)
Pointer to T    → static  (CALL fn)
Interface       → dynamic (CALL [itab.fun[i]])
Method value    → indirect (CALL [closure.fn])

COST (modern x86-64)
─────────────────────────────
Static + inlined         ~0 ns
Static call              ~0.5-1 ns
Dynamic via itab         ~1-3 ns + predictor cost
Reflection-based call    ~100-500 ns

DIAGNOSTIC FLAGS
─────────────────────────────
-gcflags='-m'        inline + escape decisions
-gcflags='-m=2'      verbose
-gcflags='-S'        assembly listing
-gcflags='-d=ssa/...' SSA passes

KEY RULE
─────────────────────────────
If you can use a concrete type, you skip the itab.
```

---

## Self-Assessment Checklist

- [ ] I can explain the difference between static and dynamic dispatch
- [ ] I know what `itab` is and where `fun[]` lives
- [ ] I can write a benchmark comparing the two
- [ ] I can read basic `-gcflags='-m'` output
- [ ] I know that PGO can devirtualize hot calls
- [ ] I understand why an interface call prevents inlining
- [ ] I can identify when dispatch matters and when it does not

---

## Summary

Method dispatch in Go is either **static** (the compiler hard-codes the call target) or **dynamic** (the runtime resolves the target through `itab.fun[]`). Static dispatch is free; dynamic dispatch costs about 1-3 nanoseconds plus branch-predictor effects, and it blocks inlining.

The compiler tries to convert dynamic calls to static ones via **devirtualization**, especially with PGO enabled in Go 1.21+. Your job as a programmer is twofold: (1) avoid wrapping things in interfaces when you don't need polymorphism, and (2) measure, don't guess — use `go test -bench` and `go build -gcflags='-m'` to confirm what the compiler actually did.

Next up: the middle-level file dives into reading the actual `itab.fun[]` slot at runtime and tightening benchmark methodology.
