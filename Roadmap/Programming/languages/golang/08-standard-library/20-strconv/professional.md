# 8.20 `strconv` — Professional

> **Audience.** You're running serialization, log shipping, or
> protocol code at scale, and `strconv` is on the hot path. This
> file is the production playbook: zero-allocation patterns,
> profiling techniques, and the policies that prevent regressions.

## 1. The zero-allocation appender pattern

The professional move with `strconv` is **never to materialize a
string for an intermediate value**. Append into a pre-allocated
buffer, write the buffer once.

```go
type intEncoder struct {
    buf []byte
}

func (e *intEncoder) Reset() {
    e.buf = e.buf[:0]
}

func (e *intEncoder) WriteInt(i int64) {
    e.buf = strconv.AppendInt(e.buf, i, 10)
}

func (e *intEncoder) WriteByte(b byte) {
    e.buf = append(e.buf, b)
}

func (e *intEncoder) Bytes() []byte {
    return e.buf
}
```

Used inside a pooled context, this generates zero allocations per
encoded record:

```go
var encPool = sync.Pool{
    New: func() any { return &intEncoder{buf: make([]byte, 0, 256)} },
}

func encodeRecord(r Record) []byte {
    e := encPool.Get().(*intEncoder)
    defer func() {
        e.Reset()
        encPool.Put(e)
    }()
    e.WriteByte('[')
    for i, v := range r.Values {
        if i > 0 { e.WriteByte(',') }
        e.WriteInt(v)
    }
    e.WriteByte(']')
    out := make([]byte, len(e.buf))
    copy(out, e.buf)
    return out
}
```

The final `copy` is the only allocation — and it's required
because we're returning the bytes; the encoder's buffer goes back
to the pool. If the caller takes an `io.Writer`, you can skip even
this allocation by calling `w.Write(e.buf)` directly.

## 2. The CSV ingester baseline

A real-world target: parse a 10 GB CSV of `(timestamp, sensor_id,
value)` rows.

### Naive

```go
func parse(r io.Reader) error {
    scanner := bufio.NewScanner(r)
    for scanner.Scan() {
        parts := strings.Split(scanner.Text(), ",")
        ts, _ := strconv.ParseInt(parts[0], 10, 64)
        id, _ := strconv.Atoi(parts[1])
        val, _ := strconv.ParseFloat(parts[2], 64)
        process(ts, id, val)
    }
    return scanner.Err()
}
```

Allocations per line:

- `scanner.Text()` allocates a copy of the line.
- `strings.Split` allocates a slice and three string headers.
- Each `Parse*` failure case (if any) allocates a `NumError`.

At 10M rows, that's ~50M allocations. GC stop-the-world windows
become visible. Throughput: ~200k rows/sec on amd64.

### Optimized

```go
func parse(r io.Reader) error {
    scanner := bufio.NewScanner(r)
    scanner.Buffer(make([]byte, 64*1024), 1<<20)
    for scanner.Scan() {
        line := scanner.Bytes() // valid until next Scan
        ts, rest := parseInt(line)
        if rest == nil { return errors.New("bad ts") }
        id, rest := parseInt(rest)
        if rest == nil { return errors.New("bad id") }
        val, _ := strconv.ParseFloat(string(rest), 64)
        process(ts, id, val)
    }
    return scanner.Err()
}

// parseInt parses an integer at the start of b, expects a trailing comma.
// Returns the value and the remainder after the comma.
func parseInt(b []byte) (int64, []byte) {
    var n int64
    i := 0
    for ; i < len(b) && b[i] >= '0' && b[i] <= '9'; i++ {
        n = n*10 + int64(b[i]-'0')
    }
    if i == 0 || i >= len(b) || b[i] != ',' {
        return 0, nil
    }
    return n, b[i+1:]
}
```

