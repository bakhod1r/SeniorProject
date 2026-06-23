# 8.1 `io` and File Handling — Senior

> **Audience.** You've written I/O-heavy services and you've been bitten
> at least once by a partial read, a forgotten `Close`, or a
> ghost-truncated file. This file is the precise contract: what the
> interfaces guarantee, what they explicitly *don't* guarantee, the
> small print on `Close` and `Sync`, and the systems-level details that
> separate code that mostly works from code that works under pressure.

## 1. The exact `io.Reader` contract

From the package docs, with the parts that bite emphasized:

> Read reads up to `len(p)` bytes into `p`. It returns the number of
> bytes read (`0 <= n <= len(p)`) and any error encountered. **Even if
> Read returns `n < len(p)`, it may use all of `p` as scratch space
> during the call.** If some data is available but not `len(p)` bytes,
> Read conventionally returns what is available instead of waiting for
> more.

> When Read encounters an error or end-of-file condition after
> successfully reading `n > 0` bytes, **it returns the number of bytes
> read**. It may return the (non-nil) error from the same call or
> return the error (and `n == 0`) from a subsequent call. An instance
> of this general case is that a Reader returning a non-zero number of
> bytes at the end of the input stream may return either `err == EOF`
> or `err == nil`. The next Read should return `0, EOF`.

> Callers should always process the `n > 0` bytes returned before
> considering the error `err`. Doing so correctly handles I/O errors
> that happen after reading some bytes and also both of the allowed
> EOF behaviors.

> **Implementations of Read are discouraged from returning a zero byte
> count with a nil error**, except when `len(p) == 0`. Callers should
> treat a return of `0` and `nil` as indicating that nothing happened;
> in particular it does not indicate EOF.

> **Implementations must not retain `p`.**

The five things that matter:

1. **Short reads are legal.** A `Reader` may return fewer bytes than
   you asked for even when more are available. Code that assumes a
   single `Read` fills the buffer is broken on TCP, on `os.File` over
   a pipe, on most decompressors, and on roughly half of the things
   you'll ever pass an `io.Reader` to.

2. **`p` may be used as scratch.** The bytes after `[:n]` are not
   guaranteed to be the same as before the call. Don't mix valid
   prefix and stale suffix in the same buffer.

3. **EOF can come with data.** A read may return `(n > 0, io.EOF)`.
   Code that ignores the data when it sees `EOF` drops the last
   chunk of the stream. The canonical loop processes `n` first, then
   inspects the error.

4. **`(0, nil)` is essentially forbidden.** If you see it from a
   well-behaved reader, treat it as a no-op and call again. From a
   buggy reader, you can spin forever — `bufio.Reader` actually
   returns `io.ErrNoProgress` after 100 such calls to break the
   spin.

5. **Don't retain `p`.** A reader that holds onto your buffer and
   returns slices of it later is non-conformant. Conversely, callers
   are free to pass the same `p` again — and almost always do.

## 2. The exact `io.Writer` contract

> Write writes `len(p)` bytes from `p` to the underlying data stream.
> It returns the number of bytes written from `p` (`0 <= n <= len(p)`)
> and any error encountered that caused the write to stop early.
> **Write must return a non-nil error if it returns `n < len(p)`.**
> Write must not modify the slice data, even temporarily.

> **Implementations must not retain `p`.**

The differences from `Reader`:

1. **Short writes always come with an error.** If `n < len(p)` and
   `err == nil`, the writer is broken. The standard `io.Copy` and
   `bufio.Writer` both check this.

2. **The slice is read-only.** Implementations must not modify
   `p[i]` for any `i`, even during the call. (Compare `Reader`,
   which is allowed to scribble in `p[n:]`.)

3. **Same don't-retain rule.** A logging writer that captures `p`
   into a goroutine via channel and writes later is broken — the
   caller will reuse `p` immediately.

