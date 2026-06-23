# 8.1 `io` and File Handling — Optimize

> **Audience.** You have correct code and you need it faster, cheaper,
> or both. This file walks through the tools, the structural changes
> that pay off, and the platform-specific tricks that move the needle.
> Numbers are typical for a modern Linux server; your workload may
> differ. Always measure before and after.

## 1. Measure first

The expensive mistake in I/O optimization is guessing where the time
goes. The three Go profiles to know:

| Profile | Captures | When to reach for it |
|---------|----------|----------------------|
| CPU profile (`pprof.profile`) | Stack samples while CPU is busy | The process is at high CPU usage |
| Block profile (`pprof.block`) | Goroutines blocked on sync primitives | Throughput is low but CPU is idle |
| Mutex profile (`pprof.mutex`) | Contended mutex acquisitions | High lock-wait time in block profile |
| Trace (`runtime/trace`) | Every goroutine event with timestamps | You suspect scheduling or syscall pile-up |
| Heap profile (`pprof.heap`) | Live and total allocations | Memory pressure or GC overhead |

Wire them into a long-running service via `net/http/pprof`:

```go
import _ "net/http/pprof"

func init() {
    go http.ListenAndServe("localhost:6060", nil)
}
```

Capture and visualize:

```sh
curl -o cpu.prof http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http :8080 cpu.prof
```

A flame graph that's mostly `runtime.read` or `runtime.write` means
you're syscall-bound — buffer more. Mostly `runtime.mallocgc` and
`runtime.scanobject` means you're allocation-bound — pool buffers.
Mostly business logic means I/O isn't the bottleneck; look elsewhere.

## 2. The 32 KiB `io.Copy` buffer

`io.Copy` uses an internal 32 KiB buffer when neither side implements
`WriterTo` or `ReaderFrom`. For most workloads this is well-chosen —
large enough to amortize syscall cost, small enough to fit in L1/L2
cache, and predictable for memory accounting.

When 32 KiB isn't right:

- **Network destinations on a fast link.** A larger buffer can fill
  the kernel send buffer in fewer syscalls. Try 64 KiB or 256 KiB and
  benchmark.
- **Slow consumer with short reads.** A larger buffer wastes memory
  if the consumer asks for 4 KiB at a time. Match the consumer's
  natural chunk.
- **Many concurrent copies.** N goroutines × 32 KiB = N × 32 KiB of
  buffers in flight. Sum across goroutines and check against the
  process's working set.

To override:

```go
buf := make([]byte, 256*1024)
n, err := io.CopyBuffer(dst, src, buf)
```

`CopyBuffer` still tries the `WriterTo`/`ReaderFrom` fast paths first;
the buffer is consulted only when neither is available.

## 3. Implementing `ReaderFrom` and `WriterTo`

If you build a custom reader or writer that has a faster way to move
its bytes than the generic loop, implement these interfaces and
`io.Copy` will use them automatically.

When *not* to implement them: if your fast path *is* the standard
32 KiB loop. Adding a method that just calls `io.Copy` on the inside
adds indirection without speed. Real wins come from skipping a copy
(your data is already laid out the right way) or batching better than
the generic loop.

```go
type chunkedSource struct {
    chunks [][]byte
}

func (c *chunkedSource) WriteTo(w io.Writer) (int64, error) {
    var total int64
    for _, b := range c.chunks {
        n, err := w.Write(b)
        total += int64(n)
        if err != nil { return total, err }
    }
    return total, nil
}
```

Now `io.Copy(w, c)` writes each chunk directly without copying through
a 32 KiB buffer. For sources backed by `[][]byte`, `bytes.Reader`
slices, or `mmap`'d regions, this saves the entire intermediate copy.

## 4. Avoiding allocations: `sync.Pool` for buffers

Every `io.Copy` without a custom buffer allocates 32 KiB per call.
Across millions of calls, that's GC pressure for no reason. Pool the
buffers:

