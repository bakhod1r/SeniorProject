# 8.6 `bufio` — Optimize

Tuning `bufio` for performance. Each section below has a concrete
benchmark, an observation, and a guideline. Run the benchmarks
yourself — the numbers depend on your hardware, your kernel, and the
phase of the moon.

For the wider context (when *not* to use `bufio`, when `io.Copy` is
already the right answer), see
[../01-io-and-file-handling/optimize.md](../01-io-and-file-handling/optimize.md).

## 1. The buffer-size ladder

The default 4 KiB matches a typical disk page. For sequential reads
of a large file, larger buffers reduce syscall count proportionally.

Benchmark template:

```go
func BenchmarkRead4KiB(b *testing.B)  { benchRead(b, 4*1024) }
func BenchmarkRead16KiB(b *testing.B) { benchRead(b, 16*1024) }
func BenchmarkRead64KiB(b *testing.B) { benchRead(b, 64*1024) }
func BenchmarkRead1MiB(b *testing.B)  { benchRead(b, 1024*1024) }

func benchRead(b *testing.B, size int) {
    f, _ := os.Open("/path/to/100MB-file")
    defer f.Close()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        f.Seek(0, 0)
        br := bufio.NewReaderSize(f, size)
        io.Copy(io.Discard, br)
    }
}
```

Typical results on Linux ext4 with NVMe SSD:

| Size | ns/op | syscalls/op |
|------|-------|-------------|
| 4 KiB | ~70ms | ~25,000 |
| 16 KiB | ~30ms | ~6,400 |
| 64 KiB | ~14ms | ~1,600 |
| 1 MiB | ~10ms | ~100 |

Diminishing returns above 64 KiB. The sweet spot for sequential file
reads is 64 KiB to 256 KiB. For random-access patterns, smaller
buffers are better (less wasted read-ahead).

For network reads, the picture differs: TCP packets are typically
1500 bytes, and the kernel coalesces. 4-16 KiB is fine; larger doesn't
help because the data isn't there yet.

## 2. `Read` bypass for large reads

`bufio.Reader.Read(p)` bypasses the buffer when `len(p) >=
bufferSize`. The fast path is identical to calling `f.Read(p)`
directly — bufio adds zero overhead for large reads.

Practical implication: if your code mixes line-oriented reads
(through `Scanner` or `ReadString`) with bulk reads (`io.Copy`), the
bulk path doesn't pay for the buffering. You don't have to choose.

```go
br := bufio.NewReaderSize(f, 64*1024)
// header parsing, line by line
for {
    line, _ := br.ReadString('\n')
    if line == "\r\n" { break }
}
// body, bulk
io.Copy(out, br) // br.WriteTo: drains buffered, then bypasses
```

Both phases are fast.

## 3. `Scanner.Bytes` vs `Text` allocations

`Bytes()` returns a borrowed slice. `Text()` returns a fresh string.
For a 1M-line input:

| Path | ns/op | bytes/op | allocs/op |
|------|-------|----------|-----------|
| `Bytes()` only | 80M | 0 | 0 |
| `Text()` only | 130M | 50M | 1M |
| `Bytes() + copy when needed` | varies | depends | depends |

Use `Bytes()` for line-by-line processing where you don't keep the
bytes. Use `Text()` when the simpler API is worth the per-line
allocation. For 100 K-line scans, the allocation cost is negligible.
For 100 M-line scans, it dominates.

## 4. `AvailableBuffer` for numeric output

The classic case: dumping integers to a writer.

```go
// Slow: allocates a string per integer, copies into bw's buffer
for _, n := range nums {
    bw.WriteString(strconv.Itoa(n) + "\n")
}

// Faster: appends directly into bw's buffer
for _, n := range nums {
    buf := bw.AvailableBuffer()
    buf = strconv.AppendInt(buf, int64(n), 10)
    buf = append(buf, '\n')
    bw.Write(buf)
}
```

Benchmark for 1M integers:

| Path | ns/op | bytes/op | allocs/op |
|------|-------|----------|-----------|
| `WriteString + Itoa + concat` | 60M | 50M | 2M |
| `AvailableBuffer + AppendInt` | 18M | 0 | 0 |

3x faster, zero allocations. The Go stdlib uses similar tricks in
`fmt`'s buffered output.

The trick works for any "build a small record then write" loop.
Build the record into `AvailableBuffer`'s slice, pass to `Write`,
forget the slice.

## 5. Choosing `Buffer` cap for `Scanner`

Two competing pressures:

- Cap too low → `ErrTooLong` and silent token loss.
- Cap too high → big allocations, big resident memory per scanner.

Benchmark scanning a file with 10K-byte average lines and one
occasional 1MB line:

| Initial / max | ns/op | mem | Lost tokens? |
|---------------|-------|-----|--------------|
| 64K / 64K | fast | 64K | yes (the 1MB line) |
| 64K / 4M | similar | 1M peak | no |
| 4M / 4M | similar | 4M peak | no |
| 64K / 1G | similar | up to 1G | no, but exposed to OOM |

