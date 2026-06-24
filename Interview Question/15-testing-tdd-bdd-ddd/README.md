# Testing — TDD / BDD / DDD

> Senior Go backend interview questions covering TDD discipline, Go testing idioms, the test pyramid, test doubles, designing for testability, BDD with Gherkin, Domain-Driven Design and how it shapes tests, and coverage/contract/property/mutation testing.

**38 questions** across **9 topics** · Level: senior

## Topics

- [TDD Fundamentals](#tdd-fundamentals) (5)
- [Go Testing Idioms](#go-testing-idioms) (8)
- [Test Pyramid & Reliability](#test-pyramid-reliability) (3)
- [Test Doubles & Mocking](#test-doubles-mocking) (3)
- [Designing for Testability](#designing-for-testability) (4)
- [BDD & Executable Specifications](#bdd-executable-specifications) (3)
- [Domain-Driven Design](#domain-driven-design) (5)
- [Testing with Real Infrastructure](#testing-with-real-infrastructure) (2)
- [Coverage, Contract & Property Testing](#coverage-contract-property-testing) (5)

---

## TDD Fundamentals

#### 1. Walk me through the red-green-refactor cycle and explain what each phase actually buys you.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `tdd`, `red-green-refactor`, `design`

**Red**: write a failing test that expresses the next increment of behavior, then run it to confirm it fails *for the right reason*. **Green**: write the minimum code to pass — even something hard-coded — proving the test can pass. **Refactor**: with a green bar as a safety net, improve the design (extract functions, remove duplication, rename) while keeping tests green.

The value isn't just coverage. Red proves the test can fail, so you're not shipping a tautological test. Green keeps scope tiny, preventing speculative generality. Refactor is where design emerges — TDD is a *design* discipline more than a testing one. The discipline forces small steps, fast feedback, and a runnable spec of intent. Skipping refactor is the most common failure: you accumulate green-but-ugly code and lose the main payoff.

**Key points**
- Run the test in red to confirm it fails for the right reason
- Green = minimum code, even hard-coded, to avoid over-engineering
- Refactor is where design emerges — skipping it loses the main benefit
- TDD is primarily a design feedback loop, not just coverage

**Follow-ups**
- How do you avoid the test becoming a copy of the implementation?
- What does 'failing for the right reason' protect against?

---

#### 2. Where does TDD pay off and where does it actively slow you down?

*Difficulty:* 🟡 medium  ·  *Tags:* `tdd`, `trade-offs`, `pragmatism`

TDD pays off where behavior is well-understood but logic is intricate and easy to get subtly wrong: business rules, parsers, money/tax calculations, state machines, algorithmic code, and anything with many edge cases. There the tests double as a spec and the tight loop catches regressions cheaply.

It slows you down when you don't yet know the shape of the solution — exploratory/spike work, UI layout, integration glue against an unfamiliar API, or throwaway prototypes. Writing tests first against an unknown interface means rewriting tests every time the design shifts. The pragmatic move: spike to learn, throw the spike away, then TDD the real thing. Also weak where the cost of a wrong test is high — e.g. tests so coupled to implementation that every refactor breaks them. TDD is a tool, not a religion; the senior judgment is knowing the domain's stability before committing to test-first.

**Key points**
- Pays off: intricate, well-understood logic with many edge cases
- Slows down: exploratory/spike work where the design is unknown
- Spike to learn, discard, then TDD the real implementation
- Test-first against an unstable interface causes churn

**Follow-ups**
- How do you decide when a spike is 'done learning'?
- Have you ever deleted tests on purpose? When?

---

#### 3. Test-first vs test-after — does it matter if the tests end up identical?

*Difficulty:* 🟡 medium  ·  *Tags:* `tdd`, `test-first`, `design-pressure`

Even if the final test suite looked identical, the *process* differs and that difference shows up in the production code. Test-first constrains the design: you can only call code through its public surface, so you naturally arrive at smaller, injectable, decoupled units — testability is a forcing function for good boundaries. Test-after tends to test whatever you already built, so untestable designs (global state, hidden dependencies, fat constructors) survive because you bend the test around them with heavy mocking.

Test-first also gives you the red bar, which test-after silently skips — a test-after test that's secretly never-failing is common. In practice senior teams mix both: test-first for core domain logic where design matters, test-after for stable glue code where the design is already settled. The honest answer is that test-first's real product is the design pressure, not the tests.

**Key points**
- Test-first applies design pressure toward decoupled, injectable units
- Test-after often bends tests around an already-untestable design
- Test-after can ship tests that never actually fail
- Mixed approach is normal: test-first for domain, test-after for glue

**Follow-ups**
- How would you catch a test-after test that never fails?
- Give an example where test-first changed your API shape.

---

#### 4. Classicist vs mockist TDD — explain the London vs Detroit/Chicago schools and which you default to in Go.

*Difficulty:* 🟠 hard  ·  *Tags:* `tdd`, `london-school`, `mockist`, `classicist`

**Detroit/Chicago (classicist)**: test through real collaborators, verify *state* (the output / observable result), and mock only at true boundaries (network, DB, clock). Tests are coarser, survive refactors well, but can be slower and pinpoint failures less precisely. **London (mockist)**: isolate the unit fully, inject mocks for every collaborator, and verify *interactions* (which methods were called with what). Tests are fast and precise about the unit, drive interface discovery top-down, but couple tightly to call structure — refactoring the collaboration breaks many tests even when behavior is unchanged.

In Go I default classicist. Go's small interfaces, hand-written fakes, and value-oriented domain types make state-based testing cheap and refactor-friendly. I reach for interaction-based (mockist) testing only where the *interaction itself is the contract* — e.g. 'did we publish exactly one domain event', 'did we call the payment gateway idempotently'. Over-mockist Go suites become change-detector tests that resist the very refactoring TDD is supposed to enable.

**Key points**
- Classicist verifies state; mockist verifies interactions
- Mockist drives interface discovery but couples to call structure
- Go idioms (small interfaces, value types) favor classicist by default
- Use interaction-based only when the interaction IS the contract


```go
// State-based (classicist): assert on the result
order, err := svc.Place(ctx, cart)
require.NoError(t, err)
assert.Equal(t, StatusPlaced, order.Status)
assert.Equal(t, money.USD(4200), order.Total)

// Interaction-based (mockist): the call IS the contract
require.Len(t, fakeBus.Published, 1)
assert.IsType(t, OrderPlaced{}, fakeBus.Published[0])
```

**Follow-ups**
- When is a change-detector test actually what you want?
- How do small Go interfaces change this debate vs Java?

---

#### 5. How do you keep a TDD test from just being a restatement of the implementation?

*Difficulty:* 🟠 hard  ·  *Tags:* `tdd`, `behavior`, `change-detector`

Test behavior at the boundary, not internals. A test that mirrors the implementation will assert on private steps, mock every collaborator, and check call order — so any refactor breaks it without catching a single real bug. The discipline: phrase each test as an observable outcome a caller cares about ('placing an order below the minimum returns ErrBelowMinimum'), and assert only on the public result or genuine side effects.

Concrete tactics: drive inputs through the exported API; assert on returned values, errors, and externally-visible effects (a published event, a row written), not on intermediate variables; avoid mocking pure functions or in-process collaborators; and prefer fakes over strict mocks so you're not asserting on internal sequencing. A good smell check: if you can do a legitimate refactor (extract a helper, reorder independent steps) and tests still pass, they test behavior. If they break, they test implementation.

**Key points**
- Assert on observable outcomes, not internal steps or call order
- Drive inputs through the exported API only
- Don't mock pure functions or in-process collaborators
- Refactor smell test: legit refactors shouldn't break behavioral tests

**Follow-ups**
- What side effects count as 'observable' vs 'internal'?
- How do you test a function that has no return value?

---

## Go Testing Idioms

#### 6. Why are table-driven tests the Go idiom, and what are their failure modes?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `go`, `table-driven`, `subtests`

Table-driven tests express many cases as data: a slice of structs with inputs and expected outputs, looped over with one assertion block. They keep cases dense and reviewable, make adding an edge case a one-line change, and pair naturally with `t.Run` subtests for isolation and named failures.

Failure modes: (1) over-generalizing — when cases need different setup or assertions, cramming them into one table adds conditional logic that's harder to read than separate tests; (2) opaque failures if you don't name each case or use `t.Run`, so you can't tell which row failed; (3) tables that grow a `wantErr bool` plus five other flags become a mini-DSL nobody understands. The senior rule: a table is for *homogeneous* cases varying only in data. The moment branches appear inside the loop, split it. Always name cases and use subtests so `go test -run TestX/case_name` works.

**Key points**
- Cases as data → dense, reviewable, cheap to extend
- Always pair with t.Run + named cases for targeted failures
- Anti-pattern: heterogeneous cases forced into one table with branches
- Use for homogeneous cases varying only in inputs/expectations


```go
func TestParse(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    int
		wantErr bool
	}{
		{"valid", "42", 42, false},
		{"empty", "", 0, true},
		{"overflow", "99999999999999999999", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.in)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}
```

**Follow-ups**
- When would you NOT use a table-driven test?
- How does t.Run change the way you run a single case?

---

#### 7. Explain t.Parallel() and the classic loop-variable capture bug. Has Go 1.22 changed anything?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `t.Parallel`, `concurrency`, `go1.22`

`t.Parallel()` signals a subtest can run concurrently with other parallel siblings. The parent collects parallel subtests, then runs them together after the sequential body returns — which is why parallel subtests see the *final* state of any shared setup.

The classic bug: before Go 1.22, a `for _, tt := range tests` loop variable was shared across iterations, so a parallel subtest closing over `tt` would observe the last element — every parallel case tested the same row. The fix was `tt := tt` shadowing inside the loop. **Go 1.22 made loop variables per-iteration**, so that bug is gone for modules on Go 1.22+ and the `tt := tt` line is now redundant. But this doesn't fix the *other* parallel hazards: shared mutable fixtures, ordering assumptions, and `t.Cleanup` timing. Parallelism also surfaces real races in the code under test, which is good — run `go test -race`. Be aware parallel subtests don't start until the enclosing function returns, which affects setup that lives in the parent.

**Key points**
- t.Parallel() defers the subtest to run with other parallel siblings
- Pre-1.22: loop var capture made all parallel cases test the last row; fix was tt := tt
- Go 1.22 per-iteration loop vars eliminate that specific bug
- Still must guard shared fixtures; always run with -race


```go
for _, tt := range tests {
	tt := tt // redundant on Go 1.22+, required before
	t.Run(tt.name, func(t *testing.T) {
		t.Parallel()
		got := Do(tt.in)
		assert.Equal(t, tt.want, got)
	})
}
```

**Follow-ups**
- Why must shared setup finish before parallel subtests start?
- How does -race interact with t.Parallel?

---

#### 8. Compare t.Cleanup vs defer and explain when Cleanup is strictly better.

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `t.Cleanup`, `helpers`

`defer` runs when the enclosing function returns; `t.Cleanup(fn)` registers a function the test framework runs when *that test and its subtests* finish, in LIFO order. Cleanup is better in three cases. (1) **Helpers**: a `setupDB(t)` helper can register its own teardown via `t.Cleanup` and return only the resource, so callers don't manage teardown — `defer` in a helper would fire when the helper returns, too early. (2) **Subtests and parallelism**: Cleanup respects the test tree and fires after parallel subtests complete, whereas `defer` in the parent runs before parallel children even start. (3) **Composition**: multiple Cleanups stack predictably across layered helpers.

Use `defer` for purely local resources within a single test body where lifetime equals function scope. The idiom that makes test setup clean: helpers return resources and self-register cleanup, so the test reads as straight-line intent.

**Key points**
- Cleanup fires at end of test/subtree; defer fires at function return
- Helpers can own their teardown via t.Cleanup and return only the resource
- Cleanup runs after parallel subtests; parent defer runs too early
- Cleanups stack LIFO and compose across layered helpers


```go
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db := openEphemeral(t)
	t.Cleanup(func() { db.Close() }) // caller never manages teardown
	return db
}
```

**Follow-ups**
- Why can't a helper just defer its own cleanup?
- What order do nested Cleanups run in?

---

#### 9. What are golden files, when do you use them, and what's the discipline around updating them?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `golden-files`, `testdata`

A golden file stores the expected output of a function (rendered template, serialized JSON, formatted report, generated code) on disk under `testdata/`. The test produces actual output and compares it byte-for-byte against the golden file; an `-update` flag regenerates the file. They shine when expected output is large, structured, or tedious to inline as a string literal — the diff on failure is far more readable than a giant assertion.

The discipline: (1) review golden diffs in code review as carefully as code — a blind `-update` can silently bless a regression, which is the main risk; (2) keep them deterministic — strip timestamps, random IDs, map ordering, and absolute paths before comparison, or the golden churns; (3) store under `testdata/` so the Go toolchain ignores it. Golden files trade authoring ease for review vigilance: cheap to create, dangerous to update carelessly.

**Key points**
- Compare actual output to a checked-in testdata/ file
- Best for large/structured output where inline literals are unreadable
- -update flag regenerates; review golden diffs like code
- Normalize nondeterminism (time, IDs, ordering) before comparing


```go
var update = flag.Bool("update", false, "update golden files")

func TestRender(t *testing.T) {
	got := Render(input)
	golden := filepath.Join("testdata", "render.golden")
	if *update {
		os.WriteFile(golden, got, 0o644)
	}
	want, _ := os.ReadFile(golden)
	if !bytes.Equal(got, want) {
		t.Errorf("mismatch:\n%s", diff(want, got))
	}
}
```

**Follow-ups**
- What's the failure mode of a careless -update?
- How do you keep golden files deterministic?

---

#### 10. testify assert vs require — when do you use each, and what's the cost of leaning on testify?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `go`, `testify`, `assert`, `require`

`require` stops the test on failure (calls `t.FailNow`); `assert` records the failure and continues. Use `require` for preconditions where continuing is pointless or unsafe — `require.NoError(t, err)` before dereferencing a returned pointer, otherwise you get a nil-panic that masks the real failure. Use `assert` when you want to collect multiple independent field mismatches in one run so you see the full picture, not just the first.

The cost: testify is convenient but its failure messages are sometimes less precise than a hand-written `if got != want { t.Errorf(...) }`, and over-reliance hides Go's native idioms from juniors. A bigger trap: `require.FailNow` inside a goroutine other than the test goroutine doesn't stop the test correctly. Many teams adopt testify for ergonomics; purists prefer standard-library asserts plus `go-cmp` for structural diffs. Either is defensible — the senior call is consistency within a codebase.

**Key points**
- require = FailNow (stop); assert = continue and collect failures
- require for preconditions guarding subsequent code (nil deref)
- assert to surface multiple field mismatches at once
- require.FailNow in a non-test goroutine doesn't stop correctly

**Follow-ups**
- Why is require.NoError before a deref important?
- When would go-cmp beat testify for comparisons?

---

#### 11. How does Go native fuzzing (1.18+) work, and how does it fit alongside table-driven tests?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `fuzzing`, `property`, `go1.18`

A fuzz target is `func FuzzX(f *testing.F)` that seeds a corpus with `f.Add(...)` and runs `f.Fuzz(func(t *testing.T, ...) {...})`. The engine mutates inputs (coverage-guided via the Go instrumentation) searching for inputs that panic or violate an assertion. Found crashers are written to `testdata/fuzz/` and become permanent regression cases run by ordinary `go test`. You run it with `go test -fuzz=FuzzX`.

Fuzzing complements, not replaces, table-driven tests. Table tests pin known behavior at named inputs; fuzzing explores the *unknown* input space to find what you didn't think of — parsing, decoders, anything taking untrusted bytes, and round-trip properties (`Unmarshal(Marshal(x)) == x`). The strongest fuzz targets assert *invariants/properties* rather than exact outputs, since you don't know the right answer for a random input. Practically: keep fuzz runs in CI time-boxed or nightly (they run until told to stop), commit discovered crashers as seeds, and reproduce a crasher deterministically with `go test -run=FuzzX/<hash>`.

**Key points**
- f.Add seeds the corpus; engine mutates coverage-guided inputs
- Crashers saved to testdata/fuzz and become regression cases
- Best for parsers/decoders/untrusted input and round-trip properties
- Assert invariants, not exact outputs; time-box in CI


```go
func FuzzRoundTrip(f *testing.F) {
	f.Add([]byte(`{"a":1}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		var v Doc
		if err := Unmarshal(data, &v); err != nil {
			return // reject invalid input, not a bug
		}
		out, err := Marshal(v)
		require.NoError(t, err)
		var v2 Doc
		require.NoError(t, Unmarshal(out, &v2))
		require.Equal(t, v, v2) // round-trip invariant
	})
}
```

**Follow-ups**
- Why assert invariants instead of exact output in a fuzz target?
- How do you keep fuzzing from blowing up CI time?

---

#### 12. How do you write a correct Go benchmark, and what mistakes invalidate results?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `benchmark`, `benchstat`, `performance`

A benchmark is `func BenchmarkX(b *testing.B)` with a loop over `b.N`; the framework scales `b.N` until timing is stable. Put one-time setup before the loop and call `b.ResetTimer()` so setup isn't measured; use `b.ReportAllocs()` (or `-benchmem`) to track allocations, which often matter more than ns/op in Go. Run with `go test -bench=. -benchmem -count=10` and compare with `benchstat` to get statistical significance rather than eyeballing one noisy run.

Classic invalidating mistakes: (1) the compiler optimizes away work whose result is unused — assign to a package-level sink to defeat dead-code elimination; (2) measuring setup because you forgot `ResetTimer`; (3) a single run with no `-count`, so noise dominates; (4) benchmarking on a thermally-throttled laptop or alongside other load; (5) `b.N`-dependent allocations that don't reflect steady state. Senior practice: benchmark to compare alternatives and catch regressions, not to produce absolute numbers, and gate on `benchstat` deltas.

**Key points**
- Loop over b.N; ResetTimer after setup; ReportAllocs/-benchmem
- Defeat dead-code elimination with a package-level sink
- Use -count + benchstat for statistical significance
- Benchmarks compare alternatives/catch regressions, not absolutes


```go
var sink int

func BenchmarkHash(b *testing.B) {
	data := makeInput()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		sink = Hash(data) // prevent elimination
	}
}
```

**Follow-ups**
- Why does an unused benchmark result get optimized away?
- How does benchstat decide a change is significant?

---

#### 13. What makes a good test helper in Go, and how do t.Helper and failure reporting interact?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `test-helpers`, `t.Helper`

A good helper hides incidental setup and keeps the test reading as intent: `user := seedUser(t, db)`, `assertEventPublished(t, bus, OrderPlaced{})`. Call `t.Helper()` at the top so test failures are reported at the *caller's* line, not inside the helper — without it every failure points at the same helper line and is useless for triage. Helpers should take `t` (or `testing.TB`), fail fast with `t.Fatal` on setup errors, and register their own teardown via `t.Cleanup` so callers stay clean.

Keep helpers focused: a helper that both sets up and asserts hides too much and makes failures ambiguous. Prefer returning data so the test can make its own assertions, unless the assertion itself is the reusable concept. Use `testing.TB` in shared helpers so they work from both tests and benchmarks. The litmus test: a reader who never opens the helper should still understand what each test verifies.

**Key points**
- t.Helper() reports failures at the caller's line, not inside the helper
- Helpers fail fast with t.Fatal and self-register t.Cleanup
- Prefer returning data; assert in the test unless the assertion is reusable
- Use testing.TB so helpers serve tests and benchmarks

**Follow-ups**
- What goes wrong if you forget t.Helper()?
- When should a helper assert vs return data?

---

## Test Pyramid & Reliability

#### 14. Define unit, integration, and e2e tests and explain the test pyramid's economics.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `pyramid`, `unit`, `integration`, `e2e`

**Unit**: tests a single component in process with no real I/O — fast (microseconds), deterministic, pinpoints failures. **Integration**: exercises a component against real collaborators it owns the contract with — a real Postgres, the actual HTTP router, a real Kafka — to catch wiring, SQL, serialization, and config bugs units can't. **E2E**: drives the whole deployed system through its public surface, validating user-visible flows across service boundaries.

The pyramid says: many fast unit tests, fewer integration tests, very few e2e. The economics are about feedback cost and reliability. Unit tests are cheap to run, stable, and localize failures; e2e tests are slow, flaky (network, timing, shared state), and when they fail they don't tell you *where*. So you push as much verification down to the cheapest stable layer that can prove it, and reserve e2e for a thin smoke suite of critical journeys. The shape isn't dogma — it's an optimization of total feedback cost per bug caught.

**Key points**
- Unit = in-process, fast, deterministic, precise failures
- Integration = real owned collaborators (DB, broker) catching wiring bugs
- E2E = whole system through public surface; slow and flaky
- Pyramid optimizes feedback cost: verify at the cheapest stable layer

**Follow-ups**
- Where do contract tests sit relative to these layers?
- Why are e2e failures hard to localize?

---

#### 15. What's the ice-cream-cone anti-pattern and how do you climb out of it?

*Difficulty:* 🟡 medium  ·  *Tags:* `pyramid`, `ice-cream-cone`, `anti-pattern`

The ice-cream cone is an inverted pyramid: few or no unit tests, a thick layer of slow integration/e2e tests, and a heap of manual QA on top. It happens when teams test only through the UI/API because the internal design isn't unit-testable (global state, fat handlers doing business logic, no seams). The result is a CI run measured in tens of minutes, chronic flakiness, and failures that point at 'something in checkout' rather than a line of code.

Climbing out is a refactoring problem, not a testing problem. You introduce seams: extract pure domain logic out of handlers into functions/types you can unit-test directly, push I/O to the edges behind interfaces, and move assertions down to the cheapest layer that can make them. Then you can delete redundant e2e cases that now duplicate unit coverage, keeping only a thin smoke suite. The key insight: an upside-down pyramid is a *design* symptom — untestable code forces high-level testing. Fix the design and the pyramid rights itself.

**Key points**
- Inverted pyramid: thin unit base, heavy e2e + manual QA on top
- Caused by untestable design forcing everything through the UI/API
- Fix is refactoring: extract pure domain logic, push I/O to edges
- Then delete redundant e2e, keep a thin smoke suite

**Follow-ups**
- How do you justify the refactoring time to product?
- Which e2e tests are safe to delete after adding unit coverage?

---

#### 16. How do you diagnose and eliminate flaky tests, and why is a flaky test worse than no test?

*Difficulty:* 🟠 hard  ·  *Tags:* `flaky`, `determinism`, `reliability`

A flaky test is worse than none because it erodes trust: once people retry-until-green, they stop reading failures, and a *real* regression hides in the noise. Treat flakes as P1 — quarantine immediately, then fix, don't ignore.

Diagnosis by root cause: (1) **timing/sleeps** — replace `time.Sleep` with polling/`require.Eventually` or synchronization primitives, and inject the clock so you control time; (2) **ordering/shared state** — tests that share a DB row, global var, or fixed port leak into each other, especially under `t.Parallel`; isolate with per-test schemas/transactions and `httptest` random ports; (3) **real concurrency races** in the code — run `-race` and `-count=100` to reproduce; (4) **external dependencies** — network, real time, randomness; inject seeds and fake the boundary; (5) **resource cleanup** — leaked goroutines/containers. The discipline: make tests deterministic by removing every source of nondeterminism — wall-clock time, random seeds, map iteration order, network, and unsynchronized concurrency. A test that passes 1000/1000 runs locally and in CI is the bar.

**Key points**
- Flaky tests destroy trust; retry-culture hides real regressions
- Quarantine then fix; never normalize retrying
- Common roots: sleeps, shared state, real concurrency, external deps
- Determinism: inject clock/seed, isolate state, run -race -count=N

**Follow-ups**
- How do you reproduce a flake that only fails in CI?
- What's your policy for a flaky test blocking a release?

---

## Test Doubles & Mocking

#### 17. Distinguish mocks, stubs, fakes, and spies. When is each the right tool?

*Difficulty:* 🟡 medium  ·  *Tags:* `test-doubles`, `mocks`, `fakes`, `stubs`, `spies`

Using Meszaros's taxonomy: a **stub** returns canned responses to feed the code under test (e.g. a repo that always returns a fixed user). A **fake** is a working but simplified implementation — an in-memory map standing in for a database — suitable for state-based testing. A **spy** records how it was called so you can assert afterward, without pre-programming expectations. A **mock** is pre-programmed with expectations and *self-verifies* interactions (which methods, args, order) — failing the test if they're not met.

When: use a **fake** as the default for an owned collaborator like a repository — it lets you test real behavior via state and survives refactors. Use a **stub** to drive a specific branch (force an error path). Use a **spy** when you need to confirm a side effect happened (event published) but don't want strict ordering. Reserve **mocks** for cases where the *interaction itself is the contract* — calling a payment gateway exactly once, idempotently. The senior bias in Go: prefer hand-written fakes/stubs; mocks last, because they couple tests to call structure.

**Key points**
- Stub: canned responses; Fake: working simplified impl; Spy: records calls; Mock: pre-set expectations that self-verify
- Fakes enable state-based testing and survive refactors
- Stubs drive specific branches/error paths
- Mocks only when the interaction is the contract

**Follow-ups**
- Why do mocks couple to refactoring more than fakes?
- When is a spy preferable to a mock?

---

#### 18. What's the real cost of over-mocking, and how do you spot it in a Go codebase?

*Difficulty:* 🟠 hard  ·  *Tags:* `over-mocking`, `change-detector`, `boundary`

Over-mocking produces *change-detector tests*: tests that assert on every internal call, so any refactor — even one that preserves behavior — breaks dozens of tests. That inverts TDD's promise: the safety net now resists change instead of enabling it. Worse, a fully-mocked unit test can be entirely green while the real integration is broken, because you've replaced every collaborator with your own assumptions; you've tested that the code calls the mocks the way you told it to, which is tautological.

Go smells: a test file with more lines of `EXPECT().Method().Return()` than actual assertions; mocks for pure functions or value types; mocking your own domain logic instead of just the I/O boundary; expectation-heavy `gomock` controllers verifying call order. The fix is to mock at the *right boundary* — the process edge (DB, HTTP, broker, clock) — and use real objects or fakes inside the domain. If mocking a collaborator feels necessary to test logic, that's often a signal the logic should be a pure function taking data, not a method reaching through a dependency.

**Key points**
- Over-mocking → change-detector tests that resist refactoring
- Fully-mocked units can be green while integration is broken
- Smell: more EXPECT() lines than assertions; mocking domain logic
- Mock only the process boundary; pure logic should take data

**Follow-ups**
- How would you refactor a method-heavy unit into pure functions?
- Why is a fully-mocked green test sometimes meaningless?

---

#### 19. gomock vs hand-written fakes in Go — which do you reach for and why?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `gomock`, `fakes`, `tooling`

**Hand-written fakes** are my default. For a small Go interface (a repo with 3-4 methods), an in-memory struct backed by a map is a few lines, gives state-based testing, reads clearly, and never breaks on a refactor that doesn't change behavior. You also control its fidelity — it can enforce real invariants (unique IDs, not-found errors).

**gomock** (generated mocks) earns its place when the interface is large, when you must precisely assert interactions (call count, args, ordering) that *are* the contract, or when canned responses per-call are tedious to hand-roll. Its costs: generated code to maintain, verbose `EXPECT()` chains, and a strong pull toward interaction-based tests that couple to call structure. The decision rule: if I care about *state/result*, fake; if I care about *the exact interaction* at a true boundary, gomock (or a small hand-written spy). Many teams over-reach for gomock by default and end up with brittle suites; small interfaces in Go make hand-written doubles cheap enough to prefer.

**Key points**
- Hand-written fakes: default for small interfaces; state-based, refactor-safe
- Fakes can enforce real invariants for higher fidelity
- gomock: large interfaces or when exact interaction is the contract
- gomock pulls toward brittle interaction-coupled tests


```go
// Hand-written fake repository
type fakeUsers struct{ m map[string]User }

func (f *fakeUsers) Get(_ context.Context, id string) (User, error) {
	u, ok := f.m[id]
	if !ok {
		return User{}, ErrNotFound
	}
	return u, nil
}
func (f *fakeUsers) Save(_ context.Context, u User) error {
	f.m[u.ID] = u
	return nil
}
```

**Follow-ups**
- When does the verbosity of hand-written fakes tip toward gomock?
- How do you keep a fake's fidelity in sync with the real impl?

---

## Designing for Testability

#### 20. Explain 'accept interfaces, return structs' and why it's a testability principle in Go.

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `interfaces`, `testability`

A function should accept the *narrowest interface* describing what it needs and return concrete structs. Accepting an interface lets callers (including tests) substitute any implementation — a fake repo, an in-memory store — without the consumer caring. Returning a concrete struct gives callers full access to the value and avoids prematurely constraining the API behind an interface they may not need.

For testability this is decisive: if your service depends on `*sql.DB` directly, you can only test it against a real database; if it depends on a small `UserStore` interface, you can inject a fake and unit-test the logic in microseconds. The Go-specific twist is that interfaces are satisfied implicitly and should be defined on the *consumer* side, kept small (often one or two methods). Don't define a giant interface next to the implementation 'for testing' — that leaks. Define `type userGetter interface { Get(ctx, id) (User, error) }` where it's used, and the production struct satisfies it for free.

**Key points**
- Accept narrow interfaces (substitutable), return concrete structs
- Depending on *sql.DB forces real-DB tests; an interface enables fakes
- Define interfaces on the consumer side, kept small
- Implicit satisfaction means production structs fit test interfaces free

**Follow-ups**
- Why define the interface at the consumer, not the implementation?
- What's the downside of returning an interface instead of a struct?

---

#### 21. How do you inject a clock to make time-dependent logic testable, and why does it matter?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `clock-injection`, `determinism`

Any code calling `time.Now()` directly is nondeterministic and untestable for time-dependent behavior — token expiry, rate windows, scheduled retries, TTLs. The fix is to inject time as a dependency: define a `Clock` interface (or just a `now func() time.Time` field) and have production wire `time.Now` while tests inject a controllable fake clock that you advance manually.

Why it matters: it converts flaky `time.Sleep`-based tests into deterministic ones. Instead of sleeping 30 seconds to test an expiry, you set the clock to T, create the token, advance to T+ttl+1, and assert it's expired — instantly and reliably. It also makes edge cases (exact boundary, clock skew, DST) testable that you could never hit with the wall clock. Use a well-known fake clock library or a tiny hand-rolled one. The same principle generalizes: inject every nondeterministic source — randomness (seedable), UUID generation, and the clock — so tests are fully reproducible.

**Key points**
- Direct time.Now() makes time logic nondeterministic and slow to test
- Inject a Clock interface / now func; production uses time.Now
- Tests advance a fake clock to hit expiry/boundary instantly
- Generalizes: inject randomness and ID generation too


```go
type Clock interface{ Now() time.Time }

type Service struct{ clock Clock }

func (s *Service) Expired(t Token) bool {
	return s.clock.Now().After(t.ExpiresAt)
}

// test
fc := &fakeClock{t: base}
svc := Service{clock: fc}
fc.Advance(ttl + time.Second)
require.True(t, svc.Expired(tok))
```

**Follow-ups**
- How does this remove time.Sleep from tests?
- What other nondeterministic sources do you inject?

---

#### 22. Why is global mutable state the enemy of testability, and how do you eliminate it in Go?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `global-state`, `dependency-injection`, `testability`

Package-level mutable state (singletons, global config, `var db *sql.DB`, global registries) couples every test to a shared, order-dependent world. Tests can't run in parallel safely, one test's mutation leaks into the next, and you can't substitute dependencies because they're baked in at package scope. It also hides dependencies — a function's signature lies about what it touches.

Elimination in Go: pass dependencies explicitly via constructor injection — a `Service` struct holding its `UserStore`, `Clock`, `Logger`, created by `NewService(deps)`. Make functions take what they use as parameters rather than reaching for globals. Where a singleton seems unavoidable (a metrics registry), at least make it injectable with the global as a default. For configuration, parse into a struct and pass it down. The payoff: every unit becomes a self-contained value you can construct with fakes, test in isolation, and run in parallel. The signature becomes honest about dependencies, which is itself a design improvement TDD tends to surface early.

**Key points**
- Global state → order-dependent tests, no parallelism, leakage
- Globals hide dependencies; the signature lies about what's touched
- Fix: constructor injection — struct holds deps, NewX(deps) wires them
- Honest signatures enable isolation, fakes, and t.Parallel

**Follow-ups**
- How do you migrate a global-heavy package incrementally?
- When is an injectable-with-default singleton acceptable?

---

#### 23. How do hexagonal/ports-and-adapters boundaries make a Go service testable?

*Difficulty:* 🟠 hard  ·  *Tags:* `hexagonal`, `ports-adapters`, `architecture`, `testability`

Hexagonal architecture splits the system into a domain core and adapters at the edges, connected by *ports* (interfaces the core defines). Driven ports (repositories, message publishers, the clock) are interfaces the domain owns; adapters (Postgres, Kafka, HTTP clients) implement them. Driving ports (use-case interfaces) are what HTTP/gRPC handlers call into.

For testability this is the cleanest possible seam. The domain core depends only on its own port interfaces, so you unit-test all business logic against in-memory fakes implementing those ports — fast, deterministic, no infrastructure. Integration tests then verify each *adapter* against the real thing (a real Postgres via testcontainers) confirming it honors the port contract. You get the pyramid for free: a large base of pure domain unit tests plus a thin layer of adapter integration tests. The key discipline is dependency direction — adapters depend on the domain's ports, never the reverse — so infrastructure concerns never leak into and pollute the testable core. In Go this maps naturally onto small consumer-defined interfaces.

**Key points**
- Domain core defines ports (interfaces); adapters implement them at edges
- Unit-test core against in-memory fakes; no infrastructure needed
- Integration-test each adapter against the real dependency
- Dependency points inward — infra never pollutes the testable core

**Follow-ups**
- Where does the clock fit as a port?
- How do you verify an adapter honors the port contract?

---

## BDD & Executable Specifications

#### 24. What is BDD really for, and what does Given/When/Then add over plain unit tests?

*Difficulty:* 🟡 medium  ·  *Tags:* `bdd`, `gherkin`, `given-when-then`

BDD reframes tests as *specifications of behavior* written in business language, with the primary goal of building a shared understanding among engineers, QA, and domain experts before code exists. Given/When/Then structures a scenario as: **Given** a context/precondition, **When** an event/action, **Then** an observable outcome. That structure isn't magic — it's the arrange-act-assert pattern — but expressed in the *ubiquitous language* so non-engineers can read and validate it.

What it adds over plain unit tests: scenarios become living documentation that stays true because they execute, and they force conversations that surface hidden rules early ('what happens when the cart is empty at checkout?'). The cost is real: Gherkin features, step-definition glue, and tooling overhead. So BDD pays off where the *domain rules are the risk* and stakeholders need to validate them — pricing, eligibility, regulatory flows — and is overkill for purely technical components. BDD is about collaboration and shared language; the executable spec is a byproduct, not the point.

**Key points**
- BDD = shared understanding via behavior specs in business language
- Given/When/Then is arrange-act-assert in ubiquitous language
- Value: living documentation + early conversations surfacing rules
- Worth the glue/tooling cost only where domain rules are the risk


```
Feature: Checkout minimum order
  Scenario: Order below minimum is rejected
    Given a cart totaling 3.00 USD
    And the store minimum is 5.00 USD
    When the customer checks out
    Then the order is rejected with reason "below minimum"
```

**Follow-ups**
- When is BDD overkill?
- How is Given/When/Then different from arrange-act-assert?

---

#### 25. Who should write Gherkin specs, and what goes wrong when only engineers write them?

*Difficulty:* 🟡 medium  ·  *Tags:* `bdd`, `gherkin`, `collaboration`, `three-amigos`

Gherkin's whole value is collaboration: product/domain experts and QA define *what* behavior the system should have in business terms, and engineers help shape the steps and wire them to code. It works best as a 'three amigos' conversation (business, dev, test) producing scenarios everyone agrees describe the behavior.

When engineers write Gherkin alone, it degenerates into expensive unit tests with extra ceremony. Symptoms: scenarios leak implementation detail ('When I POST /orders with header X'), steps reference UI clicks or DB columns instead of business intent, and the feature files become unreadable to the very stakeholders they're meant to serve. At that point you're paying the parsing/step-definition overhead without the collaboration payoff — you'd be better off with table-driven Go tests. The failure mode is treating Gherkin as a test *framework* rather than a *communication* artifact. If business never reads the features, BDD has failed regardless of how green the suite is.

**Key points**
- Best as 'three amigos' (business, dev, test) collaboration
- Business defines behavior in domain terms; engineers wire steps
- Engineer-only Gherkin leaks implementation, loses readability
- Without business readers it's costly unit tests with ceremony

**Follow-ups**
- What does an implementation-leaking scenario look like?
- How do you keep step definitions reusable and intent-focused?

---

#### 26. Compare godog and Ginkgo for BDD in Go — what's the actual difference?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `godog`, `ginkgo`, `bdd-tooling`

**godog** is the Cucumber implementation for Go: you write `.feature` files in Gherkin and bind each step to a Go function via regex/expression step definitions. It targets *true* BDD — business-readable feature files that non-engineers can author and read. The cost is the indirection: a layer of step-definition glue, and discipline to keep steps reusable rather than one-off.

**Ginkgo** is a BDD-*style* test framework using nested `Describe/Context/It` blocks in Go code, usually with the Gomega matcher library. It gives you expressive, hierarchical specs and good async/eventually support, but the specs live in Go — they're not business-readable Gherkin. Ginkgo is really 'structured, readable Go tests', popular in the Kubernetes ecosystem, not a collaboration tool for non-engineers.

The choice: use **godog** when stakeholders genuinely participate in writing/reading specs (the real BDD case). Use **Ginkgo** when engineers want expressive, well-organized tests with strong async assertions but don't need business-readable specs. Many Go teams find plain table-driven tests sufficient and skip both — the standard library plus subtests covers most structured-test needs without the dependency.

**Key points**
- godog = real Cucumber/Gherkin; .feature files + step definitions; business-readable
- Ginkgo = BDD-style Go DSL (Describe/It) + Gomega; not business-readable
- godog for genuine stakeholder collaboration; Ginkgo for expressive Go tests
- Plain table-driven tests often suffice; skip both unless you need their value

**Follow-ups**
- When does Ginkgo's nesting hurt readability vs table tests?
- What does godog buy you that Ginkgo can't?

---

## Domain-Driven Design

#### 27. Define entity, value object, aggregate, and aggregate root, and show how they map to Go types.

*Difficulty:* 🟡 medium  ·  *Tags:* `ddd`, `entity`, `value-object`, `aggregate`

An **entity** has identity that persists through state change — two orders with the same fields are still different orders; equality is by ID. A **value object** has no identity; it's defined by its attributes, is immutable, and is compared by value — `Money{Amount, Currency}`, an `Address`, a `DateRange`. An **aggregate** is a cluster of entities and value objects treated as a single consistency boundary; the **aggregate root** is the one entity that's the only legal entry point — outside code references the aggregate only via the root, which enforces invariants across the whole cluster.

In Go: an entity is a struct with an ID field and identity-based behavior, typically a pointer type with mutating methods that guard invariants. A value object is a small immutable struct, often passed by value, with no setters and constructed via a validating function (`NewMoney`). The aggregate root exposes methods like `order.AddLine(...)` that maintain invariants (total recalculated, max-lines enforced); you never mutate a child line directly from outside. Persistence and transactions are scoped per aggregate.

**Key points**
- Entity: identity-based equality, persists through change (struct + ID)
- Value object: immutable, equality by attributes (small value struct, validating ctor)
- Aggregate: consistency boundary clustering entities + VOs
- Aggregate root: sole entry point enforcing invariants; mutate children only via root


```go
// Value object: immutable, by-value
type Money struct{ amount int64; currency string }
func NewMoney(a int64, c string) (Money, error) { /* validate */ }

// Aggregate root: only entry point, guards invariants
type Order struct {
	ID    string
	lines []Line
	total Money
}
func (o *Order) AddLine(l Line) error {
	if len(o.lines) >= maxLines { return ErrTooManyLines }
	o.lines = append(o.lines, l)
	o.recalcTotal()
	return nil
}
```

**Follow-ups**
- Why must value objects be immutable?
- Why scope a transaction to a single aggregate?

---

#### 28. What is a bounded context and ubiquitous language, and why do they reduce coupling?

*Difficulty:* 🟡 medium  ·  *Tags:* `ddd`, `bounded-context`, `ubiquitous-language`

A **bounded context** is an explicit boundary within which a domain model and its *ubiquitous language* are consistent and unambiguous. The **ubiquitous language** is the shared vocabulary used identically in conversation, specs, and code inside that boundary. The key insight: the same word means different things in different contexts. 'Customer' in Sales (a lead with a pipeline stage) is not 'Customer' in Billing (an account with payment terms) or in Support (a ticket submitter). Forcing one shared 'Customer' model across all of them creates a tangled, over-coupled god-model that nobody can change safely.

Bounded contexts reduce coupling by letting each context own its own model tuned to its needs, translating at the borders rather than sharing internals. Inside a context, code, tests, and stakeholder conversation all use the same precise terms, eliminating translation errors. The boundary is where you decide integration strategy (shared kernel, customer/supplier, anti-corruption layer). This is the strategic heart of DDD — getting boundaries right matters more than tactical patterns, because wrong boundaries couple everything.

**Key points**
- Bounded context = boundary where one model + language is consistent
- Same term (Customer) means different things in different contexts
- One shared model across contexts → over-coupled god-model
- Each context owns its model; translate at borders; reduces coupling

**Follow-ups**
- How do you discover where context boundaries should fall?
- What's the relationship between contexts and team ownership?

---

#### 29. What are domain events, and how do they shape the design and testing of a Go domain?

*Difficulty:* 🟠 hard  ·  *Tags:* `ddd`, `domain-events`, `testability`

A **domain event** is an immutable record that something meaningful happened in the domain, named in past tense in the ubiquitous language — `OrderPlaced`, `PaymentCaptured`, `InventoryReserved`. The aggregate raises events as a result of state changes; they're then dispatched (often after the transaction commits) to update read models, trigger workflows, or notify other bounded contexts asynchronously, decoupling the producer from consumers.

For design, events make side effects explicit and push them out of the aggregate's core logic — the aggregate decides *what happened*, not *who reacts*. For testing this is a gift: the aggregate's behavior is now a pure function of (current state, command) → (new state, events raised). You unit-test by issuing a command and asserting on the resulting state *and* the emitted events — no mocks, no infrastructure. `When the order is placed Then an OrderPlaced event is raised with the correct total` becomes a fast, deterministic state-based test. The async dispatch and downstream consumers are tested separately (integration/contract). This separation is exactly why DDD domains are so testable: the rich logic lives in pure, dependency-free aggregates.

**Key points**
- Domain event: immutable past-tense fact in ubiquitous language
- Aggregate decides what happened, not who reacts → decoupling
- Behavior becomes (state, command) → (new state, events): pure and mock-free
- Test aggregate by asserting state + emitted events; dispatch tested separately


```go
func (o *Order) Place() ([]Event, error) {
	if len(o.lines) == 0 { return nil, ErrEmptyOrder }
	o.status = StatusPlaced
	return []Event{OrderPlaced{ID: o.ID, Total: o.total}}, nil
}

// test: pure, no mocks
events, err := order.Place()
require.NoError(t, err)
require.Equal(t, []Event{OrderPlaced{ID: order.ID, Total: order.total}}, events)
```

**Follow-ups**
- Why dispatch events after commit rather than during?
- How do you keep events backward-compatible for consumers?

---

#### 30. How do you test domain logic in isolation, and why does DDD make that easy?

*Difficulty:* 🟠 hard  ·  *Tags:* `ddd`, `domain-testing`, `isolation`, `anemic-model`

DDD pushes all business rules into the domain layer — aggregates, value objects, domain services — which by design depend only on other domain types and abstract ports, never on infrastructure. That makes them pure-ish: a method takes a command and current state and produces new state plus events. So you test the domain with plain constructors and assertions: build the aggregate, call the method, assert on resulting state and emitted events. No database, no HTTP, no mocks for I/O because the domain doesn't do I/O.

This is the whole testability payoff of the tactical patterns. Value objects validate themselves in constructors, so invalid states are unrepresentable and you test the constructor once. Aggregates enforce invariants in methods, so you test each invariant as a fast unit case (`AddLine beyond max returns ErrTooManyLines`). Application services orchestrate aggregates + repositories, and *those* you test with in-memory fake repos. The contrast with anemic models is sharp: if business logic leaks into handlers and services that reach into the DB, you're forced into slow, mock-heavy tests. Rich domain models give you a huge base of fast, deterministic unit tests — the pyramid falls out of good DDD.

**Key points**
- Domain layer depends only on domain types/ports — no I/O
- Test aggregates/VOs with constructors + assertions; no infra/mocks
- Value objects make invalid states unrepresentable (test ctor once)
- Anemic models leak logic to I/O layers, forcing slow mock-heavy tests

**Follow-ups**
- What's an anemic domain model and why does it hurt testing?
- Where do application services fit in the test pyramid?

---

#### 31. How do bounded contexts map to microservices, and what's an anti-corruption layer for?

*Difficulty:* 🟠 hard  ·  *Tags:* `ddd`, `bounded-context`, `microservices`, `anti-corruption-layer`

A bounded context is a natural seam for a microservice: each service owns one context's model, data, and ubiquitous language, exposing a contract at its edge. The mapping is a heuristic, not a law — a context can be a module in a modular monolith, and splitting before you understand the boundaries produces a distributed monolith with chatty, coupled services. Get the context boundaries right first; service boundaries can follow.

An **anti-corruption layer (ACL)** is a translation layer at a context's boundary that protects your model from a foreign model's concepts. When you integrate with a legacy system or a third-party API whose model is messy or shaped differently, the ACL translates their representation into your clean domain types at the edge, so their concepts never leak into and corrupt your core. In Go it's an adapter implementing your domain port that maps the external DTOs to your entities/value objects. Without it, the upstream's quirks infect your model and every change upstream ripples into your domain. The ACL localizes the blast radius of integration ugliness to one translation boundary.

**Key points**
- Bounded context is a natural microservice seam — but a heuristic, not a law
- Premature splitting → distributed monolith; get boundaries right first
- ACL translates a foreign model into your clean domain types at the edge
- ACL keeps upstream quirks from corrupting your core; localizes blast radius

**Follow-ups**
- What are the signs you split into microservices too early?
- Where does the ACL live relative to ports-and-adapters?

---

## Testing with Real Infrastructure

#### 32. What is testcontainers-go and when do you reach for it over mocks or fakes?

*Difficulty:* 🟡 medium  ·  *Tags:* `testcontainers`, `integration`, `postgres`, `go`

testcontainers-go spins up real dependencies as Docker containers from your Go test — a real Postgres, Kafka, or Redis — waits for them to be ready, and tears them down via `t.Cleanup`/`Terminate`. You get the actual engine, so your SQL, migrations, driver behavior, transaction semantics, and serialization are exercised against the real thing, not your assumption of it.

Reach for it when the *fidelity of the dependency matters*: testing real SQL queries and constraints, Postgres-specific features (JSONB, advisory locks, `ON CONFLICT`), Kafka consumer-group rebalancing, or Redis expiry/eviction. A hand-written fake can't catch a malformed query or a migration that fails on the real engine. Use fakes/mocks instead when you're testing *your* logic and the dependency is incidental — there a real container is slow overkill. The trade-off is speed and infrastructure: containers add seconds of startup and require Docker in CI, so they belong in the integration layer of the pyramid, not in your fast unit tests. Pattern: share a container across a package's tests with a clean-per-test schema/transaction to amortize startup.

**Key points**
- Runs real Postgres/Kafka/Redis in Docker from the test; auto-teardown
- Use when dependency fidelity matters: real SQL, migrations, engine features
- Fakes can't catch malformed queries or migration failures
- Slow + needs Docker → integration layer; share container, clean per test


```go
pg, err := postgres.Run(ctx, "postgres:16",
	postgres.WithDatabase("app"),
	testcontainers.WithWaitStrategy(wait.ForListeningPort("5432/tcp")),
)
require.NoError(t, err)
t.Cleanup(func() { pg.Terminate(ctx) })
dsn, _ := pg.ConnectionString(ctx)
db := mustOpen(t, dsn)
// run migrations, then exercise real repository against real Postgres
```

**Follow-ups**
- How do you keep container-based tests fast in CI?
- What can a real Postgres catch that a fake repo cannot?

---

#### 33. Real infra vs fakes vs mocks — give the senior decision framework with trade-offs.

*Difficulty:* 🟠 hard  ·  *Tags:* `test-doubles`, `real-infra`, `trade-offs`, `fidelity`

Decide by what you're trying to prove and where the risk is. **Mocks/stubs**: fastest, zero infra, but you're testing against your *assumptions* of the dependency — fine for driving logic branches, useless for catching real integration bugs. **Hand-written fakes**: fast, stateful, refactor-friendly, good fidelity for *your* invariants — but they can drift from the real dependency's behavior (your fake repo allows a write the real DB's unique constraint would reject). **Real infra (testcontainers)**: highest fidelity, catches SQL/migration/serialization/engine-semantics bugs — but slow, needs Docker, and belongs in the integration layer.

The framework: use the *cheapest double that can prove the thing you're worried about*. Unit-test domain logic with fakes/no doubles; integration-test the repository/adapter against the real engine to confirm it honors the contract your fake assumes. This pairing is key — the fake's fidelity is validated by a small set of integration tests against real infra, so the large unit suite can trust the fake. Never test business logic through a real database (slow, flaky) and never trust a fully-mocked test to prove integration correctness. Match the tool to the risk and the pyramid layer.

**Key points**
- Mocks: test your assumptions; fast; can't catch real integration bugs
- Fakes: fast, stateful, refactor-safe; can drift from real behavior
- Real infra: highest fidelity for SQL/engine semantics; slow, needs Docker
- Use cheapest double that proves your concern; validate fakes with a few real-infra integration tests

**Follow-ups**
- How do you detect that a fake has drifted from the real dependency?
- Why pair a large fake-based unit suite with a small real-infra suite?

---

## Coverage, Contract & Property Testing

#### 34. Why is line coverage a misleading metric, and what does meaningful coverage look like?

*Difficulty:* 🟡 medium  ·  *Tags:* `coverage`, `goodhart`, `metrics`

Line coverage measures which lines *executed*, not which behaviors were *verified*. You can hit 100% by running code with zero assertions, or by tests that exercise lines without checking the outcomes that matter — coverage with no oracle. It also rewards gaming: padding with trivial getter tests to lift the number while the genuinely risky logic (error paths, concurrency, edge cases) stays unverified. As a *target* it falls to Goodhart's law — once it's a goal, it stops measuring quality.

Meaningful coverage is about verified behavior and risk. Use coverage as a *diagnostic* to find untested code, then ask whether the uncovered paths matter — an uncovered error-handling branch in a payment flow is a real gap; an uncovered trivial accessor isn't. Better signals: branch coverage over line coverage, and *mutation testing*, which actually proves your assertions catch defects. Senior practice: don't mandate a blanket percentage; instead require new code to be tested, review *what* is asserted, and use coverage drops as a flag for review, not a gate that teams game.

**Key points**
- Line coverage = executed, not verified; 100% possible with no assertions
- As a target it falls to Goodhart's law and invites gaming
- Use as a diagnostic to find gaps; judge whether uncovered paths matter
- Prefer branch coverage + mutation testing; review what's asserted

**Follow-ups**
- How does mutation testing measure assertion quality?
- What's wrong with a hard 80% coverage gate?

---

#### 35. What is mutation testing and what does it tell you that coverage can't?

*Difficulty:* 🟠 hard  ·  *Tags:* `mutation-testing`, `assertion-quality`, `coverage`

Mutation testing introduces small artificial faults — 'mutants' — into your code (flip a `>` to `>=`, replace `+` with `-`, negate a condition, return zero) and reruns your test suite against each. If a test fails, the mutant is 'killed' — your tests detected the fault. If all tests still pass, the mutant 'survived', meaning your suite executes that code but doesn't actually *verify* its behavior. The mutation score is killed/total.

What it tells you that coverage can't: coverage proves a line *ran*; mutation testing proves your *assertions would catch a defect there*. A line with 100% coverage but a surviving mutant is tested in name only — you'd never notice if it broke. It directly measures assertion quality and surfaces weak or missing checks. The catch: it's expensive (N mutants × full suite runs) and produces equivalent mutants (changes that don't alter behavior, so unkillable) that need triage. In Go, tools like `go-mutesting` exist. Practically, run it on critical modules rather than the whole codebase, and use surviving mutants as a precise to-do list of missing assertions.

**Key points**
- Injects faults (mutants); tests should 'kill' them by failing
- Surviving mutant = code runs but behavior isn't verified
- Measures assertion quality, which coverage cannot
- Expensive + equivalent-mutant noise; target critical modules

**Follow-ups**
- What's an equivalent mutant and why is it a problem?
- How would you scope mutation testing to keep it affordable?

---

#### 36. When does property-based testing beat example-based testing?

*Difficulty:* 🟠 hard  ·  *Tags:* `property-based`, `invariants`, `rapid`, `gopter`

Example-based tests assert specific input→output pairs you thought of. Property-based testing asserts *invariants* that must hold for all inputs, then generates many randomized inputs (with shrinking to a minimal failing case) to try to falsify them. It wins when the input space is large and the correct behavior is expressible as a property rather than enumerable examples.

Classic cases: **round-trips** (`decode(encode(x)) == x`), **algebraic laws** (sort is idempotent and a permutation of input; `reverse(reverse(x)) == x`), **oracle comparison** (a fast implementation must match a simple reference), and **invariants** (a balanced tree stays balanced after any operation sequence). These find edge cases you'd never enumerate — empty inputs, boundary values, unicode, huge values — and shrinking hands you the minimal reproducer. In Go, native fuzzing covers much of this for `[]byte`/string inputs; for richer typed generation, libraries like `gopter` or `rapid` generate structured values. The limit: you need a *property* — if the only spec is 'it returns 42 for this input', there's no property to test, and example-based is the right tool. Use both: properties for general correctness, examples to pin specific known cases and regressions.

**Key points**
- Properties assert invariants over generated inputs with shrinking
- Wins on large input spaces expressible as properties
- Round-trips, algebraic laws, oracle comparison, structural invariants
- Needs a property; pair with examples for specific/regression cases


```go
func TestSortProperty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
		out := Sort(append([]int(nil), in...))
		require.True(t, sort.IntsAreSorted(out))      // invariant: sorted
		require.ElementsMatch(t, in, out)             // invariant: permutation
	})
}
```

**Follow-ups**
- What is shrinking and why does it matter?
- How does Go's native fuzzing relate to property testing?

---

#### 37. What problem does consumer-driven contract testing (Pact) solve in microservices, and how does it differ from e2e?

*Difficulty:* 🔴 staff  ·  *Tags:* `contract-testing`, `pact`, `microservices`, `consumer-driven`

In microservices, the risk is a provider changing its API in a way that breaks a consumer — but you can't catch that with unit tests (each side mocks the other and both stay green) and full e2e tests are slow, flaky, and require every service deployed together. Consumer-driven contract testing closes that gap. The **consumer** writes tests against a mock of the provider and, in doing so, generates a *contract* (a Pact file) capturing exactly the requests it makes and responses it expects. The **provider** then runs *verification* against that contract, replaying the consumer's expectations against the real provider implementation. If the provider drifts, *its* CI fails before deploy — the consumer is protected without both running together.

Versus e2e: contract tests are fast, run independently per service in each pipeline, and pinpoint exactly which consumer/provider pair would break and on what field. They verify the *integration contract* (shape and semantics of the messages) without exercising end-to-end business flows. They don't replace e2e for validating real user journeys, but they replace most of the *integration* e2e that exists only to catch interface drift. A Pact broker stores contracts and 'can-I-deploy' checks gate releases on compatible versions. The cost is discipline: contracts must reflect real consumer usage and stay maintained.

**Key points**
- Consumer generates a contract; provider verifies against it independently
- Catches API drift that mutual mocking and unit tests miss
- Fast, per-service, pinpoints the breaking field — no joint deploy needed
- Verifies the integration contract, not end-to-end journeys; broker + can-I-deploy gates releases

**Follow-ups**
- Why is it called 'consumer-driven'?
- What does a Pact broker's can-I-deploy check prevent?

---

#### 38. Design the full test strategy for a Go order-service built with DDD. Which layers get which kinds of tests?

*Difficulty:* 🔴 staff  ·  *Tags:* `ddd`, `test-strategy`, `pyramid`, `staff`

Map tests to the architecture, putting weight where the risk is and keeping the pyramid honest.

**Domain core (aggregates, value objects, domain services)** — the bulk: fast, pure unit tests, no mocks. Assert state transitions and emitted domain events; property-test invariants (totals never negative, an order's lines never exceed max). This is the large base because DDD concentrates logic here.

**Application services (use cases orchestrating aggregates + ports)** — unit tests with in-memory fake repositories and a fake clock/event bus. Verify orchestration: command loads aggregate, invokes behavior, persists, publishes events. Spy on the bus for the 'event published' contract.

**Adapters (Postgres repo, Kafka publisher, HTTP handlers)** — integration tests with testcontainers: real Postgres to verify SQL, migrations, constraints, and that the repo honors the port contract the fakes assumed; real Kafka for publish/consume. Handler tests via `httptest` for routing, decoding, status codes.

**Cross-service** — consumer-driven contract tests (Pact) against collaborating services to catch interface drift without joint deploys.

**System** — a thin e2e smoke suite for the one or two critical journeys (place order → payment → confirmation), plus a couple of property/fuzz targets on parsers and money math. CI runs unit + contract on every push (seconds), integration on merge, e2e nightly/pre-release. The shape: huge pure-domain base, thin everything-else — which DDD makes natural because the rich logic is dependency-free.

**Key points**
- Domain core: large base of pure unit + property tests, no mocks
- Application services: fakes + fake clock/bus; verify orchestration and events
- Adapters: testcontainers integration (real Postgres/Kafka) + httptest handlers
- Cross-service: Pact contract tests; thin e2e smoke for critical journeys; tier CI by speed

**Follow-ups**
- How do you validate the fake repo matches the real one?
- Which tests block a deploy vs run nightly, and why?

---
