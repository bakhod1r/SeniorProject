# Law of Demeter — Middle

> **What?** At the middle level you stop spotting train wrecks and start refactoring them mechanically. You learn to read a method's *call graph* — which objects it actually reaches, by what path — and to redistribute responsibility so each method talks only to its immediate collaborators. You also learn where the rule legitimately bends: streams, builders, value objects, and DTOs.
> **How?** Each refactor follows the same recipe: identify the chain, name the *intent* of the last operation, push that intent up to the object that owns the first link, repeat until no method reaches past its neighbours. A simple checklist plus discipline is enough; the patterns repeat.

---

## 1. The recipe

For every train-wreck chain `a.b().c().d().op()`:

1. **Name the intent.** What was the caller *actually* asking? Not "get the c, then the d, then op" — but "have X happen". Give it a verb (e.g., `notifyOwner`, `chargeBalance`, `recordShipment`).
2. **Find the owner.** The intent belongs to the object that owns the first link — usually `a`.
3. **Push the intent up.** Add a method to `a` named after the intent. Inside, `a` does what it needs to fulfil it, possibly delegating one level deeper.
4. **Repeat one level deeper.** If `a.intent()` internally writes `b.c().d().op()`, that's the next refactor target inside `a`.
5. **Stop when each method only talks to its immediate collaborators.**

The recipe is mechanical. The judgement is in naming the intent — and that's the same skill as naming any method well.

---

## 2. Refactoring a train-wreck in a logistics service

The legacy code:

```java
public class ShipmentDispatcher {
    public void dispatch(Order order) {
        Carrier carrier = order.getShipment().getCarrier();
        Truck truck = carrier.getFleet().nearestTo(order.getDeliveryAddress());
        if (truck.getDriver().getStatus() == DriverStatus.AVAILABLE) {
            truck.getDriver().setAssignment(order.getShipment());
        } else {
            throw new NoDriverAvailableException();
        }
    }
}
```

`ShipmentDispatcher` knows: orders have shipments, shipments have carriers, carriers have fleets, fleets have trucks, trucks have drivers, drivers have statuses. That's six classes' internal structure in one method.

**Step 1 — name the intent.** "Assign a driver to this shipment, if one is available, near the delivery address." That's `assignDriver(order)` on something. The shipment owns the assignment.

**Step 2 — push to `Shipment`.**

```java
public class ShipmentDispatcher {
    public void dispatch(Order order) {
        order.shipment().assignDriver(order.deliveryAddress());
    }
}
```

The dispatcher now talks to `Order` and to `Shipment` (returned by `order.shipment()`). Two collaborators. But `Order.shipment()` is still a getter — see step 4.

**Step 3 — implement on `Shipment`.**

```java
public class Shipment {
    private final Carrier carrier;
    public void assignDriver(Address address) {
        carrier.assignTruckAndDriver(this, address);
    }
}
```

`Shipment` talks to `Carrier`. The driver-availability rule moves further down.

**Step 4 — fold further if needed.**

```java
public class Carrier {
    private final Fleet fleet;
    public void assignTruckAndDriver(Shipment shipment, Address address) {
        Truck truck = fleet.nearestTo(address);
        truck.assignTo(shipment);
    }
}

public class Truck {
    private final Driver driver;
    public void assignTo(Shipment shipment) {
        driver.assign(shipment);                // raises if not available
    }
}

public class Driver {
    public void assign(Shipment shipment) {
        if (status != DriverStatus.AVAILABLE) throw new NoDriverAvailableException();
        this.assignment = shipment;
    }
}
```

The original method's structure is now distributed across five classes. Each method only talks to its immediate field or parameter. The availability check lives with the `Driver` — the only class that owns the status.

Notice: the *total amount of code* went up. That's fine. The *coupling* went down — `ShipmentDispatcher` now depends on `Order` and `Shipment`, not on the entire fleet hierarchy. Tomorrow, replacing the `Fleet` model with a `RoutingPlan` model is one change in `Carrier`, not seven.

---

## 3. When delegation looks like over-engineering

A common middle-level objection: "I just added five forwarders. The first version was one line."

