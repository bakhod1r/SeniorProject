---
layout: default
title: Fuzzing — Senior
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/senior/
---

# Fuzzing — Senior

[← Back](../)

The senior view on fuzzing is not "how do I write `f.Fuzz`". You already
know that. The senior view is: how do you run fuzzing as a continuous,
budgeted, deduplicated engineering process across an organization;
how do you design harnesses that actually find bugs instead of bouncing
off the input validator on line 2; and how do you turn the corpus into
a long-term asset rather than a one-off CI artifact.

This page covers the engineering side of fuzzing: the comparison with
`dvyukov/go-fuzz`, OSS-Fuzz and ClusterFuzz integration, differential
fuzzing, structure-aware fuzzing, coverage-guided internals, corpus
minimization, crash deduplication, budget management, integration with
the vulnerability disclosure workflow, fuzz-driven test generation, and
the limitations that push teams to property-based libraries like
`pgregory.net/rapid`.

## 1. Native Go fuzzing vs `dvyukov/go-fuzz`

Go did not have native fuzzing until Go 1.18 (March 2022). Before that,
the de facto fuzzer was Dmitry Vyukov's `github.com/dvyukov/go-fuzz`,
which itself was inspired by AFL and which had been used to find
hundreds of bugs in the standard library, in `image/`, `compress/`,
`encoding/`, `archive/`, in `crypto/x509`, in `go/parser`, and in
countless third-party libraries.

### 1.1 Feature comparison

| Dimension | `dvyukov/go-fuzz` | Native `testing.F` (Go 1.18+) |
|-----------|-------------------|-------------------------------|
| Build | Separate `go-fuzz-build` step that produces a `.zip` instrumented binary | Plain `go test -fuzz=.` |
| Input type | `[]byte` only (you decode yourself) | Typed arguments: `int`, `string`, `[]byte`, `bool`, `float64`, `rune`, etc. |
| Instrumentation | Source-to-source rewrite + custom runtime | Built into the Go runtime/compiler |
| Corpus location | `corpus/`, `crashers/`, `suppressions/` | `testdata/fuzz/<FuzzName>/` |
| Seed encoding | Raw `[]byte` files | Text format with type-tagged lines |
| Concurrency | `-procs=N` | Auto, scales with `GOMAXPROCS` |
| Coverage feedback | sancov-style 8-bit counters per basic block | Same idea, integrated into Go's race-free coverage instrumentation |
| Reproducibility | Re-run on the crasher file | `go test -run=FuzzX/<hash>` re-runs the exact case |
| Integration | External tool | Part of `go test`, same flags, same output |
| OSS-Fuzz support | Yes (the original harness format) | Yes (since 2022) |
| Active development | Frozen, in maintenance | Active |

### 1.2 Why native won

There are five reasons native fuzzing displaced `go-fuzz`:

1. **Zero install.** `go test -fuzz=.` works on a clean machine. No
   separate binary, no `go install`, no version skew between the
   fuzzer and the Go toolchain.
2. **Typed inputs.** Writing `f.Fuzz(func(t *testing.T, s string, n
   int) {...})` removes a whole class of "I forgot to decode the
   length prefix" bugs from the harness itself.
3. **Reproducibility by hash.** A failing fuzz case is saved as
   `testdata/fuzz/FuzzX/abc123...` and re-runs deterministically as a
   regular subtest. The same file is checked into git, reviewed in a
   PR, and runs forever as a regression test.
4. **Toolchain integration.** Coverage, race detector, profiling,
   `-cpu`, `-timeout`, `-tags` — everything that works for `go test`
   works for `go test -fuzz`. There is no "fuzzing mode is a separate
   universe" problem.
5. **Maintenance.** `go-fuzz` carried a custom AST rewriter that broke
   every time the Go compiler changed something internal. Moving the
   instrumentation into the toolchain made it the Go team's
   responsibility, not a single maintainer's.

The cost of the migration was real: every team that had years of
`go-fuzz` corpora had to convert them. The Go team published
`go-fuzz-corpus-converter`-style scripts, and several large projects
(notably `golang/crypto` and `google/syzkaller` adjacent tooling) wrote
their own. The corpus format conversion is mechanical: each raw file
becomes a text file with `[]byte("...")` as the only argument.

### 1.3 What `go-fuzz` still does better

Honesty: a few things `go-fuzz` did well that native fuzzing has not
caught up on as of mid-2026.

- **Sonar / Versifier.** `go-fuzz` had a "sonar" mode that watched for
  byte comparisons against constants and would feed those constants
  back into the mutator. Native fuzzing relies on libFuzzer-style
  compare instrumentation; it works but is less aggressive than
  `go-fuzz` was in some corner cases.
- **Dictionary support.** `go-fuzz` accepted AFL-style dictionaries
  (`-dict=foo.dict`). Native fuzzing has no dictionary flag (as of
  Go 1.22); you have to add the tokens as seeds.
- **Versifier (grammar mode).** `go-fuzz` had an experimental mode that
  generated structured inputs from a grammar. Native fuzzing has
  nothing equivalent; structure-aware fuzzing is hand-rolled (see
  section 6).

For new projects: use native. For projects with a decade of `go-fuzz`
muscle memory: still use native, but mine the old corpus.

## 2. OSS-Fuzz integration

