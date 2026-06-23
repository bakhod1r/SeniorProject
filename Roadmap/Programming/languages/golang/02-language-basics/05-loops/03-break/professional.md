# break Statement — Professional Level (Internals, Compiler, Assembly)

## 1. AST Representation of break

The Go parser produces a `*ast.BranchStmt` node for `break`:

```go
// go/ast package
type BranchStmt struct {
    TokPos token.Pos   // position of Tok
    Tok    token.Token // keyword token (BREAK, CONTINUE, GOTO, FALLTHROUGH)
    Label  *Ident      // label name; or nil
}

// For: break
// Tok = token.BREAK, Label = nil

// For: break OuterLoop
// Tok = token.BREAK, Label = &ast.Ident{Name: "OuterLoop"}
```

During type checking, the compiler resolves the label (if any) to the enclosing labeled statement. Unresolved labels are a compile error.

---

## 2. SSA Representation

After the frontend, `break` becomes an unconditional `Jump` in SSA form:

```go
// Source:
for i := 0; i < 10; i++ {
    if i == 5 { break }
    use(i)
}
after()

// SSA (simplified):
b0: (entry)
    v1 = 0              ; i = 0
    Jump b1

b1: (loop header)
    v2 = phi v1 v5      ; i at start of each iteration
    v3 = Less v2 10     ; i < 10
    If v3 → b2 else b4  ; if false: exit

b2: (body)
    v4 = Eq v2 5        ; i == 5
    If v4 → b4 else b3  ; if true: break (jump to b4)

b3: (continue body)
    call use(v2)
    v5 = Add v2 1       ; i++
    Jump b1

b4: (after loop) ← both break and loop exhaustion jump here
    call after()
```

---

## 3. Generated Assembly: break in for loop

```go
package main

func findFive(s []int) int {
    for i, v := range s {
        if v == 5 { return i }
    }
    return -1
}
```

```bash
go tool compile -S -N -l main.go
```

Approximate x86-64 output:
```asm
TEXT main.findFive(SB)
    MOVQ "".s+8(SP), AX    ; AX = len(s)
    MOVQ "".s+0(SP), CX    ; CX = data ptr
    XORL DX, DX            ; i = 0
loop:
    CMPQ DX, AX            ; i < len?
    JGE  notfound          ; if >=: exit loop (natural end)
    MOVQ 0(CX)(DX*8), BX   ; BX = s[i]
    CMPQ BX, $5            ; BX == 5?
    JEQ  found             ; if yes: break (return i)
    INCQ DX                ; i++
    JMP  loop
found:
    MOVQ DX, "".~r0+24(SP) ; return i
    RET
notfound:
    MOVQ $-1, "".~r0+24(SP)
    RET
```

Both `found` and `notfound` are equivalent to `break` — they jump out of the loop. The compiler generates the same `JMP` instruction for both.

---

## 4. Labeled break in Assembly

```go
func findIn2D(m [][]int, target int) (int, int, bool) {
Outer:
    for i, row := range m {
        for j, v := range row {
            if v == target {
                return i, j, true // labeled break equivalent
            }
        }
    }
    return -1, -1, false
}
```

The labeled break (expressed here as `return`) compiles to a `JMP` that skips both the inner and outer loop headers, jumping directly to the post-outer-loop code. The label itself has zero runtime cost — it is purely a compile-time directive.

---

## 5. Dead Code After break

The compiler detects and eliminates dead code after `break`:

```go
for _, v := range s {
    break
    use(v) // dead code — never emitted in output
}
```

With optimizations enabled (`-N` disabled):
```asm
; The entire loop body after break is absent from assembly
; The loop itself may be optimized away if the compiler proves
; no side effects occur before break
```

---

## 6. break and Jump Tables in switch

```go
func classify(n int) string {
    switch n {
    case 1: return "one"
    case 2: return "two"
    case 3: return "three"
    default: return "other"
    }
}
```

For small switch statements, the compiler may generate a jump table (array of addresses indexed by value). `break` at end of each case is implicit — the compiler emits a `JMP` to post-switch after each case. With jump tables:

```asm
; Jump table approach (for n = 1..3):
MOVQ n, AX
SUBQ $1, AX         ; normalize to 0-based
CMPQ AX, $3         ; in range?
JA   default_label  ; if not: go to default
JMP  *(table)(AX*8) ; indexed jump

; table: [ptr_case1, ptr_case2, ptr_case3]
case1:
    ; return "one"
    JMP post_switch  ; implicit break
case2:
    ; return "two"
    JMP post_switch
; ...
```

---

## 7. break and the Linker

Break-generated `JMP` instructions use relative addressing (`JMP +offset`). The linker resolves these:

1. Compiler emits `JMP .L_break_target` (relocation)
2. Linker resolves address of `.L_break_target` relative to current instruction
3. Final binary has `JMP 0x12` (relative offset)

For short jumps (<128 bytes), x86 uses a 2-byte encoding. For longer jumps, 5-byte encoding. The compiler's code layout tries to minimize jump distances.

---

## 8. Escape Analysis and break

