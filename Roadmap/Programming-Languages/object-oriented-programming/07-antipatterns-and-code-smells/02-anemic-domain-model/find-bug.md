# Anemic Domain Model — Find the Bug

> Reference: Martin Fowler, *AnemicDomainModel* (https://martinfowler.com/bliki/AnemicDomainModel.html), 2003.

Each scenario shows real anemic code, the resulting bug, the diagnosis, and the rich-model fix. Work through them; if you cannot spot the bug before reading the diagnosis, re-read the senior file.

## 1. Public setter allows invalid state

```java
public class Order {
    private OrderStatus status;
    public void setStatus(OrderStatus s) { this.status = s; }
}

// Somewhere in the codebase:
order.setStatus(OrderStatus.SHIPPED);  // skipped PAID, skipped PACKED
```

**Bug.** An unpaid order gets shipped.

**Diagnosis.** `setStatus` doesn't know what transition is valid. The state machine lives in human memory.

**Fix.** Replace the setter with intent methods that encode the transitions:

```java
public void markPaid() {
    if (status != OrderStatus.PLACED) throw new IllegalStateException();
    status = OrderStatus.PAID;
}
public void ship() {
    if (status != OrderStatus.PAID) throw new IllegalStateException();
    status = OrderStatus.SHIPPED;
}
```

## 2. Invariant lives in a service, bypassed by a different caller

```java
@Service
class TransferService {
    public void transfer(Account from, Account to, BigDecimal amount) {
        if (from.getBalance().compareTo(amount) < 0) throw new InsufficientFundsException();
        from.setBalance(from.getBalance().subtract(amount));
        to.setBalance(to.getBalance().add(amount));
    }
}

@Service
class FeeService {
    public void chargeFee(Account a, BigDecimal fee) {
        a.setBalance(a.getBalance().subtract(fee));  // no balance check!
    }
}
```

**Bug.** `FeeService` lets the balance go negative because the check lives in `TransferService` only.

**Diagnosis.** Two services, two copies of the rule, one of them missing. Anemic `Account` cannot defend itself.

**Fix.** Put the check on the aggregate:

```java
public class Account {
    public void debit(Money amount) {
        if (balance.amount().compareTo(amount.amount()) < 0)
            throw new InsufficientFundsException(id, balance, amount);
        balance = balance.subtract(amount);
    }
}
```

Now both services call `account.debit(...)` and cannot forget the check.

## 3. Missing factory method — half-constructed entity escapes

```java
Customer c = new Customer();
c.setEmail("alice@example.com");
// forgot c.setName(...)
customerRepository.save(c);  // saved with null name, db now corrupt
```

**Bug.** Required field skipped because the no-arg constructor + setters allow it.

**Diagnosis.** Construction has no atomicity. Any sequence of setters is legal at compile time.

**Fix.** Static factory + private constructor:

```java
public static Customer register(Email email, FullName name) {
    return new Customer(CustomerId.newId(), email, name);
}
```

If `register` is the only public construction path, you cannot save half a customer.

## 4. JPA entity exposes all fields including the ID

```java
@Entity
public class Invoice {
    @Id @GeneratedValue private Long id;
    private BigDecimal total;
    public void setId(Long id) { this.id = id; }  // !
    public void setTotal(BigDecimal t) { this.total = t; }
}

@PutMapping("/invoices/{id}")
public Invoice update(@PathVariable Long id, @RequestBody Invoice body) {
    body.setId(id);
    return invoiceRepository.save(body);
}
```

**Bug.** A client can submit `{"id": 42, "total": ...}` and overwrite a different invoice — or, with `setId` exposed, hijack another tenant's row.

**Diagnosis.** The entity is also the DTO. Mass-assignment vulnerability.

**Fix.** Separate `UpdateInvoiceRequest` DTO with no `id`. Load the entity by path id, call domain methods on it:

```java
public Invoice update(Long id, UpdateInvoiceRequest req) {
    Invoice inv = repo.findById(id).orElseThrow();
    inv.adjustTotal(new Money(req.amount(), req.currency()));
    return inv;
}
```

## 5. Currency leak through getter chain

```java
order.getCustomer().getAddress().setCountry("XX");
```

**Bug.** Caller mutates an aggregate root's deeply nested state with no validation.

**Diagnosis.** Train-wreck calls (LoD violation) on top of anemic objects. Every node in the chain is a setter target.

**Fix.** Move addresses to a Value Object, expose unmodifiable view, and provide a domain operation:

```java
public record Address(String street, String city, String country) { ... }

public void relocate(Address newAddress) {
    // validation, side-effects, events
    this.address = newAddress;
}
```

## 6. Setter triggers no domain event

```java
order.setStatus(OrderStatus.CANCELLED);
// nobody emits OrderCancelledEvent — the warehouse never finds out
```

**Bug.** Cancellation isn't observed downstream because the setter has no behavior.

**Diagnosis.** Anemic models can't host domain events. Cross-cutting reactions vanish.

**Fix.** A behavior method emits the event:

```java
public void cancel(Reason reason) {
    if (status == OrderStatus.SHIPPED) throw new IllegalStateException();
    status = OrderStatus.CANCELLED;
    registerEvent(new OrderCancelledEvent(id, reason, Instant.now()));
}
```

`registerEvent` accumulates on the aggregate; the repository publishes them on flush.

## 7. Optimistic locking miss because mutation goes through SQL

```java
@Modifying
@Query("UPDATE Order o SET o.status = :s WHERE o.id = :id")
int forceStatus(@Param("id") UUID id, @Param("s") OrderStatus s);
```

**Bug.** A bulk update skips `@Version` and clobbers concurrent edits.

**Diagnosis.** When the entity is anemic, developers reach for raw SQL because there's nothing to call. The aggregate's optimistic locking is bypassed.

**Fix.** Load → mutate → save:

```java
Order o = repo.findById(id).orElseThrow();
o.cancel(reason);  // @Version is incremented on flush
```

If you genuinely need bulk, do it in the domain through a dedicated aggregate operation, not arbitrary SQL.

## 8. Validation drift between layers

```java
// Controller layer
@NotBlank @Email
private String email;

// Service layer
if (request.getEmail() == null || !request.getEmail().contains("@")) throw ...;

// Persistence layer
@Column(nullable = false, length = 255)
private String email;
```

**Bug.** Three places define what a valid email is, and they disagree. The `length = 255` constraint is enforced only at insert time; service-level check accepts `"@"` alone.

**Diagnosis.** No `Email` Value Object. Validation is scattered across DTO, service, and column annotations.

**Fix.** One VO:

```java
public record Email(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[^@]+@[^@]+\\.[^@]+$");
    public Email {
        if (value == null || value.length() > 255 || !PATTERN.matcher(value).matches())
            throw new IllegalArgumentException("Invalid email: " + value);
    }
}
```

Use `Email` in DTOs (with a `@JsonCreator`), services, and `@Embeddable` column. One source of truth.

## 9. Aggregate corrupted by collection leak

```java
public List<OrderLine> getLines() { return lines; }

// Caller:
order.getLines().clear();
order.getLines().add(badLine);
```

**Bug.** Caller wipes the order's lines without going through any business operation. Total is now stale and inconsistent with lines.

**Diagnosis.** The getter returns the live internal collection — anemic encapsulation. Even with no setter, the collection mutates.

**Fix.** Expose an unmodifiable view; provide domain operations for mutation:

```java
public List<OrderLine> lines() { return Collections.unmodifiableList(lines); }

public void addLine(OrderLine line) { ... total = total.add(line.subtotal()); }
public void removeLine(OrderLineId lineId) { ... recomputeTotal(); }
```

## 10. Equality by field, identity in the database

```java
@Entity
public class User {
    @Id @GeneratedValue private Long id;
    private String email;
    @Override public boolean equals(Object o) { ... compares id ... }
    @Override public int hashCode() { return Objects.hash(id); }
}

Set<User> users = new HashSet<>();
users.add(new User());  // id is null
users.add(new User());  // id is null
// both have id == null, equals true, set keeps only one
```

**Bug.** Transient entities collide because `id` is null until persisted. A `HashSet` of new users drops duplicates that aren't duplicates.

**Diagnosis.** Anemic entity inherits the trap: identity equality requires a persisted ID, but you can construct unpersisted instances at will. Hibernate canonical solution: use a business key or generated UUID assigned at construction.

**Fix.** Assign the ID in the factory method, before persistence:

```java
public static User register(Email email) {
    return new User(UserId.newId(), email);  // UUID v7, always non-null
}
```

Or: rely on email as a business key for equality.

## Memorize this

- **Every public setter is a potential bug site.** Walk the call sites; one of them skips the rule.
- **An invariant enforced in only one service is enforced nowhere.** Move it to the aggregate.
- **Anemic entities and DTOs as the same class create mass-assignment holes.** Keep them separate.
- **Anemic models cannot emit domain events.** Side effects vanish on mutation.
- **Getters returning live collections are setters in disguise.** Wrap with `unmodifiableList`.
- **Identity-by-ID on transient entities is a `HashSet` time bomb.** Assign IDs in factories, not in the database.
- **Three layers of validation drift apart.** One Value Object replaces all three.
