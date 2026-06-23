---
layout: default
title: Fuzzing — Middle
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/middle/
---

# Fuzzing — Middle

[← Back](../)

At the junior level you learned that `go test -fuzz=.` mutates the corpus
and tries to crash your code. That is the surface story. At the middle
level you need to understand what the engine is actually doing under the
hood, because once you start writing real fuzz targets the difference
between "wasted CPU" and "found a CVE in fifteen minutes" comes down to
how you feed inputs into the engine, how you let coverage feedback do
its job, and how you read the artifacts the engine leaves behind in
`testdata/fuzz`.

This page assumes you can already write `func FuzzFoo(f *testing.F)` and
add seed corpus with `f.Add`. We now climb one level: the mutation
engine, structured inputs, reproduction, corpus economics, throughput,
and how to make `f.Fuzz` cooperate with the rest of your test suite.

---

## 1. How the Go fuzz engine mutates inputs

The Go fuzz engine is, by design, a libFuzzer-style coverage-guided
fuzzer. It is not a pure random generator. The flow is roughly this:

1. Start with the seed corpus (everything in `f.Add` plus everything in
   `testdata/fuzz/FuzzXxx/`).
2. Pick an existing input from the corpus.
3. Apply one or more mutation operators to produce a new candidate
   input.
4. Run the fuzz target on that candidate while collecting branch
   coverage.
5. If the candidate exercises a new branch (or a new combination of
   counters), keep it in the in-memory corpus.
6. If the candidate triggers a failure (`t.Fail`, panic, timeout, race),
   write a minimized reproducer to `testdata/fuzz/FuzzXxx/`.
7. Loop.

The interesting word is "mutation operators". The engine maintains a
small portfolio of them and applies them probabilistically. You do not
need to memorize the exact list, but knowing the categories tells you
why some bugs are easy to find and others are not.

### 1.1 Bit flips and byte-level edits

The cheapest operator is the bit flip: pick a random byte in the input,
XOR it with a random bit mask. Variants include flipping a single bit,
flipping a contiguous run of bits, or flipping a whole byte. These
mutations are great for finding bugs that depend on a single boundary
condition, for example "the parser branches differently when the high
bit of byte 0 is set".

Closely related are arithmetic mutations: pick a byte (or a `uint16`,
`uint32`, `uint64` slice) and add or subtract a small integer. This is
what catches off-by-one bugs in length prefixes.

```go
package codec

import "encoding/binary"

// ParseFrame reads a length-prefixed payload. A naive bug would be
// allowing the length to exceed len(b)-4, which causes a panic on the
// slice below. Arithmetic mutations near 0, math.MaxUint16/2 and
// boundary values are exactly what the engine will try.
func ParseFrame(b []byte) ([]byte, error) {
	if len(b) < 4 {
		return nil, errShort
	}
	n := binary.BigEndian.Uint32(b[:4])
	if int(n) > len(b)-4 {
		return nil, errOversize
	}
	return b[4 : 4+n], nil
}
```

If you run a fuzz target against this function, the engine will quickly
try inputs whose first four bytes are `00 00 00 00`, `00 00 00 01`, …,
`FF FF FF FF`, and many neighbouring values. That is not random: it is
arithmetic and bit-flip mutation on top of seeds you provided.

### 1.2 Splice and crossover

A splice operator takes two corpus entries `A` and `B`, picks an offset
in each, and stitches them together to produce a new input
`A[:i] + B[j:]`. This is how the fuzzer combines coverage from
different paths. If one corpus entry walks down the "compressed" branch
and another walks down the "checksum mismatch" branch, the splice can
construct an input that hits both.

Splice is also why your seed corpus matters even when it does not crash
anything. A diverse seed corpus gives the splice operator more raw
material to glue together. Conversely, if you only seed with two
near-identical inputs, splice is almost a no-op.

### 1.3 Insert, delete, duplicate

Length-changing operators are the ones that find buffer-overflow style
bugs in parsers. The engine will pick a random offset, then either
insert a random byte sequence, delete a chunk, or duplicate an existing
chunk. Length-changing mutations are how a fuzzer discovers that your
"this slice is always at least 16 bytes" assumption is wrong.

### 1.4 Dictionary-driven mutations

The Go fuzz engine extracts string and byte literals it sees in your
binary and uses them as a dictionary for "magic constant" insertion.
That is why fuzzing a JSON parser will often produce inputs containing
the bytes `null`, `true`, `false`, `"`, `\\u` — the engine pulled them
out of your code and tries injecting them at random offsets.

You do not need to hand-write a dictionary file (as you would with
libFuzzer). However, knowing this exists changes how you write your
fuzz target: if your parser branches on the literal string
`"X-Forwarded-For"`, that string will appear in the binary, and the
fuzzer will try sticking it into inputs. Removing that literal (for
example by computing it at runtime from individual bytes) actively
hurts the fuzzer.

### 1.5 Coverage feedback in practice

