# 8.1 `io` and File Handling — Junior

> **Audience.** You've written some Go and can read errors, but file I/O
> is still mostly `os.ReadFile` for you. By the end of this file you will
> know the four interfaces that everything in the standard library is
> built around, the half-dozen functions you actually need every day, and
> the dozen patterns that turn into 80% of real-world I/O code.

## 1. The two interfaces that run the world

Open the `io` package source and the very first thing you see is two
tiny interfaces:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

That's it. Everything that produces bytes — files, network connections,
HTTP request bodies, gzip decompressors, in-memory buffers — implements
`Reader`. Everything that accepts bytes implements `Writer`. Almost every
useful function in the standard library that handles bytes is written
against these two interfaces, not against concrete types.

The first time this clicks, a lot of code stops looking magical. When you
see a function that takes an `io.Reader`, you can pass it a file, a
`bytes.Buffer`, a `strings.Reader`, an HTTP body, a network socket, or
the output of another reader — and the function does not know or care
which. That is the whole game.

```go
package main

import (
    "fmt"
    "io"
    "os"
    "strings"
)

func countBytes(r io.Reader) (int64, error) {
    return io.Copy(io.Discard, r) // counts everything r produces
}

func main() {
    n, err := countBytes(strings.NewReader("hello, world"))
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    fmt.Println(n) // 12
}
```

The same `countBytes` works for an `*os.File`, an `*http.Response.Body`,
a `gzip.Reader`, or a `bytes.Buffer`. That is the dividend you collect
for accepting `io.Reader` instead of `*os.File`.

## 2. The two friends: `Closer` and `Seeker`

Two more single-method interfaces show up almost as often:

```go
type Closer interface {
    Close() error
}

type Seeker interface {
    Seek(offset int64, whence int) (int64, error)
}
```

Files, network connections, and pipes implement `Closer` because they
hold OS resources that need to be released. `bytes.Buffer` does not — it
has no resource to release. When you receive a value typed as
`io.Reader`, you cannot assume it is closeable. When you receive
`io.ReadCloser` (a composition), you must close it.

```go
type ReadCloser interface {
    Reader
    Closer
}
```

Composite interfaces in `io` are just `Reader` plus one or two of the
others. You'll see `ReadCloser`, `WriteCloser`, `ReadWriter`,
`ReadWriteCloser`, `ReadSeeker`, etc. Pattern: the name is the methods,
in alphabetical order.

## 3. Opening, reading, writing files (the four-line versions)

For small files, the standard library gives you single-call helpers:

```go
data, err := os.ReadFile("config.json")
if err != nil {
    return err
}
// use data ([]byte)

err = os.WriteFile("out.txt", []byte("hello\n"), 0o644)
if err != nil {
    return err
}
```

`os.ReadFile` reads the entire file into a single `[]byte`. Use it only
when you know the file is small (a configuration, a short fixture, a
template). For anything user-controlled or unbounded, use streaming.

`os.WriteFile` takes the data plus a permissions mode and atomically
truncates the file before writing. The mode is a Unix permission
expressed as an octal literal — `0o644` means owner read+write, group
read, world read. On Windows, the bits are mostly ignored except for the
read-only flag.

## 4. Streaming files: `os.Open`, `os.Create`, `os.OpenFile`

For anything but tiny files, you want a stream:

```go
f, err := os.Open("big.csv") // O_RDONLY
if err != nil {
    return err
}
defer f.Close()

scanner := bufio.NewScanner(f)
for scanner.Scan() {
    line := scanner.Text()
    _ = line
}
if err := scanner.Err(); err != nil {
    return err
}
```

Three constructors cover almost every case:

| Function | Flags | Use it for |
|----------|-------|------------|
| `os.Open(name)` | `O_RDONLY` | Reading existing files |
| `os.Create(name)` | `O_RDWR|O_CREATE|O_TRUNC` (0o666) | Creating or truncating a file for writing |
| `os.OpenFile(name, flag, perm)` | Whatever you pass | Append-only logs, exclusive create, O_SYNC, etc. |

`os.OpenFile` is the escape hatch when the other two don't fit:

```go
// Append to a log file, create if missing, never truncate.
f, err := os.OpenFile("app.log",
    os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
```

The flag constants are bit masks; OR them together. The permission is
only consulted when `O_CREATE` is set and the file does not yet exist.

### `defer f.Close()` and its lies

`defer f.Close()` is fine for files you only read from. For files you
write to, it can hide errors. `Close` on a writeable file is when the OS
flushes any pending data and tells you whether the disk actually
accepted it. A successful `Write` followed by a failing `Close` means
your data is not on disk. We'll come back to this in middle.md, but for
now: when you write important data, **check the error from `Close`**.