Pick the *initial* close to the typical line size, the *max* close to
the worst-case legitimate line size. Don't pick "infinity" (no
explicit cap) for hostile inputs — that's an OOM vector.

## 6. Pooling cost vs per-request allocation

For a server handling many short requests, the per-request alloc cost
of `bufio.NewReader` matters:

```go
// Per-request alloc
br := bufio.NewReader(c)  // ~4 KiB allocated per request

// Pool
br := pool.Get().(*bufio.Reader)
br.Reset(c)
defer func() { br.Reset(nil); pool.Put(br) }()
```

Benchmark for 1M synthetic requests:

| Path | ns/op | bytes/op | allocs/op |
|------|-------|----------|-----------|
| Per-request alloc | 1.2M | 4M | 1M |
| Pool with `Reset` | 200K | 0 | 0 |

6x faster. The pool wins decisively when the alloc count is high.
For services that handle a few requests per second, the difference
doesn't matter. Profile before optimising.

## 7. `ReadFrom` short-circuit measurement

`io.Copy(bw, r)` invokes `bw.ReadFrom(r)` if `bw` is a
`*bufio.Writer`. The implementation drains the buffer once, then
writes large chunks directly through the underlying writer. For a
1 GiB file copy:

| Path | wall time | syscalls |
|------|-----------|----------|
| `io.Copy(bw, r)` (uses `ReadFrom`) | ~1.4 s | ~16K |
| Manual `for { r.Read; bw.Write }` with 4K buf | ~3.0 s | ~250K |
| Manual loop with 64K buf | ~1.5 s | ~16K |

`io.Copy` is the right call. It picks up the fast path and matches a
hand-rolled loop with a tuned buffer.

## 8. `WriteTo` short-circuit on `bufio.Reader`

Symmetric: `io.Copy(w, br)` invokes `br.WriteTo(w)`, draining the
buffered bytes first then bypassing.

| Path | wall time |
|------|-----------|
| `io.Copy(w, br)` (uses `WriteTo`) | ~1.4 s |
| `for { br.Read; w.Write }` | ~2.0 s |

Same conclusion: prefer `io.Copy`.

## 9. Custom `SplitFunc` allocation cost

A naïve split function allocates per token if it returns a slice that
escapes the scanner's buffer:

```go
// BAD: allocates
func splitCopy(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.IndexByte(data, '\n'); i >= 0 {
        return i + 1, append([]byte(nil), data[:i]...), nil // !!
    }
    return 0, nil, nil
}

// GOOD: returns a slice into data; scanner copies on demand
func splitFast(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.IndexByte(data, '\n'); i >= 0 {
        return i + 1, data[:i], nil
    }
    return 0, nil, nil
}
```

For 1M lines:

| Split | ns/op | bytes/op | allocs/op |
|-------|-------|----------|-----------|
| `splitCopy` | 100M | 50M | 1M |
| `splitFast` | 60M | 0 | 0 |

Always return a slice into `data`. The scanner manages the buffer
lifecycle for you; copying inside the splitter is wasted work.

## 10. `Discard` vs throwaway buffer

```go
// Slow: copies into a buffer
buf := make([]byte, 64*1024)
io.CopyN(io.Discard, br, 1<<20)

// Fast: doesn't copy
br.Discard(1 << 20)
```

`Discard` advances the position cursor without copying. For a 1 MiB
skip, it's roughly 4x faster than `io.CopyN(io.Discard, br, 1<<20)`
on the same bufio reader.

When skipping known-uninteresting data (HTTP headers you don't need,
padding, alignment), `Discard` is the right call.

## 11. Word scanning on a large corpus

`bufio.ScanWords` walks the buffer one rune at a time, calling
`utf8.DecodeRune` for each. For ASCII-heavy input, this is more work
than necessary:

```go
// Fast ASCII-only words
func splitASCIIWords(data []byte, atEOF bool) (int, []byte, error) {
    start := 0
    for start < len(data) && asciiSpace[data[start]] == 1 {
        start++
    }
    if start == len(data) { return start, nil, nil }
    for end := start; end < len(data); end++ {
        if asciiSpace[data[end]] == 1 {
            return end, data[start:end], nil
        }
    }
    if atEOF { return len(data), data[start:], nil }
    return start, nil, nil
}

var asciiSpace = [256]uint8{'\t': 1, '\n': 1, '\v': 1, '\f': 1, '\r': 1, ' ': 1}
```

For an English-language corpus, this is roughly 2x faster than
`bufio.ScanWords` because it skips the UTF-8 decode. Don't use it
for arbitrary Unicode input — it treats `\xC2\xA0` (non-breaking
space) and other Unicode spaces as ordinary bytes.

## 12. `Peek` size vs throughput

For protocol detection, `Peek(N)` reads enough bytes to inspect.
Larger `N` means more buffered data — sometimes useful, sometimes
wasted. For an HTTP connection sniff:

```go
peek, err := br.Peek(8) // GET /, HTTP, etc.
```

