# Change Preventers — Find the Bug

> 12 buggy snippets where Change Preventers hide a bug. Diagnose; the cure is structural.

---

## Bug 1 — Forgotten field on shotgun edit (Java)

```java
class Customer {
    private String name;
    private String email;
    private String phone;  // newly added
}

class CustomerDto {
    public String name;
    public String email;
    // forgot to add phone
}

class CustomerMapper {
    public CustomerDto toDto(Customer c) {
        CustomerDto dto = new CustomerDto();
        dto.name = c.getName();
        dto.email = c.getEmail();
        return dto;
    }
}
```

<details><summary>Diagnosis</summary>

A field added to `Customer` but missed in `CustomerDto` and `CustomerMapper`. The API silently returns no phone. Tests that don't check `phone` pass.

**Why it hid:** Shotgun Surgery — adding a field requires editing 3 files; missing one is invisible until someone reports the bug.

**Fix:** MapStruct (or any code-gen mapper). The mapper is regenerated when fields change, breaking compile if mappings can't be inferred.

```java
@Mapper
interface CustomerMapper {
    CustomerDto toDto(Customer c);  // generated to include phone automatically
}
```
</details>

---

## Bug 2 — Divergent Change introduces conflict (Java)

```java
class UserManager {
    public void updateProfile(User u, String newEmail) {
        u.setEmail(newEmail);
        userRepo.save(u);
    }
    
    public void changeSubscription(User u, Plan plan) {
        u.setSubscriptionPlan(plan);
        u.setSubscriptionRenewalDate(LocalDate.now().plusMonths(1));
        userRepo.save(u);
    }
    
    // ... many more methods
}
```

Two engineers commit on the same day:
- Engineer A modifies `updateProfile` to send a confirmation email.
- Engineer B modifies `changeSubscription` to also update the analytics database.

Both PRs touch `UserManager.java`. Both get merged. Either:

(a) merge conflict (visible) — they resolve it together;

(b) auto-merge silently combines, but Engineer B's changes inadvertently affect imports/structure that break Engineer A's email logic.

<details><summary>Diagnosis</summary>

Divergent Change: one class is touched by everyone for everything. Cure: split UserManager into focused services. With per-service files, the two engineers wouldn't conflict.

This isn't a bug in any single line — it's a *process* bug induced by structural smell.
</details>

---

## Bug 3 — Mapper drift (Python)

```python
@dataclass
class User:
    id: str
    name: str
    email: str
    is_admin: bool
    salary: int  # added 2 weeks ago

# Hand-rolled DTO converter — never updated
def user_to_dto(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "is_admin": user.is_admin,
        # salary missing!
    }
```

Caller:

```python
dto = user_to_dto(user)
print(dto["salary"])  # KeyError
```

<details><summary>Diagnosis</summary>

Hand-rolled mapper drift. Engineer added `salary` to `User`; nobody remembered to update `user_to_dto`. Python doesn't catch this at compile.

**Fix:** use Pydantic or `dataclasses.asdict`:

```python
from dataclasses import asdict
dto = asdict(user)  # automatically includes all fields
```

Or Pydantic with explicit projection (when you want to *exclude* fields):

```python
class UserOut(BaseModel):
    id: str
    name: str
    email: str
    is_admin: bool
    # explicitly omit salary
    
    model_config = ConfigDict(extra='forbid')
```
</details>

---

## Bug 4 — Parallel hierarchy missing sibling (Java)

```java
abstract class PaymentMethod { ... }
class CreditCard extends PaymentMethod { ... }
class Paypal extends PaymentMethod { ... }
class BankTransfer extends PaymentMethod { ... }

abstract class PaymentValidator {
    public abstract boolean validate(PaymentMethod m);
}
class CreditCardValidator extends PaymentValidator { ... }
class PaypalValidator extends PaymentValidator { ... }
// no BankTransferValidator

class PaymentService {
    public boolean validate(PaymentMethod m) {
        if (m instanceof CreditCard) return new CreditCardValidator().validate(m);
        if (m instanceof Paypal) return new PaypalValidator().validate(m);
        if (m instanceof BankTransfer) return true;  // ?!
        return false;
    }
}
```

<details><summary>Diagnosis</summary>

`BankTransferValidator` was forgotten. The author punted with `return true` — bank transfers skip validation entirely. Real money flows through unverified. (Or worse: silently fails — `return false` blocks legitimate transfers.)

**Why it hid:** Parallel Inheritance Hierarchies. Adding a payment kind requires adding a validator; nobody enforces this.

**Fix:** put validation on `PaymentMethod`.

```java
abstract class PaymentMethod {
    public abstract boolean validate();
}
class BankTransfer extends PaymentMethod {
    public boolean validate() {
        // compiler enforces — can't compile without implementing
    }
}
```