[OSS-Fuzz](https://github.com/google/oss-fuzz) is Google's continuous
fuzzing service for open-source projects. It runs ClusterFuzz on a
large fleet, reports crashes via a private dashboard, files issues
when projects are notified, and discloses them after a 90-day grace
period. As of 2026 it supports Go projects via either the legacy
`go-fuzz` interface or the native `testing.F` interface.

### 2.1 Project layout

To onboard a Go project, you add a directory under
`oss-fuzz/projects/<your-project>/` containing four files:

- `project.yaml` — metadata (language, maintainer emails, primary
  contact, sanitizers).
- `Dockerfile` — clones the source and installs build deps.
- `build.sh` — compiles each fuzz target into a standalone binary that
  ClusterFuzz can run.
- One or more `fuzz_*.go` files (the harnesses), or instructions to
  pick them up from the project's own repo.

A minimal `project.yaml` for a Go project:

```yaml
homepage: "https://github.com/example/parser"
language: go
primary_contact: "security@example.com"
auto_ccs:
  - "alice@example.com"
sanitizers:
  - address
fuzzing_engines:
  - libfuzzer
main_repo: "https://github.com/example/parser"
```

A minimal `build.sh` (this is what OSS-Fuzz invokes inside the
container):

```bash
#!/usr/bin/env bash
set -eux

cd "$SRC/parser"

# compile_native_go_fuzzer is provided by the OSS-Fuzz base image.
# Signature: compile_native_go_fuzzer <package> <FuzzName> <output_name>
compile_native_go_fuzzer ./internal/decoder FuzzDecode fuzz_decode
compile_native_go_fuzzer ./internal/decoder FuzzHeader fuzz_header
compile_native_go_fuzzer ./api FuzzRequest fuzz_request

# Bundle the seed corpus.
zip -j "$OUT/fuzz_decode_seed_corpus.zip" \
  internal/decoder/testdata/fuzz/FuzzDecode/*

# Bundle a dictionary if the project ships one.
cp internal/decoder/testdata/decode.dict "$OUT/fuzz_decode.dict"
```

`compile_native_go_fuzzer` is a shim that adapts a `testing.F`-based
fuzz target into a libFuzzer-compatible binary. Under the hood it
generates a `cmd_*` package containing a `LLVMFuzzerTestOneInput`
function that calls into the Go fuzz harness.

### 2.2 Writing harnesses for OSS-Fuzz

The same `FuzzX(f *testing.F)` function works for `go test -fuzz` and
for OSS-Fuzz. The difference is purely in the build step. A harness
for a parser:

```go
package decoder

import (
    "bytes"
    "testing"
)

func FuzzDecode(f *testing.F) {
    f.Add([]byte("\x00\x00\x00\x01a"))
    f.Add([]byte("\xff\xff\xff\xfftruncated"))

    f.Fuzz(func(t *testing.T, data []byte) {
        // The contract: Decode must not panic on any input, must
        // not read past len(data), must not allocate unboundedly.
        r := bytes.NewReader(data)
        _, _ = Decode(r)
    })
}
```

OSS-Fuzz will run this with libFuzzer under AddressSanitizer (for the
cgo parts) and with the Go race detector for the pure-Go parts. A
panic, a data race, a heap overflow, or a use-after-free all surface
as a "testcase" attached to a private issue.

### 2.3 Corpus sharing across CI runs

The corpus is the most valuable artifact of fuzzing. A 6-month-old
corpus has gone through billions of mutations and covers paths that a
fresh mutator would take days to rediscover. Three locations matter:

1. **The project's `testdata/fuzz/FuzzX/`** — small (10–50 files),
   checked into git, covers regressions, ships with the source.
2. **The CI ephemeral cache** — large (megabytes), grown during the CI
   run, restored at the start of the next CI run from
   GitHub Actions cache / GCS bucket / S3.
3. **The OSS-Fuzz public corpus** — backed by
   `gs://<project>-corpus.clusterfuzz-external.appspot.com/`, freely
   downloadable, hundreds of MB to GB for mature projects.

A common pattern in a GitHub Actions workflow:

```yaml
name: fuzz
on:
  push:
    branches: [main]
  pull_request:

jobs:
  fuzz:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target: [FuzzDecode, FuzzHeader, FuzzRequest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Restore corpus cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/go-fuzz-corpus/${{ matrix.target }}
          key: fuzz-${{ matrix.target }}-${{ github.sha }}
          restore-keys: |
            fuzz-${{ matrix.target }}-

      - name: Sync OSS-Fuzz public corpus (best effort)
        run: |
          gsutil -m rsync \
            gs://parser-corpus.clusterfuzz-external.appspot.com/libFuzzer/parser_${{ matrix.target }}/ \
            ~/.cache/go-fuzz-corpus/${{ matrix.target }}/ || true

      - name: Fuzz for 10 minutes
        run: |
          mkdir -p testdata/fuzz/${{ matrix.target }}
          cp -r ~/.cache/go-fuzz-corpus/${{ matrix.target }}/* \
            testdata/fuzz/${{ matrix.target }}/ 2>/dev/null || true

          go test -run=^$ -fuzz=^${{ matrix.target }}$ \
            -fuzztime=10m \
            -fuzzcachedir=~/.cache/go-fuzz-corpus/${{ matrix.target }} \
            ./...

      - name: Upload new crashers
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: fuzz-crashers-${{ matrix.target }}
          path: testdata/fuzz/${{ matrix.target }}/
```

Notes:

- `-fuzzcachedir` is the key flag. By default Go puts the working
  corpus under `$GOCACHE/fuzz`, which is wiped between runs in CI.
  Pinning it to a stable location lets the cache action persist it.
- `restore-keys` with a prefix means "if there's no exact match,
  restore the most recent corpus we have". This is the trick that
  turns CI from "10 minutes from scratch every time" into "10 minutes
  building on yesterday's coverage".
- The `gsutil rsync || true` step is best-effort: if OSS-Fuzz happens
  to be down, fuzzing still runs.

## 3. ClusterFuzz and ClusterFuzzLite

OSS-Fuzz is the public-facing service. The infrastructure behind it is
[ClusterFuzz](https://github.com/google/clusterfuzz). For private
codebases, two options exist:

1. **Self-hosted ClusterFuzz** — full-fat deployment on GCE, GKE, or
   AWS. Pays off when you have dozens of targets and want a dashboard,
   reproduction, regression range bisection, and so on. Operationally
   expensive: a small SRE team.
2. **[ClusterFuzzLite](https://google.github.io/clusterfuzzlite/)** —
   a CI-native, single-runner replacement. Runs entirely in GitHub
   Actions, GitLab CI, or Google Cloud Build. No infrastructure to
   own. Sized for small-to-medium projects (10–50 targets, hour-long
   nightly runs).

ClusterFuzzLite gives you four modes:

- `code-change` — PR mode. Runs each fuzz target for a short budget
  (default 10 minutes), against the corpus, and only fails if a new
  bug is found.
- `batch` — nightly. Runs each target for hours, mutates against the
  full corpus, uploads new crashers and corpus deltas.
- `coverage` — once a week. Computes and publishes per-target coverage
  reports.
- `prune` — periodically. Minimizes the corpus by removing
  inputs whose coverage is dominated by other inputs.

A minimal `.clusterfuzzlite/Dockerfile`:

```Dockerfile
FROM gcr.io/oss-fuzz-base/base-builder-go
COPY . $SRC/parser
WORKDIR $SRC/parser
COPY .clusterfuzzlite/build.sh $SRC/
```

And `.clusterfuzzlite/build.sh`:

```bash
#!/usr/bin/env bash
set -eux

cd "$SRC/parser"
compile_native_go_fuzzer ./internal/decoder FuzzDecode fuzz_decode
compile_native_go_fuzzer ./internal/decoder FuzzHeader fuzz_header
```

The PR workflow then runs:

```yaml
name: cflite-pr
on:
  pull_request:
    paths-ignore: ['**.md']

permissions:
  contents: read
  security-events: write

jobs:
  pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Build fuzzers
        uses: google/clusterfuzzlite/actions/build_fuzzers@v1
        with:
          language: go
          sanitizer: address
      - name: Run fuzzers
        uses: google/clusterfuzzlite/actions/run_fuzzers@v1
        with:
          language: go
          fuzz-seconds: 600
          mode: 'code-change'
          sanitizer: address
```

ClusterFuzzLite's batch run is identical except `mode: 'batch'` and a
longer `fuzz-seconds`. The big advantage over hand-rolling: it tracks
the corpus state in a separate branch (`cflite-storage`) inside the
same repo, so you don't need an external bucket.

## 4. Designing harnesses for parsers, codecs, and security-critical code

A harness can be the difference between "this fuzz target found a 0day
in week one" and "this fuzz target ran for a month and found nothing
because everything panics on the first byte being invalid".

### 4.1 Parsers and codecs

A parser harness should:

- Accept the raw input as a single `[]byte`. Do not split it into
  fields; the mutator is better at carving than you are.
- Avoid `t.Fatal` for "this is invalid input"; that's an _expected_
  outcome, not a fuzzing failure. Only `t.Fatal` for invariant
  violations.
- Check round-trip invariants where the format permits.
- Bound CPU/allocation so a pathological input doesn't hang the
  fuzzer (it'll be flagged as a hang by ClusterFuzz, but you waste
  hours).

```go
package httpparse

import (
    "bytes"
    "reflect"
    "testing"
)

func FuzzRequest(f *testing.F) {
    f.Add([]byte("GET / HTTP/1.1\r\nHost: x\r\n\r\n"))
    f.Add([]byte("POST /a HTTP/1.0\r\nContent-Length: 0\r\n\r\n"))

    f.Fuzz(func(t *testing.T, raw []byte) {
        req, err := Parse(raw)
        if err != nil {
            // Invalid input is acceptable. Just make sure we did not
            // return a half-built request along with an error.
            if req != nil {
                t.Fatalf("non-nil request with error: %v", err)
            }
            return
        }

        // Invariant: a successfully parsed request, re-serialized,
        // must parse back to an equal request.
        var buf bytes.Buffer
        if err := req.Write(&buf); err != nil {
            t.Fatalf("Write returned error on parsed request: %v", err)
        }
        req2, err := Parse(buf.Bytes())
        if err != nil {
            t.Fatalf("re-parse failed: %v\noriginal: %q\nrebuilt: %q",
                err, raw, buf.Bytes())
        }
        if !reflect.DeepEqual(req, req2) {
            t.Fatalf("round-trip mismatch\norig: %+v\nrebuilt: %+v",
                req, req2)
        }
    })
}
```

The round-trip pattern (`Parse → Serialize → Parse`) catches a huge
class of bugs that a panic-detector cannot:

- Off-by-one in length fields.
- Loss of fields during serialization.
- Order-dependent behavior that should be order-independent.
- Canonicalization bugs where two distinct inputs decode to the same
  intermediate but re-serialize differently.

### 4.2 Security-critical code

For code where the threat model is "untrusted input over the
network", the harness should also exercise abuse cases:

```go
package crypto

import (
    "crypto/subtle"
    "testing"
)

func FuzzConstantTimeCompare(f *testing.F) {
    // Property: result depends only on equality, never on contents.
    // We can't measure timing in a fuzz harness, but we can fuzz the
    // *behavior* and assert it matches a known-correct reference.
    f.Add([]byte("hello"), []byte("hello"))
    f.Add([]byte("hello"), []byte("world"))
    f.Add([]byte(""), []byte(""))

    f.Fuzz(func(t *testing.T, a, b []byte) {
        ourResult := subtle.ConstantTimeCompare(a, b)
        wantEqual := 0
        if len(a) == len(b) && string(a) == string(b) {
            wantEqual = 1
        }
        if ourResult != wantEqual {
            t.Fatalf("ConstantTimeCompare(%q, %q) = %d, want %d",
                a, b, ourResult, wantEqual)
        }
    })
}
```

For TLS, X.509, JWT, JOSE, and similar code, the typical harness is:

1. Take a `[]byte` representing a malicious blob.
2. Pass it to the parser/verifier.
3. Assert: no panic, no goroutine leak, bounded memory, and (if the
   blob decodes) the decoded value satisfies whatever invariants the
   API claims.
4. For verifiers, additionally assert: any successful verification
   must imply the cryptographic check held. Construct a known-good
   blob in `f.Add`, mutate, and assert "if Verify says ok, then the
   signature on the mutated blob is genuine over the mutated body".

## 5. Differential fuzzing

Differential fuzzing compares two implementations of the same function
on the same input. If they disagree, at least one is wrong. It is the
single most effective technique for finding bugs in production
parsers, because you get a built-in oracle.

Classic targets for Go:

- `encoding/json` against `github.com/json-iterator/go` or
  `github.com/goccy/go-json`.
- A new TLS implementation against `crypto/tls`.
- A protobuf parser against `google.golang.org/protobuf`.
- A Markdown renderer against `github.com/yuin/goldmark`.
- Internal serializer V2 against V1.

The harness:

```go
package mylib

import (
    "encoding/json"
    "reflect"
    "testing"

    jsoniter "github.com/json-iterator/go"
)

func FuzzJSONUnmarshalCompat(f *testing.F) {
    f.Add([]byte(`{}`))
    f.Add([]byte(`{"a":1,"b":[true,null,"x"]}`))
    f.Add([]byte(`[1,2,3]`))
    f.Add([]byte(`123.456e-7`))

    f.Fuzz(func(t *testing.T, data []byte) {
        var stdVal interface{}
        stdErr := json.Unmarshal(data, &stdVal)

        var jiVal interface{}
        jiErr := jsoniter.ConfigCompatibleWithStandardLibrary.
            Unmarshal(data, &jiVal)

        switch {
        case stdErr == nil && jiErr != nil:
            t.Fatalf("stdlib accepted, jsoniter rejected: %v\ninput: %q",
                jiErr, data)
        case stdErr != nil && jiErr == nil:
            t.Fatalf("jsoniter accepted, stdlib rejected: %v\ninput: %q",
                stdErr, data)
        case stdErr == nil && jiErr == nil:
            if !reflect.DeepEqual(stdVal, jiVal) {
                t.Fatalf("value mismatch\nstdlib:   %#v\njsoniter: %#v\ninput: %q",
                    stdVal, jiVal, data)
            }
        }
        // Both errored: that's fine, they agree the input is bad.
    })
}
```

The pitfall here is "specified differences": sometimes the
implementations are _supposed_ to disagree. For example, jsoniter for
years had different number-precision semantics than the stdlib. You
need a whitelist of known divergences:

```go
func isKnownDivergence(data []byte, std, ji interface{}) bool {
    // Number parsing for very large floats: stdlib uses float64,
    // jsoniter sometimes returns json.Number.
    if _, ok := std.(float64); ok {
        if _, ok := ji.(json.Number); ok {
            return true
        }
    }
    return false
}
```

This whitelist tends to shrink over time as bugs are fixed, and it
should never silently grow without a comment explaining each entry.

### 5.1 Other differential pairings

- **Native vs reference implementation.** If you're shipping a new
  Go-native AES-GCM, diff against `crypto/cipher`. If you're shipping
  a hand-tuned base64, diff against `encoding/base64`.
- **Server vs client of the same protocol.** A WebSocket frame parsed
  by your server, then re-encoded by your client library, must
  round-trip. Two independent codebases for the same wire format
  become each other's oracle.
- **Two versions of the same library.** "v2 must accept everything v1
  accepted and produce the same output, except for these documented
  differences." This is gold for migration testing.

## 6. Structure-aware fuzzing

Native Go fuzzing accepts a fixed set of input types
(`bool`, `byte`, `rune`, `string`, `[]byte`, the integer types,
and the float types). That's it. No structs, no slices of structs,
no maps. Compare to libFuzzer with FuzzedDataProvider, or to Rust's
`arbitrary` crate, or to `rapid`'s generators.

Senior trick: build your own decoder from `[]byte` to a rich
structure. The mutator only sees bytes, but the input it feeds your
production code is a fully-typed value.

```go
package broker

import (
    "encoding/binary"
    "testing"
)

type Op struct {
    Kind    uint8  // 0=Publish, 1=Subscribe, 2=Unsubscribe, 3=Ack
    Topic   string
    Payload []byte
    QoS     uint8
}

// drain decodes a sequence of operations from the fuzz input.
// On short reads it returns whatever it managed to decode.
func drain(data []byte) []Op {
    var ops []Op
    for len(data) > 0 && len(ops) < 64 {
        // Each op: 1 byte kind, 2 byte topic length, topic,
        // 4 byte payload length, payload, 1 byte qos.
        if len(data) < 1 {
            return ops
        }
        op := Op{Kind: data[0] % 4}
        data = data[1:]

        if len(data) < 2 {
            return ops
        }
        tl := int(binary.BigEndian.Uint16(data[:2]))
        data = data[2:]
        if tl > len(data) {
            tl = len(data)
        }
        op.Topic = string(data[:tl])
        data = data[tl:]

        if len(data) < 4 {
            return ops
        }
        pl := int(binary.BigEndian.Uint32(data[:4]))
        data = data[4:]
        if pl > len(data) {
            pl = len(data)
        }
        op.Payload = append([]byte(nil), data[:pl]...)
        data = data[pl:]

        if len(data) < 1 {
            op.QoS = 0
        } else {
            op.QoS = data[0] % 3
            data = data[1:]
        }

        ops = append(ops, op)
    }
    return ops
}

func FuzzBrokerOps(f *testing.F) {
    f.Add([]byte{0, 0, 1, 'a', 0, 0, 0, 0, 0})
    f.Add([]byte{1, 0, 1, 'b', 0, 0, 0, 2, 'h', 'i', 1})

    f.Fuzz(func(t *testing.T, data []byte) {
        ops := drain(data)
        b := NewBroker()
        for _, op := range ops {
            switch op.Kind {
            case 0:
                b.Publish(op.Topic, op.Payload, op.QoS)
            case 1:
                b.Subscribe(op.Topic, op.QoS)
            case 2:
                b.Unsubscribe(op.Topic)
            case 3:
                b.Ack(op.Topic)
            }
        }
        // Invariant: after a clean shutdown there are no goroutines
        // left subscribed, no unsent messages in any retry queue.
        b.Close()
        if g := b.SubscriberCount(); g != 0 {
            t.Fatalf("leaked subscribers: %d", g)
        }
    })
}
```

This pattern (one input `[]byte`, custom decoder, sequence of typed
operations, invariant check) is how you fuzz state machines, message
brokers, distributed protocols, and database engines in Go's
native fuzzer. It compensates for the lack of `arbitrary`-style
support.

### 6.1 Why not just use multiple typed args?

You could write:

```go
f.Fuzz(func(t *testing.T, kind uint8, topic string, payload []byte, qos uint8) {
    ...
})
```

Two reasons not to:

1. **One op per call.** You can only exercise one operation per fuzz
   call, so you cannot find bugs that depend on a sequence of
   operations.
2. **Mutator is less effective.** The native mutator treats each
   typed argument independently. A single `[]byte` lets it carve and
   splice freely, which finds more interesting interleavings.

### 6.2 The "skip the encoded length" anti-pattern

A common mistake: writing a decoder that bails out on the first
short read. This makes the mutator's job hard because every byte
flip near a length field causes the whole input to be rejected.
The `drain` example above _gracefully truncates_ instead of bailing,
so most random byte sequences still produce a non-empty `ops` slice.
That property — "any input produces a meaningful structure" — is
what makes structure-aware fuzzing actually find bugs.

## 7. Coverage-guided fuzzing internals

Coverage-guided fuzzing (CGF) is the family of techniques that turns
"random input generation" into "random input generation that
preferentially explores new code paths". The two pillars are AFL/AFL++
and libFuzzer; Go's native fuzzer is closer to libFuzzer in design.

### 7.1 The coverage map

Every fuzzer maintains a fixed-size table (the "coverage map" or
"trace map"). Each entry corresponds to an edge in the control-flow
graph of the program — that is, a transition from one basic block to
another. The instrumentation, inserted at compile time, increments
the counter for each edge as the program runs.

In libFuzzer style this is implemented via SanitizerCoverage:

```c
// Roughly equivalent to what each instrumented edge does.
extern uint8_t __sancov_cmp_counters[MAP_SIZE];

__sancov_cmp_counters[edge_id]++;
```

A new input is "interesting" if it hits a counter value (specifically,
a counter bucket — 1, 2, 3, 4–7, 8–15, etc.) that no previous input
hit. The fuzzer saves interesting inputs to the corpus and uses them
as starting points for further mutation.

### 7.2 Go's instrumentation

Go's fuzzer reuses the existing coverage instrumentation introduced
for `go test -cover`, but in counter mode rather than boolean mode.
The compiler inserts a counter increment at the entry to each basic
block. The runtime collects the counters per goroutine and merges
them at the end of each fuzz call.

The relevant runtime entry points (you don't usually need to call
them directly) are in `runtime/coverage`:

- `runtime/coverage.WriteCounters` — dump current counter state.
- `runtime/coverage.ClearCounters` — reset between fuzz runs.

The fuzz loop in `cmd/go/internal/test/fuzz.go` (the relevant logic
is in `internal/fuzz/worker.go` and `internal/fuzz/encoding.go`)
looks roughly like:

```
for {
    input = mutate(corpus)
    clearCounters()
    runHarness(input)
    counters = readCounters()
    if hasNewBucket(counters, seenBuckets) {
        corpus = append(corpus, input)
        seenBuckets = union(seenBuckets, bucketsOf(counters))
        writeCorpusEntry(input)
    }
    if crashed {
        writeCrasher(input)
        minimize(input)
    }
}
```

### 7.3 Compare instrumentation ("compcov")

Beyond edges, modern fuzzers instrument comparisons. When the program
does `if x == 0x12345678`, the instrumentation records both operands;
the mutator then knows to try inputs containing `0x12345678` near the
relevant position. This is how libFuzzer solves "magic constant"
checks that would otherwise take 2^32 attempts.

Go's fuzzer has this for the basic comparison patterns it can detect,
but it is less aggressive than libFuzzer's `-use_value_profile=1`.
For Go projects fuzzed via OSS-Fuzz, the compcov passes happen at the
LLVM IR level on the cgo parts only — pure-Go basic blocks rely on
the Go compiler's instrumentation.

### 7.4 Why this matters operationally

Two practical consequences:

1. **The size of your binary affects fuzz speed.** Each fuzz call has
   to touch the coverage map. Bigger map → more cache misses →
   slower fuzzing. Targets that link in `net/http` and `crypto/tls`
   for no reason will be 2-5x slower than targets that link in only
   the parser.
2. **Code that never runs is invisible.** Fuzzing only finds bugs in
   code that the harness can reach. A handler buried behind a 12-step
   authentication flow will get no fuzz attention unless your harness
   sets up the precondition state.

## 8. Corpus minimization

Two kinds of minimization happen, and they should not be confused.

### 8.1 Input minimization (per-crash)

When the fuzzer finds a crash, it tries to shrink the input while
keeping it crashing. This is what `-fuzzminimizetime=<duration>`
controls.

```
go test -fuzz=FuzzDecode -fuzztime=1m -fuzzminimizetime=30s
```

The default is to spend 60 seconds minimizing each crash. For deep
crashes (large inputs with structural requirements) you may want
more; for trivial crashes 5-10 seconds is enough. The minimized
crasher is what ends up in `testdata/fuzz/FuzzX/`, so the time you
spend here directly affects the readability of the regression test.

A minimized crasher should ideally:

- Be under 100 bytes for byte-oriented parsers.
- Have all "obviously irrelevant" trailing bytes removed.
- Have any random-looking byte replaced with a printable equivalent
  if the parser doesn't care.

The native minimizer does the first two automatically; the third is
beyond its capabilities.

### 8.2 Corpus minimization (whole corpus)

Distinct from per-crash minimization: corpus minimization removes
inputs from the corpus whose coverage is fully contained in the union
of other inputs' coverage. A corpus that started at 50 MB after a
year of fuzzing might minimize to 5 MB without losing any coverage.

Go's fuzzer does this implicitly: when you re-run with
`-fuzzcachedir=...`, it re-evaluates coverage from scratch. But there
is no `go fuzz minimize` command. The workaround in practice:

1. Run with a long `-fuzztime` against the existing corpus.
2. After the run, sort inputs by file size ascending; for each input,
   try removing it and re-running coverage. If coverage is
   unaffected, drop it. This is what `clusterfuzz` and `libFuzzer`'s
   `-merge=1` do.

A pragmatic Go-side script:

```go
//go:build ignore

package main

import (
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "sort"
)

// Naive corpus pruner. For each file, try removing it. If the fuzz
// test still passes with the same coverage, leave it removed.
func main() {
    dir := os.Args[1] // e.g. testdata/fuzz/FuzzDecode
    entries, err := os.ReadDir(dir)
    if err != nil {
        panic(err)
    }
    type entry struct {
        name string
        size int64
    }
    var files []entry
    for _, e := range entries {
        info, _ := e.Info()
        files = append(files, entry{e.Name(), info.Size()})
    }
    sort.Slice(files, func(i, j int) bool {
        return files[i].size > files[j].size // try big files first
    })

    for _, f := range files {
        p := filepath.Join(dir, f.name)
        backup, _ := os.ReadFile(p)
        os.Remove(p)

        cmd := exec.Command("go", "test", "-run=FuzzDecode/",
            "-count=1", "./...")
        if err := cmd.Run(); err != nil {
            // Removing this file broke the regression suite.
            os.WriteFile(p, backup, 0644)
            fmt.Printf("kept %s\n", f.name)
        } else {
            fmt.Printf("dropped %s\n", f.name)
        }
    }
}
```

This is a quick-and-dirty pruner; for real work, lean on ClusterFuzz's
`corpus_pruning` task or libFuzzer's `-merge=1`.

## 9. Crash deduplication

Run a fuzzer for a day on a buggy parser and you'll get 500 crashes.
Five of them are real; 495 are the same bug hit from slightly
different inputs. Without dedup, your security team will hate you.

### 9.1 Stack-trace-based dedup

The simplest, most effective heuristic: hash the top N frames of the
panic stack, ignoring the bottom (runtime/test machinery) and ignoring
the inputs (filenames may be the same, but line numbers tell the
story).

```go
package fuzzutil

import (
    "crypto/sha256"
    "encoding/hex"
    "regexp"
    "runtime/debug"
    "strings"
)

var frameLine = regexp.MustCompile(`^(\S+)\s+(\S+):(\d+)`)

// CrashID returns a short, stable identifier derived from the
// current panic stack. Call from a deferred recover in your harness
// if you want to dedup before reporting.
func CrashID(depth int) string {
    raw := string(debug.Stack())
    lines := strings.Split(raw, "\n")
    var frames []string
    for _, l := range lines {
        l = strings.TrimSpace(l)
        m := frameLine.FindStringSubmatch(l)
        if m == nil {
            continue
        }
        fn, file := m[1], m[2]
        // Skip framework frames.
        if strings.HasPrefix(fn, "runtime.") ||
            strings.HasPrefix(fn, "testing.") ||
            strings.Contains(file, "internal/fuzz") {
            continue
        }
        frames = append(frames, fn+"@"+file)
        if len(frames) >= depth {
            break
        }
    }
    h := sha256.Sum256([]byte(strings.Join(frames, "|")))
    return hex.EncodeToString(h[:6])
}
```

You don't usually integrate this into the fuzz target directly (the
fuzzer's own minimization handles per-target dedup), but for an
internal triage tool that pulls crashers from S3 and groups them, it
is invaluable.

### 9.2 Input-distance dedup

A second-tier heuristic: cluster inputs by Levenshtein or normalized-
compression distance. Useful when stack traces are identical (the
same buggy line of code is reached) but the trigger pattern varies.
ClusterFuzz applies this on top of stack dedup.

### 9.3 What to file as a bug

A reasonable policy: for each unique stack hash, file one bug, with
the smallest minimized input as the primary repro. Link the other
inputs in the bug as "alternate triggers". This keeps the bug tracker
sane and lets engineers prioritize by impact rather than by raw
count.

## 10. Budget management

Fuzzing is unbounded. You can always run it longer. The senior
question is: how much compute should each fuzz target get?

### 10.1 The two-tier model

The canonical model: fast feedback per commit, slow background sweep.

**Per-commit (10 minutes total budget).** Runs in CI on every PR.
Goals:
- Re-run all existing corpus entries (regression).
- Spend any remaining time on new mutation, with the existing corpus
  as seeds.
- Fail the build only on _new_ crashers, not on inherited ones.

For a project with 10 fuzz targets and a 10-minute budget, that's
60 seconds per target. Plenty for regression; minimal for new
discovery. Make it shorter and you skip targets; make it longer and
your PR CI becomes painful.

**Nightly (hours).** Runs on `main`. Goals:
- Spend serious time on new discovery.
- Update the corpus.
- File issues for new crashers (don't fail CI on `main`).

A common allocation: 30 minutes per target overnight. For 10 targets,
that's a 5-hour job. ClusterFuzz/CFLite can parallelize this across
runners if budget allows.

### 10.2 Adaptive budgeting

A smarter scheme: weight each target by recent activity.

- Targets that found a new crasher in the last week get 2x budget.
- Targets that touched changed files in the PR get 4x budget.
- Targets that haven't found anything in 90 days get 0.5x budget.

Implementation is a small wrapper around `go test -fuzz=...`. The
hard part is socializing the rule: engineers need to know why some
fuzz targets get more attention than others.

### 10.3 Tracking the metric

Measure these:

- **Coverage delta per hour.** New basic blocks reached per hour
  of fuzzing. Plateauing means either the corpus is saturated or
  the harness is stuck.
- **Crashes per million execs.** A meaningful indicator of how buggy
  the target code is.
- **Mean time to minimal reproducer.** From first crash to minimized
  input. Long times usually mean the minimizer needs more budget.
- **Corpus growth.** New entries added per day. Going to zero means
  the fuzzer has stopped learning.

Most of these are emitted by Go's fuzzer as log lines:

```
fuzz: elapsed: 1m0s, execs: 481243 (8021/sec), new interesting: 41 (total: 583)
```

Extract them with a CI parser and chart them; the chart becomes your
fuzzing health dashboard.

## 11. Integration with vuln-disclosure workflow

When a fuzz target finds a security-relevant bug, you need a process,
not panic. The pieces:

1. **Pre-disclosure quarantine.** The crasher file goes to a
   private location (private GitHub repo, S3 bucket with restricted
   IAM, internal artifact storage). It does _not_ go into the public
   `testdata/fuzz/` directory until after the fix ships.
2. **Issue tracker entry.** A private issue (GitHub Security Advisory,
   or equivalent) is filed with: minimized input, stack trace, impact
   assessment, suggested CVE severity.
3. **Fix branch.** A non-public fix branch lands. The regression test
   uses a sanitized version of the crasher (often: the panic-on-input
   case is fine to publish; data-exfiltration cases need careful
   redaction).
4. **Coordinated release.** The fix lands publicly, the security
   advisory is published, the CVE is requested via the GitHub
   advisory pipeline or directly via MITRE.
5. **Corpus publication.** After release, the (sanitized) crasher
   is moved into `testdata/fuzz/` so the regression test ships in
   future versions.

A subtle point: don't commit the crasher to the public repo
_before_ the fix ships. Anyone watching commits can run the
regression test and reproduce the bug. This means your normal
"commit regression test alongside fix" reflex needs to be modulated
when the underlying bug is security-relevant.

### 11.1 Go's `govulncheck` integration

The Go team maintains the `golang.org/x/vuln` database and the
`govulncheck` tool. When a Go fuzz target finds a stdlib bug, the
disclosure flow goes through:

- `security@golang.org` (private).
- Coordinated patch in `go-internal`.
- `GO-YYYY-NNNN` advisory in `pkg.go.dev/vuln`.
- Release of patched Go (point release).
- `govulncheck` users then get notified on their next scan.

For your own project, the equivalent is:

- File the advisory in your repo's Security tab.
- Use `github.com/sigstore/cosign` or the OSV format to publish a
  machine-readable advisory.
- Mirror to OSV.dev for downstream tooling consumption.

## 12. Fuzz-driven test generation

The corpus is not just for fuzzing. Interesting inputs found during
fuzzing make excellent table-test cases — they cover edge cases that
no human would have invented. The senior workflow:

1. Periodically (monthly), review new corpus entries.
2. For each, decide: is this a meaningful semantic case?
3. If yes, write a small unit test that asserts the expected output
   for that input, and reference the corpus file.

A scripted approach: write a generator that emits a `table_test.go`
from a curated subset of the corpus.

```go
//go:build ignore

// Generates curated_test.go from a hand-picked list of corpus entries.
package main

import (
    "fmt"
    "io"
    "os"
    "path/filepath"
    "strings"
    "text/template"
)

type Case struct {
    Name   string
    Input  string // []byte literal
    Expect string // human-written expected output
}

func main() {
    var cases []Case
    for _, arg := range os.Args[1:] {
        data, err := os.ReadFile(arg)
        if err != nil {
            panic(err)
        }
        // Strip the testdata/fuzz/ header (the typed-arg format).
        // For []byte-only harnesses this is two lines we skip.
        text := string(data)
        lines := strings.SplitN(text, "\n", 3)
        if len(lines) < 3 {
            continue
        }
        body := strings.TrimPrefix(lines[1], "[]byte(")
        body = strings.TrimSuffix(strings.TrimSpace(body), ")")
        cases = append(cases, Case{
            Name:   filepath.Base(arg),
            Input:  body,
            Expect: "TODO",
        })
    }

    tmpl := template.Must(template.New("t").Parse(`// Code generated. EDIT to fill in Expect, then keep maintained.
package decoder

import "testing"

func TestCuratedFromFuzz(t *testing.T) {
    cases := []struct {
        name   string
        input  []byte
        expect string
    }{
{{- range .}}
        {"{{.Name}}", []byte({{.Input}}), "{{.Expect}}"},
{{- end}}
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            got, err := Decode(c.input)
            if err != nil {
                t.Fatalf("Decode error: %v", err)
            }
            if got != c.expect {
                t.Fatalf("Decode = %q, want %q", got, c.expect)
            }
        })
    }
}
`))
    tmpl.Execute(io.Writer(os.Stdout), cases)
}
```

The point is not to be clever about the generator; the point is to
treat the corpus as a curated test data source rather than a
write-only graveyard.

## 13. Fuzz vs property-based testing (rapid)

Go has two main testing-with-randomness libraries:

- The built-in `testing.F` (coverage-guided, byte-oriented, mutator-
  based).
- `pgregory.net/rapid` (generator-based, type-aware, shrinks via
  algebraic rules, no coverage feedback).

### 13.1 When fuzz wins

- **Untrusted-input boundaries.** Network protocols, file formats,
  user-supplied serialized blobs. The mutator's ability to find magic
  byte sequences is hard to replicate with hand-written generators.
- **Persistent corpora.** Multi-month, multi-CPU-year fuzz runs build
  up tens of thousands of inputs that no `Generator` would produce.
- **Coverage as a goal.** When you literally want "find every code
  path", CGF is the technique that does it.
- **Tooling.** ClusterFuzz, OSS-Fuzz, GoOSS-Fuzz integration. Property
  tests run inside `go test`; they don't have a continuous
  infrastructure story.

### 13.2 When rapid wins

- **Rich domain types.** Generating valid graphs, valid SQL ASTs,
  valid HTTP requests with semantic constraints — rapid's
  `gen.Custom` and combinators are vastly more productive than
  hand-writing a `[]byte` decoder.
- **Algebraic invariants.** When the test is "for all `a`, `b`:
  `f(a, b) == f(b, a)`", you write that exact sentence in rapid.
  In fuzz you'd write a decoder, two function calls, and an
  assertion.
- **State machine testing.** Rapid has a built-in state-machine
  testing facility (`rapid.Run`) that drives commands against a
  model and an implementation, comparing outputs. Native fuzz has
  nothing built in for this — you write the `drain`/op-sequence
  trick from section 6.
- **Determinism for CI.** Rapid uses a fixed seed by default; the
  same `t` produces the same test cases. Fuzz is intentionally
  non-deterministic (the mutator keeps state across calls).
- **Shrinking expressiveness.** Rapid's shrinker understands the
  generator algebra and produces dramatically smaller reproducers
  for complex inputs. The fuzz minimizer is byte-level and cannot
  shrink across logical structure.

### 13.3 Combining them

A common pattern:

- A `Fuzz*` target per parser/codec, running in CI and OSS-Fuzz.
- A `TestState*` test per state machine, using rapid, running
  in `go test`.
- The fuzzer occasionally feeds the rapid suite: when a fuzz
  finding turns out to be a high-level semantic bug, write a
  rapid test that captures the property.

A skeleton showing a rapid state-machine test:

```go
package broker_test

import (
    "testing"

    "pgregory.net/rapid"

    "example.com/broker"
)

type brokerMachine struct {
    b     *broker.Broker
    model map[string][][]byte // topic -> messages
}

func (m *brokerMachine) Init(t *rapid.T) {
    m.b = broker.NewBroker()
    m.model = make(map[string][][]byte)
}

func (m *brokerMachine) Publish(t *rapid.T) {
    topic := rapid.StringMatching(`[a-z]{1,4}`).Draw(t, "topic")
    body := rapid.SliceOf(rapid.Byte()).Draw(t, "body")
    m.b.Publish(topic, body, 0)
    m.model[topic] = append(m.model[topic], body)
}

func (m *brokerMachine) Drain(t *rapid.T) {
    topic := rapid.StringMatching(`[a-z]{1,4}`).Draw(t, "topic")
    got := m.b.Drain(topic)
    want := m.model[topic]
    m.model[topic] = nil
    if len(got) != len(want) {
        t.Fatalf("Drain(%q) returned %d, model says %d",
            topic, len(got), len(want))
    }
}

func (m *brokerMachine) Check(t *rapid.T) {
    // Invariants checked after every command.
    for topic, msgs := range m.model {
        if len(msgs) > 0 && !m.b.HasMessages(topic) {
            t.Fatalf("model says topic %q has %d messages but broker is empty",
                topic, len(msgs))
        }
    }
}

func TestBrokerStateMachine(t *testing.T) {
    rapid.Check(t, rapid.Run[*brokerMachine]())
}
```

The fuzzer might find that `Publish("",...)` panics. The rapid suite
would find that "after `Publish(a, x); Publish(a, y); Drain(a)`, you
get `[x, y]`, not `[y, x]`". Both are real bug classes; both
techniques are necessary.

## 14. Reading the fuzz CL history

Two design documents and several CLs shaped native Go fuzzing.
Reading them is the fastest way to understand why the API looks the
way it does.

### 14.1 [golang/go#44551 — "proposal: testing: support fuzzing"](https://github.com/golang/go/issues/44551)

The accepted proposal from 2021. Key design decisions:

- **Fuzzing belongs in `testing`.** Not a separate package. Same
  flags, same machinery. This is what made `f.Fuzz` look like a
  natural extension of `t.Run`.
- **Typed arguments.** A direct response to `go-fuzz`'s `[]byte`-only
  API. The proposal author (Katie Hockman) argued that the
  ergonomic win outweighed the loss of mutator flexibility for
  trivial cases.
- **Corpus on disk.** Inputs in `testdata/fuzz/`, one file per input,
  text format. Designed for human review, code review, and version
  control. The format includes the type signature, which is what
  enables typed-argument fuzzing without per-target encoding.
- **`testing.F`.** A new helper type distinct from `*testing.T`
  because the fuzz target receives both an `*F` (at registration)
  and a `*T` (per call), and conflating them would have been
  confusing.

### 14.2 [golang/go#43830 — "proposal: testing: add corpus management"](https://github.com/golang/go/issues/43830)

Earlier proposal that fed into the design. Discusses how seed corpus
versus generated corpus should be handled, and lands on the
two-location model: `testdata/fuzz/` (committed, seed + regression)
versus `$GOCACHE/fuzz/` (ephemeral, working state).

### 14.3 Design rationale highlights

- **No grammar mode.** Discussed and deferred. Grammars are hard to
  serialize stably; the team chose to ship without them. Structure-
  aware fuzzing is left to user code (the `drain` pattern in
  section 6).
- **No dictionary flag.** Discussed and deferred. The argument: just
  add the tokens to `f.Add` as seeds. In practice this is less
  effective for unbiased mutators than a true dictionary, and it is
  one of the items most users still wish were natively supported.
- **No CGI-style binary output.** OSS-Fuzz needs to shell out to
  fuzz binaries; the team built `compile_native_go_fuzzer` as a
  separate tool rather than baking it into `go test`. The rationale:
  keep `go test` clean; let OSS-Fuzz integration evolve at its own
  pace.
- **Coverage instrumentation reuse.** A non-obvious win. Reusing the
  same instrumentation that powers `go test -cover` meant the
  feature shipped in 1.18 instead of 1.20.

Reading these issues gives you the "why this not that" mental model
that no tutorial provides. When you eventually want to file an
enhancement issue ("native dictionary support please"), you need to
have engaged with the existing discussion or your proposal lands
flat.

## 15. Limitations and what to do about them

Native Go fuzzing is good enough for production use, but it has real
limits. Each limit has a workaround.

### 15.1 Only basic types as inputs

**Limit.** `f.Fuzz` accepts only a fixed set of primitive types. No
structs, slices of structs, maps, channels, interfaces.

**Workaround.** The `drain` pattern from section 6. One `[]byte`
argument, custom decoder, rich typed structure inside the harness.

### 15.2 No built-in shrinking across structure

**Limit.** The minimizer is byte-level. It cannot remove the third
op from a sequence of seven and keep the rest valid; it can only
chop bytes off the end and try byte deletions.

**Workaround.** Either write a post-fuzz shrinker that understands
your op encoding, or accept that minimal reproducers will not be as
clean as `rapid`'s. For the rare case where structural shrinking
matters, run the failing input through a hand-rolled shrinker before
committing the regression test.

### 15.3 No determinism across runs

**Limit.** Fuzz runs are non-deterministic by design (the mutator's
state evolves). You cannot say "this PR added a crash, but only in
the second run, not the third" with confidence.

**Workaround.** Always commit the failing input as a regression
test. The next CI run will then deterministically run it and
deterministically catch any future regression.

### 15.4 No first-class concurrency fuzzing

**Limit.** The harness runs serially. To find race conditions you
have to spawn goroutines manually inside the `Fuzz` callback, and
even then the race detector only catches actual races, not all
ordering bugs.

**Workaround.** For race-condition fuzzing, the `drain` pattern from
section 6 plus `t.Parallel()` plus `-race` does cover a lot of
ground. For deeper concurrency bugs, consider tools like
`go.uber.org/goleak`, `runtime.SetBlockProfileRate`, or
explicit-schedule libraries.

### 15.5 No native dictionary support

**Limit.** No equivalent of AFL's `-dict=keywords.txt`.

**Workaround.** Add tokens as `f.Add` seeds. For a JSON parser:

```go
f.Add([]byte(`{}`))
f.Add([]byte(`[]`))
f.Add([]byte(`null`))
f.Add([]byte(`true`))
f.Add([]byte(`false`))
f.Add([]byte(`" "`))
f.Add([]byte(`-0`))
f.Add([]byte(`1e308`))
```

It's less general than a dictionary (the mutator may not splice
these tokens into other inputs), but it covers the most important
cases.

### 15.6 Slow fuzz/exec

**Limit.** Native Go fuzz typically gets 1k–10k execs/sec per core.
libFuzzer on C targets hits 100k–1M/sec. The instrumentation
overhead, the goroutine scheduling, and Go's GC all eat into the
fuzz speed.

**Workaround.** Three things help:
- Strip imports the harness doesn't need. A target that only fuzzes
  a parser should not pull in `net/http`.
- Reset per-call state inline rather than calling expensive
  constructors.
- Run with `-cpu=1` if your code has goroutines whose scheduling
  variance is wider than the bug detection benefit.

### 15.7 Limited input recording

**Limit.** A fuzz target receives only the inputs the framework
passed it. There is no "save the entire mutator state" feature for
later analysis.

**Workaround.** For research-style use cases, log each input to a
file alongside the result. Don't do this in production CI runs (the
disk fills up); do it when you're investigating why a target is not
finding bugs you expected.

