# 8.6 `bufio` — Find the Bug

Each section below is a short snippet with a real bug. Read it, find
the bug, then read the explanation. The exercises double as a tour of
the failure modes that bite production code.

For the foundational `io` bugs these build on, see
[../01-io-and-file-handling/find-bug.md](../01-io-and-file-handling/find-bug.md).

## 1. The forgotten flush

```go
func writeReport(path string, lines []string) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()

    bw := bufio.NewWriter(f)
    for _, line := range lines {
        if _, err := bw.WriteString(line + "\n"); err != nil {
            return err
        }
    }
    return nil
}
```

**Bug.** No `Flush`. Anything in the bufio buffer at the moment of
return is lost. For lines totalling under 4 KiB, the *entire* output
is lost. The deferred `f.Close()` runs after the function returns,
flushing kernel-side but not bufio-side.

**Fix.** Either call `bw.Flush()` explicitly before return, or
`defer bw.Flush()` *before* `defer f.Close()` so it runs first (LIFO).
Best version reports flush errors:

```go
defer func() {
    if cerr := bw.Flush(); err == nil { err = cerr }
}()
```

## 2. The defer-order swap

```go
func writeReport(path string, lines []string) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    bw := bufio.NewWriter(f)
    defer f.Close()
    defer bw.Flush() // !!
    for _, line := range lines {
        bw.WriteString(line + "\n")
    }
    return nil
}
```

**Bug.** `bw.Flush()` is declared *after* `f.Close()`, so it runs
first... wait, that's correct LIFO order. Look closer.

The actual bug: `f.Close()` was declared *before* `bw.Flush()`, so
LIFO runs `Flush` first, then `Close`. That part is correct.

But `bw.Flush()` errors are silently dropped, *and* `f.Close()` errors
are silently dropped, *and* the function returns nil even if a write
in the loop failed. The function is happy whether or not the data
made it.

**Fix.** Check errors:

```go
defer func() {
    if cerr := bw.Flush(); err == nil { err = cerr }
    if cerr := f.Close(); err == nil { err = cerr }
}()
for _, line := range lines {
    if _, err = bw.WriteString(line + "\n"); err != nil { return err }
}
```

## 3. The kept `Bytes()`

```go
func collect(r io.Reader) [][]byte {
    s := bufio.NewScanner(r)
    var out [][]byte
    for s.Scan() {
        out = append(out, s.Bytes())
    }
    return out
}
```

**Bug.** `s.Bytes()` returns a slice into the scanner's internal
buffer. The next `Scan` overwrites it. After the loop, every entry
in `out` points to the *last* line — or to garbage, depending on
exactly how the buffer was reused.

**Fix.** Copy:

```go
out = append(out, append([]byte(nil), s.Bytes()...))
```

Or use `s.Text()`, which returns a fresh `string` and is safe to
keep at the cost of one allocation per line.

## 4. The lost long line

```go
s := bufio.NewScanner(f)
for s.Scan() {
    process(s.Text())
}
if err := s.Err(); err != nil {
    return err
}
return nil
```

**Bug.** If any line exceeds 64 KiB (the default cap), `s.Err()`
returns `bufio.ErrTooLong` and the long line is *lost*. The function
returns the error; callers don't realise the input was partly skipped
before that.

**Fix.** Either raise the cap before scanning:

```go
s.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
```

Or switch to `bufio.Reader.ReadString('\n')` for unbounded line
lengths. Either way, decide explicitly what your line-length policy is.

## 5. The double-wrapped reader

```go
br := bufio.NewReader(f)
s := bufio.NewScanner(br)
for s.Scan() {
    fmt.Println(s.Text())
}
```

**Bug.** Not really a bug — `bufio.NewScanner(br)` works — but the
extra `bufio.Reader` is wasted work. `bufio.Scanner` already wraps
its input in a `bufio.Reader` internally. You're double-buffering.

**Fix.** `s := bufio.NewScanner(f)`. The scanner allocates its own
buffer; passing a pre-buffered reader doubles the memory and the
copy overhead.

## 6. The mixed scanner and reader

```go
br := bufio.NewReader(conn)
peek, _ := br.Peek(2)
// ... protocol detection ...

s := bufio.NewScanner(conn) // !!
for s.Scan() {
    handle(s.Text())
}
```

**Bug.** `s := bufio.NewScanner(conn)` creates a *separate* scanner
that reads from `conn` directly. It bypasses the bytes already
buffered in `br`. The first few bytes of the stream — including
whatever `Peek` saw — are silently consumed by `br` and never reach
`s`. The scanner sees the stream starting from byte 4097 (or
wherever `br` paused).

**Fix.** Pass `br` to the scanner: `s := bufio.NewScanner(br)`. Now
the buffered bytes are visible to the scanner.

## 7. The `Reset` without `Flush`