Now the parallel hierarchy is gone. Adding a payment method without validation is a compile error.
</details>

---

## Bug 5 — Cross-cutting concern not applied (Python)

```python
@trace
def fetch_user(id): ...

@trace
def fetch_order(id): ...

# 50 more functions, all decorated

def fetch_payment(id):  # forgot @trace
    return db.query("SELECT * FROM payments WHERE id=?", id)
```

When debugging a slow request, the trace shows fetch_user and fetch_order timings but nothing for fetch_payment — making it look like fetch_payment is fast or absent.

<details><summary>Diagnosis</summary>

Cross-cutting concern (tracing) applied per-function. One missed → invisible call. This is Shotgun Surgery for tracing.

**Fix:** apply at coarser granularity — module-level autoinstrumentation, or middleware that wraps the entire request:

```python
class TracingMiddleware:
    def __call__(self, request, call_next):
        with tracer.start_span(request.url.path):
            return call_next(request)
```

Now every request is traced as a whole; sub-spans for specific operations are added on demand. No per-function decoration needed.
</details>

---

## Bug 6 — Divergent Change merge bug (Go)

```go
package user

type Service struct {
    db *sql.DB
}

// Engineer A's commit:
func (s *Service) UpdateEmail(id int, email string) error {
    _, err := s.db.Exec("UPDATE users SET email = ? WHERE id = ?", email, id)
    return err
}

// Engineer B's commit (lands later, both touched same package):
func (s *Service) UpdatePassword(id int, hash string) error {
    _, err := s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hash, id)
    audit.Log(id, "password_changed")  // new dependency
    return err
}
```

Both compile in isolation. Both merge cleanly. But the test file:

```go
package user_test

func TestUpdateEmail(t *testing.T) {
    s := user.NewService(testDB)  // doesn't initialize audit
    s.UpdateEmail(1, "new@example.com")
    // ...
}
```

A's test was fine. B's PR added audit dependency. After merge, A's test crashes (`audit` is nil) — even though A didn't change anything.

<details><summary>Diagnosis</summary>

Divergent Change at the package level. Two engineers' independent changes interact via shared dependencies. The fact that they touched the *same package* is the smell — they should have been working in different files / packages.

**Fix:** split `user.Service` into `user.IdentityService` (UpdateEmail) and `user.AuthService` (UpdatePassword). Each service has its own constructor and dependencies. Tests can construct one without needing the other.
</details>

---

## Bug 7 — Schema drift across services (Multi-language)

```protobuf
// shared.proto (the canonical schema)
message Order {
    string id = 1;
    repeated string item_ids = 2;
    int64 total_cents = 3;
    string status = 4;  // newly added
}
```

```java
// Service A (compiled with v1 of proto)
Order order = Order.newBuilder().setId(...).setTotalCents(100).build();
// status not set — defaults to ""
sender.send(order);
```

```python
# Service B (compiled with v2 of proto, expects status)
def handle(order):
    if order.status == "PAID":
        process_payment(order)
    # status == "" -> no payment processing
```

<details><summary>Diagnosis</summary>

Service A wasn't redeployed after the proto changed. Its messages have empty `status`. Service B silently skips them.

This is Shotgun Surgery at the architectural level — schema changes require coordinated redeployment.

**Fix:**
1. Schema-versioning policy: only additive changes (new optional fields); no required-field additions.
2. Service B handles "missing status" gracefully (treat as legacy).
3. Build pipeline ensures shared `.proto` versions are bumped together.

For breaking changes, use a separate message type and migrate consumers explicitly.
</details>

---

## Bug 8 — Forgotten validator in parallel hierarchy (Python)

```python
class Notification(ABC):
    @abstractmethod
    def send(self): ...

class EmailNotification(Notification): ...
class SmsNotification(Notification): ...
class PushNotification(Notification): ...

# Parallel hierarchy of validators (Pydantic-like)
class EmailValidator: ...
class SmsValidator: ...
# No PushValidator — was added with PushNotification but validator forgotten

# Caller:
def validate_and_send(notification):
    validators = {
        "email": EmailValidator,
        "sms": SmsValidator,
        # forgot push
    }
    validator_class = validators.get(notification.channel)
    if validator_class:
        validator_class().validate(notification)
    notification.send()
```

<details><summary>Diagnosis</summary>

`PushNotification` is sent without validation — `validators.get("push")` returns None, the conditional skips. The comment "forgot push" is the root cause.

**Fix:** put validation on the notification itself.

```python
class Notification(ABC):
    @abstractmethod
    def validate(self): ...
    
    @abstractmethod
    def send(self): ...

class PushNotification(Notification):
    def validate(self):
        # compiler / abstract method enforces — can't instantiate without
        ...
    def send(self): ...
```

Adding a notification kind without validation is a runtime error at instantiation.
</details>

---