## 16. A senior-level checklist

When you join a team and inherit their fuzzing setup, run through
this list. Each item has caught real misconfiguration in real
projects.

1. **Are all fuzz targets actually running in CI?** Grep for `Fuzz`
   functions in tests, cross-reference against the CI matrix.
2. **What's the per-target fuzz time?** Anything under 30 seconds
   per target on PR runs is essentially regression-only.
3. **Is the corpus persisted between CI runs?** Check the
   `actions/cache` (or equivalent) for `-fuzzcachedir`.
4. **Is OSS-Fuzz or ClusterFuzzLite enabled?** Look for
   `.clusterfuzzlite/` or an entry in the OSS-Fuzz `projects/`
   directory.
5. **Are crashers in `testdata/fuzz/` reviewed in PRs?** A common
   anti-pattern: developers commit crashers, the test now passes
   because the bug "is fixed", but the fix was just to update the
   expected behavior to match the buggy output. Check git log on
   the testdata directory.
6. **Are minimization times set?** `-fuzzminimizetime` defaults are
   reasonable but worth confirming.
7. **Are the harnesses doing more than panic detection?** A harness
   that only checks "did it panic" is wasted budget. Add round-trip
   checks, invariant checks, or differential checks.
8. **Are sanitizers enabled where applicable?** For cgo-heavy code,
   ASan and MSan via OSS-Fuzz find bugs that pure Go cannot.
