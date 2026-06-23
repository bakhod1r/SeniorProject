# 8.1 `io` and File Handling — Tasks

> **Audience.** You've read [junior.md](junior.md) and at least the
> first half of [middle.md](middle.md). These exercises take a few
> hours each at the early end and a day or two at the later end. Each
> task lists a problem statement, acceptance criteria, and a stretch
> goal. No solutions — that's the point. The hard part is the
> acceptance criteria; if your code passes them, you've understood
> the material.

Common ground rules across all tasks:

- Run with `go test -race`. Any race in your solution disqualifies it.
- Every file handle must be closed on every code path, including errors.
- Take `io.Reader` / `io.Writer` parameters where possible so your
  code is testable without real files.
- Wrap errors with `%w` and surface them — never `_ = err`.

## 1. `cat` clone

Build a command-line program `mycat` that concatenates files to
standard output. With no arguments, read from standard input.

**Acceptance criteria.**

- Reads files in order, streams them — no full-file loading regardless
  of file size.
- Returns a non-zero exit code if any file fails to open or read,
  with a stderr message naming the file and the underlying error.
- Closes every file it opens, even when a later file fails.
- Has a unit test that invokes the core function with a synthetic
  `io.Writer` and asserts the bytes written match the inputs.

**Stretch.** Add `-n` (number lines) and `-s` (squeeze multiple blank
lines). Both must operate on the streaming interface, not by reading
the whole file first.

## 2. `wc -l` clone

Build `mywc -l` that counts lines in each file (or stdin) and prints a
total.

**Acceptance criteria.**

- Uses `bufio.Scanner` or equivalent — does not load whole files.
- Handles files with no trailing newline correctly (counts the last
  line if it contains any bytes).
- Uses less than 1 MiB of memory regardless of input size.
- Reports `s.Err()` from the scanner, not just the loop's exit.
- Handles lines longer than the default `bufio.MaxScanTokenSize` —
  either by raising the cap or by switching to a different reader
  for that case.

**Stretch.** Add `-w` (words) and `-c` (bytes) modes. The `-w` mode
must agree with GNU `wc -w` on at least 100 sample inputs.

## 3. `tee` to N files

Build a program that reads stdin and writes the bytes to all of N
output files specified on the command line, plus stdout.

**Acceptance criteria.**

- Uses `io.MultiWriter` to fan out writes; no per-byte loops.
- Opens all output files before reading; closes them all after, in
  reverse order of opening.
- If any one file's `Write` fails, all writes stop and the error is
  reported — but every already-opened file is still closed.
- Uses `bufio.Writer` for each output (4 KiB or larger buffer) and
  flushes before close.

**Stretch.** Add an `-a` flag for append mode. Add a `-f` flag that
keeps writing to the surviving outputs if one fails (like a logging
fan-out should).

## 4. Hashing reader wrapper

Define a type `HashReader` that wraps an `io.Reader` and computes a
running SHA-256 of every byte read through it. Expose
`HashReader.Sum() []byte` to get the current digest without consuming
the reader.

**Acceptance criteria.**

- Implements `io.Reader` — drop-in replacement for any reader.
- `Sum()` returns the hash of all bytes read so far (callable any
  time, including before EOF).
- Adds zero allocations per `Read` call (use `hash.Hash.Write` on the
  same buffer the caller provided).
- A test passes a known input, drains the reader, and asserts the
  hash matches the expected `sha256sum` output.
- Works when wrapping any `io.Reader` — file, network, in-memory.

**Stretch.** Make the hash algorithm pluggable via a `hash.Hash` field
in the constructor. Add a sibling `HashWriter` for the symmetric case.

## 5. Rate-limited writer wrapper

Build a `RateWriter` that wraps an `io.Writer` and limits throughput
to a configured bytes-per-second cap.

**Acceptance criteria.**

- Implements `io.Writer`.
- Over a 10-second test, the actual byte rate is within 10% of the
  configured cap.
- Bursts smaller than one second's quota are not artificially delayed.
- Cancellable via a `context.Context` — a `Write` blocked waiting for
  quota returns when the context is cancelled, with `ctx.Err()`.
- A test that wraps `io.Discard` and writes 1 MB at 100 KB/s confirms
  the operation takes ~10 seconds (±1 second).

**Stretch.** Use `golang.org/x/time/rate.Limiter` instead of a
hand-rolled token bucket. Compare allocation profile with `-benchmem`.

## 6. File watcher with mtime polling

Build a function `func WatchFile(ctx context.Context, path string, onChange func([]byte)) error` that calls `onChange` with the current
file contents whenever the file's modification time changes, until
`ctx` is cancelled.

**Acceptance criteria.**

- Polls `os.Stat` on a configurable interval (default 1 second).
- Calls `onChange` on the initial read, then again only after `mtime`
  changes.
- Reads the file with `os.ReadFile` (or equivalent) atomically — the
  callback never sees a half-written file. Pair with the atomic-rename
  pattern from [middle.md](middle.md) section 7 in your test producer.
- Returns `ctx.Err()` when cancelled, never blocks past one polling
  interval after cancellation.
- Survives a brief disappearance of the file (re-creation between two
  polls) without crashing — logs the gap, continues watching.

**Stretch.** Use `github.com/fsnotify/fsnotify` instead of polling.
Compare CPU usage on an idle file: polling vs. inotify.

## 7. Atomic config reloader

Build a `Config` type with these methods: `Load(path string) error`
loads from disk; `Get() *T` returns the current value; an internal
goroutine watches the file and reloads on change.

**Acceptance criteria.**