The bytes-written semantics: `Write` returns the number of bytes
*successfully* written. After a short write, the unwritten suffix
`p[n:]` did not reach the destination. `bufio.Writer` and `io.Copy`
both retry — they call `Write` again with the unwritten suffix until
either the slice is empty or `Write` returns an error.

## 3. The `Closer` contract

> Close releases the resource. The behavior of Close after the first
> call is undefined.

Three things to internalize:

1. **Close once.** Most stdlib types tolerate a second `Close` (it
   returns an error like "file already closed"), but the contract
   doesn't require it. Code that double-closes is a latent bug.

2. **Close can fail.** A close that returns an error means something
   you wrote may not have hit the destination. For files, this is
   the OS reporting a delayed write error. For network connections,
   it's a flush failure. **Always check the error from `Close` on
   anything you wrote to.**

3. **Defer's interaction with Close errors.** `defer f.Close()`
   throws away the error. The standard pattern for files you write
   to is the named-return style:

   ```go
   func writeReport(path string) (err error) {
       f, err := os.Create(path)
       if err != nil {
           return err
       }
       defer func() {
           if cerr := f.Close(); err == nil {
               err = cerr
           }
       }()
       // ... writes ...
       return nil
   }
   ```

   This way, the close error becomes the function's error if no other
   error already occurred, but doesn't shadow a more interesting error.

## 4. `Close` is not `Sync`

A successful `Close` flushes user-space buffers (e.g., `bufio.Writer`
content) and tells the OS you're done. It does **not** flush the OS
page cache to disk. After a successful `Close`, your data is in
kernel memory; a power loss can still lose it.

For durability, call `f.Sync()` (or, on Linux, `f.SyncFile()`'s
equivalents) before `Close`:

```go
if err := f.Write(data); err != nil { return err }
if err := f.Sync(); err != nil { return err }   // wait for disk
if err := f.Close(); err != nil { return err }
```

`Sync` is `fdatasync(2)`-equivalent on Linux on modern Go versions.
For applications where durability matters (databases, write-ahead
logs, queue persistence), this sequence is the difference between
"crash-safe" and "mostly works."

For directory entries — file creation, deletion, rename — you also
need to sync the *parent directory* to make the metadata change
durable:

```go
parent, err := os.Open(filepath.Dir(path))
if err != nil { return err }
defer parent.Close()
if err := parent.Sync(); err != nil { return err }
```

This is the part most code skips. On `ext4` with `data=ordered`
(default), it's usually fine. On other filesystems, it isn't.

## 5. The atomic-rename pattern, examined

Recall the pattern from middle.md:

```
1. CreateTemp in same directory
2. Write data
3. Sync data
4. Close
5. Chmod (if needed)
6. Rename to target
```

The guarantees:

- **POSIX `rename(2)` is atomic** with respect to *visibility*:
  another process opening `target` will see either the old contents
  or the new contents, never partial. This is mandated by POSIX.

- **POSIX `rename(2)` is not atomic** with respect to *durability*.
  After `rename` returns, a power loss can revert the rename and
  lose the new file (depending on filesystem and mount options). To
  make the rename durable, sync the parent directory after.

- **Windows `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`** is the
  closest equivalent. Go's `os.Rename` uses it. It is atomic for
  visibility, with similar durability caveats.

- **Cross-filesystem rename fails with `EXDEV`.** This is why the
  temp file must live in the same directory (or at least the same
  filesystem). Always call `filepath.Dir(target)` and create the
  temp there.

Code that wants both durability and atomicity, in full:

