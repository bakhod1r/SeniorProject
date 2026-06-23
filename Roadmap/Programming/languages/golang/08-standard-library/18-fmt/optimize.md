# Go fmt — Optimize

## Instructions

Each exercise presents inefficient `fmt` usage. Identify the issue,
write an optimized version, and explain. Difficulty: 🟢 Easy,
🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Sprintf for an Integer Conversion

```go
func userKey(id int) string {
    return fmt.Sprintf("%d", id)
}
```

<details>
<summary>Solution</summary>

`Sprintf` goes through the verb parser and the `pp` state. ~2
allocations, ~45 ns/op.

```go
func userKey(id int) string { return strconv.Itoa(id) }
```

```
BenchmarkSprintf-8   30000000   45 ns/op   16 B/op   2 allocs/op
BenchmarkItoa-8     200000000    7 ns/op    0 B/op   0 allocs/op
```

`strconv.Itoa` has a fast path for small ints. **Single-value
conversions belong in `strconv`.**
</details>

---

## Exercise 2 🟢 — Sprintf in a Tight Loop for a Key

```go
for _, id := range ids {
    key := fmt.Sprintf("user:%d:profile", id)
    cache.Set(key, profileFor(id))
}
```

<details>
<summary>Solution</summary>

Each iteration allocates the format buffer and the result string.

```go
var b strings.Builder
b.Grow(20)
for _, id := range ids {
    b.Reset()
    b.WriteString("user:")
    b.WriteString(strconv.Itoa(id))
    b.WriteString(":profile")
    cache.Set(b.String(), profileFor(id))
}
```

Buffer reuse halves the cost. `Builder` reuses a `[]byte`; `Sprintf`
does not.
</details>

---

## Exercise 3 🟡 — Println in a Hot Loop

```go
for _, item := range items {
    fmt.Println("processing:", item.Name)
}
```

<details>
<summary>Solution</summary>

`Println` packs args into `[]any` (1 alloc/call), each arg formats
via reflection, output is line-buffered with per-call syscall and
the `os.Stdout` mutex.

Three options, in order of preference:

1. Move the log out of the loop.
2. `slog` with `JSONHandler` (alloc-free in Go 1.22+):
   ```go
   slog.Debug("processing", "name", item.Name)
   ```
3. Manual `bufio.Writer`:
   ```go
   bw := bufio.NewWriter(os.Stdout)
   defer bw.Flush()
   for _, item := range items {
       bw.WriteString("processing: ")
       bw.WriteString(item.Name)
       bw.WriteByte('\n')
   }
   ```

Hot-loop logs need either zero-allocation structured logging or no
logging at all.
</details>

---

## Exercise 4 🟡 — Sprintf for a Composite Key

```go
func tenantKey(tenant, region, kind string) string {
    return fmt.Sprintf("%s/%s/%s", tenant, region, kind)
}
```

<details>
<summary>Solution</summary>

Profile first. If hot:

```go
func tenantKey(tenant, region, kind string) string {
    var b strings.Builder
    b.Grow(len(tenant) + len(region) + len(kind) + 2)
    b.WriteString(tenant); b.WriteByte('/')
    b.WriteString(region); b.WriteByte('/')
    b.WriteString(kind)
    return b.String()
}
```

```
BenchmarkSprintf-8    20000000   80 ns/op   32 B/op   2 allocs/op
BenchmarkBuilder-8    50000000   24 ns/op   16 B/op   1 allocs/op
```

`Grow(n)` upfront avoids buffer-resize re-allocations.
</details>

---

## Exercise 5 🟡 — Errorf in a Cold Path

```go
if err != nil {
    return fmt.Errorf("call %s: %w", op, err)
}
```

<details>
<summary>Solution</summary>

**Don't optimize.** Error paths are cold. ~200 ns and 2 allocs is
invisible. Optimizing would lose readability and break `errors.Is`
for casual readers. **Optimize hot paths only.**
</details>

---

## Exercise 6 🟡 — Sprintf for a Float in a Hot Path

```go
func price(cents int64) string {
    return fmt.Sprintf("%.2f", float64(cents)/100.0)
}
```

<details>
<summary>Solution</summary>

Direct integer math, ~5x faster:

```go
func price(cents int64) string {
    var b [16]byte
    n := len(b)
    n--; b[n] = '0' + byte(cents%10); cents /= 10
    n--; b[n] = '0' + byte(cents%10); cents /= 10
    n--; b[n] = '.'
    if cents == 0 { n--; b[n] = '0' }
    for cents > 0 {
        n--; b[n] = '0' + byte(cents%10); cents /= 10
    }
    return string(b[n:])
}
```

