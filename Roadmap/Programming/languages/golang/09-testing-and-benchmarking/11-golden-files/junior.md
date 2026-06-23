---
layout: default
title: Golden Files — Junior
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/junior/
---

# Golden Files — Junior

[← Back](../)

## Why a special pattern exists

Imagine you have written a function that renders an HTML invoice. Given a customer name, a list of line items, and a tax rate, it produces a chunk of HTML somewhere between two hundred and four hundred lines long, with nested `<table>` elements, conditional discount rows, a footer with totals, and a few inline styles. You want a test that catches the moment somebody accidentally turns a `<div>` into a `<span>`, or shifts a class name, or rearranges the order of fields, or breaks the way the total is formatted.

You sit down to write that test. The obvious approach is to assert on substrings:

```go
if !strings.Contains(got, "<table class=\"items\">") {
    t.Error("missing items table")
}
if !strings.Contains(got, "Total: $42.00") {
    t.Error("missing total")
}
```

After ten such assertions you realize two things. First, the test is unreadable: a wall of `strings.Contains` calls communicates almost nothing about what the renderer is supposed to produce. Second, the assertions cover only the pieces you remembered to check. If somebody accidentally drops the entire footer, your test still passes because you never thought to look for `</footer>`.

The golden file pattern flips the problem. Instead of trying to enumerate what the output ought to contain, you run the function once, look at the output carefully with your own eyes, and save the result to disk. From then on, the test compares every byte. Any change anywhere fails the test, and you either accept the new output (because the change was intentional) or you fix the bug (because the change was not).

This document teaches the basic mechanics. Later pages add table-driven cases, normalization for non-deterministic data, helper libraries, and the discipline required to keep a golden suite healthy across years of development.

## The `testdata/` directory

Go has exactly one directory name that the build system ignores by default: `testdata`. Anywhere it appears under a Go module, the toolchain skips it for compilation, `go vet`, package list expansion, and most other automatic operations. This means you can put broken Go files, weird binary blobs, or five megabytes of HTML inside, and nothing in your build pipeline will trip over them.

A typical layout looks like this:

```
mypackage/
  render.go
  render_test.go
  testdata/
    invoice_basic.golden
    invoice_discounted.golden
    fixtures/
      input_basic.json
      input_discounted.json
```

Inside the test code you read these files with `os.ReadFile`. There is nothing magic about the `.golden` extension. It is just a convention so that humans and editors can recognize the file type at a glance. Some projects use `.txt`, `.html`, or `.json` instead. The shared idea is: a file with the suffix `.golden` is a snapshot of expected output that should not be edited by hand. If you find yourself reaching for the editor to fix a golden, stop. You are probably about to commit a wrong baseline.

The `testdata/` exclusion is a feature of the Go toolchain that has existed since the very early days. The documentation for `cmd/go` mentions it explicitly: directories named `testdata` are ignored. You can rely on it.

## A minimal first test

Suppose you have:

```go
// render.go
package render

import "fmt"

func Greet(name string) string {
    return fmt.Sprintf("Hello, %s!\n", name)
}
```

Here is a golden test for it:

```go
// render_test.go
package render

import (
    "bytes"
    "flag"
    "os"
    "path/filepath"
    "testing"
)

var update = flag.Bool("update", false, "rewrite testdata/*.golden")

func TestGreet(t *testing.T) {
    got := []byte(Greet("World"))
    path := filepath.Join("testdata", "TestGreet.golden")

    if *update {
        if err := os.MkdirAll("testdata", 0o755); err != nil {
            t.Fatal(err)
        }
        if err := os.WriteFile(path, got, 0o644); err != nil {
            t.Fatal(err)
        }
        return
    }

    want, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("read golden: %v (run with -update to create)", err)
    }
    if !bytes.Equal(got, want) {
        t.Fatalf("golden mismatch\nwant: %q\ngot:  %q", want, got)
    }
}
```

Five things to notice.

1. `flag.Bool("update", ...)` is declared at package scope, not inside the test. The Go test runner parses flags before any test function runs. Declaring the flag inside a function body would mean it does not exist at parse time, and the command line argument would error out.
2. The first time you run `go test`, this fails because `testdata/TestGreet.golden` does not exist. The test message tells you what to do.
3. You run `go test -update` once. That creates the file under `testdata/`.
4. You inspect the file with your editor or `cat` to confirm it contains exactly what you intended. This is the most important step. If you skip it, the test ceases to be a test — it just enshrines whatever the SUT happened to produce, bugs and all.
5. From now on, `go test` (no flag) compares byte-for-byte. If `Greet` changes its output for any reason, the test fails.

## The `-update` flag idiom

The flag is so common in Go codebases that it has become a cultural convention. Almost every project that uses golden files declares some variant of:

```go
var update = flag.Bool("update", false, "update golden files")
```

When the flag is true, the test writes; when false, the test reads and compares. There is no third mode. There is no "update if missing, compare if present" mode — that would let bugs become baselines silently on first run. The decision to regenerate must be explicit, deliberate, and human-driven.

Importantly: the flag must default to false. This guarantees that a developer running `go test` on a freshly cloned repository never accidentally rewrites the snapshots. If you ever feel tempted to flip the default to true "for convenience", you are about to destroy the value of every golden file in the project.

A common beginner mistake is to call `flag.Parse()` inside a test function:

```go
func TestSomething(t *testing.T) {
    flag.Parse() // do not do this
    // ...
}
```

Do not. The Go test framework already calls `flag.Parse()` exactly once before invoking any test function. Adding a second call can produce confusing errors when the same flag appears twice on the command line, or when multiple subtests each try to re-parse the arguments. The right place to declare the flag is package scope; the right place to consume it is `*update` inside your helper.