Each fuzz worker is instrumented with `-d=libfuzzer` style edge
counters. After every execution the engine compares the new counter
state against the cumulative counter state. If the new execution lit
up an edge that no previous execution ever hit, the input is promoted
to the in-memory corpus and becomes a candidate for future mutation.

This explains a behavior that confuses many beginners. When you start
`go test -fuzz=FuzzFoo`, the first few seconds the executions-per-second
number is low and unstable. That is the engine doing the initial
"corpus interesting" pass: it runs every seed and every previously
saved input, records what coverage they hit, and only after that begins
mutating in earnest. If your seed corpus is huge (say tens of thousands
of files) this warm-up phase can take a noticeable amount of wall time.

You can sanity-check this with the `-v` flag, which prints lines like:

```text
fuzz: minimizing 87-byte failing input file
fuzz: elapsed: 3s, gathering baseline coverage: 0/124 completed
fuzz: elapsed: 6s, gathering baseline coverage: 124/124 completed
fuzz: elapsed: 6s, execs: 124 (21/sec), new interesting: 9 (total: 9)
fuzz: elapsed: 9s, execs: 41203 (13693/sec), new interesting: 14 (total: 14)
```

The "new interesting" counter only grows when the engine finds an input
that exercises a previously unseen edge. If "new interesting" goes flat
for a long time, it usually means one of two things:

- You have already saturated the easy coverage and need to add more
  seeds, or
- Your fuzz target is structured in a way that prevents the engine from
  reaching new code (for example, you reject all inputs that do not
  decode to valid UTF-8 with `t.Skip`, but the only interesting bugs
  live in the parser that runs after that gate).

---

## 2. Multi-input fuzz functions

The `f.Fuzz` callback can take more than one input parameter. Each
parameter is treated as a separate value the engine will mutate
independently. The supported parameter types are the same as for
`f.Add`: `[]byte`, `string`, the integer types, `bool`, `float32`,
`float64`, and `rune`.

```go
func FuzzMul(f *testing.F) {
	f.Add(int64(2), int64(3))
	f.Add(int64(-1), int64(0))

	f.Fuzz(func(t *testing.T, a int64, b int64) {
		got := SafeMul(a, b)
		want := a * b
		if got != want && !overflow(a, b) {
			t.Fatalf("SafeMul(%d,%d) = %d, plain mul = %d", a, b, got, want)
		}
	})
}
```

Two things to notice:

- `f.Add` must pass exactly the same number and types of arguments as
  the `f.Fuzz` callback expects, otherwise `go test` will fail at
  registration time. This is checked when the test starts, not when a
  particular mutation is generated.
- Mutations are applied per-argument. The engine does not just generate
  a single random blob and slice it up; it treats `a` and `b` as
  independent corpus entries. This means it can hold one of them stable
  while it bit-flips the other, which is exactly what you want when
  hunting for asymmetric bugs.

When should you use multiple arguments versus a single `[]byte`?

Use multiple arguments when the function under test has a small number
of natural primitive inputs (two integers, a string and a regex
pattern, a key and a value). Use a single `[]byte` when the function
under test takes a structured blob and you want to fuzz the parser
itself.

A common middle-ground pattern: take a `[]byte` as the structured
payload and one or two integers as "configuration knobs":

```go
func FuzzCompress(f *testing.F) {
	f.Add([]byte("hello world"), uint8(6))

	f.Fuzz(func(t *testing.T, data []byte, level uint8) {
		lvl := int(level%9) + 1 // map to 1..9
		c, err := Compress(data, lvl)
		if err != nil {
			t.Skip()
		}
		d, err := Decompress(c)
		if err != nil {
			t.Fatalf("decompress: %v", err)
		}
		if string(d) != string(data) {
			t.Fatalf("round-trip mismatch")
		}
	})
}
```

The engine mutates `data` and `level` separately, which means it can
keep an interesting payload constant while it sweeps the level
parameter — useful for catching level-specific bugs.

---

## 3. Custom structured-input fuzzers

Sometimes the function you want to fuzz does not take a `[]byte`. It
takes a domain object: a `User`, a `Config`, an `AST`. You cannot ask
the Go fuzz engine to mutate a `User` directly — it only knows about
the primitive types listed above. So the pattern is:

1. Declare the fuzz target with one or more primitive parameters
   (usually a `[]byte`).
2. Inside `f.Fuzz`, decode the primitives into your domain object.
3. Validate the decoded object. If it cannot be reasonably decoded,
   `t.Skip` and let the engine try again.
4. Run the production logic on the decoded object.

```go
type User struct {
	Name   string
	Age    int
	Admin  bool
	Emails []string
}

func decodeUser(b []byte) (User, bool) {
	if len(b) < 3 {
		return User{}, false
	}
	nameLen := int(b[0])
	if 1+nameLen > len(b) {
		return User{}, false
	}
	name := string(b[1 : 1+nameLen])

	rest := b[1+nameLen:]
	if len(rest) < 2 {
		return User{}, false
	}
	age := int(rest[0])
	admin := rest[1]&1 == 1

	emails := splitNul(rest[2:])
	return User{Name: name, Age: age, Admin: admin, Emails: emails}, true
}

func FuzzUserValidate(f *testing.F) {
	f.Add([]byte{4, 'a', 'l', 'i', 'c', 30, 1, 'a', '@', 'b', 0})

	f.Fuzz(func(t *testing.T, b []byte) {
		u, ok := decodeUser(b)
		if !ok {
			t.Skip()
		}
		_ = Validate(u) // should never panic
	})
}
```

