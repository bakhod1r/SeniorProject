# 8.1 `io` and File Handling — Middle

> **Audience.** You're comfortable with the basics in [junior.md](junior.md)
> and you write production code that streams files, talks HTTP, and
> shells out to other processes. This file covers composition of readers
> and writers, the in-memory pipe, custom scanner splits, atomic file
> writes, file locking, and the patterns you actually reach for in
> services rather than scripts.

## 1. Composition: the package's main idea

Every interesting helper in `io` is a *wrapper* over a `Reader` or
`Writer`. The pattern is always the same: take a value of some
interface, return a value of the same interface, and intercept the
calls in the middle. Once you see it, you can build the rest yourself.

| Helper | Wraps | Effect |
|--------|-------|--------|
| `io.LimitReader(r, n)` | `Reader` | Returns EOF after at most `n` bytes |
| `io.MultiReader(r1, r2, ...)` | `Reader` | Concatenates several readers into one |
| `io.TeeReader(r, w)` | `Reader` | On read, also writes the same bytes to `w` |
| `io.MultiWriter(w1, w2, ...)` | `Writer` | Forwards every write to all `w`s |
| `io.SectionReader(r, off, n)` | `ReaderAt` | A windowed view into a `ReaderAt` |
| `io.NopCloser(r)` | `Reader` | Adds a no-op `Close` so it satisfies `ReadCloser` |

Each is one tiny function. None of them allocates the source data. They
all stream.

### `LimitReader` — bound everything from untrusted sources

```go
const maxBody = 1 << 20 // 1 MiB
limited := io.LimitReader(req.Body, maxBody)
data, err := io.ReadAll(limited)
```

If the source has more than `maxBody` bytes, `LimitReader` returns
`io.EOF` after the cap. The data is *truncated*, not flagged as too
large. If you need to distinguish "exactly the cap" from "more than the
cap," pad the cap by one and check the result:

```go
limited := io.LimitReader(req.Body, maxBody+1)
data, err := io.ReadAll(limited)
if err != nil { return err }
if int64(len(data)) > maxBody {
    return errors.New("body too large")
}
```

### `MultiReader` — concatenate without copying

```go
header := strings.NewReader("HTTP/1.1 200 OK\r\n\r\n")
body, _ := os.Open("page.html")
defer body.Close()

io.Copy(conn, io.MultiReader(header, body))
```

`MultiReader` reads from each source in order and returns EOF only after
the last one is drained. Useful for splicing fixed prologues onto
streaming payloads, replaying a peeked prefix back in front of a
network connection, or composing a virtual file from multiple parts.

### `TeeReader` — read it and copy it

```go
h := sha256.New()
data, err := io.ReadAll(io.TeeReader(resp.Body, h))
if err != nil { return err }
fmt.Printf("downloaded %d bytes, sha256=%x\n", len(data), h.Sum(nil))
```

The hash sees every byte the consumer reads. The consumer doesn't even
know the hash exists. Use `TeeReader` to hash, log, mirror, or
checksum a stream while it flows past you.

### `MultiWriter` — write it twice

```go
out := io.MultiWriter(os.Stdout, logFile)
fmt.Fprintln(out, "request received")
```

The same line goes to stdout and to the log file. If any writer
returns an error, `MultiWriter` stops and returns it; the rest of the
writes for that call do not happen.

## 2. `io.Pipe` — a synchronous in-memory pipe between goroutines

When you have one goroutine that writes and another that reads, and you
want to connect them with the same `Reader`/`Writer` interface used
elsewhere, `io.Pipe` is the answer:

```go
pr, pw := io.Pipe()

go func() {
    defer pw.Close()
    enc := json.NewEncoder(pw)
    for _, item := range items {
        if err := enc.Encode(item); err != nil {
            pw.CloseWithError(err)
            return
        }
    }
}()

resp, err := http.Post("https://api/", "application/json", pr)
```

The producer encodes JSON into `pw`. The HTTP client reads from `pr`.
There is no buffer in between — `Write` on `pw` blocks until a `Read`
on `pr` consumes the bytes. The result: streaming JSON upload with
constant memory.