```go
var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 32*1024)
        return &b
    },
}

func copyPooled(dst io.Writer, src io.Reader) (int64, error) {
    bp := bufPool.Get().(*[]byte)
    defer bufPool.Put(bp)
    return io.CopyBuffer(dst, src, *bp)
}
```

Two details that bite:

- **Store pointers to slices**, not slices directly. Putting a slice
  into `sync.Pool` boxes it into an `interface{}`, which allocates.
  A `*[]byte` doesn't.
- **`sync.Pool` items can be reclaimed by the GC** at any time. Don't
  rely on getting back the same buffer; treat `Get` as "I might get a
  new one."

Use the same pattern for `bufio.NewReader`/`bufio.NewWriter`:

```go
var bufWriterPool = sync.Pool{
    New: func() any { return bufio.NewWriterSize(io.Discard, 64*1024) },
}

bw := bufWriterPool.Get().(*bufio.Writer)
bw.Reset(realDst)
defer func() {
    bw.Flush()
    bufWriterPool.Put(bw)
}()
```

`Reset` lets a pooled `bufio.Writer` change its underlying destination
without reallocating the buffer.

## 5. `bufio.Scanner` vs `bufio.Reader.ReadString`

For line-by-line text:

| Approach | Allocations per line | Long lines |
|----------|---------------------|------------|
| `bufio.Scanner.Text()` | One string per line | Capped by `Buffer(_, max)` |
| `bufio.Scanner.Bytes()` | None (slice into buffer) | Same cap |
| `bufio.Reader.ReadString('\n')` | One string per line | Unlimited |
| `bufio.Reader.ReadBytes('\n')` | One slice per line | Unlimited |
| `bufio.Reader.ReadSlice('\n')` | None (slice into buffer) | Capped by buffer size |

`Scanner.Bytes()` is the fastest for the common case but requires
discipline: the slice is invalid after the next `Scan`. Copy out
anything you want to keep.

`ReadSlice` is even faster for known-short lines because it never
copies and is a method call on `bufio.Reader` directly. Same caveat:
the slice aliases the internal buffer.

## 6. Linux zero-copy syscalls

Three syscalls let the kernel move bytes without ever touching user
space:

- **`sendfile(out_fd, in_fd, offset, count)`** — copies from a file
  to a socket. Used by Go for `*os.File` → `*net.TCPConn`.
- **`splice(in_fd, in_off, out_fd, out_off, count, flags)`** — copies
  between any two FDs as long as one is a pipe. Used by Go for
  `*net.TCPConn` → `*os.File` on Linux.
- **`copy_file_range(in_fd, in_off, out_fd, out_off, count, flags)`**
  — copies between two files on the same filesystem (Linux 4.5+).
  Used by Go for `*os.File` → `*os.File`.

The dispatcher is `(*os.File).ReadFrom`, which `io.Copy` invokes when
the destination implements `ReaderFrom`. For a 1 GB file copy on a
modern SSD, kernel-side `copy_file_range` is roughly 2–3× faster than
the user-space 32 KiB loop, mostly because it skips the cache misses
of touching every page in user space.

To verify the fast path is firing, run under `strace -c -e read,write,sendfile,splice,copy_file_range` and count the syscalls. A
slow `io.Copy` between two files that shows millions of `read`/`write`
calls means something hides the underlying types.

## 7. Parallelism with `ReadAt` and `SectionReader`

For CPU-bound work over a large file (hashing, decompression of an
indexed archive, parsing fixed-record formats), parallelize across
goroutines using `io.NewSectionReader`:

```go
const chunk = 4 << 20 // 4 MiB
n := stat.Size()
sums := make([][]byte, (n+chunk-1)/chunk)
var wg sync.WaitGroup
for i := 0; i < len(sums); i++ {
    i := i
    off := int64(i) * chunk
    end := off + chunk
    if end > n { end = n }
    wg.Add(1)
    go func() {
        defer wg.Done()
        sr := io.NewSectionReader(f, off, end-off)
        h := sha256.New()
        io.Copy(h, sr)
        sums[i] = h.Sum(nil)
    }()
}
wg.Wait()
```