```go
func atomicWriteFileSync(target string, data []byte, perm fs.FileMode) (err error) {
    dir := filepath.Dir(target)
    tmp, err := os.CreateTemp(dir, filepath.Base(target)+".tmp-*")
    if err != nil { return err }
    defer func() {
        if err != nil {
            os.Remove(tmp.Name())
        }
    }()
    if _, err = tmp.Write(data); err != nil { tmp.Close(); return err }
    if err = tmp.Sync(); err != nil       { tmp.Close(); return err }
    if err = tmp.Close(); err != nil      { return err }
    if err = os.Chmod(tmp.Name(), perm); err != nil { return err }
    if err = os.Rename(tmp.Name(), target); err != nil { return err }

    parent, err := os.Open(dir)
    if err != nil { return err } // rename succeeded, durability uncertain
    defer parent.Close()
    return parent.Sync()
}
```

## 6. Partial writes and how they happen

You wrote 8 KiB to `*os.File`. It returned `(8192, nil)`. Why might
the file on disk show 7 KiB later?

Three places where the bytes can vanish:

1. **Buffered writers.** If you wrote through `bufio.Writer`, your
   8 KiB are in the user-space buffer until `Flush`. Forgetting it is
   the easiest data-loss bug in Go.

2. **Page cache.** Even after `Write` returns from the OS, the bytes
   live in kernel memory. A power loss before the next `fsync` is
   the OS dropping them. `Sync` is the answer.

3. **Disk write cache.** Modern disks have their own write cache. A
   completed `fsync` is supposed to push through it (the OS sets
   FUA — force unit access — or issues `FLUSH_CACHE`), but on
   misconfigured systems (`hdparm -W1` on a USB enclosure, certain
   SSD firmware bugs) it doesn't. This is rare on server hardware
   and common on consumer hardware. Out of Go's control.

For most application code, sync at the right moment and trust the OS.
For critical-path durability (financial, medical), consult your
hardware and filesystem documentation.

## 7. The `fsync` cost

`Sync` is one of the slower operations available to a process. On a
spinning disk, it can take tens of milliseconds. On an enterprise SSD
with battery-backed cache, hundreds of microseconds. On consumer SSD,
single-digit milliseconds typical, occasionally much longer due to
internal garbage collection.

Patterns:

- **Batch writes, sync once.** A single sync is the cost of one write,
  no matter how many bytes are buffered behind it.

- **Group commit.** When many goroutines all need durability, queue
  their writes, do one sync, signal all of them. This is what
  databases do.

- **Async sync via a separate goroutine.** Write returns immediately;
  a background goroutine syncs and notifies an acknowledgement
  channel. Callers wait only when they need durability.

The wrong pattern is "Write then Sync after every operation." That
caps your throughput at the disk's IOPS, regardless of CPU.

## 8. The `Reader.Read` short-read distribution

Different sources have different short-read behavior, and it pays to
know your enemy.

| Source | Typical Read return |
|--------|---------------------|
| `bytes.Buffer`, `bytes.Reader`, `strings.Reader` | `min(len(p), remaining)` — never short unless EOF |
| `*os.File` (regular file) | Usually `len(p)` until near EOF, then short, then EOF |
| `*os.File` (pipe, terminal) | Returns whatever is currently available (often 1 line) |
| `*net.TCPConn` | Returns whatever the kernel has buffered (often less than `len(p)`) |
| `gzip.Reader` (and friends) | Returns whatever it can produce per inner read; often short |
| `tls.Conn` | Up to one TLS record (16 KiB max), often less |

Conclusion: writing code that assumes one `Read` returns `len(p)`
bytes is correct *only* when you control the source. For anything
that crosses a process or library boundary, use `io.ReadFull`,
`io.Copy`, or `bufio.Scanner` instead.

## 9. EOF, `ErrUnexpectedEOF`, and stream framing

The stdlib uses three EOF-related sentinels with precise meanings:

- `io.EOF` — clean end of stream. The producer is done; everything
  it wanted to send has arrived.
- `io.ErrUnexpectedEOF` — end of stream in the middle of a record.
  Used by `io.ReadFull`, `binary.Read`, and parsers when the framing
  required more bytes than the source provided.