Three things to know:

1. **`Pipe` is synchronous.** Each `Write` blocks until a `Read`
   accepts it. If the reader stops, the writer blocks forever unless
   you close one side.
2. **Close on errors with `CloseWithError(err)`.** When the producer
   fails halfway, the consumer sees `err` from its next `Read` instead
   of a silent EOF.
3. **`Pipe` is goroutine-safe in one specific way:** one writer and
   one reader, each in its own goroutine. Multiple writers or multiple
   readers race.

## 3. `bytes.Buffer` vs `io.Pipe`

| Use case | `bytes.Buffer` | `io.Pipe` |
|----------|----------------|-----------|
| Same goroutine writes then reads | yes | no |
| Stream from one goroutine to another | no | yes |
| Bounded memory regardless of stream size | no | yes |
| Need `Seek` or `Bytes()` | yes | no |
| Backpressure (writer waits if reader is slow) | no | yes |

Reach for `bytes.Buffer` when you need to build something then hand it
off. Reach for `io.Pipe` when producer and consumer run concurrently
and you don't want the whole thing in memory.

## 4. Wrapping writers: the rate-limited writer

Once you're comfortable with composition, write your own wrappers. The
shape never changes:

```go
type rateWriter struct {
    w   io.Writer
    bps int                 // bytes per second
    bkt int                 // remaining quota in current second
    end time.Time           // when the current second ends
}

func newRateWriter(w io.Writer, bps int) *rateWriter {
    return &rateWriter{w: w, bps: bps, bkt: bps, end: time.Now().Add(time.Second)}
}

func (r *rateWriter) Write(p []byte) (int, error) {
    written := 0
    for len(p) > 0 {
        if time.Now().After(r.end) {
            r.bkt = r.bps
            r.end = time.Now().Add(time.Second)
        }
        if r.bkt == 0 {
            time.Sleep(time.Until(r.end))
            continue
        }
        chunk := len(p)
        if chunk > r.bkt {
            chunk = r.bkt
        }
        n, err := r.w.Write(p[:chunk])
        written += n
        r.bkt -= n
        if err != nil {
            return written, err
        }
        p = p[n:]
    }
    return written, nil
}
```

Drop it in front of any `Writer` — file, socket, multipart body — and
the whole stream slows to your cap. No coordination, no protocol.

Same shape for hashing writers, encrypting writers, logging writers,
chunking writers, and so on. Whenever you find yourself wanting "X
plus Y" where X is some existing `Writer`, write a tiny wrapper.

## 5. Wrapping readers: the line-counting reader

```go
type countingReader struct {
    r     io.Reader
    bytes int64
    lines int64
}

func (c *countingReader) Read(p []byte) (int, error) {
    n, err := c.r.Read(p)
    c.bytes += int64(n)
    c.lines += int64(bytes.Count(p[:n], []byte{'\n'}))
    return n, err
}
```

You can now wrap any `io.Reader` and ask it how many lines flowed
through, after the fact. No double-pass, no allocations beyond the
original buffer.

## 6. Custom `bufio.Scanner` split functions

`bufio.Scanner` accepts a `SplitFunc`:

```go
type SplitFunc func(data []byte, atEOF bool) (advance int, token []byte, err error)
```

The scanner calls your function with whatever bytes it has buffered.
You return:

- `advance` — how many bytes to drop from the front of the buffer.
- `token` — the next logical record to yield to the user, or `nil` if
  you need more data.
- `err` — terminate scanning.

Return `(0, nil, nil)` to ask the scanner for more bytes. Return
`(advance, nil, nil)` to skip bytes without producing a token (useful
for ignoring delimiters between records).

### Example: scan by `\r\n`

The default `bufio.ScanLines` strips `\r` from a trailing `\r\n`, but
treats lone `\r` as a line. To insist on CRLF only:

```go
func scanCRLF(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.Index(data, []byte("\r\n")); i >= 0 {
        return i + 2, data[:i], nil
    }
    if atEOF && len(data) > 0 {
        return len(data), data, nil
    }
    return 0, nil, nil
}

s := bufio.NewScanner(r)
s.Split(scanCRLF)
```

### Example: length-prefixed records

Wire formats often prefix each record with a 4-byte big-endian length:

```go
func scanLPR(data []byte, atEOF bool) (int, []byte, error) {
    if len(data) < 4 {
        if atEOF {
            return 0, nil, io.ErrUnexpectedEOF
        }
        return 0, nil, nil
    }
    n := int(binary.BigEndian.Uint32(data[:4]))
    if 4+n > len(data) {
        if atEOF {
            return 0, nil, io.ErrUnexpectedEOF
        }
        return 0, nil, nil
    }
    return 4 + n, data[4 : 4+n], nil
}
```

The same pattern handles netstrings, fixed-length records, and most
binary framing. Keep it pure: no I/O inside the split function — it
operates only on the buffer the scanner hands you.

### Raising the token-size cap

`bufio.Scanner` defaults to a 64 KiB max token. Anything larger fails
with `bufio.ErrTooLong`. To handle larger records:

```go
s := bufio.NewScanner(r)
s.Buffer(make([]byte, 0, 64*1024), 4*1024*1024) // grow up to 4 MiB
```

The first argument is the *initial* buffer; the second is the cap. The
scanner allocates upward as needed within the cap.

## 7. Atomic file writes: the rename trick

Truncating a file with `os.Create` and then writing line by line is not
atomic. A crash mid-write leaves you with a half-written file and no
way to tell. The standard pattern:

```go
func atomicWriteFile(path string, data []byte, perm fs.FileMode) (err error) {
    dir := filepath.Dir(path)
    base := filepath.Base(path)

    tmp, err := os.CreateTemp(dir, base+".tmp-*")
    if err != nil {
        return err
    }
    tmpName := tmp.Name()
    defer func() {
        if err != nil {
            os.Remove(tmpName)
        }
    }()

    if _, err = tmp.Write(data); err != nil {
        tmp.Close()
        return err
    }
    if err = tmp.Sync(); err != nil { // flush to disk
        tmp.Close()
        return err
    }
    if err = tmp.Close(); err != nil {
        return err
    }
    if err = os.Chmod(tmpName, perm); err != nil {
        return err
    }
    return os.Rename(tmpName, path) // atomic on POSIX
}
```

Three guarantees:

1. **Atomic visibility.** Either the old contents or the new contents
   are visible at `path`. Never a half-file.
2. **Survives a crash.** The temp file is named `*.tmp-XXXXX`; clean it
   up on startup with a glob if you're paranoid.
3. **Same directory.** `os.Rename` is atomic only within a single
   filesystem. Putting the temp next to the target guarantees that.

Add `tmp.Sync()` for durability — without it, a power loss right after
`Rename` can still lose the new contents on some filesystems. With it,
the data is on stable storage before the rename.

## 8. File locking — there isn't one in stdlib

Go's standard library does not export file locking. `*os.File` has no
`Lock` method. If you need a process-level mutex, you have three
options:

1. Use a Unix-specific syscall:
   ```go
   import "syscall"
   syscall.Flock(int(f.Fd()), syscall.LOCK_EX)
   ```
   This blocks until the lock is held. Pair with `LOCK_UN` to release.
   `LOCK_EX|LOCK_NB` returns `EWOULDBLOCK` immediately if held.

2. Use a third-party wrapper: `github.com/gofrs/flock` is the
   well-maintained one and works on Windows (via `LockFileEx`) and on
   Unix (via `flock`).

3. Use a sentinel file with `O_CREATE|O_EXCL`:
   ```go
   lock, err := os.OpenFile("dir/.lock",
       os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
   if err != nil {
       return errors.New("locked by another process")
   }
   defer os.Remove(lock.Name())
   defer lock.Close()
   ```
   Crude but works on every filesystem. The downside: a crashed
   process leaves the lock behind.

## 9. `os.File.Sync` and durability