Each goroutine has its own `SectionReader` over the shared `*os.File`.
`ReadAt` doesn't touch the position cursor, so the goroutines don't
race. Cap the goroutine count at `runtime.NumCPU()` for CPU-bound
work; for disk-bound work, more goroutines doesn't help past the disk's
queue depth (typically 32 for an SSD, 8 for a spinning disk).

## 8. Avoiding GC pressure in hot paths

Every allocation costs CPU now (the bump allocator and write barrier)
and CPU later (during GC). In I/O hot paths:

- **Allocate buffers once, outside the loop.** Pass them in.
- **Use `[]byte` instead of `string` where possible.** `string` →
  `[]byte` and back are allocations under the hood in some cases.
- **Avoid `fmt.Sprintf` in the hot path.** Use `strconv` for numbers
  and `[]byte`-append for assembly.
- **Reuse `bytes.Buffer` between calls.** `Reset` clears it without
  freeing the underlying array.
- **Implement `io.WriterTo` if your reader naturally produces chunks
  larger than 32 KiB.** Skip the intermediate buffer.

A useful CI check: `go test -bench . -benchmem` and watch the
`allocs/op` column. A reduction from 5 allocs/op to 0 in a hot
loop typically translates to a measurable end-to-end win.

## 9. When buffering hurts

`bufio` improves throughput for small reads and writes by amortizing
syscall cost. It hurts when:

- **The producer is interactive.** A user typing at a terminal expects
  immediate processing. A `bufio.Writer` wrapping `os.Stdout` will
  hold the prompt back until the buffer fills or you call `Flush`.
  Same for an SSE stream — the consumer waits forever for the buffer
  to flush.
- **Each "message" is already large.** Wrapping a writer that emits
  one 1 MiB record per `Write` call in a `bufio.Writer` adds a copy
  for no syscall savings.
- **You need to interleave with other writers.** A `bufio.Writer`
  doesn't see other writes happening to the same underlying file —
  the order of bytes on disk depends on flush timing.

Rule of thumb: buffer when records are small (<4 KiB) and the
underlying stream is syscall-expensive. Don't buffer when records are
large or interactivity matters.

## 10. The cost of `Sync` and group-commit

`(*os.File).Sync()` waits for the OS to flush the file's pages to
stable storage. On a typical SATA SSD: 100–500 µs. On a spinning
disk: 5–20 ms. On an enterprise NVMe with battery-backed cache:
20–50 µs. On `tmpfs` (no actual disk): essentially free.

Implications:

- **Sync once per batch, not per write.** A 1000-row batch synced once
  takes the cost of one sync; the same 1000 rows synced individually
  takes 1000× as long.
- **Use group commit for concurrent writers.** Multiple goroutines
  needing durability can queue their writes, do one shared sync, and
  signal everyone. This is how databases and write-ahead-log systems
  achieve high throughput.

```go
type committer struct {
    f      *os.File
    buf    chan []byte
    acks   chan chan error
}

func (c *committer) loop() {
    pending := []chan error{}
    var batch [][]byte
    for {
        select {
        case b := <-c.buf:
            batch = append(batch, b)
        case ack := <-c.acks:
            pending = append(pending, ack)
            for _, b := range batch {
                c.f.Write(b)
            }
            err := c.f.Sync()
            for _, p := range pending {
                p <- err
            }
            pending = nil
            batch = nil
        }
    }
}
```

The pattern: collect writes during a window, write them together,
sync once, signal all callers. The overall throughput is
"writes per sync interval" — much higher than "writes per
sync."

## 11. `os.File` vs `mmap` for random reads

For workloads that read small bits from many places in a large file:

| Approach | First touch | Subsequent touches | Code complexity |
|----------|-------------|---------------------|-----------------|
| `f.ReadAt(buf, off)` | Page fault + copy to buf | Page fault if evicted | Simple |
| `mmap` | Page fault | Direct memory access | More complex |