## Why we save bytes, not values

You might ask: why bring the filesystem into a unit test at all? Why not just compare two Go values directly?

The first answer is that the value we care about is the byte sequence the user or downstream system will see. A renderer that produces `"Hello, World!\n"` and a renderer that produces `"Hello, World!"` (no trailing newline) are different in terms of bytes, even though both look identical if you skim them. A test on the byte sequence catches the missing newline; a test on a parsed structure might not.

The second answer is that writing the expected output as a Go string literal becomes unreadable past a handful of lines. A 300-line HTML literal with escaped backticks and backslashes is impossible to review. The diffs are unreadable. The git blame is meaningless because every editing change rewrites every line. A file on disk, opened in your editor, formatted by your tools, is trivially reviewable. Your code review tooling treats it as text. Your editor highlights it as HTML or JSON. Your `diff` produces meaningful hunks.

The third answer is psychological. When the expected output lives in a separate file, you naturally treat it as data, not as code. You inspect it, you diff it, you tag it. When the expected output lives inline as a string literal, you read it as code and gloss over the literal payload. Goldens force you to look at the bytes.

## Anatomy of a failure

When the test fails, the message must be helpful. The minimal version above prints `want: ... got: ...`. For short outputs this is fine. For long ones it is unreadable — a single quoted blob of 5,000 characters tells a reviewer nothing about what changed.

The next level of polish (covered in the middle page) uses `github.com/google/go-cmp/cmp.Diff` to produce a unified diff with line markers. For now, focus on the mechanics.

If the failure looks like:

```
golden_test.go:25: read golden: open testdata/TestGreet.golden: no such file or directory (run with -update to create)
```

…you simply have not created the golden yet. Run `go test -update` once, inspect the file, and rerun without the flag.

If the failure looks like:

```
golden_test.go:31: golden mismatch
want: "Hello, World!\n"
got:  "hello, World!\n"
```

…the SUT produced different bytes than the snapshot. Two questions follow. Did you intend to change the output? If yes, rerun with `-update` and inspect the resulting diff carefully before committing. If no, you have just caught a regression — fix the SUT.

The framework cannot decide for you. That is by design. A test that automatically accepts new outputs as correct is not a test.

## Reading the diff yourself

Until we introduce `cmp.Diff` in the middle page, the simplest way to inspect a mismatch is to write the actual output to a sibling file and diff manually:

```go
if !bytes.Equal(got, want) {
    actualPath := path + ".actual"
    _ = os.WriteFile(actualPath, got, 0o644)
    t.Fatalf("golden mismatch; compare:\n  diff -u %s %s", path, actualPath)
}
```

Then in your shell:

```
diff -u testdata/TestGreet.golden testdata/TestGreet.golden.actual
```

This gives you a unified diff with context, which is far easier to read than a quoted `%q` dump.

Add `*.actual` to your project's `.gitignore` so you never accidentally commit a debugging artifact. Once you have switched to `cmp.Diff` in the middle page, you can stop writing sibling files altogether — the diff prints to stdout directly.

## When NOT to use a golden file

The pattern is not free. It introduces:

- A file on disk per test case.
- A flag to remember.
- A discipline (read the diff before committing) that the framework cannot enforce.

For small, focused assertions, plain `==` is better:

```go
got := math.Sqrt(16)
if got != 4 {
    t.Errorf("Sqrt(16) = %v, want 4", got)
}
```

You do not need a golden file for a single number. The rule of thumb is: if the assertion fits on one screen and reads naturally as a Go expression, keep it inline. If it spans more than a screen, or has nested structure, or you find yourself constructing the expected value with a helper function, a golden file probably wins.

A few common cases where goldens shine:

- **HTML or Markdown rendering.** The output is structured and long.
- **JSON or YAML serialization** of complex objects. Inline string literals would be huge.
- **Code generation.** The output is a Go file; a golden lets you eyeball formatting and imports.
- **CLI output.** The user-visible help text, error messages, and table layouts deserve byte-exact assertions.
- **Log line formatting** for stable log formats (the kind downstream tools parse).

A few cases where goldens are wrong:

- **Single-value functions** (`Sqrt(16) == 4`).
- **Highly non-deterministic outputs** that no normalizer can tame (e.g. anything involving real network latency in the bytes).
- **Outputs whose correctness is hard to inspect visually** — for example, a binary protobuf wire format. There the golden test passes but no human can tell from the diff whether a change is correct. Use a structural test instead.

## A first checklist

Before you commit a golden test, confirm:

- The `testdata/` directory exists in your package directory.
- The `update` flag is declared exactly once at package scope.
- You ran `go test -update` and inspected the resulting file with your own eyes.
- The file is in version control (`git add testdata/`).
- You ran `go test` (no flag) and it passes.
- You then changed the SUT in some small, deliberate way (e.g. added an exclamation mark) and confirmed the test fails.
- You reverted the change and confirmed the test passes again.

The last three steps are the verification of the test itself. A test that always passes is not a test; it is just a comment. Until you have watched it fail at least once, you do not know it works.

## A second example: rendering a small report

Let us extend the pattern to something a little more realistic. A function that renders a small text report:

```go
// report.go
package report

import (
    "fmt"
    "sort"
    "strings"
)

type Row struct {
    Label string
    Value int
}

func Render(title string, rows []Row) string {
    var b strings.Builder
    fmt.Fprintf(&b, "Report: %s\n", title)
    fmt.Fprintln(&b, strings.Repeat("=", 40))
    // sort by label so output is deterministic
    sorted := make([]Row, len(rows))
    copy(sorted, rows)
    sort.Slice(sorted, func(i, j int) bool { return sorted[i].Label < sorted[j].Label })
    for _, r := range sorted {
        fmt.Fprintf(&b, "%-20s %d\n", r.Label, r.Value)
    }
    return b.String()
}
```

The test:

```go
// report_test.go
package report

import (
    "bytes"
    "flag"
    "os"
    "path/filepath"
    "testing"
)

var update = flag.Bool("update", false, "rewrite testdata/*.golden")

func TestRender(t *testing.T) {
    rows := []Row{
        {Label: "users", Value: 42},
        {Label: "orders", Value: 17},
        {Label: "revenue", Value: 12345},
    }
    got := []byte(Render("Daily", rows))
    assertGolden(t, "TestRender", got)
}

func assertGolden(t *testing.T, name string, got []byte) {
    t.Helper()
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
        t.Fatalf("golden mismatch at %s\nwant: %q\ngot:  %q", path, want, got)
    }
}
```

Notice the extraction of `assertGolden`. As soon as you have two golden tests, repeating the read/write/compare logic in each becomes annoying. A helper that takes a name and the bytes is the right level of abstraction. Use `t.Helper()` so failure messages point at the caller rather than at the helper itself.

Run `go test -update`. Open `testdata/TestRender.golden`. It should contain:

```
Report: Daily
========================================
orders               17
revenue              12345
users                42
```

Spend ten seconds reading it. Does this look right? The labels are sorted alphabetically, the column is left-aligned with width 20, the header has 40 `=` characters. If anything looks wrong, do not commit. Fix the SUT first.

This habit — read the golden, do not just save it — is the difference between a useful test and a trapdoor.

## Common confusions

A few patterns trip up newcomers.

**"The test creates the golden on first run, so I never have to look at it."** No. The `-update` flag is the first run. Every other run is a comparison. If you skip inspecting the file you generated, you have skipped writing the test.

**"I will edit the golden by hand to fix the test."** Almost never the right move. If the SUT and the golden disagree, decide which one is correct. If the SUT, fix it. If the golden, rerun `-update`. Editing the golden by hand desyncs the file from what the SUT can actually produce, and the next `-update` run will silently overwrite your edits.

**"I will commit the `.golden.actual` debug files just in case."** No. Add `*.actual` to `.gitignore`. The repository should contain only the canonical goldens, not the debugging artifacts.

**"Can I share a golden between two tests?"** Technically yes, but you almost never should. Each test should own its golden. Sharing makes failure messages ambiguous: which test broke the shared file? And under `-update` two tests writing the same path race each other.

**"What if the output contains my home directory path?"** Then you have a normalization problem. The middle page covers this. For now, return the path from a function that you can stub, or replace it with a placeholder before writing to the golden.

## Try it now

Create a tiny module:

```
mkdir -p /tmp/golden-demo/render && cd /tmp/golden-demo
go mod init demo
```

Save the `Greet` function above in `render/render.go` and the test in `render/render_test.go`. Run:

```
cd render
go test          # fails: no golden
go test -update  # creates testdata/TestGreet.golden
go test          # passes
```

Open the golden file with your editor. Change `World` to `world`. Save. Run `go test`. Observe the failure. Run `go test -update`. Observe the file was rewritten to match the (still wrong) SUT — which is exactly the danger of `-update`. Restore `World` in the SUT, rerun `-update`, and confirm the golden is now back to its original content.

You have now exercised every state of a golden file test: passing, failing because of code change, failing because of stale golden, regenerating, and the trap of regenerating without thinking. The remaining pages add structure, libraries, normalization, and the social discipline required to keep this pattern healthy across a real codebase.

## A note on speed

People sometimes worry that filesystem I/O makes golden tests slow. In practice, modern filesystems serve small files from the page cache in microseconds. A package with a hundred golden assertions adds a few milliseconds to the test run. If your suite is slow, the bottleneck is almost certainly elsewhere — usually the SUT itself. Measure before you optimize.

If you ever do find filesystem cost dominating (very rare), the optimize page shows how `go:embed` collapses the test binary into a single executable with the goldens baked in, eliminating syscalls entirely at the cost of losing in-place `-update`.

## Wrap-up

A golden file is just bytes on disk. The `-update` flag is just a boolean. The test code is twenty lines. Yet this small pattern, applied with care, replaces hundreds of brittle string assertions in real production code. Learn the mechanics here, then in the middle page learn how to scale them across many test cases, normalize away noise that is not part of the SUT's actual behavior, produce readable diffs, and choose between hand-rolled helpers and dedicated libraries like `sebdah/goldie` or `hexops/autogold`.

The mechanics are easy. The discipline is hard. The discipline is what makes the difference between a test suite that catches real regressions and one that simply records the latest output, bugs included.

## A deeper look at the helper

Before moving on, let us look closely at the helper from the report example. It is twenty lines that will appear, with small variations, in every Go project you ever touch that uses goldens. Understanding each line matters.

```go
func assertGolden(t *testing.T, name string, got []byte) {
    t.Helper()
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
        t.Fatalf("golden mismatch at %s\nwant: %q\ngot:  %q", path, want, got)
    }
}
```

Line by line:

`t.Helper()` — tells the test framework that this function is a helper. When `t.Fatalf` is called, the failure message will report the line in the caller (where `assertGolden` was invoked) rather than the line inside this function. Without `t.Helper()`, every failure points at the `t.Fatalf` line inside the helper, which is useless for debugging because that line is the same for every failing test.

