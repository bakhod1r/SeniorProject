# 8.6 `bufio` — Interview

Questions interviewers actually ask about `bufio`, with the answers
that signal you've done the work. Each one short; each one specific.

For the foundations these build on, see
[../01-io-and-file-handling/interview.md](../01-io-and-file-handling/interview.md).

## 1. Why does `bufio` exist?

To amortise syscalls. A raw `(*os.File).Read` is one `read(2)` per
call. A `bufio.Reader.ReadByte` may serve thousands of calls from one
underlying syscall. Same on the write side — small writes batched into
4 KiB chunks before they hit the kernel.

## 2. What's the default buffer size?

4096 bytes for both `bufio.Reader` and `bufio.Writer`. Configurable via
`NewReaderSize` / `NewWriterSize`. The minimum is silently bumped to
16 — smaller is rejected.

## 3. What is `bufio.MaxScanTokenSize`?

65536 (64 KiB). The default cap on a `Scanner` token. A line longer
than that fails with `bufio.ErrTooLong` and the long line is *lost* —
the scanner advances past it. Use `Scanner.Buffer(buf, max)` to raise
the cap before the first `Scan`.

## 4. Why is `bufio.Writer.Flush` important?

Bytes you `Write` to a `bufio.Writer` sit in its internal buffer until
the buffer fills or you call `Flush`. If your program exits or the
underlying writer closes before `Flush`, those bytes are lost. The
typical pattern: `defer bw.Flush()` declared *before* `defer
f.Close()`, so flush runs first (LIFO).

## 5. What does `Scanner.Bytes()` return that `Text()` doesn't?

`Bytes()` returns a slice into the scanner's internal buffer — zero
allocation, but invalidated by the next `Scan()`. `Text()` returns a
freshly allocated `string` — safe to keep, costs one allocation. Use
`Bytes()` in hot loops with `append([]byte(nil), s.Bytes()...)` only
when you actually need to keep the bytes.

## 6. What's the contract of `ReadSlice`?

It returns a slice into the `bufio.Reader`'s internal buffer up to
and including the delimiter. The slice is invalidated by the next
read on the same `bufio.Reader`. If the delimiter doesn't appear in
the buffer, returns `bufio.ErrBufferFull` along with the entire
buffer contents — recoverable, but you'll need to copy or grow.

## 7. How does `Peek` differ from `Read`?

`Peek(n)` returns the next `n` bytes without consuming them. The next
read sees the same bytes. Useful for protocol detection — gzip magic,
HTTP version, TLS record type. Limit: `n` cannot exceed the buffer
size; `Peek(8192)` on a 4096-byte buffer fails with
`ErrBufferFull`.

## 8. When would you choose `ReadString` over `Scanner.Scan`?

`ReadString('\n')` returns each line *with* the trailing newline,
allocates per call, and has no token size cap. `Scanner.Scan` strips
the newline, can return zero-allocation `Bytes()`, and has a 64 KiB
default cap. Pick `ReadString` for unbounded line lengths or when the
trailing newline matters; pick `Scanner` for typical text loops.

## 9. What is `bufio.ErrFinalToken`?

A sentinel a `SplitFunc` returns to yield one final token and then
stop scanning *cleanly*. After `ErrFinalToken`, the next `Scan`
returns false but `Err()` returns nil. Without it, you'd have to
return a real error and filter it out at the call site.

## 10. Is `bufio.Reader` safe for concurrent use?

No. Neither is `bufio.Writer` or `bufio.Scanner`. All three carry
internal state (buffer position, sticky error, leftover bytes) that
isn't synchronised. One value per goroutine. The race detector
catches violations.

## 11. What's the right `defer` order for a layered output stack?

Reverse of the construction order. For `os.File` wrapping a
`bufio.Writer` wrapping a `gzip.Writer`:

```go
f, _ := os.Create(...)
defer f.Close()           // runs last
bw := bufio.NewWriter(f)
defer bw.Flush()          // runs middle
gz := gzip.NewWriter(bw)
defer gz.Close()          // runs first — writes gzip trailer
```

Get this wrong and the file is missing the gzip trailer or the last
buffer worth of bytes.

## 12. Does `bufio.Writer` have a `Close` method?

No. Intentionally. `bufio.Writer` doesn't own the underlying writer;
it only buffers. The caller must `Flush` then close the underlying.
Code that calls `bw.Close()` doesn't compile.

## 13. What happens if you `Reset` a `bufio.Writer` without flushing?

The buffered bytes are silently dropped. `Reset` clears the buffer
state but doesn't flush. This is a real bug pattern in pooled code —
if you `Put` a writer back into the pool without flushing, the next
borrower gets a writer that "loses" data on first `Reset`.

## 14. What's `AvailableBuffer` for?

Returns the writer's internal buffer free space as a `[]byte` of
`len 0`, `cap = Available()`. You `append` into it (e.g.,
`strconv.AppendInt`) and then pass the result to `Write`. The writer
detects that the slice is its own buffer and just bumps the length —
zero copy. Available since Go 1.18.

## 15. Why doesn't `Scanner` respect `context.Context`?

`bufio.Scanner` predates `context.Context` and has no cancellation
mechanism. Workarounds: set deadlines on the underlying connection
(`net.Conn.SetReadDeadline`), or wrap the source in a custom
`io.Reader` that checks the context on each `Read`.

## 16. What happens when the underlying reader returns `(0, nil)`?

