# 8.1 `io` and File Handling — Interview

> **Audience.** Both sides of the table. Candidates use these to drill
> their understanding of the I/O surface; interviewers use them to find
> out whether someone has actually written production Go or just read
> the package docs. Questions are tagged by level. Each answer is what
> a strong response sounds like — short, specific, with the reasoning
> visible.

## Junior

### Q1. What does `io.EOF` mean?

`io.EOF` is a sentinel error returned by a `Reader` to signal that the
stream has ended cleanly — there is no more data and there never will
be. It is not an exceptional condition; every well-behaved reading
loop expects it. The trick is that a single `Read` call can return
both data and `io.EOF` in the same call (`(n > 0, io.EOF)`), which
means a loop that checks the error before processing the bytes will
drop the trailing chunk.

### Q2. What's the difference between `os.ReadFile` and `os.Open`?

`os.ReadFile` reads the entire file into a `[]byte` and returns it. It
allocates one big buffer and is the right choice for small files where
size is bounded — config files, fixtures, templates. `os.Open` returns
an `*os.File` you stream from with `Read` calls, suitable for large
files and anything where memory is a concern. The general rule:
`ReadFile` for files you wrote, `Open` for files users provide.

### Q3. What does `defer f.Close()` do, and when is it wrong?

`defer f.Close()` schedules the close to run when the surrounding
function returns. It's correct for files you only read from. For files
you write to, it discards the error from `Close` — and `Close` on a
writeable file is exactly when the OS reports delayed write errors. A
successful `Write` followed by a failing `Close` means your data
didn't reach disk. The fix is the named-return pattern that captures
the close error if no other error already occurred.

### Q4. Why is `bufio.Writer.Flush` necessary?

`bufio.Writer` collects small writes in a 4 KiB buffer (by default)
and writes to the underlying stream in one larger chunk. If you
`Close` the underlying file without first calling `Flush`, the bytes
still in the buffer are lost. Two `defer`s in the right order solve
it: `defer f.Close()` first (runs second), then `defer bw.Flush()`
(runs first because of LIFO).

### Q5. What happens if you call `Read` with a 100-byte buffer and the file has 50 bytes left?

You get `(50, nil)` on the first call and `(0, io.EOF)` on the next —
or `(50, io.EOF)` in a single call. Both are legal per the `io.Reader`
contract. Code that handles only the two-call form will eventually
miss the final chunk on a reader that emits the one-call form.

### Q6. What's `io.Discard` for?

It's an `io.Writer` that always succeeds and counts no bytes. Two
common uses: as the destination in `io.Copy` to count how many bytes a
reader produces (`io.Copy(io.Discard, r)`), and as the destination for
draining HTTP response bodies so the underlying TCP connection can be
returned to the connection pool.

### Q7. How do you check if a file exists?

`os.Stat` plus `errors.Is(err, fs.ErrNotExist)`. The older
`os.IsNotExist` works too but is being phased out in favor of the
`errors.Is` idiom. A bare `err != nil` check is wrong because the
file might exist but you might lack permission — that's a different
error you usually want to surface.

## Middle

### Q8. Why might `io.Copy` be faster than a manual `Read`/`Write` loop?

Two reasons. First, `io.Copy` checks if the source implements
`WriterTo` or the destination implements `ReaderFrom`, and if so,
delegates to the type's specialized fast path. For two `*os.File`s on
Linux, this can become a `copy_file_range` syscall that copies bytes
in the kernel without ever moving them through user space. Second, on
the slow path, `io.Copy` uses a 32 KiB buffer — most hand-written
loops use 4 KiB or less and amortize syscall overhead worse.

### Q9. What's the difference between `io.MultiReader` and `bytes.Buffer`?

`io.MultiReader(r1, r2, ...)` is a virtual concatenation: the readers
are streamed through in order, no copying. `bytes.Buffer` materializes
bytes in memory. Use `MultiReader` when the inputs are already
streamable readers; use `bytes.Buffer` when you have raw bytes you
need to assemble before sending.

### Q10. What does `io.Pipe` give you that a `bytes.Buffer` doesn't?

`io.Pipe` is a synchronous handoff between goroutines: a writer
blocks until a reader consumes its bytes, providing natural
backpressure. Memory stays flat regardless of stream size. Use it
when one goroutine produces and another consumes, like piping
JSON-encoded objects into an HTTP `POST` body without first encoding
the whole payload to a buffer. `bytes.Buffer` requires you to fully
assemble the bytes first.

### Q11. Is `bytes.Buffer` safe for concurrent use?

No. One goroutine writing while another reads is a data race that
will fail under `-race`. Use a channel, a `sync.Mutex`, or `io.Pipe`
for the producer-consumer case. Even concurrent `Write` calls from
two goroutines race because `Buffer` doesn't lock.

### Q12. What does `bufio.Scanner.Buffer` do, and why would you call it?

It overrides the default token-size cap (64 KiB) and the initial
buffer. A `Scanner` that hits a token longer than the cap returns
`bufio.ErrTooLong` and, importantly, *advances past* the offending
token — you don't get a chance to keep it. For inputs with long
lines (CSV with embedded text, structured logs), call
`s.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)` to raise the cap.

