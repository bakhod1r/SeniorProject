# Benchmarking Strategy — Junior

## 1. What is a benchmark?

A benchmark answers one question: **how fast is this piece of code?** In Go, a benchmark is a small function the testing framework runs many times in a loop, measuring how long each iteration takes. The output gives you a number like `97.4 ns/op` — "this code took 97.4 nanoseconds per operation".

Benchmarks are how you decide whether one implementation is faster than another. They are also how you catch a change that accidentally made your program slower.

---

## 2. Your first benchmark

A benchmark lives in a `_test.go` file and has this exact signature:

```go
func BenchmarkXxx(b *testing.B) { ... }
```

Here's a complete example. Save it as `sum_test.go`:

```go
package mathx

import "testing"

func Sum(xs []int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}

func BenchmarkSum(b *testing.B) {
    xs := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    for i := 0; i < b.N; i++ {
        Sum(xs)
    }
}
```

Run it:

```bash
go test -bench=. -run=^$
```

Output:

```
BenchmarkSum-8        289453122            4.10 ns/op
PASS
```

`-8` is your `GOMAXPROCS`. `289453122` is how many times the loop ran. `4.10 ns/op` is the headline number — the time per call to `Sum`.

> The `-run=^$` is a convention. It tells `go test` to skip all the regular `TestXxx` functions and only run benchmarks. Without it, you also run unit tests.

---

## 3. What is `b.N`?

`b.N` is the iteration count the testing framework asks you to run. **You do not pick it.** The framework starts with `b.N = 1`, sees how long that takes, and then ramps `b.N` up until the total measured time is around one second. That way the per-iteration cost is averaged over enough samples to be stable.

The contract is simple:

```go
for i := 0; i < b.N; i++ {
    // the thing you want to measure
}
```

Run the operation exactly `b.N` times. Don't run it `b.N * 10` times. Don't run it once. The framework will divide elapsed time by `b.N` to get `ns/op`.

---

## 4. Reading the output

```
BenchmarkSum-8        289453122            4.10 ns/op
```

| Piece | Meaning |
|-------|---------|
| `BenchmarkSum` | The function name. |
| `-8` | Your `GOMAXPROCS` value. |
| `289453122` | The final `b.N` (how many iterations were measured). |
| `4.10 ns/op` | Mean nanoseconds per iteration. |

Some intuition for the time scale:

| `ns/op` | Roughly what it means |
|---------|----------------------|
| `< 1` | Almost certainly the compiler deleted your code. Suspect. |
| `1–10` | A single CPU instruction or two. Map lookup, simple arithmetic. |
| `10–100` | Function call, small allocation, hash. |
| `100–1000` | A bigger operation: regex match, JSON of a small struct. |
| `1000+` | Real work: parsing, syscalls, network round-trips. |

If your `ns/op` is unexpectedly small (under 1 ns), you've probably hit pitfall #1 — see section 8.

---

## 5. Measuring allocations: `-benchmem`

Time isn't the only cost. Allocations stress the garbage collector. Add `-benchmem`:

```bash
go test -bench=. -run=^$ -benchmem
```

```
BenchmarkSum-8        289453122    4.10 ns/op    0 B/op    0 allocs/op
```

Two new columns:

- `B/op` — bytes allocated on the heap per iteration.
- `allocs/op` — number of heap allocations per iteration.

`0 allocs/op` is the gold standard for a hot path. Even a single small allocation per call adds up at scale.

You can also call `b.ReportAllocs()` inside the benchmark to force this output without the flag:

```go
func BenchmarkSum(b *testing.B) {
    xs := []int{1, 2, 3, 4, 5}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        Sum(xs)
    }
}
```

---

## 6. A more realistic example

```go
func BenchmarkSprintf(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = fmt.Sprintf("user-%d", 42)
    }
}
```

```
BenchmarkSprintf-8        15923442    74.6 ns/op    16 B/op    2 allocs/op
```

74.6 ns and 2 allocations to format `"user-42"`. Now try a faster path:

```go
func BenchmarkStrconv(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = "user-" + strconv.Itoa(42)
    }
}
```

```
BenchmarkStrconv-8        47265832    25.3 ns/op    8 B/op    1 allocs/op
```

3× faster, half the allocations. This is the kind of comparison benchmarks are designed for.

---

## 7. Excluding setup with `b.ResetTimer`

If your benchmark needs to prepare data before the loop, you don't want that prep time counted. Use `b.ResetTimer`:

```go
func BenchmarkParseConfig(b *testing.B) {
    data, err := os.ReadFile("config.yaml")  // expensive: read from disk
    if err != nil {
        b.Fatal(err)
    }

    b.ResetTimer()                           // <-- forget everything above
    for i := 0; i < b.N; i++ {
        _, _ = parseConfig(data)
    }
}
```

Without `b.ResetTimer`, the file read counts as part of the benchmark, and your numbers will swing wildly with disk cache state.

The mirror image is `b.StopTimer` / `b.StartTimer`, used to pause the clock inside the loop:

```go
for i := 0; i < b.N; i++ {
    b.StopTimer()
    data := freshInput()    // not measured
    b.StartTimer()
    process(data)           // measured
}
```

Use `StopTimer/StartTimer` sparingly — they have their own overhead.

---

## 8. The number-one pitfall: the compiler deleted your code

Look at this:

```go
func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        1 + 2
    }
}
```

The compiler sees that `1 + 2` is unused and removes it. Your "benchmark" measures an empty loop. Result:

```
BenchmarkAdd-8        1000000000    0.31 ns/op
```

0.31 ns is the cost of incrementing `i`. **The benchmark is a lie.**

The fix is to *use* the result so the compiler can't remove it. A common pattern is the **sink variable**:

```go
var sink int

func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = 1 + 2
    }
}
```

The package-level `sink` cannot be proven dead by the compiler. The work runs.

If you're on Go 1.24+, `b.Loop()` handles this for you:

```go
func BenchmarkAdd(b *testing.B) {
    for b.Loop() {
        _ = 1 + 2
    }
}
```

Whenever your benchmark reports a suspiciously small number, this is the first thing to check.

---

## 9. Running just one benchmark

`-bench` takes a regex. To run just `BenchmarkSum`:

```bash
go test -bench=^BenchmarkSum$ -run=^$
```

To run benchmarks in one package:

```bash
go test -bench=. -run=^$ ./mathx/
```

To run them everywhere:

```bash
go test -bench=. -run=^$ ./...
```

---

## 10. Things you can do today

1. Add one `BenchmarkXxx` next to a function you've written. Run it. Read the output.
2. Add `-benchmem` and check whether your function allocates. If you didn't expect it to, find out why.
3. Write two benchmarks that compare two implementations (string concat with `+` vs. `strings.Builder`). See which is faster.
4. Try the "0.31 ns/op" trap on purpose. Then fix it with a `sink` variable.

---

## 11. Summary

A Go benchmark is a `BenchmarkXxx(b *testing.B)` function that runs `b.N` iterations of the code under test. `go test -bench=. -benchmem` runs it and reports `ns/op`, `B/op`, and `allocs/op`. Use `b.ResetTimer` to exclude setup. Watch out for the compiler deleting unused results — use a `sink` variable or `b.Loop()` (Go 1.24+) to keep your code honest.

---

## Further reading
- `testing` package: https://pkg.go.dev/testing
- Go blog — using subtests and sub-benchmarks: https://go.dev/blog/subtests
- Dave Cheney — how to write benchmarks: https://dave.cheney.net/2013/06/30/how-to-write-benchmarks-in-go