Break does not directly affect escape analysis. However, variables declared before a loop with `break` may escape if they are referenced after the loop:

```go
func process() *int {
    var result *int
    for _, v := range items {
        if predicate(v) {
            x := v
            result = &x // x escapes to heap here
            break
        }
    }
    return result // result refers to heap-allocated x
}
```

```bash
go build -gcflags="-m" main.go
# Shows: &x escapes to heap
```

---

## 9. break in Defer Interaction

`break` does NOT trigger defers. Defers run only when the function returns or panics:

```go
func example() {
    defer fmt.Println("function exiting") // runs only when function returns

    for i := 0; i < 10; i++ {
        defer fmt.Println("deferred:", i) // all deferred at function exit
        if i == 3 {
            break // does NOT trigger any defers
        }
    }
    fmt.Println("after loop") // runs after break
}
// Output order:
// after loop
// deferred: 3
// deferred: 2
// deferred: 1
// deferred: 0
// function exiting
```

---

## 10. break Optimization: Loop Unswitching

When the break condition is a compile-time constant or can be hoisted:

```go
// Original:
for _, v := range s {
    if debugMode {  // constant at compile time
        break
    }
    process(v)
}

// Compiler may generate:
if !debugMode {
    for _, v := range s {
        process(v)
    }
}
// The break condition is hoisted, avoiding per-iteration check
```

---

## 11. GOSSAFUNC Analysis of break

```bash
GOSSAFUNC=findFive go build main.go
# Opens ssa.html in browser
```

At the "lower" phase, `break` is represented as an unconditional `Jump` to the post-loop block. At "regalloc", jump targets are finalized. At "genssa", machine code is emitted.

Key SSA phases where `break` appears:
- **start:** `BranchStmt{Tok:BREAK}` node
- **walk:** converted to `goto` internal representation
- **SSA construction:** `Jump` to break-target block
- **opt:** break-unreachable code removed (dead code elim)
- **lower:** `Jump` → machine `JMP` instruction
- **genssa:** relative address computed

---

## 12. break and Goroutine Stack Traces

When a goroutine is stuck (e.g., loop without break), its stack trace shows the loop:

```go
// A goroutine stuck in a loop without break:
go func() {
    for {
        doWork() // never breaks
    }
}()

// Stack trace (from SIGQUIT or runtime.Stack):
// goroutine 18 [running]:
// main.main.func1()
//     /path/to/main.go:5 +0x20  <- in the loop body
```

Use `-race` and pprof to identify loops that should `break` but don't.

---

## 13. break in Fuzz Testing

```go
//go:build gofuzz
package mypackage

import "testing"

func FuzzFindFirst(f *testing.F) {
    f.Add([]byte{1, 2, 3, 4, 5}, byte(3))
    f.Fuzz(func(t *testing.T, data []byte, target byte) {
        found := false
        for _, b := range data {
            if b == target {
                found = true
                break // early break must not cause panic
            }
        }
        // Verify: if target in data, found must be true
        for _, b := range data {
            if b == target && !found {
                t.Errorf("break caused false negative: target=%d data=%v", target, data)
            }
        }
    })
}
```

---

## 14. Measuring break Performance with Benchmarks

```go
package main

import "testing"

// Measure cost of early break at position 0, n/2, and n-1
func benchmarkBreakAt(b *testing.B, n, breakAt int) {
    data := make([]int, n)
    data[breakAt] = -1 // sentinel for break

    b.ResetTimer()
    for iter := 0; iter < b.N; iter++ {
        for i, v := range data {
            if v == -1 {
                _ = i
                break
            }
        }
    }
}

func BenchmarkBreakFirst(b *testing.B) { benchmarkBreakAt(b, 10000, 0) }
func BenchmarkBreakMid(b *testing.B)   { benchmarkBreakAt(b, 10000, 5000) }
func BenchmarkBreakLast(b *testing.B)  { benchmarkBreakAt(b, 10000, 9999) }
func BenchmarkNoBreak(b *testing.B)    { benchmarkBreakAt(b, 10000, -1) } // never breaks

// Typical results:
// BenchmarkBreakFirst: ~2 ns/op (1 iteration)
// BenchmarkBreakMid:   ~5 μs/op (5000 iterations)
// BenchmarkBreakLast:  ~10 μs/op (10000 iterations)
// BenchmarkNoBreak:    ~10 μs/op (same as BenchmarkBreakLast — no element found)
```

---

## 15. Professional Summary: break Cost Model

| Scenario | Runtime Cost | Notes |
|---|---|---|
| `break` instruction itself | ~1 ns (1 JMP) | Negligible |
| Branch prediction (taken) | +0-5 ns | CPU learns pattern |
| Branch misprediction | +15-20 CPU cycles | ~5-7 ns at 3GHz |
| Labeled `break` vs plain | 0 difference | Same JMP instruction |
| `break` in `switch` | Same as plain | Auto-break after each case |
| `break` with dead code after | 0 (dead code eliminated) | Compiler removes unreachable code |
| Goroutine break (context) | ~100-500 ns | context.Done channel receive |
| `break` in iterator (yield=false) | Function call overhead | ~5-10 ns per yield |
