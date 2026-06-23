# Generic Testing Helpers — Professional Level

## Table of Contents
1. [The landscape of Go test libraries](#the-landscape-of-go-test-libraries)
2. [Stdlib `testing` as the default](#stdlib-testing-as-the-default)
3. [`stretchr/testify` — the dominant fluent library](#stretchrtestify-the-dominant-fluent-library)
4. [`gotest.tools/v3` — middle-ground assertions](#gotesttoolsv3-middle-ground-assertions)
5. [`google/go-cmp` — diffs, not assertions](#googlego-cmp-diffs-not-assertions)
6. [Other generic test helpers in the ecosystem](#other-generic-test-helpers-in-the-ecosystem)
7. [Picking a library for a new project](#picking-a-library-for-a-new-project)
8. [Migration tips](#migration-tips)
9. [Case study: in-house testlib at scale](#case-study-in-house-testlib-at-scale)
10. [Code review checklist for generic helpers](#code-review-checklist-for-generic-helpers)
11. [Summary](#summary)

---

## The landscape of Go test libraries

After Go 1.18, the testing ecosystem split into three camps:

| Camp | Examples | Style |
|------|----------|-------|
| **Stdlib only** | `testing` plus tiny helpers | Imperative, low-magic |
| **Fluent libraries** | `stretchr/testify`, `onsi/gomega` | DSL-flavoured |
| **Diff-first** | `google/go-cmp`, `r3labs/diff` | Compare-and-report |

A professional team picks **one camp** and applies it consistently. Mixing styles within one project causes cognitive overhead and spotty `t.Helper()` discipline.

---

## Stdlib `testing` as the default

Go's `testing` package gives you `t.Errorf`, `t.Fatalf`, `t.Run`, `t.Helper`, `t.Cleanup`, and `t.Parallel`. With Go 1.21+ stdlib helpers (`slices.Equal`, `maps.Equal`, `cmp.Diff` from `cmp` package), most projects can ship without a third-party assertion library at all.

A sample stdlib-only testlib is exactly what we built in `junior.md` and `middle.md`:

```go
func Equal[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}
```

That single file plus stdlib functions handles 90% of real test code.

### Pros

- Zero dependencies
- Fastest possible (compiler inlines simple helpers)
- Onboarding is literally "read the stdlib"
- No version skew between modules

### Cons

- No fluent chaining
- Have to write `AssertNoError`, `AssertErrorIs` yourself
- No built-in pretty diffs (until you import `go-cmp`)

The Go core team and many large projects (Kubernetes' newer code, Docker's new packages, all the internal Google code) use this style.

---

## `stretchr/testify` — the dominant fluent library

`github.com/stretchr/testify` is the most-imported Go test library by a large margin. It predates generics and has not (as of 2026) fully embraced them, but its ergonomic API made it the default for years.

```go
import (
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestUser(t *testing.T) {
    u, err := loadUser(1)
    require.NoError(t, err)
    assert.Equal(t, "alice", u.Name)
    assert.Len(t, u.Roles, 2)
    assert.ElementsMatch(t, u.Roles, []string{"admin", "user"})
}
```

### Trade-offs vs a generic stdlib testlib

| Concern | `testify` | Generic stdlib testlib |
|---------|-----------|------------------------|
| **Type safety** | `interface{}` (lots of `any`) | Compile-time |
| **Error messages** | Rich, formatted | What you build |
| **API surface** | Hundreds of helpers | A dozen |
| **Onboarding** | Familiar to most Go devs | Learn the project's |
| **Performance** | Slower (reflection) | As fast as stdlib |
| **Generics** | Limited (legacy reasons) | Native |

### When `testify` is the right choice

- The team is heterogeneous and `testify` is the lowest common denominator
- The project predates generics and the wholesale migration cost is too high
- You need `assert.Eventually`, `assert.Subset`, `assert.Panics` — and want them ready-made

### When to migrate away from `testify`

- You want compile-time type checks on assertions
- The reflection overhead shows in test runtime (rare but real on large suites)
- You want consistency with stdlib `slices.Equal` and `maps.Equal`

---

## `gotest.tools/v3` — middle-ground assertions

`gotest.tools/v3` (Docker's testing helper) sits between stdlib and `testify`:

```go
import "gotest.tools/v3/assert"
import is "gotest.tools/v3/assert/cmp"

assert.Equal(t, got, want)
assert.NilError(t, err)
assert.Assert(t, is.Contains(got, "alice"))
```

Pros:

- Smaller API surface than `testify`
- Cleaner integration with `go-cmp`
- Used widely in Docker and Moby projects

Cons:

- Not generic-first (predates Go 1.18)
- Smaller community than `testify`

A reasonable choice for projects that want fluency without `testify`'s breadth.

---

## `google/go-cmp` — diffs, not assertions

`go-cmp` is **not** an assertion library. It is a **comparison engine**:

```go
import "github.com/google/go-cmp/cmp"

if d := cmp.Diff(want, got); d != "" {
    t.Errorf("mismatch (-want +got):\n%s", d)
}
```

It pairs cleanly with **either** stdlib helpers or `testify`:

```go
// Stdlib pairing
func AssertCmpEqual[T any](tb testing.TB, got, want T, opts ...cmp.Option) {
    tb.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        tb.Errorf("mismatch (-want +got):\n%s", d)
    }
}
```

Most professional Go projects use **`go-cmp` for the diff** and then either `testify` or a small stdlib helper for everything else.

### Why `go-cmp` is universal

- Pretty diffs that read like `git diff`
- `cmpopts` for sorting, approximate floats, ignoring fields
- Zero conflict with whatever assertion library you use

The recommendation: **adopt `go-cmp` early**, even if you keep `testify` or stdlib for the rest.

---

## Other generic test helpers in the ecosystem

| Library | Notes |
|---------|-------|
| `matryer/is` | Tiny stdlib-shaped helper, predates generics; modern fork uses generics |
| `frankban/quicktest` | Small library with composable checkers |
| `carlmjohnson/be` | Generics-first, ergonomic, ~200 lines |
| `shoenig/test` | Generic-first replacement for `testify`, growing usage |
| `alecthomas/assert/v2` | Generic-first, single file, MIT |

These libraries demonstrate that the **generic-first design** wins on type safety and code size. They are ideal for new projects unencumbered by `testify` history.

---

## Picking a library for a new project

A professional decision tree:

```
Start: new Go project, Go 1.21+
│
├─ Need rich diffs? ──► import go-cmp
│
├─ Team comfortable with stdlib only? ──► tiny generic helpers + go-cmp
│
├─ Team comes from JVM/Ruby and wants fluent API? ──► testify or shoenig/test
│
└─ Project will outlive its team? ──► stdlib + go-cmp (least surprising in 5 years)
```

The bias for stdlib + `go-cmp` is real: it has the smallest dependency surface, the most predictable behaviour, and the strongest guarantee of long-term support.

---

## Migration tips

Migrating a 5-year-old codebase from `testify` (or no helpers) to generic stdlib helpers is a real engineering effort. A practical playbook:

### 1. Inventory before refactoring

Run:

```bash
grep -r "assert\.Equal\|require\.NoError" --include="*_test.go" | wc -l
```

If the count is > 5,000, **do not** big-bang migrate. Trickle is the only option.

### 2. Add new helpers alongside old

Create `internal/testutil` with `Equal`, `NoError`, etc. Use them in new tests. Leave old tests on `testify`.

### 3. Convert during refactors

When a test file is touched for any reason, convert its assertions. After 6-12 months, most active tests are migrated; the rest are dead code or rarely-touched tests that can stay.

### 4. Linting

Add a lint rule to forbid `testify` imports in new packages once the migration is well underway. Use a `forbidigo` linter or a custom `go vet` analyzer.

### 5. Deprecation, not deletion

Mark `testify`-using helper modules as `// Deprecated:` rather than deleting them. Keep tests passing; eventually the dead modules can go.

### 6. Cultural change

Update `CONTRIBUTING.md`, run a brown-bag session, post examples in the team Slack. Migration is **80% culture, 20% code**.

---

## Case study: in-house testlib at scale

A real-world pattern from large Go shops (anonymized):

### Setup

- Monorepo with 600 Go modules
- 250,000 test cases
- Mixed `testify` and `interface{}`-era helpers
- Go version pinned at 1.22

### The plan

1. **Create `internal/testutil/v2`** with generic helpers
2. **Adopt `go-cmp`** universally for struct diffs
3. **Add a lint rule** that requires `testutil/v2` for new test files
4. **Migrate hot paths first** — top 20 packages by test failure frequency
5. **Quarterly review** — measure migration percentage

### Results after 18 months

- 70% of test files migrated
- Test runtime down ~12% (less reflection)
- New engineers report easier onboarding ("just use `testutil`")
- Old `testify` calls remain but are no longer growing

### Lessons

- **Generics shrink the testlib API**: 50 `testify` helpers became 12 generic ones
- **`go-cmp` is the unsung hero** — it does the heavy lifting; the helpers are thin wrappers
- **Big-bang failed**; the trickle worked
- **Linting** kept the migration moving; without it, momentum stalled

---

## Code review checklist for generic helpers

A professional reviewer asks:

| Check | Why |
|-------|-----|
| Does the helper call `t.Helper()` first? | Reports correct line on failure |
| Is the parameter `testing.TB` or `*testing.T`? | TB enables benchmarks |
| Is the constraint as loose as possible? | Reuse across types |
| Does the error message identify both `got` and `want`? | Triage speed |
| Are slices/maps compared with `slices.Equal` / `maps.Equal`? | Avoid `reflect.DeepEqual` quirks |
| Is `Fatalf` used for unrecoverable failures, `Errorf` for recoverable? | Avoid cascading errors |
| Does the helper avoid hidden side effects (logs, globals)? | Pure helpers are debuggable |
| Are helpers in `internal/testutil`, not `pkg/`? | Public API hygiene |
| Are tests for the helper itself in place? | Helpers can have bugs too |

---

## Summary

The professional view of generic test helpers is **strategic**. A working engineer must:

1. **Pick one assertion style** — stdlib, `testify`, or generic-first library — and stick with it.
2. **Adopt `go-cmp` for diffs** regardless of the assertion style chosen.
3. **Write a small `internal/testutil`** with `Equal`, `NoError`, `ErrorIs`, slice/map helpers, and one diff helper.
4. **Migrate gradually** if the codebase is large; never big-bang.
5. **Lint and review** to prevent style drift.

Generic test helpers are now a normal part of Go. The community has settled on a clean consensus: **stdlib-shaped helpers + `go-cmp` for diffs, with `testify` as the legacy alternative**. New projects in 2025+ should prefer the generic-first stdlib pattern; older projects should migrate at a sustainable pace.

The next file (`specification.md`) digs into how the `testing` package and Go's generics rules interact — there is no special spec for test helpers, only the general generics rules applied carefully.
