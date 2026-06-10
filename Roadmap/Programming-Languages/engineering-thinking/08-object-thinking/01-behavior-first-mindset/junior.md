# Behavior-First Mindset — Junior

> **What?** *Behavior-first thinking* designs objects around what they *do*, not what they *hold*. You start from verbs (actions, decisions, responsibilities), and let the data fall out as whatever is needed to support those actions.
> **How?** When you sit down to model a domain, write the methods first. Resist the urge to open the file by typing `private String name;` and a parade of fields. Ask: "what does this thing have to be able to do?"

---

## 1. Two mental models, two outcomes

Look at the same problem — a shopping cart — through two lenses.

**Data-first (the trap):**

```java
public class Cart {
    public List<CartItem> items;
    public BigDecimal total;
    public String currency;
    public boolean checkedOut;
}
```

You've described a *struct*. Now every other class in the system needs to know what's inside `Cart` to do anything useful with it. `CartService` reads `cart.items`, mutates `cart.total`, flips `cart.checkedOut`. The cart is a passive bag.

**Behavior-first:**

```java
public class Cart {
    public void add(Product p, int qty) { ... }
    public void remove(Product p) { ... }
    public Money total() { ... }
    public Receipt checkOut(PaymentMethod pm) { ... }
}
```

You haven't written a single field yet. You've written what the cart *does*. The fields appear later, in whatever shape supports those operations. Maybe `items` is a `Map<Product, Integer>`. Maybe `total` is computed on demand and never stored. The caller doesn't know and doesn't care.

---

## 2. The shift in your head

David West, in *Object Thinking* (2004), described OOP as a *culture of behavior*. The classes you see in real code — most of them — are the opposite: data structures with a thin sprinkle of methods. He called this **paradigm tourism**: keyword-level OO without a behavioral mindset.

The shift is small but total:

| Data-first thought                     | Behavior-first thought                           |
| -------------------------------------- | ------------------------------------------------ |
| "What attributes does an account have?" | "What can an account do, and on whose behalf?"  |
| "I need a `setBalance` method."        | "Does anyone outside the account *get* to set its balance?" |
| "Other code will read this field."     | "Other code will *tell* this object to act."     |

You don't have to memorize a methodology. You just have to ask the second column first.

---

## 3. A worked example — a fuel pump

You're building software for a self-service fuel pump.

**Data-first** starts here:

```java
public class FuelPump {
    public double pricePerLiter;
    public double litersDispensed;
    public double maxLiters;
    public boolean nozzleLifted;
    public String fuelGrade;
}
```

The procedural code around it reads every field, applies rules, writes them back. The pump is inert.

**Behavior-first** starts by asking what a pump *does* for the world:

- It begins a refuelling session when a customer lifts the nozzle.
- It dispenses fuel up to a limit (tank capacity, prepaid amount).
- It tells the cashier what was sold.
- It refuses to dispense if it has a fault.

```java
public class FuelPump {
    public Session beginSession(Customer c, Money prepaid) { ... }
    public void dispense(Liters requested)                 { ... }
    public Receipt endSession()                            { ... }
    public void reportFault(FaultCode code)                { ... }
}
```

The pump now has *agency*. Other code asks it to do things; it owns the rules.

---

## 4. "But I still need fields, right?"

Yes — but they are *consequences*, not *starting points*. After you've sketched the methods, you ask: "what does this object need to remember to support these operations?" That gives you the smallest, most justified set of fields.

For the pump above:

```java
public class FuelPump {
    private Session current;                  // because beginSession/endSession need it
    private final Money pricePerLiter;        // because dispense calculates cost
    private boolean faulted;                  // because reportFault flips state

    public Session beginSession(...) { ... }
    public void dispense(...)        { ... }
    public Receipt endSession()      { ... }
    public void reportFault(...)     { ... }
}
```

No `maxLiters`, no `nozzleLifted`, no `fuelGrade` — until a method actually needs them. You add fields the moment a behavior demands them, not before.

