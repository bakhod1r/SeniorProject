# Test Doubles: Mocks & Fakes — Middle Level

> **Roadmap:** [Testing](../README.md) → Test Doubles: Mocks & Fakes
>
> *State or behavior? Detroit or London? The choices here decide whether your tests survive a refactor or shatter on contact.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — State Verification vs Behavior Verification](#core-concept-1--state-verification-vs-behavior-verification)
5. [Core Concept 2 — The Spy: A Stub That Remembers](#core-concept-2--the-spy-a-stub-that-remembers)
6. [Core Concept 3 — The Fake: A Working In-Memory Implementation](#core-concept-3--the-fake-a-working-in-memory-implementation)
7. [Core Concept 4 — Classical (Detroit) vs Mockist (London)](#core-concept-4--classical-detroit-vs-mockist-london)
8. [Core Concept 5 — Faking the Clock and Randomness](#core-concept-5--faking-the-clock-and-randomness)
9. [Core Concept 6 — Faking HTTP and the Filesystem](#core-concept-6--faking-http-and-the-filesystem)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **choosing between state and behavior verification, understanding the classical vs mockist schools, and building real fakes for the clock, randomness, HTTP, and the filesystem.**

At the junior level you learned the five doubles and the stub-vs-mock split. Now we turn that split into a deliberate testing *style*. Every double you write supports one of two verification strategies — checking the **resulting state** or checking the **interactions** — and the two long-running schools of thought (Detroit/classical and London/mockist) are really arguments about which to prefer.

You'll also learn to fake the four dependencies juniors most often get wrong: the **clock**, **randomness**, **HTTP**, and the **filesystem**. Done right, these make untestable code trivially testable.

---

## Prerequisites

- The five doubles and the stub-vs-mock distinction ([junior.md](junior.md)).
- Comfortable with dependency injection (the `dependency-injection` skill).
- You can write tests with a real framework: `pytest`, `go test`, JUnit, or Jest.
- You understand interfaces/abstract types well enough to define one and implement it twice.

---

## Glossary

| Term | Meaning |
|---|---|
| **State verification** | Asserting on the SUT's resulting state or return value after acting. The "classical" style. |
| **Behavior verification** | Asserting that specific *calls* were made to a collaborator. The "mockist" style. |
| **Classical / Detroit** | School that mocks only at awkward boundaries; prefers real objects and fakes, verifies state. |
| **Mockist / London** | School that mocks *every* collaborator of the SUT; verifies interactions. Tied to "outside-in" TDD. |
| **Seam** | A place where you can substitute behavior without editing the code under test. DI creates seams. |
| **Fake clock** | An injected time source you can set/advance manually, instead of the real wall clock. |
| **Spy** | A double that records its invocations for later inspection (calls, arguments, counts). |
| **httptest / WireMock** | Tools that stand up a fake HTTP server returning canned responses. |

---

## Core Concept 1 — State Verification vs Behavior Verification

There are two fundamentally different things a test can assert.

**State verification** — act, then check the *resulting state or output*:

```python
def test_deposit_increases_balance():
    account = Account(balance=100)
    account.deposit(50)
    assert account.balance == 150        # check resulting STATE
```

**Behavior verification** — act, then check that *a particular call happened*:

```python
def test_deposit_writes_to_the_ledger():
    ledger = Mock()
    account = Account(balance=100, ledger=ledger)
    account.deposit(50)
    ledger.record.assert_called_once_with(amount=50)   # check the INTERACTION
```

State verification (stubs/fakes support it) treats your code as a black box: *given this, I expect that result.* Behavior verification (mocks do it) reaches inside: *I expect you to make this specific call.*

The consequence for **brittleness** is profound. State tests only break when the *observable result* changes — exactly when you'd want them to. Behavior tests break whenever the *implementation* changes, even if the result is identical. If you rename `record` to `append`, or batch two ledger writes into one, the behavior test fails though nothing users care about changed. **Prefer state verification** unless the interaction genuinely *is* the contract.

---

## Core Concept 2 — The Spy: A Stub That Remembers

A spy is a stub that also records how it was called, so you can inspect afterwards. The key difference from a mock: a spy **records silently and lets you assert at the end**, whereas a mock has expectations **set up front** and verifies itself. Spies make behavior verification readable without front-loaded ceremony.

Go, hand-rolled spy (Go's idiomatic style — small interface, struct that records):

```go
type Notifier interface {
    Notify(userID string, msg string) error
}

// Spy: implements Notifier AND records every call.
type spyNotifier struct {
    calls []struct {
        userID, msg string
    }
}

func (s *spyNotifier) Notify(userID, msg string) error {
    s.calls = append(s.calls, struct{ userID, msg string }{userID, msg})
    return nil
}

func TestWelcomeSendsOneNotification(t *testing.T) {
    spy := &spyNotifier{}
    svc := NewSignupService(spy)

    svc.Register("u-1")

    if len(spy.calls) != 1 {
        t.Fatalf("want 1 notification, got %d", len(spy.calls))
    }
    if spy.calls[0].userID != "u-1" {
        t.Errorf("notified wrong user: %s", spy.calls[0].userID)
    }
}
```

Hand-rolling a spy as a small struct is idiomatic Go and beats a heavyweight mocking framework for most cases — it's explicit and refactor-friendly.

---

## Core Concept 3 — The Fake: A Working In-Memory Implementation

A fake is the most underused and most valuable double. Instead of canned-per-call answers, it's a *real implementation* with a shortcut — so it behaves correctly across an entire test, no matter what sequence of calls you make.

An in-memory repository fake (Python):

```python
class InMemoryUserRepo:
    """A FAKE: real save/get behavior, backed by a dict instead of a DB."""
    def __init__(self):
        self._store = {}

    def save(self, user):
        self._store[user.id] = user

    def get(self, user_id):
        return self._store.get(user_id)

def test_register_then_fetch_round_trips():
    repo = InMemoryUserRepo()           # one fake, used like the real thing
    service = SignupService(repo)

    service.register(id=7, name="Ada")

    assert repo.get(7).name == "Ada"    # STATE verification on a real-ish object
```

Why fakes beat a pile of stubs: a stub answers one canned value; a fake **stays consistent** — what you save, you can get back; deletes actually delete. You can write a multi-step test (register → update → fetch) against it. Maintain the fake *alongside* the real repository, ideally behind the same interface, and run the **same contract test suite** against both to keep them honest.

---

## Core Concept 4 — Classical (Detroit) vs Mockist (London)

Two schools, named for where they emerged:

- **Classical / Detroit (Beck, Fowler).** Use real objects wherever practical. Reach for a double **only** at *awkward* collaborators — slow, nondeterministic, side-effecting, or expensive ones (DB, network, clock). Prefer **fakes and real objects** over mocks. Verify **state**.
- **Mockist / London (Freeman, Pryce — *Growing Object-Oriented Software, Guided by Tests*).** Mock **every** collaborator of the unit, so each test isolates a single class. Drives design "outside-in": you discover the interfaces a class *needs* by mocking them. Verify **behavior**.

| | Classical (Detroit) | Mockist (London) |
|---|---|---|
| What to mock | Awkward boundaries only | Every collaborator |
| Verifies | State / output | Interactions |
| Refactor safety | High — tests survive internal changes | Lower — tests coupled to call structure |
| Drives design? | Less directly | Strongly (outside-in TDD) |
| Failure localization | Broader (cluster of objects) | Sharp (one class) |

The modern consensus leans **classical**: mock at architectural boundaries, prefer fakes, and follow two rules that cut across both schools — **"don't mock what you don't own"** and **"prefer fakes/real objects to mocks."** London-style isolation is a powerful *design* tool during TDD, but a suite where every collaborator is mocked tends to become brittle (see senior level). Most teams use a blend: London thinking to *discover* interfaces, Detroit verification to *keep* the resulting tests robust.

---

## Core Concept 5 — Faking the Clock and Randomness

The clock and the random source are the two classic sources of nondeterminism. **Never `sleep` in a test, and never let production read the wall clock directly.** Inject them.

**The clock** — inject a time source instead of calling `time.Now()`:

```go
type Clock interface{ Now() time.Time }

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

// Fake clock you control:
type fakeClock struct{ t time.Time }
func (c *fakeClock) Now() time.Time { return c.t }

func TestTokenExpiresAfterOneHour(t *testing.T) {
    clk := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
    tok := IssueToken(clk)

    clk.t = clk.t.Add(61 * time.Minute)   // "advance time" instantly
    if !tok.IsExpired(clk) {
        t.Fatal("token should be expired after 61 minutes")
    }
}
```

A one-hour-expiry rule is now tested in microseconds, deterministically.

**Randomness** — inject the source (or a seed) so "random" becomes reproducible:

```python
import random

def pick_winner(entrants, rng):
    return entrants[rng.randrange(len(entrants))]

def test_winner_is_deterministic_with_a_seeded_rng():
    rng = random.Random(42)              # injected, seeded → reproducible
    assert pick_winner(["a", "b", "c"], rng) == "c"   # same every run
```

The rule: **anything nondeterministic becomes a dependency you inject.** Then the test controls it.

---

## Core Concept 6 — Faking HTTP and the Filesystem

**HTTP** — don't call the real API; stand up a fake server. Go's `httptest` (in the standard library) is the model:

```go
func TestClientParsesResponse(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(
        func(w http.ResponseWriter, r *http.Request) {
            w.Write([]byte(`{"temp_c": 21}`))   // canned response
        }))
    defer srv.Close()

    c := NewWeatherClient(srv.URL)         // point the client at the fake
    got, _ := c.Temperature("London")
    if got != 21 {
        t.Errorf("want 21, got %v", got)
    }
}
```

`httptest` runs a real local server, so you exercise your *actual* HTTP code (URL building, headers, JSON decoding) against canned responses. In the JVM/JS world, **WireMock** plays the same role. This is far better than mocking your HTTP client object, because it tests the real serialization path.

**The filesystem** — inject a filesystem abstraction (Go's `io/fs`, an in-memory `fs` in Node, `pyfakefs` in Python) so tests never touch a real disk, leave no temp files, and run in parallel without collisions.

> Caveat: faking an external HTTP API still tests *your model* of that API, which may be wrong. The honest answer is **contract testing** ([05-contract-testing](../05-contract-testing/middle.md)) — covered in the senior tier under "don't mock what you don't own."

---

## Real-World Examples

- **Subscription renewal.** Inject a fake clock; advance it 30 days; assert the renewal job fires — instead of waiting a month.
- **Retry with backoff.** Inject the clock so the test can "fast-forward" through backoff delays in microseconds (see the `retry-pattern` skill).
- **Shuffling a deck.** Inject a seeded RNG so a "fair shuffle" test is reproducible and debuggable.
- **Order service tests.** Run the *same* contract suite against `InMemoryOrderRepo` (fake) and `PostgresOrderRepo` (real) to prove the fake stays faithful.

---

## Mental Models

- **State = black box, behavior = white box.** State tests check what comes out; behavior tests check what happens inside. Black-box tests survive refactors better.
- **Fakes scale, stubs don't.** One fake serves a whole test class consistently; stubs need per-call setup and drift out of sync with reality.
- **Inject your nondeterminism.** Clock, random, HTTP, filesystem — each becomes a constructor parameter. Then "uncontrollable" becomes "trivially controllable."
- **London to discover, Detroit to keep.** Use mock-everything thinking to find interfaces; verify state to keep the tests robust.

---

## Common Mistakes

- **Behavior-verifying a pure result.** Asserting `ledger.record.assert_called` when you could assert `account.balance == 150`. Prefer the state check.
- **`sleep()` in tests.** It's slow and still flaky. Inject a clock and advance it.
- **Mocking your own HTTP client object** instead of using `httptest`/WireMock — you skip the real serialization code, which is where bugs live.
- **A fake that lies.** An in-memory repo whose `save` silently ignores duplicates while the real DB errors. Pin both with a shared contract test.
- **Going full mockist by default.** Mocking every collaborator gives sharp failure localization but a brittle suite. Mock awkward boundaries, fake the rest.

---

## Test Yourself

1. Write the same assertion two ways: once as state verification, once as behavior verification. When is each appropriate?
2. What's the difference between a spy and a mock in *when* the verification is set up?
3. Why is a fake repository usually better than three stubs for a multi-step test?
4. Summarize Detroit vs London in one sentence each. Which does the modern consensus lean toward, and why?
5. Show how you'd test "this token expires after one hour" without any `sleep`.
6. Why does `httptest` beat mocking your HTTP client object?

---

## Cheat Sheet

```
VERIFICATION STYLES
  state    → assert on result/output     (stubs, fakes)   ← prefer
  behavior → assert a call happened       (mocks, spies)   ← only when call IS the contract

SCHOOLS
  Detroit (classical): mock awkward boundaries only, prefer fakes/real, verify state
  London  (mockist)  : mock every collaborator, verify behavior, drives outside-in TDD
  consensus: blend — London to discover interfaces, Detroit to keep tests robust
  always: "don't mock what you don't own" + "prefer fakes to mocks"

FAKING NONDETERMINISM (inject it!)
  clock      → Clock interface, fakeClock you set/advance     (never sleep)
  randomness → inject seeded RNG                              (reproducible)
  HTTP       → httptest (Go) / WireMock (JVM,JS)              (real serialization)
  filesystem → io/fs, pyfakefs, memfs                         (no real disk)
```

---

## Summary

Every double serves one of two strategies: **state verification** (assert on the result — supported by stubs and fakes) or **behavior verification** (assert that a call happened — done by mocks and spies). State checks are a black box and survive refactors; behavior checks couple to implementation and break more often, so **default to state**. The **classical/Detroit** school mocks only awkward boundaries and prefers fakes and real objects; the **mockist/London** school mocks every collaborator and drives outside-in design. The consensus blends them but leans classical, under two banner rules: *don't mock what you don't own* and *prefer fakes to mocks*. Finally, tame nondeterminism by **injecting** it — a fake clock, a seeded RNG, `httptest`/WireMock for HTTP, an in-memory filesystem — turning untestable code deterministic. The [senior level](senior.md) confronts the over-mocking trap and designing for fewer doubles.

---

## Further Reading

- Martin Fowler — *Mocks Aren't Stubs* (state vs behavior; Detroit vs London).
- Freeman & Pryce — *Growing Object-Oriented Software, Guided by Tests* (the London/mockist case).
- Go blog & docs — `net/http/httptest`.
- WireMock and `pyfakefs` documentation.
- The `mocking-strategies`, `dependency-injection`, and `unit-testing-patterns` skills.

---

## Related Topics

- [Unit Testing — Middle](../02-unit-testing/middle.md) — classical vs mockist in the context of "what is a unit."
- [Integration Testing](../03-integration-testing/middle.md) — when real collaborators beat fakes.
- [Contract Testing](../05-contract-testing/middle.md) — keeping fakes faithful to the real thing.
- [Test Doubles — Senior](senior.md) — the over-mocking trap and design for testability.
