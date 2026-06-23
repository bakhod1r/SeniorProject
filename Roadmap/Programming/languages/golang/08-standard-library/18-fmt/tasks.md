# Go fmt — Tasks

## Instructions

Each task includes a description, starter code, expected output,
and a checklist. Use `fmt` idiomatically; prefer `strconv` and
`strings.Builder` when performance is asked for; implement
`Stringer`/`Formatter` when a type needs a custom representation.

---

## Task 1 — Greeting Printer

**Difficulty**: Beginner — **Topic**: Print family

Write `Greet(name string) string` that returns `"Hello, <name>!"`.

```go
func Greet(name string) string {
    // TODO
    return ""
}
fmt.Println(Greet("Ada")) // Hello, Ada!
```

**Checklist**:
- [ ] Uses `fmt.Sprintf` (not concatenation).
- [ ] No trailing newline in the returned string.

---

## Task 2 — Aligned Table

**Difficulty**: Beginner — **Topic**: Width and precision

Print this slice as a 3-column aligned table. Names right-padded to
12 chars, counts right-aligned in 5, percentages with 2 decimals in
7.

```go
items := []struct {
    Name  string
    Count int
    Share float64
}{
    {"alpha", 12, 0.04},
    {"beta-prime", 240, 0.83},
    {"gamma", 1, 0.001},
}
```

**Expected**:
```
alpha            12   4.00%
beta-prime      240  83.00%
gamma             1   0.10%
```

**Checklist**:
- [ ] Uses `Printf` with width/precision verbs.
- [ ] Columns line up regardless of name length.
- [ ] Uses `%%` for the literal percent sign.

---

## Task 3 — Error Wrapper

**Difficulty**: Beginner — **Topic**: `%w` and `errors.Is`

Write `LoadConfig(path string) error` that wraps any error with
`fmt.Errorf("load config: %w", err)`. Verify
`errors.Is(LoadConfig("/no/such"), os.ErrNotExist)` is true.

**Expected**:
```
load config: open /no/such: no such file or directory
is not-exist: true
```

**Checklist**:
- [ ] Uses `%w` (not `%v`).
- [ ] `errors.Is` returns true.
- [ ] Returns nil on success.

---

## Task 4 — Stringer for Direction

**Difficulty**: Beginner — **Topic**: `Stringer`

Define `type Direction int` with `North`, `East`, `South`, `West`.
Implement `String()` so `fmt.Println(North)` prints `N`.

```go
type Direction int
const (North Direction = iota; East; South; West)
// TODO: String()
```

**Expected**: `N`, `E`, `S`, `W` (one per line).

**Checklist**:
- [ ] `String()` on value receiver.
- [ ] Out-of-range returns `Direction(N)` via `strconv.Itoa`.

---

## Task 5 — Money Type

**Difficulty**: Intermediate — **Topic**: `Stringer` with formatting

Implement `type Money struct{ Cents int64; Code string }` with
`String()` returning `"<dollars>.<cents> <code>"`. Cents always
2 digits.

```go
fmt.Println(Money{1234, "USD"}) // 12.34 USD
fmt.Println(Money{900, "USD"})  // 9.00 USD
fmt.Println(Money{5, "USD"})    // 0.05 USD
```

**Checklist**:
- [ ] `fmt.Sprintf("%d.%02d %s", ...)`.
- [ ] Handles cents < 10 (`9.05`, not `9.5`).
- [ ] Value receiver.

---

## Task 6 — Custom Error With Unwrap

**Difficulty**: Intermediate — **Topic**: `error`, `Unwrap`

Define `AppError{ Op string; Err error }` that:
1. Implements `error` with `Error() = "<op>: <inner>"`.
2. Implements `Unwrap() error`.
3. Wraps a sentinel `ErrNotFound` so `errors.Is(appErr, ErrNotFound)`
   is true.

**Expected**:
```
load: not found
true
```

**Checklist**:
- [ ] `Error()` returns `Op + ": " + Err.Error()`.
- [ ] `Unwrap()` returns `e.Err`.

---

## Task 7 — Format Method With Verbose Mode

**Difficulty**: Intermediate — **Topic**: `Formatter`

Add `Format(fmt.State, rune)` to Task 6's `AppError` so:
- `%v` prints `Op: Inner`.
- `%+v` prints `Op\n  cause: <inner.Error()>`.

**Expected**:
```
load: disk full
load
  cause: disk full
```

**Checklist**:
- [ ] `Format` switches on `verb`.
- [ ] Honours `f.Flag('+')`.
- [ ] Uses `fmt.Fprintf(f, ...)` (no recursion).

---

## Task 8 — Sprintf vs Builder Benchmark

**Difficulty**: Intermediate — **Topic**: Performance

Compare:
```go
func BenchmarkSprintf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = fmt.Sprintf("user-%d-%s", i, "profile")
    }
}

func BenchmarkBuilder(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        sb.Grow(20)
        sb.WriteString("user-")
        sb.WriteString(strconv.Itoa(i))
        sb.WriteByte('-')
        sb.WriteString("profile")
        _ = sb.String()
    }
}
```

**Expected**: Builder ≥ 2x faster, fewer allocs.