```go
var pool = sync.Pool{New: func() any { return bufio.NewWriter(nil) }}

func handle(c net.Conn) {
    bw := pool.Get().(*bufio.Writer)
    bw.Reset(c)
    defer pool.Put(bw)
    // ... writes ...
}
```

**Bug.** Two bugs.

1. The handler doesn't `Flush` before returning. Buffered bytes are
   lost.
2. The handler `Put`s a writer that may still hold buffered bytes (if
   the handler did flush, the pool is fine; if it didn't, the next
   borrower sees a writer with bytes belonging to the previous
   request — a cross-tenant data leak).

**Fix.**

```go
defer func() {
    bw.Flush()
    bw.Reset(nil) // drop reference to c
    pool.Put(bw)
}()
```

The `Reset(nil)` is the third bug, sort of: without it, the pooled
writer holds a reference to `c`, blocking GC.

## 8. The infinite split

```go
func splitNever(data []byte, atEOF bool) (int, []byte, error) {
    return 0, nil, nil
}

s := bufio.NewScanner(r)
s.Split(splitNever)
for s.Scan() { /* unreachable */ }
```

**Bug.** The split function never makes progress. At first, the
scanner reads from the source and asks again; eventually `atEOF ==
true` with `len(data) > 0`, and the scanner panics with a "scan
called after EOF" error or similar.

**Fix.** Yield trailing data at EOF:

```go
func splitWhole(data []byte, atEOF bool) (int, []byte, error) {
    if atEOF && len(data) > 0 {
        return len(data), data, nil
    }
    return 0, nil, nil
}
```

Now the scanner yields one token (the whole stream) and stops cleanly.

## 9. The aliased `ReadSlice`

```go
func parseTwo(br *bufio.Reader) (string, string, error) {
    a, err := br.ReadSlice('\n')
    if err != nil { return "", "", err }
    b, err := br.ReadSlice('\n')
    if err != nil { return "", "", err }
    return string(a), string(b), nil
}
```

**Bug.** `a` is a slice into `br`'s internal buffer. The second
`ReadSlice` invalidates it. By the time we do `string(a)`, `a` may
point to bytes belonging to record 2 (or to garbage if the buffer
shifted).

**Fix.** Convert to string immediately:

```go
a, err := br.ReadSlice('\n')
if err != nil { return "", "", err }
sa := string(a) // copies before the next read
b, err := br.ReadSlice('\n')
if err != nil { return "", "", err }
return sa, string(b), nil
```

Or use `ReadString('\n')` directly, which allocates per call.

## 10. The `Buffer` after `Scan`

```go
s := bufio.NewScanner(r)
if s.Scan() {
    handle(s.Bytes())
}
s.Buffer(make([]byte, 0, 1<<20), 1<<20) // !!
for s.Scan() {
    handle(s.Bytes())
}
```

**Bug.** `Buffer` must be called *before* the first `Scan`. Calling
it after panics with "Buffer called after Scan."

**Fix.** Decide on the buffer size up front:

```go
s := bufio.NewScanner(r)
s.Buffer(make([]byte, 0, 1<<20), 1<<20)
for s.Scan() {
    handle(s.Bytes())
}
```

## 11. The `Peek` overflow

```go
br := bufio.NewReader(conn) // 4096-byte default
header, err := br.Peek(8192)
if err != nil { return err }
parse(header)
```

**Bug.** `Peek(8192)` requests more than the buffer can hold. Returns
`bufio.ErrBufferFull` and only the first 4096 bytes. `parse(header)`
operates on truncated input.

**Fix.** Size the reader for your largest peek:

```go
br := bufio.NewReaderSize(conn, 16*1024)
header, err := br.Peek(8192)
```

## 12. The leftover bytes after `Scanner`

```go
s := bufio.NewScanner(conn)
for s.Scan() {
    if s.Text() == "DATA:" { break }
}
io.Copy(out, conn) // !!
```

**Bug.** After the scanner stops on `"DATA:"`, the next bytes of the
stream may still be buffered inside the scanner. `io.Copy(out, conn)`
reads from `conn` directly and starts wherever `conn`'s position is —
which is past whatever the scanner has buffered.

**Fix.** There's no clean way to extract bytes from a stopped
`Scanner`. The scanner doesn't expose its underlying buffer. The fix
is structural: don't use `Scanner` for the header, use
`bufio.Reader.ReadString('\n')`, then continue with the same
`bufio.Reader`:

```go
br := bufio.NewReader(conn)
for {
    line, err := br.ReadString('\n')
    if err != nil { return err }
    if strings.TrimSpace(line) == "DATA:" { break }
}
io.Copy(out, br) // br knows about the buffered body bytes
```

## 13. The race on `bufio.Writer`

