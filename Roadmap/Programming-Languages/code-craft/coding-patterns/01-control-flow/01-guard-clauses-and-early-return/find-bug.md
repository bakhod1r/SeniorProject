# Guard Clauses & Early Return — Find the Bug

> **Category:** [Control-Flow Patterns](../README.md) — handle invalid and edge cases up front, then return, keeping the happy path un-nested.

12 buggy snippets that misuse the pattern. Spot the bug, then expand the fix and the lesson.

---

## Table of Contents

1. [Bug 1: Guard Logs But Doesn't Return](#bug-1-guard-logs-but-doesnt-return)
2. [Bug 2: Dangling else Re-Adds Nesting](#bug-2-dangling-else-re-adds-nesting)
3. [Bug 3: Guard After a Mutation](#bug-3-guard-after-a-mutation)
4. [Bug 4: Early Return Leaks a Resource](#bug-4-early-return-leaks-a-resource)
5. [Bug 5: Wrong Guard Order Dereferences Null](#bug-5-wrong-guard-order-dereferences-null)
6. [Bug 6: Early Return Holding a Lock](#bug-6-early-return-holding-a-lock)
7. [Bug 7: Silent Return Masks a Real Error](#bug-7-silent-return-masks-a-real-error)
8. [Bug 8: Guard Inverted the Wrong Way](#bug-8-guard-inverted-the-wrong-way)
9. [Bug 9: Combined Guard, Useless Message](#bug-9-combined-guard-useless-message)
10. [Bug 10: Guard With a Side Effect](#bug-10-guard-with-a-side-effect)
11. [Bug 11: Race Between Guard and Action](#bug-11-race-between-guard-and-action)
12. [Bug 12: Over-Guarding Hides a God Function](#bug-12-over-guarding-hides-a-god-function)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Guard Logs But Doesn't Return

```java
void transfer(Account account, Money amount) {
    if (account == null) {
        log.warn("null account in transfer");
        // BUG: no return / throw
    }
    ledger.debit(account.id(), amount);   // NPE
}
```

**Symptoms:** Null account logs a warning, then immediately throws `NullPointerException` on `account.id()`.

<details><summary>Find the bug</summary>

The guard detects the bad case but doesn't exit. The function falls through into the happy path with the exact input the guard was meant to reject.

</details>

### Fix

```java
if (account == null) {
    throw new IllegalArgumentException("account is required");
}
```

### Lesson

A guard that doesn't `return`/`throw`/`continue`/`break` is not a guard. Enforce "every precondition `if` exits" with a lint rule.

---

## Bug 2: Dangling else Re-Adds Nesting

```python
def label(n):
    if n < 0:
        return "neg"
    else:                      # BUG: redundant else
        if n == 0:
            return "zero"
        else:
            return "pos"
```

**Symptoms:** Works, but the nesting it was supposed to remove is still there.

<details><summary>Find the bug</summary>

Every `else` follows a returning `if`, so it's pointless. The code re-nests instead of flattening — defeating the purpose of guards.

</details>

### Fix

```python
def label(n):
    if n < 0:  return "neg"
    if n == 0: return "zero"
    return "pos"
```

### Lesson

After a returning `if`, the following code *is* the else. Drop it. (Pylint `R1705`, ESLint `no-else-return`.)

---

## Bug 3: Guard After a Mutation

```go
func (a *Account) Withdraw(amount int) error {
    a.Balance -= amount               // BUG: mutate first
    if a.Balance < 0 {
        return ErrInsufficientFunds   // balance already corrupted
    }
    return nil
}
```

**Symptoms:** A rejected withdrawal still leaves `Balance` reduced (often negative). The account is corrupted even though the call "failed."

<details><summary>Find the bug</summary>

The guard fires *after* the mutation. By the time the check rejects the operation, the side effect already happened.

</details>

### Fix

```go
func (a *Account) Withdraw(amount int) error {
    if amount > a.Balance {
        return ErrInsufficientFunds   // guard BEFORE mutating
    }
    a.Balance -= amount
    return nil
}
```

### Lesson

Validate before you mutate. A guard downstream of a side effect can't prevent that side effect.

---

## Bug 4: Early Return Leaks a Resource

```python
def read_header(path):
    f = open(path)
    line = f.readline()
    if not line:
        return None          # BUG: f never closed
    f.close()
    return line.strip()
```

**Symptoms:** Empty files leak a file descriptor every call; under load the process hits the fd limit and `open()` starts failing.

<details><summary>Find the bug</summary>

The early `return None` skips `f.close()`. Only the happy path closes the file.

</details>

### Fix

```python
def read_header(path):
    with open(path) as f:    # closed on EVERY exit, including early return
        line = f.readline()
        if not line:
            return None
        return line.strip()
```

### Lesson

Bind cleanup to scope (`with`/`defer`/try-with-resources). This is what makes early returns safe — and why single-exit is obsolete.

---

## Bug 5: Wrong Guard Order Dereferences Null

```java
String firstName(User user) {
    if (user.getName().isBlank())     // BUG: dereferences user before null check
        throw new IllegalArgumentException("blank name");
    if (user == null)
        throw new IllegalArgumentException("user required");
    return user.getName();
}
```

**Symptoms:** A null `user` throws `NullPointerException` from `getName()` instead of the intended clear error.

<details><summary>Find the bug</summary>

The value guard runs before the existence guard. It dereferences `user` to call `getName()` while `user` may still be null.

</details>

### Fix

```java
String firstName(User user) {
    if (user == null)              throw new IllegalArgumentException("user required"); // existence
    if (user.getName().isBlank())  throw new IllegalArgumentException("blank name");    // value
    return user.getName();
}
```

### Lesson

Order guards existence → shape → value. A guard may only dereference what the guards above it already proved non-null.

---

## Bug 6: Early Return Holding a Lock

```go
func (c *Cache) Get(key string) (Value, error) {
    c.mu.Lock()
    if v, ok := c.data[key]; ok {
        return v, nil          // BUG: returns while holding the lock
    }
    c.mu.Unlock()
    return c.load(key)
}
```

**Symptoms:** On a cache *hit*, the lock is never released. The next caller blocks forever; the service deadlocks.

<details><summary>Find the bug</summary>

The early return on the hit path skips `c.mu.Unlock()`. Only the miss path unlocks.

</details>

### Fix

```go
func (c *Cache) Get(key string) (Value, error) {
    c.mu.Lock()
    defer c.mu.Unlock()        // released on every return path
    if v, ok := c.data[key]; ok {
        return v, nil
    }
    return c.load(key)
}
```

### Lesson

The moment you add an early return to a function holding a resource, bind release with `defer`/`finally` — don't hand-audit every exit.

---

## Bug 7: Silent Return Masks a Real Error

```python
def process_payment(event):
    if event.amount is None:
        return                 # BUG: silently drops a malformed event
    ledger.record(event.amount)
```

**Symptoms:** When an upstream change starts sending events with `amount=None`, they vanish silently. Revenue events are dropped for days before the dip is noticed.

<details><summary>Find the bug</summary>

The guard returns a no-op for a case that should never happen. A data-integrity violation is swallowed instead of surfaced.

</details>

### Fix

```python
def process_payment(event):
    if event.amount is None:
        raise ValueError(f"payment event missing amount: {event.id}")  # fail loud
    ledger.record(event.amount)
```

### Lesson

In the core, a silently-returning guard can mask a boundary regression. Default-return is for *expected* edge cases; for invariant violations, [fail fast](../02-fail-fast/junior.md) (throw) so monitoring catches it.

---

## Bug 8: Guard Inverted the Wrong Way

```java
void publish(Post post) {
    if (post.isReady()) return;   // BUG: returns when ready
    feed.add(post);
}
```

**Symptoms:** Ready posts are never published; only unready ones reach `feed.add`.

<details><summary>Find the bug</summary>

The condition is inverted incorrectly. The guard should reject the *unready* case (`!isReady`), but it returns on the *ready* case.

</details>

### Fix

```java
void publish(Post post) {
    if (!post.isReady()) return;   // reject the BAD case
    feed.add(post);
}
```

### Lesson

A guard tests the **bad** case and leaves. Double-check the negation — an off-by-`!` guard does the exact opposite of what you want, often silently.

---

## Bug 9: Combined Guard, Useless Message

```python
def create(user, plan, payment):
    if user is None or plan is None or payment is None:
        raise ValueError("invalid input")   # BUG: which one?
    ...
```

**Symptoms:** Production logs show "invalid input" with no way to tell which of three arguments was null. Debugging takes far longer than it should.

<details><summary>Find the bug</summary>

Three distinct preconditions are collapsed into one guard with a single vague message. The failure is undiagnosable from logs.

</details>

### Fix

```python
def create(user, plan, payment):
    if user is None:    raise ValueError("user is required")
    if plan is None:    raise ValueError("plan is required")
    if payment is None: raise ValueError("payment is required")
    ...
```

### Lesson

Combine guards only when they share the *same* response and message. If each needs a specific message, keep them separate — the readability cost is tiny, the debugging payoff large.

---

## Bug 10: Guard With a Side Effect

```go
func handle(req *Request) error {
    if counter.Inc(); counter.Value() > limit {   // BUG: increments even when rejecting later
        return ErrRateLimited
    }
    if req.Body == nil {
        return ErrEmptyBody       // counter already incremented for a bad request
    }
    return process(req)
}
```

**Symptoms:** Empty-body requests still consume rate-limit budget because the counter increments inside the first guard, before the body is even validated.

<details><summary>Find the bug</summary>

The first guard performs a side effect (`counter.Inc()`) as part of its condition. Requests that later fail other guards have already mutated shared state.

</details>

### Fix

```go
func handle(req *Request) error {
    if req.Body == nil {
        return ErrEmptyBody       // cheap, side-effect-free guards first
    }
    if counter.Inc(); counter.Value() > limit {
        return ErrRateLimited     // mutate only once the request is worth counting
    }
    return process(req)
}
```

### Lesson

Keep guard *conditions* free of side effects, and order side-effecting guards after the cheap rejecting ones. A guard should test and exit, not quietly change state.

---

## Bug 11: Race Between Guard and Action

```python
def ensure_dir(path):
    if not os.path.exists(path):     # BUG: TOCTOU race
        os.makedirs(path)            # another process may create it first → crash
```

**Symptoms:** Intermittent `FileExistsError` under concurrency — the directory is created by another process between the check and the action.

<details><summary>Find the bug</summary>

The guard (`if not exists`) and the action (`makedirs`) are not atomic. Shared state can change in the gap — a classic time-of-check/time-of-use race.

</details>

### Fix

```python
def ensure_dir(path):
    os.makedirs(path, exist_ok=True)   # atomic: check-and-act in one operation
```

### Lesson

A guard that reads shared state can race the action it guards. Prefer an atomic check-and-act, or hold a lock across both. (See [Professional](professional.md) on concurrency.)

---

## Bug 12: Over-Guarding Hides a God Function

```python
def checkout(cart, user, inventory, payment, shipping, promo, tax):
    if cart is None: raise ValueError("cart")
    if not cart.items: raise ValueError("items")
    if user is None: raise ValueError("user")
    if not user.verified: raise PermissionError("unverified")
    if not inventory.reserve(cart.items): raise ValueError("stock")
    if payment.declined: raise PaymentError("declined")
    if not shipping.available(user.address): raise ValueError("shipping")
    if promo and promo.expired: raise ValueError("promo")
    if tax is None: raise ValueError("tax")
    # ... 9 guards, 7 subsystems
    return place(cart, user, payment, shipping, tax)
```

**Symptoms:** The function is impossible to test in isolation (every test needs 7 collaborators), and it grows a new guard with every feature.

<details><summary>Find the bug</summary>

The bug isn't any single guard — it's the *count*. Nine guards across seven subsystems means the function has seven responsibilities. The guards are a symptom of a god function.

</details>

### Fix

Split validation by owner and push it to each subsystem's boundary, so `checkout` receives already-valid typed inputs and orchestrates:

```python
def checkout(order: ValidatedOrder, payment: AuthorizedPayment, shipment: Shipment):
    # No validation guards — the types guarantee validity.
    return place(order, payment, shipment)
```

### Lesson

Guard count is a responsibility budget. When it blows past ~5, the fix is fewer responsibilities (split + parse-don't-validate), not a bigger guard block. See [Senior](senior.md).

---

## Practice Tips

1. **Check every guard exits** — search for `if` blocks that only log.
2. **Look for `else` after `return`** — flatten it.
3. **Trace mutation order** — does any guard fire after a side effect?
4. **Audit every early return for cleanup** — is a resource open or a lock held?
5. **Verify guard ordering** — existence before dereference.
6. **Question silent returns in core code** — should this fail loudly instead?
7. **Run `go test -race`** / a concurrency test for check-then-act guards.

---

[← Tasks](tasks.md) · [Control-Flow](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