9. **Is there a triage cadence?** Crashes without a human reviewing
   them within a week become bug-tracker noise.
10. **Is the vuln-disclosure path documented?** When a fuzz finds
    a CVE-level bug, the engineer who found it should know where
    to send it without asking.

Going through this list on an existing project usually surfaces 2-3
issues. On a new project, treat it as a setup checklist.

## 17. Summary

- Native fuzzing replaced `go-fuzz` because it ships in the
  toolchain, types its inputs, and reproduces by hash. It still
  lacks dictionaries, grammar mode, and rich shrinking.
- OSS-Fuzz and ClusterFuzzLite are the practical continuous-fuzzing
  options. CFLite is the lightweight default for private repos.
- Harness design matters more than fuzz time. Round-trip checks,
  invariant assertions, and differential comparisons each find
  classes of bugs that "did it panic" misses.
- Structure-aware fuzzing in Go means writing a custom `drain`
  function that turns `[]byte` into a sequence of typed operations.
  This is how you fuzz state machines and protocols.
- Coverage-guided fuzzing instruments edges and uses bucketed
  counters to decide which inputs are "interesting". Reusing Go's
  `-cover` instrumentation was the trick that made the feature
  ship.
- Corpus minimization and crash deduplication are operational
  concerns, not algorithmic ones. Budget for them.
- Fuzz and property-based testing (rapid) are complementary, not
  competing. Use fuzz at trust boundaries; use rapid for algebraic
  invariants and state machines.
- The fuzz design CLs (golang/go#44551, #43830) document why the
  API looks the way it does. Read them before proposing changes.
- Fuzzing's limits are real but worked around. The senior skill is
  knowing which workaround applies to which limit.

[← Back](../)
