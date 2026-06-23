# 8.1 `io` and File Handling — Find the Bug

> **Audience.** You've read [middle.md](middle.md) and
> [senior.md](senior.md), and you want to train your eye for the bugs
> that actually ship to production. Each snippet below is short, looks
> roughly right, and has at least one real bug from the patterns the
> earlier files describe. Read the snippet first, find the bug, then
> read the analysis. The bugs are not visual — they're contractual.

## 1. Dropping the last chunk on EOF

```go
func readAll(r io.Reader) ([]byte, error) {
    var out []byte
    buf := make([]byte, 4096)
    for {
        n, err := r.Read(buf)
        if err != nil {
            if errors.Is(err, io.EOF) {
                return out, nil
            }
            return nil, err
        }
        out = append(out, buf[:n]...)
    }
}
```

### Analysis

The `io.Reader` contract permits `Read` to return both data and `io.EOF`
in the same call: `(n > 0, io.EOF)`. The loop above checks the error
*before* processing `buf[:n]`, so when a reader chooses the one-call
form, the trailing bytes are silently discarded. The caller sees a
truncated result with no error.

The fix is the canonical loop: process `n > 0` first, then inspect the
error.

```go
n, err := r.Read(buf)
if n > 0 {
    out = append(out, buf[:n]...)
}
if err != nil {
    if errors.Is(err, io.EOF) { return out, nil }
    return nil, err
}
```

In practice, prefer `io.ReadAll`, which gets this right.

## 2. Forgetting `bufio.Writer.Flush`

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

### Analysis

`bufio.Writer` collects writes in a 4 KiB buffer. When the function
returns, `defer f.Close()` runs and closes the file — but the buffered
bytes are still in `bw`'s memory. The file on disk contains only the
data that filled the buffer earlier (often nothing, for short reports).

The fix is to flush before close, with both deferred so they run in
the right order:

```go
defer f.Close()
bw := bufio.NewWriter(f)
defer bw.Flush()
```

The `defer`s run last-in-first-out, so `bw.Flush()` runs before
`f.Close()`. Even better: check both errors. The `Close` on a
writeable file is when the OS surfaces delayed write errors.

## 3. `path.Join` for a real filesystem path

```go
import "path"

func openLog(name string) (*os.File, error) {
    p := path.Join("/var/log/myservice", name)
    return os.Open(p)
}
```

### Analysis

`path.Join` always uses forward slashes. On Linux and macOS this works
by accident because the OS separator is also `/`. On Windows it
produces broken paths — the function silently ships and breaks only
when someone runs the service on Windows, often months later.

Use `path/filepath.Join`, which adapts to the OS separator. Reserve
`path` for URL paths and `io/fs` virtual paths.

## 4. Treating `Read` as if it filled the buffer

```go
func readHeader(r io.Reader) (Header, error) {
    var buf [16]byte
    n, err := r.Read(buf[:])
    if err != nil { return Header{}, err }
    if n != 16 {
        return Header{}, errors.New("short read")
    }
    return parseHeader(buf[:]), nil
}
```

### Analysis

`Read` is allowed to return fewer bytes than requested even when more
are available — see [senior.md](senior.md) section 1. On a TCP
connection, a `gzip.Reader`, or any partially-buffered source, you
will routinely get `(n, nil)` with `n < 16` and the rest of the data
just one call away. This function reports a spurious "short read"
error.

Use `io.ReadFull`, which loops until the buffer is full or the source
ends:

```go
if _, err := io.ReadFull(r, buf[:]); err != nil { return Header{}, err }
```

`io.ReadFull` returns `io.ErrUnexpectedEOF` if the source ends with
some but not all of the requested bytes, and `io.EOF` if it ends
cleanly with zero bytes — both cases that warrant distinct handling.

## 5. Sharing a `bufio.Reader` across goroutines

```go
func process(r io.Reader, n int) error {
    br := bufio.NewReader(r)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            line, _ := br.ReadString('\n')
            handle(line)
        }()
    }
    wg.Wait()
    return nil
}
```

