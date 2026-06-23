# 8.6 `bufio` — Junior

> **Audience.** You can open a file, call `Read` and `Write`, and you've
> seen `bufio.NewScanner` in someone else's code. By the end of this
> file you will know why `bufio` exists, the three types it gives you
> (`Reader`, `Writer`, `Scanner`), and the dozen or so methods that
> cover 90% of buffered I/O in Go.

If you haven't read
[../01-io-and-file-handling/junior.md](../01-io-and-file-handling/junior.md)
yet, do that first. This file builds on `io.Reader` / `io.Writer`.

## 1. Why `bufio` exists

Every call to `(*os.File).Read` is a `read(2)` syscall. Syscalls cost
hundreds of nanoseconds plus a context switch. If you read a 1 MiB file
one byte at a time, you make a million syscalls. That is slow.

`bufio.Reader` wraps any `io.Reader` and reads in larger chunks (4096
bytes by default) into an internal buffer. Your `ReadByte`, `ReadRune`,
`ReadString`, `ReadSlice` calls are served from that buffer until it
empties. Only then does `bufio.Reader` call the underlying `Read` again.

```go
package main

import (
    "bufio"
    "fmt"
    "os"
)

func main() {
    f, _ := os.Open("input.txt")
    defer f.Close()

    br := bufio.NewReader(f)
    b, _ := br.ReadByte() // one syscall might cover thousands of these
    fmt.Println(b)
}
```

`bufio.Writer` is the mirror image. Your small `Write` calls are
collected into the buffer, and only when it fills (or you call `Flush`)
does the underlying `Write` happen. Same idea, opposite direction.

```go
bw := bufio.NewWriter(f)
for i := 0; i < 1_000_000; i++ {
    bw.WriteByte('x')
}
bw.Flush() // one syscall, not a million
```

`bufio.Scanner` is a higher-level convenience built on top of
`bufio.Reader` for reading delimited records — usually lines.

## 2. The three constructors

```go
br := bufio.NewReader(r)            // 4096-byte buffer
bw := bufio.NewWriter(w)            // 4096-byte buffer
brBig := bufio.NewReaderSize(r, n)  // n-byte buffer (min 16)
bwBig := bufio.NewWriterSize(w, n)  // n-byte buffer (min 16)
sc := bufio.NewScanner(r)           // wraps a 4096-byte buffer internally
```

Two notes:

- `NewReaderSize` and `NewWriterSize` enforce a minimum of 16 bytes. A
  smaller request is silently bumped to 16.
- `NewReader(r)` where `r` is already a `*bufio.Reader` of adequate
  size returns the existing one. The library avoids double-buffering.

For most files, the default 4096 is fine — it matches the typical
disk page size. Bump it for very large reads where syscall count is
the bottleneck (covered in [optimize.md](optimize.md)).

## 3. `bufio.Reader` — the methods you use every day

```go
br := bufio.NewReader(f)

n, err := br.Read(buf)           // standard io.Reader
b, err := br.ReadByte()          // one byte
err := br.UnreadByte()           // push the last ReadByte back

r, size, err := br.ReadRune()    // one UTF-8 rune
err := br.UnreadRune()           // push the last ReadRune back

line, err := br.ReadString('\n') // string up to and including '\n'
line, err := br.ReadBytes('\n')  // []byte up to and including '\n'

peek, err := br.Peek(8)          // see the next 8 bytes without consuming
discarded, err := br.Discard(64) // skip 64 bytes
buffered := br.Buffered()        // bytes currently in buffer
size := br.Size()                // buffer capacity

br.Reset(otherReader)            // reuse the bufio.Reader for another source
```

The most common pattern, at least at first, is `ReadString('\n')`:

```go
for {
    line, err := br.ReadString('\n')
    if len(line) > 0 {
        process(line) // includes the trailing '\n', if any
    }
    if err == io.EOF {
        break
    }
    if err != nil {
        return err
    }
}
```

Note the same EOF dance from
[../01-io-and-file-handling/junior.md](../01-io-and-file-handling/junior.md):
the last line might come back as `(line, io.EOF)` with `line` non-empty.
Process the bytes before checking the error.

## 4. `Peek` — look ahead without consuming