**Checklist**:
- [ ] `go test -bench . -benchmem`.
- [ ] Compare ns/op and allocs/op.

---

## Task 9 — Color Formatter With Custom Verbs

**Difficulty**: Advanced — **Topic**: `Formatter`, custom verbs

Define `type Color struct{ R, G, B uint8 }` with `Format`
supporting:
- `%v`/`%s` → `(R,G,B)`
- `%h` → `#rrggbb`
- `%r` → `rgb(R,G,B)`

```go
c := Color{255, 128, 0}
fmt.Printf("%v %s %h %r\n", c, c, c, c)
// (255,128,0) (255,128,0) #ff8000 rgb(255,128,0)
```

**Checklist**:
- [ ] Switch on `verb`.
- [ ] Default branch handles unsupported verbs.
- [ ] No `fmt.Sprintf("%v", c)` inside `Format` (recursion).

---

## Task 10 — Stringer Codegen

**Difficulty**: Intermediate — **Topic**: `stringer` tool

```go
//go:generate stringer -type=Status -trimprefix=Status

type Status int
const (StatusPending Status = iota; StatusRunning; StatusDone)
```

**Steps**:
1. `go install golang.org/x/tools/cmd/stringer@latest`
2. `go generate ./...`
3. `fmt.Println(StatusRunning)` → `Running`.

**Checklist**:
- [ ] Generated file `status_string.go` exists.
- [ ] `Println` prints the trimmed name.

---

## Task 11 — Hex Dumper

**Difficulty**: Intermediate — **Topic**: `%x`/`%X`

Write `Hex(b []byte) string` returning `de ad be ef` (lowercase,
space-separated).

**Checklist**:
- [ ] Uses `%x` or `% x`.
- [ ] Works for empty slices (returns `""`).

---

## Task 12 — Sscanf Parser

**Difficulty**: Intermediate — **Topic**: `Sscanf`

Parse `"user=42 ip=10.0.0.1"` into `id int` and `ip string`.

```go
func Parse(line string) (int, string, error) {
    var id int
    var ip string
    _, err := fmt.Sscanf(line, "user=%d ip=%s", &id, &ip)
    return id, ip, err
}
```

**Expected**: `42 10.0.0.1 <nil>`.

**Checklist**:
- [ ] Uses `Sscanf` with `"user=%d ip=%s"`.
- [ ] Returns the error from `Sscanf`.

---

## Task 13 — Multi-Line Logger

**Difficulty**: Advanced — **Topic**: `Fprintln` to bufio

Implement `Logger(out io.Writer) *Log` with `Infof`, `Errorf`,
`Flush`. Wrap `out` with `bufio.Writer`.

**Expected**:
```
INFO: started service
ERROR: disk 92%
```

**Checklist**:
- [ ] `bufio.NewWriter(out)` internally.
- [ ] `Infof`/`Errorf` use `fmt.Fprintf`.
- [ ] `Flush` returns the writer's flush error.

---

## Task 14 — Optimised Tabular Output

**Difficulty**: Advanced — **Topic**: Performance

Print 1M rows `"<id> <name>\n"` to stdout, 5x faster than
`fmt.Printf`.

```go
w := bufio.NewWriterSize(os.Stdout, 1<<20)
defer w.Flush()
var line []byte
for i := 0; i < 1_000_000; i++ {
    line = strconv.AppendInt(line[:0], int64(i), 10)
    line = append(line, ' ')
    line = append(line, "name"...)
    line = append(line, '\n')
    w.Write(line)
}
```

**Checklist**:
- [ ] `bufio.Writer` (1 MB buffer).
- [ ] `strconv.AppendInt` (no `Sprintf`).
- [ ] Reuses `line` slice.
- [ ] Flushes on exit.

---

## Task 15 — Test the Stringer Recursion

**Difficulty**: Intermediate — **Topic**: Defensive testing

Given a buggy recursive `String()`:
```go
func (t T) String() string { return fmt.Sprintf("%v", t) } // BUG
```

Write a test that detects recursion in finite time without crashing
the test process.

```go
func TestStringerTerminates(t *testing.T) {
    done := make(chan struct{})
    var got string
    go func() {
        defer func() {
            if r := recover(); r != nil { /* expected on overflow */ }
            close(done)
        }()
        got = fmt.Sprintf("%v", T{1})
    }()
    select {
    case <-done:
        t.Logf("returned: %q", got)
    case <-time.After(2 * time.Second):
        t.Fatal("String() did not terminate; recursion suspected")
    }
}
```

**Checklist**:
- [ ] Goroutine isolates the panicking work.
- [ ] Timeout detects infinite recursion.
- [ ] Test fails for buggy code, passes after the fix.

---

## Summary

These 15 tasks cover: Print/Sprint/Fprint families (1, 11, 13, 14);
verbs, width, precision (2, 11); error wrapping (3, 6); `Stringer`
(4, 5, 10); `Formatter` (7, 9); `stringer` codegen (10); performance
(8, 14); scanning (12); defensive testing (15).

Work through them in order; later tasks build on earlier ones
(7 extends 6; 14 builds on 13). Run `go vet` and `golangci-lint
run` to catch verb mismatches and `%w`-discipline issues.