```go
bw := bufio.NewWriter(f)
go func() {
    for line := range ch1 {
        bw.WriteString(line)
    }
}()
go func() {
    for line := range ch2 {
        bw.WriteString(line)
    }
}()
```

**Bug.** Two goroutines writing to the same `bufio.Writer`. Race
on the buffer indices. Output is interleaved at sub-line granularity
and the race detector complains.

**Fix.** Either serialise via a mutex around `bw.WriteString`, or
have one goroutine own the writer and accept lines from both
channels:

```go
go func() {
    for {
        select {
        case line := <-ch1:
            bw.WriteString(line)
        case line := <-ch2:
            bw.WriteString(line)
        }
    }
}()
```

## 14. The `WriteByte` in a hot loop

```go
bw := bufio.NewWriter(f)
for _, b := range data {
    bw.WriteByte(b) // ignored error
}
bw.Flush()
```

**Bug.** Errors from `WriteByte` are ignored. If the underlying
writer fails partway, the loop keeps calling `WriteByte` on a
poisoned `bufio.Writer`, every call returning the same sticky error
that nobody checks. The final `Flush` returns an error too, but the
loop has already wasted CPU on doomed writes.

**Fix.** Check the error:

```go
for _, b := range data {
    if err := bw.WriteByte(b); err != nil { return err }
}
return bw.Flush()
```

Or, much faster: skip the per-byte loop entirely and write a slice:
`bw.Write(data)`. Same buffering effect, far less per-call overhead.

## 15. The split with negative advance

```go
func evilSplit(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.IndexByte(data, '\n'); i >= 0 {
        return i - 1, data[:i], nil // !!
    }
    return 0, nil, nil
}
```

**Bug.** `i - 1` can be `-1` if `data[0] == '\n'`. The scanner
returns `bufio.ErrNegativeAdvance` and stops.

**Fix.** Always advance non-negatively:

```go
return i + 1, data[:i], nil
```

(One past the newline, since we consume the newline as part of the
record framing.)

## 16. The forgotten gzip close

```go
f, _ := os.Create("out.gz")
defer f.Close()
bw := bufio.NewWriter(f)
defer bw.Flush()
gz := gzip.NewWriter(bw)
// no defer gz.Close() !!
gz.Write(payload)
```

**Bug.** `gzip.Writer.Close` writes the gzip trailer (CRC32, length).
Without it, the file is unreadable by `gunzip` — "unexpected end of
stream." `bw.Flush` and `f.Close` flush all the bytes that gz
*emitted*, but gz hasn't emitted the trailer yet.

**Fix.**

```go
defer func() {
    gz.Close()    // first: writes trailer to bw
    bw.Flush()    // second: pushes everything to f
    f.Close()     // third: finalises file
}()
```

Note: declared in this order (gz first, file last), the LIFO behaviour
runs file-close last — the correct sequence.

## 17. The `Discard` of EOF

```go
br := bufio.NewReader(r)
n, err := br.Discard(1 << 30) // 1 GiB
if err != nil {
    return err
}
fmt.Println("discarded:", n)
```

**Bug.** Treating `err != nil` as an unconditional failure. `Discard`
on a stream shorter than the requested amount returns `(actual,
io.EOF)`. That's not a failure — it's "I discarded everything
available."

**Fix.** Distinguish:

```go
n, err := br.Discard(1 << 30)
if err != nil && !errors.Is(err, io.EOF) {
    return err
}
fmt.Println("discarded:", n)
```

## 18. The shared scanner across requests

```go
var s = bufio.NewScanner(os.Stdin)

func readLine() string {
    if s.Scan() { return s.Text() }
    return ""
}

// Called from many goroutines
go readLine()
go readLine()
```

**Bug.** `bufio.Scanner` is not safe for concurrent use. Two goroutines
calling `Scan` simultaneously race on the buffer indices, the error
field, and the slice returned by `Bytes`. The race detector fires
immediately.

**Fix.** Either serialise access (mutex around `readLine`), or have
one goroutine own the scanner and dispatch lines to others via a
channel.

## 19. The `Scanner.Buffer` argument confusion

```go
s := bufio.NewScanner(r)
buf := make([]byte, 1<<20)
s.Buffer(buf, 1<<20)
```

**Bug.** `make([]byte, 1<<20)` creates a slice with `len == 1<<20`.
`Scanner.Buffer` expects a slice whose `cap` is the initial buffer
size; the `len` is ignored *but* the scanner overwrites `buf[0:cap]`
without zeroing first, so any "data" you put in `buf` is hidden in
the buffer until overwritten by reads. Not catastrophic, but
suspicious.

**Fix.**

```go
buf := make([]byte, 0, 1<<20) // len 0, cap 1<<20
s.Buffer(buf, 1<<20)
```

## 20. The post-error scanner reuse