## Bug 9 — Divergent Change in test fixtures (Java)

```java
class TestFixtures {
    public static User testUser() {
        User u = new User();
        u.setName("Test");
        u.setEmail("test@example.com");
        return u;
    }
    
    public static Order testOrder() {
        Order o = new Order();
        o.setId("order-1");
        o.setUser(testUser());
        return o;
    }
    
    public static Payment testPayment() {
        Payment p = new Payment();
        p.setUser(testUser());
        return p;
    }
    
    // ... 30 more `testXxx` methods touching multiple aggregates
}
```

Engineer A modifies `testUser` to add a required field. Engineer B's tests using `testOrder` (which calls `testUser`) start failing with no obvious reason.

<details><summary>Diagnosis</summary>

`TestFixtures` is a god class for test data. Modifying one fixture cascades. Divergent Change at test-data level.

**Fix:** focused builders per concept.

```java
public class UserBuilder {
    public static UserBuilder aUser() { return new UserBuilder(); }
    public UserBuilder withName(String n) { ... return this; }
    public UserBuilder withEmail(String e) { ... return this; }
    public User build() { ... }
}

public class OrderBuilder { ... }
```

Each builder is scoped to one type. Changes to user fixture don't break unrelated tests.
</details>

---

## Bug 10 — Refused Bequest in inheritance (Java)

```java
abstract class Animal {
    public abstract void feed();
    public abstract void exercise();
}

class Dog extends Animal {
    public void feed() { ... }
    public void exercise() { ... }
}

class Goldfish extends Animal {
    public void feed() { ... }
    public void exercise() {
        throw new UnsupportedOperationException("Goldfish don't exercise");
    }
}

// Caller:
List<Animal> pets = ...;
for (Animal a : pets) {
    a.feed();
    a.exercise();  // crashes on goldfish
}
```

<details><summary>Diagnosis</summary>

Refused Bequest masquerading as Parallel Inheritance — but the smell is also a Change Preventer (adding new pet types requires deciding "do they exercise?" implicitly).

**Fix:** Capability-based design.

```java
interface Feedable { void feed(); }
interface Exerciseable { void exercise(); }

class Dog implements Feedable, Exerciseable { ... }
class Goldfish implements Feedable { ... }  // doesn't claim Exerciseable

// Caller:
for (Feedable a : pets) a.feed();
for (Exerciseable a : pets) {
    if (a instanceof Exerciseable e) e.exercise();
}

// Better — split lists:
List<Feedable> needFeeding = ...;
List<Exerciseable> needExercise = ...;
```
</details>

---

## Bug 11 — Migration script touches god class (Python)

```python
# migration_2024_03_add_country.py
def migrate(db):
    # Add country to users
    db.execute("ALTER TABLE users ADD COLUMN country VARCHAR(2) DEFAULT 'US'")
    
    # Update User model dataclass... wait, that's in the application code
    # Update User Pydantic schema... also application code
    # Update GraphQL schema... also application
    # ... migration script tries to coordinate all of these
```

<details><summary>Diagnosis</summary>

The migration script can't realistically modify application code. The "right" approach is a coordinated PR that includes:

1. Migration SQL.
2. Updated `User` model.
3. Updated DTO.
4. Updated GraphQL schema.
5. Updated test fixtures.

This PR has Shotgun Surgery built-in — 5+ files touched together. Reviewers struggle to verify completeness.

**Fix:** combine code generation (one source of truth → all derived types) + a database migration that's the single new addition. The PR shrinks to 2 files (the proto/Pydantic schema + the SQL migration).

Some teams achieve this with **schema migrations driving everything** — the schema migration tool generates the model code. Others use schema-first design with code generation.
</details>

---

## Bug 12 — Distributed monolith deployment ordering (Multi-service)

A feature requires:

- Service A version 2.5 (publishes new event format)
- Service B version 3.1 (consumes new event format)

If A is deployed first, B is still on the old format → events fail to deserialize. If B is deployed first, A still publishes old format → B blocked waiting for events.

<details><summary>Diagnosis</summary>

Distributed monolith — the architectural Shotgun Surgery. Two services must deploy in coordinated order.

**Fix patterns:**

1. **Backwards/forwards compatibility in the schema.** A's v2.5 publishes both old and new formats; B's v3.1 reads both. Once both are deployed, drop the old format in a follow-up release.

2. **Feature flags.** Both services know the new feature; deployments happen freely; the feature is enabled via flag once both are deployed.

3. **Single repo with single artifact** if the services genuinely cannot be decoupled — recognize that "two services" is fiction; the deployment unit is one.

The architectural smell can't be cured by a single-PR refactor. It requires either schema discipline (compatibility) or honest service boundaries.
</details>

---

> **Next:** [optimize.md](optimize.md) — inefficient Change Preventer cures.