### Q13. When should you use `io.LimitReader`?

Whenever the source isn't fully under your control. An HTTP request
body, a file uploaded by a user, anything that could be arbitrarily
large. `io.LimitReader(src, max)` returns EOF after `max` bytes,
preventing a hostile or buggy peer from making you allocate gigabytes.
It silently truncates rather than erroring, so add one byte to the cap
and check the result if you want to distinguish "exactly at the cap"
from "would have been larger."

### Q14. What's the difference between `path` and `path/filepath`?

`path` always uses forward slashes and is for URL paths and virtual
paths (like `embed.FS` lookups). `path/filepath` uses the OS-native
separator (`\` on Windows, `/` elsewhere) and is for real filesystem
paths. Using `path.Join` for a real file on Windows will produce a
broken path. The mistake is invisible on Linux/macOS during
development and explodes in production on Windows.

### Q15. What's the off-by-one in `bufio.Scanner`'s default token size?

`bufio.MaxScanTokenSize` is 65536, but the *usable* token size is one
byte less because the buffer needs room for the trailing newline (or
delimiter) the splitter looks for. So a 65535-byte line works, a
65536-byte line returns `bufio.ErrTooLong`. The exact threshold
depends on the splitter, but the common case is "a few bytes less
than 64 KiB."

### Q16. Why is `os.Rename` called atomic?

POSIX guarantees that another process opening the destination path
sees either the old contents or the new contents — never a partial
file. The atomicity is *visibility*, not durability: a power loss
right after a successful `Rename` can still revert the change unless
you also synced the parent directory. The atomicity also requires
that source and destination be on the same filesystem; cross-FS
rename returns `EXDEV`.

## Senior

### Q17. Walk through what happens when you `defer file.Close()` on a file you wrote to. What can go wrong?

Three things. First, `defer` discards `Close`'s return value, so any
delayed write error reported by the OS is dropped silently. Second, if
you wrote through a `bufio.Writer`, its buffer hasn't been flushed
yet — the close runs first, the file gets closed with bytes still in
the user-space buffer, and you lose data. Third, even if `Close`
returned `nil`, the bytes are only in the page cache; a power loss
loses them unless you called `Sync` first. The full pattern is
`bufio.Writer.Flush()` → `f.Sync()` → `f.Close()`, with all three
errors propagated.

### Q18. Design an atomic file-replace function that survives a crash. What guarantees does POSIX `rename` give you?

The pattern: create a temp file in the same directory as the target
(`os.CreateTemp(dir, base+".tmp-*")`), write the data, `Sync`, `Close`,
`Chmod` to the desired permissions, `Rename` over the target, then
`Sync` the parent directory. POSIX `rename` is atomic for visibility
— no observer sees a half-file — but not durable across crashes
unless the parent directory is synced after. Same-filesystem is
required (cross-FS yields `EXDEV`). On Windows, `MoveFileEx` with
`MOVEFILE_REPLACE_EXISTING` is the equivalent and Go's `os.Rename`
uses it transparently.

### Q19. Why is sharing a `bufio.Reader` across goroutines unsafe?

`bufio.Reader` maintains internal buffer state — a slice of bytes,
read/write positions, partial-rune state — that two goroutines
calling `Read` (or `ReadByte`, `Peek`, etc.) will mutate concurrently.
The result is data races, dropped bytes, returned slices that point
into a buffer being overwritten by another goroutine. The same goes
for `bufio.Writer` and `bufio.Scanner`. Each goroutine needs its own,
or you wrap with a mutex.

### Q20. What's the danger of `defer f.Close()` inside a loop that opens files?

Each `defer` accumulates on the function's defer stack and runs only
when the function returns. A loop processing 10 000 files leaves
10 000 file handles open until the function exits. On Linux with the
default 1024 FD limit, you hit `too many open files` long before
finishing. The fix is to make the loop body a function (so the defer
fires per iteration) or to close explicitly inside the loop with an
error check.

### Q21. What's the race between `Close` in one goroutine and `ReadAt` in another?

`Close` returns the FD to the OS pool. The OS may immediately reuse
that FD for a different file opened by another part of the process
(or even another process, depending on the OS). The in-flight `ReadAt`
in the second goroutine then reads from the wrong file, returning
bytes that look like garbage to the caller — but are perfectly real
bytes from somewhere else. This is one of the most painful bug classes
in long-lived services because the symptom (corrupt data) is far from
the cause (missing synchronization on `Close`).

### Q22. Why does `*os.File.ReadAt` document that it must return an error on a short read, while `Read` doesn't?

`Read` is allowed to return fewer bytes than requested for legitimate
streaming reasons — a TCP packet boundary, a partial OS buffer fill,
a decompressor's internal record. The caller is expected to loop or
use `io.ReadFull`. `ReadAt` has no such excuse: the caller specified
exactly which range to read, and if the source can't deliver all of
it, the only legitimate cause is EOF. So `ReadAt` returning a short
read with `err == nil` would be ambiguous — was the file truncated?
Did the caller misunderstand? Returning an error eliminates the
ambiguity.

### Q23. When does `io.Copy` use kernel zero-copy?

When both ends are types that the kernel can splice directly. The
common cases on Linux: `*os.File` to `*os.File` uses
`copy_file_range` (Linux 4.5+); `*os.File` to `*net.TCPConn` uses
`sendfile`; `*net.TCPConn` to `*os.File` uses `splice`. The dispatch
happens because `*os.File` implements `ReadFrom`, and `io.Copy`
checks for that interface before falling back to its 32 KiB buffer
loop. Wrapping either side in something that hides the type — say,
an `io.LimitReader` — disables the fast path.

### Q24. What's `io.ErrNoProgress`?

A protective error returned by `bufio.Reader` and `io.ReadFull` when
the underlying reader returns `(0, nil)` more than 100 times in a
row. Per the `io.Reader` contract, returning `(0, nil)` is supposed
to be treated as a no-op, but a buggy reader can spin forever
returning it. `ErrNoProgress` breaks the spin. If you see it, the
reader is broken.

### Q25. How do you sync a directory entry, and when do you need to?

Open the directory itself with `os.Open(dir)`, then call `Sync()` on
the resulting `*os.File`. You need it after creating, deleting, or
renaming files when the metadata change must survive a crash. POSIX
`rename` is atomic for visibility but not durable; a power loss
between `rename` and the directory metadata being flushed can revert
the change. On `ext4` with default options the cost is small and
worth paying for any persistence-critical write path.

### Q26. What does it mean for `Read` implementations to "not retain `p`"?

The buffer slice the caller passes in is borrowed for the duration of
the call only. Once `Read` returns, the caller is free to reuse `p`
for the next call (and almost always does — that's the whole point of
buffered reading). A `Reader` that holds onto `p` and writes into it
later, or returns slices that point into `p` after a later read, is
non-conformant. The same restriction applies to `Write` from the
opposite direction: the writer cannot retain `p` past the call.

## Staff / Architecture

### Q27. Design an upload pipeline that resumes correctly across crashes for a 50 GB file. What contracts does the protocol need?

The data side is an `io.SectionReader` per chunk so each request is
independent and re-sendable. The protocol needs an upload ID assigned
on first request, server-side per-chunk acknowledgements, and a
"how far have I got?" query the client uses on reconnect. The chunk
size is the trade-off between request overhead and the cost of
re-sending after a failure — typically 4–16 MiB. Each chunk's request
should carry a content hash so the server can detect corruption
independently of TCP. The client keeps a local manifest (just a JSON
file written via the atomic-rename pattern) of which chunks are
acked. On crash, it reads the manifest and resumes. The server's
`finalize` operation — turning N chunks into one stored object — must
itself be atomic and idempotent.

### Q28. How do you implement backpressure across an HTTP boundary in a Go service?

Inside one process, `io.Pipe` provides synchronous handoff with
backpressure for free. Across HTTP, you have to lean on TCP's flow
control: write to the response writer in a streaming fashion, let the
client's slow reads cause the kernel send buffer to fill, which makes
your `Write` calls block. This works only if your handler doesn't
buffer the whole response server-side. On the consumer side, read in
bounded chunks instead of `io.ReadAll`, and process each chunk before
reading the next — your slow processing translates back into TCP
flow control on the producer. If you need stricter limits, use a
semaphore around `Read`/`Write` to bound concurrency.

### Q29. What's the failure mode of running `io.Copy` from a slow producer to a slow consumer for hours, and how do you make it observable?

The default `io.Copy` is opaque. A wrapped reader that reports bytes
copied per second, plus a `context.Context` that times out reads, plus
a deadline on the destination if it's a network connection, gives you
visibility and control. The risk to monitor for: a stalled producer
holds the consumer's connection idle, and intermediate proxies
(L4 load balancers, NAT) may close the idle connection. Add an
application-level keepalive (write a heartbeat byte every N seconds
if the data stream goes silent) for long copies through middleboxes.

### Q30. Why does Go not implement async file I/O via `io_uring` (as of Go 1.22), and what would change if it did?

Go's runtime model assumes that blocked syscalls pin an OS thread for
their duration. For network I/O, the runtime uses `epoll`/`kqueue`
to suspend goroutines without pinning threads — that's how millions
of connections fit on a small thread pool. Regular file I/O on Linux
isn't usefully poll-able with `epoll` (the FD is "always ready" even
when the underlying read would block on disk), so Go falls back to
blocking `read(2)` and burns a thread. `io_uring` could let Go
suspend goroutines on file reads too. The result would be much higher
concurrency on disk-bound workloads and lower thread-count overhead.
The reason Go hasn't adopted it: `io_uring` is Linux-only, has a
checkered security history, and the runtime would need a new I/O
primitive that doesn't fit the existing `netpoll` abstraction
cleanly. Other Go runtimes (notably `tinygo`) have experimented; the
mainline runtime hasn't.

## What to read next

- [find-bug.md](find-bug.md) — practice spotting the bugs the answers
  above describe.
- [tasks.md](tasks.md) — implement the patterns the senior/staff
  questions reference.
- [optimize.md](optimize.md) — the "fast path" question (Q23, Q9)
  expanded.