`bufio.Reader` retries up to 100 times. After that, it returns
`io.ErrNoProgress` to break the spin. Well-behaved readers should
never trigger this — `(0, nil)` is essentially forbidden by the
`io.Reader` contract.

## 17. How would you implement a custom `SplitFunc` for length-prefixed records?

```go
func scanLPR(data []byte, atEOF bool) (int, []byte, error) {
    if len(data) < 4 {
        if atEOF { return 0, nil, io.ErrUnexpectedEOF }
        return 0, nil, nil
    }
    n := int(binary.BigEndian.Uint32(data[:4]))
    if 4+n > len(data) {
        if atEOF { return 0, nil, io.ErrUnexpectedEOF }
        return 0, nil, nil
    }
    return 4 + n, data[4 : 4+n], nil
}
```

Pair with `s.Buffer(make([]byte, 0, 64*1024), maxRecord+4)` to allow
records larger than the default cap.

## 18. What's the difference between `bufio.Reader.ReadLine` and `ReadString('\n')`?

`ReadLine` returns a slice into the internal buffer (zero alloc) and
strips the trailing `\r?\n`. It also signals `isPrefix == true` if
the line is longer than the buffer — you must call again for the
rest. `ReadString('\n')` allocates a fresh string per call and
includes the trailing newline. `ReadLine` is what `Scanner` uses
internally; `Scanner` handles the prefix gluing for you.

## 19. Why is mixing `Scanner` and direct `Read` on the same source a bug?

Both `bufio.Scanner` (via its internal `bufio.Reader`) and a
user-created `bufio.Reader` over the same file consume from the same
underlying `Read`. Whichever one calls first gets the bytes; the
other sees the next chunk. The result is silent data loss or
interleaving. Pick one approach per stream.

## 20. How do you size a `bufio.Reader` for a custom protocol?

Just over the largest record you expect to read in a single chunk for
the fast path. If records are typically 1–4 KiB, the default 4096 is
fine. If you need to `Peek` 8 bytes of a header from a stream where
your typical handler reads 16 KiB at a time, bump to 16 KiB. Never
size below your largest `Peek` request.

## 21. What does `bufio.Reader.Discard(n)` do?

Skips `n` bytes without copying them. Returns the actual count
discarded — fewer than `n` only if EOF is hit. Cheaper than reading
into a throwaway buffer because no copy happens.

## 22. Does `bufio.Writer.Flush` guarantee data is on disk?

No. It pushes bytes from the bufio buffer to the underlying
`io.Writer`. For `*os.File`, that means the bytes are in the kernel
page cache, not on disk. For durability, `f.Sync()` after `bw.Flush()`.

## 23. Can you call `Buffer` after `Scan`?

No. `Buffer` and `Split` must be called before the first `Scan`.
After that, calling either panics with "Buffer called after Scan" /
"Split called after Scan." Configure the scanner fully, then loop.

## 24. What's the cost of a forgotten `Flush` in a server?

Best case: the response is silently truncated when the connection
closes. Worst case: the request is logged as completed but the
client got a partial response, and you've shipped a hard-to-debug
bug. The fix is mechanical: `Flush` before `Close`, `Flush` before
returning a writer to a pool.

## 25. How would you implement an idle-flush ticker for buffered output?

```go
go func() {
    t := time.NewTicker(10 * time.Millisecond)
    defer t.Stop()
    for range t.C {
        mu.Lock()
        bw.Flush()
        mu.Unlock()
    }
}()
```

A mutex is required because `Flush` is not safe to run concurrently
with `Write`. In high-performance setups, prefer a single owner
goroutine that handles both writes and the ticker tick — no locks.

## 26. Why might you not want a `bufio.Writer` over `tls.Conn`?

`tls.Conn` already buffers up to one TLS record (16 KiB). Wrapping
in `bufio.Writer` adds a second buffering layer that delays small
writes. For latency-sensitive protocols (HTTP/2, WebSocket), this
hurts. For batch-friendly throughput-oriented streams, the extra
batching helps — measure for your case.

## 27. How do you validate that a `bufio.Writer` flushed all its bytes?

Compare `bw.Buffered()` before and after `Flush`. After a successful
`Flush`, `Buffered()` is zero. If non-zero, the underlying `Write`
returned a short count without an error and the unflushed remainder
is sitting in the buffer for retry.

## 28. What does `bufio.NewReader` do if given an existing `*bufio.Reader`?

If the existing reader's buffer is at least 4096 bytes, returns it
as-is. Avoids double-buffering. Same idea for `NewReaderSize(r, n)`
when `r` is already a `*bufio.Reader` of size `>= n`.

## 29. How does `io.Copy(bw, r)` interact with `bufio.Writer`?

`io.Copy` checks for `io.ReaderFrom` on the destination, finds it on
`*bufio.Writer`, and calls `bw.ReadFrom(r)`. The implementation
drains the buffer, then writes large chunks directly through the
underlying writer if it also has `ReaderFrom`. Bytes go through the
bufio buffer briefly but are not split into 4 KiB pieces.

## 30. Final pitfall: when does `bufio.Scanner` panic?

When a `SplitFunc` returns `(0, nil, nil)` while `atEOF == true` and
`len(data) > 0` — "no progress at EOF." The scanner cannot read more
data, the splitter says "I need more," and the contradiction is
fatal. Correct splitters yield trailing data or return an error in
this case.