- `io.ErrClosedPipe` — the other end of an `io.Pipe` was closed
  without a more specific error.

When you write a parser, return `io.ErrUnexpectedEOF` on truncated
input and `io.EOF` only when you've cleanly finished. Callers can
then distinguish "stream ended where it should have" from "stream
was cut short."

`errors.Is(err, io.EOF)` is the right comparison; some readers wrap
the sentinel in a `*fs.PathError`-like type.

## 10. `ReaderFrom` and `WriterTo`: the optional fast paths

Two opt-in interfaces let types accelerate `io.Copy`:

```go
type ReaderFrom interface {
    ReadFrom(r Reader) (n int64, err error)
}

type WriterTo interface {
    WriteTo(w Writer) (n int64, err error)
}
```

Inside `io.Copy(dst, src)`:

```go
if wt, ok := src.(WriterTo); ok {
    return wt.WriteTo(dst)
}
if rf, ok := dst.(ReaderFrom); ok {
    return rf.ReadFrom(src)
}
// fall back to a 32 KiB buffer loop
```

This is how `*os.File` to `*os.File` gets `copy_file_range` /
`sendfile`, why `io.Copy` from a `bytes.Buffer` to a `*net.TCPConn`
can avoid an intermediate copy, and why decoding directly into a
file is fast. Implement these on your own type when you have a
better-than-default copy path. Don't implement them if your default
path *is* the standard 32 KiB loop — adding the methods just adds
indirection.

`io.CopyBuffer(dst, src, buf)` is the version that takes an explicit
buffer. It still tries the fast paths; the buffer is used only if
neither side has one.

## 11. `io.SectionReader` and parallel reads

`io.NewSectionReader(r io.ReaderAt, off, n int64)` returns an
`io.ReadSeeker` that reads only the bytes `[off, off+n)` of `r`.
Multiple `SectionReader`s over the same source are independent —
they each have their own position cursor and don't interfere because
they go through `ReadAt`, not `Read`/`Seek`.

```go
const chunk = 4 << 20
n := stat.Size()
var wg sync.WaitGroup
for off := int64(0); off < n; off += chunk {
    end := min(off+chunk, n)
    wg.Add(1)
    go func(off, end int64) {
        defer wg.Done()
        sr := io.NewSectionReader(f, off, end-off)
        process(sr)
    }(off, end)
}
wg.Wait()
```

Useful for parallel checksumming, parallel decompression of
container formats with internal indexes (zip, tar with seekable
backings), and parallel uploads of file ranges.

## 12. `io/fs` — the abstract filesystem interface

`io/fs` lives separate from `os` because it's a *read-only*
abstraction. The core interfaces:

```go
type FS interface {
    Open(name string) (File, error)
}

type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}
```

That's the minimum. Optional add-on interfaces let an `FS` opt into
extra capabilities:

| Interface | Method | What it adds |
|-----------|--------|--------------|
| `ReadDirFS` | `ReadDir(name string) ([]DirEntry, error)` | Directory listing |
| `ReadFileFS` | `ReadFile(name string) ([]byte, error)` | Whole-file read |
| `StatFS` | `Stat(name string) (FileInfo, error)` | Stat without open |
| `GlobFS` | `Glob(pattern string) ([]string, error)` | Pattern matching |
| `SubFS` | `Sub(dir string) (FS, error)` | Subtree view |

Helpers in `io/fs` accept a base `FS` and use the optional interfaces
when present, falling back to opening files manually. This is why
`fs.WalkDir(fsys, "/", fn)` works on `embed.FS`, `os.DirFS`, and
`fstest.MapFS` identically.

The names use forward-slashes always, regardless of OS. They are
*virtual* paths, not OS paths.

## 13. `os.Root` (Go 1.24+) — confined filesystem access

Go 1.24 introduced `os.OpenRoot` and `*os.Root`, which give you a
filesystem handle that refuses to escape its root, even via
symlinks or `..`. Before this, you had to validate paths manually
and risk subtle bugs.

