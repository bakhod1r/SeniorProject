---
layout: default
title: Table-Driven Tests — Interview
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/interview/
---

# Table-Driven Tests — Interview

[← Back](../)

A bank of 28 questions you can expect in a Go-focused interview. Each question is followed by what a strong answer should cover.

---

## Q1. What is a table-driven test?

A test pattern in which inputs and expected outputs are organized as rows of a slice (or map) of structs, and a single loop runs the same assertion logic against every row. The loop typically wraps each row in `t.Run(tc.name, ...)` so each row appears as a separately reported subtest.

A strong answer also covers: why Go prefers this idiom over BDD-style `describe`/`it` frameworks; how `t.Run` was added in Go 1.7 to make subtests first-class.

---

## Q2. Why does Go favor table-driven tests over RSpec/Jest-style `describe`/`it`?

Three reasons:

1. The Go authors chose a minimal `testing` package by design. No DSL, no fluent assertions — just `t.Errorf` and `t.Fatalf`.
2. Table-driven tests stay in plain Go — they compose with `t.Run`, parallelism, fuzz seeds, benchmarks, and `-run` filtering without extra syntax.
3. They make every case visible on one screen, easier to scan than nested `describe` blocks.

A strong answer mentions that `testing` is in the standard library and adding a BDD layer means adopting a third-party framework, which Go culture resists.

---

## Q3. Walk me through the canonical table-driven pattern.

```go
func TestParseInt(t *testing.T) {
    cases := []struct {
        name    string
        input   string
        want    int
        wantErr bool
    }{
        {"positive", "42", 42, false},
        {"negative", "-7", -7, false},
        {"empty", "", 0, true},
        {"junk", "abc", 0, true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := ParseInt(tc.input)
            if (err != nil) != tc.wantErr {
                t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
            }
            if got != tc.want {
                t.Errorf("got %d, want %d", got, tc.want)
            }
        })
    }
}
```

Strong answer also covers: why each row gets a name; why we use `t.Run` instead of just looping.

---

## Q4. What was the `tc := tc` line for, and why is it usually unnecessary in Go 1.22+?

Before Go 1.22, the loop variable `tc` was a **single variable** reused across iterations. If a subtest captured `tc` and ran later (via `t.Parallel`), by the time it actually executed, `tc` already held the last row. Shadowing with `tc := tc` created a per-iteration copy.

Go 1.22 changed `for` loop scoping so the loop variable is **per-iteration** in modules declaring `go 1.22`. The shadow is now redundant but harmless.

