# SSA Backend — Optimize

A codegen-aware optimization playbook for hot Go code: write loops the
bounds-check eliminator can prove, avoid checks and barriers, feed the
inliner+SSA, read the resulting assembly, and benchmark honestly. The discipline is
constant: **change one thing, read the SSA/asm, re-measure with `benchstat`.**

## 1. First, confirm there's a problem

Don't optimize blind. Profile, then attribute.

```shell
go test -bench=BenchmarkHot -benchmem -cpuprofile=cpu.out ./pkg
go tool pprof -top cpu.out          # where is time actually spent?
go build -gcflags='-m -m' ./pkg     # is the hot func inlined? does it escape?
```

If the hot function didn't inline, *that* is usually the first fix — un-inlined
calls block folding, escape locals, and add call overhead.

## 2. Write BCE-friendly loops

The prover (`ssa/prove.go`) eliminates a bounds check only when it can prove
`0 <= i < len(s)`. Give it that proof.

```go
// GOOD: range gives the prover i in [0, len(s)) for free
for i := range s { sink += s[i] }

// GOOD: value range — no index, no check at all
for _, v := range s { sink += v }

// GOOD: hoist the bound once; all four checks vanish
func first4(s []int) int {
    _ = s[3]                  // or: if len(s) < 4 { ... }
    return s[0] + s[1] + s[2] + s[3]
}

// GOOD: pin the length so a masked index is provable
func bucket(tab []int, h uint) int {
    tab = tab[:256]           // now h&0xff is provably < len(tab)
    return tab[h&0xff]
}
```

Anti-patterns that keep the check:

```go
for i := 0; i <= len(s); i++ { _ = s[i] }   // <= : not provable (and wrong)
_ = dst[j]                                   // j unrelated to dst
_ = s[idx[k]]                                // indirect index: opaque
```

Verify, don't hope:

```shell
go build -gcflags='-d=ssa/check_bce/debug=1' ./pkg   # silence on a line = no check
```

## 3. Eliminate redundant nil checks

Keep a pointer "visible" between uses so dominance-based elimination
(`ssa/nilcheck.go`) can drop later checks.

```go
// GOOD: one NilCheck dominates both reads
func f(p *T) int { return p.x + p.y }

// BAD: round-tripping or reassigning the pointer hides it
func g(p *T) int {
    var i any = p; _ = i
    return p.x + p.y    // may re-check
}
```

Snapshot struct-field slices/pointers into a local before a guarded access so the
guard and the use reference the same SSA value:

```go
b := x.b
if i < len(b) { return b[i] }   // check folds; x.b read once
```

## 4. Help the inliner (which feeds SSA)

Inlining copies the callee's body into the caller's SSA, so the caller's facts
(constants, ranges, non-nil) flow into it. Bigger optimizations follow inlining.

- Keep hot functions under the inliner's budget; check with `-m`.
- Prefer concrete types over `interface{}` in hot paths — interface calls don't
  inline and aren't folded.
- `//go:noinline` is for *measurement* (force a boundary), not for shipping speed.
- Avoid hidden non-inlinable constructs in hot functions: `defer` in tight loops,
  closures that escape, `recover`.

```shell
go build -gcflags='-m' ./pkg 2>&1 | grep -E 'inlining call|cannot inline'
```

## 5. Avoid write barriers and allocations in hot loops

Pointer stores into the heap emit `runtime.gcWriteBarrier`; allocations call
`mallocgc`. Both show up in `-S`.

```go
// BAD: storing pointers in a loop → write barriers
for i := range nodes { graph[i] = &nodes[i] }

// BETTER: store indices / values, or preallocate and reuse backing arrays
buf := make([]byte, 0, n)         // one alloc, reused capacity
for ... { buf = append(buf, b) }  // no per-iteration alloc
```

Check escape decisions; a value "moved to heap" is an allocation you may be able to
keep on the stack by not letting it escape (don't return its address, don't store
it in an interface).

## 6. Read the assembly

Two routes; use both.

```shell
go build -gcflags=-S ./pkg 2>asm.s              # source-annotated asm
go tool objdump -s 'pkg\.Hot' ./binary          # disassemble shipped binary
```

In the hot block, scan for:

| Want to NOT see | Why |
| --- | --- |
| `CALL runtime.panicIndex/panicSlice` | a bounds check survived |
| `CALL runtime.gcWriteBarrier` | heap pointer store |
| `CALL runtime.mallocgc/convT*` | allocation/boxing |
| repeated identical `MOV (mem)` | a load that aliasing/CSE couldn't hoist |

## 7. Micro-benchmark honestly

```go
func BenchmarkHot(b *testing.B) {
    s := makeInput()
    b.ReportAllocs()
    b.ResetTimer()
    var sink int
    for i := 0; i < b.N; i++ { sink = hot(s) }
    runtime.KeepAlive(sink)   // stop dead-code elimination of the result
}
```

```shell
go test -run=^$ -bench=BenchmarkHot -benchmem -count=12 ./pkg | tee a.txt
# ...one change...
go test -run=^$ -bench=BenchmarkHot -benchmem -count=12 ./pkg | tee b.txt
benchstat a.txt b.txt
```

Without `KeepAlive`/`sink`, the compiler may delete your work and you'll "optimize"
to a no-op. Without `-count` + `benchstat`, you can't tell a win from noise.

## 8. Checklist

- [ ] Profiled first; the hot path is confirmed, not assumed.
- [ ] Hot function inlines (`-m`); interfaces removed from the hot path.
- [ ] Loops index via `range`; bounds hoisted; `check_bce/debug=1` is silent on hot
      lines.
- [ ] Pointers/slices snapshotted into locals so nil-checks and BCE fold.
- [ ] No `panicIndex`, `gcWriteBarrier`, or `mallocgc` in the hot block of `-S`.
- [ ] Allocations hoisted out of loops; backing arrays reused.
- [ ] Benchmarks use `ReportAllocs` + `KeepAlive`; compared with `benchstat`,
      `-count>=10`.
- [ ] Read the final asm and confirmed the change actually landed in codegen.

## Further reading

- `ssa/prove.go`, `ssa/nilcheck.go`, `ssa/cse.go` in `$(go env GOROOT)/src/...`
- Codegen tests as a pattern library: `$(go env GOROOT)/test/codegen/`
- Go wiki Compiler Optimizations: <https://go.dev/wiki/CompilerOptimizations>
- `testing` benchmarks & `benchstat`:
  <https://pkg.go.dev/testing>, <https://pkg.go.dev/golang.org/x/perf/cmd/benchstat>
- Dave Cheney, high-performance Go workshop: <https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html>