```go
sig, err := br.Peek(2)
if err != nil { return err }
if sig[0] == 0x1f && sig[1] == 0x8b {
    // gzip magic — switch to a gzip.Reader
    gz, _ := gzip.NewReader(br)
    // ... continue reading from gz
}
```

`Peek(n)` returns a slice of the next `n` bytes without removing them
from the buffer. The next `Read`, `ReadByte`, etc. still sees those
bytes. Useful for content-type sniffing, magic-byte detection, and any
"is this what I think it is?" check.

Two limits:

- `n` cannot exceed the buffer size. `Peek(8192)` on a 4096-byte buffer
  fails with `bufio.ErrBufferFull`.
- The slice is invalidated by the next read on the same `bufio.Reader`.
  Copy if you need to keep it.

## 5. `Discard` — skip bytes cheaply

```go
// Skip an HTTP header you don't care about.
br.Discard(int(contentLength))
```

`Discard(n)` advances the position by `n` bytes without copying them
anywhere. Faster than reading into a throwaway buffer. Returns the
number actually skipped — fewer than `n` only if EOF is hit first.

## 6. `bufio.Writer` — the methods you use every day

```go
bw := bufio.NewWriter(f)

n, err := bw.Write(p)            // io.Writer
err := bw.WriteByte('!')         // one byte
n, err := bw.WriteRune('é')      // UTF-8 encoding of one rune
n, err := bw.WriteString("hi")   // string

avail := bw.Available()          // free bytes in buffer
buffered := bw.Buffered()        // bytes waiting to flush
size := bw.Size()                // buffer capacity

err := bw.Flush()                // push buffered bytes to underlying writer
bw.Reset(otherWriter)            // reuse the bufio.Writer for another sink
```

There is no `Close` on `bufio.Writer`. The underlying writer (e.g.,
`*os.File`) has its own `Close`. Yours job: `Flush` first, then
`Close` the underlying.

## 7. The Flush-before-Close rule

This is the single biggest source of "my output file is missing the
last few lines" bugs in Go. The pattern:

```go
f, err := os.Create("out.txt")
if err != nil { return err }
defer f.Close()

bw := bufio.NewWriter(f)
defer bw.Flush() // !!! must run before f.Close

for _, line := range lines {
    if _, err := bw.WriteString(line + "\n"); err != nil {
        return err
    }
}
return nil
```

`defer` runs in LIFO order. The `bw.Flush()` defer runs first, pushing
the buffer to `f`. Then `f.Close()` runs, finalising the file. If you
swap the two defers (or forget `Flush`), the unflushed bytes never
reach disk.

A more robust version that surfaces the flush error:

```go
func writeLines(path string, lines []string) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); err == nil {
            err = cerr
        }
    }()

    bw := bufio.NewWriter(f)
    for _, line := range lines {
        if _, err = bw.WriteString(line + "\n"); err != nil {
            return err
        }
    }
    return bw.Flush() // explicit, so the caller sees flush errors
}
```

Don't pretend this rule is optional. Even on tiny outputs, you'll
eventually hit the boundary case where the last write doesn't fill the
buffer, and the lost bytes are precisely the ones that mattered.

## 8. `bufio.Scanner` — the friendly line reader

`Scanner` is a small layer on top of `bufio.Reader` that gives you a
clean loop:

```go
f, _ := os.Open("access.log")
defer f.Close()

s := bufio.NewScanner(f)
for s.Scan() {
    line := s.Text() // string, no trailing '\n'
    process(line)
}
if err := s.Err(); err != nil {
    return err
}
```

`Scan` advances to the next token and returns `true` if it found one,
`false` at EOF or on error. After the loop, you must check `s.Err()` —
because `Scan` returns the same `false` for clean EOF and for "the
underlying reader broke."

By default `Scanner` splits on newlines (`bufio.ScanLines`), strips the
trailing `\r\n` or `\n`, and returns the bare text. You can change the
splitter:

```go
s.Split(bufio.ScanWords)  // whitespace-separated tokens
s.Split(bufio.ScanRunes)  // one UTF-8 rune at a time
s.Split(bufio.ScanBytes)  // one byte at a time
s.Split(bufio.ScanLines)  // (default) lines
```

