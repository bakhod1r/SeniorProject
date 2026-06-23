---
layout: default
title: Golden Files — Middle
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/middle/
---

# Golden Files — Middle

[← Back](../)

The junior page got you to a working golden test with twenty lines of helper code. This page scales the pattern: many cases via table-driven tests, normalization for non-deterministic output, readable diffs, JSON and HTML payloads, and the two main helper libraries (`sebdah/goldie`, `hexops/autogold`). By the end you will be able to drop golden testing into a real production package without writing it from scratch each time.

## Table-driven golden tests

The single most common pattern in Go testing is the table loop. Goldens compose naturally with it. The recipe:

```go
func TestRender(t *testing.T) {
    cases := []struct {
        name  string
        input Document
    }{
        {"empty", Document{}},
        {"one_section", Document{Title: "T", Sections: []Section{{Title: "S", Lines: []string{"x"}}}}},
        {"three_sections", longerDocument()},
    }
    for _, tc := range cases {
        tc := tc // capture for parallel
        t.Run(tc.name, func(t *testing.T) {
            got := Render(tc.input)
            assertGolden(t, []byte(got))
        })
    }
}
```

The helper uses `t.Name()` to choose the golden path:

```go
func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    name := strings.ReplaceAll(t.Name(), "/", "_")
    path := filepath.Join("testdata", name+".golden")
    // ... read/write as before
}
```

`t.Name()` returns `TestRender/empty`, `TestRender/one_section`, etc. Replacing `/` with `_` produces flat filenames: `TestRender_empty.golden`, `TestRender_one_section.golden`. Each case has its own file. Failures are isolated: breaking the `empty` case fails only its subtest, leaving the others intact.

This is the dominant pattern in real Go codebases. You will see it in `kubectl`, in `gofmt`, in `terraform`, in the Go standard library itself. Internalize it.

## Why `t.Name()` is the right path source

It is tempting to construct paths manually:

```go
assertGolden(t, tc.name, got) // pass name explicitly
```

But `t.Name()` is canonical. It includes the parent test name, so `TestRender/empty` will not collide with `TestOther/empty`. It is built from the literal `t.Run` argument so refactoring renames cleanly. And it is what the test framework already exposes for subtest reporting, so failure messages naturally line up.

Whenever I review a golden test that passes the name explicitly, I look for the bug where two unrelated subtests collide on the same file. `t.Name()` eliminates that class of bug.

## Parallel goldens

Subtests can run in parallel as long as each has a distinct golden path:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        got := Render(tc.input)
        assertGolden(t, []byte(got))
    })
}
```

Because each subtest's golden path is derived from `t.Name()`, no two subtests ever write to the same file. Parallel `-update` is safe. Parallel comparison is trivially safe.

What is NOT safe is sharing a `*bytes.Buffer` or any other mutable state at the package level. Always allocate per-subtest. The find-bug page has an example of the race you get if you do not.

## Readable diffs with `cmp.Diff`

The minimal helper from the junior page reports `want: %q got: %q` on failure. For one-line outputs this is fine. For 200-line outputs it is unreadable. Replace it with `github.com/google/go-cmp/cmp.Diff`:

```go
import "github.com/google/go-cmp/cmp"

if !bytes.Equal(got, want) {
    diff := cmp.Diff(string(want), string(got))
    t.Fatalf("golden mismatch at %s (-want +got):\n%s", path, diff)
}
```

`cmp.Diff(want, got)` produces unified-style output with `-` lines for removals from want and `+` lines for additions in got. Example failure:

```
golden mismatch at testdata/TestRender_one_section.golden (-want +got):
  string(
- 	"## 1. Introduction\nHello\n",
+ 	"## 1. Intro\nHello\n",
  )
```

The reviewer can see exactly where the bytes diverged. For longer outputs, `cmp.Diff` chooses sensible context around the change.

For line-level granularity on multi-line outputs, transform the strings to slices of lines first:

```go
import "github.com/google/go-cmp/cmpopts"

diff := cmp.Diff(strings.Split(string(want), "\n"), strings.Split(string(got), "\n"))
```

The output now reads like a line-by-line patch, which is what you want for HTML or Markdown.

## Normalization

Production code emits non-deterministic bytes: timestamps, UUIDs, version strings, file paths, line numbers. A naive golden test fails on the second run because the timestamp changed.

Two responses, in order of preference:

1. **Inject the source of non-determinism.** Pass a clock, a random source, a hostname provider. Tests substitute fixed values. The SUT is now deterministic; no normalization needed.
2. **Normalize the output before comparison.** Apply regex passes that replace non-deterministic substrings with placeholders.

Option 1 is strictly better. It tests real behavior. Option 2 is a workaround when the SUT is not under your control or the injection cost is prohibitive.

### A normalizer chain

```go
type Normalizer func([]byte) []byte

var (
    rfc3339RE = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z`)
    uuidRE    = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`)
    versionRE = regexp.MustCompile(`v\d+\.\d+\.\d+(-[a-z0-9.-]+)?`)
)

