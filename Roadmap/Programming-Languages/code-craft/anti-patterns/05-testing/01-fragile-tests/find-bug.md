# Fragile Tests — Find the Bug

> **Category:** [Testing Anti-Patterns](../README.md) → **Fragile Tests** — *a test that breaks when you change code without changing its behavior.*

---

This file is **critical-reading practice**. Each snippet below is a plausible test in Go, Java, or Python. Your job is to read it the way a good reviewer does and answer three questions:

> **What is this test coupled to? What behavior-preserving change would break it? How would you rewrite it to assert the contract instead?**

The "bug" here is rarely a crash — it's a latent flaw in *what the test asserts*. A fragile test passes today and breaks tomorrow for the wrong reason: someone refactored the implementation without changing its behavior, and the test went red anyway. Some snippets are deliberately innocent-looking — tests that would sail through a casual review because they're *green* and look *thorough*. A few are **traps**: tests that look fragile but are actually correct, because the thing they pin really is the contract. Read slowly, then open the answer.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is asking "would this survive a behavior-preserving refactor?" — not recalling the name.

---

## Table of Contents

1. [The thorough-looking user test](#snippet-1--the-thorough-looking-user-test)
2. [Verifying the save](#snippet-2--verifying-the-save)
3. [The exact JSON](#snippet-3--the-exact-json)
4. [The sorted-looking result](#snippet-4--the-sorted-looking-result)
5. [Reading the cache](#snippet-5--reading-the-cache)
6. [The log says so](#snippet-6--the-log-says-so)
7. [Charge exactly once](#snippet-7--charge-exactly-once)

---

## Snippet 1 — The thorough-looking user test

```python
# Python — looks diligent: asserts "everything" about the created user.
def test_create_user():
    u = create_user("Sam", "sam@example.com")
    assert u == User(
        id=1,
        name="Sam",
        email="sam@example.com",
        status="ACTIVE",
        created_at=datetime(2026, 6, 10, 12, 0, 0),
        version=1,
    )
```

> What is this test coupled to? What behavior-preserving change would break it? How would you rewrite it?

<details>
<summary>Answer</summary>

**Over-specified assertion** (and incidentally **flaky**).

It looks thorough because it asserts the *whole* object — which is exactly the problem. The behavior under test is presumably "create_user makes an active user from a name and email." But the assertion also pins:
- **`id=1`** — a generated value; breaks the moment the id sequence shifts (another test runs first, you switch to UUIDs).
- **`created_at=datetime(2026, 6, 10, 12, 0, 0)`** — a timestamp; this is *also flaky*, it'll fail on the next run unless time is frozen.
- **`version=1`** — unrelated to user creation; breaks if a versioning scheme changes.

Any of these changes is behavior-preserving for "create an active user," yet each turns the test red. And the timestamp makes it fail non-deterministically too — fragility and flakiness in one line.

**Rewrite — assert only what this behavior promises:**

```python
def test_create_user_makes_active_user():
    u = create_user("Sam", "sam@example.com")
    assert u.name == "Sam"
    assert u.email == "sam@example.com"
    assert u.status == "ACTIVE"
    assert u.id is not None          # an id exists; value not pinned
    # created_at and version are incidental to THIS behavior → not asserted.
```

The test now fails for one reason: create_user stopped producing an active user with the right name/email. Id-generation and timestamping are other tests' (or no test's) concern.

</details>

---

## Snippet 2 — Verifying the save

```java
// Java — a deletion test that "checks the database was updated."
@Test
void deleteUser_removesUser() {
    UserRepo repo = mock(UserRepo.class);
    UserService service = new UserService(repo);

    service.delete(42L);

    verify(repo).deleteById(42L);   // the only assertion
}
```

> What is this test coupled to? What behavior-preserving change would break it? How would you rewrite it?

<details>
<summary>Answer</summary>

**Mock interaction (white-box).** The test asserts that `deleteById(42L)` *was called* — not that the user is actually gone. Two problems:

1. **It doesn't test the behavior.** It would pass even if `delete` called `deleteById(42L)` and then immediately re-inserted the user, or if `deleteById` is a no-op. Verifying the call proves the *mechanism* ran, not that the *outcome* happened.
2. **It's fragile.** Refactor `delete` to remove via `repo.remove(user)` instead of `deleteById`, or to soft-delete by setting a flag — both behavior-preserving for "the user is no longer retrievable" — and the `verify` breaks.

**Rewrite — use a fake and assert the outcome:**

```java
@Test
void deleteUser_makesUserUnretrievable() {
    FakeUserRepo repo = new FakeUserRepo();
    repo.save(new User(42L, "sam@x.io"));
    UserService service = new UserService(repo);

    service.delete(42L);

    assertThat(repo.findById(42L)).isEmpty();   // the actual contract: it's gone
}
```

This catches the re-insert bug the original missed, and survives any change to *how* deletion is implemented.

> **Caveat:** if `delete` were a genuine fire-and-forget command against an external system with no queryable state, interaction verification at that boundary might be the only option — see Snippet 7. Here there's queryable state, so assert on it.

</details>

---

## Snippet 3 — The exact JSON

```go
// Go — an API handler test that checks the response body.
func TestUserEndpoint(t *testing.T) {
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, newRequest("GET", "/users/1"))

    expected := `{"id":1,"name":"Sam","email":"sam@x.io","roles":["admin"]}`
    assert.Equal(t, expected, rec.Body.String())
}
```

> What is this test coupled to? What behavior-preserving change would break it? How would you rewrite it?

<details>
<summary>Answer</summary>

**Output format coupling** — the test pins the JSON *byte-for-byte*: key order, no whitespace, exact field set.

Behavior-preserving changes that break it:
- A serializer or struct-field reorder changes key order → identical data, red test.
- Adding a new field (`"created_at"`) to the response — additive, non-breaking for existing clients — breaks the exact-match.
- Any pretty-printing or whitespace change.

**Rewrite — parse, then assert on values:**

```go
func TestUserEndpoint_returnsUser(t *testing.T) {
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, newRequest("GET", "/users/1"))

    require.Equal(t, http.StatusOK, rec.Code)
    var got struct {
        ID    int      `json:"id"`
        Name  string   `json:"name"`
        Roles []string `json:"roles"`
    }
    require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))

    assert.Equal(t, 1, got.ID)
    assert.Equal(t, "Sam", got.Name)
    assert.Equal(t, []string{"admin"}, got.Roles)
}
```

Parsing into a struct that names *only the fields this test cares about* decouples it from key order and from additive fields. It now verifies the contract (the values a client reads) rather than the byte layout.

> **Nuance:** if this is a *public* API and the exact wire shape is a versioned contract, a schema/contract test is appropriate — but assert the *schema* deliberately (field presence, types), not an incidental string literal.

</details>

---

## Snippet 4 — The sorted-looking result

```python
# Python — two tests on a function that returns active user ids.
def get_active_ids(users):
    return [u.id for u in users if u.active]   # preserves input order... today

def test_active_ids():
    users = [User(1, True), User(2, False), User(3, True)]
    assert get_active_ids(users) == [1, 3]     # Test A

def test_active_ids_sorted():
    result = sort_ids_descending(get_active_ids(users))
    assert result == [3, 1]                     # Test B
```

> One of these is fragile and one is correct. Which is which, and why?

<details>
<summary>Answer</summary>

**A trap: Test A is fragile; Test B is correct.**

**Test A** asserts `== [1, 3]` — an *exact order*. But `get_active_ids`'s contract is "the ids of the active users," a *set*, not a sequence. The current implementation happens to preserve input order, but switching to a set-based or concurrent implementation — behavior-preserving for "which ids are active" — would change the order and break the test. It pins an order the contract never promised.

```python
def test_active_ids_returns_active_set():
    users = [User(1, True), User(2, False), User(3, True)]
    assert set(get_active_ids(users)) == {1, 3}   # membership, not order
```

**Test B** asserts `== [3, 1]` on the output of `sort_ids_descending`. Here order *is* the contract — the function's whole job is to sort descending. Pinning the exact order is **correct**, not fragile; loosening it to a set would delete the very guarantee under test.

**The lesson for critical reading:** an exact-order assertion is fragile only when order *isn't* part of the contract. Don't pattern-match "exact list = bad." Ask what the function *promises*: a set (membership) or a sequence (order). Same assertion shape, opposite verdict.

</details>

---

## Snippet 5 — Reading the cache

```java
// Java — testing a memoizing service.
@Test
void compute_cachesResult() {
    PriceService svc = new PriceService();

    svc.price("ABC");
    svc.price("ABC");   // second call should hit the cache

    // Reach into the private cache via reflection to "prove" memoization.
    Map<String, Money> cache =
        (Map<String, Money>) ReflectionTestUtils.getField(svc, "cache");
    assertThat(cache).containsKey("ABC");
}
```

> What is this test coupled to? What behavior-preserving change would break it? How would you rewrite it?

<details>
<summary>Answer</summary>

**Private state coupling, via reflection** — the worst kind, because it bypasses the public API entirely to assert on an internal field named `cache`.

Behavior-preserving changes that break it:
- Rename `cache` → `memo`. Identical behavior, red test.
- Switch from a `Map` to a Guava/Caffeine cache, or a two-level cache. Same memoization, red test.
- Move the cache behind a collaborator. Same behavior, red test.

And it tests the *wrong thing*: the contract of memoization is **"computing the same input twice doesn't redo the expensive work"** — an *observable* property — not "there is a field called `cache` containing the key."

**Rewrite — assert the observable effect of caching:**

```java
@Test
void compute_doesExpensiveWorkOncePerKey() {
    AtomicInteger calls = new AtomicInteger();
    PriceService svc = new PriceService(sku -> {     // inject the expensive op
        calls.incrementAndGet();
        return Money.of("10.00");
    });

    Money first  = svc.price("ABC");
    Money second = svc.price("ABC");

    assertThat(first).isEqualTo(second);             // same result
    assertThat(calls.get()).isEqualTo(1);            // expensive work ran ONCE — that's caching
}
```

Now the test verifies memoization *behaviorally* (the underlying computation runs once), through a seam, with no knowledge of how or where the result is stored. Any caching implementation that keeps the promise stays green.

</details>

---

## Snippet 6 — The log says so

```python
# Python — an order processor that logs its work.
def test_process_order(caplog):
    process_order(order_42)
    assert "Order 42 processed successfully for customer Sam (total: $99.00)" in caplog.text
```

> What is this test coupled to? What behavior-preserving change would break it? How would you rewrite it?

<details>
<summary>Answer</summary>

**Output-format coupling to log prose** — the single most volatile text in any codebase.

This breaks on changes that don't touch behavior at all:
- Reword "processed successfully" → "completed" or "done."
- Change "$99.00" formatting to "99.00 USD," or the id format from "Order 42" to "Order #42."
- Add an emoji, change capitalization, reorder the sentence.

None of these change whether the order was *actually* processed — but each turns the test red. Worse, the test is using the log as a *proxy* for behavior, which is doubly wrong: it doesn't verify the order's real outcome (was it persisted? confirmed? charged?), only that a particular sentence was printed.

**Rewrite — assert the behavior the log describes:**

```python
def test_process_order_confirms_and_charges():
    process_order(order_42)
    assert order_42.status == "CONFIRMED"            # the real outcome
    assert payments.charged(order_42.id) == Money("99.00")
    # No assertion on log text — the behavior is verified directly.
```

If the *emission of an audit log* is itself a contractual requirement (compliance), assert on a **structured event**, never the prose:

```python
def test_process_order_emits_audit_event(audit_sink):
    process_order(order_42)
    e = audit_sink.last()
    assert e.type == "order.processed"   # stable contract field
    assert e.order_id == 42
    # The human-readable message is free to change.
```

</details>

---

## Snippet 7 — Charge exactly once

```go
// Go — testing a payment service that retries on transient failure.
func TestCharge_exactlyOnce(t *testing.T) {
    gw := NewFakeGateway()                 // a fake at the real boundary
    gw.FailNextN(2)                        // first two attempts flake, third succeeds
    svc := NewPayments(gw, RetryPolicy{Max: 3})

    err := svc.Charge(order42)

    require.NoError(t, err)
    assert.Equal(t, 1, gw.SuccessfulCharges(order42.ID))  // charged exactly once
}
```

> This asserts on an *interaction* (the charge count). Is it fragile? Why or why not?

<details>
<summary>Answer</summary>

**Trap: NOT fragile — this is correct.** It asserts on an interaction, but the interaction *is the contract*.

"Charge the card **exactly once**, even when the gateway flakes and we retry" is a hard business/correctness requirement — charging twice is a real-money bug. There is no return value or queryable state that captures "exactly once" *except* the count of successful charges at the gateway boundary. So verifying the interaction here is the *only* way to pin the contract, and it's the right thing to do.

What makes it legitimate (and distinguishes it from fragile white-box mocking):
- The verification is at a **genuine external boundary** (the payment gateway), not on an internal collaborator.
- The thing pinned (**exactly-once**) is a **promise the system makes**, not an implementation detail of *how* the retry loop is structured.
- It uses a **fake** that records real outcomes, not a strict mock scripting an internal call sequence — so the *retry implementation* (backoff strategy, attempt count) is free to change as long as the gateway is charged exactly once.

**Contrast with a fragile version** that *would* be white-box:

```go
// Fragile: pins the internal retry choreography, not the contract.
gw.AssertCalled(t, "Attempt")            // how many internal attempts? implementation detail
mock.InOrder(gw.Attempt, gw.Attempt, gw.Commit)  // freezes the retry algorithm
```

This breaks if you change the backoff or attempt count — behavior-preserving for "charged once." The good test pins the *outcome of the interaction* (one successful charge); the fragile one pins the *internal steps*.

**The lesson:** interaction testing is fragile when it pins internal choreography, and correct when it pins a *boundary contract* like exactly-once, ordering, or protocol conformance. Ask "is the interaction itself the promise?"

</details>

---

## Summary — patterns of spotting

You don't spot a fragile test by a single bad keyword — you spot it by asking one question of every assertion: **"would this survive a behavior-preserving refactor, and would it still fail if the behavior actually broke?"** The repeatable moves from these seven snippets:

- **A "thorough" full-object assertion is usually over-specification** (Snippet 1). It pins generated ids, timestamps, and unrelated fields; assert only what the behavior promises, and *existence* not *value* for generated data.
- **`verify(mock).x()` as the main assertion tests the mechanism, not the outcome** (Snippet 2). It passes even when the result is wrong and breaks on any re-plumbing. Use a fake, assert the observable result.
- **Byte-for-byte serialized output pins key order and forbids additive fields** (Snippet 3). Parse, then assert on the values a consumer reads.
- **Exact order is fragile only when order isn't the contract** (Snippet 4 trap). Ask whether the function promises a *set* or a *sequence* before crying fragile.
- **Reflection / private-field access bypasses the contract entirely** (Snippet 5). Assert the *observable effect* (e.g. "expensive work ran once") through a seam, never the internal storage.
- **Asserting on log prose couples to the most volatile text you have** (Snippet 6). Assert the behavior the log describes; use structured events if emission is contractual.
- **Interaction testing is correct when the interaction is the contract** (Snippet 7 trap) — exactly-once, ordering, protocol — at a real boundary. It's fragile only when it pins internal choreography.

The meta-lesson: **fragility is about *what you assert*, not *how green the test is today*.** Two of these seven snippets pin exactly the thing they should and are correct; the other five pin details the contract never promised and will go red on the next harmless refactor. Read every assertion and ask whether it names a promise the code actually makes.

---

## Related Topics

- [`junior.md`](junior.md) — what a fragile test looks like and the three first habits.
- [`middle.md`](middle.md) — the four creep patterns and the contract-vs-implementation rule.
- [`tasks.md`](tasks.md) — fix-it exercises that build the same muscle from the writing side.
- [`optimize.md`](optimize.md) — refactor a whole over-specified test file end-to-end.
- [`professional.md`](professional.md) — when an interaction or exact-match assertion is *correct*, not fragile.
- [Over-Mocking](../06-over-mocking/find-bug.md) — the find-bug file for mock-induced fragility.
- The `mocking-strategies` and `unit-testing-patterns` skills — state vs interaction verification, fakes vs mocks.