```
BenchmarkSprintf-8   20000000   75 ns/op   24 B/op   2 allocs/op
BenchmarkManual-8   100000000   14 ns/op    8 B/op   1 allocs/op
```

Currency is integer; avoid `float64`. Use only when profile demands.
</details>

---

## Exercise 7 🔴 — pp Pool Awareness

A high-throughput service (50k Sprintf/sec) shows `fmt.newPrinter`
allocations in the heap profile. Why? It should be pooled.

<details>
<summary>Solution</summary>

The `sync.Pool` is per-P; entries can be dropped during GC. After
GC, the next call allocates again. Also, buffers > 64 KiB are
dropped on purpose:

```go
func (p *pp) free() {
    if cap(p.buf) > 64<<10 { return } // don't pool huge buffers
    ...
    ppFree.Put(p)
}
```

Mitigation: increase GOGC (less frequent GC), or move the hot path
off `fmt` entirely (use `Builder`).

```bash
go test -bench BenchmarkSprintf -benchmem -count=10
GODEBUG=allocfreetrace=1 ./yourbinary 2>&1 | grep "fmt.newPrinter"
```

Pools mitigate but don't eliminate allocation. For true zero-alloc,
format directly into a caller-provided buffer.
</details>

---

## Exercise 8 🔴 — Allocation From Interface Boxing

```go
fmt.Printf("count=%d\n", n) // n is int
```

<details>
<summary>Solution</summary>

`Printf` packs `n` into an `any`. Boxing an `int` is normally an
alloc, but Go has a fast path: small ints (~`-256` to `255`) are
interned. For larger `n`, one alloc per call.

Avoid the box entirely:

```go
buf = strconv.AppendInt(buf, int64(n), 10)
buf = append(buf, '\n')
os.Stdout.Write(buf)
```

The variadic `...any` is the hidden cost in `Printf`-like
benchmarks. Type-specific functions avoid it.
</details>

---

## Exercise 9 🔴 — Stringer Recursion at Profile Top

pprof shows `(*pp).doPrintf` → `handleMethods` → `String` →
`Sprintf` → `doPrintf`. Stack depth: 200.

<details>
<summary>Solution</summary>

A `String()` method calls `fmt.Sprintf("%v", t)` on its own type.
Each call recurses; the goroutine eventually OOMs.

```bash
go test -run XXX -cpuprofile cpu.out ./...
go tool pprof -list 'String' cpu.out  # look for self-referential frames
```

Fix:
```go
// Bad
func (t T) String() string { return fmt.Sprintf("%v", t) }

// Good — explicit verbs
func (t T) String() string { return fmt.Sprintf("T{X:%d}", t.X) }

// Good — alias type
func (t T) String() string {
    type alias T
    return fmt.Sprintf("%+v", alias(t))
}
```

`vet` does NOT catch this. Add a unit test that calls `String()`.
</details>

---

## Exercise 10 🔴 — Aligning a Million Rows

A CLI prints 1M rows with `fmt.Printf("%-30s %10d\n", name, count)`
in 8s.

<details>
<summary>Solution</summary>

Profile: 80% in `doPrintf`, 15% in `os.Stdout.Write`.

Step 1 — buffer stdout (drops to ~3s):
```go
bw := bufio.NewWriterSize(os.Stdout, 1<<20)
defer bw.Flush()
for _, r := range rows {
    fmt.Fprintf(bw, "%-30s %10d\n", r.name, r.count)
}
```

Step 2 — drop `fmt` (drops to ~1s):
```go
var lineBuf [64]byte
for _, r := range rows {
    line := lineBuf[:0]
    line = append(line, r.name...)
    for i := len(r.name); i < 30; i++ { line = append(line, ' ') }
    line = append(line, ' ')
    line = strconv.AppendInt(line, int64(r.count), 10)
    line = append(line, '\n')
    bw.Write(line)
}
```

Tabular CLIs benefit from `bufio.Writer` first; remove `fmt` second.
</details>

---

## Exercise 11 🟡 — strings.Builder vs bytes.Buffer

```go
func render() string {
    var b bytes.Buffer
    fmt.Fprintf(&b, "header: %s\n", title)
    for _, line := range body {
        fmt.Fprintf(&b, "  %s\n", line)
    }
    return b.String()
}
```

<details>
<summary>Solution</summary>

`bytes.Buffer.String()` allocates a new string. `strings.Builder`
avoids that copy:

```go
var b strings.Builder
fmt.Fprintf(&b, "header: %s\n", title)
for _, line := range body {
    fmt.Fprintf(&b, "  %s\n", line)
}
return b.String()
```

```
BenchmarkBytesBuffer-8   1000000  1300 ns/op  2400 B/op  4 allocs/op
BenchmarkBuilder-8       1500000   900 ns/op  1024 B/op  2 allocs/op
```