A few practical rules for structured decoders:

- Keep the decoder deterministic. Given the same `[]byte`, it must
  always produce the same `User`. Otherwise the engine cannot minimize
  failing inputs reliably.
- Keep the decoder cheap. It runs on every single execution, so a slow
  decoder caps your throughput.
- Do not impose so many validity checks that 99% of inputs are
  `t.Skip`ped. If you skip almost every input, the engine cannot drive
  coverage forward.
- The decoder is part of the test, so if it has a bug you may chase
  ghosts. Write unit tests for the decoder itself.

### 3.1 Reusing real serialization

If your domain already has a serialization format — JSON, protobuf,
MessagePack — you can reuse it as the decoder.

```go
func FuzzConfigValidate(f *testing.F) {
	// Seed with a known-good encoding.
	good, _ := json.Marshal(Config{MaxConn: 10, Timeout: time.Second})
	f.Add(good)

	f.Fuzz(func(t *testing.T, b []byte) {
		var c Config
		if err := json.Unmarshal(b, &c); err != nil {
			t.Skip()
		}
		_ = Validate(c) // should never panic, even on garbage configs
	})
}
```

This is double-duty fuzzing: you exercise `json.Unmarshal` (which is
robust, but the binding into your struct may still be the source of
bugs) and `Validate` at the same time. The downside is that the engine
spends a lot of time generating inputs that fail JSON parsing and get
skipped. To mitigate this, seed with many valid JSON encodings — the
mutation operators will keep the inputs mostly-valid for a long
window.

---

## 4. Reproducing failures from testdata/fuzz

When `go test -fuzz=.` discovers a failure, it writes the offending
input to `testdata/fuzz/<FuzzName>/<hash>` and prints something like:

```text
--- FAIL: FuzzFoo (0.04s)
    --- FAIL: FuzzFoo (0.00s)
        fuzz_test.go:42: index out of range [4] with length 3
    
    Failing input written to testdata/fuzz/FuzzFoo/d34db33fcafe
    To re-run:
        go test -run=FuzzFoo/d34db33fcafe
```

The file in `testdata/fuzz/FuzzFoo/` is a small text file with a
human-readable format. For a `[]byte` parameter, it looks like:

```text
go test fuzz v1
[]byte("\x00\x01\xff")
```

For a multi-argument fuzz, each argument is one line:

```text
go test fuzz v1
int64(-1)
[]byte("payload")
```

You can edit these files by hand to construct targeted reproducers,
which is useful when triaging.

To re-run a saved failure, two equivalent invocations:

```text
go test -run=FuzzFoo/d34db33fcafe
go test -run=FuzzFoo -count=1
```

The first form executes only the one input file; the second form
executes every file in `testdata/fuzz/FuzzFoo/` as a regular subtest
(this is the same behavior you get from `go test ./...` without the
`-fuzz` flag at all).

That second behavior is the whole reason `testdata/fuzz` exists: every
crash you ever found becomes a permanent regression test, executed by
your CI on every PR forever, without spending fuzz time.

---

## 5. The corpus is checked into git

This is the single most important operational rule of Go fuzzing:

> The `testdata/fuzz/` directory is committed to your repository. It is
> not in `.gitignore`. Every file in it is a regression test, and you
> want CI to run them on every change.

This is not the convention most other fuzzers use. AFL stores the
corpus on disk in some `out/` directory you have to manage. Go folds it
into the standard `testdata` convention you already use for golden
files. The implication is that when your fuzzer discovers a crash on
your laptop and you commit the resulting `testdata/fuzz/FuzzFoo/...`
file, every developer on the team — and CI — now runs that input as a
regression test.

### 5.1 The cache directory

There is a second corpus: the per-machine cache. The Go toolchain
stores additional fuzz inputs in `$GOCACHE/fuzz/<pkg>/FuzzName/`,
which on most systems is something like
`~/.cache/go-build/fuzz/...`. This directory contains every
"interesting" input the engine ever discovered locally, not just the
ones that triggered failures. It is not committed and it is not
shared. It is local-only acceleration.

When you run `go test -fuzz=FuzzFoo`, the engine reads both:

- `testdata/fuzz/FuzzFoo/` — durable, committed, runs even without
  `-fuzz`.
- `$GOCACHE/fuzz/.../FuzzFoo/` — ephemeral, local, used only by
  `-fuzz` runs.

If you want to wipe the local cache (for example to reproduce a clean
"first run" experience), `go clean -fuzzcache` is the supported way.