Yes — and the first version exposed every level of the model to a class that doesn't own any of them. The forwarders aren't ceremony; each one *encapsulates a decision*:

- `Order.shipment()` — whether orders have one shipment or many.
- `Shipment.assignDriver(...)` — whether assignment goes through the carrier or directly to a pool.
- `Carrier.assignTruckAndDriver(...)` — how the fleet chooses trucks.
- `Truck.assignTo(...)` — whether a truck has one driver or a crew.
- `Driver.assign(...)` — what "available" means and how to check it.

Each of these decisions can change without touching the others. The first version conflated all five into one method.

---

## 4. Returning data vs returning collaborators

A useful distinction: it's fine to return *data* from a method; it's a warning sign to return a *live collaborator* that the caller will then drive.

```java
// OK — returns a value
public Money total() { return total; }
public LocalDate placedAt() { return placedAt; }

// Suspicious — returns a collaborator
public Customer customer()        { return customer; }
public List<LineItem> lineItems() { return lineItems; }
```

A returned `Money` is a value — the caller can read it, compare it, format it, but can't change the order through it. A returned `Customer` is a collaborator — the caller might call `customer().applyDiscount()`, `customer().setStatus()`, or worse, mutate it directly. The order has now leaked a knowledge channel it didn't intend.

Solutions, in order of preference:

- **Push the operation to `Order`.** `order.applyDiscount()` instead of `order.customer().applyDiscount()`.
- **Return a *view*.** A read-only `CustomerView` record exposes only what the caller needs.
- **Make `Customer` immutable.** If the caller can't mutate it, the returned reference is safe.

The rule of thumb: returning a value (a `Money`, `LocalDate`, `OrderId`) is fine. Returning a live entity invites a chain.

---

## 5. Stream pipelines — the same-type chain exception

```java
order.lineItems().stream()
                 .filter(LineItem::isShippable)
                 .map(LineItem::weight)
                 .reduce(Weight.ZERO, Weight::plus);
```

This chain has four dots but no LoD violation. Reason: each method call returns *the same kind of collaborator* — a `Stream<T>`. You're not navigating through the internal structure of an order; you're driving a pipeline that the stream API publishes deliberately.

The compiler can't tell the difference between "chain through structure" and "chain through pipeline type", but the reader can: a `Stream` (or `Optional`, or `CompletableFuture`, or `Mono`) is a *first-class collaborator type*, not a peek through someone's fields.

The middle-skill move is to read each `.` and ask: *am I drilling into an object's internals, or am I operating on a known pipeline type?* The former is a smell, the latter is a feature.

---

## 6. Builders and fluent interfaces

```java
HttpClient client = HttpClient.newBuilder()
                              .connectTimeout(Duration.ofSeconds(5))
                              .followRedirects(NORMAL)
                              .build();
```

Same rule: each call returns the builder, not a deeper field. The chain is intentional and the type is the same (`HttpClient.Builder`). Not a LoD violation.

The middle-skill move: when you write a fluent API, design it so each method returns the same type (or a wider role type for builder evolution). Don't make `builder.connectTimeout(...).getInternalState()` accessible — that *would* be a LoD violation.

---

## 7. Records and value objects

A `record` is a value carrier. Reading its components is not a LoD violation:

```java
public record Address(String street, String city, String zip) { }

Address a = order.address();
String city = a.city();                   // fine
String firstLetter = a.city().charAt(0);  // also fine — value chain
```

The reason: an `Address` is a *value*. Two addresses with the same components are equal; the address has no internal state to leak. Reading components is part of its public meaning.

This breaks down when "records" hold *behavioural* collaborators:

```java
public record Order(Customer customer, ShippingPolicy policy) {
    // customer is a live entity, not a value
}

Order o = repository.load(id);
o.customer().applyDiscount();             // LoD violation — driving a collaborator
```

The fix: don't expose `customer` directly. Add `o.applyDiscount()` or, if a `Customer` view is needed, return a `CustomerSnapshot` value record.

The rule of thumb: records of values are exempt; records of entities aren't.

---

## 8. Refactoring a notification chain

A real-world middle-level case:

```java
public class IncidentService {
    public void escalate(Incident incident) {
        if (incident.getOwner().getTeam().getSchedule().isOnCall(incident.getOwner())) {
            incident.getOwner().getContact().getPagerDuty().notify(incident);
        } else {
            incident.getOwner().getTeam().getNextOnCall().getContact().getEmail().send(
                "ESCALATION: " + incident.getId(), incident.summary());
        }
    }
}
```

Three teams' worth of structure leaks into one method. Refactor:

```java
public class IncidentService {
    public void escalate(Incident incident) {
        incident.escalate();                     // tell, don't ask
    }
}

public class Incident {
    public void escalate() {
        owner.team().notifyOnCallAbout(this);    // delegate one level
    }
}

public class Team {
    public void notifyOnCallAbout(Incident incident) {
        Member onCall = schedule.currentOnCall();
        onCall.alertAbout(incident);             // delegate one level
    }
}

public class Member {
    public void alertAbout(Incident incident) {
        primaryContact.send(IncidentAlert.from(incident));
    }
}
```

The pager-vs-email choice now lives inside `Contact.send`, which is the right place: the contact knows whether it's a pager or email. The incident knows to escalate; the team knows who's on call; the member knows their contact preferences. Each method has one collaborator.

---

## 9. When LoD adds noise — DTOs and tests

LoD is a coupling reducer, not a universal mandate. Two contexts where strict LoD adds noise without benefit:

**DTOs at the edges of your system.** When converting a domain object to a JSON response, you *must* walk the structure to fill the response shape. Strict LoD would force every domain class to know about every wire format. The pragmatic move: a *mapper* class is allowed to know about both the domain and the wire format. It's the only place that breaks LoD, and that's the point — it's the seam.

```java
// Mapper — exempt from strict LoD
public final class OrderResponseMapper {
    public OrderResponse toWire(Order order) {
        return new OrderResponse(
            order.id().toString(),
            order.customer().name(),
            order.customer().email(),
            order.total().toString()
        );
    }
}
```

**Test assertions.** A test that asserts on internal structure is doing exactly that on purpose. `assertThat(order.lineItems()).hasSize(3)` is healthy. Forcing the test to call `order.lineItemCount()` everywhere just to satisfy LoD is busywork.

Both exceptions share a property: the code is *deliberately* coupled to internal structure for a clearly local reason. Outside those contexts, the rule applies.

---

## 10. The `Optional` chain

Java's `Optional` invites a chain of its own:

```java
order.shippingAddress()
     .map(Address::country)
     .map(Country::taxFor)
     .orElse(Money.ZERO);
```

This is not a LoD violation — every `.map()` returns the same type (`Optional<X>`). It's the stream-style exception again.

What *would* be a violation: pulling the optional apart and walking the graph:

```java
Optional<Address> addr = order.shippingAddress();
if (addr.isPresent()) {
    Country c = addr.get().country();        // back to navigating internals
    Money tax = c.taxFor(order);
    // ...
}
```

The `Optional` API was designed precisely to avoid this — keep the chain through the optional type, not through the unwrapped contents.

---

## 11. Quick rules

- Long chain through internal structure → fold the operation into the topmost object.
- Same-type chain (`Stream`, `Optional`, builder) → not a violation.
- Record of values → reading components is fine.
- Record of entities → don't expose; add methods to the holder.
- Returning data is OK; returning live collaborators is suspicious.
- Mappers at the system boundary are allowed to know structure.
- Each refactor: name the intent, push it to the owner, repeat one level deeper.
- The total line count usually goes up; the coupling goes down.

---

## 12. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Edge cases — streams, builders, value objects in depth      | `senior.md`        |
| Driving LoD across a team and code review                   | `professional.md`  |
| JLS background; package access; module boundaries           | `specification.md` |
| Spotting subtle LoD violations and runtime symptoms         | `find-bug.md`      |
| Cost of indirection: dispatch, allocation, JIT inlining     | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the refactor recipe is mechanical — name the intent, push it to the owner, fold deeper if needed. The new code is longer; the coupling is shorter. Streams, builders, and value records bend the rule by design; entities and live collaborators don't.