- `Get()` is wait-free for readers — no mutex, use `atomic.Pointer`.
- A new config is published only if parsing succeeds; a parse error
  leaves the previous version in place and is logged/exposed.
- Writers using the atomic-rename pattern can update the config file
  without `Get()` ever returning a half-parsed value.
- A test concurrently calls `Get()` 1000 times per millisecond while
  another goroutine swaps the file 100 times; no test failure under
  `-race` and `Get()` always returns a fully parsed valid value.
- Stops cleanly on context cancellation.

**Stretch.** Add a "reload hook" callback fired after each successful
reload, with the old and new config as arguments. Make the hook list
modifiable at runtime.

## 8. Parallel checksum with `ReadAt`

Build a program that computes the SHA-256 of a file by reading N
sections in parallel, hashing each, and combining via a Merkle-style
combiner (or simply by appending and re-hashing — your choice, document it).

**Acceptance criteria.**

- Uses `io.NewSectionReader` plus N goroutines.
- N is configurable via a flag; default to `runtime.NumCPU()`.
- Closes the file exactly once after all goroutines finish.
- Uses bounded memory: each goroutine works on at most one section
  at a time.
- For a 1 GB file, parallel mode is at least 1.5× faster than the
  single-goroutine baseline on a 4-core machine. Include a benchmark
  that demonstrates this.
- The output hash matches the same algorithm applied serially — this
  is testable; write the test.

**Stretch.** Add CRC32C as an alternate algorithm using
`hash/crc32.MakeTable(crc32.Castagnoli)`. Compare throughput against
SHA-256 and explain the difference.

## 9. Bounded-memory file deduplicator

Build a program that takes a list of file paths and prints groups of
files with identical contents, using less than 32 MiB of memory
regardless of how many or how large the input files are.

**Acceptance criteria.**

- First pass groups by file size (`os.Stat`) to skip obvious mismatches.
- For files of the same size, hash them with a streaming SHA-256
  reader (do not load whole files into memory).
- Reports duplicates as groups, one group per line, paths
  space-separated.
- Closes every file handle on every code path, including errors.
- A test with 1000 small files (some duplicates) completes in under
  one second and reports the correct groups.

**Stretch.** Add a "verify" pass that confirms equality byte-for-byte
for files with the same hash — defensive against hash collisions for
the truly paranoid. Skip this pass under a `-fast` flag.

## 10. Streaming JSON-to-CSV converter

Build a program that reads newline-delimited JSON objects from stdin
and writes CSV rows to stdout. The first object's keys become the CSV
header; subsequent objects must have the same keys (any new key is an
error).

**Acceptance criteria.**

- Uses `json.NewDecoder` and `csv.NewWriter`, both streaming — memory
  usage is constant regardless of input size.
- Errors out with a clear message if a later object's keys differ from
  the header (extra key, missing key).
- Handles values that are strings, numbers, booleans, or `null`
  correctly. Nested objects/arrays are an error unless quoted as JSON.
- Flushes the CSV writer before exiting; checks `csv.Writer.Error()`.
- A test reads 100 000 small JSON objects in under 5 seconds and
  produces correct CSV.

**Stretch.** Add a `-flatten` flag that turns nested keys into
dot-separated CSV columns. Document the corner cases (arrays, nulls,
mixed types across rows).

## 11. Tail-follow with rotation handling

Build `mytail -F path` that prints new lines appended to a file in
real time, surviving log rotation (the file being renamed and a new
one created in its place).

**Acceptance criteria.**

- After EOF, polls for new data with a configurable interval.
- Detects rotation by stat'ing the path periodically and comparing
  the inode (`Stat().Sys().(*syscall.Stat_t).Ino` on Linux) to the
  inode of the open file. On change, closes the old handle and opens
  the new path.
- Handles "file doesn't exist yet" — wait, retry, log only the first
  occurrence to avoid log spam.
- Lines longer than 64 KiB are handled correctly (use `bufio.Reader`
  with grown buffer or `Scanner` with `Buffer`).
- Cancellable via a context — a `SIGINT` handler calls cancel, the
  program exits within one polling interval.

**Stretch.** Add a `-c N` flag to print the last N lines on startup
before tailing. Handle UTF-8 boundaries: if a poll happens mid-rune,
the next poll concatenates correctly.

## 12. Atomic-rename file writer

Build a function `AtomicWriteFile(path string, data []byte, perm fs.FileMode) error` that writes `data` to `path` atomically — either the
old contents or the new are visible at any moment, never a partial file.
This is `os.WriteFile` with a crash-safety guarantee.

**Acceptance criteria.**

- Creates the temp file in the same directory as `path` (so `Rename`
  doesn't fail with `EXDEV`).
- Calls `Sync` on the temp file before close.
- Calls `Sync` on the parent directory after the rename.
- Cleans up the temp file on any failure path; never leaves a
  `.tmp-XXXXX` orphan.
- A test crashes a goroutine mid-write (close the temp file early)
  and asserts that `path` either contains the old contents or doesn't
  exist — never a half-write.

**Stretch.** Make it concurrency-safe across multiple goroutines
writing to the same path: serialize via a per-path mutex, or document
that the last-writer-wins ordering is the caller's responsibility.

## What to read next

- [find-bug.md](find-bug.md) — once your solutions work, look for the
  bugs you might have missed.
- [optimize.md](optimize.md) — for tasks 5, 8, 9, and 11, see how to
  squeeze the next 10× of throughput out of a working implementation.
- [interview.md](interview.md) — turn each task into an interview
  prompt: "walk me through how you'd build this."