### 5.2 Promoting cache entries to committed corpus

There is no built-in command to "save the best cache entry into
testdata". You do it manually when you find an input worth keeping. A
common workflow:

1. Run fuzzing for a few hours.
2. Inspect the cache directory.
3. Pick a few inputs that exercise representative branches.
4. Copy them into `testdata/fuzz/FuzzName/` with descriptive filenames.
5. Commit.

```bash
cp ~/.cache/go-build/fuzz/example.com/m/FuzzParse/abc123 \
   testdata/fuzz/FuzzParse/seed-utf8-bom
git add testdata/fuzz/FuzzParse/seed-utf8-bom
```

This is one of the rare cases where good fuzzer hygiene requires
discipline rather than tooling. The reward is faster fuzz startup
because seeded coverage starts from a better baseline.

---

## 6. Corpus minimization and -fuzzminimizetime

When the engine finds a failing input, it does not save the first crash
it sees. It first tries to *minimize* the input — to find the smallest
byte sequence that still triggers the same failure. This is what makes
fuzz reproducers small enough to read.

Minimization is also a separate mode. You can ask the engine to
minimize a known-bad input from `testdata/fuzz`:

```text
go test -run=FuzzFoo -fuzz=FuzzFoo -fuzzminimizetime=30s
```

The interaction between the flags is subtle:

- `-fuzz=<regex>` selects which targets to fuzz.
- `-fuzztime=<duration>` caps total fuzzing time.
- `-fuzzminimizetime=<duration>` caps how long minimization runs after a
  crash is found (default: 1 minute).
- `-fuzzminimizetime=0` disables minimization. Crashes are saved as-is.

When you are in the middle of a long fuzz campaign and you want the
engine to spend its time discovering new bugs rather than polishing the
ones it already has, lower the minimization budget:

```bash
go test -fuzz=FuzzParse -fuzztime=2h -fuzzminimizetime=5s
```

When you are triaging a single nasty crash and want the smallest
possible reproducer to file in a bug report, raise the minimization
budget:

```bash
go test -run=FuzzParse/d34db33f -fuzz=FuzzParse -fuzzminimizetime=10m
```

### 6.1 What "minimization" actually does

Minimization is not magic. The engine repeatedly tries:

- Removing bytes from the failing input.
- Replacing bytes with simpler ones (`0x00`, `0x20`, `'a'`).
- Truncating from the end.

If the modified input still triggers the original failure, it becomes
the new candidate. Otherwise it is discarded. This stops either when
no further reduction is possible or when the minimization budget
expires.

For multi-argument fuzz targets, each argument is minimized in turn.
For integer arguments, "minimize" means moving toward zero. For
booleans, it means flipping to the simpler value (currently `false`).
For strings and byte slices, it means shortening and simplifying
characters.

---

## 7. Using t.Run inside f.Fuzz

`f.Fuzz` gives you a `*testing.T`. That means you can call `t.Run` for
sub-cases inside the fuzz body. This is occasionally useful when a
single fuzzed input drives multiple related checks and you want one to
fail without stopping the others.

```go
f.Fuzz(func(t *testing.T, b []byte) {
	parsed, err := Parse(b)
	if err != nil {
		t.Skip()
	}

	t.Run("round-trip", func(t *testing.T) {
		re, err := Encode(parsed)
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		again, err := Parse(re)
		if err != nil {
			t.Fatalf("parse round-trip: %v", err)
		}
		if !equal(parsed, again) {
			t.Fatal("round-trip mismatch")
		}
	})

	t.Run("invariants", func(t *testing.T) {
		if parsed.Size() < 0 {
			t.Fatal("negative size")
		}
	})
})
```

Be careful: under `-fuzz`, only one input is being driven through this
callback at a time, so the value of `t.Run` is mostly organizational
(better failure messages, grouped logging). Under `go test` (no
`-fuzz`), every file in `testdata/fuzz/...` is replayed and `t.Run`
gives you per-input sub-test names that show up in the report.

There is a subtle gotcha: `t.Parallel()` inside an `f.Fuzz` body is
explicitly not allowed and will cause the engine to mark the run as a
failure. The fuzzing engine already runs multiple workers in parallel
across separate processes; you do not need (and cannot have) goroutine
parallelism within a single execution.

---

## 8. Mocking dependencies inside the fuzz body

Fuzz targets must be deterministic. If you fuzz a function that calls
`time.Now()` or `rand.Int()`, the engine cannot minimize failing inputs
because the same `[]byte` will hit different code paths on different
runs. The standard response is to inject fakes.

```go
type Clock interface {
	Now() time.Time
}

type fixedClock struct{ t time.Time }

func (f fixedClock) Now() time.Time { return f.t }

func FuzzScheduler(f *testing.F) {
	f.Add([]byte{0, 1, 2, 3})

	f.Fuzz(func(t *testing.T, b []byte) {
		clk := fixedClock{t: time.Unix(1_700_000_000, 0)}
		s := NewScheduler(clk)
		_ = s.Process(b) // should never panic
	})
}
```