---

## 5. The "noun-and-verb" trap

A folk version of OO design says: "underline the nouns in the requirements — those are your classes. Underline the verbs — those are your methods."

That gives you classes like `Customer`, `Order`, `Product`, `Invoice`, and methods like `create`, `update`, `delete`, `find`. It looks like OO but it isn't. You get the **CRUD shape**: classes that are mostly data, manipulated by service classes named `OrderService`, `InvoiceService`, `CustomerService`. That's procedural code wearing OO clothing.

Behavior-first thinking asks a different question: "what *interactions* exist in the domain?" An order isn't just a *thing that has* an id, customer and items — it's a thing that *gets placed*, *gets paid for*, *gets fulfilled*, *gets refunded*. The methods name those interactions. The data shows up where it has to.

---

## 6. A test you can run on yourself

Open any class you wrote recently. Cover the field declarations. Read only the methods.

- Can you tell what the class is *for*?
- Can you imagine using it without ever touching its data directly?

If both answers are yes, the class is behavior-first. If you can't understand the class without seeing the fields, the methods are too anemic.

Try it on the `Cart` from §1. The data-first version is meaningless without the fields. The behavior-first version reads like a story about shopping.

---

## 7. Why this matters even for a "simple" class

Behavior-first changes outcomes long before your code grows complex:

**It cuts couplings.** When callers tell rather than ask, they don't reach inside. Refactoring becomes safe — change internals freely, the methods are the contract.

**It surfaces missing rules.** Writing `withdraw(Money m)` instead of `setBalance(Money)` forces you to face "what if there isn't enough money?". The validation lives somewhere obvious instead of being scattered across callers.

**It tames God-classes early.** When a class accumulates 30 fields and 4 methods, it's a sign you've been thinking data. Real objects have a few fields and many methods. A class with the inverse ratio is usually a struct in disguise.

**It changes who owns the rules.** In data-first code, business rules live in services that *operate on* objects. In behavior-first code, the object itself enforces them. Rules can't drift — there's only one place they can be.

---

## 8. Common newcomer mistakes

**Mistake 1: starting with the database schema.**

```java
public class User {
    private Long id;
    private String email;
    private String passwordHash;
    private Instant createdAt;
    private Instant lastLoginAt;
    // ... getters and setters for all of these
}
```

The schema tells you what to *store*, not what the object *does*. Behavior-first asks: "what does a `User` do?" Maybe `signIn`, `changePassword`, `forgetMe`. The fields support those.

**Mistake 2: getters as a default.**

If every field has a public getter, every caller can read state and decide for itself. The object becomes a record sheet. Add a getter only when something genuinely needs to read.

**Mistake 3: a `*Service` for every noun.**

`OrderService`, `OrderManager`, `OrderProcessor`, `OrderHandler`. The order itself does nothing; the services do everything. That's a sign you typed your fields first and then realized the class had no methods.

**Mistake 4: thinking "behavior" means "more methods".**

It doesn't. Behavior-first often produces *fewer* methods than data-first, because many small accessors get fused into one operation. `withdraw(Money)` replaces `getBalance`, `setBalance`, and the conditional in between.

---

## 9. Quick rules

- [ ] Write the methods before the fields.
- [ ] Read your class with the fields hidden — does it still make sense?
- [ ] Replace getters/setters with named operations when you can (`withdraw` over `setBalance`).
- [ ] Treat `*Service` classes as a smell, not a default.
- [ ] If a class has 20 fields and 3 methods, it's a struct. Decide if that's intentional.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Refactoring an anemic class step-by-step                    | `middle.md`        |
| When behavior-first conflicts with persistence, performance | `senior.md`        |
| Driving the mindset across a team and a codebase            | `professional.md`  |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** an object is what it *does*. Write methods before fields. If you can read a class without looking at its data and still understand it, you're thinking in objects. If you can't, you've written a struct.
