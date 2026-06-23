# 8.20 `strconv` — Find the Bug

> Twelve buggy snippets. Each compiles. Each looks reasonable. Each
> is wrong. Find the bug, explain it in one paragraph, then write
> the fix.

## Bug 1 — Silent zero

```go
func main() {
    port, _ := strconv.Atoi(os.Getenv("PORT"))
    log.Printf("listening on :%d", port)
    http.ListenAndServe(fmt.Sprintf(":%d", port), nil)
}
```

**What happens?**

If `PORT` is unset, malformed, or set to `"0"`, the service silently
binds to a random port. The error is discarded.

**Why?**

Three failure modes (unset, malformed, deliberate zero) all produce
the same observable result. Ops cannot distinguish a config bug from
a deliberate `:0`.

**Fix.**

```go
portStr := os.Getenv("PORT")
if portStr == "" {
    portStr = "8080" // default
}
port, err := strconv.Atoi(portStr)
if err != nil {
    log.Fatalf("invalid PORT %q: %v", portStr, err)
}
```

## Bug 2 — Wrong `bitSize`

```go
v, _ := strconv.ParseInt(s, 10, 64)
i := int32(v)
fmt.Println(i)
```

**What happens?**

For `s = "3000000000"`, `v` is `3_000_000_000`. The cast to `int32`
wraps to `-1_294_967_296`. No error is raised.

**Why?**

`bitSize=64` accepts the value as an `int64`. The cast silently
truncates.

**Fix.**

Match `bitSize` to the destination type:

```go
v, err := strconv.ParseInt(s, 10, 32)
if err != nil { return err }
i := int32(v)
```

`ParseInt` now returns `ErrRange` for values outside `int32`.

## Bug 3 — `%d` for a float

```go
profit := 1.5
s := fmt.Sprintf("%d", profit)
fmt.Println(s)
```

**What happens?**

Prints `"%!d(float64=1.5)"` — `fmt`'s "wrong verb for type" marker.

**Why?**

`%d` expects an integer. `fmt` does no implicit conversion.

**Fix.**

If you want truncation:

```go
s := strconv.Itoa(int(profit))
```

If you want full float:

```go
s := strconv.FormatFloat(profit, 'g', -1, 64)
```

## Bug 4 — `FormatFloat` precision loss

```go
amount := 0.1 + 0.2
s := strconv.FormatFloat(amount, 'f', 2, 64)
// s == "0.30"

parsed, _ := strconv.ParseFloat(s, 64)
fmt.Println(parsed == 0.3) // ???
```

**What happens?**

`parsed == 0.3` is `true` here, but only because both `0.3` and `0.30`
parse to the same bit pattern. The bug surfaces if the user compares
`parsed` against a different value:

```go
fmt.Println(parsed == amount) // false
```

`amount` is `0.30000000000000004`; `parsed` is `0.3`. The
`FormatFloat` truncation lost precision.

**Why?**

`prec=2` discards bits beyond two decimal places.

**Fix.**

For round-trippable output, use `prec=-1`:

```go
s := strconv.FormatFloat(amount, 'g', -1, 64)
```

If two decimals is a display requirement, format for display but
keep the original value for computation.

## Bug 5 — `ParseBool` rejects English words

```go
verbose, _ := strconv.ParseBool(r.URL.Query().Get("verbose"))
if verbose { /* ... */ }
```

**What happens?**

For `?verbose=yes`, `verbose` is `false`. For `?verbose=true`, it's
`true`. Users find this inconsistent.

**Why?**

`strconv.ParseBool` accepts `"1"`, `"t"`, `"true"`, `"True"`,
`"TRUE"` (and false equivalents). It does not accept `"yes"`,
`"on"`, `"y"`, or any non-Go-literal form.

**Fix.**

Write a custom helper:

```go
func parseLooseBool(s string) bool {
    switch strings.ToLower(s) {
    case "1", "t", "true", "yes", "y", "on":
        return true
    }
    return false
}
```

## Bug 6 — `Atoi` on a UUID

```go
id := r.URL.Query().Get("id")
n, _ := strconv.Atoi(id)
if n > 0 { /* ... */ }
```

**What happens?**

For `id = "550e8400-e29b-41d4-a716-446655440000"`, `n = 0` and the
condition fails. The error is discarded, so the caller sees the
silent failure.

**Why?**

UUIDs are not integers. `Atoi` rejects the `-` and the hex digits.

**Fix.**

Validate the type first:

```go
id := r.URL.Query().Get("id")
if _, err := uuid.Parse(id); err != nil {
    http.Error(w, "invalid id", 400)
    return
}
```

Or, if the field is actually numeric, fix the upstream code that
produces UUIDs.

## Bug 7 — Hex parsing without prefix