The same rule applies to:

- Randomness: pass a deterministic `io.Reader` (for example
  `bytes.NewReader(seed)`).
- Network calls: replace with an in-memory fake that returns fixed
  responses.
- File system: use an in-memory FS (`fstest.MapFS`, `afero.NewMemMapFs`).
- Goroutine scheduling: avoid spawning goroutines from inside the fuzz
  body, or join them deterministically before returning.

If you cannot mock something — for example a CGo call into a hardware
crypto module — that code path is not fuzzable in the strict sense and
you should split the function so that the fuzzable piece is pure.

### 8.1 Deterministic seeds

When the function under test takes its own randomness as an input
parameter, the cleanest pattern is to pass it through the fuzz
arguments:

```go
func FuzzShuffle(f *testing.F) {
	f.Add(int64(1), []byte{1, 2, 3, 4, 5})

	f.Fuzz(func(t *testing.T, seed int64, data []byte) {
		r := rand.New(rand.NewSource(seed))
		c := slices.Clone(data)
		Shuffle(r, c)
		if len(c) != len(data) {
			t.Fatal("Shuffle changed length")
		}
	})
}
```

Now the engine controls the seed. Failures are perfectly reproducible
because the seed is part of the saved input file.

---

## 9. Cross-binary fuzzing: running fuzz against a compiled corpus

Sometimes you want to run a fuzz target against inputs you generated
elsewhere — for example a corpus harvested from production traffic, or
a corpus shared with a sibling library written in another language.
The Go fuzz engine does not have a native "import this directory of
raw blobs" command, but the workflow is simple:

1. For each raw input file, write a tiny text wrapper in the corpus
   file format.
2. Drop the wrapper into `testdata/fuzz/FuzzName/`.
3. Run `go test` (or `go test -fuzz`).

The wrapper format is documented above (`go test fuzz v1` header,
then one Go-literal line per argument). You can generate them with a
small helper:

```go
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// convert reads raw bytes from each file in srcDir and writes a Go
// fuzz corpus entry to dstDir.
func convert(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(srcDir, e.Name()))
		if err != nil {
			return err
		}
		body := fmt.Sprintf("go test fuzz v1\n[]byte(%s)\n", strconv.Quote(string(raw)))
		out := filepath.Join(dstDir, "imported-"+e.Name())
		if err := os.WriteFile(out, []byte(body), 0o644); err != nil {
			return err
		}
	}
	return nil
}
```

For multi-argument targets, you need a wrapper that encodes each
argument on its own line. The format is unforgiving — a missing newline
or an unquoted argument will cause `go test` to refuse to load the
corpus entry — but with a small generator it is easy to manage.

### 9.1 Importing from libFuzzer or AFL corpora

