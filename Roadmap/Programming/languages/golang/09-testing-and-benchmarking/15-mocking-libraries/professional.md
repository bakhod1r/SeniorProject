---
layout: default
title: Mocking Libraries — Professional
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/professional/
---

# Mocking Libraries — Professional

[← Back](../)

## 1. Migrating from `github.com/golang/mock` to `go.uber.org/mock`

Google archived `github.com/golang/mock` on 2023-06-20. The fork at
`go.uber.org/mock` is the maintained successor with identical public API
(`gomock.NewController`, `EXPECT()`, `mockgen`). Migration steps:

1. Update go.mod: replace `github.com/golang/mock` with `go.uber.org/mock`
   at the latest minor (`v0.4.0` at time of writing).
2. Run a project-wide import rewrite:

   ```bash
   gofmt -r '"github.com/golang/mock/gomock" -> "go.uber.org/mock/gomock"' \
       -w $(find . -name '*.go')
   ```

3. Reinstall the generator:
   `go install go.uber.org/mock/mockgen@latest`.
4. Regenerate all mocks (`go generate ./...`) so the file header references
   the new module.
5. Add a `tools.go` file pinning the version:

   ```go
   //go:build tools
   package tools

   import _ "go.uber.org/mock/mockgen"
   ```

   This lets `go mod tidy` keep the generator in `go.mod` even though no
   production code imports it.

API-level changes worth knowing:

- `gomock.NewController(t)` now auto-registers `t.Cleanup(ctrl.Finish)`.
  Explicit `defer ctrl.Finish()` becomes redundant.
- Generics are supported: `mockgen` correctly handles
  `interface Repo[T any] { Get(id string) T }`.
- New matcher `gomock.Cond` allows inline predicates without writing a
  full `Matcher` type.

## 2. Where to put generated mocks

Three common layouts, in order of decreasing coupling:

### a. Alongside the interface, same package

```
internal/store/store.go            // type UserRepo interface { ... }
internal/store/store_mock.go       // package store (generated)
```

Pros: same package can access unexported types; no import cycle.
Cons: production binary includes mock code unless build tags filter it.

### b. Sibling `mocks/` subpackage

```
internal/store/store.go
internal/store/mocks/UserRepo.go   // package mocks
```

Pros: production binary is clean; clear ownership; `linguist-generated`
attribute hides files from PR diffs.
Cons: cannot mock unexported interfaces; tests must import `mocks`.

### c. Centralized `internal/testutil/mocks/`

```
internal/store/store.go
internal/testutil/mocks/store/UserRepo.go
```

Pros: one place to look for any mock.
Cons: import paths get long; deletion of an interface leaves orphaned mocks.

Recommendation: layout (b) for any team larger than two engineers.
Layout (a) is fine for a solo project. Avoid (c) — it scales poorly.

## 3. Mock-driven design pitfalls

### Pitfall — every collaborator becomes an interface

A test-driven mindset can lead to declaring an interface for every
collaborator just so it can be mocked. The codebase ends up with
`type FooDoer interface { Do(x int) }` everywhere, used in exactly one
production site and one test. This is **interface inflation** and it hurts:

- Reading the code requires jumping through indirection.
- Refactoring (adding one method to the implementation) breaks the mock.
- The interface is a YAGNI artifact: Go's structural typing means callers
  can define narrow interfaces at the use site without the producer
  exporting them.

Rule of thumb: declare an interface only when there are two real
implementations *or* the mock is necessary for unrelated reasons (e.g. the
real implementation hits the network).

### Pitfall — over-specified mocks

```go
repo.EXPECT().Get(gomock.Any(), "u1").Return(&User{ID: "u1"}, nil)
repo.EXPECT().Save(gomock.Any(), gomock.Any()).Return(nil)
log.EXPECT().Info("creating user").Times(1)
metrics.EXPECT().Inc("user.create").Times(1)
```

This test asserts on logging and metrics that are incidental to the
behavior. When somebody changes the log message or metric name, the test
breaks even though nothing user-facing changed. Mocks should assert on
**contracts the SUT must honor**, not on implementation details.

### Pitfall — testing the mock, not the SUT

```go
repo.EXPECT().Get("u1").Return(&User{ID: "u1", Name: "Alice"}, nil)
u, err := svc.Get(ctx, "u1")
assert.Equal(t, "Alice", u.Name)
```

