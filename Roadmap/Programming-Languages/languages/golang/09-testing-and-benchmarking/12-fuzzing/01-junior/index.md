---
layout: default
title: Fuzzing — Junior
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/01-junior/
---

# Fuzzing — Junior

[← Back](../)

This is the entry-level walkthrough. By the end you will have written,
executed, and reproduced a finding from your first Go fuzz test. No prior
experience with fuzzing is assumed. You only need to know how to write a
regular `func TestXxx(t *testing.T)` and to run `go test`.

## What problem does fuzzing solve?

Imagine you wrote a function that takes a string and returns its reverse.
You write a unit test:

```go
func TestReverse(t *testing.T) {
    if Reverse("abc") != "cba" {
        t.Fail()
    }
}
```

This test passes. But have you actually verified that `Reverse` works for
all strings? What about an empty string? A string with Unicode? A string
that is one terabyte long? A string with embedded null bytes? You did not
think of any of those — you just thought of `"abc"`.

A unit test is a hand-picked example. It tells you the function works for
that one example. Fuzzing is the opposite philosophy. You tell the test
runner: "Here is a function. Here are a couple of starting examples. Now
generate millions of variations on those examples, run them through the
function, and tell me when something breaks."

The runtime synthesizes those inputs by mutating bytes: flipping bits,
inserting characters, copying segments, shrinking the input, growing it.
It also watches which lines of code each input executes. When an input
exercises a new branch, the runtime keeps it as a starting point for
further mutations. This is called "coverage-guided fuzzing", and it is
why a modern fuzzer can find a parser bug in seconds that no human reviewer
would have spotted.

Go got native, built-in fuzzing in version 1.18, released in March 2022.
Before that, the community relied on external tools (`go-fuzz` and
`gofuzz`); we will mention those later but the rest of this page uses the
standard library only.

## A short story about why this matters

A team I worked with shipped a CSV import endpoint. The endpoint
parsed user-uploaded CSV files and inserted rows into a database.
The code was well tested with a dozen unit tests covering valid
input, the empty file case, files with extra whitespace, files with
quoted strings containing commas. All the obvious cases.

One morning, the on-call engineer was paged. A specific large
customer was uploading files that crashed the parsing service. The
process was restarted automatically but kept crashing again on the
same input. The customer's pipeline was blocked.

The crashing input turned out to be a CSV with a row containing a
field that started with a quote but never ended with one. The
parser's state machine reached end-of-input while expecting a
closing quote, took an unguarded branch, and dereferenced a nil
pointer.

This bug would have been found in three seconds by a fuzz test
that asserted "parsing any input does not panic". The unit tests
did not catch it because nobody thought to write a test for
"unbalanced quote at end of file". Nobody thinks of every edge
case. Fuzzers do.

We added the fuzz target after the incident. It immediately found
two more crashers (different state-machine paths, similar pattern).
The team committed the saved inputs as regression tests. The
endpoint has not crashed in production since.

This is the whole pitch for native fuzzing in one paragraph: it
finds the bugs you would not have thought to write tests for.

## A bit of history

Before Go 1.18, fuzzing was possible but awkward. The community-built
`go-fuzz` tool worked, was widely used, and found many bugs, but it
was not integrated with `go test`. You had to install a separate
binary, build a separate instrumented binary, and manage corpus
directories outside of your project layout.