```go
f, err := os.Create("important.txt")
if err != nil { return err }
defer func() {
    if cerr := f.Close(); cerr != nil && err == nil {
        err = cerr
    }
}()
// ... writes ...
return err
```

## 5. The big workhorse: `io.Copy`

Almost every "move bytes from A to B" task is a one-liner:

```go
n, err := io.Copy(dst, src) // n is bytes copied
```

`io.Copy` reads from `src` until EOF and writes to `dst`. It uses a 32 KB
internal buffer by default, or a larger one if either side implements
`WriteTo` / `ReadFrom` (which `*os.File` does on most platforms via
`copy_file_range` or `sendfile`).

You can copy a file to stdout, an HTTP body to a file, a `gzip.Reader`
to a hash, or anything else, all with the same call:

```go
// Save an HTTP response body to disk.
out, err := os.Create("download.bin")
if err != nil { return err }
defer out.Close()

if _, err := io.Copy(out, resp.Body); err != nil {
    return err
}
```

If you want to cap the number of bytes copied (defense against gigabyte
HTTP bodies), use `io.CopyN` or wrap the source in `io.LimitReader`.

```go
const maxBody = 10 << 20 // 10 MiB
limited := io.LimitReader(resp.Body, maxBody)
data, err := io.ReadAll(limited)
```

## 6. `io.ReadAll` (was `ioutil.ReadAll`)

```go
data, err := io.ReadAll(r) // []byte, all of it
```

Same trade-off as `os.ReadFile`: convenient, but allocates one big
buffer and keeps reading until EOF. Pair it with `io.LimitReader`
whenever the source is not fully under your control.

## 7. EOF — what it actually means

`io.EOF` is a sentinel error value, not a condition. A `Reader` returns
`(0, io.EOF)` to say "I have no more data and never will." Critically:

- A read may return `(n > 0, nil)` and then `(0, io.EOF)` on the next call.
- A read may also return `(n > 0, io.EOF)` in a single call — meaning
  "here is some data, and there is no more after it." Both forms are
  legal. Code that handles only the first form will eventually drop a
  trailing chunk.

The bullet-proof loop:

```go
for {
    n, err := r.Read(buf)
    if n > 0 {
        process(buf[:n])
    }
    if err == io.EOF {
        break
    }
    if err != nil {
        return err
    }
}
```

In practice you should rarely write this by hand. Use `io.Copy`,
`io.ReadAll`, `io.ReadFull`, or a `bufio.Scanner`. They handle EOF
correctly so you don't have to.

## 8. Filling a buffer exactly: `io.ReadFull` and `io.ReadAtLeast`

`Reader.Read` is allowed to return fewer bytes than you asked for, even
when more are coming. If you need exactly N bytes (a header, a fixed
record), use `io.ReadFull`:

```go
header := make([]byte, 8)
if _, err := io.ReadFull(r, header); err != nil {
    return err // io.ErrUnexpectedEOF if fewer than 8 bytes were available
}
```

`io.ReadAtLeast(r, buf, min)` is the more flexible variant: read until at
least `min` bytes are in `buf`, or fail.

The errors are precise:

- Zero bytes available, source closed cleanly → `io.EOF`.
- Some bytes available but fewer than required → `io.ErrUnexpectedEOF`.
- `min > len(buf)` → `io.ErrShortBuffer`.

Treat these distinctly when the difference matters (a truncated file is
a different problem from an empty one).

## 9. Buffered I/O: `bufio.Reader` and `bufio.Writer`

Raw `*os.File` reads go through a syscall every call. For lots of small
reads, that is slow. `bufio.NewReader` wraps a `Reader` and reads in
larger chunks (4096 bytes by default), serving your `Read`/`ReadByte`/
`ReadString` calls from the in-memory buffer.

```go
f, err := os.Open("input.txt")
if err != nil { return err }
defer f.Close()

br := bufio.NewReader(f)
line, err := br.ReadString('\n') // includes the '\n'
```

The corresponding `bufio.NewWriter` collects small writes and flushes
them in larger chunks. **Always call `Flush` before the writer goes out
of scope or you will lose data**:

```go
f, err := os.Create("out.txt")
if err != nil { return err }
defer f.Close()

bw := bufio.NewWriter(f)
defer bw.Flush() // before f.Close runs

for _, line := range lines {
    if _, err := bw.WriteString(line + "\n"); err != nil {
        return err
    }
}
```

The two `defer`s run last-in-first-out, so `bw.Flush()` runs before
`f.Close()`. If you swap the order, your buffered bytes never reach
the file.

## 10. Line scanning: `bufio.Scanner`