### Analysis

`bufio.Reader` is not safe for concurrent use. Multiple goroutines
calling `ReadString` mutate the buffer's internal state — the
read/write positions, the partial-rune tracking, the buffer backing
array — concurrently, and the result is data races caught by `-race`,
plus duplicated or dropped lines under load.

Either give each goroutine its own `bufio.Reader` over its own data
source, or serialize access to the shared reader through a
single-consumer goroutine that publishes lines to a channel.

## 6. `io.ReadAll` on an unbounded HTTP body

```go
resp, err := http.Get(url)
if err != nil { return err }
defer resp.Body.Close()
data, err := io.ReadAll(resp.Body)
```

### Analysis

`io.ReadAll` reads until the source returns `io.EOF`. A hostile or
buggy peer can send gigabytes — your service allocates a
multi-gigabyte slice and falls over with an out-of-memory crash. Any
input from the network is untrusted; bound it.

```go
const max = 10 << 20 // 10 MiB
data, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
if err != nil { return err }
if int64(len(data)) > max {
    return errors.New("response too large")
}
```

The `+1` lets you distinguish "exactly at the cap" (legal) from "more
than the cap" (rejected).

## 7. Discarding `Close`'s error on a writer

```go
func writeJSON(path string, v any) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()

    return json.NewEncoder(f).Encode(v)
}
```

### Analysis

`Encode` returns successfully — JSON is in the file's page cache.
`defer f.Close()` runs and the OS reports that the disk is full or
that a delayed write failed. The error is silently dropped because
`defer` discards return values. The caller believes the file was
written; in fact, it's truncated or missing data.

```go
func writeJSON(path string, v any) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); err == nil { err = cerr }
    }()
    return json.NewEncoder(f).Encode(v)
}
```

The named return lets the deferred close report its error if encoding
succeeded. For durability, also call `f.Sync()` before close — see
[senior.md](senior.md) section 4.

## 8. `defer` in a loop accumulating handles

```go
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()
        if err := process(f); err != nil { return err }
    }
    return nil
}
```

### Analysis

Each `defer f.Close()` registers on the *function's* defer stack and
runs only when `processAll` returns. A loop over 10 000 paths leaves
10 000 file descriptors open until the function exits. Long before
that, you hit `EMFILE` (`too many open files`) and `os.Open` starts
failing.

Pull the body into a closure so `defer` fires per iteration:

```go
for _, p := range paths {
    err := func() error {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()
        return process(f)
    }()
    if err != nil { return err }
}
```

Or close explicitly inside the loop, with the same error-aware
pattern as snippet 7.

## 9. Race between `Close` and `ReadAt`

```go
func tail(f *os.File) {
    go func() {
        time.Sleep(5 * time.Second)
        f.Close()
    }()
    buf := make([]byte, 4096)
    for off := int64(0); ; off += 4096 {
        if _, err := f.ReadAt(buf, off); err != nil {
            return
        }
    }
}
```

### Analysis

`Close` returns the file descriptor to the OS pool. The OS may
immediately reuse the FD for a different file the process opens
moments later — possibly in a totally unrelated subsystem. If
`ReadAt` is in flight on the same `*os.File` when this happens, the
syscall reads from whatever file now owns the recycled FD. The
returned bytes are real but from the wrong source; corruption is
silent.

The fix is to coordinate: either guard `Close` with a `sync.RWMutex`
that the readers also acquire, or use a `context.Context` and a
designated cancellation path that waits for in-flight reads to drain
before closing the file.

## 10. `bytes.Buffer.Bytes()` after `Reset`

```go
func capture(w *bytes.Buffer) {
    snapshot := w.Bytes()
    w.Reset()
    log.Printf("captured: %s", snapshot)
}
```

### Analysis

`bytes.Buffer.Bytes()` returns a slice that aliases the buffer's
internal backing array. `Reset` doesn't reallocate — it sets the read
and write positions to zero so subsequent writes overwrite the
existing array. After `Reset`, any later write into the buffer
clobbers the bytes the `snapshot` slice still points at, and `log`
prints whatever happens to be in the buffer at the moment it
formats — a different goroutine's data, half-written records, etc.