If `svc.Get` simply forwards to `repo.Get`, the test only proves the mock
returns what it was told to return. The actual logic is untested. Either
add behavior to test or test at a higher integration level.

## 4. Mocks vs in-memory fakes

A **fake** is a working implementation, suitable for tests, of the same
interface. Compare:

```go
// Mock-based test
repo.EXPECT().Save(ctx, &User{ID: "u1"}).Return(nil)
repo.EXPECT().Get(ctx, "u1").Return(&User{ID: "u1"}, nil)
svc.CreateAndFetch(ctx, "u1")

// Fake-based test
repo := &fakeUserRepo{data: map[string]*User{}}
svc.CreateAndFetch(ctx, "u1")
require.Equal(t, "u1", repo.data["u1"].ID)
```

The fake-based test asserts on observable state. The mock-based test
asserts on the sequence of calls. If you change the implementation so it
no longer calls `Get` (e.g. it returns the saved object directly), the
mock-based test breaks but the fake-based test still passes — because the
observable behavior did not change.

A well-written fake (~80 lines for a typical CRUD repo) pays for itself
within ten tests. Build one when you find yourself repeating the same
`EXPECT()` ritual in test after test.

## 5. Choosing per layer

- **HTTP clients** — usually `jarcoal/httpmock` (patches transport) or
  `httptest.NewServer` (real server in-process). Avoid mocking
  `http.Client` interfaces.
- **Database** — usually `go-sqlmock` for low-level driver tests; for
  domain repositories, write a fake.
- **gRPC** — `bufconn` for end-to-end-in-process tests; gomock for client
  callers of generated `pb.XClient` interfaces.
- **Redis** — `go-redismock` for client tests; an in-memory map for
  domain caches.
- **Files** — `afero.NewMemMapFs()` rather than mocking `os.File`.

The pattern: prefer a real-implementation-in-memory over a mock whenever
the real implementation is cheap to construct.

## 6. Contract testing — keeping fakes honest

A fake repository runs the risk of drifting from the real one. Counter
it with a contract test: a single test that runs against both
implementations and asserts the same behavior:

```go
type RepoTester struct {
    NewRepo func(t *testing.T) UserRepo
}

func (rt *RepoTester) Run(t *testing.T) {
    t.Run("save then get", func(t *testing.T) {
        repo := rt.NewRepo(t)
        ctx := context.Background()

        u := &User{ID: "u1", Name: "Alice"}
        require.NoError(t, repo.Save(ctx, u))

        got, err := repo.Get(ctx, "u1")
        require.NoError(t, err)
        require.Equal(t, "Alice", got.Name)
    })

    t.Run("get not found", func(t *testing.T) {
        repo := rt.NewRepo(t)
        _, err := repo.Get(context.Background(), "missing")
        require.ErrorIs(t, err, ErrUserNotFound)
    })
}

// Run against the fake
func TestFakeUserRepo(t *testing.T) {
    rt := &RepoTester{NewRepo: func(t *testing.T) UserRepo {
        return userfakes.New()
    }}
    rt.Run(t)
}

// Run against a real PostgreSQL via testcontainers
func TestPostgresUserRepo(t *testing.T) {
    if testing.Short() { t.Skip() }
    rt := &RepoTester{NewRepo: func(t *testing.T) UserRepo {
        return setupPostgresRepo(t)
    }}
    rt.Run(t)
}
```

The fake test runs in CI on every push (fast). The PostgreSQL test runs
in a nightly job (slow). Both share the assertion suite. If the fake
drifts (e.g. forgets to return `ErrUserNotFound`), one of the two test
runs catches it.

This pattern is the strongest argument for fakes plus contract tests
over pure mocks: you get the speed of in-memory testing and the fidelity
of real integration testing, sharing one test definition.

## 7. The gomock-to-fake refactoring playbook

When you decide to migrate a mock-heavy package to fakes:

1. Identify the most-mocked interface (count `EXPECT()` calls per
   interface).
2. Write a minimal fake implementation in `internal/<pkg>/fakes/`.
3. Refactor one test at a time. For each test:
   - Replace `mocks.NewMockX(ctrl)` with `fakes.NewX()`.
   - Replace `repo.EXPECT().Get(...).Return(u, nil)` with
     `repo.Save(ctx, u)` (i.e. pre-populate the fake).
   - Replace post-hoc verifications with state inspections on the fake.