func normalize(b []byte) []byte {
    b = rfc3339RE.ReplaceAll(b, []byte("<TIMESTAMP>"))
    b = uuidRE.ReplaceAll(b, []byte("<UUID>"))
    b = versionRE.ReplaceAll(b, []byte("<VERSION>"))
    b = bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))
    return b
}
```

Apply in the helper:

```go
func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    got = normalize(got)
    // ...rest as before
}
```

The golden file then contains `<TIMESTAMP>`, `<UUID>`, etc. The placeholder is part of the canonical form.

### Properties of a good normalizer

- **Idempotent.** `normalize(normalize(x)) == normalize(x)`. Otherwise the test becomes order-sensitive.
- **Total.** Defined for all inputs, including empty.
- **Stable.** Same input produces same output across runs and platforms.
- **Justified.** Each normalizer corresponds to a documented source of non-determinism. Do not add normalizers "just in case".

### Apply to actual only

Apply normalizers to the `got` bytes, not to the golden bytes. The golden is already canonical — it was written through the same normalizer at `-update` time. Re-normalizing it on every read wastes CPU and risks accidental double-replacement.

### A warning

Each normalizer is a place where the test masks reality. If you find yourself adding the fifth normalizer, stop. The SUT has a determinism problem that should be fixed at the source. Inject a clock. Inject a random source. Sort your maps. Strip absolute paths. Push the determinism into the production code, where it belongs.

A common smell: a `versionRE` normalizer. If your SUT emits a version string in output, that version is part of the contract. Either it should always emit `<placeholder>` in tests (via a build tag or a `Version` variable replaced under `-ldflags`) or the version is itself worth golden-testing for upgrade scenarios.

## JSON output goldens

JSON serialization is a frequent golden target. Two subtleties:

**1. `encoding/json` sorts map keys.** The standard library guarantees `json.Marshal` emits map keys in sorted order. So a `map[string]int{...}` will produce stable JSON, no manual sort needed. (This is a documented behavior; depend on it.)

**2. Struct field order is declaration order.** Stable as long as the struct definition is stable.

**3. Indentation matters.** `json.Marshal` emits compact JSON; `json.MarshalIndent(v, "", "  ")` emits pretty JSON. Choose one and stick to it. The golden file format is whatever you choose.

A canonical JSON-golden helper:

```go
func assertGoldenJSON(t *testing.T, value any) {
    t.Helper()
    b, err := json.MarshalIndent(value, "", "  ")
    if err != nil {
        t.Fatal(err)
    }
    b = append(b, '\n') // trailing newline for editor convenience
    assertGolden(t, b)
}
```

The golden file is pretty-printed JSON, easy to read in a code review.

### Why prefer JSON goldens to inline literals

The alternative is `cmp.Diff(value, expectedStruct)`. That works for small structures. For deeply nested structures with optional fields, time values, and slices of slices, the inline expected literal grows unreadable. A JSON golden file flattens the structure into a single text artifact that a reviewer can scan.

The trade-off: JSON loses type information. `42` could be an `int` or a `float64`. If the type matters for your contract, JSON goldens are wrong; use a structural assertion. For most renderer-style code, the JSON-as-bytes view is the better lens.

## HTML output goldens

HTML rendering is the classic golden file use case. The output is large, structured, and very sensitive to small changes a unit test would miss.

```go
type Tmpl struct{ ... }

func Render(t Tmpl) ([]byte, error) {
    var b bytes.Buffer
    if err := tmpl.Execute(&b, t); err != nil {
        return nil, err
    }
    return b.Bytes(), nil
}

func TestRender_html(t *testing.T) {
    cases := []struct {
        name string
        in   Tmpl
    }{
        {"minimal", Tmpl{Title: "Hi"}},
        {"full", Tmpl{Title: "Hi", Body: "Hello", Tags: []string{"a", "b"}}},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            got, err := Render(tc.in)
            if err != nil { t.Fatal(err) }
            assertGolden(t, got)
        })
    }
}
```

The golden files are `.golden` snapshots of the rendered HTML. Reviewers open them in an editor with HTML syntax highlighting. Some teams symlink the goldens into `.html` files for browser preview:

```
ln -s testdata/TestRender_html_minimal.golden testdata/preview/minimal.html
```

Then `open testdata/preview/minimal.html` in a browser renders the expected output. This makes golden updates self-documenting: the reviewer sees the change both as a diff and as a rendered page.

## Code generation goldens

Goldens shine for code generators. The SUT emits a Go file; the golden is the canonical generated form.

```go
func TestGenerate_struct(t *testing.T) {
    spec := Spec{Name: "User", Fields: []Field{{Name: "ID", Type: "int"}, {Name: "Email", Type: "string"}}}
    got, err := Generate(spec)
    if err != nil { t.Fatal(err) }
    // run gofmt on output so the golden is canonical formatted Go
    formatted, err := format.Source(got)
    if err != nil { t.Fatalf("gofmt: %v\nsource:\n%s", err, got) }
    assertGolden(t, formatted)
}
```

`go/format.Source` runs the same logic as `gofmt`. Always apply it before writing the golden. Otherwise spurious whitespace changes will fail tests on different Go versions.

A bonus: the golden can be a valid Go file. If you suspect a regression in code generation, copy the golden into a temporary package and `go build` it. The toolchain will catch syntax bugs that the byte comparison alone cannot.

## The `sebdah/goldie` library

The hand-rolled helper covers 90% of needs. For the remaining 10% — color diffs, custom diff engines, JSON-aware comparison — `github.com/sebdah/goldie/v2` packages everything.

```go
import "github.com/sebdah/goldie/v2"