```go
addr, _ := strconv.ParseUint(s, 16, 64)
```

**What happens?**

For `s = "0xDEADBEEF"`, `addr` is `0` with an error.

**Why?**

`ParseUint(s, 16, 64)` expects pure hex digits — no `0x` prefix.
The prefix is only accepted when `base == 0`.

**Fix.**

Either strip the prefix or use `base=0`:

```go
addr, err := strconv.ParseUint(s, 0, 64) // auto-detect prefix
```

## Bug 8 — `Itoa` in a hot loop

```go
func emit(values []int) string {
    var s string
    for _, v := range values {
        s += strconv.Itoa(v) + ","
    }
    return s
}
```

**What happens?**

For a million values, this allocates a million strings, then concats
them with `+`, producing O(N²) work.

**Why?**

Each `+` allocates. Each `Itoa` allocates. The concatenation grows
the string repeatedly.

**Fix.**

```go
func emit(values []int) string {
    var b strings.Builder
    b.Grow(len(values) * 6)
    for _, v := range values {
        b.Write(strconv.AppendInt(nil, int64(v), 10))
        b.WriteByte(',')
    }
    return b.String()
}
```

Better: append directly into the builder:

```go
buf := make([]byte, 0, 16)
for _, v := range values {
    buf = strconv.AppendInt(buf[:0], int64(v), 10)
    b.Write(buf)
    b.WriteByte(',')
}
```

## Bug 9 — `ParseFloat` on a financial value

```go
balance, _ := strconv.ParseFloat(s, 64)
balance += deposit
if balance > limit { /* ... */ }
```

**What happens?**

For `s = "0.1"` and `deposit = 0.2`, `balance` is
`0.30000000000000004`. Comparisons against `0.3` fail.

**Why?**

`float64` can't represent `0.1` or `0.2` exactly. Sums accumulate
rounding error.

**Fix.**

Use integer cents (or a fixed-point decimal library):

```go
balanceCents, _ := strconv.ParseInt(s, 10, 64) // input is "10" for $0.10
balanceCents += depositCents
if balanceCents > limitCents { /* ... */ }
```

For arbitrary precision, use `github.com/shopspring/decimal`.

## Bug 10 — `FormatFloat` for a database column

```go
v := record.Price
sql := fmt.Sprintf("UPDATE products SET price = %s WHERE id = %d",
    strconv.FormatFloat(v, 'f', -1, 64), record.ID)
```

**What happens?**

For `v = math.Inf(1)`, `FormatFloat` produces `"+Inf"`. The SQL
query becomes `... SET price = +Inf WHERE ...` which fails to
parse on most databases. The error message blames the database
parser, not the Go code.

**Why?**

Special float values have valid Go representations but invalid SQL
ones.

**Fix.**

Validate before serializing:

```go
if math.IsInf(v, 0) || math.IsNaN(v) {
    return errors.New("price must be finite")
}
```

Plus: never use `fmt.Sprintf` to build SQL. Use parameterized
queries. The two bugs combine to make this snippet a SQL-injection
risk.

## Bug 11 — `Quote` confused with JSON

```go
js := `{"name":` + strconv.Quote(user.Name) + `}`
http.ResponseWriter.Write([]byte(js))
```

**What happens?**

For most inputs, the output is valid JSON. For inputs containing
`\xNN` escapes, the output is invalid JSON — `\x80` is a valid Go
escape but not valid JSON.

**Why?**

`strconv.Quote` uses Go syntax. JSON has overlapping but distinct
escape rules.

**Fix.**

Use `encoding/json`:

```go
js, _ := json.Marshal(struct{ Name string }{user.Name})
http.ResponseWriter.Write(js)
```

## Bug 12 — Unchecked `ParseUint` for sequence numbers

```go
seq, _ := strconv.ParseUint(line[:8], 16, 64)
// process seq
```

**What happens?**

If `line` is less than 8 bytes long, the slice panics with index
out of range. If `line[:8]` contains non-hex, the error is
discarded and `seq` is 0.

**Why?**

No length check on `line`; no error check on `ParseUint`.

**Fix.**

```go
if len(line) < 8 {
    return errInvalidLine
}
seq, err := strconv.ParseUint(line[:8], 16, 64)
if err != nil {
    return fmt.Errorf("invalid seq %q: %w", line[:8], err)
}
```

## Bonus — The `string(rune)` confusion

```go
r := '4'
n, _ := strconv.Atoi(string(r))
// n is now 4
```

This is technically correct (the rune `'4'` is U+0034, which when
encoded as UTF-8 is the ASCII byte `0x34`, parsed as the digit 4).
But it's the wrong tool. The clear version:

```go
n := int(r - '0')
```

Don't use `Atoi` for single-digit rune-to-int conversion. The
arithmetic version is obvious and 10× faster.