To keep the bytes safely past a `Reset`, copy them out:

```go
snapshot := append([]byte(nil), w.Bytes()...)
w.Reset()
log.Printf("captured: %s", snapshot)
```

The same caveat applies to `bufio.Reader.ReadSlice` and
`bufio.Scanner.Bytes`.

## 11. Copying a struct that embeds a `*os.File`

```go
type Logger struct {
    f *os.File
    mu sync.Mutex
}

func newLogger(path string) (Logger, error) {
    f, err := os.Create(path)
    if err != nil { return Logger{}, err }
    return Logger{f: f}, nil
}

func main() {
    l, _ := newLogger("app.log")
    go writeLines(l)
    go writeLines(l)
}
```

### Analysis

`Logger` is returned by value, and `writeLines(l)` takes it by value
again. The two goroutines have *copies* of the struct, each with its
own `sync.Mutex`. The mutexes are independent, so they don't
serialize anything across goroutines. The `*os.File` pointer is
shared, so the actual writes race. `go vet` catches the mutex copy.

Return `*Logger` from the constructor, and pass `*Logger` everywhere.
Better: make the type opaque via a constructor that always returns a
pointer, and document that `Logger` must not be copied.

## 12. Missing parent-directory `fsync`

```go
func atomicReplace(target string, data []byte) error {
    tmp := target + ".tmp"
    if err := os.WriteFile(tmp, data, 0o644); err != nil { return err }
    return os.Rename(tmp, target)
}
```

### Analysis

`os.Rename` is atomic for visibility — observers see the old or new
contents, never a half-file. It is not durable across crashes. After
`Rename` returns, the directory entry change is in the page cache; a
power loss before the kernel flushes the directory inode can revert
the rename. POSIX guarantees the rename's *order* relative to other
writes only after `fsync` on the parent directory.

There's a second bug: `os.WriteFile` doesn't `Sync` the file either,
so even the new contents may not be on disk at rename time. The
hardened version writes via `os.CreateTemp`, syncs, closes, renames,
then opens the parent directory and syncs it. See
[middle.md](middle.md) section 7 and [senior.md](senior.md) section 5.

## 13. Cross-filesystem rename

```go
func saveUpload(src io.Reader) error {
    f, err := os.CreateTemp("/tmp", "upload-*")
    if err != nil { return err }
    if _, err := io.Copy(f, src); err != nil {
        f.Close()
        return err
    }
    f.Close()
    return os.Rename(f.Name(), "/var/storage/upload.bin")
}
```

### Analysis

`/tmp` and `/var/storage` are typically on different filesystems —
`/tmp` is often `tmpfs`, `/var/storage` a real disk. POSIX `rename(2)`
is defined only within a single filesystem; across filesystems, it
fails with `EXDEV` ("Invalid cross-device link"). The error is
non-obvious because it works in development (where everything is on
one disk) and breaks in containerized production where mount layouts
differ.

Always create the temp file in the same directory as the eventual
target. If you must move across filesystems, fall back to a copy +
delete, but you lose the atomicity guarantee.

```go
dir := filepath.Dir(target)
f, err := os.CreateTemp(dir, "upload-*")
```

## 14. `Scanner.Bytes()` retained past the next `Scan`

```go
func parseFirstFew(r io.Reader, n int) [][]byte {
    s := bufio.NewScanner(r)
    out := make([][]byte, 0, n)
    for i := 0; i < n && s.Scan(); i++ {
        out = append(out, s.Bytes())
    }
    return out
}
```

### Analysis