The native fuzzing proposal (golang/go#44551, accepted in 2020) brought
fuzzing into the standard testing tool. Its goals were:

- Make fuzzing accessible to every Go developer with no extra install.
- Share the `testing` package idioms — corpus seeds look like
  table-driven tests, failures look like test failures.
- Save discovered crashers as regression tests automatically.
- Integrate with `go test` so the existing test runner handles both
  unit and fuzz tests.

The first version shipped in Go 1.18 in March 2022. Later releases
refined the corpus format, improved minimization, and added support
for more types. As of Go 1.22, the implementation is stable enough to
be used in production CI without surprises.

## Why coverage feedback matters

There are two main approaches to randomized testing:

The first is "dumb" random testing. Generate random bytes, feed them
to the function, see if it crashes. This finds shallow bugs — null
checks missing, off-by-one on length zero, division by zero — but
struggles with anything that requires a specific structure in the
input. If the function under test does something like
`if data[0] == 0x4D && data[1] == 0x5A` (a Windows PE binary
magic-number check), then "dumb" random testing has a one-in-65536
chance of getting past the check on any given input. Most random
bytes never exercise the code beyond the magic-number check.

The second is coverage-guided testing. Run the input through
instrumented code, observe which branches were taken, and prefer to
mutate inputs that took new branches. When the input
`{0x4D, 0x5A, ...random...}` reaches the post-magic code, the engine
notices the new coverage edge and keeps that input as a starting
point. Future mutations preserve the magic bytes and vary the rest.
The engine has effectively "learned" the structural requirement of
the input.

This is why coverage-guided fuzzing finds deep bugs that dumb random
testing never reaches. Go's native fuzzer uses coverage feedback by
default; you do not have to opt in.

## Anatomy of a fuzz test

A fuzz test lives in a `_test.go` file just like a unit test, but its
signature is different:

```go
func FuzzXxx(f *testing.F) {
    // ...
}
```

Note three things:

1. The name must start with `Fuzz`.
2. The argument is `*testing.F`, not `*testing.T`.
3. There is no return value.

Inside the body, you do two things: register seed inputs with `f.Add`, and
declare a fuzz target with `f.Fuzz`. The fuzz target is a function that
takes `*testing.T` followed by the inputs you want the engine to mutate.

A complete first example:

```go
package mypkg

import (
    "strings"
    "testing"
    "unicode/utf8"
)

func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Add("")
    f.Add("a")
    f.Fuzz(func(t *testing.T, s string) {
        rev := Reverse(s)
        doubleRev := Reverse(rev)
        if s != doubleRev {
            t.Errorf("Reverse(Reverse(%q)) = %q, want %q", s, doubleRev, s)
        }
        if utf8.ValidString(s) && !utf8.ValidString(rev) {
            t.Errorf("Reverse produced invalid UTF-8 from valid input %q", s)
        }
    })
    _ = strings.ToLower
}
```

Read through this carefully. We declared three seeds (`"hello"`, `""`,
`"a"`) and a target function that takes one `string` parameter. The target
expresses two properties that should hold for any string:

- Reversing twice should return the original.
- A valid UTF-8 string should reverse into another valid UTF-8 string.

Notice that we did not pick *which* strings to test. We declared
properties; the engine will generate the strings.

## Running it

There are two ways to invoke a fuzz test:

```bash
go test ./mypkg
```

This is the same command you run for unit tests. When invoked this way,
the runtime treats your seed corpus (the `f.Add` entries plus anything in
`testdata/fuzz/FuzzReverse/`) as regular subtests. It does not mutate
anything. The test passes if every seed passes.

This mode is the regression-test layer. Once a bug is found and the
crashing input is saved on disk, that input becomes a permanent test
case. Future versions of the code must continue to handle it correctly.

To actually fuzz:

```bash
go test -fuzz=FuzzReverse -fuzztime=10s ./mypkg
```

The `-fuzz` flag activates the engine. It accepts a regular expression;
exactly one fuzz target across the package set must match it. The
`-fuzztime` flag tells the engine how long to run. Acceptable values
include `10s`, `1m`, `2h`. Without it, fuzzing runs until you hit Ctrl-C.

Sample output for a working target:

```
fuzz: elapsed: 0s, gathering baseline coverage: 0/3 completed
fuzz: elapsed: 0s, gathering baseline coverage: 3/3 completed, now fuzzing with 8 workers
fuzz: elapsed: 3s, execs: 95481 (31827/sec), new interesting: 12 (total: 15)
fuzz: elapsed: 6s, execs: 198763 (34427/sec), new interesting: 4 (total: 19)
fuzz: elapsed: 10s, execs: 332119 (33415/sec), new interesting: 0 (total: 19)
PASS
ok      example.com/mypkg       10.214s
```

Read the line `execs: 332119`. That is the number of times the engine
called `Reverse` with a new input. Compare with a typical unit test which
might exercise a function 10 times. Fuzzing widens your test coverage by
many orders of magnitude.

## What a failure looks like

If the property is violated, the engine prints a panic-style trace and
saves the offending input under `testdata/fuzz/FuzzReverse/`:

```
fuzz: minimizing 56-byte failing input file
--- FAIL: FuzzReverse (0.21s)
    --- FAIL: FuzzReverse/8a1c91d6c1...
        reverse_test.go:18: Reverse produced invalid UTF-8 from valid input "\xc3\xa9"
    Failing input written to testdata/fuzz/FuzzReverse/8a1c91d6c1...
    To re-run:
    go test -run=FuzzReverse/8a1c91d6c1...
FAIL
exit status 1
```

Notice the line "minimizing 56-byte failing input file". The engine first
finds a long input that fails, then mutates it down to the smallest input
that still fails. The two-byte UTF-8 sequence for `é` is the minimal
counterexample. Without minimization you might receive a thousand-byte
random blob and have to figure out why it failed; with minimization the
counterexample is small enough to think about.

The file path inside `testdata/fuzz/FuzzReverse/` is the SHA hash of the
input. You commit it to your repository. Now, every time someone runs
`go test`, that exact input is replayed. The bug, once found, is a
permanent regression test.

## What "minimizing" does

Notice the line `fuzz: minimizing 56-byte failing input file`. This
step is worth understanding because it makes the difference between
"the fuzzer says something failed" and "the fuzzer says exactly this
input fails".

Without minimization, the engine reports the first input it found that
fails. That input is whatever happened to be mutated when the bug
surfaced — it could be hundreds or thousands of bytes long, with a
mix of random noise and structurally important bytes. Useless for
debugging.

With minimization, the engine takes the failing input and tries
smaller variants: cutting bytes off the end, removing bytes from the
middle, halving repeated regions, setting integers to zero. Each
variant is run through the target. If it still fails, the engine
keeps the smaller variant and repeats. The process terminates when no
further reduction preserves the failure.

The result is the minimal input that triggers the bug. For the UTF-8
case mapping example earlier, the minimal input was two bytes. For a
JSON parser bug, it might be five bytes (`{"a":}`). The minimization
budget is controlled by `-fuzzminimizetime` (default 60 seconds per
failure).

If a fuzz run completes minimization and the saved input is still
suspiciously large, something interfered with the process — usually
an internal `panic` that was caught by `recover` in test code but
not reported as a `t.Fail`. The minimizer cannot reduce inputs whose
"failing behaviour" it cannot observe.

## Reproducing a finding

The error message gives you the command:

```bash
go test -run=FuzzReverse/8a1c91d6c1...
```

This replays the saved input as a regular subtest. You can set a debugger
breakpoint, inspect the input, walk through the code. Without
`-fuzz`, no mutation happens; the existing input is run unchanged.

If you want to look at the file contents:

```bash
cat testdata/fuzz/FuzzReverse/8a1c91d6c1...
```

```
go test fuzz v1
string("é")
```

The first line is the file format version. Subsequent lines are
Go-syntax literals for each parameter your fuzz target takes. This file
is human-readable; you can hand-edit it to test variations.

## The corpus directories

Two locations matter:

- `testdata/fuzz/FuzzXxx/` — committed to source control. Holds the
  starting seeds (anything you wrote with `f.Add` after you persisted it
  there) and minimized failure inputs. Every `go test` run treats files
  here as regression tests.
- `$GOCACHE/fuzz/<module>/FuzzXxx/` — local cache. Holds the inputs that
  the engine has discovered to be "interesting" (they hit a new code
  branch). On Linux this typically resolves to
  `$HOME/.cache/go-build/fuzz/`. You do not commit this directory; it is
  regenerated as the engine learns more about your code.

The local cache is what makes back-to-back fuzz runs progressively better:
the engine picks up where it left off.

## What the engine actually does between iterations

Each worker is a goroutine running a tight loop. Roughly, in
pseudo-code:

```text
loop:
    parent = pick_random(corpus)
    mutated = mutate(parent)
    coverage_before = current_coverage()
    run_target(mutated)
    coverage_after = current_coverage()
    if coverage_after != coverage_before:
        add_to_corpus(mutated)
        save_to_disk_cache(mutated)
    if target_failed():
        minimized = minimize(mutated)
        save_to_testdata(minimized)
        report_failure(minimized)
        exit
```

The `mutate` step picks one of many strategies: bit flips, byte
insertions, replacements with magic constants, splicing bytes from a
different parent. The `current_coverage` step reads the global
coverage bitmap maintained by the instrumentation.

The `minimize` step is what turns long inputs into short ones. It
repeatedly tries smaller variants — halving lengths, removing bytes,
replacing values with zero — until any further shrinking makes the
target stop failing. The minimized input is what gets saved.

You do not need to understand the implementation in detail to use
fuzzing, but knowing that "mutate, check coverage, save if new" is
the inner loop helps you make sense of the live progress output and
the `new interesting` counter.

## A first failure: dissecting the output

Let us go back to the worked example and look at a real failure
report line by line. Run:

```bash
go test -fuzz=FuzzReverse -fuzztime=10s
```

You see:

```
fuzz: elapsed: 0s, gathering baseline coverage: 0/3 completed
```

The engine is running the three `f.Add` seeds once each to establish
baseline coverage. With three seeds, this completes essentially
instantly.

```
fuzz: elapsed: 0s, gathering baseline coverage: 3/3 completed, now fuzzing with 8 workers
```

The engine spawned eight worker goroutines (one per CPU on an
8-core machine). Each worker now picks random corpus entries,
mutates them, and runs the target.

```
fuzz: minimizing 56-byte failing input file
```

A worker found an input that fails. The engine has paused new
mutation and is now shrinking this specific failing input.

```
fuzz: elapsed: 0s, minimizing
```

Minimization is taking less than a second.

```
--- FAIL: FuzzReverse (0.21s)
```

The fuzz test overall has failed. The 0.21s is the wall time from
start of `-fuzz` to the failure being reported.

```
    --- FAIL: FuzzReverse/8a1c91d6c1...
```

The specific subtest (one for each corpus entry plus one for each
mutation that fails) that produced the failure. The hex string is
the SHA prefix of the file that was just written to disk.

```
        reverse_test.go:18: Reverse produced invalid UTF-8 from valid input "\xc3\xa9"
```

The line in your test file where `t.Errorf` was called, and the
message you wrote. The argument is the minimized input that
triggered the failure.

```
    Failing input written to testdata/fuzz/FuzzReverse/8a1c91d6c1...
    To re-run:
    go test -run=FuzzReverse/8a1c91d6c1...
```

The runtime tells you exactly how to reproduce. Copy the command,
paste it, run it. Single-worker, deterministic, ready for a debugger
breakpoint.

```
FAIL
exit status 1
```

Standard non-zero exit. CI will mark this build failed.

That is the whole shape of a fuzz failure report. Memorize it; you
will see it a lot.

## The supported parameter types

Native fuzzing accepts only a fixed list of parameter types in the fuzz
target. As of Go 1.22 the list is:

- `[]byte`
- `string`
- `bool`
- `byte`, `rune`
- All sized integers: `int`, `int8`, `int16`, `int32`, `int64`, `uint`,
  `uint8`, `uint16`, `uint32`, `uint64`
- `float32`, `float64`

That is it. No slices of other types, no maps, no structs, no
interfaces, no channels. This is documented in the godoc for
`testing.F.Fuzz` and was an intentional design choice in proposal
golang/go#44551. The constraint keeps the engine simple and the
serialization format readable.

When you need a richer input type, the workaround is to take basic types
in the fuzz target and assemble the rich type yourself:

```go
f.Fuzz(func(t *testing.T, key, value string, count int) {
    m := make(map[string]string, count)
    for i := 0; i < count && i < 1000; i++ {
        m[fmt.Sprintf("%s-%d", key, i)] = value
    }
    _ = processMap(m)
})
```

## Going step by step through your first crash

Let us walk through what happens when a fuzz target finds a bug. Start
with this buggy function:

```go
package mypkg

func splitAt(s string, i int) (string, string) {
    return s[:i], s[i:]
}
```

The bug: `i` might be negative, larger than `len(s)`, or land in the
middle of a UTF-8 multi-byte sequence. The function as written panics
or produces invalid UTF-8 on any of those inputs.

A fuzz target:

```go
func FuzzSplitAt(f *testing.F) {
    f.Add("hello", 2)
    f.Fuzz(func(t *testing.T, s string, i int) {
        a, b := splitAt(s, i)
        if a+b != s {
            t.Errorf("split lost data: %q + %q != %q", a, b, s)
        }
    })
}
```

Run with `go test -fuzz=FuzzSplitAt -fuzztime=3s`. The output:

```
fuzz: elapsed: 0s, gathering baseline coverage: 0/1 completed
fuzz: elapsed: 0s, gathering baseline coverage: 1/1 completed, now fuzzing with 8 workers
fuzz: minimizing 25-byte failing input file
fuzz: elapsed: 0s, minimizing
--- FAIL: FuzzSplitAt (0.04s)
    --- FAIL: FuzzSplitAt/de5e6e7e6e... (0.00s)
        splitat_test.go:8: runtime error: slice bounds out of range [-1:]
    Failing input written to testdata/fuzz/FuzzSplitAt/de5e6e7e6e...
    To re-run:
    go test -run=FuzzSplitAt/de5e6e7e6e...
FAIL
```

The engine took under a second to find a negative index. Look at the
saved file:

```
go test fuzz v1
string("")
int(-1)
```

That is the minimal failing input — an empty string with a negative
index. You did not have to think about this case; the engine did.

Fix the function:

```go
func splitAt(s string, i int) (string, string) {
    if i < 0 {
        i = 0
    }
    if i > len(s) {
        i = len(s)
    }
    return s[:i], s[i:]
}
```

Re-run the fuzz test:

```
fuzz: elapsed: 3s, execs: 478291 (159430/sec), new interesting: 0 (total: 14)
PASS
```

The original failing input — still saved in `testdata/fuzz/` — is now
exercised as a regression test on every `go test`. The bug cannot
silently come back.

This loop is the daily rhythm: fuzz finds bug, you fix bug, fuzz
finds the next bug (or eventually does not). The first three runs of
a new fuzz target on previously un-fuzzed code typically find three
to five bugs in succession. After that the rate drops and the engine
spends most of its time exploring without findings.

## When you do not have a property

The most common new-to-fuzzing mistake is to ask: "What property should I
assert?" — and then stall. You do not always need a clever invariant.
The single weakest property is "the function does not panic". That alone
is enough to make a fuzz test worth writing for any code that consumes
untrusted bytes:

```go
func FuzzParseConfig(f *testing.F) {
    f.Add([]byte(`{"name":"x"}`))
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = ParseConfig(data)
    })
}
```

If `ParseConfig` ever panics on any byte sequence, the fuzzer will find
it. Panics in code that consumes user input are essentially always
bugs — they crash the whole process. So "does not panic" is, by itself,
a useful spec.

You can add stronger properties on top:

- Round trips: `decode(encode(x))` equals `x`.
- Idempotence: `f(f(x))` equals `f(x)`.
- Commutativity: `merge(a, b)` equals `merge(b, a)`.
- Differential: your implementation agrees with a reference.

## Running fuzz alongside unit tests in CI

A small but important detail: `go test ./...` (no flags) is friendly
to fuzz tests. It runs every committed seed in `testdata/fuzz/`
as a regular subtest. Your CI pipeline does not need a special
fuzz step to benefit from the regression-test layer.

This means: on the day you add your first fuzz target with a few
seeds, your CI gains regression coverage for those seeds with no
extra work. If the fuzz target found a bug locally and you committed
the saved input, that bug becomes a permanent regression test
without any change to CI config.

The optional second step — actually running `-fuzz=Fuzz
-fuzztime=...` in CI — is what the Middle and Professional pages
cover. It is the higher-effort, higher-payoff layer. The basic
regression layer is free.

## Reading the runtime's live output line by line

When fuzzing is active, the runtime prints a status line every few
seconds. Decoded:

```
fuzz: elapsed: 12s, execs: 487213 (40601/sec), new interesting: 3 (total: 21)
```

`elapsed: 12s` — wall time since `-fuzz` started.

`execs: 487213` — total number of times the fuzz target was called
across all workers since startup.

`(40601/sec)` — average iterations per second over the last reporting
interval. This is the exec rate, and it is the single most important
number to watch. Healthy targets run at 10,000 to 100,000/sec. Slow
targets at 100 to 1000/sec are starving the engine of exploration
time.

`new interesting: 3` — the number of inputs found in the last
interval that hit a coverage edge nobody has hit before. When this
number is positive, the engine is actively learning new code paths.
When it has been zero for many intervals, exploration has plateaued.

`total: 21` — total corpus size: seeds plus all discovered inputs.
This count grows whenever the engine finds new coverage.

The first status line after startup looks slightly different:

```
fuzz: elapsed: 0s, gathering baseline coverage: 0/3 completed
```

The engine is running the seeds once each to establish baseline
coverage before any mutation begins. With three seeds, you see
`0/3`, `1/3`, `2/3`, `3/3` and then `now fuzzing with N workers`.

If a seed itself fails, fuzzing aborts:

```
--- FAIL: FuzzXxx (0.00s)
    --- FAIL: FuzzXxx/seed#0
        ...
```

This is rare but means your committed seed corpus has a regression.
Fix the seed (or the code) before re-running fuzz.

## Where the runtime puts files on disk

It is worth peeking at the cache directory once. On Linux:

```bash
ls $(go env GOCACHE)/fuzz/example.com/mypkg/FuzzReverse/
```

You will see a list of hash-named files, each one a couple hundred
bytes. Open one:

```bash
cat $(go env GOCACHE)/fuzz/example.com/mypkg/FuzzReverse/a1b2c3d4e5
```

Output is the same format as committed seeds:

```
go test fuzz v1
string("\xc3\xa9")
```

These files are write-only from the engine's perspective. You do not
need to touch them, and they will be cleaned out by
`go clean -fuzzcache`. They exist so that running `go test -fuzz` a
second time on the same machine continues from where the previous
run left off, rather than starting from zero coverage.

Compare with the committed corpus:

```bash
ls testdata/fuzz/FuzzReverse/
```

Files here are part of your repository. Some have hash names (the
minimized crashers from CI), some have meaningful names (hand-curated
seeds you committed manually). Both are read on every `go test`.

## Common beginner mistakes

1. Forgetting that `f.Add` types must exactly match the fuzz target
   parameter types. Passing `f.Add(42)` when the target takes `int64`
   is a compile-time-clean but runtime mismatch.
2. Writing expensive setup inside `f.Fuzz`. The inner function runs
   millions of times — read config files outside it.
3. Forgetting to commit the saved failure inputs. The engine wrote them
   to `testdata/fuzz/FuzzXxx/` for a reason; without them the bug can
   reappear in a future release.
4. Running `-fuzz=Fuzz` when multiple fuzz targets match — `go test`
   refuses to fuzz more than one at a time. Either narrow the regex or
   run them sequentially.

## A worked example — base64 decoder

Suppose you have a base64 decoder and you want to fuzz it. The
property: any output of the encoder should decode back to the original
input. The strict round-trip:

```go
import "encoding/base64"

func FuzzBase64RoundTrip(f *testing.F) {
    f.Add([]byte("hello"))
    f.Add([]byte{})
    f.Add([]byte{0, 1, 2, 3, 4, 5})
    f.Fuzz(func(t *testing.T, data []byte) {
        encoded := base64.StdEncoding.EncodeToString(data)
        decoded, err := base64.StdEncoding.DecodeString(encoded)
        if err != nil {
            t.Fatalf("decode after encode failed: %v", err)
        }
        if !bytes.Equal(data, decoded) {
            t.Fatalf("round trip lost data: %x -> %x", data, decoded)
        }
    })
}
```

For the standard `encoding/base64` package, this fuzz target will run
indefinitely without finding a failure. The decoder is correct. But
the *exercise* is valuable: you have a fuzz target ready for the day
someone introduces a bug, and the saved corpus grows to cover input
sizes from zero bytes to several kilobytes.

The reverse property — "any string the decoder accepts should encode
back to the same string" — is *not* universally true. The decoder
accepts inputs with arbitrary whitespace, optional padding, and other
permissive features. The encoder always produces a canonical form. So
asserting `Encode(Decode(s)) == s` for all `s` would find counter-
examples that are not bugs.

This is the most important lesson about round-trip properties: pick
the direction where the property actually holds. Encode then decode
is usually safe. Decode then encode usually is not.

## A worked example — URL parser

Fuzz `net/url.Parse`:

```go
func FuzzURLParse(f *testing.F) {
    f.Add("http://example.com")
    f.Add("/path/to/resource?q=1")
    f.Add("")
    f.Fuzz(func(t *testing.T, raw string) {
        u, err := url.Parse(raw)
        if err != nil {
            return
        }
        s := u.String()
        u2, err := url.Parse(s)
        if err != nil {
            t.Fatalf("re-parse failed: %q -> %q -> %v", raw, s, err)
        }
        if u.String() != u2.String() {
            t.Fatalf("string round trip not stable: %q vs %q",
                u.String(), u2.String())
        }
    })
}
```

The property here is weaker than full equality on the URL struct — we
only assert that `u.String()` is idempotent under re-parsing. This is
because `url.Parse` accepts equivalent forms (`http://example.com`
and `http://example.com/`) and folds them into a canonical form on
`String()`. The idempotence of the canonical form is what we assert.

Run this against historical Go versions and you will find bugs.
Recent versions are quite robust. The fuzz target survives as a
regression test.

## A second worked example — number parser

Let us try a slightly richer target. Suppose you have a function
`parseInt` that converts a string of digits into an integer.

```go
package mypkg

import "errors"

func parseInt(s string) (int, error) {
    if s == "" {
        return 0, errors.New("empty")
    }
    n := 0
    for _, c := range s {
        if c < '0' || c > '9' {
            return 0, errors.New("not a digit")
        }
        n = n*10 + int(c-'0')
    }
    return n, nil
}
```

This is a deliberately naive implementation. It does not handle leading
signs, it does not handle overflow, it does not handle whitespace. A
fuzz test against the standard library's `strconv.Atoi` will surface
all of these:

```go
func FuzzParseInt(f *testing.F) {
    f.Add("0")
    f.Add("123")
    f.Add("")
    f.Fuzz(func(t *testing.T, s string) {
        mine, myErr := parseInt(s)
        ref, refErr := strconv.Atoi(s)
        if (myErr == nil) != (refErr == nil) {
            t.Errorf("error disagreement on %q: mine=%v ref=%v",
                s, myErr, refErr)
        }
        if myErr == nil && refErr == nil && mine != ref {
            t.Errorf("value disagreement on %q: mine=%d ref=%d",
                s, mine, ref)
        }
    })
}
```

Run it for 10 seconds. The engine finds within milliseconds that
`parseInt("-1")` returns an error while `strconv.Atoi("-1")` returns
`-1`. It then finds that `parseInt("1234567890123456789012345")`
silently overflows while `strconv.Atoi` returns `ErrRange`. Each
finding is saved in `testdata/fuzz/FuzzParseInt/`. Fix one bug, re-run
fuzzing, find the next bug.

This loop — fuzz, fix, fuzz, fix — is the daily rhythm of working with
the tool. The first run usually finds bugs in seconds. As you fix
them, the engine's exec/s per finding climbs. Eventually you reach a
state where minutes pass with no new findings: your code now agrees
with the reference over the input space the engine can explore.

## Naming conventions

A few names matter:

- `FuzzXxx` is the test function. The `Xxx` part is what you reference
  in the `-fuzz` flag.
- `*testing.F` is conventionally named `f`.
- The inner function takes `*testing.T`, conventionally `t`, just like
  a unit test.
- Parameter names after `t` are up to you, but short names like
  `s`, `data`, `n` are common.

A complete fuzz function looks compact:

```go
func FuzzFooBar(f *testing.F) {
    f.Add("seed-1")
    f.Add("seed-2")
    f.Fuzz(func(t *testing.T, s string) {
        // body
    })
}
```

Multiple fuzz functions per file are fine. Some packages have one
fuzz function per public API entry point.

## When to use fuzzing as a junior developer

For most code, the unit tests you already write are enough. Fuzzing
shines on three kinds of code:

1. Parsers — anything that takes bytes and produces a structured value.
2. Encoders — anything that takes a structured value and produces bytes.
3. Format converters — anything that round-trips between representations.

If your code is none of these, fuzzing is probably overkill. A clean
unit-test suite is more useful than a fuzz target on code that has no
external input.

If your code *is* one of these, the cost of adding a fuzz target is
roughly the same as a unit test, and the bug-finding rate is higher.
Add fuzz coverage on the same PR that adds the parser.

## Fuzzing in a small project — a step-by-step checklist

If you are looking at an existing package and asking "should I add
fuzzing here, and how?", here is a checklist.

Step 1 — identify the entry points. List every exported function in
the package that takes `[]byte`, `string`, or a number from a
caller that might be external. These are your fuzz candidates.

Step 2 — pick the highest-risk entry point first. Parsers and
decoders are higher risk than formatters and getters.

Step 3 — write the no-panic target. The simplest property: the
function must not panic on any input.

```go
func FuzzMyParser(f *testing.F) {
    f.Add([]byte("typical-input"))
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = MyParser(data)
    })
}
```

Step 4 — run `go test -fuzz=FuzzMyParser -fuzztime=30s` locally. If
the engine finds panics, fix them one at a time. Commit each fix
along with the saved input.

Step 5 — when no more panics surface, add a stronger property. For
parsers, the most useful one is encoder/decoder symmetry. For pure
functions, idempotence or self-inverse.

Step 6 — repeat steps 3 to 5 for the next entry point.

Step 7 — add `go test ./...` to your existing CI. The committed
`testdata/fuzz/` files now run as regression tests on every PR.

Step 8 — once you have a few fuzz targets, add a nightly job that
runs `go test -fuzz=Fuzz -fuzztime=5m` for each. Findings open a
ticket.

The whole flow, from "no fuzz coverage" to "nightly fuzz with
regression tests", is a day's work for a small package. For a large
package with many entry points, plan a week.

## A first look at coverage data

You can ask Go to write coverage data while fuzzing. Run:

```bash
go test -fuzz=FuzzReverse -fuzztime=10s -coverprofile=cover.out
go tool cover -html=cover.out
```

The HTML view shows which lines of the package under test were
executed during the fuzz run. Lines colored green were hit; lines
colored red were not. Use this to spot "dead" code that the fuzz
engine could not reach — usually because the input format does not
allow it. Add a hand-crafted seed in `testdata/fuzz/FuzzReverse/`
that exercises the dead path, and re-run.

This feedback loop — fuzz, look at coverage, add a seed, fuzz again —
is how you turn a one-day investment in a fuzz target into a
high-coverage test suite over a few weeks.

## Working with the saved corpus

The files in `testdata/fuzz/FuzzXxx/` are first-class artifacts. You
should:

- Commit them. They run as regression tests on every `go test`.
- Review them in PRs. A new file means the fuzz engine found
  something on someone's machine; the PR description should mention
  what was found and how it was fixed.
- Sometimes rename them. The default hash-based names are opaque.
  After investigating a finding, rename the file to something
  meaningful like `regression-issue-1234` or `empty-with-bom`.
- Occasionally clean up duplicates. If two files trigger the same
  bug at the same code site (rare after minimization but possible),
  delete the larger one.

You should not:

- Delete them just because the bug is fixed. The file is the
  regression test that prevents the bug from coming back.
- Edit them by hand to make them "look nicer". The format is
  machine-parsed; whitespace changes break parsing.
- Ignore them in version control. The whole point of
  `testdata/fuzz/` being on disk is to share findings between
  developers.

## A note on flakiness

Native fuzzing is mostly deterministic. The same `-fuzz` run will not
necessarily find the same bug in the same order, because workers
race against each other and the random seed differs per run. But
once a failure is found and saved, replaying it with `go test
-run=FuzzXxx/<hash>` is fully deterministic — single worker, fixed
input, no mutation.

If you see flaky behaviour in replay (the test passes sometimes and
fails sometimes for the same saved input), the bug depends on global
state, time, or scheduling. Fix that first; concurrency-dependent
fuzz tests are a recipe for false confidence.

## Counter-examples: bugs fuzzing did not find

For balance, here are categories of bugs that fuzzing typically
does *not* find in beginner-level use:

**Subtle correctness bugs without an oracle.** If your function
sorts integers and gets the order slightly wrong on equal-key
inputs, fuzz cannot tell unless you assert sort stability against a
reference implementation. The default "does not panic" property
will not catch it.

**Logic bugs that depend on external state.** A fuzz target sees a
single function call. If the bug only manifests after three calls
in a specific order, fuzz will not find it without a stateful
driver inside the target.

**Concurrency bugs across goroutines spawned by the target.** Fuzz
detects panics inside the call. If goroutines spawned by the call
panic asynchronously, the panic may be reported but it is hard to
reproduce.

**Bugs in code unreached by the input format.** If the input never
exercises a branch — say, the parser has a code path for `magic
== 0xFFFFFFFF` and the coverage-guided mutator never reaches that
value — the bug in that branch is invisible to fuzzing.

For these, fall back to property-based tests with custom generators,
integration tests, or hand-crafted seeds that exercise the dark
corners.

## A note on `-race`

The Go race detector composes with fuzzing. Run:

```bash
go test -race -fuzz=FuzzXxx -fuzztime=30s
```

The test binary is built with race instrumentation in addition to
coverage instrumentation. Any data race the target executes is
reported as a failure, with the standard race-detector output
showing the conflicting accesses.

This is particularly useful for code that uses goroutines internally
or that touches shared state. Without `-race`, a data race might
silently produce wrong values for some inputs; the fuzz target
asserting only "no panic" would miss it. With `-race`, the race
detector catches the unsafe access directly.

The cost is exec/s — race instrumentation slows execution by roughly
5-10x. Use `-race` for shorter runs or in nightly CI rather than
during local development iteration.

## Vocabulary recap

A few terms used throughout the Native Fuzzing chapter:

- **Fuzz target** — the inner function passed to `f.Fuzz`. Takes
  `*testing.T` plus mutated inputs.
- **Fuzz function** — the outer `FuzzXxx` function. Sets up seeds
  and calls `f.Fuzz`.
- **Seed corpus** — the inputs registered with `f.Add` and the files
  in `testdata/fuzz/FuzzXxx/`.
- **Generated corpus** — the inputs the engine discovered by
  mutation, stored in `$GOCACHE/fuzz/`.
- **Coverage edge** — a control-flow transition that the
  instrumentation tracks. "New coverage" means an edge no input has
  hit yet.
- **Interesting input** — an input that triggers a new coverage
  edge.
- **Minimization** — the post-failure step where the engine shrinks
  a failing input.
- **Crasher** — a saved minimal failing input, written to
  `testdata/fuzz/FuzzXxx/`.

## Comparing native fuzzing to other testing patterns

A junior developer often has to choose between several testing
techniques. Here is a quick comparison.

**Unit test** — picks a small set of inputs and asserts specific
outputs. Fast to write, easy to read, tells you nothing about
inputs you did not consider.

**Table-driven test** — same as a unit test but with a slice of
input/expected-output rows. Same strengths and weaknesses.

**Property-based test** (via `pgregory.net/rapid`) — generates
inputs from typed generators, asserts a property holds for all of
them. Stronger than unit tests; can find bugs at random. Does not
use coverage feedback.

**Fuzz test** — coverage-guided byte mutation against basic types.
Stronger than property-based for byte-oriented code paths.
Weaker than property-based when the input space requires structure
that random bytes cannot easily produce.

**Integration test** — exercises multiple components together.
Different tool, different goals.

**Benchmark** — measures performance, not correctness. Different
tool.

For most code, you want a mix. Unit tests document specific
behaviours and serve as runnable examples. Fuzz tests cover the
"things I did not think of" axis. Both should coexist in the same
package.

## Common questions

**Does fuzzing replace unit tests?** No. Unit tests test specific
behaviours with named expected outputs. Fuzz tests assert properties
that should hold for many inputs. They complement each other.

**Should every package have fuzz tests?** No. Packages that do not
consume external bytes do not benefit. A package full of business
logic that takes well-typed structs from internal callers does not
need fuzz. The same logic exposed through an HTTP handler that parses
JSON requests does.

**What if my fuzz target finds bugs in third-party code?** File a
bug upstream. Until the fix lands, skip the input in your target so
your nightly fuzz job stays green:

```go
if isKnownDependencyBug(data) {
    t.Skip()
}
```

Better yet, commit the skip with a link to the upstream issue.

**Is fuzzing slow?** A well-written fuzz target runs at 10,000 to
100,000 iterations per second. A 10-second fuzz run is hundreds of
thousands of iterations. That is more coverage than a year of
hand-written unit tests.

**Can I fuzz without writing seeds?** Yes, but the engine starts from
zero coverage and takes longer to find interesting inputs. Seeds let
the engine bootstrap from known-good inputs. Even a single seed
representing a typical valid input speeds exploration enormously.

## Glossary alphabetically

- **`-fuzz` flag** — tells `go test` to enter fuzz mode and pick the
  fuzz target matching the regex argument.
- **`-fuzztime` flag** — wall-clock duration the engine should fuzz.
  Accepts `time.ParseDuration` syntax (`30s`, `1m`, `2h`).
- **`f.Add`** — registers a seed input on `*testing.F`.
- **`f.Fuzz`** — declares the fuzz target; can be called at most
  once per fuzz function.
- **Fuzz function** — the outer `FuzzXxx(f *testing.F)` function.
- **Fuzz target** — the inner function passed to `f.Fuzz`.
- **`testing.F`** — the type passed to fuzz functions. Extends
  `testing.TB`.
- **`testing.T`** — the type passed to the fuzz target's inner
  function and to plain `TestXxx` functions.
- **`testdata/fuzz/FuzzXxx/`** — committed corpus directory. Seeds
  and crashers.
- **`$GOCACHE/fuzz/`** — local discovered corpus, not committed.

## Hands-on practice plan

To consolidate, work through this plan on your own time. Allow about
half a day.

1. Create a new module: `go mod init example.com/fuzzpractice`.
2. Write a function `func DecodeHex(s string) ([]byte, error)` that
   decodes a hex string to bytes. Make it deliberately permissive —
   accept lowercase, uppercase, and mixed case. Refuse odd-length
   input.
3. Write `FuzzDecodeHex` that asserts the function never panics, and
   that decoding a string produced by `hex.EncodeToString` always
   succeeds.
4. Run it for 10 seconds. Look at the output. If it found a bug,
   fix the bug.
5. Add a stronger property: differential against
   `encoding/hex.DecodeString`. Any input that the standard library
   accepts and yours rejects (or vice versa) is a divergence to
   investigate.
6. Run for a minute. Fix any divergences in your implementation.
7. Commit everything including the `testdata/fuzz/` directory.
8. Re-clone the repo and verify `go test ./...` still passes — the
   saved seeds run as table tests.
9. Compute the coverage with `go test -fuzz=FuzzDecodeHex
   -fuzztime=10s -coverprofile=cover.out` and inspect the HTML.
10. Identify any uncovered lines. Add a hand-crafted seed in
    `testdata/fuzz/FuzzDecodeHex/` that exercises them.

You will have written your first real fuzz target, found real bugs,
committed real regression tests, and read real coverage data. That
is the entire workflow in miniature.

## Comparing fuzz output across two runs

Sometimes you make a change to a fuzz target and want to know whether
the change helped. The simplest way is to compare exec/s and total
corpus size between two runs of the same duration.

Run 1, before the change:

```
fuzz: elapsed: 30s, execs: 24001 (800/sec), new interesting: 0 (total: 15)
```

Run 2, after the change:

```
fuzz: elapsed: 30s, execs: 1200456 (40015/sec), new interesting: 12 (total: 27)
```

The exec/s climbed from 800 to 40,000. The corpus grew from 15
entries to 27. The change was a clear improvement.

When exec/s improves dramatically, the previous version was wasting
time on something that did not contribute to exploration. Common
culprits: expensive setup inside the inner function, logging,
unnecessary allocations.

When `new interesting` improves, the change has unlocked new code
paths. Either the input shape is more useful or the target now
exercises a wider slice of the package.

When `total` corpus shrinks rather than growing, the engine has
deduplicated entries the new version considers equivalent. This
usually means the change altered coverage instrumentation (e.g. you
inlined a function and lost a coverage edge). Not necessarily bad.

## Final thought before moving on

The Native Fuzzing chapter is long, but the entry barrier is short.
You can write your first fuzz target in five minutes. You can find
your first bug in another five. The remaining hundreds of lines of
prose are about edge cases, tooling, organizational habits — useful
when you are running fuzzing at scale, but not required for the
basic loop.

If you take away one thing: any function that consumes external
bytes is a candidate for fuzzing, and the cost of adding a target is
five minutes for the no-panic property. The first run finds bugs.
That is the deal. The rest is operational detail.

## When to stop fuzzing

A fuzz run has diminishing returns. The first minute of a typical
target finds the easy bugs. The next hour finds a few more. The
following twelve hours might find one or two. After twenty-four
hours of fuzzing on a target with no findings, the engine is
typically stuck in a local plateau and longer runs do not help much.

The cure for plateaus is more seeds, not more time. Look at the
generated corpus, find input shapes the engine is *not* exploring,
and add seeds in those shapes. Then re-run.

For new fuzz targets, run for several minutes locally. If you find
nothing, commit and let the nightly job take over. The nightly job
explores incrementally across days; cumulative coverage grows even
if any single run is short.

## What we covered

You now know what fuzzing is, why it exists, how to write a fuzz
target with `testing.F`, how to register seeds, how to run it, how to
read a failure report, and how to reproduce a saved input. We worked
through two examples: a string reverse property and a number-parser
differential. That is enough to start adding fuzz coverage to any
package you own.

The Middle and Senior pages dig into mutation strategies, the corpus
management lifecycle, CI integration, and OSS-Fuzz. The Professional
page covers operational habits. Read them when you are ready to ship
fuzzing to production.

## References

- Go 1.18 release notes — fuzzing section, March 2022.
- Tutorial: Getting started with fuzzing — go.dev/doc/tutorial/fuzz.
- testing package godoc — type `F`.
- Proposal: cmd/go: add fuzz testing — golang/go#44551.