`mmap` shines when the working set fits in RAM and you access the
same regions many times. The kernel's page cache *is* your read cache;
no user-space copy. It loses on single-pass scans because page faults
on first access are still expensive.

Use `golang.org/x/exp/mmap` for read-only access:

```go
r, err := mmap.Open("data.bin")
if err != nil { return err }
defer r.Close()
buf := make([]byte, 64)
r.ReadAt(buf, offset)
```

For writes, the standard library doesn't expose `mmap`. Third-party
packages like `github.com/edsrzf/mmap-go` offer it; the safety
considerations (synchronization with kernel, partial flushes, signals
on access errors) are substantial.

## 12. Benchmark recipes

Put your benchmarks in `_test.go` next to the code. The shape:

```go
func BenchmarkCopy32K(b *testing.B) {
    src := bytes.NewReader(make([]byte, 1<<20))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        src.Seek(0, 0)
        if _, err := io.Copy(io.Discard, src); err != nil {
            b.Fatal(err)
        }
    }
    b.SetBytes(1 << 20)
}
```

`b.SetBytes(n)` makes Go report MB/s in addition to ns/op:

```
BenchmarkCopy32K-8    50000  24356 ns/op  43056.40 MB/s    0 B/op    0 allocs/op
```

Run with `-benchmem` to see allocations per op, and `-cpuprofile` to
capture a profile while the benchmark runs:

```sh
go test -run x -bench BenchmarkCopy -benchmem -cpuprofile cpu.prof
go tool pprof -http :8080 cpu.prof
```

Compare two implementations with `benchstat`:

```sh
go test -run x -bench BenchmarkCopy -count 10 > old.txt
# make changes
go test -run x -bench BenchmarkCopy -count 10 > new.txt
benchstat old.txt new.txt
```

`benchstat` reports the median, the geometric mean, and a p-value
that says whether the difference is statistically meaningful.

## 13. Reading a flame graph for I/O code

A few patterns to recognize quickly:

- **Wide `runtime.read` or `runtime.write` boxes.** Syscall-bound;
  buffer more.
- **Wide `runtime.mallocgc` and `runtime.scanobject`.** Allocation
  pressure; pool buffers.
- **Wide `bytes.(*Buffer).Write` (or similar) sitting on top of
  `growSlice`.** Buffer growth in a hot loop; preallocate.
- **A big block under `runtime.gcBgMarkWorker`.** GC is doing real
  work; reduce allocations.
- **Tall narrow stacks under `runtime.netpoll` or `runtime.gosched`.**
  Goroutines waiting on I/O; you may be I/O-bound, not CPU-bound, and
  more parallelism could help.

The browser interface (`go tool pprof -http`) lets you click into any
box for the call sites. Top-level "self" time tells you where the CPU
*is*; cumulative time tells you what's *responsible*.

## 14. Reducing syscalls with batching

A `Write` syscall on Linux costs roughly 1 µs of CPU even with no
actual disk work. A loop that calls `Write` a million times spends a
second just on syscall overhead. Wrap with `bufio.Writer` and the
syscalls drop by 10–100× depending on buffer size.

Same logic for reads: `os.File.Read` from a regular file costs the
syscall plus the kernel's per-block work. For line-by-line text,
`bufio.Reader.ReadString` (one syscall per buffer-fill) crushes
`os.File.Read` of one byte at a time (one syscall per byte) — on the
order of 1000× faster.

## 15. `io.MultiReader` allocates an iterator

`io.MultiReader(rs...)` returns a struct that holds the slice of
readers. Each `Read` advances through the slice as readers EOF. The
allocation is once, at construction; no per-`Read` allocation.

For very long lists of readers (concatenating 10 000 small files),
the iteration cost dominates. A faster pattern: implement `WriteTo`
on a custom container that walks the readers without virtual dispatch
overhead.

## 16. Avoiding `strconv` allocations

Formatting numbers into a `bufio.Writer` via `fmt.Fprintf` allocates.
The faster path:

```go
buf := make([]byte, 0, 20)
buf = strconv.AppendInt(buf, n, 10)
bw.Write(buf)
```

`strconv.AppendInt` writes into a caller-provided buffer, no
allocation if the buffer has capacity. For high-throughput JSON or
CSV writers, replacing `Fprintf` with `Append*` cuts allocations
substantially. The standard library's own `encoding/json` does this
internally.

## 17. The cost of small `Write` calls to `*net.TCPConn`

Each `Write` to a TCP connection is a syscall, and on small packets
(less than the MSS), Nagle's algorithm or your application's
flush behavior decides when bytes go on the wire. A loop writing one
byte at a time to a `net.Conn`:

- One syscall per byte (slow).
- Many tiny TCP segments (latency adds, header overhead is huge).

Buffer through `bufio.Writer` with a flush at logical message
boundaries:

```go
bw := bufio.NewWriterSize(conn, 64*1024)
bw.WriteString(line1)
bw.WriteString(line2)
bw.Flush() // one syscall, one (or few) packets
```

## 18. JSON streaming throughput

`json.NewEncoder(w).Encode(v)` allocates a buffer per call, encodes
into it, then writes. For a hot loop:

- **Encode into a reusable `bytes.Buffer` directly**, then write the
  result. Saves an allocation per call.
- **For large slices, consider a code-generated encoder** (e.g.,
  `easyjson`, `goccy/go-json`). The reflection-based default is
  several times slower than generated code.
- **For decoding streams, `Decoder.UseNumber()` avoids `float64`
  precision loss** but allocates a `json.Number` per number.

## 19. Profiling I/O wait specifically

CPU profile won't show you time spent waiting on I/O — the goroutine
isn't running, so it's not sampled. Use the trace tool:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... run workload ...
```

Then:

```sh
go tool trace trace.out
```

The view shows every goroutine's state over time. Long red bars are
"blocked" (syscall, channel, etc.); long green bars are "running".
For I/O code, you typically see goroutines spending most of their
time in `Syscall` state — the network poller and disk I/O register
as syscalls.

## 20. A worked example: a 10× speedup

A program that hashes 1000 files sequentially:

```go
for _, p := range paths {
    f, _ := os.Open(p)
    h := sha256.New()
    io.Copy(h, f)
    f.Close()
    results[p] = h.Sum(nil)
}
```

Three changes for a typical 10× speedup on a multi-core machine with
SSD:

1. **Parallelize across files.** Worker pool of `runtime.NumCPU()`
   goroutines pulling paths from a channel. ~4× on a 4-core SSD.
2. **Pool the `sha256` hasher.** `sha256.New()` allocates and zeroes
   a state struct per call. `Reset()` reuses it. ~5–10% on small
   files where allocation dominates.
3. **Use `io.CopyBuffer` with a pooled 64 KiB buffer.** Reduces GC
   pressure and slightly bumps throughput. ~5%.

The compounded effect is closer to 5×–10× depending on workload. The
ceiling is "saturate the disk" — beyond that, more parallelism just
queues at the kernel.

## 21. When optimization is over

You're done optimizing when one of:

- The flame graph is dominated by syscalls you can't avoid (the disk
  is the bottleneck).
- Allocations per op are zero in the hot path.
- The benchstat p-value won't go below 0.05 — you're inside the noise
  floor.
- The next 5% would require platform-specific code (`io_uring`,
  custom mmap) that costs more in maintenance than it saves in CPU.

Stop. Document the current numbers. Move on.

## What to read next

- [find-bug.md](find-bug.md) — the bugs you might introduce while
  optimizing (especially #16, hiding the zero-copy fast path).
- [professional.md](professional.md) — the production patterns
  optimization should fit into.
- [senior.md](senior.md) — the contracts you must not violate even
  in the name of speed.
- The Go blog: "Profiling Go Programs" and "Diagnostics" sections of
  the official docs cover the tools above in depth.