Strong answer also cites issue [#60078](https://github.com/golang/go/issues/60078) and notes that `copyloopvar` linter flags the shadow as dead code in Go 1.22+ modules.

---

## Q5. How do you run a single case from a table on the command line?

```
go test -run TestParseInt/positive
```

The `/` separates the parent test name from the subtest name. Both are regexes, matched as **substring** by default. To anchor, use `^...$`.

```
go test -run '^TestParseInt$/^empty$'
```

---

## Q6. What characters in subtest names are rewritten?

Spaces become underscores, and non-printable runes (per `strconv.IsPrint`) become escapes. So `"empty input"` displays as `TestParseInt/empty_input`. The `-run` matcher applies the same rewrite, so both `-run TestParseInt/empty_input` and `-run "TestParseInt/empty input"` match.

---

## Q7. What happens if two rows have the same name?

Go disambiguates with a `#NN` suffix: `case#01`, `case#02`. This makes failures hard to find because the name no longer tells you which input failed. Always set unique names.

---

## Q8. Map-based table vs slice-based table — when do you use each?

- **Slice** — when order matters (sequential dependency between rows, or you want deterministic execution order in output). Most tables.
- **Map** — when you want to enforce uniqueness of names at compile/declaration time (duplicate keys are a compile-time-ish error during the literal, or you'll catch them in code review). Order becomes randomized, which is occasionally a feature (catches order-dependence bugs).

Strong answer notes that map iteration is non-deterministic in Go, which can mask flaky tests.

---

## Q9. How do you make a table-driven test parallel?

Call `t.Parallel()` at the **top of the subtest function**:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // assertions
    })
}
```

Pre-Go 1.22: also add `tc := tc` shadow before the `t.Run` call to avoid the loop-variable bug.

---

## Q10. What is the order of execution for parallel subtests?

When a subtest calls `t.Parallel`, it **pauses** until all sequential siblings of its parent have completed. Then all paused parallel subtests run together, subject to the `-parallel N` cap (default `GOMAXPROCS`). The result: sequential subtests run first, then parallel subtests run as a wave.

---

## Q11. Can a parallel subtest call `t.Setenv`?

No. `t.Setenv` will fail the test if called on a `*T` that has called `t.Parallel`. Reason: env vars are process-global, so changing them from a parallel test would race with other tests. Either remove `t.Parallel` from that row or refactor the test to use a config struct instead of an env var.

---

## Q12. How do you assert on errors in a table?

Two common patterns:

1. **Boolean wantErr** — quick, but only checks "did we get any error or not".

```go
wantErr bool
// ...
if (err != nil) != tc.wantErr { ... }
```

2. **Sentinel error with errors.Is / errors.As**:

```go
wantErr error
// ...
if !errors.Is(err, tc.wantErr) { ... }
```

The second is stronger because it asserts the **kind** of error. Strong answer also discusses `errors.As` for typed errors and `tc.wantMsgContains` for messages that include user input.

---

## Q13. What is a golden file and how do you use it in a table-driven test?

A golden file is a file checked into `testdata/` that contains the expected output for a test case. The test reads the file and compares to the actual output. Update with a `-update` flag:

```go
var update = flag.Bool("update", false, "rewrite golden files")

func TestRender(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := Render(tc.input)
            golden := filepath.Join("testdata", tc.name+".golden")
            if *update {
                os.WriteFile(golden, got, 0644)
                return
            }
            want, _ := os.ReadFile(golden)
            if !bytes.Equal(got, want) { t.Errorf(...) }
        })
    }
}
```

---

## Q14. When should you NOT use a table-driven test?

When each case needs **distinct pre/post-conditions** that don't fit a uniform shape. Example: one test needs a Postgres container, another needs a Kafka mock, another needs to fail-inject a network error mid-call. Forcing these into a table by adding `setup func() Cleanup`, `useDB bool`, etc., creates a god-row struct that is harder to read than three separate tests.

Other cases: when there are only two cases (overhead not worth it), or when the assertion logic for each case is genuinely different.

---

## Q15. What is `t.Helper`, and why do table-driven tests need it?

`t.Helper` marks a function so failure reports point at the **caller**, not the helper. Tables often factor assertions into helpers (`assertEqualJSON`, `assertResponse`). Without `t.Helper`, every failure points at the `t.Errorf` line inside the helper, hiding which row actually failed.

---

## Q16. How do you handle a per-case temp directory?

`t.TempDir` (added Go 1.15) returns a directory unique to the current `*T` and auto-deletes it on teardown. Inside a `t.Run` body it returns a per-row directory. No need for manual `os.RemoveAll` or `Cleanup`.

---

## Q17. What does `b.Run` do?

Same as `t.Run` but for benchmarks. Each sub-benchmark gets its own `b.N` calibration, run with `go test -bench .`. Useful for benchmarking the same function across multiple input shapes.

---

## Q18. How does a fuzz seed corpus relate to a table?

`f.Add(args...)` calls inside `FuzzX` play the role of rows. The seed corpus is the **deterministic** part of fuzzing — the same inputs run every time. The non-deterministic part is what `go test -fuzz=FuzzX` adds: mutated inputs. So a fuzz test is a table-driven test with an unbounded auto-generated tail.

---

## Q19. What is the `-count` flag good for in table-driven tests?

`go test -count N` reruns each test N times, ignoring the build cache. Useful for catching flaky parallel tables — run with `-count 100 -race` to surface intermittent races.

---

## Q20. How would you generate a table from a YAML file?

```go
//go:embed testdata/cases.yaml
var raw []byte