`s.Bytes()` returns a slice into the scanner's internal buffer. The
buffer is reused on each `Scan`. After the loop, every entry in `out`
points at the *same underlying memory*, which now holds the bytes of
the most recent token (or whatever's there after the loop ends). All
N entries appear identical and contain the wrong data.

Either copy:

```go
out = append(out, append([]byte(nil), s.Bytes()...))
```

Or use `s.Text()`, which returns a fresh string each call (at the
cost of an allocation per token).

## 15. `Truncate` without `Seek`

```go
func overwrite(path string, data []byte) error {
    f, err := os.OpenFile(path, os.O_WRONLY, 0)
    if err != nil { return err }
    defer f.Close()
    if _, err := f.Write(data); err != nil { return err }
    return f.Truncate(int64(len(data)))
}
```

### Analysis

`Truncate(n)` resizes the file to `n` bytes but does not move the
file's position cursor. The function above writes `data`, ending the
cursor at `len(data)`, then truncates to the same size — which is
fine for this exact case. But if the previous file was longer and a
subsequent caller does `f.Write(more)`, the cursor is still past the
truncate point and Go writes past the new end of file, creating a
hole filled with zeros between the truncate point and the new write.

The general lesson: always seek explicitly after `Truncate` if you
plan to keep writing. For "replace contents" semantics, the cleaner
pattern is `os.Create` (which `O_TRUNC`s as part of opening) or the
atomic-rename pattern.

## 16. `io.Copy` with a hidden destination type

```go
func archiveLog(src, dst *os.File) error {
    counted := &countingWriter{w: dst}
    _, err := io.Copy(counted, src)
    return err
}
```

### Analysis

This isn't wrong — but it loses the kernel zero-copy fast path. With
both `src` and `dst` as `*os.File`, `io.Copy` would normally check
that `dst` implements `ReaderFrom` and call `dst.ReadFrom(src)`,
which on Linux dispatches to `copy_file_range` — bytes never enter
user space. By wrapping `dst` in `countingWriter`, you hide
`*os.File`'s `ReadFrom` method, so `io.Copy` falls back to its 32 KiB
buffer loop and shuttles every byte through user space.

If you need both observability and zero-copy, you have to choose. One
workable pattern: do the copy without the wrapper, then `Stat` the
destination to get the byte count.

## 17. Forgetting `gzip.Writer.Close`

```go
func writeGzipped(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()

    gz := gzip.NewWriter(f)
    if _, err := gz.Write(data); err != nil { return err }
    return nil
}
```

### Analysis

`gzip.Writer.Close()` does the important work for the gzip format: it
flushes the deflate stream and writes the gzip trailer (CRC32 of the
uncompressed data, length modulo 2^32). Without that trailer, the
file looks like a normal compressed stream up to the truncation
point, and `gunzip` (or any reader) reports "unexpected end of stream"
when it can't find the trailer.

Defer `gz.Close()` first (so it runs before `f.Close()`), and check
its error:

```go
defer func() {
    if cerr := gz.Close(); err == nil { err = cerr }
}()
```

Combine with the named-return pattern for the underlying file too —
otherwise gzip's close error supersedes a more interesting earlier
error.

## 18. Confusing `io.LimitReader`'s silent truncation

```go
func loadConfig(r io.Reader) (Config, error) {
    data, err := io.ReadAll(io.LimitReader(r, 4096))
    if err != nil { return Config{}, err }
    return parseConfig(data)
}
```

### Analysis

`io.LimitReader` returns `io.EOF` after `n` bytes regardless of
whether the source had more to give. If the config file is 5000 bytes,
this function silently truncates to 4096 and tries to parse a partial
file. If the parser is forgiving (e.g., YAML with optional fields),
you ship a half-loaded config with no warning at all.

Pad the cap by one and check the result:

```go
data, err := io.ReadAll(io.LimitReader(r, 4097))
if err != nil { return Config{}, err }
if len(data) > 4096 {
    return Config{}, errors.New("config larger than 4 KiB")
}
return parseConfig(data)
```

Now an oversized config returns an explicit error instead of a
mysterious parse failure half a second later.

## What to read next

- [interview.md](interview.md) — most of these bugs map directly to
  interview questions; practice articulating the analysis verbally.
- [tasks.md](tasks.md) — when you build the exercises there, watch
  for these same patterns sneaking into your own code.
- [senior.md](senior.md) — the sections referenced in the analyses
  go deeper into the contracts being violated.