```go
root, err := os.OpenRoot("/var/www")
if err != nil { return err }
defer root.Close()

f, err := root.Open(userSuppliedPath) // safe: rooted at /var/www
```

If `userSuppliedPath` resolves outside `/var/www` (via `..` or via a
symlink whose target is outside), `Open` returns an error. This is
the right primitive for serving user-supplied filenames. If you're
on Go 1.24+, use it; if not, see [find-bug.md](find-bug.md) for the
manual validation pitfalls.

## 14. `*os.File.Fd()` and `syscall` interop

`(*os.File).Fd()` returns the underlying file descriptor as a
`uintptr`. This lets you pass the FD to platform-specific syscalls.
Two important rules:

1. **The returned FD is owned by the `*os.File`.** Don't `close(2)`
   it; the `*os.File` will. Don't keep the `uintptr` and use it
   after the `*os.File` is garbage-collected — there's a finalizer
   that may close it.

2. **For long-running syscalls, use `SyscallConn`.** It pins the FD
   for the duration of the call, preventing GC from closing it.

   ```go
   sc, err := f.SyscallConn()
   if err != nil { return err }
   var sysErr error
   err = sc.Control(func(fd uintptr) {
       sysErr = syscall.Flock(int(fd), syscall.LOCK_EX)
   })
   ```

   `Control`, `Read`, and `Write` give you safe windows to call into
   the syscall layer without racing the runtime.

## 15. Pollable vs non-pollable files

`*os.File` has two modes internally. For "pollable" descriptors —
sockets, pipes, ttys — the runtime uses the network poller (epoll,
kqueue, IOCP) so that blocked I/O suspends the goroutine without
blocking an OS thread. For regular files on Linux, blocking
`read(2)` is used because Linux's regular-file I/O isn't usefully
poll-able; this can briefly tie up an OS thread.

Implications:

- A goroutine reading from a slow disk can pin an OS thread for the
  duration of the syscall. Many concurrent slow reads can exhaust
  the thread pool. Use `runtime.GOMAXPROCS` carefully on
  thread-constrained systems, or move slow disk I/O to a bounded
  worker pool.

- On some platforms (Linux 5.6+, with `io_uring`), Go could in
  principle use async file I/O. As of Go 1.22, it doesn't.

- For network code, none of this matters — the runtime handles
  millions of concurrent connections without thread bloat because
  of the poller.

## 16. Buffered scanners and the "long token" trap

`bufio.Scanner` with `bufio.ScanLines` returns `bufio.ErrTooLong` if
a single line exceeds `MaxScanTokenSize` (64 KiB). The scanner
*advances past* the offending line — your next `Scan` returns the
line *after* the long one. You don't get a chance to keep reading
that token; it's lost.

If your input might have long lines, two options:

1. Raise the cap and accept the memory cost:
   ```go
   s.Buffer(make([]byte, 0, 64*1024), 1<<20) // up to 1 MiB per line
   ```

2. Use `bufio.Reader.ReadString('\n')` or `ReadBytes('\n')`. These
   grow as needed, allocating a new buffer per call.

Don't try to "catch" `ErrTooLong` and continue — the scanner has
already discarded the data.

## 17. `bufio.Reader.ReadLine` is not a line scanner

`ReadLine` is a low-level helper. It returns a slice that might be
incomplete (`isPrefix == true`), in which case you must call again
to get the rest of the line. Almost no code wants this directly —
that's why `Scanner` exists.

If you find yourself calling `ReadLine`, you almost certainly want
`Scanner` or `ReadString('\n')` instead. The exception is when you
want the bytes returned without the trailing newline and without
allocating a new buffer per line — `ReadLine`'s slice aliases the
internal buffer.

## 18. The `io.Closer` chain in compression

Stacked codecs make `Close` interesting:

