---
layout: default
title: Table-Driven Tests — Senior
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/senior/
---

# Table-Driven Tests — Senior

[← Back](../)

## Table of Contents

1. [Where We Pick Up](#where-we-pick-up)
2. [Designing Tables for Complex Domains](#designing-tables-for-complex-domains)
3. [The Anatomy of a Good Row Struct](#the-anatomy-of-a-good-row-struct)
4. [Nested Tables — Subtests Within Subtests](#nested-tables--subtests-within-subtests)
5. [Matrix Tests and Cross-Products](#matrix-tests-and-cross-products)
6. [Programmatic Table Generation](#programmatic-table-generation)
7. [Splitting a Table — When and How](#splitting-a-table--when-and-how)
8. [Tables for State Machines](#tables-for-state-machines)
9. [Tables for Sequence Tests](#tables-for-sequence-tests)
10. [Tables and `t.Parallel` at Scale](#tables-and-tparallel-at-scale)
11. [Property-Based vs Table-Driven](#property-based-vs-table-driven)
12. [Composing Tables Across Test Files](#composing-tables-across-test-files)
13. [Table-Driven Benchmarks](#table-driven-benchmarks)
14. [Table-Driven Fuzz Seeds](#table-driven-fuzz-seeds)
15. [BDD-style Frameworks — When and Why Not](#bdd-style-frameworks--when-and-why-not)
16. [Worked Example — Compiler Lexer Tests](#worked-example--compiler-lexer-tests)
17. [Worked Example — Distributed System State Transitions](#worked-example--distributed-system-state-transitions)
18. [Anti-Patterns at This Level](#anti-patterns-at-this-level)
19. [Decision Checklist](#decision-checklist)
20. [What to Read Next](#what-to-read-next)
21. [Self-Check](#self-check)

---

## Where We Pick Up

At this level the mechanics are routine. What changes is **judgment**: when is a table the right shape, when do you split, when do you nest, when do you generate, when do you walk away and write five separate functions?

Concretely:

- You can already write parallel, golden-file, error-matching, helper-using tables.
- You will now design tables for compilers, state machines, distributed systems, and large-domain validators.
- You will encounter tables that have grown into 1000-line monsters and decide whether to refactor or accept the cost.

---

## Designing Tables for Complex Domains

Three properties make a table-driven test **good**:

1. **Each row reads top-to-bottom in seconds.** A reviewer should be able to look at `{name, in, want}` and understand the case without scrolling to a helper function or another file.
2. **The struct shape doesn't bend to accommodate outliers.** If 19 rows need fields A, B, C and one needs A, B, C, D, E, F — that one row doesn't belong.
3. **Failures are uniquely attributable.** When `TestFoo/case_42` fails, the reader knows which row and which assertion. No combined messages, no shared mutable state.

In a simple domain (`Abs`, `ParseInt`), these properties come free. In a complex domain (a compiler frontend, an SQL planner), you have to design for them.

### Example — designing for an SQL planner

You're testing `Plan(sql string, schema Schema) (Tree, error)`. Each case has:

- Input SQL.
- Schema fixture.
- Expected tree shape (or substructure).
- Expected cost ranges.
- Optional: expected warnings.

A naive struct:

```go
type planCase struct {
    name     string
    sql      string
    schema   Schema
    wantTree string
    wantCost float64
    wantWarn []string
}
```

Pretty fast a `Schema` is 200 lines of Go literal. You don't want that inline in 50 rows. Solution: register schemas by name.

```go
type planCase struct {
    name       string
    sql        string
    schemaName string   // looked up in schemaRegistry
    wantTree   string
    wantCost   float64
    wantWarn   []string
}

var schemaRegistry = map[string]Schema{
    "users_orders":   loadSchema("users_orders.yaml"),
    "products_only":  loadSchema("products.yaml"),
    // ...
}
```

Now each row is one line. The schemas live in their own file. Reviewers reading the table see exactly the relevant inputs.

---

## The Anatomy of a Good Row Struct

Pattern matrix for designing a row:

| Field role | Always have? | Example field name |
|---|---|---|
| Name | Yes | `name string` |
| Input | Yes | `in T` or `args struct{...}` |
| Expected result | Yes (or err) | `want T` |
| Expected error | If applicable | `wantErr error` or `wantErrSubstr string` |
| Pre-condition | Rarely | `setup func()` (smells; consider splitting) |
| Tags | Sometimes | `tags []string` for selective `-run` |
| Skip condition | Sometimes | `skip func() bool` |

Avoid:

- `actual` or `expected` — use `got`/`want`.
- `params` — use `args` or split into specific fields.
- Booleans whose name doesn't suggest direction. `valid bool` is fine; `flag bool` is not.

### Field grouping

For wide tables, group related fields:

```go
type roundtripCase struct {
    name string
    request struct {
        method, path, body string
        headers map[string]string
    }
    response struct {
        code int
        body string
    }
}
```

Anonymous nested structs work great here. They make the row read like a config file. Use them when a row has 6+ fields.

---

## Nested Tables — Subtests Within Subtests

A single `t.Run` is a one-level subtest. You can nest:

```go
for _, group := range groups {
    t.Run(group.name, func(t *testing.T) {
        for _, tc := range group.cases {
            t.Run(tc.name, func(t *testing.T) {
                ...
            })
        }
    })
}
```

Output is hierarchical: `TestX/group_a/case_1`, `TestX/group_a/case_2`, `TestX/group_b/case_1`. You can filter with `-run TestX/group_a` to run a whole group.

When to nest:

- **Genuine hierarchy** — protocol versions × commands, time periods × operations.
- **Shared per-group setup** — the group's `t.Run` body builds a fixture; each case in the group reuses it.
- **Categorization** — want to be able to run just the "validation" cases or just the "rendering" cases.

When **not** to nest:

- If groups exist only because the file got long. Splitting into separate `Test*` functions is cleaner.
- If `-run TestX/group_a/case_1` is the only way users will navigate. The two-level depth adds typing cost.

---

## Matrix Tests and Cross-Products

A matrix test exercises every combination of two or more dimensions:

```go
drivers := []string{"sqlite", "postgres", "mysql"}
isolations := []sql.IsolationLevel{
    sql.LevelReadCommitted,
    sql.LevelRepeatableRead,
    sql.LevelSerializable,
}
queries := []struct {
    name string
    sql  string
}{
    {"select_one", "SELECT 1"},
    {"insert",     "INSERT INTO t(v) VALUES(1)"},
    {"update",     "UPDATE t SET v=2 WHERE id=1"},
}

for _, driver := range drivers {
    t.Run(driver, func(t *testing.T) {
        for _, lvl := range isolations {
            t.Run(lvl.String(), func(t *testing.T) {
                for _, q := range queries {
                    t.Run(q.name, func(t *testing.T) {
                        runQuery(t, driver, lvl, q.sql)
                    })
                }
            })
        }
    })
}
```

This generates `3 × 3 × 3 = 27` subtests with paths like `TestX/postgres/serializable/insert`. Run all isolation levels for postgres:

```
go test -run 'TestX/^postgres$'
```

Run all serializable cases across drivers:

```
go test -run 'TestX/[^/]+/^serializable$'
```

### Flattened vs nested matrix

Flat:

```go
for _, driver := range drivers {
    for _, lvl := range isolations {
        for _, q := range queries {
            name := fmt.Sprintf("%s/%s/%s", driver, lvl, q.name)
            t.Run(name, func(t *testing.T) { runQuery(...) })
        }
    }
}
```

This produces the same names but in a single `t.Run` level. Loses the per-group setup hook (nested lets you build a per-driver client once and reuse for each isolation level).

Choose nested when there's per-group setup; flat when not.

### Skipping unsupported combinations

```go
t.Run(q.name, func(t *testing.T) {
    if driver == "sqlite" && lvl == sql.LevelSerializable {
        t.Skip("sqlite does not support serializable")
    }
    runQuery(...)
})
```

`t.Skip` reports the row as skipped (not failed). Good for combinations that are intentionally unsupported.

---

## Programmatic Table Generation

Sometimes you want to generate cases:

### Cross-product generator

```go
type matrixRow struct {
    name string
    a, b int
    op   string
}

func gen() []matrixRow {
    var rows []matrixRow
    for _, a := range []int{-1, 0, 1, 100} {
        for _, b := range []int{-1, 0, 1, 100} {
            for _, op := range []string{"+", "-", "*", "/"} {
                if op == "/" && b == 0 { continue }
                rows = append(rows, matrixRow{
                    name: fmt.Sprintf("%d%s%d", a, op, b),
                    a: a, b: b, op: op,
                })
            }
        }
    }
    return rows
}

func TestMatrix(t *testing.T) {
    for _, tc := range gen() {
        t.Run(tc.name, func(t *testing.T) { ... })
    }
}
```

### Generated cases from regulation/spec data

For tax, currency, locale, or other regulation-driven domains, the test cases come from official spec files. Generate Go code from the spec at build time with `//go:generate`:

```go
//go:generate go run gen_cases.go -input regs.csv -output cases_gen.go
```

The generated `cases_gen.go` is a slice literal, checked into the repo so reviewers can read it.

### Random with fixed seed

```go
func TestSortRandom(t *testing.T) {
    rng := rand.New(rand.NewSource(42))
    for i := 0; i < 100; i++ {
        n := rng.Intn(100) + 1
        input := make([]int, n)
        for j := range input { input[j] = rng.Intn(1000) }
        t.Run(fmt.Sprintf("rand_%03d", i), func(t *testing.T) {
            cp := slices.Clone(input)
            sort.Ints(cp)
            if !sort.IntsAreSorted(cp) {
                t.Errorf("not sorted: %v", cp)
            }
        })
    }
}
```

Fixed seed means reproducible across runs. Reviewer can run `-run TestSortRandom/rand_042` and get the same input every time.

---

## Splitting a Table — When and How

Indicators that a table should split:

1. **Multiple concerns share one struct.** Half the rows test validation, the other half test rendering. The struct has fields used by only one half.
2. **Setup divergence.** Some rows need a Docker container, others are pure. Filtering with skip flags clutters the table.
3. **Length exceeds ~150 rows.** Reviewers stop reading carefully.
4. **The table's name doesn't describe what it tests.** `TestHandler` with 50 unrelated rows is a god-table.

How to split cleanly:

```go
// Before: one TestHandler with 50 rows
// After:
func TestHandler_Parsing(t *testing.T) { ... }      // 15 rows
func TestHandler_Authorization(t *testing.T) { ... } // 10 rows
func TestHandler_RateLimit(t *testing.T) { ... }    // 8 rows
func TestHandler_Rendering(t *testing.T) { ... }    // 17 rows
```

Each smaller function:

- Has a focused name.
- Has a tightly scoped struct.
- Can use `-run TestHandler_Parsing` to debug.
- Has its own setup if needed.

If multiple split tests share fixtures, extract them to a helper in the same file:

```go
func newTestHandler(t *testing.T) *Handler {
    t.Helper()
    // ...
}
```

---

## Tables for State Machines

A state machine test exercises transitions. The natural table shape:

```go
cases := []struct {
    name   string
    from   State
    event  Event
    toWant State
    errWant error
}{
    {"new_to_ready",      StateNew,    EventValidate, StateReady, nil},
    {"new_to_invalid",    StateNew,    EventReject,   StateNew,   ErrInvalid},
    {"ready_to_active",   StateReady,  EventStart,    StateActive, nil},
    {"active_to_done",    StateActive, EventFinish,   StateDone,   nil},
    {"done_no_restart",   StateDone,   EventStart,    StateDone,   ErrTerminal},
}
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        m := &Machine{state: tc.from}
        err := m.Handle(tc.event)
        if !errors.Is(err, tc.errWant) { t.Errorf("err = %v, want %v", err, tc.errWant) }
        if m.state != tc.toWant { t.Errorf("state = %v, want %v", m.state, tc.toWant) }
    })
}
```

The table is one-step-at-a-time. For multi-step sequences, see the next section.

---

## Tables for Sequence Tests

When a single test case involves a sequence of operations, embed the sequence as a slice inside the row:

```go
type step struct {
    op     string
    arg    int
    wantOK bool
}

cases := []struct {
    name  string
    steps []step
    wantFinal int
}{
    {
        name: "simple_increment",
        steps: []step{
            {"add", 1, true},
            {"add", 1, true},
            {"add", 1, true},
        },
        wantFinal: 3,
    },
    {
        name: "rollback_on_error",
        steps: []step{
            {"add", 5, true},
            {"add", -1000, false}, // rejected
            {"add", 1, true},
        },
        wantFinal: 6, // not 5 + -1000 + 1
    },
}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        c := NewCounter()
        for i, s := range tc.steps {
            got := c.Do(s.op, s.arg)
            if got != s.wantOK {
                t.Errorf("step %d (%s %d): got OK=%v, want %v", i, s.op, s.arg, got, s.wantOK)
            }
        }
        if c.Value() != tc.wantFinal {
            t.Errorf("final = %d, want %d", c.Value(), tc.wantFinal)
        }
    })
}
```

This pattern handles arbitrarily long sequences while keeping each case self-contained.

---

## Tables and `t.Parallel` at Scale

For a 500-row table where each row takes 50ms, sequential = 25s. Parallel with 8 cores ≈ 3s.

Considerations:

1. **Resource contention.** 500 parallel goroutines opening DB connections will exhaust a pool. Cap `-parallel` based on resource limits, not just CPU count.
2. **Test isolation.** Each parallel row must not write to shared state. Cloning fixtures per row beats sharing.
3. **Output interleaving.** `go test -v` output from parallel subtests can interleave. Add `-v` only when debugging; for CI use `-json` and post-process.
4. **`t.Setenv` rules out parallel.** If even one row needs `t.Setenv`, that row cannot be parallel — and you have to decide whether to remove parallel from the whole table or split that row out.

### Hybrid parallel/sequential

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        if !tc.needsEnv {
            t.Parallel()
        }
        if tc.needsEnv {
            t.Setenv("FOO", tc.env)
        }
        ...
    })
}
```

The non-env rows run in parallel; the env-rows run sequentially in the post-parallel wave. Works, but adds complexity. Often cleaner to split into two tests.

---

## Property-Based vs Table-Driven

Table-driven tests cover **examples** — specific inputs you wrote down. Property-based tests cover **invariants** — for all inputs of some shape, this property holds.

```go
// Table
func TestReverse(t *testing.T) {
    cases := []struct {
        in   string
        want string
    }{
        {"", ""},
        {"a", "a"},
        {"abc", "cba"},
        {"Hello, World!", "!dlroW ,olleH"},
    }
    for _, tc := range cases {
        t.Run(tc.in, func(t *testing.T) {
            if got := Reverse(tc.in); got != tc.want {
                t.Errorf("Reverse(%q) = %q, want %q", tc.in, got, tc.want)
            }
        })
    }
}

// Property (with go-quickcheck or testing.F)
func FuzzReverseInvolution(f *testing.F) {
    f.Add("hello")
    f.Add("")
    f.Fuzz(func(t *testing.T, s string) {
        if Reverse(Reverse(s)) != s {
            t.Errorf("involution broken: %q", s)
        }
    })
}
```

Use both. Table-driven catches the **specific** edge cases you've thought of (empty string, unicode, palindrome). Property catches the **generic** ones (involution, length preservation) over thousands of generated inputs.

---

## Composing Tables Across Test Files

Sometimes two packages should share test cases — a parser and a formatter that should roundtrip identical inputs.

```
internal/
  testcases/
    canonical.go  // exports []Canonical
  parser/
    parser_test.go
  formatter/
    formatter_test.go
```

`internal/testcases/canonical.go`:

```go
package testcases

type Canonical struct {
    Name    string
    Pretty  string
    Compact string
}

var Cases = []Canonical{
    {"simple", "{ a }", "{a}"},
    {"nested", "{ a: { b } }", "{a:{b}}"},
}
```

Both consumers:

```go
import "example.com/proj/internal/testcases"

for _, tc := range testcases.Cases {
    t.Run(tc.Name, func(t *testing.T) {
        got := parse(tc.Pretty)
        if got.String() != tc.Compact { ... }
    })
}
```

This guarantees parser and formatter cannot drift out of sync — adding a case forces both to update if needed.

---

## Table-Driven Benchmarks

`b.Run` mirrors `t.Run`:

```go
func BenchmarkSplit(b *testing.B) {
    cases := []struct {
        name string
        in   string
    }{
        {"empty",  ""},
        {"short",  "a,b,c"},
        {"medium", strings.Repeat("a,", 100)},
        {"long",   strings.Repeat("a,", 10000)},
    }
    for _, tc := range cases {
        b.Run(tc.name, func(b *testing.B) {
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _ = strings.Split(tc.in, ",")
            }
        })
    }
}
```

Each sub-benchmark gets its own `b.N` calibration. Run with:

```
go test -bench BenchmarkSplit -benchmem
```

Output:

```
BenchmarkSplit/empty-8        100000000   12 ns/op    0 B/op    0 allocs/op
BenchmarkSplit/short-8         20000000   80 ns/op   64 B/op    1 allocs/op
BenchmarkSplit/medium-8         1000000  1500 ns/op 1600 B/op    1 allocs/op
BenchmarkSplit/long-8             10000 150000 ns/op 160000 B/op   1 allocs/op
```

You can see scaling immediately. Compare optimizations across all input sizes with one run.

---

## Table-Driven Fuzz Seeds

Fuzz tests start with a **seed corpus**. The seeds are effectively a table:

```go
func FuzzParse(f *testing.F) {
    seeds := []string{
        "",
        "a",
        "abc",
        "{}",
        "{\"key\": \"value\"}",
        "[1, 2, 3]",
        "{ malformed",
        strings.Repeat("a", 1000),
    }
    for _, s := range seeds {
        f.Add(s)
    }
    f.Fuzz(func(t *testing.T, s string) {
        _, _ = Parse(s) // should never panic
    })
}
```

When you run `go test -fuzz=FuzzParse`, the fuzzer starts from the seeds and mutates. Any input that triggers a failure is saved under `testdata/fuzz/FuzzParse/` and becomes a new seed for future runs. The seeds + corpus directory together form a growing table.

---

## BDD-style Frameworks — When and Why Not

Some teams adopt `goblin`, `ginkgo`, or write a homegrown DSL on top of `testing`. The case for them:

- Hierarchical `describe`/`it` blocks express setup nesting.
- Fluent assertions (`expect(x).to.equal(y)`) read like English.
- Familiar from RSpec/Jest backgrounds.

The case against:

- **Not idiomatic.** Almost all Go code (including the stdlib) is table-driven. BDD-style libraries fight the language.
- **DSLs hide control flow.** A `BeforeEach` runs implicitly; new contributors don't see when it fires.
- **Worse stack traces.** Failures point into the DSL's matcher functions, not your test row.
- **Tooling drift.** `go test -run` doesn't compose cleanly with custom DSLs. IDEs and CI runners assume the stdlib testing model.
- **Adoption tax.** Every new contributor must learn the DSL before reading tests.

The senior view: **stay with table-driven + `t.Run`**. The single benefit of BDD (nested setup) is solved cleanly with nested `t.Run`. The "fluent assertion" benefit is mostly aesthetic and is largely covered by `go-cmp` diffs.

This is not zealotry — if your team has 200 existing Ginkgo tests, don't migrate just for purity. But for new code, default to table-driven.

---

## Worked Example — Compiler Lexer Tests

Compiler frontends have rich test surfaces. Lexers turn source text into tokens. A canonical table:

```go
type token struct {
    kind  TokenKind
    value string
    line  int
}

func TestLexer(t *testing.T) {
    cases := []struct {
        name   string
        source string
        want   []token
    }{
        {
            name:   "empty",
            source: "",
            want:   nil,
        },
        {
            name:   "single_int",
            source: "42",
            want:   []token{{IntKind, "42", 1}},
        },
        {
            name:   "binary_op",
            source: "x + 1",
            want: []token{
                {IdentKind, "x", 1},
                {PlusKind,  "+", 1},
                {IntKind,   "1", 1},
            },
        },
        {
            name:   "multiline",
            source: "x\ny",
            want: []token{
                {IdentKind, "x", 1},
                {NewlineKind, "\n", 1},
                {IdentKind, "y", 2},
            },
        },
        {
            name:   "string_literal_with_escape",
            source: `"hi\n"`,
            want:   []token{{StringKind, "hi\n", 1}},
        },
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := Lex(tc.source)
            if diff := cmp.Diff(tc.want, got); diff != "" {
                t.Errorf("Lex(%q) mismatch (-want +got):\n%s", tc.source, diff)
            }
        })
    }
}
```

Things to notice:

- `want` is a slice. The row doesn't fight the data shape.
- We use `go-cmp` for the diff — eyeballing token slices is painful.
- The source field is short for each case. If sources grew to multi-line YAML or 100-line programs, move them to `testdata/lexer/<name>.input` and read them in:

```go
src, _ := os.ReadFile(filepath.Join("testdata/lexer", tc.name+".input"))
```

This is how the Go stdlib's own `go/parser` tests work.

---

## Worked Example — Distributed System State Transitions

For a Raft-style log replication library:

```go
type event struct {
    kind string
    from int
    term int
}

type expectation struct {
    leader    int    // -1 means no leader
    term      int
    committed []string
}

cases := []struct {
    name   string
    nodes  int
    events []event
    final  expectation
}{
    {
        name:  "leader_elected",
        nodes: 3,
        events: []event{
            {"timeout", 0, 0},
            {"vote",    1, 1},
            {"vote",    2, 1},
        },
        final: expectation{leader: 0, term: 1},
    },
    {
        name:  "split_vote_resolved",
        nodes: 3,
        events: []event{
            {"timeout", 0, 0},
            {"timeout", 1, 0},
            {"vote",    2, 1}, // 2 votes for 1 (or 0?)
            // ... rest of the sequence
        },
        final: expectation{leader: 1, term: 2},
    },
}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        cluster := newCluster(tc.nodes)
        defer cluster.Close()
        for _, e := range tc.events {
            cluster.Step(e)
        }
        if got := cluster.Leader(); got != tc.final.leader {
            t.Errorf("leader = %d, want %d", got, tc.final.leader)
        }
        if got := cluster.Term(); got != tc.final.term {
            t.Errorf("term = %d, want %d", got, tc.final.term)
        }
    })
}
```

The event sequence inside each row is what gives the table-driven pattern its power for stateful systems: each case is self-describing, the cluster is built fresh per row, and the final assertion is a single struct comparison.

---

## Anti-Patterns at This Level

### 1. The God-Row

A single row with 25 fields, half of which are nil/zero per case. The struct is shaped for the **union** of all rows' needs. Split into multiple tests.

### 2. The Hidden Pre-condition

```go
for _, tc := range cases {
    setupGlobalState(tc.config)  // mutates a package-level var
    t.Run(tc.name, func(t *testing.T) {
        result := DoThing()
        ...
    })
}
```

The subtest body looks pure but actually depends on the loop body's side effects. Move setup inside `t.Run` or accept it as a documented sequential test.

### 3. The Magic `want` Function

```go
cases := []struct{
    name string
    in   int
    wantFn func(int) int
}{
    {"double", 5, func(n int) int { return n * 2 }},
    {"square", 5, func(n int) int { return n * n }},
}
// ...
if got := f(tc.in); got != tc.wantFn(tc.in) { ... }
```

The "want" is now a function the reader has to mentally evaluate. Hardcode the result.

### 4. The 1500-Line Row Literal

When a single row has a 200-line literal `want` (a multi-page JSON structure), move it to a golden file.

### 5. Renaming Cases on Cleanup

If you rename `tc.name` from `"empty_string"` to `"empty"` to keep things short, you've broken anyone who had `-run TestX/empty_string` in their notes. Stable names are a contract. Rename only with intent.

---

## Decision Checklist

Before adding a table-driven test, ask:

1. **Do all cases share the same assertion shape?** If no, separate tests.
2. **Will future contributors add cases?** If yes, table makes that one-line.
3. **Does any case need fundamentally different setup?** If yes, that case doesn't belong.
4. **Will the table grow past 100 rows?** If yes, plan for data files.
5. **Is each case independent of the others?** If no, you have a sequence test (different pattern).
6. **Can the cases run in parallel?** If yes, plan for `t.Parallel` from the start.
7. **Do I need golden files?** Decide before writing the first case.

---

## What to Read Next

- [Professional](../professional/) — at-scale governance, data formats, CI.
- [Optimize](../optimize/) — measuring per-row overhead and reducing it.
- [Specification](../specification/) — exact semantics of `t.Run`, `-run`, Go 1.22 scope change.

---

## Self-Check

1. When should you nest `t.Run` calls vs flatten with `name=fmt.Sprintf("%s/%s", a, b)`?
2. What makes a row struct "right-shaped"? Give three properties.
3. What's the difference between a table test and a property-based test? When do you use each?
4. How do you share test cases across two packages without copy-pasting?
5. What is a god-row, and how do you refactor away from one?

---

## Deep Dive — Tables for Concurrency Tests

Concurrency tests are notoriously hard to make repeatable. Tables help by encoding the **schedule** rather than relying on timing.

Pattern: the row carries a sequence of events that synchronize via channels:

```go
type event struct {
    actor  int     // which goroutine performs the action
    action string  // "send", "recv", "close", "wait"
    value  int     // optional payload
}

cases := []struct {
    name   string
    events []event
    want   map[int][]int // per-goroutine observed values
}{
    {
        name: "single_send_recv",
        events: []event{
            {actor: 0, action: "send", value: 42},
            {actor: 1, action: "recv"},
        },
        want: map[int][]int{1: {42}},
    },
    {
        name: "two_senders_one_receiver",
        events: []event{
            {actor: 0, action: "send", value: 1},
            {actor: 1, action: "send", value: 2},
            {actor: 2, action: "recv"},
            {actor: 2, action: "recv"},
        },
        want: map[int][]int{2: {1, 2}}, // assuming ordered channel
    },
}
```

The test runner schedules events according to the row's plan, then verifies observations. This is more deterministic than naive `go funcA(); go funcB(); time.Sleep(...)`.

---

## Deep Dive — Asserting on Order-Insensitive Output

Some functions produce sets, not sequences. Comparing them as slices fails on permutations:

```go
got := f(input)      // []string{"b", "a", "c"}
want := []string{"a", "b", "c"}
if !reflect.DeepEqual(got, want) { ... } // fails: same set, different order
```

Three strategies:

1. **Sort both sides** before comparison:

```go
gotCopy := slices.Clone(got)
sort.Strings(gotCopy)
sort.Strings(want)
if !slices.Equal(gotCopy, want) { ... }
```

2. **Use `cmpopts.SortSlices`**:

```go
opt := cmpopts.SortSlices(func(a, b string) bool { return a < b })
if diff := cmp.Diff(want, got, opt); diff != "" { ... }
```

3. **Compare as multisets**: count occurrences, compare counts.

Pick (2) for production tests — it preserves the original slice and produces a clean diff.

---

## Deep Dive — Asserting on Error Wrappings

Modern Go errors are wrapped chains: `fmt.Errorf("upstream: %w", innerErr)`. Tests need to assert on the **kind** of error, not on the wrapping path.

```go
cases := []struct {
    name    string
    in      Input
    wantErr error
}{
    {"valid",         Input{}, nil},
    {"db_unreachable", Input{...}, ErrDB},
    {"validation",    Input{Bad: true}, ErrValidation},
}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        err := f(tc.in)
        if !errors.Is(err, tc.wantErr) {
            t.Errorf("err = %v, want wrapped %v", err, tc.wantErr)
        }
    })
}
```

If the test surface includes structured error fields (`*ValidationError`), use `errors.As`:

```go
var ve *ValidationError
if !errors.As(err, &ve) { t.Fatalf("not a ValidationError: %v", err) }
if ve.Field != tc.wantField { ... }
```

A senior should never assert on `err.Error()` substrings except as a last resort — message text is documentation, not a contract.

---

## Deep Dive — Tables That Test Equivalence Classes

Boundary testing and equivalence-class partitioning are formal QA techniques that map cleanly to tables.

For a function `Grade(score int) string` that returns `"F"`, `"D"`, `"C"`, `"B"`, `"A"`:

```go
type gradeCase struct {
    name  string
    score int
    want  string
}

// Equivalence classes: F (0-59), D (60-69), C (70-79), B (80-89), A (90-100)
// Boundaries: -1, 0, 59, 60, 69, 70, 79, 80, 89, 90, 100, 101

cases := []gradeCase{
    {"below_zero",      -1,  "invalid"},
    {"zero",            0,   "F"},
    {"top_of_F",        59,  "F"},
    {"bottom_of_D",     60,  "D"},
    {"top_of_D",        69,  "D"},
    {"bottom_of_C",     70,  "C"},
    {"top_of_C",        79,  "C"},
    {"bottom_of_B",     80,  "B"},
    {"top_of_B",        89,  "B"},
    {"bottom_of_A",     90,  "A"},
    {"max",             100, "A"},
    {"above_max",       101, "invalid"},
    {"middle_F",        25,  "F"},
    {"middle_A",        95,  "A"},
}
```

The table includes both **boundaries** (each transition point) and **representative** cases from each class. This is a complete behavioral spec in 14 rows.

---

## Deep Dive — Combining Tables with Snapshots

For complex outputs (HTML, large JSON, generated SQL), each row produces output that's hard to embed inline. Combine table-driven tests with snapshot files:

```
testdata/
  TestRender/
    simple.golden
    with_lists.golden
    nested_deep.golden
```

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        got := Render(tc.in)
        golden := filepath.Join("testdata", "TestRender", tc.name+".golden")
        if *update { os.WriteFile(golden, got, 0644); return }
        want, err := os.ReadFile(golden)
        if err != nil { t.Fatal(err) }
        if !bytes.Equal(got, want) {
            t.Errorf("Render(%s):\n--- want ---\n%s\n--- got ---\n%s", tc.name, want, got)
        }
    })
}
```

The table now holds only inputs; outputs live on disk where humans can read them comfortably. Intentional output changes show up as ordinary diffs in git review.

---

## Deep Dive — Avoid Tables When Tests Are Truly Different

A senior should resist the urge to table everything. If you find yourself writing:

```go
cases := []struct {
    name string
    kind string  // "parse" or "validate" or "render"
    ...
}{
    {"parse_simple",     "parse",    ...},
    {"validate_empty",   "validate", ...},
    {"render_html",      "render",   ...},
}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        switch tc.kind {
        case "parse":    /* parse-specific logic */
        case "validate": /* validate-specific logic */
        case "render":   /* render-specific logic */
        }
    })
}
```

You don't have a table — you have three tests squished into one. The `switch` is the smell. Split:

```go
func TestParse(t *testing.T)    { /* table of parse cases */ }
func TestValidate(t *testing.T) { /* table of validate cases */ }
func TestRender(t *testing.T)   { /* table of render cases */ }
```

Each focused, each scannable, each can have its own setup.

---

## A Sketch of Test-Suite Architecture for a Compiler

Suppose you're building a Go-like language. Your test architecture might look like:

```
internal/testcases/         # shared canonical inputs
  program_samples.go
  expression_samples.go

internal/lex/
  lex_test.go               # table of (source → tokens)
  fuzz_test.go              # fuzz seeds drawn from samples

internal/parse/
  parse_test.go             # table of (source → AST)
  error_recovery_test.go    # table of (broken source → recovered AST + errors)

internal/typecheck/
  typecheck_test.go         # table of (AST → type info)
  matrix_test.go            # all (declared type) × (used as) combos

internal/codegen/
  codegen_test.go           # table with golden file outputs
  roundtrip_test.go         # parse → codegen → parse, asserts AST equality

cmd/compile/
  end_to_end_test.go        # whole-program tests, smaller table, slower
```

Each test file is a focused table. Shared inputs live in `internal/testcases`. End-to-end tests are kept small because they're slow; unit tables are kept large because they're fast.

This is roughly how `cmd/compile` in the Go repo itself is organized.

---

## When Tables Hurt Readability

A 30-row table where every row sets the same fields except one is **noisier than 30 individual tests** for that one field's variation. Counter to intuition.

```go
// Hard to scan — what's varying?
cases := []struct {
    name        string
    inputUser   *User
    inputOrders []*Order
    inputItems  []*Item
    config      Config
    want        Result
}{
    {"a", baseUser, baseOrders, baseItems, Config{Mode: "fast"},  baseResult},
    {"b", baseUser, baseOrders, baseItems, Config{Mode: "safe"},  altResult},
    {"c", baseUser, baseOrders, baseItems, Config{Mode: "audit"}, auditResult},
    // ... 27 more, each varying only Mode
}
```

This is a table of **just one variable** (`Mode`) padded with redundant fixtures. Cleaner:

```go
cases := []struct {
    name string
    mode string
    want Result
}{
    {"fast",  "fast",  baseResult},
    {"safe",  "safe",  altResult},
    {"audit", "audit", auditResult},
    // ...
}

// Build inputs once outside the loop
input := buildInputs()

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        input.Config = Config{Mode: tc.mode}
        got := Process(input)
        if got != tc.want { ... }
    })
}
```

The table now shows only what varies. Reviewers see "we test three modes" at a glance.

---

## Code Review Checklist for Table-Driven Tests

When reviewing a PR that adds a table:

- [ ] Are case names unique and descriptive?
- [ ] Is there at least one negative case (`wantErr`)?
- [ ] Are boundary values covered?
- [ ] Does the failure message include the inputs?
- [ ] If parallel: are rows independent?
- [ ] If `time.Now` or random data is used: is it deterministic?
- [ ] If golden files: is `-update` opt-in and default-false?
- [ ] Are helpers marked `t.Helper`?
- [ ] Is there shared mutable state across rows?
- [ ] Does the struct have any field used by only a tiny minority of rows?

These ten checks catch ~90% of the issues you'll see in real PRs.

---

## Architecting Tables for Long-Lived Test Suites

A test suite that lives ten years accumulates patterns. Some that survive:

### Pattern — One table, one concern

Every `Test*` function has exactly one table. The table tests exactly one behavior. No "general test of feature X" tables with 50 unrelated rows.

```go
// Good — focused
func TestParseInt_Valid(t *testing.T) { /* table of valid inputs */ }
func TestParseInt_Invalid(t *testing.T) { /* table of invalid inputs */ }
func TestParseInt_Overflow(t *testing.T) { /* table of overflow cases */ }

// Bad — diffuse
func TestParseInt(t *testing.T) { /* 80 rows mixing valid/invalid/overflow */ }
```

The split makes failures easier to triage (`go test -run TestParseInt_Overflow`) and lets each table evolve independently.

### Pattern — Test data per package, helpers per repo

Each package's `testdata/` directory holds **only** that package's test data. Cross-package helpers live in `internal/testutil` or `internal/testcases`. This avoids "where does my fixture live" debates.

### Pattern — Generated test code is annotated

Any `_test.go` file that contains generated rows starts with a clear marker:

```go
// Code generated from regs.csv by gen_cases.go; DO NOT EDIT.
package validation_test
```

Reviewers know not to hand-edit. The generation command is also in `//go:generate` so anyone can regenerate.

### Pattern — Public assertion helpers are typed

Instead of taking `any`, helpers accept the specific type:

```go
// Good
func assertOrderEqual(t *testing.T, got, want Order) { ... }

// Worse
func assertEqual(t *testing.T, got, want any) { ... }
```

The typed version catches misuse at compile time and produces better failure messages.

---

## A Senior's Heuristics for Table Length

- **< 10 rows**: anything goes. Table is fine; separate functions are fine.
- **10–50 rows**: table almost always wins.
- **50–200 rows**: table, but consider grouping with nested `t.Run` or splitting into 2–3 functions by category.
- **200–1000 rows**: data file (JSON/YAML/CSV), schema validation, name-uniqueness test.
- **1000+ rows**: generation script under `//go:generate`, sharded across multiple test functions, may need CI parallelism per shard.

These thresholds are rough but useful. Don't let "we have one table" become "we have one 5000-line table".

---

## Tables and Mutation Testing

Mutation testing tools (`go-mutesting`, `mutmut-go`) introduce small changes to your source — flipping `<` to `<=`, swapping `+` to `-` — and run your tests. A test suite that catches all mutations is **mutation-killing**.

Tables are naturally good at mutation testing because:

1. Lots of edge cases catch off-by-one mutations.
2. Boundary values catch `<` vs `<=` flips.
3. Negative cases catch sign-flips.

If you run mutation testing and see survivors, the surviving mutations point at gaps in your table. Add a row to kill each survivor.

This is a senior-level practice — not many teams do it, but the ones that do have remarkably defect-free code.

---

## Tables and Code Review Discipline

When a contributor adds a new feature, the PR should include table rows for:

- The happy path.
- Each new edge case the feature introduces.
- Each error condition the feature can produce.

A senior reviewer asks: "what's the *negative* case for this change?" If the answer is "I don't know" or "no test", request rows for the failure modes.

This is the discipline that separates production-grade Go code from hobby code. The table-driven idiom makes the discipline cheap to follow — adding a row is one line — so there's no excuse.

---

## When Senior-Level Judgment Means Breaking the Rules

You've now learned the canonical patterns. Senior judgment is knowing when to violate them.

- A 5-line test for a one-off bug doesn't need a table.
- A test for a behavior that only fires once in the codebase doesn't need three negative cases.
- A 200-line setup function might be cleaner than threading 12 fields through every row.

Rules exist to compress decision-making. When a rule says "no" but your context says "yes", trust your context — and explain in a code comment why this test is shaped the way it is.

```go
// This test is intentionally a single function, not table-driven:
// the setup involves spinning up a real Postgres container, and
// expressing per-row setup as a table field would obscure the
// actual test logic. See ADR-2024-15.
func TestPostgresDriver(t *testing.T) {
    ...
}
```

A comment like that turns a "violation" into documented intent.

---

## A Senior Worked Example — Schema Validator With Migration

Suppose you're testing a schema validator that supports versioning. The validator takes JSON, declares its schema version, and validates against the appropriate rules.

```go
type ValidatorCase struct {
    name      string
    schemaVer int
    input     string
    wantErr   bool
    wantField string  // for typed errors
    wantCode  string
}

func TestValidator(t *testing.T) {
    cases := []ValidatorCase{
        // v1 schema cases
        {"v1/valid_simple",     1, `{"name":"Ada"}`,             false, "", ""},
        {"v1/valid_full",       1, `{"name":"Ada","age":30}`,    false, "", ""},
        {"v1/missing_name",     1, `{"age":30}`,                 true,  "name", "required"},
        {"v1/unknown_field",    1, `{"name":"Ada","xyz":1}`,     true,  "xyz", "unknown"},

        // v2 schema cases (introduced "email" as required, made "age" optional)
        {"v2/valid_simple",     2, `{"name":"Ada","email":"a@b.co"}`,        false, "", ""},
        {"v2/valid_no_age",     2, `{"name":"Ada","email":"a@b.co"}`,        false, "", ""},
        {"v2/missing_email",    2, `{"name":"Ada"}`,                          true,  "email", "required"},

        // v3 schema cases (introduced "roles" array)
        {"v3/valid_one_role",   3, `{"name":"Ada","email":"a@b.co","roles":["admin"]}`, false, "", ""},
        {"v3/empty_roles",      3, `{"name":"Ada","email":"a@b.co","roles":[]}`,        true,  "roles", "min_length"},

        // Cross-version cases
        {"unknown_version",     99, `{"name":"Ada"}`,            true, "_version", "unknown"},
        {"zero_version",        0,  `{"name":"Ada"}`,            true, "_version", "unknown"},
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            err := Validate(tc.schemaVer, []byte(tc.input))
            if (err != nil) != tc.wantErr {
                t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
            }
            if !tc.wantErr { return }

            var ve *ValidationError
            if !errors.As(err, &ve) {
                t.Fatalf("want *ValidationError, got %T (%v)", err, err)
            }
            if ve.Field != tc.wantField {
                t.Errorf("field = %q, want %q", ve.Field, tc.wantField)
            }
            if ve.Code != tc.wantCode {
                t.Errorf("code = %q, want %q", ve.Code, tc.wantCode)
            }
        })
    }
}
```

Observations:

- **Prefixed names** (`v1/`, `v2/`, `v3/`, plus a `Cross-version` block) make subtest filtering trivial: `-run TestValidator/v2` runs just v2 cases.
- **Typed errors** via `errors.As` let us assert on `Field` and `Code` independently. The error message text is not tested — that's documentation, not contract.
- **Cross-version cases** test the validator's behavior when given a version it doesn't know.

When v4 ships, you add a new prefix group. The structure stays clean.

---

## A Senior Worked Example — Distributed Lock Tests

Testing a distributed lock that can be acquired, held, released, and that expires.

```go
type lockEvent struct {
    actor    int       // which client
    action   string    // "acquire", "release", "expire", "renew"
    timeline time.Duration  // when (relative to test start)
    wantOK   bool
}

type lockCase struct {
    name   string
    events []lockEvent
}

cases := []lockCase{
    {
        name: "single_acquire_release",
        events: []lockEvent{
            {actor: 0, action: "acquire", timeline: 0, wantOK: true},
            {actor: 0, action: "release", timeline: 100 * time.Millisecond, wantOK: true},
        },
    },
    {
        name: "contention_one_winner",
        events: []lockEvent{
            {actor: 0, action: "acquire", timeline: 0,        wantOK: true},
            {actor: 1, action: "acquire", timeline: 10 * time.Millisecond, wantOK: false},
            {actor: 0, action: "release", timeline: 100 * time.Millisecond, wantOK: true},
            {actor: 1, action: "acquire", timeline: 110 * time.Millisecond, wantOK: true},
        },
    },
    {
        name: "expiration_releases_lock",
        events: []lockEvent{
            {actor: 0, action: "acquire", timeline: 0, wantOK: true},
            // no explicit release; lock expires
            {actor: 1, action: "acquire", timeline: 2 * time.Second, wantOK: true},
        },
    },
}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        clock := newFakeClock()
        lock := NewLock(clock, time.Second)
        clients := make(map[int]Client)

        for _, ev := range tc.events {
            clock.Advance(ev.timeline) // jump to event's timeline
            c, ok := clients[ev.actor]
            if !ok {
                c = lock.Client()
                clients[ev.actor] = c
            }
            var ok2 bool
            switch ev.action {
            case "acquire": ok2 = c.Acquire()
            case "release": ok2 = c.Release()
            case "renew":   ok2 = c.Renew()
            }
            if ok2 != ev.wantOK {
                t.Errorf("event %s by actor %d at %v: ok = %v, want %v",
                    ev.action, ev.actor, ev.timeline, ok2, ev.wantOK)
            }
        }
    })
}
```

This is the "encode the schedule in the row" pattern from earlier, applied to a real distributed-systems test. The `clock` is fake (controllable), so the test is deterministic. The events describe **what should happen and when**, not the implementation.

Adding a new case is straightforward: list the events, name them, done.

---

[← Back](../)
