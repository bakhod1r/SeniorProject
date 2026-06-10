# Fragile Tests — Refactoring Practice

> **Category:** [Testing Anti-Patterns](../README.md) → **Fragile Tests** — *take an over-specified test file and make it refactor-resilient.*

---

These are not "spot the smell" puzzles — [`find-bug.md`](find-bug.md) does that. Here the test file is **fragile but currently green**, and your job is to **transform it into refactor-resilient tests without losing the real coverage it has**. The skill on display is the *process*, not just the destination:

1. **Decide what the contract is.** Before touching an assertion, name the caller-visible behavior the test is *supposed* to protect. That's what you keep; everything else is coupling.
2. **Decouple, don't gut.** Narrow over-specified assertions to the contract, replace verifying mocks with fakes, parse instead of string-matching — but **preserve every assertion that catches a real behavior**. The risk in de-fragilizing is throwing out a baby with the bathwater.
3. **Verify you didn't lose coverage.** A robust test must still *fail when the behavior actually breaks*. Mentally (or with mutation testing) check: could this test still catch the bug it was meant to catch?

> **How to use this file:** read the "Before" file, write down your decoupling plan *yourself* before expanding the solution, then compare. The gap between your plan and the worked plan is where the learning is. Refer back to [`middle.md`](middle.md) for the creep patterns and [`senior.md`](senior.md) for the suite-level moves.

---

## Table of Contents