4. After all tests are migrated, delete the generated mock.

A typical 200-line test file shrinks to 80 lines after migration, and
the tests become refactor-resilient. The fake adds ~50 lines but is
written once and shared.

## 8. Mocks across module boundaries

If your codebase is split into multiple modules (a monorepo with
separate `go.mod` files per service), mock placement becomes more
complex:

- Mocks for interfaces defined in module A, used by module B, must live
  in module B (or a shared module both depend on).
- If A's interface changes, B's mocks become stale; CI must detect this.
- Versioning matters: B depending on A v1.2 must regenerate mocks if A
  bumps to v1.3 with a method change.

A pattern that works: each module owns its own mocks in
`<module>/mocks/`. Shared interfaces live in a `pkg/contracts` module
that both A and B depend on, and mocks for those contracts also live in
`pkg/contracts/mocks`.

## 9. Mocks and AI-assisted code generation

Modern AI tools can generate mock implementations from interface
declarations. Caveats:

- Generated code may be subtly wrong (untyped nil handling, missing
  mutexes). Always run it through `go vet` and read it.
- For maintained libraries (mockery, mockgen, moq), prefer the official
  generator. The output is predictable and contributors recognize it.
- AI is useful for one-off interfaces in scripts or prototypes where
  installing a generator isn't worth it.

A reasonable workflow: AI for prototype, swap to official generator
when the prototype graduates to production code.

## 10. The strategic close

Mocks are a means, not an end. The goal is **tests that catch real
bugs, run fast, and don't break on refactors**. Mocks help when:

- The dependency is expensive or unsafe (real database, real network).
- The interaction pattern is the assertion (number of calls, order).
- The dependency doesn't exist yet (TDD against a new interface).

Mocks hurt when:

- The mock setup is longer than the SUT.
- The test breaks on every refactor.
- The mock encodes implementation details that don't matter to callers.

The senior judgment is knowing which side of that line each test sits
on. Junior engineers tend to over-mock; senior engineers tend to
under-mock. Aim for the middle: mock what you must, fake what you can,
and use real implementations whenever they fit in memory.

## 11. Tactical checklist for your next PR

When reviewing or writing a PR with new mock-based tests:

- [ ] Is the mocked interface narrow (5 methods or fewer)? Wide
  interfaces invite mock-heavy tests.
- [ ] Does each mock expectation correspond to a behavior the SUT
  must guarantee? Or is it incidental (logging, metrics)?
- [ ] Could a fake or in-memory implementation replace the mock?
- [ ] Are there at least three test cases varying the mock's return
  value, so the SUT is really exercised?
- [ ] Will the test still pass if the SUT is refactored to call
  dependencies in a different order? (If not, do you really care
  about order?)
- [ ] Does the mock library auto-verify expectations at cleanup?
- [ ] Is the mock file marked as generated and excluded from coverage?

If most boxes are checked, the test is in good shape. If many are
unchecked, the test will become a maintenance burden.

## 12. Long-term: investing in test infrastructure

Test infrastructure is code you write once and reap from for years.
Worth investing in:

- `testutil/grpctest` — the bufconn helper from senior.md section 16.
- `testutil/httputil` — the httptest helper from senior.md section 17.
- `testutil/dbutil` — testcontainers helpers for PostgreSQL.
- `internal/<pkg>/fakes/` — in-memory fakes per package.
- A consistent mockery or mockgen configuration.
- CI checks that mocks are up to date and tests run with race detector.

Engineering managers underrate this kind of investment because the
benefit shows up over years, not weeks. As an individual engineer, you
can build it incrementally — one helper per sprint — and the
compounding speedup makes you significantly more productive than peers
who reinvent the same setup in every test file.

That's the end of the strategic material. Apply it gradually; don't
rewrite your codebase in a week.

## 13. Case study — a service that grew mock-heavy

A real example, anonymized. A payment processing service had 18
interfaces, each generated as a gomock-style mock. The test suite was
4,200 tests, total runtime 90 seconds. Most tests were 50–100 lines of
mock setup followed by 5 lines of assertion.

Symptoms over 18 months:

- Each new feature required modifying 20+ tests because internal call
  patterns shifted.
- New engineers took two weeks to write their first non-trivial test.
- A refactor that "should be a no-op" routinely broke 50+ tests.
- Test coverage was 85% but production incidents revealed test gaps
  that mocks had hidden.

Resolution, over six months:

1. Identified the top 5 mocked interfaces. Three were repositories.
2. Wrote in-memory fakes for the three repositories (~80 lines each).
3. Migrated tests in waves, one feature area per sprint.
4. Kept gomock for the remaining "side effect" interfaces (notifier,
   metrics, audit log).
5. Added contract tests for the fakes versus real PostgreSQL,
   running nightly.

After:

- Test suite shrank to ~2,800 tests (consolidated duplicates).
- Runtime dropped to 35 seconds.
- New-engineer ramp-up dropped from 2 weeks to 3 days.
- The next major refactor (rewriting the queueing layer) modified ~12
  tests, down from an estimated 200.

The lesson: mocks aren't free. The cost is invisible at first because
each new mock-based test feels productive. Over years, the cost
compounds. Recognizing this pattern early — when you find yourself
writing the same mock setup repeatedly — and investing in fakes pays
back many times over.

## 14. Edge case — mocking methods that return interfaces

A subtle source of test brittleness:

```go
type Encoder interface {
    Encode(v any) ([]byte, error)
}

type EncoderFactory interface {
    For(format string) (Encoder, error)
}
```

If you mock `EncoderFactory.For`, the mock returns... another mock?
That's two layers of mock setup for one operation. Often a sign the
abstraction is over-engineered. Consider:

- Inline the factory: pass an `Encoder` directly to the SUT.
- Use a real factory with multiple registered encoders.
- Use a single concrete `Encoder` (e.g. JSON) until you actually need
  alternatives.

Layered mocks are a code smell. If you have them, push for redesign
before adding more.

## 15. The hidden cost of mock libraries on CI

Every mock library adds something to your CI surface:

- gomock: requires `mockgen` installed. CI must `go install` it.
- mockery: same. Plus `.mockery.yaml` must be in repo.
- moq: requires the import in `tools.go`.
- counterfeiter: same.

This is small per library, but multiple libraries multiply the CI
configuration. A consistent rule: one mocking library per repo. Mixing
gomock and mockery in the same codebase is a smell unless you have a
documented migration plan.

The downstream cost: each generator's version pinned in `go.mod`.
Bumping gomock breaks if the generated code uses a removed API. Test
your generator-update flow on a branch before rolling it out.

## 16. Mock-driven design — when it actually helps

Despite the warnings about mock-driven design pitfalls, there are
scenarios where designing around mockable interfaces helps:

- **External dependencies you don't control** (third-party APIs).
  Mocking is the only way to test edge cases like rate-limit responses
  or partial failures.
- **Plug-in architectures**. Each plug-in implements an interface; the
  test framework provides mock plug-ins for testing the host.
- **Compliance-driven assertions**. "We must call the audit log exactly
  once per transaction" is a behavioral spec that a mock expresses
  more directly than a fake.

In these cases, the interface-and-mock pattern is the cleanest
approach. The art is recognizing the difference between "this needs a
mock" and "this is a wrapper around state that wants a fake".

## 17. Versioning generated mocks

Generated mocks live in your repo. When you update the generator:

```
go.mod: go.uber.org/mock v0.3.0 → v0.4.0
```

Run `go generate ./...` and inspect the diff. If the diff is large, the
new generator emits different code (perhaps better type safety, perhaps
internal restructure). Commit the regeneration as a separate PR titled
"chore: regenerate mocks after go.uber.org/mock v0.4.0 upgrade". This
separates mechanical regeneration from behavioral changes.

If you skip this step, the next PR that regenerates a single mock
(after adding a method to one interface) drags in the noise of the
generator upgrade. Reviewers get confused. Always regenerate
proactively after a generator upgrade.

## 18. Logging in mocks

Sometimes you want a mock to log what it received without asserting on
it. Easy with `Do`:

```go
repo.EXPECT().Save(gomock.Any(), gomock.Any()).
    Do(func(ctx context.Context, u *User) {
        t.Logf("Save called with %+v", u)
    }).
    Return(nil).
    AnyTimes()
```

