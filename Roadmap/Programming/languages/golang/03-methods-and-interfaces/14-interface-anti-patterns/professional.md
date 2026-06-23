# Interface Anti-Patterns — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Damage in Large Codebases](#damage-in-large-codebases)
3. [Inventory: Detecting Anti-Patterns at Scale](#inventory-detecting-anti-patterns-at-scale)
4. [Refactoring Strategy: Strangler vs Big-Bang](#refactoring-strategy-strangler-vs-big-bang)
5. [Refactoring Recipe: Header Interface Removal](#refactoring-recipe-header-interface-removal)
6. [Refactoring Recipe: Mock Explosion Cleanup](#refactoring-recipe-mock-explosion-cleanup)
7. [Refactoring Recipe: Typed-Nil Audit](#refactoring-recipe-typed-nil-audit)
8. [Refactoring Recipe: `interfaces.go` Dispersion](#refactoring-recipe-interfacesgo-dispersion)
9. [Governance: Style Guide Entries](#governance-style-guide-entries)
10. [Governance: Linter Pipeline](#governance-linter-pipeline)
11. [Code Review Checklist](#code-review-checklist)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

In a young codebase a bad interface is one annoying file. In a 500-thousand-line monorepo it is a tax on every commit. This file covers:

- The shapes anti-patterns take when they spread across teams.
- How to inventory them with `grep`, `staticcheck`, and AST tooling.
- Refactoring strategies that keep services shipping while abstractions are repaired.
- Governance — style guides, linter configuration, and PR review patterns that prevent the next round.

---

## Damage in Large Codebases

### Damage 1 — Compilation amplification

A package containing 12 interfaces, each with 8 methods, used by 30 consumers, is recompiled whenever any single signature changes. CI minutes balloon. Developers wait.

### Damage 2 — Test brittleness

Mocks generated from header interfaces have to be regenerated on every method tweak. Every PR touches `*_mock.go` files. Code review fatigue sets in. Genuine bugs hide in noisy diffs.

### Damage 3 — Onboarding tax

A new engineer reading `service.go` jumps from interface (file A) to implementation (file B) to mock (file C) to test (file D). The mental model takes weeks instead of days.

### Damage 4 — Refactor paralysis

A team that wants to add `ctx context.Context` to a method touches the interface, every implementation, every mock, every consumer call site. Hundreds of files. The PR is too big to review. The change is shelved.

### Damage 5 — Production bugs from leaky abstractions

The "Cache" interface includes `Pipeline()`. The Redis impl honors it; the in-memory impl panics. A test environment quietly switches to in-memory and the staging deploy crashes.

### Damage 6 — `errors.Is`/`As` bypass

Custom `AppError` interfaces propagate; consumers compare with `==` against package-level variables; wrapping breaks; sentinel checks miss. Production logs become useless.

---

## Inventory: Detecting Anti-Patterns at Scale

### Step 1 — Header interface count

```bash
# count interfaces with > 5 methods
grep -rEzo 'type \w+ interface \{[^}]+\}' --include='*.go' . \
  | awk -F'\n' '{ if (NF > 6) print $1 }'
```

A more reliable approach uses `go/types`:

```go
// quick AST tool sketch
ast.Inspect(file, func(n ast.Node) bool {
    if t, ok := n.(*ast.TypeSpec); ok {
        if i, ok := t.Type.(*ast.InterfaceType); ok && i.Methods != nil {
            if len(i.Methods.List) > 5 {
                fmt.Println(t.Name.Name, len(i.Methods.List))
            }
        }
    }
    return true
})
```

### Step 2 — Single-implementation interfaces

```bash
golangci-lint run --enable=ireturn,interfacebloat,unused
```

`ireturn` flags constructors returning interfaces. `interfacebloat` flags large interfaces. Cross-reference with `gopls workspace_symbol` to find single-implementation cases.

### Step 3 — Pointer-to-interface

```bash
grep -rE '\*(io\.Reader|io\.Writer|io\.Closer|fmt\.Stringer|error)\b' --include='*.go' .
grep -rE 'func\s+\w+\([^)]*\*[A-Z][A-Za-z0-9_]+er\b' --include='*.go' .
```

Both surface common pointer-to-interface mistakes.

### Step 4 — Mock-to-impl ratio

```bash
M=$(find . -name '*_mock.go' | wc -l)
P=$(find . -name '*.go' ! -name '*_mock.go' ! -name '*_test.go' | wc -l)
echo "ratio = $M / $P"
```

If `M / P > 0.10` you have mock-driven design.

### Step 5 — Typed-nil audit (staticcheck)

```bash
staticcheck -checks SA4023 ./...
```

`SA4023` warns "comparison of typed-nil and untyped-nil never equal." It's the mechanical detector for the famous gotcha. Add it to CI.

### Step 6 — `interfaces.go` hubs

```bash
find . -name 'interfaces.go' -o -name 'interface.go' | xargs -I{} echo "Hub: {}"
```

Each hit is a candidate for dispersion.

---

## Refactoring Strategy: Strangler vs Big-Bang

### Strangler — preferred for live systems

1. Add the new struct-returning constructor next to the old interface-returning one. Mark old one `// Deprecated`.
2. Migrate one consumer at a time to the new constructor.
3. When all consumers are migrated, delete the old constructor and (if no one needs it) the interface.

```go
// Old
func New() Repo { return &repo{} }

// New, side-by-side
func NewRepo() *Repo { return &Repo{} }   // exported struct

// Old kept temporarily, will be deleted
//
// Deprecated: use NewRepo. The interface return is being removed.
func New() Repo { return NewRepo() }
```

### Big-bang — only when the codebase is small or test coverage is rock-solid

Touch every consumer in one PR. Easier to review structurally; risky for production. Best on weekend with a freeze.

### When to never refactor

If the interface is part of your public API, **breaking it costs your users a major version bump**. Plan around `v1`/`v2` directories or an entirely new package.

---

## Refactoring Recipe: Header Interface Removal

### Before

```go
// service/repo.go
type Repo interface {
    Find(id string) (*User, error)
    Save(*User) error
    Delete(id string) error
    List(filter Filter) ([]*User, error)
    Count() (int, error)
}

type pgRepo struct{ db *sql.DB }
func (r *pgRepo) Find(...)   { /* ... */ }
// ... five methods
```

### Step 1 — export the struct

```go
type PGRepo struct{ db *sql.DB }
func NewPGRepo(db *sql.DB) *PGRepo { return &PGRepo{db: db} }
func (r *PGRepo) Find(...)   { /* ... */ }
// ... five methods
```

### Step 2 — at each consumer, declare the smallest interface needed

```go
// pkg auth
type userFinder interface {
    Find(id string) (*User, error)
}

// pkg admin
type userListing interface {
    List(filter Filter) ([]*User, error)
    Count() (int, error)
}
```

### Step 3 — delete the original `Repo` interface

If anything still imports it, your refactor is incomplete.

### Step 4 — delete generated `_mock.go`

Each consumer-side interface has its own tiny fake (often inline in the test file).

---

## Refactoring Recipe: Mock Explosion Cleanup

### Before

```
billing/
├── service.go
├── service_test.go        // 800 lines, 90% mock setup
├── repository.go          // header interface
├── pg_repository.go
├── repository_mock.go     // 300 lines, generated
├── notifier.go            // header interface
├── notifier_smtp.go
├── notifier_mock.go       // 200 lines
```

### Step 1 — replace mocks with hand-written fakes

```go
type fakeRepo struct {
    users map[string]*User
    err   error    // injectable for failure scenarios
}
func (f *fakeRepo) Find(id string) (*User, error) {
    if f.err != nil { return nil, f.err }
    return f.users[id], nil
}
```

A 30-line fake replaces a 300-line mock and **exercises real code paths**.

### Step 2 — shrink the interface to what the test consumes

If only `Find` and `Save` are touched, the test-side interface has only those two methods.

### Step 3 — consider integration tests

`testcontainers-go` spins up a Postgres container in seconds. For storage code, integration tests catch bugs that mocks never can. Mocks for HTTP clients can be replaced by `httptest.Server`.

### Step 4 — delete `_mock.go` files

Run CI. Anything that breaks tells you what was secretly relying on the mock-shaped interface.

---

## Refactoring Recipe: Typed-Nil Audit

### Step 1 — enable `SA4023` in CI

```yaml
# .golangci.yml
linters:
  enable:
    - staticcheck
issues:
  exclude-rules: []
linters-settings:
  staticcheck:
    checks: ["all", "SA4023"]
```

### Step 2 — search for the pattern

```bash
grep -rE 'var\s+\w+\s+\*\w+(Err|Error)\b' --include='*.go' .
```

Each match is a candidate where someone declared a typed pointer of an error type. Inspect every `return` afterwards.

### Step 3 — fix incrementally

Replace `return err` (where `err` is `*MyErr`) with explicit branches:

```go
// Before
var err *MyErr
if condition { err = &MyErr{...} }
return err

// After
if condition {
    return &MyErr{...}
}
return nil
```

### Step 4 — add a regression test

```go
func TestNoTypedNil(t *testing.T) {
    if err := work(); err != nil {
        t.Fatalf("expected nil, got typed-nil: %v (%T)", err, err)
    }
}
```

### Step 5 — write a custom analyzer (large codebases)

For a high-stakes service, a custom `golang.org/x/tools/go/analysis` analyzer can detect the pattern at PR time:

```go
// Analyzer pseudo-code:
// 1. Find functions returning interface I.
// 2. For each return, if the operand is a *T variable that may be nil and T implements I,
//    flag it.
```

---

## Refactoring Recipe: `interfaces.go` Dispersion

### Step 1 — list every interface

```bash
awk '/^type \w+ interface/{print FILENAME":"NR":"$0}' \
  internal/interfaces.go
```

### Step 2 — for each interface, find consumers

```bash
gopls references "internal.Repo"
```

### Step 3 — move the interface into its primary consumer's package

If two packages share it, consider whether they really do or whether each needs a smaller subset.

### Step 4 — delete the hub

Once empty, `internal/interfaces.go` and any related package can go. Run `go vet ./...` and `go build ./...`.

---

## Governance: Style Guide Entries

Add the following rules to your team Go style guide:

1. **Accept interfaces, return structs.** Constructors return concrete types unless the package's documented purpose is to publish an interface (e.g. `io`, `http`, `database/sql`).
2. **Define interfaces near consumers.** A package may export an interface only when it forms part of the package's public contract.
3. **Don't generate mocks unless you have at least two real implementations.** Use hand-written fakes for tests by default.
4. **Maximum interface size: 5 methods.** Larger interfaces require a written justification in the package doc comment.
5. **Never use `*Interface`.** A pull request introducing it is auto-rejected.
6. **Errors are `error`, not custom interfaces.** Domain error types are concrete structs unwrapped via `errors.As`.
7. **Functions returning `error` use literal `nil` returns.** Typed-nil is forbidden.
8. **`String()` and `Error()` must not allocate heavily, panic, or recurse.** Reviewers check this on every PR.
9. **No `Get`/`Set` interfaces.** Use struct fields or behavioral methods.
10. **No `Animal`/`Shape`/`Vehicle` style hierarchies.** Decompose by capability.

### Style guide structure example

```
docs/
└── go-style.md
    # Section 7 — Interfaces
    7.1 Accept interfaces, return structs
    7.2 Define interfaces near consumers
    7.3 Maximum 5 methods
    7.4 No pointer-to-interface
    7.5 Mock-driven design forbidden
    7.6 Typed-nil forbidden (CI: SA4023)
    7.7 Errors are error
```

---

## Governance: Linter Pipeline

```yaml
# .golangci.yml
linters:
  enable:
    - errcheck         # forces error handling
    - staticcheck      # SA4023 typed-nil
    - revive           # unused-parameter, exported, receiver-naming
    - ireturn          # constructor returning interface
    - interfacebloat   # > 10-method interface
    - gocritic         # paramTypeCombine, ifElseChain
    - unused           # dead code
    - errorlint        # encourages errors.As/Is
    - goconst          # repeated literals
    - gocyclo          # cyclomatic complexity
linters-settings:
  ireturn:
    allow:
      - error
      - empty
      - anon
      - stdlib
  interfacebloat:
    max: 5
  staticcheck:
    checks: ["all"]
```

Add to CI:

```yaml
# .github/workflows/lint.yml
- run: golangci-lint run ./...
- run: go vet ./...
- run: staticcheck -checks SA4023 ./...
```

Block merges on any failure.

---

## Code Review Checklist

When reviewing a PR involving interfaces, confirm:

- [ ] Is there a real consumer that needs polymorphism?
- [ ] Is the interface declared at the consumer side?
- [ ] Method count ≤ 5?
- [ ] No `Get`/`Set` boilerplate?
- [ ] No `*Interface` parameters?
- [ ] Constructor returns the struct, not the interface?
- [ ] Functions returning `error` use literal `nil`?
- [ ] Custom errors are concrete structs, used via `errors.As`?
- [ ] `String()` / `Error()` are cheap, panic-free, recursion-safe?
- [ ] Mock generation justified by ≥ 2 real implementations?
- [ ] No "Animal-style" interface dragging multiple unrelated capabilities?
- [ ] Interface signatures use primitives or stdlib types — not deep domain types?

---

## Cheat Sheet

```
SCALE DAMAGE
─────────────────────────────
Compile amplification, test brittleness,
onboarding tax, refactor paralysis,
leaky-cache crashes, errors.Is bypass

INVENTORY TOOLS
─────────────────────────────
golangci-lint: ireturn, interfacebloat
staticcheck SA4023 — typed-nil
grep '\*io\.Reader' / '\*Mailer' — pointer-to-interface
mock-to-impl ratio script

REFACTOR STRATEGIES
─────────────────────────────
Strangler — preferred for live systems
Big-bang — only with rock-solid tests
Header interface removal: export struct, declare consumer-side I
Mock cleanup: hand-written fake | testcontainers | httptest
Typed-nil audit: CI SA4023 + manual sweep

GOVERNANCE
─────────────────────────────
Style guide section 7 — interfaces
Linters: errcheck, staticcheck, revive, ireturn, interfacebloat
PR review checklist (12 items)
```

---

## Summary

At professional level, interface anti-patterns are an organizational cost:

1. **Damage** — compilation, tests, onboarding, refactors, production.
2. **Inventory** — automated detection via linters and AST tools.
3. **Refactoring** — strangler patterns; one-by-one consumer migration.
4. **Governance** — style guide rules, linter pipeline, code review checklist.

The lesson: anti-patterns are not "bad code" but **bad architecture compounding over time**. Stopping them at PR review is cheaper by an order of magnitude than fixing them after deploy.