8 bytes is enough to distinguish HTTP/1, HTTP/2 prefaces, and most
binary protocols. `Peek(64)` adds nothing useful in this case but
forces the bufio reader to fill more of its buffer up front.

For latency-sensitive servers, peek the smallest amount that lets you
decide. You're not paying for the bytes after `Peek` — they're still
buffered for the protocol parser — but you may force an extra
underlying `Read` if the peek size exceeds what's already buffered.

## 13. `bufio.NewWriterSize` on a slow sink

If your underlying writer is slow (network, encrypted, compressed),
the buffered writer's size is the batching unit. Larger buffer = more
batching = fewer underlying writes = better throughput.

For an HTTPS upload to a remote server (50 ms RTT, modest bandwidth):

| Buffer | Throughput |
|--------|-----------|
| 4 KiB | ~1 MiB/s |
| 64 KiB | ~10 MiB/s |
| 1 MiB | ~50 MiB/s |

The 1 MiB buffer batches enough that bandwidth-delay product is
filled; smaller buffers waste round trips. The downside: 1 MiB of
in-process state per connection.

For a server with 10 K connections, that's 10 GiB. Pick a buffer size
informed by `connection_count * buffer_size <= memory_budget`.

## 14. `O_APPEND` and small `bufio.Writer`

For multi-process append-style logging (typical in containers writing
to a shared log file), the `bufio.Writer.Size()` should be at or below
`PIPE_BUF` (4 KiB on Linux). Larger buffers cause `write(2)` to split
the buffer into multiple syscalls, each subject to interleaving with
other writers.

Concretely:

```go
f, _ := os.OpenFile("/var/log/app.log",
    os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
bw := bufio.NewWriterSize(f, 4096) // not larger
```

Or skip bufio entirely and write per-record:

```go
f.Write([]byte(line + "\n")) // one syscall, atomic if line < PIPE_BUF
```

The latter trades throughput for simplicity. For high-throughput
single-process logging, prefer a writer goroutine that owns a large
bufio writer and flushes periodically.

## 15. Latency vs throughput in `bufio.Writer`

A bufio writer with a large buffer optimises throughput at the cost
of latency. The first byte written sits in the buffer until either
the buffer fills or `Flush` is called. For request/response protocols
where a small response should reach the client immediately, large
buffers hurt.

Two strategies:

- Per-request `Flush` after writing the response.
- Small buffer (or no bufio at all) for response writing.

`net/http` does the former: it `Flush`es after writing the response
body for HTTP/1, and the buffer fills naturally before that point.

## 16. The cost of `Reset`

`bufio.Reader.Reset` and `bufio.Writer.Reset` are O(1): they don't
zero the buffer, don't allocate, just update internal state. Cheap.

Practical implication: pool aggressively for short-lived
`bufio.Reader`/`Writer` use. The `Reset` call is free; the
allocation it avoids is what you save.

## 17. Reading exactly N bytes through `bufio.Reader`

For protocols where you need to read N bytes (no delimiter), use
`io.ReadFull`:

```go
buf := make([]byte, n)
if _, err := io.ReadFull(br, buf); err != nil { return err }
```

`io.ReadFull` retries short reads until it has `n` bytes or an error.
It's the right primitive for fixed-length records.

For very large `n`, the `bufio` buffer doesn't help: `Read` bypasses
when `len(p) >= bufferSize`. The cost is the same as reading from
`f` directly.

For very small `n`, `bufio` shines: many small `Read` calls amortise
into one underlying `Read`.

## 18. Alternative for unbounded line reading

If your lines can be arbitrarily large but you don't want to set a
per-scan cap:

```go
// Allocates a fresh buffer per line; no cap.
br := bufio.NewReader(r)
for {
    line, err := br.ReadBytes('\n')
    if err != nil {
        if err == io.EOF && len(line) > 0 { process(line); break }
        if err == io.EOF { break }
        return err
    }
    process(line)
}
```

`ReadBytes` allocates per call. For a million lines, that's a million
allocations. Compare to `Scanner` with `Bytes()` (zero allocations)
plus a copy when needed (one per kept line). For inputs where you
keep most lines, `ReadBytes` is simpler; for streams where you process
and forget, `Scanner` is faster.

## 19. The 4 KiB sweet spot

For most file-and-network code, the default 4 KiB buffer is fine.
Optimisation work should focus on:

1. Avoid per-allocation calls to `Text()` when `Bytes()` is enough.
2. Pool bufio values for short connections.
3. Use `AvailableBuffer` for hot numeric output.
4. Use `Scanner.Buffer` to raise the cap when records exceed 64 KiB.
5. Bypass bufio for large bulk transfers (`io.Copy` already does).

The buffer size is rarely the bottleneck; the layer above bufio
usually is. Profile before tuning.

## 20. What to read next

- [find-bug.md](find-bug.md) — bugs that show up when you tune
  aggressively.
- [professional.md](professional.md) — production-scale concerns.
- [senior.md](senior.md) — the contracts you must respect even under
  optimisation pressure.
- The Go runtime profiling tools: `go test -cpuprofile`, `pprof`,
  `trace`. Optimise from data, not intuition.