For text files where you process one record at a time, `bufio.Scanner`
is the friendliest API in the package:

```go
f, err := os.Open("access.log")
if err != nil { return err }
defer f.Close()

s := bufio.NewScanner(f)
for s.Scan() {
    line := s.Text()        // string, no trailing '\n'
    _ = line
    // s.Bytes() if you don't want the allocation
}
if err := s.Err(); err != nil {
    return err
}
```

Things to know on day one:

1. `Scanner` defaults to splitting on lines but uses a default token
   size cap of `bufio.MaxScanTokenSize` (64 KiB). A line longer than
   that returns `bufio.ErrTooLong`. For long lines, call
   `s.Buffer(make([]byte, 0, initial), max)` to raise the ceiling.
2. `Scan()` returns `false` both at clean EOF and on error. You must
   check `s.Err()` afterwards.
3. The slice returned by `s.Bytes()` is reused across calls. Copy it if
   you want to keep it past the next `Scan`.

You can change the splitter:

```go
s.Split(bufio.ScanWords)  // whitespace-separated tokens
s.Split(bufio.ScanRunes)  // one UTF-8 rune at a time
s.Split(bufio.ScanBytes)  // one byte at a time
```

Or write your own split function — covered in middle.md.

## 11. Discarding output: `io.Discard`

`io.Discard` is an `io.Writer` that always succeeds and counts nothing.
Use it when you need a `Writer` for some API but actually want to throw
the bytes away:

```go
n, err := io.Copy(io.Discard, resp.Body) // count bytes, drop them
```

Pair it with `io.Copy` to drain a response body so the underlying TCP
connection can be reused — very common in HTTP clients.

## 12. In-memory readers and writers

When testing, you don't want a real file. The `bytes` and `strings`
packages give you ready-made implementations:

```go
r := strings.NewReader("hello, world")  // io.Reader, also Seeker, ByteReader, RuneReader
b := &bytes.Buffer{}                    // io.ReadWriter, also fmt.Stringer
b.WriteString("hello")
fmt.Println(b.String())                 // "hello"
io.Copy(os.Stdout, b)                   // drains b
```

`bytes.Buffer` is the do-everything in-memory reader/writer. It grows as
you write, lets you read back what you wrote, and is the right tool for
"I need to build a payload and then send it."

Two warnings:

1. After you read from a `bytes.Buffer`, those bytes are gone — it's
   not a window. Use `bytes.NewReader([]byte)` for a re-readable view.
2. A `bytes.Buffer` is not safe for concurrent use. One goroutine
   writing while another reads is a race. Use a channel, a `sync.Mutex`,
   or `io.Pipe` instead.

## 13. Standard streams: `os.Stdin`, `os.Stdout`, `os.Stderr`

These are `*os.File` values, so they implement `Reader` and `Writer`.
You can pass them anywhere those interfaces are expected.

```go
io.Copy(os.Stdout, os.Stdin) // crude `cat`
fmt.Fprintln(os.Stderr, "log line")
```

Inside tests, you often don't want to write to the real stdout. Take a
`io.Writer` parameter instead, default to `os.Stdout` in `main`, and
swap it for a `bytes.Buffer` in tests.

## 14. File metadata: `os.Stat`, `os.FileInfo`

To read file size, modification time, or permission bits without opening
the file, use `os.Stat`:

```go
info, err := os.Stat("data.bin")
if err != nil {
    if errors.Is(err, fs.ErrNotExist) {
        // file not present
    }
    return err
}
fmt.Println(info.Size(), info.Mode(), info.ModTime())
```

Use `errors.Is(err, fs.ErrNotExist)` (or `os.IsNotExist`, the older
form) to distinguish "missing" from other errors. `fs.ErrNotExist`
is preferred in new code.

`os.Lstat` is the same but does not follow symlinks.

## 15. Directories: read, walk, make

```go
// List a directory.
entries, err := os.ReadDir("/var/log")
for _, e := range entries {
    fmt.Println(e.Name(), e.IsDir())
}

// Walk a tree.
err = filepath.WalkDir("/etc", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() && d.Name() == ".git" {
        return filepath.SkipDir
    }
    fmt.Println(path)
    return nil
})

// Make a directory tree.
err = os.MkdirAll("a/b/c", 0o755)
```

`os.ReadDir` returns lightweight `fs.DirEntry` values — you only pay for
a full `Stat` when you ask for one (`d.Info()`). For huge directories,
this is much faster than the older `(*os.File).Readdir`.

`filepath.WalkDir` is the modern walker. Return `filepath.SkipDir` to
prune a subtree, return any other error to abort the walk.

## 16. Removing files and directories