`Write` on a file does not, by itself, guarantee that the bytes are on
the physical disk. The OS buffers writes in memory ("page cache") and
flushes them later. A crash before the flush loses the data even
though `Write` returned no error.

`(*os.File).Sync()` tells the OS to push the file's buffered contents
to stable storage. Use it when:

- You're about to do something irreversible based on the file's
  contents (rename it into place, send a message saying "uploaded",
  delete the source).
- You're writing a write-ahead log or anything where partial loss is
  worse than the latency cost.

Do not use it on every `Write` — `Sync` is one of the slower syscalls
on most systems. Batch writes, then sync once.

For directories: after creating or deleting files, you may also need
to `Sync` the *parent directory* to make the rename or unlink durable.
Open the directory with `os.Open(dir)` and call `Sync()` on it. This
matters mostly for crash-safe filesystems like ext4 with default
mount options.

## 10. Reading at offsets: `ReaderAt`

`io.ReaderAt` is for sources that can be read from any offset without
moving a position cursor:

```go
type ReaderAt interface {
    ReadAt(p []byte, off int64) (n int, err error)
}
```

`*os.File` implements it (via `pread` on POSIX). `bytes.Reader` and
`strings.Reader` do too. Use it when you need to read different parts
of a file from different goroutines without coordination — `ReadAt`
does not interact with the file's seek position, so concurrent calls
are safe.

```go
const recordSize = 1024
var f *os.File // assume open

// Read record number i.
buf := make([]byte, recordSize)
_, err := f.ReadAt(buf, int64(i)*recordSize)
```

This is how `database/sql` drivers, BoltDB, BadgerDB, and similar
storage engines read pages from disk concurrently. Combined with
`io.SectionReader`, you can hand a goroutine a "view" of a slice of
the file:

```go
section := io.NewSectionReader(f, off, length)
io.Copy(out, section) // streams just that section
```

`SectionReader` is itself a `ReadSeeker`, so it composes nicely with
APIs that expect one (e.g., `http.ServeContent`).

## 11. Writing at offsets: `WriterAt`

The mirror of `ReaderAt`. `(*os.File).WriteAt` does not interact with
the seek position and is safe to call concurrently as long as the
ranges do not overlap. Same pattern: storage engines, parallel
downloaders that fill different parts of a destination file at the
same time.

```go
// goroutine A
f.WriteAt(chunkA, 0)
// goroutine B
f.WriteAt(chunkB, int64(len(chunkA)))
```

The OS guarantees each write is atomic at the page level (typically
4 KiB on Linux). For larger writes, you may see a partial result
visible to a concurrent reader. If you need stronger guarantees, lock
explicitly.

## 12. `io.Copy` shortcut interfaces

`io.Copy` is smart: if the destination implements `ReaderFrom` or the
source implements `WriterTo`, it skips its internal buffer and lets
those methods do the work. This is how `*os.File` to `*os.File` copies
hit `copy_file_range` or `sendfile` on Linux for kernel-side copying.

```go
// On Linux, this can copy without ever moving bytes through user space.
io.Copy(dstFile, srcFile)
```

You can implement `ReaderFrom` on your own writer for a fast path, or
implement `WriterTo` on your own reader. Most of the time you don't
need to — the stdlib types already do.

If you want to *force* the generic 32 KiB-buffer path (for testing, or
to see the bytes pass through the user space), use `io.CopyBuffer` and
pass an explicit buffer.

## 13. Reading text efficiently: `bufio.Reader.ReadSlice` and friends

`bufio.Reader` has more methods than `bufio.Scanner` exposes:

| Method | Returns | Notes |
|--------|---------|-------|
| `ReadString(delim byte)` | `string`, error | Allocates per call |
| `ReadBytes(delim byte)` | `[]byte`, error | Allocates per call |
| `ReadSlice(delim byte)` | `[]byte`, error | **Aliases the buffer** — invalid after next read |
| `ReadLine()` | `[]byte`, isPrefix bool, err | Low-level, used by `Scanner` internally |
| `Peek(n int)` | `[]byte`, error | Look ahead without consuming |