| # | File to refactor | Fragility sources | Lang | Key moves |
|---|---|---|---|---|
| 1 | [The order-service test suite](#exercise-1--the-order-service-test-suite) | Over-spec + mocks + log + JSON | Java | Narrow asserts, fakes, parse, drop log |
| 2 | [The pipeline snapshot test](#exercise-2--the-pipeline-snapshot-test) | Snapshot-everything + private state | Python | Targeted asserts, behavior via seam |
| 3 | [The repository interaction tests](#exercise-3--the-repository-interaction-tests) | White-box mocking cluster | Go | Fake + contract test, outcome asserts |

---

## Exercise 1 — The order-service test suite

**Anti-pattern:** over-specification + mock interactions + log assertions + exact-JSON. **Goal:** every test survives a behavior-preserving refactor and still catches a real regression. **Constraint:** keep the behavioral guarantees the suite currently provides.

```java
// BEFORE — four tests, all green, all fragile.
class OrderServiceTest {

    @Test
    void place_savesOrder() {
        OrderRepo repo = mock(OrderRepo.class);
        Mailer mailer = mock(Mailer.class);
        OrderService svc = new OrderService(repo, mailer);

        svc.place(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        // Pins the exact internal choreography:
        InOrder o = inOrder(repo, mailer);
        o.verify(repo).beginTx();
        o.verify(repo).save(any(Order.class));
        o.verify(repo).commit();
        o.verify(mailer).sendConfirmation(eq("sam@x.io"));
        verifyNoMoreInteractions(repo, mailer);
    }

    @Test
    void place_returnsFullOrder() {
        OrderService svc = new OrderService(new FakeOrderRepo(), new FakeMailer());

        Order order = svc.place(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        // Full-object equals pins generated id, timestamp, version:
        assertThat(order).isEqualTo(new Order(
            1L, "sam@x.io", List.of(item("A", 2)), Status.CONFIRMED,
            BigDecimal.valueOf(20), Instant.parse("2026-06-10T00:00:00Z"), 1));
    }

    @Test
    void place_logsSuccess() {
        OrderService svc = new OrderService(new FakeOrderRepo(), new FakeMailer());

        svc.place(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        assertThat(logCapture.text())
            .contains("Order 1 placed successfully for sam@x.io, total $20.00");
    }

    @Test
    void place_serializesResponse() {
        OrderService svc = new OrderService(new FakeOrderRepo(), new FakeMailer());

        String json = svc.placeAndSerialize(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        assertThat(json).isEqualTo(
            "{\"id\":1,\"email\":\"sam@x.io\",\"status\":\"CONFIRMED\",\"total\":20}");
    }
}
```

**Your plan:** for each test, name the behavior it protects, then decouple. Write it down before expanding.

<details>
<summary>Solution</summary>

**Step 1 — name the contract of each test.**

| Test | Behavior it should protect | Fragility to remove |
|---|---|---|
| `place_savesOrder` | a placed order is persisted | strict `inOrder` + `verifyNoMoreInteractions` |
| `place_returnsFullOrder` | the returned order is CONFIRMED with the right total | full-object equals (id, timestamp, version) |
| `place_logsSuccess` | (nothing the others don't already cover) | log-text assertion |
| `place_serializesResponse` | the serialized response carries the order's data | byte-for-byte JSON |

**Step 2 — refactored suite.**

```java
class OrderServiceTest {

    private OrderService svc;
    private FakeOrderRepo repo;
    private FakeMailer mailer;

    @BeforeEach
    void setup() {
        repo = new FakeOrderRepo();
        mailer = new FakeMailer();
        svc = new OrderService(repo, mailer);   // fakes, not verifying mocks
    }

    @Test
    void place_persistsConfirmedOrder() {
        Order order = svc.place(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        // Outcome, not choreography: the order is persisted and confirmed.
        assertThat(repo.findById(order.id())).isPresent();
        assertThat(order.status()).isEqualTo(Status.CONFIRMED);
        assertThat(order.total()).isEqualByComparingTo(BigDecimal.valueOf(20));
    }

    @Test
    void place_sendsConfirmationToCustomer() {
        svc.place(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        // A confirmation exists for the customer — outcome, not "the method was called".
        assertThat(mailer.confirmationsTo("sam@x.io")).hasSize(1);
    }

    @Test
    void place_serializesOrderData() {
        String json = svc.placeAndSerialize(new OrderRequest("sam@x.io", List.of(item("A", 2))));

        // Parse, then assert values — key order and added fields can't break it.
        DocumentContext doc = JsonPath.parse(json);
        assertThat(doc.read("$.email", String.class)).isEqualTo("sam@x.io");
        assertThat(doc.read("$.status", String.class)).isEqualTo("CONFIRMED");
        assertThat(doc.read("$.total", Integer.class)).isEqualTo(20);
    }
}
```

**What changed, and why each is better:**

1. **`place_savesOrder` → `place_persistsConfirmedOrder`.** The strict `inOrder`/`verifyNoMoreInteractions` froze the transaction choreography (`beginTx`/`save`/`commit`). Replaced with a **fake repo** and an assertion on the *outcome* — the order is findable and CONFIRMED. Now the service can change how it manages the transaction (batch, no explicit tx, an outbox) and the test stays green; it fails only if the order isn't actually persisted. Bonus: the original never checked the saved *total* — the new one does, catching a class of bug the fragile version missed.

2. **`place_returnsFullOrder` → folded into `place_persistsConfirmedOrder`.** The full-object equals pinned the generated id, the timestamp (also flaky), and `version`. Narrowed to the fields this behavior promises: status and total. Id/timestamp/version are incidental.

3. **`place_logsSuccess` → deleted.** It asserted only log prose, and the *information* it carried (order placed, total $20, for sam@x.io) is already verified behaviorally by the other tests. Deleting it loses **no** coverage — it was testing a sentence, not a behavior. (If audit logging were contractual, we'd assert a structured event instead, not delete.)

4. **`place_serializesResponse` → `place_serializesOrderData`.** Byte-for-byte JSON pinned key order and forbade additive fields. Parsing with JsonPath and asserting on *values* decouples it from layout while still verifying the data a consumer reads.

5. **Mailer assertion → outcome.** `verify(mailer).sendConfirmation(...)` became `mailer.confirmationsTo("sam@x.io")` on a fake — asserts a confirmation *exists* for the customer, not that a specific method was invoked, so re-plumbing the notification (events, a queue) keeps it green.

**Coverage check:** the refactored suite still fails if an order isn't persisted, isn't confirmed, has the wrong total, doesn't confirm to the customer, or serializes the wrong values — every real guarantee preserved, plus the new total check. The only thing it *stopped* failing on is behavior-preserving change. That's the goal.

</details>

---

## Exercise 2 — The pipeline snapshot test

**Anti-pattern:** snapshot-everything + private-state access. **Goal:** assert the specific facts the pipeline guarantees, so a formatting/internal change doesn't force a reflexive snapshot re-record. **Constraint:** keep verifying that the pipeline transforms and routes correctly.

```python
# BEFORE — a snapshot of the whole result + a private-state peek.
def test_pipeline(snapshot):
    pipeline = Pipeline()
    result = pipeline.run(raw_events)

    # 1. Snapshot the ENTIRE rendered output — fails on any change, re-recorded reflexively.
    snapshot.assert_match(render(result))

    # 2. Reach into the private dedup cache to "prove" dedup happened.
    assert pipeline._seen == {"e1", "e2", "e3"}

def test_pipeline_routing(snapshot):
    pipeline = Pipeline()
    pipeline.run(raw_events)
    # Another whole-object snapshot of internal routing tables.
    snapshot.assert_match(repr(pipeline._router._routes))
```

**Your plan:** what does the pipeline actually *promise*? Decouple from rendering and internals. Write it down first.

<details>
<summary>Solution</summary>

**Step 1 — name the contract.** The pipeline presumably promises: (a) it *deduplicates* repeated events, (b) it *transforms* events into the output shape, and (c) it *routes* each event to the right destination. None of those is "the rendered string is byte-identical" or "there's a private field named `_seen`."

**Step 2 — refactored tests.**

```python
def test_pipeline_deduplicates_events():
    pipeline = Pipeline()
    events = [event("e1"), event("e1"), event("e2")]   # e1 repeated

    result = pipeline.run(events)

    # Behavioral proof of dedup: the OUTPUT has each id once, regardless of internals.
    assert sorted(r.id for r in result) == ["e1", "e2"]

def test_pipeline_transforms_event_fields():
    pipeline = Pipeline()
    result = pipeline.run([event("e1", value=10)])

    # Assert the specific transformation facts, not a whole rendered blob.
    out = result[0]
    assert out.id == "e1"
    assert out.normalized_value == 1.0     # the transform's contract

def test_pipeline_routes_by_type(fake_router):
    pipeline = Pipeline(router=fake_router)   # inject a fake at the routing seam
    pipeline.run([event("e1", type="alert"), event("e2", type="metric")])

    # Routing is observable through where things landed — not via _router._routes.
    assert fake_router.delivered_to("alerts") == ["e1"]
    assert fake_router.delivered_to("metrics") == ["e2"]
```

**What changed, and why:**

1. **Dedup snapshot → behavioral assertion.** The original "proved" dedup by snapshotting output *and* peeking at the private `_seen` set. Both are fragile: the snapshot breaks on any formatting change; `_seen` breaks if dedup is reimplemented (a bloom filter, an external store, a different field name). The robust test feeds *duplicate* input and asserts the **output** contains each id once — that's what dedup *means*, observable and implementation-agnostic.

2. **Whole-output snapshot → targeted transform assertions.** Instead of "the rendered result is byte-identical," assert the specific transformation facts (`normalized_value == 1.0`). A change to rendering, field order, or unrelated fields no longer forces a re-record, but a *wrong transform* still fails.

3. **Private routing-table snapshot → fake at the seam.** `repr(pipeline._router._routes)` pinned the internal data structure. Injecting a **fake router** lets the test assert *where events actually landed* — the observable contract of routing — without knowing how routes are stored.

**Why this beats snapshot-everything:** the original tests would go red on a CSS tweak, a field reorder, or a routing-table refactor, and the path of least resistance was always "update snapshot" — silently blessing whatever the code now does. The refactored tests fail only when dedup, transformation, or routing is *actually* wrong, and there's nothing to reflexively re-record.

> **When a snapshot would still be right here:** if `render(result)` produced a *published* document format that downstream systems parse, a *small, volatile-field-scrubbed, reviewed* snapshot of that format would be a legitimate contract test. The fix above assumes `render` is internal presentation — assert the data, not the rendering.

</details>

---

## Exercise 3 — The repository interaction tests

**Anti-pattern:** a cluster of white-box mock tests. **Goal:** decouple the whole cluster at once with a fake + contract test, asserting outcomes. **Constraint:** the fast fake-based tests must be *trustworthy* — proven to behave like the real store.

```go
// BEFORE — a cluster of tests that script and verify the store's calls.
func TestSignup_savesUser(t *testing.T) {
    store := new(MockStore)
    store.On("Exists", "sam@x.io").Return(false)
    store.On("Insert", mock.Anything).Return(nil)
    svc := NewSignup(store)

    svc.Register("sam@x.io")

    store.AssertCalled(t, "Exists", "sam@x.io")
    store.AssertCalled(t, "Insert", mock.Anything)
    store.AssertExpectations(t)
}

func TestSignup_rejectsDuplicate(t *testing.T) {
    store := new(MockStore)
    store.On("Exists", "sam@x.io").Return(true)   // scripted to look like a dup
    svc := NewSignup(store)

    err := svc.Register("sam@x.io")

    assert.Error(t, err)
    store.AssertNotCalled(t, "Insert", mock.Anything)   // verifies the absence of a call
}

func TestSignup_lowercasesEmail(t *testing.T) {
    store := new(MockStore)
    store.On("Exists", "sam@x.io").Return(false)
    store.On("Insert", mock.MatchedBy(func(u User) bool { return u.Email == "sam@x.io" })).Return(nil)
    svc := NewSignup(store)

    svc.Register("SAM@X.IO")   // mixed case in

    store.AssertExpectations(t)
}
```

**Your plan:** build the decoupling tool once, then rewrite all three. Write it down first.

<details>
<summary>Solution</summary>

**Step 1 — name the contracts.** The three tests protect: (a) a new email is registered (a user exists afterward), (b) a duplicate is rejected and *not* stored, (c) the email is normalized to lowercase before storage. All three are *outcome* facts about the store's state — currently asserted as *interactions*.

**Step 2 — build the decoupling tool: a fake + a contract test.**

```go
// A real, inspectable in-memory store.
type FakeStore struct{ byEmail map[string]User }
func NewFakeStore() *FakeStore { return &FakeStore{byEmail: map[string]User{}} }
func (f *FakeStore) Exists(email string) (bool, error) { _, ok := f.byEmail[email]; return ok, nil }
func (f *FakeStore) Insert(u User) error               { f.byEmail[u.Email] = u; return nil }
func (f *FakeStore) Get(email string) (User, bool)     { u, ok := f.byEmail[email]; return u, ok }

// Contract test — run against the fake AND the real store, so the fake can't lie.
func StoreContract(t *testing.T, newStore func() Store) {
    t.Run("insert then exists", func(t *testing.T) {
        s := newStore()
        require.NoError(t, s.Insert(User{Email: "a@x.io"}))
        ok, err := s.Exists("a@x.io")
        require.NoError(t, err)
        assert.True(t, ok)
    })
    t.Run("exists is false for absent", func(t *testing.T) {
        s := newStore()
        ok, _ := s.Exists("absent@x.io")
        assert.False(t, ok)
    })
}

func TestFakeStore_satisfiesContract(t *testing.T) {
    StoreContract(t, func() Store { return NewFakeStore() })
}
func TestPostgresStore_satisfiesContract(t *testing.T) {
    StoreContract(t, func() Store { return NewPostgresStore(testDB) })   // same checks, real store
}
```

**Step 3 — rewrite the cluster to assert outcomes against the fake.**

```go
func TestSignup_registersNewUser(t *testing.T) {
    store := NewFakeStore()
    svc := NewSignup(store)

    require.NoError(t, svc.Register("sam@x.io"))

    _, ok := store.Get("sam@x.io")
    assert.True(t, ok)                       // outcome: the user exists afterward
}

func TestSignup_rejectsDuplicate(t *testing.T) {
    store := NewFakeStore()
    _ = store.Insert(User{Email: "sam@x.io"})   // arrange real prior state
    svc := NewSignup(store)

    err := svc.Register("sam@x.io")

    assert.Error(t, err)
    // No "AssertNotCalled" — the meaningful fact is that no SECOND user was created.
}

func TestSignup_normalizesEmailToLowercase(t *testing.T) {
    store := NewFakeStore()
    svc := NewSignup(store)

    require.NoError(t, svc.Register("SAM@X.IO"))

    _, ok := store.Get("sam@x.io")           // stored normalized — observable outcome
    assert.True(t, ok)
}
```

**What changed, and why:**

1. **Verifying mocks → a fake.** Each original test scripted `Exists`/`Insert` return values and verified the call pattern — a transcript of `Register`'s internals. Any refactor (check duplicates differently, insert via a different method, add caching) breaks them. The fake lets all three assert on **resulting store state**, so the implementation is free.

2. **`AssertNotCalled` → real-state arrangement.** The duplicate test scripted `Exists → true` and verified `Insert` *wasn't* called. The robust version *actually inserts* a prior user, then asserts the second `Register` errors — testing the real "duplicate rejected" behavior rather than the absence of a method call. (It also no longer cares *how* the duplicate is detected.)

3. **`MatchedBy` on the insert → outcome assertion.** The lowercase test pinned the argument to `Insert`. The robust version registers a mixed-case email and asserts the user is retrievable under the *lowercase* key — the observable contract of normalization.

4. **The contract test is the key senior move.** Replacing mocks with a fake risks the fake *drifting* from the real store (the fast tests would then be lying). `StoreContract` runs the *same* behavioral checks against both `FakeStore` and the real `PostgresStore`, proving they agree. Now every signup test can use the fast fake with confidence.

**Coverage check:** the cluster still fails if a new user isn't registered, a duplicate is accepted, or the email isn't normalized — every guarantee preserved — and it no longer breaks when `Register`'s internal call pattern changes. The whole cluster de-fragilized with one fake and one contract test, exactly as `senior.md` prescribes.

</details>

---

## Summary — the refactoring playbook

De-fragilizing a test file is a disciplined process, not a loosening spree. The repeatable steps from these three exercises:

1. **Name the contract first.** For each test, write down the caller-visible behavior it's *supposed* to protect. That sentence is your target; every assertion that doesn't serve it is coupling to remove.
2. **Decouple by category:** narrow over-specified `equals` to the promised fields (assert existence, not value, for generated data); replace verifying mocks with **fakes** and assert outcomes; **parse** serialized output and assert values; assert the behavior a **log** describes, not its prose; replace **snapshots** of internal/presentation output with targeted assertions on the facts that matter.
3. **Decouple clusters at the root.** When many tests share a fragile fixture (a god mock), build one decoupling tool — a **fake plus a contract test** that proves the fake matches the real implementation — and migrate the whole cluster at once.
4. **Preserve coverage, prove it.** After each refactor, check that the test would still *fail if the behavior actually broke*. The goal is a test that survives behavior-preserving change **and** catches real regressions — and de-fragilizing often *adds* coverage (the wrong-total, wrong-status checks the interaction tests never had).

The unifying test of success: *the next harmless refactor turns fewer tests red, and you lost no real guarantee.* That's a refactor-resilient suite.

---

## Related Topics

- [`junior.md`](junior.md) — what a fragile test looks like and the three first habits.
- [`middle.md`](middle.md) — the four creep patterns and the contract-vs-implementation rule.
- [`senior.md`](senior.md) — de-fragilizing a whole suite: clusters, fakes + contract tests, mutation testing.
- [`tasks.md`](tasks.md) — smaller fix-it exercises on single fragility sources.
- [`find-bug.md`](find-bug.md) — spot the coupling in brittle snippets.
- [Over-Mocking](../06-over-mocking/optimize.md) — refactoring over-mocked tests, the dominant fragility source.
- The `mocking-strategies`, `unit-testing-patterns`, and `test-data-management` skills — fakes vs mocks, contract tests, builders.