```go
os.Remove("file.txt")            // single file or empty directory
os.RemoveAll("./build")          // tree, like `rm -rf`
os.Rename("a", "b")              // also moves across directories on the same filesystem
```

`os.Remove` returns an error wrapping `fs.ErrNotExist` if the target is
already gone. Often you don't care; check with `errors.Is` if you do.

## 17. Temporary files and directories

```go
// File in $TMPDIR with a unique suffix.
tf, err := os.CreateTemp("", "upload-*.bin")
if err != nil { return err }
defer os.Remove(tf.Name())
defer tf.Close()

// Directory in $TMPDIR.
td, err := os.MkdirTemp("", "build-*")
if err != nil { return err }
defer os.RemoveAll(td)
```

Both are atomic in the sense that they will never collide with another
caller. Always pair them with cleanup using `defer` — temp files are
your responsibility, the OS will not clean them on a normal exit.

In tests, prefer `t.TempDir()`, which auto-cleans when the test ends:

```go
func TestThing(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "out.txt")
    // use path, no manual cleanup needed
}
```

## 18. Putting it together: a minimal `cat`

```go
package main

import (
    "fmt"
    "io"
    "os"
)

func cat(paths []string, out io.Writer) error {
    if len(paths) == 0 {
        _, err := io.Copy(out, os.Stdin)
        return err
    }
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return fmt.Errorf("open %s: %w", p, err)
        }
        if _, err := io.Copy(out, f); err != nil {
            f.Close()
            return fmt.Errorf("copy %s: %w", p, err)
        }
        if err := f.Close(); err != nil {
            return fmt.Errorf("close %s: %w", p, err)
        }
    }
    return nil
}

func main() {
    if err := cat(os.Args[1:], os.Stdout); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

That's a real, correct `cat`. It streams (no full file in memory),
checks every error, wraps errors with context, and is testable because
`cat` takes an `io.Writer` rather than writing to `os.Stdout` directly.
This shape — accept interfaces, return errors with `%w` wrapping, close
in reverse order, never assume the buffer was filled — is most of what
production Go I/O code looks like.

## 19. A minimal `wc -l`

```go
func countLines(r io.Reader) (int, error) {
    s := bufio.NewScanner(r)
    n := 0
    for s.Scan() {
        n++
    }
    return n, s.Err()
}
```

Three lines of logic, one error check. The same function counts lines
in a file (if you pass `f`), in a string (`strings.NewReader`), in an
HTTP response, or in stdin.

## 20. A minimal "copy with progress"

```go
type progressWriter struct {
    w     io.Writer
    total int64
}

func (p *progressWriter) Write(b []byte) (int, error) {
    n, err := p.w.Write(b)
    p.total += int64(n)
    fmt.Fprintf(os.Stderr, "\r%d bytes", p.total)
    return n, err
}

func main() {
    src, _ := os.Open("big.iso")
    defer src.Close()
    dst, _ := os.Create("copy.iso")
    defer dst.Close()

    pw := &progressWriter{w: dst}
    io.Copy(pw, src)
    fmt.Fprintln(os.Stderr)
}
```

Wrapping a `Writer` to add behavior is the single most useful pattern
in the package. You'll do it constantly: rate limiting, hashing,
compression, encryption, logging, mirroring to a second sink. Every one
of those is "make a struct that has a `Writer` field, implement `Write`,
forward."

## 21. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| Truncated output | Forgot `bufio.Writer.Flush()` before `Close()` |
| `bufio.ErrTooLong` | Default `Scanner` token cap of 64 KiB exceeded |
| `read` returns `(0, nil)` forever | Reading past EOF without checking the error each call |
| File permission denied on creation | Wrong `perm` on `OpenFile` or restrictive umask |
| Same file copied to itself produces zero bytes | Truncating the destination first then reading from it |
| Random bytes at the end of a file | Reusing a `[]byte` buffer across reads, then writing the full `cap` instead of `[:n]` |

The last one bites everyone exactly once. The fix:

```go
n, err := r.Read(buf)
// CORRECT: only the first n bytes are valid
w.Write(buf[:n])
// WRONG:
// w.Write(buf)
```

## 22. What to read next

- [middle.md](middle.md) — composition (`MultiReader`, `TeeReader`,
  `Pipe`), custom split functions, file locking, `sync` integration.
- [senior.md](senior.md) — exact `Reader`/`Writer` contract, the pitfalls
  in `Close`, `os.File.Sync` and durability, the `io/fs` adapter layer.
- [tasks.md](tasks.md) — ten exercises that put this junior material
  into practice.
- The official package docs:
  [`io`](https://pkg.go.dev/io),
  [`bufio`](https://pkg.go.dev/bufio),
  [`os`](https://pkg.go.dev/os).