Allocations per line: one (`string(rest)` for ParseFloat — and even
that escapes if the compiler proves the slice doesn't). Throughput:
~2M rows/sec — 10×.

The lesson: **the standard library is fast, but a domain-specific
parser written with the same primitives can be faster still.**
Reach for this only when profile data justifies the maintenance cost.

## 3. `Atoi` is the wrong tool for protocols

`Atoi` is permissive in some ways and strict in others:

- Leading `+`/`-`: accepted.
- Leading whitespace: rejected.
- Trailing whitespace: rejected.
- Underscores: rejected.
- Empty string: rejected.

For binary protocols where you know exactly which bytes are digits,
write your own:

```go
func atoiUnchecked(b []byte) int {
    n := 0
    for _, c := range b {
        n = n*10 + int(c-'0')
    }
    return n
}
```

This is 5–10× faster than `Atoi` for tight inputs. It's also wrong
for any byte that isn't ASCII '0'–'9', so the validation has to
happen elsewhere (length check, byte set check, or the protocol's
own framing).

**Don't ship this without a fuzz test.** A single byte outside the
range produces silent garbage.

## 4. Pre-allocated digit tables for very hot paths

The `strconv` source uses a 2-digit table. For maximally tight
encoders (databases, network proxies, observability pipelines), a
larger table helps:

```go
// digits100 indexes "00".."99" at offsets i*2 and i*2+1.
var digits100 = [...]byte{
    '0', '0', '0', '1', /* ... */ '9', '9',
}

func appendUint16(b []byte, x uint16) []byte {
    if x < 100 {
        if x < 10 { return append(b, byte('0'+x)) }
        return append(b, digits100[2*x], digits100[2*x+1])
    }
    if x < 10000 {
        hi := x / 100
        lo := x % 100
        return append(b,
            digits100[2*hi], digits100[2*hi+1],
            digits100[2*lo], digits100[2*lo+1],
        )
    }
    // 5 digit
    a := x / 10000
    rest := x % 10000
    hi := rest / 100
    lo := rest % 100
    return append(b,
        byte('0'+a),
        digits100[2*hi], digits100[2*hi+1],
        digits100[2*lo], digits100[2*lo+1],
    )
}
```

For 32-bit integers, a similar layout extends to 10 digits with
explicit branches. Benchmark against `strconv.AppendUint(b, uint64(x), 10)`
before adopting; the stdlib's 2-digit-at-a-time approach is already
extremely fast, and a custom version may not be worth the code.

## 5. Avoiding `Sprintf` in serialization paths

The dominant cost of `fmt.Sprintf("%d", x)` over `strconv.Itoa(x)`:

1. The format string `"%d"` is parsed at every call.
2. `x` is boxed into `interface{}` (2-word allocation).
3. A type switch in `fmt` dispatches to the int formatter.
4. The result string is allocated.

Steps 1–3 are entirely avoidable; only step 4 is essential.

Profile any service that prints a lot of numbers. The pattern in
pprof:

```
fmt.Sprintf  16.5%
fmt.Sprintln 11.2%
fmt.(*pp).doPrintf 28.0%
runtime.convT64 9.1%   ← boxing for interface{}
```

Replacement is mechanical:

| Before | After |
|--------|-------|
| `fmt.Sprintf("%d", x)` | `strconv.Itoa(x)` |
| `fmt.Sprintf("%x", x)` | `strconv.FormatInt(int64(x), 16)` |
| `fmt.Sprintf("%f", x)` | `strconv.FormatFloat(x, 'f', -1, 64)` |
| `fmt.Sprintf("%t", x)` | `strconv.FormatBool(x)` |
| `fmt.Sprintf("%q", x)` | `strconv.Quote(x)` |

For multi-argument formats, replace with `Builder` + `Append*`:

```go
// Before:
fmt.Sprintf("user/%d/items/%d", uid, iid)

// After:
b := make([]byte, 0, 32)
b = append(b, "user/"...)
b = strconv.AppendInt(b, int64(uid), 10)
b = append(b, "/items/"...)
b = strconv.AppendInt(b, int64(iid), 10)
return string(b)
```

Tedious to write; consider a generator or a code-review checklist.

## 6. Linter rules

For teams that have committed to high-throughput Go, the following
patterns merit a custom linter (or `staticcheck` configuration):

1. **`fmt.Sprintf("%d", ...)`** with a single integer argument →
   suggest `strconv.Itoa` / `FormatInt`.
2. **`fmt.Sprintf("%f", ...)`** with a single float argument →
   suggest `strconv.FormatFloat`.
3. **`strconv.Atoi(os.Getenv(...))`** without explicit error
   handling → flag as silent failure.
4. **`strconv.ParseInt(..., 64)`** followed by `int32(...)` cast →
   suggest `bitSize=32` directly.

`golangci-lint` plus a `forbidigo` ruleset covers most of these.
Anything beyond requires a custom analyzer (`golang.org/x/tools/go/analysis`).

## 7. Observability: counters for parse failures

In a service that parses many external inputs, instrument the
failures:

```go
var (
    parseAttempts = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "parse_attempts_total",
    }, []string{"field", "result"})
)

func parseInt(field, s string) (int64, error) {
    v, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        parseAttempts.WithLabelValues(field, "fail").Inc()
        return 0, fmt.Errorf("parse %s: %w", field, err)
    }
    parseAttempts.WithLabelValues(field, "ok").Inc()
    return v, nil
}
```

A spike in `field="user_id", result="fail"` is a leading indicator
of either a client bug or an attack. Without the metric, the failure
hides inside the generic `400 Bad Request` response.

## 8. Sanitizing inputs before parsing

Untrusted input may include:

- Leading/trailing whitespace.
- Different decimal separators (`,` vs `.`).
- Non-breaking spaces (U+00A0).
- Underscores (Go literal syntax, not stdlib).
- Currency symbols, units.

`strconv` accepts none of these. Sanitize first:

```go
func parseUserFloat(s string) (float64, error) {
    s = strings.TrimSpace(s)
    s = strings.ReplaceAll(s, ",", ".") // European decimal
    s = strings.ReplaceAll(s, "_", "")
    return strconv.ParseFloat(s, 64)
}
```

For internationalized parsing (locale-aware number formats), use
`golang.org/x/text/number` — `strconv` is locale-blind.

## 9. The `ParseInt` race with hostile input

```go
v, err := strconv.ParseInt(input, 10, 64)
```

This is safe — `ParseInt` is O(len(input)). But if `input` is
attacker-controlled and has no length limit (e.g., a JSON number
field), an attacker can submit 100 MB of digits.

Defenses:

1. **Length cap before parse**: `if len(input) > 20 { return ErrTooLarge }`.
   A 64-bit signed int is at most 19 digits plus a sign.
2. **`io.LimitReader`** on the HTTP body / file source.
3. **`json.Decoder.DisallowUnknownFields`** alone doesn't help —
   the number field is "known". You need a numeric size limit at
   the JSON-tokenization layer (or accept the cost).

## 10. Float comparison after parse

```go
f, _ := strconv.ParseFloat("0.1", 64)
if f == 0.1 { ... } // always true in Go (same constant folding)

// But:
f, _ := strconv.ParseFloat("0.1000000000000000055511", 64)
if f == 0.1 { ... } // also true (same bit pattern after rounding)
```

For monetary or scientific data, never compare floats with `==`.
Use a tolerance:

```go
if math.Abs(f-target) < 1e-9 { ... }
```

Better: don't use floats. `strconv.ParseInt` on cents, or a fixed-
point decimal library (`shopspring/decimal`), avoids the whole
class of bugs.

## 11. Production checklist for `strconv` usage

- [ ] All `Parse*` errors are checked or explicitly discarded with
  a comment.
- [ ] `bitSize` parameter matches the destination type (e.g., 32 for
  `int32`).
- [ ] `Sprintf` is not used for serialization of known types — use
  `Itoa`/`FormatFloat`/etc.
- [ ] `Append*` is used in hot loops; allocations are bounded by
  pooled buffer caps.
- [ ] Inputs are sanitized (trimmed, length-capped) before parsing
  if untrusted.
- [ ] Parse failures are observable (metrics, structured logs).
- [ ] Floats are not compared with `==` in business logic.
- [ ] For currency/IDs, integers are preferred over floats.

## 12. Real-world performance budget

For a service shipping 100k metric points per second, each with
five integer/float fields:

| Operation | Calls/sec | Time per call | Total CPU |
|-----------|-----------|---------------|-----------|
| `strconv.Itoa` | 500k | 30 ns | 15 ms |
| `strconv.AppendInt` (no alloc) | 500k | 12 ns | 6 ms |
| `fmt.Sprintf("%d", x)` | 500k | 180 ns | 90 ms |
| `json.Marshal(x)` | 500k | 400 ns | 200 ms |

For a service with a 1 CPU-second budget per second of wall time,
the difference between 6 ms and 90 ms is the difference between
"fits comfortably" and "needs another core". The savings from
moving to `Append*` are real.

## 13. References

- `strconv/itoa.go`, `strconv/atoi.go`, `strconv/ftoa.go`,
  `strconv/atof.go` — the algorithms.
- [Ulf Adams, "Ryū: fast float-to-string conversion"](https://dl.acm.org/doi/10.1145/3296979.3192369)
- [Daniel Lemire, "Number parsing at a gigabyte per second"](https://arxiv.org/abs/2101.11408) — Eisel-Lemire algorithm.
- [`../04-encoding-json/`](../04-encoding-json/index.md) for the
  encoder pipeline that uses these primitives.
- [`../19-strings-bytes/`](../19-strings-bytes/index.md) for the
  Builder/Append pairing.