`filepath.Join("testdata", name+".golden")` — builds the path in an OS-portable way. On Windows the separator is `\`; on Unix it is `/`. `filepath.Join` chooses correctly. This matters when contributors run tests on different platforms.

`if *update` — dereferences the package-level flag pointer. `update` is a `*bool`, so `*update` is the actual bool value.

`os.MkdirAll(filepath.Dir(path), 0o755)` — ensures the directory exists. The first time you add goldens to a new package, `testdata/` might not exist; without this line, `os.WriteFile` would fail. `0o755` is the standard "rwxr-xr-x" mode for directories.

`os.WriteFile(path, got, 0o644)` — writes the bytes. `0o644` is "rw-r--r--", standard for regular files. Do not use `0o444` (read-only) — that would make subsequent `-update` runs fail with permission errors. Read-only files do not protect against bad updates; only review does.

`os.ReadFile(path)` — reads the entire file into memory. For golden files (small, on the order of kilobytes to a few megabytes) this is fine. If you ever found yourself goldening a 100 MB file, you would have other problems.

`bytes.Equal(got, want)` — byte-for-byte equality. This is the only comparison that matters for output assertions. Do not be tempted to "smart compare" — parse-then-compare, ignore-whitespace, case-insensitive. Each of those changes makes the test less faithful to the SUT's actual behavior.

`t.Fatalf(...)` — fails the test and stops further execution within the test. `t.Errorf` would log the error and continue, which is wrong here: if the golden does not match, there is nothing more to check.

This helper, slightly elaborated for diff output, lives in dozens of major Go projects. You will see it in `kubectl`, in `terraform`, in `gofmt`, in `buf`. It is the canonical pattern.

## A note about working directories

`go test` runs each package's tests with the working directory set to the package directory. This is how `filepath.Join("testdata", ...)` works without further configuration — the relative path resolves from where the test code lives, not from wherever you invoked `go test`.

If you ever need to find the package directory explicitly (for example, to copy a golden into a different location), use `runtime.Caller`:

```go
_, thisFile, _, _ := runtime.Caller(0)
pkgDir := filepath.Dir(thisFile)
```

But you rarely need this. The default working directory behavior is enough for almost every golden test.

## Goldens and source control

A `.golden` file is source. Commit it. Review changes to it. Treat it the same way you treat a `.go` file. The single largest source of golden-file bugs in production codebases is committing a regenerated golden without reading the diff.

A good PR diff for a golden change reads like a real piece of evidence: "I changed the renderer to add a footer; the golden now contains that footer." A bad PR diff reads "regenerated goldens" with no explanation, and 800 lines of unreviewable changes.

Add a hard rule to your team: any PR that modifies a `.golden` file must explain why in the description, and a reviewer must open the diff and read it. The framework cannot enforce this. The team must.

## Goldens and editors

Most editors handle text files well, but a few quirks bite golden tests.

**Trailing newlines.** Many editors add a final newline when saving a file. The SUT may not emit one. The result: the saved golden has one more byte than the SUT produces, and the test fails. Solutions: configure your editor to leave files alone (`vim`: `set nofixeol`; VS Code: `"files.insertFinalNewline": false`), or have your SUT consistently emit a trailing newline, or strip trailing whitespace in the helper.

**CRLF line endings.** On Windows, editors may save with `\r\n`. The SUT, running on Linux, emits `\n`. Comparison fails. Solutions: add `.gitattributes` to normalize:

```
testdata/*.golden text eol=lf
```

…or normalize line endings in the helper:

```go
got = bytes.ReplaceAll(got, []byte("\r\n"), []byte("\n"))
```

**Binary files saved as text.** Some editors helpfully "fix" non-UTF-8 bytes when saving. If your golden is binary (a PNG, a protobuf wire message), use an extension your editor will not auto-modify (`.png`, `.pb`), and avoid opening it for editing at all.

## Goldens in CI

In continuous integration, run tests without `-update`. A diff in any golden file should fail the build. This is the entire point: CI must catch regressions, not paper over them.

A common CI setup:

```yaml
- name: Run tests
  run: go test ./...
```

That is enough. Do not add a "regenerate goldens" step. Do not add a fallback. If a golden diff fails CI, the response is to look at the diff, decide if it is intentional, and either fix the SUT or commit a deliberate update locally.

Some teams add a `make golden` target that runs `go test ./... -update`. Developers run it locally when they intentionally change output. They inspect the diff. They commit. That is the workflow.

## A short FAQ

**Should I gzip my goldens to save space?** No. Disk space is cheap; review readability is expensive. Gzipped goldens cannot be reviewed in PRs.

**Should I delete old goldens?** Yes, when the corresponding test is deleted. A stale golden adds clutter and confusion. If you remove a `TestX`, also remove `testdata/TestX.golden`.

**What if a single test produces multiple outputs?** Save each to its own golden. For example, a test of a CLI command might golden both stdout and stderr:

```go
assertGolden(t, "TestCmd_stdout", out)
assertGolden(t, "TestCmd_stderr", errOut)
```

**Should I use one big golden or many small ones?** Many small ones. Small goldens are easier to review, easier to update individually, and produce more readable diffs.

**Can a golden contain a regex or wildcard?** Not with `bytes.Equal`. If you need wildcards (e.g. to ignore a timestamp), use a normalizer — covered on the middle page.

**Can I use this pattern outside of Go?** Yes. Snapshot testing in Jest, RSpec snapshots, pytest's `pytest-snapshot`, all variants of the same idea. The hazards are identical across languages.

## Wrap-up, for real this time

You now know the mechanics of golden file testing in Go:

- `testdata/` is the directory; Go ignores it for builds.
- The `-update` flag is the canonical idiom; declare it once at package scope.
- The helper reads, compares, or writes — branching on the flag.
- Always inspect a golden after generating it. Always.
- Commit the goldens to source control. Treat them as code.

In the middle page you will scale this pattern to many test cases via table-driven tests, introduce normalization for non-deterministic outputs, replace the rough diff output with `cmp.Diff`, and meet the helper libraries `sebdah/goldie` and `hexops/autogold` that codify these conventions for you.

## Extended walkthrough: rendering a more realistic file

Let us trace through one more example, this time with enough output that the value of golden testing becomes obvious. Consider a small Markdown generator:

```go
// markdown.go
package markdown

import (
    "fmt"
    "strings"
)

type Section struct {
    Title string
    Lines []string
}

type Document struct {
    Title    string
    Sections []Section
}

func Render(d Document) string {
    var b strings.Builder
    fmt.Fprintf(&b, "# %s\n\n", d.Title)
    for i, s := range d.Sections {
        fmt.Fprintf(&b, "## %d. %s\n\n", i+1, s.Title)
        for _, line := range s.Lines {
            fmt.Fprintf(&b, "%s\n", line)
        }
        fmt.Fprintln(&b)
    }
    return b.String()
}
```

The test:

```go
// markdown_test.go
package markdown

import (
    "bytes"
    "flag"
    "os"
    "path/filepath"
    "testing"
)

var update = flag.Bool("update", false, "rewrite testdata/*.golden")

func TestRender(t *testing.T) {
    doc := Document{
        Title: "Weekly Status",
        Sections: []Section{
            {
                Title: "Achievements",
                Lines: []string{
                    "- Shipped the new search bar",
                    "- Reduced index size by 12%",
                    "- Onboarded two new contributors",
                },
            },
            {
                Title: "Risks",
                Lines: []string{
                    "- Build pipeline flaky on macOS runners",
                    "- Backlog growing in P2 issues",
                },
            },
            {
                Title: "Next week",
                Lines: []string{
                    "- Stabilize macOS pipeline",
                    "- Triage backlog",
                    "- Plan Q3 OKRs",
                },
            },
        },
    }
    got := []byte(Render(doc))
    assertGolden(t, "TestRender", got)
}

func assertGolden(t *testing.T, name string, got []byte) {
    t.Helper()
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
        t.Fatalf("golden mismatch at %s\nwant length %d, got length %d", path, len(want), len(got))
    }
}
```

Run `go test -update`. The resulting file `testdata/TestRender.golden`:

```
# Weekly Status

## 1. Achievements

- Shipped the new search bar
- Reduced index size by 12%
- Onboarded two new contributors

## 2. Risks

- Build pipeline flaky on macOS runners
- Backlog growing in P2 issues

## 3. Next week

- Stabilize macOS pipeline
- Triage backlog
- Plan Q3 OKRs

```

Open this in your Markdown previewer. It renders. The structure is sensible. The blank lines between sections are intentional. The leading `#` and `##` are correct levels. Spend a minute confirming this is what you want the function to produce. Then commit.

Now imagine somebody refactors `Render` and accidentally drops the blank line between sections. The next CI run fails with a diff that points to the missing newlines. The test caught a behavior change that no `strings.Contains` chain would have caught.

## Goldens for log output

A common production use case: log line formatting. Suppose you have a structured logger that emits lines like:

```
2026-05-20T10:00:00Z INFO  user_created user_id=42 email=alice@example.com
```

You want a test that asserts the format. Without goldens you would write:

```go
got := captureLog(func() { Log.Info("user_created", "user_id", 42, "email", "alice@example.com") })
if !strings.Contains(got, "INFO  user_created") { ... }
if !strings.Contains(got, "user_id=42") { ... }
if !strings.Contains(got, "email=alice@example.com") { ... }
```

Three assertions, and you have still missed the timestamp format, the spacing, the field ordering, the level alignment. With a golden:

```go
got := captureLog(func() {
    Log.Info("user_created", "user_id", 42, "email", "alice@example.com")
})
assertGolden(t, "TestLog_userCreated", got)
```

One line. Of course you have to normalize the timestamp — that is the middle page. But the pattern itself is dramatically clearer.

## A first taste of normalization

You may already be wondering: what if the SUT calls `time.Now()`? Then the output changes every run, the golden test fails on the second run, and the pattern collapses.

The clean fix is to inject the clock. Take a `func() time.Time` parameter and pass a fixed value in tests:

```go
func Render(d Document, now func() time.Time) string {
    var b strings.Builder
    fmt.Fprintf(&b, "Generated at: %s\n", now().Format(time.RFC3339))
    // ...
}

// in tests:
fixedTime := func() time.Time { return time.Date(2026, 5, 20, 10, 0, 0, 0, time.UTC) }
got := Render(doc, fixedTime)
```

Now the SUT is deterministic and the golden is stable.

The less clean fix, when you cannot change the SUT, is to normalize the output before comparison:

```go
var timestampRE = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`)
got = timestampRE.ReplaceAll(got, []byte("<TIMESTAMP>"))
```

The golden file then contains `<TIMESTAMP>` where the date would be. The downside: the golden no longer represents real output. You are testing a redacted version. The middle page explains the trade-offs.

For now, prefer injection over normalization. It tests real behavior. If you find yourself reaching for regex normalizers as the default, your SUT has a determinism problem that should be fixed at the source.

## Goldens versus property-based tests

Two test patterns sometimes get confused.

A **golden file test** asserts: "for this fixed input, the output is exactly these bytes."

A **property-based test** asserts: "for any input, the output satisfies this property."

They are complementary. A golden test pins specific outputs to specific inputs and catches any deviation. A property test verifies general invariants like "encoding then decoding returns the original value". Use both where they fit.

For a renderer: use goldens for representative inputs (small, medium, edge case), and use property tests for invariants like "rendering an empty document produces a valid Markdown header".

For a parser: use property tests on round-trip invariants, and use goldens only for specific malformed inputs whose exact error message you care about.

## How big should a golden be?

There is no hard limit, but practical ranges:

- **Under 100 lines.** Easy to review. Use freely.
- **100 to 500 lines.** Reviewable with effort. Acceptable for renderers.
- **500 to 5,000 lines.** Borderline. Split into smaller fixtures if you can.
- **Over 5,000 lines.** Almost certainly the wrong abstraction. Decompose the SUT and test parts.

The point of a golden is that a human can compare two versions of it. When the diff exceeds what a reviewer can hold in their head, the test stops protecting you and starts hiding bugs.

## Goldens and refactoring

A well-maintained golden suite is a refactoring aid. When you refactor internal structure but want to preserve external behavior, the goldens lock down the behavior. Any byte that changes in the output is a place where your refactor altered observable behavior, intentionally or not.

This is why teams that own complex renderers, code generators, and serializers swear by goldens: they make "behavior-preserving refactor" a verifiable claim rather than a hope.

Conversely, when you do want to change behavior, the failing goldens are a checklist of every output that needs review. You see exactly what changed; you decide for each whether it is intentional; you regenerate deliberately.

## Common patterns you will encounter

As you read other people's Go code, you will see variations on the basic helper. Some examples:

```go
// some projects pass the bytes pre-normalized
g.AssertGolden(t, "name.golden", normalize(got))

// some projects accept any io.Reader
g.AssertGoldenReader(t, "name.golden", strings.NewReader(got))

// some projects support per-suffix golden files
g.AssertGoldenJSON(t, "name", value)  // marshals first, then compares
g.AssertGoldenXML(t, "name", value)
```

These are all sugar over the same idea: capture bytes, compare to a file, gate on `-update`. Once you understand the core, the variations are obvious.

## What to read next

The middle page covers:

- Table-driven goldens with `t.Run` per case.
- Normalization: timestamps, UUIDs, version strings, paths.
- Readable diffs with `cmp.Diff`.
- The `sebdah/goldie` and `hexops/autogold` libraries.
- When to use a shared fixture versus per-test goldens.
- Goldens for JSON, HTML, and code generation outputs.

Before moving on, make sure you have run the examples here yourself. Type out the helper at least once from memory. Watch a test fail; watch it pass. The pattern is small enough to fit in your head, and once it is there, you will reach for it for the rest of your career.

## Walking through every error message

A golden file test produces a few distinct error messages, each with a recommended response. Learning the shapes of these messages saves time.

**Missing golden:**

```
read golden testdata/TestX.golden: open testdata/TestX.golden: no such file or directory (run -update)
```

You have not created the file yet. Run with `-update`, inspect, commit.

**Mismatch:**

```
golden mismatch at testdata/TestX.golden
want length 312, got length 318
```

Some bytes differ. Either fix the SUT or rerun `-update`. Always inspect.

**Permission denied:**

```
write testdata/TestX.golden: permission denied
```

Either the file is read-only (someone wrote it with `0o444`) or your test process lacks write permission on the directory. Fix the permissions; never write goldens as read-only.

**Directory missing:**

```
write testdata/sub/TestX.golden: open testdata/sub/TestX.golden: no such file or directory
```

You forgot `os.MkdirAll(filepath.Dir(path), 0o755)` in the helper. Add it.

**Stale path after rename:**

```
golden mismatch at testdata/TestOldName.golden
```

You renamed the test function but not the golden file. Either rename the file or rerun `-update` to create the new path and delete the old one.

Knowing these messages by sight makes you faster at responding to failures.

## One more example: error message goldens

Public error messages are part of your library's API. Users read them, log them, write tooling around them. Golden-testing them prevents accidental rewording.

```go
// validator.go
package validator

import (
    "errors"
    "fmt"
)

type FieldError struct {
    Field   string
    Reason  string
    Got     any
}

func (e *FieldError) Error() string {
    return fmt.Sprintf("validation failed: field %q: %s (got %v)", e.Field, e.Reason, e.Got)
}

func Validate(name string, age int) error {
    if name == "" {
        return &FieldError{Field: "name", Reason: "must not be empty", Got: name}
    }
    if age < 0 {
        return &FieldError{Field: "age", Reason: "must be non-negative", Got: age}
    }
    if age > 150 {
        return &FieldError{Field: "age", Reason: "must be plausible (<= 150)", Got: age}
    }
    return nil
}

var ErrEmpty = errors.New("input was empty")
```

Test:

```go
func TestValidate_errors(t *testing.T) {
    cases := []struct {
        name string
        in   struct{ Name string; Age int }
    }{
        {"empty_name", struct{ Name string; Age int }{"", 30}},
        {"negative_age", struct{ Name string; Age int }{"bob", -5}},
        {"absurd_age", struct{ Name string; Age int }{"bob", 999}},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            err := Validate(tc.in.Name, tc.in.Age)
            if err == nil {
                t.Fatal("expected error")
            }
            assertGolden(t, "TestValidate_errors_"+tc.name, []byte(err.Error()))
        })
    }
}
```

After `-update`, three goldens exist:

```
testdata/TestValidate_errors_empty_name.golden:
validation failed: field "name": must not be empty (got )

testdata/TestValidate_errors_negative_age.golden:
validation failed: field "age": must be non-negative (got -5)

testdata/TestValidate_errors_absurd_age.golden:
validation failed: field "age": must be plausible (<= 150) (got 999)
```

A reviewer can read these and ask: is the wording good? Are the field names right? Is the format consistent? This is exactly the kind of review that simple unit tests do not invite.

If somebody later changes "must not be empty" to "is required", the test fails until the new wording is reviewed. That is the design.

## A subtle point about pointers and equality

The helper uses `bytes.Equal` because we are comparing slices of bytes. We are not comparing strings, even though the underlying data may be text. Why?

Bytes are exact. Two byte slices are equal if and only if they have the same length and the same byte at every index. There is no Unicode normalization, no case folding, no whitespace tolerance. This is what you want for output assertions: faithful representation of what the SUT produced.

If you converted to strings and used `==`, the comparison is identical in semantics (Go strings are byte sequences). The choice between `bytes.Equal(got, want)` and `string(got) == string(want)` is stylistic. The former avoids an allocation; the latter is fractionally clearer. Either is fine.

What you must not do is "normalize" the comparison by trimming, lowercasing, or parsing-and-re-comparing. Each of those weakens the test in ways that hide bugs.

## A note on test-only packages

The flag and helper above live in the same package as the SUT. That is the simplest layout. If you want to keep the helper out of the production package (so it does not affect `go test -coverpkg` or similar), put it in a sibling file with a `_test.go` suffix:

```
mypackage/
  render.go
  render_test.go        // tests
  golden_helpers_test.go // helper, also _test.go
  testdata/
```

Both `_test.go` files are part of the test binary but not part of the production package. This is the conventional Go layout for test-only code.

For a helper shared across multiple packages, create an internal test package:

```
internal/testutil/golden/golden.go
```

…and call it from each package's test code. Keep the helper small; it should be twenty lines, not two hundred.

## Goldens and code coverage

Coverage tools measure which lines of the SUT executed. A golden test executes the SUT once and inspects its output. The coverage contribution is the same as any other test calling the same function. The fact that the assertion is bytes-on-disk does not change coverage at all.

So: goldens contribute to coverage in the normal way, as long as you actually call the SUT. Do not be tempted to "cover" code by adding a golden test that does not exercise the relevant branches. Coverage measures execution, not assertion quality.

## When the SUT is slow

If running the SUT once to produce output takes a noticeable amount of time (more than a few hundred milliseconds), the golden test will inherit that cost. The fix is not in the test framework; it is in the SUT. Profile it, optimize the hot path, and the goldens will speed up automatically.

If you have to keep the slow SUT and the slow goldens, mark the test as long-running:

```go
func TestRender_long(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping long golden test")
    }
    // ... 5-second render
}
```

Then run with `go test -short` for fast iteration and `go test` for full coverage in CI.

## Goldens and panic recovery

If the SUT panics during a test, the helper never runs, the golden is not compared, and the test fails with a panic message. This is usually what you want. If you do want to capture panic output and golden-test it, wrap the call:

```go
func mustNotPanic(t *testing.T, fn func()) (panicked any) {
    t.Helper()
    defer func() { panicked = recover() }()
    fn()
    return
}
```

Then golden-test `fmt.Sprintf("%v", panicked)`. This is a rare pattern; most tests should not need it.

## Putting it all in your fingers

The golden pattern is small enough to memorize:

```go
var update = flag.Bool("update", false, "rewrite goldens")

func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    path := filepath.Join("testdata", t.Name()+".golden")
    if *update {
        os.MkdirAll(filepath.Dir(path), 0o755)
        if err := os.WriteFile(path, got, 0o644); err != nil { t.Fatal(err) }
        return
    }
    want, err := os.ReadFile(path)
    if err != nil { t.Fatalf("read golden: %v (run -update)", err) }
    if !bytes.Equal(got, want) { t.Fatalf("golden mismatch %s", path) }
}
```

That is the entire framework. Twelve lines. Type it from memory a few times. The next page elaborates each piece — better diffs, more cases, normalization, libraries — but the core never gets bigger than this.

## Final reminders

- Always inspect a golden after `-update`.
- Always commit goldens to source control.
- Never run `-update` and merge without reading the diff.
- Never set the flag's default to true.
- Never use `flag.Parse()` inside a test function.
- Always use `t.Helper()` in the assertion helper.
- Always use `0o644` for goldens, never `0o444`.
- Always use `filepath.Join`, never literal `/`.
- Always sort map iterations before serializing to a golden.
- Always inject clocks and random sources rather than masking them.

These habits, accumulated, are what separate a useful golden suite from one that locks in regressions. The framework is trivial. The discipline is the work.

## Recap exercise

Before you close this page, do the following. It will take fifteen minutes and cement everything above.

1. Create a fresh module `golden-recap` with one package.
2. Write a function `Bullet(items []string) string` that returns Markdown bullet list:
   ```
   - first
   - second
   - third
   ```
3. Write a golden test for three cases: empty list, one item, three items.
4. Use `t.Run` for each case.
5. Run `go test -update`. Inspect the three goldens. Confirm they are correct.
6. Run `go test`. Confirm it passes.
7. Change the function to use `*` instead of `-` as the bullet character.
8. Run `go test`. Observe all three subtests fail with goldens that no longer match.
9. Decide: was this an intentional change? If yes, rerun `-update` and inspect each diff before committing. If no (you accidentally changed it), revert.

This exercise gives you the muscle memory of every state a golden suite can be in: empty, populated, matching, mismatching, regenerated. After this, the pattern is yours.

## A final thought on trust

The reason golden testing works is that you, the developer, looked at the output once and said "yes, this is correct." Every comparison after that derives its trust from that one human inspection. If you skip the inspection, the test inherits no trust. It becomes a placeholder, a syntactic guard, a thing that runs without saying anything.

The framework cannot make you inspect. Your team cannot make you inspect (though peer review helps). Only you, when you generate the golden and look at it, give the test its meaning.

So look. Every time. Even when the output is "obviously" correct. Especially when you are tired. The five seconds it takes to read a golden are the most valuable five seconds in the whole testing pyramid, because they are the only moments at which a human guarantees that what the machine will compare against is right.

Once you have built that habit, the rest of golden file testing — the flag, the helper, the diff, the libraries — falls into place easily. You can move on to the middle page knowing the most important thing: the goldens you commit are the ones you have actually read.

## Quick reference card

A laminated-card summary you can keep next to your editor:

```
Setup
-----
testdata/                      # Go ignores this directory for build
var update = flag.Bool("update", false, "rewrite goldens")

Helper
------
func assertGolden(t, got)
  path = testdata/{t.Name()}.golden
  if *update: MkdirAll, WriteFile(0o644), return
  want = ReadFile(path)
  fail if !bytes.Equal

Commands
--------
go test                 # compare mode (default)
go test -update         # regenerate (inspect diff before commit)
go test -run TestX      # run one test, useful with -update

Rules
-----
1. Always inspect goldens after -update.
2. Never set update default to true.
3. Never run -update and commit without reading the diff.
4. Always 0o644 for goldens.
5. Always t.Helper() in the assertion helper.
```

Print it. Pin it. Live by it.

## Beyond the basics: a preview of what comes next

You may already be feeling the limits of the minimal helper. A few questions probably nag:

- "What if I have twenty test cases? Do I really need twenty `t.Run` blocks?"
- "What if my output contains a timestamp that changes every second?"
- "What if I want a colored diff in the terminal?"
- "What if my output is JSON and a single key reorder fails the test even though the data is the same?"
- "What if two tests need to share part of a golden, like a common header?"
- "What if I need to test multiple versions of my output format simultaneously?"

Each of these has a clean solution. The middle page introduces table-driven goldens (a single `t.Run` loop generates many goldens), normalization (regex passes that scrub non-deterministic content before comparison), `cmp.Diff` for pretty failure messages, the `sebdah/goldie` library which packages many conveniences, and the `hexops/autogold` alternative which keeps expectations inline in Go source.

The senior page covers organizational concerns: versioned goldens for backward-compatibility, code-generation tests, and the review processes that keep a golden suite healthy. The professional page covers cultural ones: how to introduce goldens to a team, how to enforce review discipline in CI, and how to recognize when goldens have degraded into noise.

But none of those pages will make sense until the basic mechanics here are second nature. Run the examples. Type the helper. Watch tests pass and fail. Build the intuition.

## Closing example: a tiny CLI

To leave you with something that fits a real workflow, here is a tiny CLI tool whose entire test surface is golden-driven.

```go
// cmd/sum/main.go
package main

import (
    "fmt"
    "io"
    "os"
    "strconv"
    "strings"
)

func run(args []string, out io.Writer) int {
    if len(args) == 0 {
        fmt.Fprintln(out, "usage: sum N [N...]")
        return 1
    }
    total := 0
    for _, a := range args {
        n, err := strconv.Atoi(a)
        if err != nil {
            fmt.Fprintf(out, "error: not a number: %s\n", a)
            return 2
        }
        total += n
    }
    fmt.Fprintf(out, "sum = %d (of %s)\n", total, strings.Join(args, ", "))
    return 0
}

func main() {
    os.Exit(run(os.Args[1:], os.Stdout))
}
```

```go
// cmd/sum/main_test.go
package main

import (
    "bytes"
    "flag"
    "os"
    "path/filepath"
    "testing"
)

var update = flag.Bool("update", false, "rewrite goldens")

func TestRun(t *testing.T) {
    cases := []struct {
        name string
        args []string
        code int
    }{
        {"no_args", nil, 1},
        {"one_arg", []string{"5"}, 0},
        {"three_args", []string{"1", "2", "3"}, 0},
        {"bad_arg", []string{"x"}, 2},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            buf := new(bytes.Buffer)
            code := run(tc.args, buf)
            if code != tc.code {
                t.Errorf("exit code: want %d, got %d", tc.code, code)
            }
            assertGolden(t, buf.Bytes())
        })
    }
}

func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    name := t.Name()
    // replace slashes for nested subtest paths
    for i := 0; i < len(name); i++ {
        if name[i] == '/' {
            name = name[:i] + "_" + name[i+1:]
        }
    }
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
        t.Fatalf("golden mismatch at %s\nwant: %q\ngot:  %q", path, want, got)
    }
}
```

After `-update` you have four files:

```
testdata/TestRun_no_args.golden
testdata/TestRun_one_arg.golden
testdata/TestRun_three_args.golden
testdata/TestRun_bad_arg.golden
```

Each contains the exact stdout for that case. A reviewer can read all four in under a minute and tell you whether the CLI's user-facing output is acceptable. The test catches any change to message wording, any change to formatting, any change to exit codes. With twenty lines of test code you have anchored the entire user-visible behavior of the tool.

This is the power of golden file testing. Used well, it lets a small amount of code lock down a large amount of behavior. Used badly, it lets bugs become baselines. The difference is discipline, and discipline starts with the habits you build here.

[← Back](../)