```go
s := bufio.NewScanner(r)
for s.Scan() {
    if !validate(s.Text()) {
        return errors.New("bad")
    }
}
if err := s.Err(); err != nil { return err }

// Later, reusing s for a different stream:
s = ??? // !!
```

**Bug.** `bufio.Scanner` has no `Reset`. You can't reuse a scanner
for a new source. Once `Scan` returns false, the scanner is done.

**Fix.** Construct a new `Scanner`:

```go
s = bufio.NewScanner(newSource)
```

If you need to pool the underlying buffer, you need to manage the
buffer outside the scanner — pass it to `Scanner.Buffer` and reuse
the buffer across new `Scanner` instances. The struct itself is small
and not worth pooling.

## 21. The `Available` math

```go
bw := bufio.NewWriter(f)
n := bw.Available()
buf := bw.AvailableBuffer()
buf = append(buf, payload...)
if len(buf) > n {
    bw.Flush()
}
bw.Write(buf)
```

**Bug.** Once `append` grew `buf` past the writer's capacity, the
underlying array reallocated and `buf` is no longer the writer's
internal buffer. `Write(buf)` is now a normal copy, not the in-place
optimisation. That's *correct* behaviour, just not the fast path —
but the surprise is the `Flush` call after the fact, which flushes
nothing useful (the buffer was full of stale capacity).

**Fix.** Pre-flush if the payload exceeds available space, then
re-grab `AvailableBuffer`:

```go
if len(payload) > bw.Available() {
    bw.Flush()
}
if len(payload) <= bw.Available() {
    buf := bw.AvailableBuffer()
    buf = append(buf, payload...)
    bw.Write(buf)
} else {
    bw.Write(payload) // payload bigger than buffer; bypass
}
```

## 22. The deferred `Flush` after panic

```go
func handle(r io.Reader, w io.Writer) {
    bw := bufio.NewWriter(w)
    defer bw.Flush()
    process(bw, r) // may panic
}
```

**Bug.** Sort of correct: deferred `Flush` runs even on panic. But
its error is silently dropped, and the panic continues to propagate.
For audit logs, the buffered bytes either reach the underlying writer
(good) or fail silently (bad — you don't know which buffered events
were on the wire).

**Fix.** If you care about which buffered bytes made it during a
panic, log the flush outcome:

```go
defer func() {
    if ferr := bw.Flush(); ferr != nil {
        log.Printf("flush after panic failed: %v", ferr)
    }
}()
```

## 23. The shared `Buffered` read

```go
var bw *bufio.Writer

go func() {
    for {
        time.Sleep(time.Second)
        log.Println("pending:", bw.Buffered()) // !!
    }
}()

go func() {
    for line := range ch {
        bw.WriteString(line)
    }
}()
```

**Bug.** `Buffered()` reads internal state. Concurrent with `Write`,
it's a race. The race detector fires.

**Fix.** Serialise access via a mutex, or expose the count via an
atomic written by the owning goroutine:

```go
var pending atomic.Int64

func write(s string) {
    bw.WriteString(s)
    pending.Store(int64(bw.Buffered()))
}
```

`Pending() = pending.Load()` is now safe to call from any goroutine.

## 24. The split that never advances at EOF

```go
func splitDouble(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.Index(data, []byte("--")); i >= 0 {
        return i + 2, data[:i], nil
    }
    return 0, nil, nil
}
```

**Bug.** Stream ending without `"--"` panics the scanner: `atEOF` is
true, `len(data) > 0`, and the function returns `(0, nil, nil)` —
"need more data" — which is impossible at EOF.

**Fix.** Handle EOF explicitly:

```go
if atEOF {
    if len(data) > 0 { return len(data), data, nil }
    return 0, nil, nil
}
return 0, nil, nil
```

Or return `io.ErrUnexpectedEOF` if a trailing partial record is an
error condition for your protocol.

## 25. The over-eager `Discard`

```go
br := bufio.NewReader(conn)
peek, _ := br.Peek(4)
br.Discard(4) // !!
parse(peek)   // !!
```

**Bug.** `peek` is a slice into the bufio buffer. `Discard(4)`
advances past those bytes — and the next read may overwrite them.
`parse(peek)` is now operating on bytes that the bufio reader has
already moved past. With small further activity on the reader, those
bytes are still there; with a full buffer fill, they're stomped.

**Fix.** Copy before discarding:

```go
peek, _ := br.Peek(4)
header := append([]byte(nil), peek...)
br.Discard(4)
parse(header)
```

Or process the bytes *before* the next read:

```go
peek, _ := br.Peek(4)
parse(peek)        // safe; nothing else has happened yet
br.Discard(4)
```

## What to read next

- [tasks.md](tasks.md) — exercises that practice each pattern.
- [optimize.md](optimize.md) — the performance angle.
- [senior.md](senior.md) — the contracts that explain *why* each bug
  above is a bug.