Custom split functions are covered in [middle.md](middle.md).

## 9. `Scanner.Bytes` reuses memory

```go
for s.Scan() {
    b := s.Bytes() // borrowed slice; do NOT keep past the next Scan
    process(b)
}
```

`Bytes()` returns a slice into the scanner's internal buffer. The next
`Scan` overwrites it. If you need to keep the bytes (collect them in a
slice, send them to a goroutine, store them in a map), copy first:

```go
for s.Scan() {
    line := append([]byte(nil), s.Bytes()...) // explicit copy
    keep = append(keep, line)
}
```

`s.Text()` already returns a fresh `string` each time (strings are
immutable), so it's safe to keep — at the cost of one allocation per
token. For hot loops, prefer `Bytes()` + an explicit copy only when
you actually need to keep the bytes.

## 10. The default 64 KiB token cap

`bufio.Scanner` refuses to return tokens larger than 64 KiB by default.
A line longer than that ends scanning with `bufio.ErrTooLong`:

```go
for s.Scan() {
    process(s.Text())
}
if err := s.Err(); err != nil {
    if errors.Is(err, bufio.ErrTooLong) {
        // a line exceeded 64 KiB — see senior.md for what gets lost
    }
    return err
}
```

To accept larger tokens:

```go
s := bufio.NewScanner(f)
s.Buffer(make([]byte, 0, 64*1024), 4*1024*1024) // up to 4 MiB per token
```

The first argument is the *initial* buffer; the scanner grows it up to
the second argument as needed. Beyond the cap, `ErrTooLong`.

If your input has unbounded line lengths and you can't pick a sane
cap, use `bufio.Reader.ReadString('\n')` or `ReadBytes('\n')` instead.
Those grow without limit (one allocation per call).

## 11. `ReadString` vs `ReadLine` vs `Scanner.Scan`

Three ways to read a line. Pick by what you need:

| Method | Returns | Trailing `\n`? | Allocates? | Bounded? |
|--------|---------|----------------|------------|----------|
| `Scanner.Scan` + `Text`/`Bytes` | string or []byte | stripped | string yes, bytes no | 64 KiB default |
| `bufio.Reader.ReadString('\n')` | string | included | yes | unbounded |
| `bufio.Reader.ReadBytes('\n')` | []byte | included | yes | unbounded |
| `bufio.Reader.ReadLine` | []byte + isPrefix | stripped | no (slice into buffer) | one buffer worth |

Defaults for newcomers: `Scanner.Scan` + `Text` for text loops,
`ReadString` if you need the newline preserved, `ReadBytes` if you're
working with non-UTF-8 data and want to keep the newline.

`ReadLine` is a low-level helper used internally by `Scanner`. You
almost never need it directly — see [senior.md](senior.md).

## 12. `bufio.ReadWriter` — combined wrapping

For full-duplex things like a `net.Conn`, you often want both a
buffered reader and a buffered writer over the same underlying
connection:

```go
conn, _ := net.Dial("tcp", "host:port")
defer conn.Close()

br := bufio.NewReader(conn)
bw := bufio.NewWriter(conn)
rw := bufio.NewReadWriter(br, bw)

rw.WriteString("PING\n")
rw.Flush()
resp, _ := rw.ReadString('\n')
```

`bufio.ReadWriter` is just a struct holding both. Methods are forwarded
in name to the appropriate side. Note: you still flush via the writer
side; reading does not auto-flush writes.

## 13. A minimal `cat` using `bufio.Scanner`

```go
package main

import (
    "bufio"
    "fmt"
    "io"
    "os"
)

func cat(r io.Reader, w io.Writer) error {
    s := bufio.NewScanner(r)
    for s.Scan() {
        if _, err := fmt.Fprintln(w, s.Text()); err != nil {
            return err
        }
    }
    return s.Err()
}

func main() {
    if err := cat(os.Stdin, os.Stdout); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

This works on any `io.Reader`. It's also a slightly worse `cat` than
the `io.Copy` version in the I/O leaf — it forces line-buffering, may
hit the 64 KiB cap, and copies each line into a string. For binary
streaming, `io.Copy` is better. For per-line processing, `Scanner`
shines.

## 14. A minimal log writer

```go
package main