```go
out, _ := os.Create("file.json.gz")
gz := gzip.NewWriter(out)
enc := json.NewEncoder(gz)
enc.Encode(payload)

// Close in reverse order:
gz.Close()  // flushes deflate, writes gzip trailer
out.Close() // flushes file
```

`gzip.Writer.Close()` does the important work — it flushes the
deflate stream and writes the gzip trailer (CRC32, length). If you
forget it, the file is unreadable: gunzip will report "unexpected
end of stream." The bytes look like a normal compressed stream, but
the trailer is missing.

`json.Encoder` doesn't have a `Close`; it writes immediately.

Always close in reverse order of creation, and check every error.

## 19. The `*os.File.Truncate` gotcha

`Truncate(n)` resizes the file to `n` bytes. It does *not* move the
file's position cursor. After truncating to a size smaller than your
current position, `Write` will create a "hole" filled with zero
bytes between the truncate point and the next write.

```go
f.Seek(0, 0)
f.Write([]byte("hello, world"))   // file is "hello, world", pos = 12
f.Truncate(5)                     // file is "hello", pos = 12
f.Write([]byte("!"))              // file is "hello\0\0\0\0\0\0\0!"
```

After `Truncate`, seek explicitly to where you want the next write.

## 20. `*os.File.Stat` after `Close` is not allowed

It is undefined behavior to call any method on `*os.File` after
`Close`. Stdlib will return `os.ErrClosed`, but nothing prevents a
race: another goroutine could `Close` while you're calling `Stat`,
and the FD might already have been reused for another open file
(this is a classic source of weird bugs in long-lived processes).

Treat `*os.File` like a one-shot resource handle: open, use, close,
forget. Don't share across goroutines without either a mutex or a
clear ownership boundary.

## 21. Concurrency, exactly

The full picture for `*os.File`:

- `Read` and `Read` from two goroutines: race on the position cursor.
- `Write` and `Write` from two goroutines: race on the position
  cursor; data may be interleaved at sub-page granularity.
- `Read` and `Write` from two goroutines: race.
- `ReadAt` and `ReadAt` at non-overlapping offsets: safe.
- `WriteAt` and `WriteAt` at non-overlapping offsets: safe (POSIX
  guarantee on regular files).
- `ReadAt` and `WriteAt`: safe with respect to data integrity, but
  the read may see either the pre-write or post-write data — it's a
  race for *content*, not for memory safety.
- `Close` concurrent with any other operation: race; the other
  operation may see an FD that has already been reused.

In short: use `ReadAt`/`WriteAt` for concurrent positioned I/O.
Otherwise, give each goroutine its own `*os.File` (multiple `Open`s
on the same path).

## 22. Garbage collection and file descriptors

`*os.File` has a finalizer that calls `Close` if the value is
garbage-collected without being closed. This is a safety net, not a
substitute for `Close`. Reasons not to rely on it:

1. The finalizer runs at an unpredictable time. You can run out of
   file descriptors long before GC bothers.
2. The finalizer doesn't propagate errors. A failing close goes
   silently to nowhere.
3. If you keep a reference to the `*os.File` (via a closure, a
   field, etc.) anywhere, the finalizer never fires.

Always close explicitly. The finalizer exists to clean up after bugs,
not to be the primary closer.

## 23. Reading: what to read next

- [professional.md](professional.md) — the patterns that make
  large-scale streaming code observable, debuggable, and resilient.
- [specification.md](specification.md) — the formal contract
  reference, distilled.
- [optimize.md](optimize.md) — when the contract is correct but the
  performance isn't.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file.

External references worth knowing:

- *The Go Programming Language* (Donovan & Kernighan) — Chapter 5
  for `io` patterns, Chapter 7 for interface composition.
- LWN, "Atomic file replacement" — covers the fsync/rename
  semantics that bite outside Go too.
- The Go spec for `defer` — relevant when reasoning about close order.