Caveat: `bytes.Buffer` implements `io.Reader`; if you read back
what you wrote, keep it.
</details>

---

## Exercise 12 🔴 — PGO Inlining Through Closures

```go
func (l *Logger) Logf(format string, args ...any) {
    if !l.enabled { return }
    fmt.Fprintf(l.w, format, args...)
}
```

Profile shows the call site is hot; logger is disabled in
production.

<details>
<summary>Solution</summary>

The variadic `args...any` boxes each argument **before** the
function returns, even with `enabled = false`. Inlining doesn't
help — boxing happens at the call.

Early bail at the call site:
```go
if l.enabled {
    fmt.Fprintf(l.w, "user=%d action=%s\n", uid, action)
}
```

Or a closure for lazy formatting:
```go
type lazyMsg func() string
func (l *Logger) LogLazy(get lazyMsg) {
    if !l.enabled { return }
    fmt.Fprintln(l.w, get())
}
l.LogLazy(func() string { return fmt.Sprintf("user=%d", uid) })
```

Or use leveled APIs that check the level on the caller side, like
`slog`:
```go
if logger.Enabled(ctx, slog.LevelDebug) {
    logger.Debug("user", "id", uid)
}
```

Variadic `...any` boxes args at the call site, not inside.
</details>

---

## Exercise 13 🔴 — Format Method Allocation

```go
func (e *AppErr) Format(s fmt.State, verb rune) {
    fmt.Fprintf(s, "%s: %s", e.Op, e.Err.Error())
}
```

Profile shows ~40 B per call.

<details>
<summary>Solution</summary>

`Fprintf` re-enters the formatter and parses verbs. Write directly
through `s`:

```go
var sep = []byte(": ")

func (e *AppErr) Format(s fmt.State, verb rune) {
    io.WriteString(s, e.Op)
    s.Write(sep)
    io.WriteString(s, e.Err.Error())
}
```

`io.WriteString` uses `WriteString` if `s` implements it (`fmt.pp`
does).

```
BenchmarkFormatFprintf-8    10000000  150 ns/op  48 B/op  3 allocs/op
BenchmarkFormatDirect-8     30000000   45 ns/op   0 B/op  0 allocs/op
```

`Format` runs on the hot path of every `%v` call. Make it
allocation-free.
</details>

---

## Exercise 14 🔴 — Reusable Sprintf via byte slice

```go
out := []byte("[")
for i, x := range xs {
    if i > 0 { out = append(out, ',') }
    out = append(out, fmt.Sprintf("%d", x)...)
}
out = append(out, ']')
```

<details>
<summary>Solution</summary>

Each `Sprintf` allocates a string only to copy back into `out`.

```go
out := []byte("[")
for i, x := range xs {
    if i > 0 { out = append(out, ',') }
    out = strconv.AppendInt(out, int64(x), 10)
}
out = append(out, ']')
```

```
BenchmarkSprintf-8     5000   320µs/op  140 KB/op  10000 allocs
BenchmarkAppend-8     50000    25µs/op    8 KB/op      1 alloc
```

12x faster, 10000x fewer allocations. Anywhere you
`append([]byte, fmt.Sprintf(...)...)` you want `strconv.AppendXxx`.
</details>

---

## Exercise 15 🟡 — Println vs Printf for a Constant

```go
fmt.Printf("ready\n")
```

<details>
<summary>Solution</summary>

`Printf` parses the format string for verbs even when there are
none. Use `Println("ready")` or, fastest:

```go
io.WriteString(os.Stdout, "ready\n")
```

```
BenchmarkPrintf-8       30000000   55 ns/op
BenchmarkPrintln-8      40000000   42 ns/op
BenchmarkWriteString-8 100000000   12 ns/op
```

For a constant message, skip the format parse.
</details>

---

## Summary: Optimization Hierarchy

When `fmt` shows up in a profile:

1. **Profile first.** Don't optimize on suspicion.
2. **Single-value conversion?** `strconv.Itoa`, `FormatFloat`.
3. **Building a string?** `strings.Builder` with `Grow`.
4. **Building bytes?** `strconv.AppendInt` / `append`.
5. **Writing many lines?** Wrap stdout with `bufio.Writer`.
6. **Service log?** Switch to `slog`.
7. **Hot Format method?** Write directly through the `State`.
8. **Stringer recursion?** Fix immediately — it's a bug.
9. **Variadic boxing?** Level-check at the caller; use typed APIs.
10. **Still hot?** Drop down to a hand-rolled `[]byte` builder.

`fmt` is correct, readable, and slow. Default to it; replace where
benchmarks demand.