func TestRender(t *testing.T) {
    g := goldie.New(t,
        goldie.WithFixtureDir("testdata"),
        goldie.WithNameSuffix(".golden"),
        goldie.WithDiffEngine(goldie.ColoredDiff),
    )
    got := Render(input)
    g.Assert(t, t.Name(), []byte(got))
}
```

`g.Assert(t, name, bytes)` is the workhorse. Behind the scenes it does exactly what your helper does: read, compare, fail with a diff, or rewrite under `-update`. Goldie's `-update` flag is its own (`-update`), so no extra flag declaration is needed.

Goldie also provides:

- `g.AssertJson(t, name, value)` — marshals to JSON before comparison.
- `g.AssertXml(t, name, value)` — XML variant.
- `g.AssertWithTemplate(t, name, data, got)` — golden is a Go template, rendered with data before comparison. Useful for goldens that need a small variable section.
- Configurable file permissions, fixture directory, suffix.

When to use goldie:

- You want a library people recognize.
- You need colored diffs without writing diff code.
- You want JSON-aware comparison out of the box.

When to skip goldie:

- Your needs fit in twenty lines of helper code.
- You want zero external test dependencies.

Both are valid. The hand-rolled helper teaches the pattern; goldie shortens the keystrokes.

## The `hexops/autogold` library

`github.com/hexops/autogold/v2` takes a different tack. Instead of storing expectations in `testdata/*.golden`, it stores them inline as Go literals in the test source file. Under `-update`, the test file itself is rewritten.

```go
import "github.com/hexops/autogold/v2"

func TestSum(t *testing.T) {
    got := Sum([]int{1, 2, 3})
    autogold.Expect(6).Equal(t, got)
}

func TestRender(t *testing.T) {
    got := Render(Document{Title: "x"})
    autogold.Expect("Hello\n").Equal(t, got)
}
```

The initial argument to `Expect` is the expected value. The first run fails (no expectation set). You run `go test -update`. Autogold rewrites the test file so `Expect(6)` becomes `Expect(6)` with the correct literal.

For small expectations, this keeps everything in one place: the test code shows both the input and the expected output without flipping to a separate file. For large expectations (multi-kilobyte HTML), an inline string literal becomes unreadable; testdata files are better.

Autogold also supports complex types:

```go
autogold.Expect(map[string]int{"a": 1}).Equal(t, got)
```

It pretty-prints the inline literal in update mode.

When to use autogold:

- Expectations are small (under twenty lines).
- You want the test and expectation in one file.
- You want Go literal types preserved (not flattened to JSON).

When to skip autogold:

- Expectations are large.
- You want the expectation visible in a non-Go format (HTML, JSON).
- You want `git diff` on the expectation file separate from code changes.

Many projects use both: autogold for small inline expectations, testdata for large outputs.

## Choosing between approaches

A decision matrix:

| Need | Hand-rolled | sebdah/goldie | hexops/autogold |
|------|-------------|---------------|-----------------|
| Tiny expectation, in test source | bad | bad | good |
| Large HTML output | good | good | bad |
| Complex Go struct, inline | bad | bad | good |
| Multiple format support (JSON, XML) | manual | good | bad |
| Zero dependencies | good | bad | bad |
| Colored diffs | manual | good | varies |
| One library across team | varies | good | good |

Pick one approach per package and document it. Mixing approaches in one package is friction.

## Shared fixtures versus per-test goldens

A pattern that comes up in larger suites: many tests share a common header or schema. Do you share the golden or duplicate it?

The rule: per-test golden files, always. Each test owns its golden. The cost of duplication is a few extra files; the cost of sharing is much higher: when the shared file changes, every test using it can fail at once, and the failure message does not tell you which test cares.

If multiple tests really do need the same fixture input, share the **input**, not the golden. A common JSON input file under `testdata/fixtures/` is fine. The output for each test is its own.

## Combining table tests, normalization, and `cmp.Diff`

A reference-quality helper for a table-driven JSON renderer with timestamp normalization:

```go
package render

import (
    "bytes"
    "encoding/json"
    "flag"
    "os"
    "path/filepath"
    "regexp"
    "strings"
    "testing"

    "github.com/google/go-cmp/cmp"
)

var update = flag.Bool("update", false, "rewrite testdata/*.golden")

var timestampRE = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z`)

func normalize(b []byte) []byte {
    b = timestampRE.ReplaceAll(b, []byte("<TIMESTAMP>"))
    b = bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))
    return b
}

func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    got = normalize(got)
    name := strings.ReplaceAll(t.Name(), "/", "_")
    path := filepath.Join("testdata", name+".golden")
    if *update {
        if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
            t.Fatal(err)
        }
        if err := os.WriteFile(path, got, 0o644); err != nil {
            t.Fatal(err)
        }
        return
    }
    want, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("read golden %s: %v (run -update)", path, err)
    }
    if !bytes.Equal(got, want) {
        diff := cmp.Diff(string(want), string(got))
        t.Fatalf("golden mismatch at %s (-want +got):\n%s", path, diff)
    }
}

func assertGoldenJSON(t *testing.T, v any) {
    t.Helper()
    b, err := json.MarshalIndent(v, "", "  ")
    if err != nil {
        t.Fatal(err)
    }
    b = append(b, '\n')
    assertGolden(t, b)
}
```

Use across the package:

```go
func TestRender(t *testing.T) {
    cases := []struct {
        name string
        in   Input
    }{
        {"empty", Input{}},
        {"with_data", Input{User: "bob", Created: someTime()}},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            got := Render(tc.in)
            assertGoldenJSON(t, got)
        })
    }
}
```

This is the production-quality version. About seventy lines, no library dependencies beyond `cmp`, supports parallel tests, normalizes timestamps, produces readable diffs. Copy it into your project and you are done.

## Pitfalls that bite at this level

A short list of mistakes that show up specifically in mid-sized golden suites.

**Forgetting to capture loop variables.** A classic Go gotcha exacerbated by `t.Parallel()`. If you write `t.Run(tc.name, ...)` inside a loop without `tc := tc`, the closure captures the loop variable by reference and all parallel subtests see the last value. Modern Go (1.22+) fixed this for `for` ranges but defensively rebind to be safe with older toolchains.

**Stale golden after rename.** You rename `TestRender` to `TestRenderHTML`. The old `TestRender.golden` becomes orphaned; the new test fails because `TestRenderHTML.golden` does not exist. Solution: rename the file too, or rerun `-update` and `git rm` the orphan.

**Normalizer ordering matters.** Apply line-ending normalization (`\r\n -> \n`) before regex normalizations that match line content. Otherwise `\r\n` boundaries cause regex misses.

**JSON map order versus struct map order.** `json.Marshal` sorts top-level `map[string]X` keys but does NOT guarantee order for arbitrary user-controlled iteration before marshaling. If you `for k, v := range m` and append to a slice, that slice has random order. Sort before marshaling.

**Multi-byte characters in file paths.** On macOS, filenames are normalized in HFS+ but not in APFS (different rules). If your test name contains non-ASCII characters, the resulting file path may differ between machines. Stick to ASCII in test names.

## CI configuration

A simple GitHub Actions step:

```yaml
- name: Test
  run: go test ./...
```

That is enough. Do not add a "regenerate goldens" step. Do not add a fallback to auto-update on failure. CI must reject unreviewed golden diffs.

If you want to make the "did goldens change?" check explicit, add a job that runs `-update` on a separate branch and posts a PR comment with the diff. This is a "preview" mechanism, not an auto-commit. Reviewers still gate the change.

## Pre-commit hooks

A pre-commit hook that warns when `.golden` files are staged without a paired source change can catch one common mistake:

```sh
#!/bin/sh
golden_staged=$(git diff --cached --name-only | grep '\.golden$' || true)
src_staged=$(git diff --cached --name-only | grep '\.go$' | grep -v _test.go || true)
if [ -n "$golden_staged" ] && [ -z "$src_staged" ]; then
    echo "warning: .golden files staged without source changes"
    echo "did you mean to commit a regeneration?"
    exit 1
fi
```

This is a heuristic, not a guarantee. A reviewer is still the final gate.

## What you can do now

After this page, you should be able to:

- Write a table-driven golden test for a renderer or serializer.
- Apply normalization for timestamps and other non-deterministic content.
- Produce readable diffs on failure.
- Choose between hand-rolled helpers, `sebdah/goldie`, and `hexops/autogold`.
- Configure CI to fail on golden drift.

The senior page covers the next level: versioned goldens for backward-compatibility, deep code-generation testing, organizational patterns for review discipline, and the anti-patterns that creep into long-lived golden suites.

## Exercise

Take the code from the junior page (the Markdown renderer or the CLI). Extend it:

1. Convert to table-driven with at least four cases.
2. Add timestamp injection so output includes a generated-at timestamp.
3. Add `cmp.Diff` for readable failures.
4. Then convert the helper to use `sebdah/goldie/v2` and compare ergonomics.
5. Write down one paragraph: which felt better, and why.

This exercise is what cements the middle skills. Without doing it, the differences between the approaches stay abstract.

## A note on the social layer

A team of three engineers can sustain a golden suite by convention. A team of thirty cannot. As your team grows, the social conventions around goldens become load-bearing:

- A documented update workflow.
- A PR template that asks "did you change goldens? did you read the diff?".
- A culture where reviewers actually open changed `.golden` files.
- A bot or check that flags PRs with golden changes for extra scrutiny.

Without these, the suite degrades. People run `-update` to make CI green, the diff goes unreviewed, the regression ships. With them, the suite catches subtle bugs that no other test layer would have noticed.

The senior page goes deeper into how to bring these conventions into an organization. For now, internalize the technical mechanics on this page, write a few real golden tests in your own code, and notice where the framework starts to strain. Those are exactly the points the senior page addresses.

## Closing

You now have the working vocabulary of golden file testing in Go: tables, normalization, diffs, libraries. The framework is settled science; the literature is mostly about how to use it well. Spend a week using it on a real project. Notice the cases where it shines (rendered output, generated code) and the cases where it strains (timing-sensitive outputs, very large fixtures). The instincts you build will guide you when the senior page asks harder questions.

## Deeper look: fixture inputs

The golden file holds expected output. The corresponding input often deserves its own file too. A pattern:

```
testdata/
  inputs/
    invoice_basic.json
    invoice_discounted.json
  TestInvoice_basic.golden
  TestInvoice_discounted.golden
```

Test code:

```go
func TestInvoice(t *testing.T) {
    cases := []string{"basic", "discounted"}
    for _, name := range cases {
        t.Run(name, func(t *testing.T) {
            inputBytes, err := os.ReadFile(filepath.Join("testdata", "inputs", "invoice_"+name+".json"))
            if err != nil {
                t.Fatal(err)
            }
            var in Invoice
            if err := json.Unmarshal(inputBytes, &in); err != nil {
                t.Fatalf("parse input: %v", err)
            }
            got := Render(in)
            assertGolden(t, []byte(got))
        })
    }
}
```

This pattern shines when inputs are large or shared across tests. A single `invoice_basic.json` can drive a unit test, an integration test, and an end-to-end test, with each test asserting on its own scope.

Trade-off: introducing fixture files adds indirection. A reader of the test must open two files (input and golden) to understand the case. For small inputs, inline literals are clearer. For inputs that exceed twenty lines, the file is worth the click.

## Subtest names and filesystem safety

A common gotcha: subtest names with spaces, colons, or other characters that the filesystem dislikes. `t.Name()` will happily produce `TestX/case: with spaces`, and the file path will be hideous.

Normalize the test name to a safe form:

```go
func safeName(n string) string {
    n = strings.ReplaceAll(n, "/", "_")
    n = strings.ReplaceAll(n, " ", "_")
    n = strings.ReplaceAll(n, ":", "_")
    return n
}
```

Better: pick subtest names that are already filesystem-safe. Lower snake_case, no punctuation. This is a convention that pays for itself the first time you debug a path mismatch.

## Multiple goldens per test

A single test can produce multiple outputs that each deserve a golden. A CLI test, for example, produces stdout, stderr, and an exit code:

```go
func TestCmd(t *testing.T) {
    stdout, stderr, code := runCmd("arg1", "arg2")
    assertGoldenAt(t, "stdout", []byte(stdout))
    assertGoldenAt(t, "stderr", []byte(stderr))
    if code != 0 {
        t.Errorf("exit code: %d", code)
    }
}
```

Where:

```go
func assertGoldenAt(t *testing.T, suffix string, got []byte) {
    t.Helper()
    name := safeName(t.Name()) + "_" + suffix
    // ...
}
```

The result is three goldens per case:

```
testdata/TestCmd_stdout.golden
testdata/TestCmd_stderr.golden
```

…and an inline assertion on the exit code (which is small enough not to deserve a file).

This pattern is the right way to handle multi-output SUTs. Do not concatenate stdout and stderr into a single golden; they are separate channels.

## Goldens for streaming output

If the SUT writes incrementally to an `io.Writer`, capture it and golden the buffer:

```go
buf := new(bytes.Buffer)
err := Stream(buf, input)
if err != nil { t.Fatal(err) }
assertGolden(t, buf.Bytes())
```

The order in which `Stream` writes does not matter for the golden — only the final byte sequence does. If your SUT writes in goroutines, ensure ordering before assertion (channel-based serialization or a mutex around the writer).

## Goldens for compressed or encoded output

Some outputs are binary or compressed (PNG, gzip, protobuf). You can still golden them, but the comparison and the diff are harder.

Approach 1: golden the raw bytes. The file is binary; diffs are unreadable. Use `hex.Dump` for failure messages:

```go
if !bytes.Equal(got, want) {
    t.Fatalf("golden mismatch (-want +got):\n--- want\n%s\n--- got\n%s",
        hex.Dump(want), hex.Dump(got))
}
```

Approach 2: golden the decoded form. Decode the SUT output to its logical representation, then golden the canonical text form:

```go
decoded, err := decode(got)
if err != nil { t.Fatal(err) }
var canonical bytes.Buffer
json.NewEncoder(&canonical).Encode(decoded)
assertGolden(t, canonical.Bytes())
```

Approach 2 is usually better. The golden is reviewable. Reviewers can spot semantic errors. The byte representation of the binary format is tested separately by a round-trip test.

## Round-trip tests

Closely related to goldens but worth distinguishing: a round-trip test asserts `decode(encode(x)) == x` for arbitrary `x`. It does not pin the byte representation. Use round-trip tests alongside goldens:

- Round-trip: encoder and decoder are inverses.
- Golden: the encoded bytes have a specific stable form.

Together they catch different bugs. The round-trip catches "encoder lost information"; the golden catches "encoder changed its output format".

## Goldens for time-series or chart output

If your SUT produces a chart or time-series visualization, the output is often binary (PNG) or vector (SVG). For SVG, golden the text representation; SVG is XML and reviewable as text. For PNG, you have two options:

1. Golden the SVG before rasterization. Test the rasterizer separately.
2. Golden a perceptual hash of the PNG. Fragile but possible.

Option 1 is almost always better. Defer rasterization to a tested library and test the structured form yourself.

## Goldens for SQL queries

A surprisingly powerful pattern: golden the generated SQL from a query builder.

```go
func TestQuery_users_active(t *testing.T) {
    q := Query().From("users").Where("active = ?", true).OrderBy("created_at DESC")
    got := q.SQL()
    assertGolden(t, []byte(got))
}
```

The golden contains the exact SQL string. Any change to the query builder's output is caught. Reviewers can see the SQL in the diff and judge whether it is correct.

Caveat: if the query builder uses placeholders, the golden contains placeholders, not values. That is correct — the values are not part of the SQL contract.

## Goldens for compiled output

A linker, a transpiler, an optimizer — anything that takes source and produces source — is a natural golden target. The golden is the compiled form; the test exercises the full pipeline.

Treat the golden as a single artifact even if the pipeline is multi-stage. The behavior under test is the externally observable output, not the intermediate representations.

## When goldens go bad: smell #1, the unreadable diff

If a golden mismatch produces a diff that no human can review, the golden is too large or the format is wrong. Symptoms:

- The diff has 200+ lines.
- The diff hops back and forth between sections.
- A reviewer says "I do not know if this change is correct."

Responses, in order:

1. Split the SUT and golden into smaller pieces.
2. Use a more diff-friendly canonical form (line-per-record JSON instead of nested objects).
3. Replace the golden with a structural assertion that pinpoints the field that changed.

Goldens are a tool for human review. When the diff stops being reviewable, the tool has failed.

## When goldens go bad: smell #2, the flaky golden

A golden that fails sporadically points to a non-determinism in the SUT that you have not yet caught. Common sources:

- A map iteration.
- A `time.Now()` call.
- A goroutine race in output ordering.
- A locale-dependent format (number separators, case folding).
- A path-dependent format (absolute paths in error messages).

When a golden flakes, do not normalize the symptom. Find the source. Run the test in a loop:

```
for i in $(seq 100); do go test -run TestX || break; done
```

If it fails on iteration 47, you have a non-determinism. Inject the source, sort the iteration, or pin the locale.

A normalizer that hides flakiness is worse than no test: it hides bugs the SUT could expose.

## When goldens go bad: smell #3, the regenerate dance

If your team's workflow includes "rerun `-update` every few weeks because goldens drift", something is broken. Goldens should drift only when the SUT changes intentionally. If they drift without code changes, the SUT has unpinned dependencies, locale sensitivity, or unmasked non-determinism.

Fix the SUT. Pin the dependencies. Set `TZ=UTC` and `LANG=C` in the test environment if locale matters. Eliminate the drift; do not normalize it.

## Goldens versus contract tests

Two patterns can look similar.

A **golden test** asserts byte equality for a specific input.

A **contract test** asserts structural properties: "the response is valid JSON with a `users` field that is an array".

Use both. A contract test catches "the schema changed entirely". A golden test catches "the schema is the same but field order or formatting changed". Together they cover the API surface.

## Library deep dive: `sebdah/goldie/v2` options

The goldie library exposes constructor options that are worth knowing:

- `WithFixtureDir(string)` — change `testdata` to something else.
- `WithNameSuffix(string)` — change `.golden` to e.g. `.expected`.
- `WithSubTestNameForDir(bool)` — put each subtest's goldens under a subdirectory.
- `WithDiffEngine(engine)` — `goldie.ColoredDiff`, `goldie.ClassicDiff`, or a custom one.
- `WithDiffFn(func(actual, expected string) string)` — fully custom diff.
- `WithTestNameForDir(bool)` — group goldens by test function.

A reasonable default for a new project:

```go
g := goldie.New(t,
    goldie.WithFixtureDir("testdata"),
    goldie.WithNameSuffix(".golden"),
    goldie.WithDiffEngine(goldie.ColoredDiff),
    goldie.WithTestNameForDir(true),
)
```

`WithTestNameForDir(true)` is worth thinking about. It puts each test's goldens in a subdirectory:

```
testdata/
  TestRender/
    case1.golden
    case2.golden
  TestSerialize/
    empty.golden
```

For large test suites this keeps `testdata/` browsable. For small suites it adds depth without benefit. Choose based on suite size.

## Library deep dive: `hexops/autogold/v2` options

Autogold is more opinionated. The main entry points:

- `autogold.Expect(value).Equal(t, got)` — basic assertion.
- `autogold.Want("name", value)` — same but named, for table-driven tests.
- `autogold.ExpectFile("testdata/x.txt").Equal(t, got)` — store expectation in a file, like sebdah/goldie.

Mixed usage:

```go
func TestRender(t *testing.T) {
    cases := []struct {
        name string
        in   Input
        want autogold.Value
    }{
        {"empty", Input{}, autogold.Expect("")},
        {"one", Input{X: 1}, autogold.Expect("X=1\n")},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := Render(tc.in)
            tc.want.Equal(t, got)
        })
    }
}
```

Under `-update`, autogold rewrites the test file so each `autogold.Expect("")` becomes the actual output. The result is a test where input and expected output live side-by-side, very readable for small cases.

The catch: any test file rewriting tool is invasive. If you have unsaved changes or strange formatting, autogold may struggle. Make sure the file is committed before running `-update`, and inspect the resulting changes carefully.

## A working configuration matrix

For a new package, my default choices:

- Hand-rolled `assertGolden` if the team is small and goldens are simple.
- `sebdah/goldie/v2` if the team is medium and wants library-level diff support.
- `hexops/autogold/v2` for small inline expectations alongside testdata for large outputs.
- `cmp.Diff` for diff output regardless.
- Always inject clocks and random sources.
- Always sort map iterations.
- One `update` flag per package.
- Subtest names in lower_snake_case.

These choices reduce decision fatigue. Document them in CONTRIBUTING.md.

## Practical exercise round 2

Build a small HTTP handler test using goldens:

```go
func TestUsersHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/users", nil)
    rec := httptest.NewRecorder()
    UsersHandler(rec, req)
    body := rec.Body.Bytes()
    assertGolden(t, body)
}
```

The golden contains the response body. Add cases for different query parameters. Then add a normalizer for the `Date` header in the response, which changes each second. Use `cmp.Diff` for failures.

Once this works for one handler, extend to a router that dispatches to multiple handlers. The golden tests now cover the full HTTP-layer behavior.

This pattern is the foundation of golden testing for HTTP services in Go. Real projects use it for thousands of handler responses; the discipline scales as long as the conventions hold.

## What success looks like

A healthy mid-sized golden suite has:

- Twenty to a few hundred `.golden` files in `testdata/`.
- Subtest names that match file names.
- Maybe two or three normalizers, each documented.
- `cmp.Diff` in every failure path.
- CI that fails on any `.golden` change without a paired source change.
- A documented `-update` workflow in CONTRIBUTING.md.
- Reviewers who actually open `.golden` files in PRs.

If your suite has all of this, you are in better shape than 80% of Go projects.

## Closing, again

This page covered table-driven goldens, normalization, readable diffs, multiple output assertions, library choices, and the smells that indicate a suite is degrading. You should now be productive with goldens on a real project.

The senior page assumes everything here as background and steps up to organizational and architectural concerns: versioned goldens for backward-compatibility, deep code-generation testing, anti-patterns in long-lived suites, and the team practices that keep golden testing useful past the first six months of a project.

## Appendix: full reference helper

For copy-paste convenience, here is the entire helper used by mid-sized projects. Drop it into a `golden_test.go` file in your package and remove the parts you do not need.

```go
package mypackage

import (
    "bytes"
    "encoding/json"
    "flag"
    "fmt"
    "io"
    "os"
    "path/filepath"
    "regexp"
    "strings"
    "testing"

    "github.com/google/go-cmp/cmp"
)

var update = flag.Bool("update", false, "rewrite testdata/*.golden")

// Normalizers, ordered. Add only when a documented source of
// non-determinism is in play.
var (
    nlNormRE      = regexp.MustCompile(`\r\n`)
    rfc3339RE     = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z`)
    uuidRE        = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`)
    projectRootRE *regexp.Regexp // initialize from runtime
)

func normalize(b []byte) []byte {
    b = nlNormRE.ReplaceAll(b, []byte("\n"))
    b = rfc3339RE.ReplaceAll(b, []byte("<TIMESTAMP>"))
    b = uuidRE.ReplaceAll(b, []byte("<UUID>"))
    return b
}

func safeName(n string) string {
    n = strings.ReplaceAll(n, "/", "_")
    n = strings.ReplaceAll(n, " ", "_")
    n = strings.ReplaceAll(n, ":", "_")
    return n
}

func goldenPath(t *testing.T, suffix string) string {
    t.Helper()
    name := safeName(t.Name())
    if suffix != "" {
        name = name + "_" + suffix
    }
    return filepath.Join("testdata", name+".golden")
}

func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    assertGoldenAt(t, "", got)
}

func assertGoldenAt(t *testing.T, suffix string, got []byte) {
    t.Helper()
    got = normalize(got)
    path := goldenPath(t, suffix)
    if *update {
        if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
            t.Fatal(err)
        }
        if err := os.WriteFile(path, got, 0o644); err != nil {
            t.Fatal(err)
        }
        return
    }
    want, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("read golden %s: %v (run with -update to create)", path, err)
    }
    if !bytes.Equal(got, want) {
        diff := cmp.Diff(string(want), string(got))
        t.Fatalf("golden mismatch at %s (-want +got):\n%s", path, diff)
    }
}

func assertGoldenJSON(t *testing.T, v any) {
    t.Helper()
    b, err := json.MarshalIndent(v, "", "  ")
    if err != nil {
        t.Fatal(err)
    }
    b = append(b, '\n')
    assertGolden(t, b)
}

func assertGoldenReader(t *testing.T, r io.Reader) {
    t.Helper()
    b, err := io.ReadAll(r)
    if err != nil {
        t.Fatal(err)
    }
    assertGolden(t, b)
}

// Optional helper: snapshot stdout/stderr of a function.
func captureOutput(fn func()) (stdout, stderr []byte) {
    oldOut, oldErr := os.Stdout, os.Stderr
    rOut, wOut, _ := os.Pipe()
    rErr, wErr, _ := os.Pipe()
    os.Stdout = wOut
    os.Stderr = wErr
    done := make(chan struct{})
    var bufOut, bufErr bytes.Buffer
    go func() {
        io.Copy(&bufOut, rOut)
        io.Copy(&bufErr, rErr)
        close(done)
    }()
    fn()
    wOut.Close()
    wErr.Close()
    <-done
    os.Stdout, os.Stderr = oldOut, oldErr
    return bufOut.Bytes(), bufErr.Bytes()
}

// Compile-time assertion that the helper signature is stable.
var _ = fmt.Sprintf
```

Drop the helpers you do not need. Keep `assertGolden`, the flag, and one of the JSON or reader variants depending on your SUT. The package-level `update` flag is the central piece.

## Appendix: a Makefile target

```makefile
.PHONY: test golden lint

test:
	go test ./...

golden:
	go test ./... -update
	@echo "Inspect changes:"
	@git status -s testdata/ || true

lint:
	@if grep -RIl 'testdata' --include='*.go' . > /dev/null 2>&1; then \
		echo "Reminder: testdata changes need PR review."; \
	fi
```

Run `make golden` after intentional output changes. Inspect, commit. Run `make test` otherwise.

## Appendix: README boilerplate

A snippet for your project's README, copy with edits:

```
## Testing

Tests under this package use golden files in `testdata/`.

- Run tests:           go test ./...
- Update goldens:      go test ./... -update
- Inspect changes:     git diff testdata/

When you update goldens, you MUST inspect every changed `.golden` file
before committing. Treat them as code; review them as code.
```

This three-line section is what protects your suite. Without it, new contributors will discover `-update` on their own and start the slow degradation.

## A small puzzle to end with

Suppose you have a golden test that passes on your laptop and fails on CI. The diff shows trailing whitespace on one line in `got` but not in `want`. What is the cause?

Likely answer: your editor's "trim trailing whitespace" setting silently removed bytes from the golden when you saved it after `-update`. The SUT still emits trailing whitespace; the golden no longer has it; the comparison fails on CI where no editor touched the file.

Fix: disable the editor setting for `.golden` files, or strip trailing whitespace in `normalize`. The latter masks the SUT behavior; consider whether the trailing whitespace is intentional. If it is not, fix the SUT.

This puzzle is representative. Most golden mismatches in real production are caused by something between the SUT and the byte sequence (editor, encoding, filesystem) rather than by the SUT itself. Learn to look at the bytes literally — `xxd` or `od -c` are your friends — when text-mode tools mislead.

## Diagnosing a mysterious mismatch

A short workflow when a golden test fails and you cannot immediately see why:

1. Print the lengths: `len(got), len(want)`. If they differ, find where the divergence starts.
2. Print hex dumps of the first 200 bytes of each. Compare side by side.
3. Compare byte arrays with `cmp.Diff(want, got)` against the line-split versions.
4. Look for `\r\n`, BOMs (`\xEF\xBB\xBF`), trailing whitespace, or non-printable bytes.
5. Check git history of the golden file — was it edited by hand? Saved by a different editor?
6. Check `.gitattributes` for line-ending normalization.

In 90% of cases the cause is one of: missing newline, line ending mismatch, trailing whitespace, BOM. Once you have seen each of these once, future diagnoses are fast.

## A worked example of normalization design

Suppose you are testing a logger that emits lines like:

```
2026-05-20T10:00:00.123456789Z INFO  [user_service] user_created user_id=42 trace_id=ab12cd34
```

The non-deterministic substrings are:

- The timestamp.
- The `trace_id`.
- Possibly the precision of the nanoseconds.

Naive approach: three regex normalizers. Better approach: inject a clock, inject a trace_id generator, and the SUT produces deterministic output:

```go
type Logger struct {
    clock     func() time.Time
    traceGen  func() string
}

func (l *Logger) Info(...) {
    fmt.Fprintf(l.out, "%s INFO ...", l.clock().Format(time.RFC3339Nano))
}
```

In tests:

```go
l := &Logger{
    clock:    func() time.Time { return testTime },
    traceGen: func() string { return "fixed-trace" },
}
```

The golden has the exact timestamp and trace_id, and the test exercises real logger behavior. If you cannot change the logger, then regex normalize. But always reach for injection first.

## Building golden tests bottom-up

A common path that works for adding goldens to an existing codebase:

1. Pick one stable, deterministic SUT (a renderer, a serializer). Add one golden test.
2. Run `-update`, inspect, commit.
3. Watch a teammate make a change. Did the test catch it? If yes, congrats; if not, why not?
4. Add three or four more goldens to the same package.
5. Refactor the helper into a shared `golden_test.go` file.
6. Add a `make golden` target and a CONTRIBUTING.md note.
7. Add a similar test in a second package.
8. After a month, evaluate: are the goldens catching things? Are reviewers reading the diffs? Has the team adopted the workflow?

If the answer is yes, expand to more packages. If no, address the gap before expanding. A poorly-disciplined golden suite is worse than no goldens at all.

## Closing remark on velocity

Golden testing initially feels slow. You have to write a helper, generate a golden, inspect it. The payoff comes later: when somebody changes the SUT and the goldens catch a subtle output regression that no other test layer would have noticed. Once that happens for the first time, the team usually internalizes the value.

Until then, treat goldens as an investment. They are cheap per case but expensive per organization (the review discipline costs attention). Start small. Build the habit. Scale only after the habit holds.

## A second appendix: dealing with `embed.FS`

For a test binary that should run without filesystem access (sandboxed CI, containers without bind mounts), embed the goldens into the binary:

```go
import "embed"

//go:embed testdata/*.golden
var goldenFS embed.FS

func readEmbeddedGolden(name string) ([]byte, error) {
    return goldenFS.ReadFile("testdata/" + name + ".golden")
}
```

Combined with the comparison logic, the test reads from the embedded FS at compare time. Under `-update` you still need to write to the real filesystem — `embed.FS` is read-only — so the helper branches:

```go
if *update {
    return os.WriteFile(diskPath, got, 0o644)
}
want, err := goldenFS.ReadFile(embedPath)
```

This is rarely needed. Most test environments have filesystem access. Use embedding only when you have a concrete reason.

## A third appendix: cross-platform considerations

A short list of platform-specific gotchas:

- **Path separators.** Use `filepath.Join`. Never literal `/`.
- **Line endings.** Normalize `\r\n` to `\n` in the helper, and pin via `.gitattributes`.
- **File modes.** Windows ignores Unix mode bits; tests should not assert on them.
- **Case sensitivity.** macOS APFS can be either case-sensitive or insensitive. Pick lowercase test names to be safe.
- **Symlinks.** Avoid. Goldens should be regular files.
- **Temp directories.** `t.TempDir()` returns a per-test directory. Goldens live in `testdata/`, not temp.

If your project supports multiple platforms, run the test suite on all of them in CI. Goldens that pass on Linux but fail on Windows usually point to one of the above.

## Final exercise

Take a real package from your work. Pick one function that produces interesting output (a renderer, a serializer, a query builder). Add five golden tests. Force yourself to inspect each generated file. Show the PR to a teammate.

Two outcomes are common:

- "These are way easier to review than my old `strings.Contains` tests." — you have an ally for spreading the pattern.
- "I do not get it; the file is just bytes." — you need to demonstrate. Wait for a real regression, point at the failing diff, explain what the test caught.

Both outcomes are useful. The pattern speaks for itself once a real bug gets caught. Patience.

[← Back](../)