LibFuzzer and AFL store one raw blob per file. If your fuzz target
takes a single `[]byte`, the wrapper above is enough. If your target
takes multiple primitive arguments, you have to design a packing
convention (for example "first 8 bytes are big-endian int64, rest is
payload") and have both the importer and the fuzz body agree on it. At
that point you have re-invented part of a structured fuzzer; it is
usually simpler to write a single-`[]byte` fuzz target with a decoder
inside.

---

## 10. Throughput: executions per second

Throughput is the single number that most strongly predicts how many
bugs a fuzzer will find in a given amount of wall time. Doubling
throughput roughly doubles your bug rate. The default `go test -fuzz`
log lines tell you the throughput:

```text
fuzz: elapsed: 30s, execs: 215300 (7176/sec), new interesting: 18
```

"7176/sec" is the current rolling executions-per-second across all
workers combined. Typical numbers on a modern laptop:

- Small pure functions (string parsing, numeric kernels): 50k–500k
  exec/sec per core.
- Medium parsers (JSON, simple binary protocols): 5k–50k exec/sec per
  core.
- Heavy parsers with allocation pressure: 500–5000 exec/sec per core.
- Anything that touches the filesystem, network, or spawns goroutines:
  10–500 exec/sec per core.

If you see numbers in the low hundreds and you expected the high
thousands, the fuzz target is doing too much work per call.

### 10.1 Common throughput killers

**Allocation in the hot path.** Every `make`, every `string(b)`
conversion, every `fmt.Sprintf` allocates and triggers GC pressure.
Fuzzers run the body millions of times; allocation dominates.

**Setup inside f.Fuzz.** Anything that does not depend on the fuzzed
input should live *outside* the callback. The Go fuzz engine calls
your closure once per execution but only constructs the closure once
per worker.

```go
// Bad: rebuilds the regexp every execution.
f.Fuzz(func(t *testing.T, s string) {
	re := regexp.MustCompile(`^foo`)
	_ = re.MatchString(s)
})

// Good: compile once per worker.
re := regexp.MustCompile(`^foo`)
f.Fuzz(func(t *testing.T, s string) {
	_ = re.MatchString(s)
})
```

**Logging.** `t.Logf` is buffered, but a `log.Printf` to stderr is
synchronous and serializes the workers. Never log unconditionally
inside `f.Fuzz`.

**Goroutines.** Spawning a goroutine costs a few hundred nanoseconds
even when the goroutine does nothing. If your fuzz body spawns a
goroutine per execution, you have set a ceiling on throughput of a few
million executions per second per core — which sounds high, but pile
on synchronization and you collapse to a thousand.

### 10.2 Measuring throughput in isolation

If the fuzz body shares logic with a regular function, you can write a
benchmark for that function and compare:

```go
func BenchmarkParse(b *testing.B) {
	in := []byte("seed input")
	for i := 0; i < b.N; i++ {
		_, _ = Parse(in)
	}
}
```

The benchmark gives you ns/op and B/op. As a rough rule, your fuzz
throughput will be slightly worse than `1e9 / ns_per_op` per core
because of fuzzing overhead (coverage counters, mutation, IPC). If the
benchmark says 1000 ns/op (1M op/sec) and the fuzzer reports 200k
exec/sec, your fuzz overhead is acceptable. If the fuzzer reports 5k
exec/sec, something is wrong (often a hidden allocation in the fuzz
body).

### 10.3 Parallel workers

`go test -fuzz` uses one worker per `GOMAXPROCS` by default. You can
override this with the `-parallel` flag, but be aware: more workers
mean more memory pressure and, if your workload is allocation-heavy,
diminishing returns. On a 16-core laptop, 8 workers often outperforms
16 because GC contention drops.

```bash
go test -fuzz=FuzzParse -parallel=8 -fuzztime=10m
```

The `-parallel` flag is shared with non-fuzz `t.Parallel` semantics,
which can be confusing. When you are running a fuzz session, treat
`-parallel` as "number of fuzz workers".

---

## 11. Go modules and cross-module corpus reuse

The Go fuzz toolchain ties the corpus to a specific package within a
specific module. If you have two modules — say `tools/corpus-gen` that
synthesizes inputs and `tools/parser` that consumes them — they cannot
share `testdata/fuzz` directly because each module's `testdata` is
scoped to its own packages.

There are several pragmatic patterns:

### 11.1 Symbolic links inside the same module

If both fuzz targets live in the same module, you can put the corpus
under one canonical package and symlink it from the others:

```text
internal/corpus/parser/
    seed-001
    seed-002
parser/testdata/fuzz/FuzzParse -> ../../internal/corpus/parser
```

`go test` follows the symlink. Be careful with cross-platform support
— Windows handles symlinks differently — and double-check that your CI
clones the repo with symlinks preserved.

### 11.2 A generator package

Put the corpus generator in its own package and have it write into
`testdata/fuzz` directories before tests run. This works but requires
a build step before `go test` and is fragile in CI.

### 11.3 Vendored corpus

For corpora shared across multiple repositories, vendor them as a Go
module that publishes a function returning a `fs.FS`. Each consumer
calls the function during `f.Add` to seed:

```go
func FuzzParse(f *testing.F) {
	for _, p := range corpus.SharedParserSeeds() {
		f.Add(p)
	}
	f.Fuzz(func(t *testing.T, b []byte) { _, _ = Parse(b) })
}
```

This is the cleanest cross-module approach. It does not put the seeds
in `testdata/fuzz` — instead they are added at runtime, which means
they are not minimized as regression tests when you run `go test`
without `-fuzz`. That trade-off is usually acceptable for "shared
seed" corpora.

### 11.4 Crash artifacts cannot be shared automatically

Crashes are saved into the module that hosts the fuzz target. If two
modules fuzz related code, they may discover the same bug
independently and store it in different `testdata/fuzz` directories.
There is no built-in synchronization. If you discover a crash in one
module that you also want to regression-test in another, you have to
copy the input file manually (and likely rewrite it to match the
second fuzz target's argument shape).

---

## 12. Skipping uninteresting inputs

`t.Skip()` (or `t.SkipNow()`) inside `f.Fuzz` is the supported way to
say "this input is not interesting". Skipping has consequences:

- The execution still happens. You pay the cost of decoding and
  validating the input.
- The skip is recorded but the input is not added to the coverage
  corpus.
- The engine continues mutating from the previous corpus entry.

This is useful but easy to misuse. Some rules:

**Skip is not a filter.** Do not use `t.Skip` to mean "I do not want
the engine to consider this category of inputs". The engine will keep
generating them. Better: tighten the structured decoder so it rejects
those inputs cheaply.

**Skip after the cheap checks.** If you can recognize an uninteresting
input in 50 nanoseconds, do so and skip. If recognizing it requires
running the whole production logic, you might as well let the test
finish.

**Do not skip after side effects.** Calling `t.Skip` after you have
already written to a file or sent a network request is a bug — the
skip does not undo the side effect, and if the side effect leaves
state behind, the next execution starts contaminated.

```go
f.Fuzz(func(t *testing.T, b []byte) {
	// Cheap pre-filter: at least one valid header byte.
	if len(b) < 4 || b[0] != 0x7E {
		t.Skip()
	}

	// Now the expensive part is only run on plausible inputs.
	frame, err := DecodeFrame(b)
	if err != nil {
		t.Skip() // malformed but not crashing
	}
	if frame.Length > 1<<20 {
		t.Skip() // would allocate too much for a fuzz test
	}

	process(frame)
})
```

The skip after `DecodeFrame` is the most common pattern: "this input
was not a valid frame, so there is no expected behavior to assert
against". Without that skip, fuzz failures would be dominated by
legitimate `DecodeFrame` errors that are not bugs.

### 12.1 The "skip too much" anti-pattern

If your `t.Skip` rate is above 80%, the engine is wasting cycles.
Symptoms in the log:

```text
fuzz: elapsed: 1m, execs: 432000 (7200/sec), new interesting: 0 (total: 5)
```

Five interesting inputs total after a minute of fuzzing on a small
target almost always means the engine cannot find new code because
your decoder rejects too aggressively. Fixes:

- Seed with more valid inputs so the engine has a fertile starting
  point.
- Loosen the structured decoder so it accepts more shapes.
- Split the fuzz target into two: one for the strict format, one for
  the loose format.

---

## 13. Putting it together: a realistic middle-level fuzz target

The following example exercises most of the techniques on this page.
The function under test is a fictional `Pack`/`Unpack` pair that
serializes a `Record` into a self-describing binary format.

```go
package recpack

import (
	"bytes"
	"errors"
	"math/rand"
	"testing"
	"time"
)

type Record struct {
	ID        uint64
	CreatedAt time.Time
	Tags      []string
	Payload   []byte
}

func decodeFuzz(b []byte) (Record, bool) {
	if len(b) < 16 {
		return Record{}, false
	}
	r := Record{
		ID:        binaryBE.Uint64(b[:8]),
		CreatedAt: time.Unix(int64(binaryBE.Uint32(b[8:12])), 0),
	}
	rest := b[12:]
	tagCount := int(rest[0])
	rest = rest[1:]
	for i := 0; i < tagCount && len(rest) > 0; i++ {
		n := int(rest[0])
		rest = rest[1:]
		if n > len(rest) {
			return Record{}, false
		}
		r.Tags = append(r.Tags, string(rest[:n]))
		rest = rest[n:]
	}
	r.Payload = append(r.Payload, rest...)
	return r, true
}

func FuzzPackRoundtrip(f *testing.F) {
	// Seed with three structurally diverse inputs.
	f.Add([]byte("seed-aaaa-bbbb-cc"), int64(1))
	f.Add([]byte("seed-aaaa-bbbb-cd"), int64(2))
	f.Add([]byte("seed-aaaa-bbbb-ce"), int64(3))

	// Precompute things that do not depend on the fuzzed input.
	var buf bytes.Buffer

	f.Fuzz(func(t *testing.T, b []byte, seed int64) {
		// Decode into a Record. Skip if structurally invalid.
		rec, ok := decodeFuzz(b)
		if !ok {
			t.Skip()
		}

		// Inject deterministic randomness in case Pack uses any.
		r := rand.New(rand.NewSource(seed))
		_ = r

		buf.Reset()
		if err := Pack(&buf, rec); err != nil {
			// Pack should never error on a structurally valid record.
			if errors.Is(err, ErrUnsupported) {
				t.Skip() // documented case where Pack refuses
			}
			t.Fatalf("Pack failed on valid record: %v", err)
		}

		// Unpack and compare.
		got, err := Unpack(buf.Bytes())
		if err != nil {
			t.Fatalf("Unpack of Pack output failed: %v", err)
		}

		t.Run("identity", func(t *testing.T) {
			if got.ID != rec.ID {
				t.Errorf("ID mismatch: got %d, want %d", got.ID, rec.ID)
			}
		})

		t.Run("tags", func(t *testing.T) {
			if len(got.Tags) != len(rec.Tags) {
				t.Errorf("tag count mismatch")
				return
			}
			for i := range got.Tags {
				if got.Tags[i] != rec.Tags[i] {
					t.Errorf("tag %d mismatch", i)
				}
			}
		})

		t.Run("payload", func(t *testing.T) {
			if !bytes.Equal(got.Payload, rec.Payload) {
				t.Errorf("payload mismatch")
			}
		})
	})
}
```

What this target demonstrates:

- **Multi-argument fuzzing**: `[]byte` and `int64`, mutated
  independently.
- **Structured decoder**: `decodeFuzz` translates raw bytes into a
  `Record`. It is cheap, deterministic, and skips clearly invalid
  inputs early.
- **Deterministic randomness**: `rand.New(rand.NewSource(seed))` so
  that if `Pack` uses entropy, the same input always produces the same
  output.
- **Setup outside the body**: `var buf bytes.Buffer` lives outside the
  closure and is reused across executions to save allocations. (This
  is safe because each worker has its own copy of the closure; do not
  share buffers across goroutines.)
- **Skip on legitimate refusals**: `ErrUnsupported` is documented
  behavior, not a bug, so skip instead of fail.
- **`t.Run` sub-cases**: identity, tags, and payload are reported as
  separate sub-tests so a single fuzz failure pinpoints the property
  that broke.

When this target finds a bug, the engine will:

1. Save the failing `[]byte` and `int64` to
   `testdata/fuzz/FuzzPackRoundtrip/<hash>`.
2. Try to minimize it down to the smallest reproducer (subject to
   `-fuzzminimizetime`).
3. Print a `go test -run=...` command you can paste into your shell to
   re-run the failure.

Once committed, the file in `testdata/fuzz` runs as a regular subtest
on every `go test ./...` invocation, forever.

---

## 14. Operational tips and frequently overlooked details

A scattered list of things you will only learn by running long fuzz
sessions:

**Long fuzz runs need `-fuzztime`.** Without it, the fuzzer runs
forever (or until you press Ctrl+C). For CI, set a budget. A common
pattern is `-fuzztime=60s` per target on every PR, with a nightly job
running `-fuzztime=4h` per target on a beefier machine.

**`-fuzz=<regex>` selects a single target.** If you have ten fuzz
targets in the same package and write `-fuzz=.`, only the first one
matched will run; the engine fuzzes one target at a time. To fuzz
several targets in sequence, script it externally:

```bash
for target in FuzzParse FuzzPack FuzzScan; do
  go test -fuzz=^${target}$ -fuzztime=10m -run=^$ ./...
done
```

The `-run=^$` makes the regular tests no-ops so only fuzzing happens.

**Crashes are not always panics.** A `t.Errorf` followed by a normal
return is enough to mark the input as failing. So is exceeding the
`-timeout` for the test binary. The engine treats any non-pass result
from `f.Fuzz` as a discovery.

**Race detector slows fuzzing.** `go test -race -fuzz` is supported
and very useful — it finds races that normal fuzzing would miss — but
throughput drops 5–10x. Run with `-race` periodically, not on every
session.

**Memory usage grows.** Each worker accumulates an in-memory corpus
of "interesting" inputs. After a long run, RSS can reach a few GB per
worker. If you see your fuzz machine swapping, lower `-parallel` or
add `-fuzztime` boundaries so the workers restart.

**The corpus file format can be tested.** If you write tooling that
generates `testdata/fuzz` files, validate it by running `go test` on
the produced files. A malformed file is silently ignored (with a
warning), which leads to "my regression test is not running" mysteries.

**`go clean -fuzzcache` does not touch testdata.** It only deletes the
local accelerator cache. Your committed corpus is safe.

---

## 15. Mental model: when has fuzzing "finished"?

Strictly speaking, fuzzing is never finished. New bugs continue to be
discoverable as long as you have time and CPU. But there are useful
operational thresholds:

- **Coverage plateaued.** "new interesting" has stayed at zero for an
  hour despite continued execution. Either you have saturated the
  reachable code or your seed corpus is too narrow. Adding hand-written
  seeds can break the plateau.
- **No new failures.** No crashes have been written to `testdata/fuzz`
  in 24 hours of continuous fuzzing. Reasonable signal that the target
  is robust against the current corpus.
- **Mutation budget exhausted.** This is a heuristic the engine does
  not report, but in practice if your `-fuzztime` is 8 hours and
  throughput is steady, you have explored most of the easy mutation
  neighborhood.

For most production use cases, "ran for several hours under `-race`
with no new crashes and stable coverage" is the operational stop
signal. After that, more fuzzing helps but with diminishing returns;
your time is better spent on a new target.

---

## 16. Recap

At the middle level you have moved from "I can write a fuzz target"
to "I can run a fuzz campaign". The key mental shifts:

- The engine is **coverage-guided**, not random. It uses your binary's
  embedded literals as a dictionary and rewards mutations that hit new
  branches.
- Multi-argument fuzz functions are mutated **per argument**. Use them
  when the function under test has natural primitive inputs.
- Structured fuzzing works by **decoding `[]byte` into a typed value**
  inside the body. Keep the decoder cheap and deterministic.
- The corpus split is **`testdata/fuzz` (committed, eternal) and the
  cache (local, ephemeral)**. Crashes are written to the former.
  Promote interesting cache entries by hand.
- **Throughput is the single most important number**. Anything that
  allocates, logs, or spawns goroutines inside the fuzz body costs
  bugs-per-hour.
- **`t.Skip` is for "uninteresting", not "filter me out"**. If you
  skip too much, the engine cannot find coverage.
- **`-fuzzminimizetime`** balances discovery against reproducer
  quality. Tune it per session: short for discovery, long for triage.
- Cross-module corpus reuse is **a convention, not a tool feature**.
  Vendor a generator package or symlink within a module.

With these patterns in hand, you are ready to fuzz parsers, serdes
layers, state machines, and protocol handlers in production code.
The senior page covers what comes next: differential fuzzing, OSS-Fuzz
integration, structured input grammars, and continuous fuzzing
infrastructure.

[← Back](../)