`ReadSlice` is the fastest because it returns a slice into the
internal buffer with no copy. The price: any subsequent read on the
same `bufio.Reader` invalidates the slice. Treat it like a borrowed
view — read it, copy out anything you need to keep, discard.

`Peek` is invaluable for protocol detection ("is this gzip-encoded?
HTTP/1 or HTTP/2?"). You can examine the next N bytes without
removing them; the next `Read` still sees them.

## 14. JSON streaming with `Decoder` and `Encoder`

These compose with everything in this leaf:

```go
// Decode a stream of newline-delimited JSON values.
dec := json.NewDecoder(r) // r is any io.Reader
for {
    var v Event
    if err := dec.Decode(&v); err != nil {
        if errors.Is(err, io.EOF) {
            break
        }
        return err
    }
    process(v)
}

// Encode straight to a writer (no intermediate buffer).
enc := json.NewEncoder(w) // w is any io.Writer
enc.SetIndent("", "  ")
for _, v := range items {
    if err := enc.Encode(v); err != nil {
        return err
    }
}
```

Compare with `json.Marshal` + `w.Write`: that path allocates the full
JSON in memory first. For streaming endpoints, `Encoder` keeps memory
flat regardless of payload size. Same idea for `xml.Decoder` and
`csv.Reader`.

## 15. HTTP body handling: drain and close

This is the bug everyone makes once:

```go
resp, err := http.Get(url)
if err != nil { return err }
defer resp.Body.Close()

if resp.StatusCode != 200 {
    return fmt.Errorf("status %d", resp.StatusCode) // body not drained
}
```

If you don't read the body, the HTTP client cannot reuse the
underlying TCP connection. Under load, you accumulate sockets in
TIME_WAIT and stall. The fix:

```go
defer func() {
    io.Copy(io.Discard, resp.Body) // drain
    resp.Body.Close()
}()
```

`io.Copy(io.Discard, ...)` is the idiomatic "throw it away" call.
Without the drain, every error path leaks a connection.

## 16. `httptest.NewRecorder` and other testing helpers

When you write code that takes an `io.Reader` or `io.Writer`, you can
test it without a real file or socket. The standard library and tests
should look like:

```go
func TestCat(t *testing.T) {
    var out bytes.Buffer
    in := strings.NewReader("one\ntwo\nthree\n")
    if err := cat(in, &out); err != nil {
        t.Fatal(err)
    }
    if got, want := out.String(), "one\ntwo\nthree\n"; got != want {
        t.Errorf("got %q want %q", got, want)
    }
}
```

For HTTP handlers, `httptest.NewRecorder` is an `http.ResponseWriter`
backed by a buffer, perfect for asserting on what your handler wrote.
For full HTTP integration tests, `httptest.NewServer` spins up a
goroutine-backed server you can hit with a real client.

## 17. `os.DirFS`, `embed`, and the `io/fs` boundary

A growing slice of the stdlib operates on the `io/fs.FS` interface
rather than on real OS paths. The pattern:

```go
import (
    "embed"
    "io/fs"
    "net/http"
)

//go:embed templates assets
var content embed.FS

http.Handle("/", http.FileServer(http.FS(content)))
```

`embed.FS` implements `fs.FS`. So does `os.DirFS("/var/www")`. Your
own code that operates on `fs.FS` works identically against an
embedded asset bundle, a directory, a zip file, or an in-memory tree
(`testing/fstest.MapFS`).

When you write code that needs to read files but doesn't otherwise
care about the OS, take an `fs.FS` parameter. Tests will become a
single line:

```go
fsys := fstest.MapFS{
    "config.yaml": &fstest.MapFile{Data: []byte("debug: true")},
}
loadConfig(fsys, "config.yaml")
```

No tempdir, no cleanup, no race with parallel tests.

## 18. Zero-copy and `io.WriterTo`

If you want your custom reader to participate in the fast path inside
`io.Copy`, implement `WriterTo`:

```go
type chunkReader struct {
    chunks [][]byte
}

func (c *chunkReader) WriteTo(w io.Writer) (int64, error) {
    var total int64
    for _, b := range c.chunks {
        n, err := w.Write(b)
        total += int64(n)
        if err != nil {
            return total, err
        }
    }
    return total, nil
}
```

Now `io.Copy(w, c)` calls `c.WriteTo(w)` directly and never allocates
a 32 KiB intermediate buffer. The same idea on the other side: a
writer that wants to participate implements `ReadFrom`. Stdlib
examples include `bytes.Buffer`, `*os.File`, and `*net.TCPConn`.

## 19. Filepath portability: `path` vs `path/filepath`

Two packages, easy to mix up.

| Package | Separator | Use for |
|---------|-----------|---------|
| `path` | always `/` | URL paths, slash-paths in `embed.FS`, virtual paths |
| `path/filepath` | OS-specific (`/` or `\`) | Real filesystem paths |

For `os.Open`, always use `path/filepath.Join`, never `path.Join` or
naive `+`. On Windows, the separator differs and slashes-only paths
work in some contexts but not others.

```go
// CORRECT
p := filepath.Join("data", subdir, "report.csv")
f, _ := os.Open(p)

// WRONG on Windows
p := "data/" + subdir + "/report.csv"
```

`filepath.Clean` removes redundant separators and `..`/`.` components
— but it does *not* prevent path traversal. If you accept a
user-supplied filename, validate it explicitly (no `..`, no absolute
paths, no leading separator).

## 20. Concurrency rules

The `io` package itself is interface-defined, so concurrency depends on
the implementation. The stdlib documents these guarantees:

| Type | Concurrent reads/writes safe? |
|------|-------------------------------|
| `*os.File` | Yes, but `Read` and `Seek` are not safe to mix concurrently with each other |
| `bytes.Buffer` | No |
| `bytes.Reader` | Yes (read-only) |
| `strings.Reader` | Yes (read-only) |
| `bufio.Reader` | No |
| `bufio.Writer` | No |
| `bufio.Scanner` | No |
| `io.Pipe` | One reader + one writer goroutine |
| `*net.TCPConn` | Yes (separate `Read` and `Write`) |

Default assumption: **stateful wrappers (`bufio`, `bytes.Buffer`,
`Scanner`) are not safe for concurrent use**. Either give each
goroutine its own, or guard with a mutex.

For `*os.File`, concurrent `Read`s race because they share the
position cursor. Use `ReadAt` for concurrent reads at known offsets,
or serialize. Same for `Write` vs `WriteAt`.

## 21. A real pipeline: hash, gzip, write

Composition of three wrappers, no temporary file:

```go
func archive(src io.Reader, dst io.Writer) (sum [32]byte, err error) {
    h := sha256.New()
    tee := io.TeeReader(src, h)

    gz := gzip.NewWriter(dst)
    defer func() {
        if cerr := gz.Close(); err == nil {
            err = cerr
        }
    }()

    if _, err = io.Copy(gz, tee); err != nil {
        return sum, err
    }
    copy(sum[:], h.Sum(nil))
    return sum, nil
}
```

Read flow: `src` → `TeeReader` (hashes) → `io.Copy` reads from tee →
writes into `gzip.Writer` → which writes compressed bytes into `dst`.
Constant memory, single pass, exact hash of the *plaintext*.

This kind of pipeline is the dividend for putting interfaces at the
seams of every function that handles bytes. Try writing it without
`io.Reader`/`io.Writer` and you'll end up with intermediate buffers
and double-traversals.

## 22. What to read next

- [senior.md](senior.md) — the formal `Reader`/`Writer` contracts,
  `Close` semantics, durability, and the deeper `io/fs` story.
- [professional.md](professional.md) — production patterns for
  large-scale streaming, retries, partial writes, and observability.
- [find-bug.md](find-bug.md) — drills based on the bugs in this file.
- [tasks.md](tasks.md) — exercises that practice composition and
  custom split functions.