Combined with `-v` test output, this is a great debugging tool when
tests fail in unexpected ways. Don't ship these in committed tests
(noisy logs in CI), but use them locally to diagnose flakes.

## 19. The cost of `AnyTimes`

A small but common anti-pattern. A test file uses `AnyTimes()` on every
expectation for convenience:

```go
repo.EXPECT().Get(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
notifier.EXPECT().Notify(...).Return(nil).AnyTimes()
metrics.EXPECT().Inc(...).AnyTimes()
```

Now the test passes regardless of whether the SUT calls these
dependencies. The strict-by-default benefit of gomock is gone.

Heuristic: use `AnyTimes()` only when you genuinely don't care about
call count. If you wrote `AnyTimes()` to avoid figuring out the exact
count, replace it with `MinTimes(1)` and let the test fail if the
dependency isn't exercised.

## 20. End

You now have:

- The migration path from `github.com/golang/mock` to
  `go.uber.org/mock`.
- A decision framework for mock placement.
- A list of common mock-driven design pitfalls.
- The contract-testing pattern for keeping fakes honest.
- A case study showing the long-term cost of over-mocking.
- Tactical and strategic checklists.

Combined with the practical knowledge from `junior.md`, `middle.md`,
and `senior.md`, you should be able to design, implement, and review
test setups in a Go service of any size. The remaining files
(`specification.md`, `interview.md`, `tasks.md`, `find-bug.md`,
`optimize.md`) are reference and practice material.

## 21. A note on test parallelism with mocks

Each test should generally call `t.Parallel()` to maximize throughput.
Mock-based tests are usually safe to parallelize because:

- gomock controllers are per-test.
- mockery's `NewMockX(t)` constructor is per-test.
- moq fakes are per-test.

But shared state can sneak in:

- Package-level variables that the SUT reads.
- `httpmock.Activate()` patches a global; cannot parallelize across
  tests using DefaultTransport.
- `time.Now` if used directly; inject a clock.

The standard rule: parallelize unless something concrete prevents it.
For the few cases where you can't (e.g. httpmock-using tests), keep
them in a single non-parallel test function and document why.

## 22. Defensive coding around mocks

A test SUT often contains code like:

```go
if s.notifier != nil {
    s.notifier.Notify(...)
}
```

The `nil` check is a hedge against tests that forgot to provide a
notifier. It's a code smell: the SUT should require a non-nil
collaborator, and tests should provide one — possibly a no-op fake. Add
a `NoOp` implementation:

```go
type NoOpNotifier struct{}
func (NoOpNotifier) Notify(context.Context, string, string) error { return nil }
```

Use it in tests that don't care about notifications. Now the SUT can
drop the nil check and the contract is clearer: "a Notifier is
required; here's a no-op for when you don't need real notification."

## 23. Avoid global mock registries

Some test frameworks let you register a mock once and use it across
many tests:

```go
// BAD
var globalRepoMock = mocks.NewMockUserRepo(nil)

func TestA(t *testing.T) { globalRepoMock.EXPECT().Get(...) /* ... */ }
func TestB(t *testing.T) { globalRepoMock.EXPECT().Save(...) /* ... */ }
```

Anti-pattern: tests pollute each other's expectations, parallelism
breaks, debugging is hard. Always create mocks per test. If shared
setup is genuinely useful, use a helper function that returns a fresh
mock with common configuration applied.

## 24. Documenting mock usage in your repo

Add a `TESTING.md` (or section in CONTRIBUTING.md) covering:

- Which mocking library this repo uses.
- How to regenerate mocks (`make mocks`, `go generate ./...`).
- Where to place new mocks.
- The repo's convention for fakes vs mocks per layer.

Contributors are otherwise left to guess from existing files, which
leads to inconsistent patterns over time. A 30-line testing doc pays
off forever.

## 25. Closing

These nineteen sections, plus the related files in this subsection,
should give you a complete view of mocking in Go: the libraries, the
patterns, the trade-offs, and the strategic decisions that determine
whether your test suite ages gracefully. The hardest skill to develop
is the judgment of when to mock and when not to. That judgment comes
from practice — write tests, refactor them, observe what survives. The
mocking library is just the tool; the skill is in deciding what to
mock and what to leave alone.