func loadCases(t *testing.T) []testCase {
    t.Helper()
    var cases []testCase
    if err := yaml.Unmarshal(raw, &cases); err != nil { t.Fatal(err) }
    return cases
}

func TestX(t *testing.T) {
    for _, tc := range loadCases(t) {
        t.Run(tc.Name, func(t *testing.T) { ... })
    }
}
```

Strong answer covers: trade-offs (separation of data from code; harder to refactor schemas; loss of compile-time type checking on rows).

---

## Q21. How do you make subtests deterministic when reading from a map?

Sort the keys first:

```go
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }
sort.Strings(keys)
for _, k := range keys {
    tc := m[k]
    t.Run(k, func(t *testing.T) { ... })
}
```

---

## Q22. What is a "matrix" test?

A test where each row is an N-way cross-product. Example: `(driver) × (isolation level) × (statement type)`. Build the cross product:

```go
for _, d := range drivers {
    for _, lvl := range levels {
        for _, q := range queries {
            t.Run(fmt.Sprintf("%s/%s/%s", d, lvl, q), ...)
        }
    }
}
```

`t.Run` calls can be nested, so an alternative is `t.Run(d, func(t) { t.Run(lvl, func(t) { t.Run(q, ...) }) })` which gives hierarchical names like `TestX/postgres/serializable/insert`.

---

## Q23. What is the cost of `t.Run` overhead?

Each `t.Run` allocates a `*T` and launches a goroutine that blocks until the subtest body returns. Empirically: ~3–10 µs per subtest on modern hardware. Negligible until you have ~10⁵ rows.

For tight benchmark loops, you sometimes hoist the loop **out** of the subtest body and pay one `b.Run` per shape, looping `b.N` times inside.

---

## Q24. How do you cancel a single row early?

`t.Fatalf` or `t.SkipNow` from inside the row body — they unwind only the current subtest's goroutine. Sibling rows continue.

`t.Fatal` in the **outer** function (outside `t.Run`) aborts the whole table, which is rarely what you want.

---

## Q25. How do you skip a subset of rows based on environment?

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        if tc.needsDocker && os.Getenv("CI_DOCKER") == "" {
            t.Skip("requires docker")
        }
        ...
    })
}
```

Strong answer notes: prefer skipping inside the subtest (you keep the row in the table, just opt out) over filtering the table itself (the case disappears from output entirely).

---

## Q26. What's wrong with `for i := range cases` and using `cases[i].x` inside a parallel subtest pre-1.22?

Nothing — `cases[i].x` is a fresh expression each time the subtest runs and reads from the slice. The loop variable capture bug only bit when you copied the **loop variable itself** (`for _, tc := range cases { ... tc ... }`). Indexing with `i` doesn't capture `i` if you read it before `t.Parallel`, but does if you read it after. The safest rule pre-1.22: always copy.

---

## Q27. How do you express "this row is expected to panic"?

Wrap in a recover helper:

```go
func didPanic(f func()) (panicked bool, v any) {
    defer func() {
        if r := recover(); r != nil {
            panicked, v = true, r
        }
    }()
    f()
    return
}

// in the subtest
got, v := didPanic(func() { tc.fn(tc.input) })
if got != tc.wantPanic { t.Errorf(...) }
```

`testing` itself does not have a built-in panic matcher.

---

## Q28. When two engineers disagree about whether to write a table or two functions, what's your decision rule?

I lean table-driven when:

- The cases share a uniform shape (`input → want`).
- There will be more cases added later (extension is one line).
- I want a single place to set up shared fixtures.

I lean separate functions when:

- The setup or teardown logic diverges meaningfully.
- The assertion logic itself is different per case.
- There are only two or three cases and one of them has unique steps.

A strong answer recognizes that "always table" and "never table" are both wrong — the choice is per-test.

---

## Q29. Walk me through using `go-cmp` in a table-driven test.

`reflect.DeepEqual` returns a bool — when it fails, you get a printout of the full structures, which is unreadable for large maps or nested structs. `cmp.Diff` from `github.com/google/go-cmp/cmp` returns a human-readable diff:

```go
import "github.com/google/go-cmp/cmp"

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        got := f(tc.in)
        if diff := cmp.Diff(tc.want, got); diff != "" {
            t.Errorf("f(%v) mismatch (-want +got):\n%s", tc.in, diff)
        }
    })
}
```

A strong answer also covers `cmpopts.IgnoreFields`, `cmpopts.EquateEmpty`, `cmpopts.SortSlices`, and approximate float comparison via `cmpopts.EquateApprox`.

---

## Q30. What is a "matrix test" and when do you use it?

A matrix test exercises every combination of two or more dimensions — e.g. `(driver) × (isolation_level) × (statement_type)`. You build it with nested `t.Run` loops:

```go
for _, d := range drivers {
    t.Run(d, func(t *testing.T) {
        for _, lvl := range levels {
            t.Run(lvl.String(), func(t *testing.T) {
                for _, q := range queries {
                    t.Run(q.name, func(t *testing.T) { ... })
                }
            })
        }
    })
}
```

Use it when behavior is supposed to be uniform across the cross-product but you want to verify nothing slips. Skip combinations with `t.Skip` when intentionally unsupported.

---

## Q31. How do you cache an expensive setup across rows but keep rows isolated?

Build the resource once in the parent `TestX` body, then clone or reset per row inside `t.Run`:

```go
func TestX(t *testing.T) {
    parser := buildParser(t) // expensive, called once
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            local := parser.Clone() // cheap
            local.Configure(tc.opts)
            ...
        })
    }
}
```

If the resource is truly immutable and thread-safe (a parsed schema, a regex), share without cloning.

---

## Q32. What happens when you call `t.Parallel` twice on the same `*T`?

The second call panics. `t.Parallel` is idempotent in intent but Go enforces single-call. This rarely comes up in practice because you only call it once at the top of a subtest.

---

## Q33. Can a table-driven benchmark and a table-driven test share the same table?

Yes, and it's a common pattern:

```go
var cases = []testCase{ {"a", ...}, {"b", ...} }

func TestX(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) { ... })
    }
}

func BenchmarkX(b *testing.B) {
    for _, tc := range cases {
        b.Run(tc.name, func(b *testing.B) {
            for i := 0; i < b.N; i++ { ... }
        })
    }
}
```

Sharing the table guarantees benchmarks cover the same shape as tests. Use a package-level `var cases = []...` rather than redeclaring.

---

## Q34. How do you write a row that's intentionally skipped on a specific platform?

```go
t.Run(tc.name, func(t *testing.T) {
    if runtime.GOOS == "windows" && tc.skipOnWindows {
        t.Skip("not supported on Windows")
    }
    ...
})
```

Alternative: put platform-specific rows in `_unix_test.go` and `_windows_test.go` using build tags.

---

## Q35. What's the trick to debugging a parallel table test that's only flaky in CI?

Steps:

1. Reproduce locally with `-race -count=100` to surface the race.
2. Add `t.Log` calls to the failing subtest body to capture state.
3. Run with `-parallel 1` — if the flake disappears, it's a parallelism bug.
4. Suspect: shared global state, captured pointers, env vars, or `time.Now` use.
5. Check whether the goroutine count is exhausting some resource (DB pool, file descriptors).

A strong answer mentions `go test -trace` to capture an execution trace for visual analysis.

---

## Q36. Why is `t.Fatal` inside a `t.Run` better than `t.Fatal` outside?

Inside `t.Run`, `t.Fatal` stops only **that subtest**. Outside, it stops the whole parent test, hiding failures in sibling rows. The pattern:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        v, err := setup(tc) // setup specific to this row
        if err != nil { t.Fatal(err) } // OK — only this row dies
        ...
    })
}
```

Versus the anti-pattern:

```go
v, err := globalSetup()
if err != nil { t.Fatal(err) } // kills everything if global setup fails

for _, tc := range cases { ... }
```

The latter is OK only when the global setup is genuinely required for any row to make sense.

---

[← Back](../)