import (
    "bufio"
    "fmt"
    "os"
)

func main() {
    f, err := os.OpenFile("app.log",
        os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    defer f.Close()

    bw := bufio.NewWriter(f)
    defer bw.Flush()

    for i := 0; i < 1000; i++ {
        fmt.Fprintf(bw, "event %d\n", i)
    }
}
```

`fmt.Fprintf(bw, ...)` formats into the buffer with no intermediate
string allocation (when the verbs are simple). At 4 KiB per flush,
1000 short events become a couple of syscalls instead of 1000.

## 15. A minimal `wc -w`

```go
func countWords(r io.Reader) (int, error) {
    s := bufio.NewScanner(r)
    s.Split(bufio.ScanWords)
    n := 0
    for s.Scan() {
        n++
    }
    return n, s.Err()
}
```

Three lines of logic. `bufio.ScanWords` skips runs of Unicode
whitespace and yields each word. Same shape works for `wc -l` (default
splitter) or `wc -c` (count bytes via `bufio.ScanBytes`).

## 16. Concurrency rule of thumb

**One `bufio.Reader`, `bufio.Writer`, or `bufio.Scanner` per
goroutine.** They are not safe to share. The state inside (buffer
position, error, leftover bytes) is single-threaded.

If two goroutines need to read from the same source, either give each
its own `bufio.Reader` over the same `*os.File` (and accept the read
position races), or have one goroutine read and dispatch via a channel.

For writers: definitely don't share. Two goroutines calling `Write` on
the same `bufio.Writer` will race on the buffer indices.

## 17. Reset for pooling

`Reader.Reset(r)` and `Writer.Reset(w)` re-use an existing `bufio` value
with a different underlying source. Useful when you process many small
sources in a loop and want to avoid reallocating the 4 KiB buffer each
time:

```go
br := bufio.NewReader(nil)
for _, name := range files {
    f, err := os.Open(name)
    if err != nil { continue }
    br.Reset(f)
    process(br)
    f.Close()
}
```

For multi-goroutine work, pair `Reset` with `sync.Pool` — covered in
[professional.md](professional.md).

## 18. Mistakes to avoid on day one

| Mistake | Symptom |
|---------|---------|
| Forgot `bw.Flush()` before close | Last few KiB of output missing |
| Stored `s.Bytes()` past the next `Scan` | Garbage data on later use |
| Read into a `bufio.Reader` then read directly from the underlying file | Lost bytes (they're sitting in the bufio buffer) |
| `Peek(n)` with `n > buffer size` | `bufio.ErrBufferFull` |
| Long line, default scanner | `bufio.ErrTooLong`, line discarded |
| Concurrent `Scan` from two goroutines | Garbled output, race detector fires |
| Used `ReadSlice` and kept the result | Slice changes under you on next read |

The one about reading directly from the file after handing it to a
`bufio.Reader` is subtle. Once a `bufio.Reader` has read N bytes from
the underlying source into its buffer, those N bytes are *gone* from
the source's perspective. If you then call `f.Read` directly, you skip
past whatever is buffered. Always read through the same `bufio.Reader`
once you've started.

## 19. When *not* to use `bufio`

If you're streaming large blocks of bytes from one place to another
without inspecting them, `io.Copy` is already buffered (32 KiB by
default) and faster than `bufio.NewReader` + manual loop. You don't
need `bufio` to copy a file.

`bufio` pays off when you do many small reads or writes (per-byte,
per-rune, per-line). For a single bulk transfer, skip it.

## 20. What to read next

- [middle.md](middle.md) — `ReadSlice`, `Peek` deeply, `AvailableBuffer`,
  custom split functions, framing protocols, `Reset` pooling.
- [senior.md](senior.md) — exact contracts, `ErrTooLong` and what it
  loses, `ErrFinalToken`, the `ReadFrom` / `WriteTo` fast paths.
- [tasks.md](tasks.md) — exercises that practice each surface.
- [find-bug.md](find-bug.md) — broken snippets to diagnose.
- The official package docs: [`bufio`](https://pkg.go.dev/bufio).
- The I/O foundations leaf:
  [../01-io-and-file-handling/](../01-io-and-file-handling/junior.md).
