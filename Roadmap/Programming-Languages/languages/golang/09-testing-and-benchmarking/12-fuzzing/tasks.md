---
layout: default
title: Fuzzing — Tasks
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/tasks/
---

# Fuzzing — Tasks

[← Back](../)

These exercises walk you through native Go fuzz testing from first contact to integration in CI. They are ordered by difficulty. Each task has a problem statement, hints, and an expected behavior section so you can self-check.

## Task 1 — Fuzz a string-reversal function

### Problem

You are given the following function:

```go
package strrev

func Reverse(s string) string {
    b := []byte(s)
    for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
        b[i], b[j] = b[j], b[i]
    }
    return string(b)
}
```

Write a fuzz target `FuzzReverseInvolution` in `strrev_test.go` that asserts `Reverse(Reverse(s)) == s` for any string. Seed with a handful of short and Unicode strings.

### Hints

- The current implementation operates on bytes, not runes. For inputs containing multi-byte UTF-8 sequences, the round-trip will produce invalid UTF-8. You should *discover* this bug, not work around it.
- Use `f.Add` with at least one ASCII string, one empty string, and one multi-byte string.
- Use `t.Fatalf` (not `t.Errorf`) for the assertion so the input is persisted.

### Expected behavior

- The seed corpus alone should *not* trigger the bug if you seeded only ASCII.
- Running `go test -run=^$ -fuzz=FuzzReverseInvolution -fuzztime=30s` should find a multi-byte input within a few seconds. The saved input will appear under `testdata/fuzz/FuzzReverseInvolution/<hash>`.
- After committing the saved input, `go test ./...` (no `-fuzz`) reproduces the failure deterministically.

### Stretch

Fix the function to operate on runes and rerun fuzz for two minutes. Confirm no new failures.

## Task 2 — Fuzz JSON unmarshal/marshal round-trip

### Problem

Write a fuzz target `FuzzJSONRoundTrip` for `encoding/json` that asserts: for any `[]byte` that successfully unmarshals into `any`, the re-marshal must succeed, and the re-unmarshal must produce a value `reflect.DeepEqual` to the first unmarshalled value.

### Hints

- Reject inputs that fail the first `json.Unmarshal` using `t.Skip()` — they are not interesting for this property.
- `any` will deserialize JSON numbers into `float64`, which may not round-trip exactly. Decide whether your invariant tolerates this.
- Seed with `{"a":1}`, `[]`, `"x"`, `null`, `true`.

### Expected behavior

- Most fuzz inputs will be discarded via `t.Skip` because they are not valid JSON.
- For valid JSON, the round-trip should succeed. If you discover an asymmetry (e.g., a JSON number that loses precision through `float64`), document it.

### Stretch

Repeat with `*json.Decoder` configured with `UseNumber()`. Compare findings.

## Task 3 — Fuzz a tiny expression parser

### Problem

You have a parser:

```go
package calc

// Eval parses a simple arithmetic expression of integers, +, -, *, /, and
// parentheses, and returns the result. On invalid input, it returns an error.
func Eval(expr string) (int, error)
```

Write `FuzzEval` such that:

- For any `string` input, `Eval` must not panic.
- For inputs containing only `0-9`, `+`, `-`, `*`, `/`, `(`, `)` characters, an error must be returned *or* a value, but the function must not loop forever (rely on `-timeout` to catch hangs).

### Hints

- Use `t.Skip()` for inputs containing characters outside the allowed alphabet *if* you want to focus the fuzzer; otherwise leave them in to test the "must not panic" property on arbitrary garbage.
- Seed with `"1+2"`, `"(1+2)*3"`, `"1/0"`, `"((((1))))"`, `""`.

### Expected behavior

- Fuzz should quickly find any nil dereference or panic in your parser.
- Division by zero should be returned as an error, not as a panic. If you discover a panic on `"1/0"` you have a real bug.
- Deeply nested parens may discover stack-overflow vulnerability if the parser is naively recursive.

### Stretch

After running for 5 minutes, count the saved corpus entries. Reduce the parser to make all of them pass.

## Task 4 — Reproduce a saved failure

### Problem

A colleague hands you a tarball containing one file:

```
testdata/fuzz/FuzzParseConfig/3a7f12bc...
```

The file content is:

```
go test fuzz v1
[]byte("\x00\x00\x00\xff\xff\xff\xff")
```

Your task:

1. Extract the tarball into the repo at the same relative path.
2. Run the project's unit tests. The failing input must be replayed automatically and the test must fail.
3. Run only the failing case in isolation: `go test -run=FuzzParseConfig/3a7f12bc...`.
4. Open the test file. Decode by eye what input the parser is choking on.
5. Add a debug print or attach a debugger, identify the root cause, and write a *unit* test (not a fuzz target) that pins the behavior post-fix.

### Hints

- The `go test fuzz v1` line is a versioning sentinel, not part of the input.
- The `[]byte("...")` line is the literal input. The escapes follow Go syntax.
- After fixing, *keep* the corpus file. It now serves as a regression.

### Expected behavior

- `go test` exits non-zero before the fix.
- After the fix, `go test` exits zero and the saved file is still present (and still replayed every run).

## Task 5 — Fuzz a stateful protocol decoder

### Problem

You have a decoder for a tiny binary protocol:

```go
type Packet struct {
    Type    byte
    Length  uint16
    Payload []byte
}

func Decode(r io.Reader) (*Packet, error)
```

Write `FuzzDecode` that fuzzes the function on arbitrary `[]byte` input wrapped in a `bytes.Reader`. Properties to assert:

- No panic, ever.
- If `Decode` returns success, the `Length` field must equal `len(Payload)`.
- If the input is shorter than three bytes, `Decode` must return an error.

### Hints

- Seed with at least one well-formed packet and one truncated one.
- The `Length` field is a `uint16`. Without a sanity bound, the fuzzer will eventually generate `Length=65535` with only one byte of payload, exercising the truncation path.

### Expected behavior

- Within thirty seconds, fuzz should find any unbounded allocation in `Decode` (allocating a 64 KiB buffer for every input is not strictly a bug, but allocating a 4 GiB buffer would be).
- Truncated input must be reported as `io.ErrUnexpectedEOF` or similar — not a panic.

### Stretch

After basic decoding is robust, add a checksum field and re-fuzz to find off-by-one errors in checksum verification.

## Task 6 — Run fuzz in CI

### Problem

Integrate fuzz testing into a GitHub Actions workflow. Requirements:

1. On every push to `main`, run the seed corpus replay only (no `-fuzz`). This must take less than 30 seconds.
2. On every PR, run `FuzzParse` with `-fuzztime=2m`. Failure is *not* a merge blocker; it is reported as a separate check.
3. Nightly (cron), run `FuzzParse` and three other fuzz targets for 30 minutes each. New saved corpus entries must be uploaded as artifacts.
4. New failures must open a GitHub issue using `gh issue create`.

### Hints

- Use a matrix to run multiple fuzz targets in parallel jobs.
- Cache `~/.cache/go-build` between nightly runs to retain the working corpus.
- For the PR job, set `continue-on-error: true` and emit the result as a status check, not a build failure.

### Expected workflow excerpts

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 3 * * *"
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go test ./...
  fuzz-pr:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go test -run=^$ -fuzz=FuzzParse -fuzztime=2m ./...
  fuzz-nightly:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target: [FuzzParse, FuzzDecode, FuzzEval, FuzzJSONRoundTrip]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - uses: actions/cache@v4
        with:
          path: ~/.cache/go-build
          key: gocache-${{ matrix.target }}-${{ github.sha }}
          restore-keys: gocache-${{ matrix.target }}-
      - run: go test -run=^$ -fuzz=${{ matrix.target }} -fuzztime=30m ./...
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: corpus-${{ matrix.target }}
          path: testdata/fuzz/${{ matrix.target }}/
```

### Expected behavior

- A new bug discovered nightly produces an artifact you can download, place in your repo, and reproduce with `go test`.
- Recurring failures stop opening duplicate issues if the saved corpus file already exists in `main`.

## Self-evaluation checklist

After completing the six tasks you should be able to:

- [ ] Write a fuzz target without consulting the docs.
- [ ] Pick a coverage seed corpus appropriate for the target.
- [ ] Recognize when `t.Skip()` is appropriate versus when `t.Fatal` is.
- [ ] Reproduce a saved failure deterministically.
- [ ] Triage a fuzz finding into a unit-test-level regression.
- [ ] Configure CI to run fuzz on schedule without blocking PRs.
- [ ] Tune `-fuzztime`, `-fuzzminimizetime`, and `-parallel` to a project's needs.

If any item is uncertain, re-read the junior or middle page and redo the corresponding task.

[← Back](../)
