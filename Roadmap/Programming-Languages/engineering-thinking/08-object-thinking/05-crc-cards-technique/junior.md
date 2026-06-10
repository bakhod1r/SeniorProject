# CRC Cards — Junior

> **What?** *CRC cards* — short for **Class, Responsibility, Collaboration** — are a paper-and-pencil design technique invented by Ward Cunningham and Kent Beck in 1989. You write each candidate class on a 4×6 index card, list its responsibilities on one half, and its collaborators on the other. Then you walk through a use case as a group, picking up cards and *speaking* for each object. The cards force you to design behavior first and surface missing responsibilities before any code is written.
> **How?** Identify candidate classes, write one card each. For each scenario your system has to support, pick up the cards involved and narrate the conversation between them. Add, split, merge, or delete cards as the design reveals itself.

---

## 1. The card layout

A single CRC card is small on purpose — about the size of an index card. The constraint matters: if you can't fit the class's responsibilities on a card, the class is doing too much.

```
+-------------------------------------------+
| Class:  Order                             |
+----------------------+--------------------+
| Responsibilities     | Collaborators      |
+----------------------+--------------------+
| - know its items     | LineItem           |
| - compute total      | Money              |
| - place itself       | InventoryService   |
| - mark shipped       | (none — self)      |
+----------------------+--------------------+
```

Three columns: **class name** at the top, **responsibilities** on the left, **collaborators** on the right. That's it. No fields. No method signatures. No Java syntax. Just behaviors and who helps.

The point of leaving Java out is to delay implementation decisions until you actually understand the model. You can argue about who *owns* a responsibility without first arguing about return types.

---

## 2. The workflow, end to end

A CRC session has six small steps:

1. **List candidate classes.** Skim the requirements for nouns that feel important. Write one card per noun. Be generous — you'll throw most away.
2. **Define each card's responsibilities** in 2–6 short phrases. Use *active verbs*, not nouns. "Know own price" is good. "Price" alone is not.
3. **Identify collaborators.** For each responsibility, who does this class need to talk to? Write those on the right.
4. **Walk through a use case.** Pick a scenario ("Customer places an order"). Hold up the cards one at a time and *say what they do*. "I'm the Cart — I get told 'add product'. I ask the Product if it's in stock…"
5. **Update the cards as you go.** Missed responsibilities surface immediately. New classes appear. Some cards get crossed out.
6. **Repeat for the next scenario.** Each walk-through refines the model.

The whole thing takes 30–90 minutes for a meaningful feature. You leave with a pile of cards, not Java code — and the design is already mostly done.

---

## 3. Why physical cards (or sticky notes)

You can do CRC in a spreadsheet. You can do it in Confluence. But Cunningham and Beck insisted on **physical cards** because the medium imposes useful constraints:

- **Limited space** = limited responsibilities. If a card overflows, the class is too fat.
- **Movement** = role-play. Picking up a card and holding it forces you to *speak for it* in first person.
- **Shuffling** = exploration. Spreading cards across a table makes collaboration patterns visible.
- **Tearing up** = cheap revision. Throwing a card away is free; deleting a class file is psychologically harder.

If you're remote, use sticky notes in a virtual whiteboard tool (Miro, FigJam). Keep the constraints: small notes, no syntax, role-play out loud.

---

## 4. A worked example — vending machine

Requirements: A vending machine accepts coins, lets the user pick a product if there's enough money, dispenses the product, and returns change.

**Step 1 — candidate classes (initial):**
`VendingMachine`, `Coin`, `Product`, `Slot`, `Display`, `Customer`.

**Step 2/3 — first pass at cards (responsibilities → collaborators):**

```
Class: VendingMachine
  Responsibilities                 Collaborators
  - accept coins                   Coin
  - show price                     Display, Product
  - vend product                   Slot, Product
  - return change                  Coin

Class: Slot
  Responsibilities                 Collaborators
  - know which product it holds    Product
  - know how many are left
  - eject one

Class: Coin
  Responsibilities                 Collaborators
  - know own value                 (none)
```

**Step 4 — walk through "buy a soda":**

> *(Hold up `VendingMachine`)* I'm the machine. The customer drops in three coins. I tell each coin "what are you worth?" *(hold up Coin)* — Coin says "0.50". I add them up — total credit is 1.50.
>
> The customer presses button A2. I look up the `Slot` at A2 — *(hold up Slot)* — Slot says "I hold COLA, 4 left, price 1.25". I check credit ≥ price. Yes. I tell Slot "eject one" — Slot decrements to 3, drops a product. I have 0.25 credit left. I tell the customer "here's your soda and 25 cents change".

**Step 5 — what surfaced:**

- Where does the *price* live? Originally on `Product`, but actually it's per-`Slot` (the same product might cost differently in different machines). Move price to `Slot`. Update card.
- Who decides "is there enough credit"? In the walk-through, `VendingMachine` did it. But the rule "price covered by credit" really belongs to a new card: `Purchase`. Add a card for `Purchase` with responsibilities "validate credit covers price", "produce change".
- `Display` was a noun in the requirements but turned out passive — no behavior. Tear up the card.

After two more walk-throughs (out-of-stock, exact change unavailable), the cards stabilize. You haven't written a line of Java, but you know exactly what classes you need, what each does, and who they talk to.

---

## 5. Responsibilities vs methods

A responsibility is *coarser* than a method. "Know own price" might become one getter — or it might be implemented as part of a larger `priceFor(Customer c)` method that applies discounts. CRC keeps you at the responsibility level until you're ready to commit to a signature.

This abstraction is useful because:

- You can refactor responsibilities (move them between classes) before any code exists.
- You don't get stuck arguing about parameter types when the model isn't fixed yet.
- It's easier to ask "should an Order know its total?" than "should it have a `total()` method returning `BigDecimal`?"

When you do translate to Java, one responsibility may become 1, 2, or even 3 methods — but every method should clearly trace back to a card responsibility.

---

## 6. Heuristics for splitting a fat card

A card with 10+ responsibilities is a god class waiting to happen. Common splits:

- **By stereotype** (see [../04-responsibility-driven-design/](../04-responsibility-driven-design/)): pull `Information Holder` responsibilities off a `Coordinator`.
- **By lifecycle stage**: an `Order` might have a `Cart` (pre-checkout) and an `Order` (post-checkout) twin, splitting "knows what's being bought" from "knows what was bought".
- **By collaborator**: if half the responsibilities consult `Inventory` and half consult `Payment`, you may need two classes (e.g., `StockReservation` and `Charge`).

Make the split a new card. Watch the collaborators column on the original — if it shrinks, the split helped.

---

## 7. When CRC is overkill

For trivial classes (immutable value objects like `Money`, `Address`, `EmailAddress`) you don't need a card — the responsibility is "be a value" and that's that.

For pure plumbing (a Spring REST controller that delegates to one service method) you don't need a card — the design *is* the framework.

CRC pays off when:

- The domain has 5+ candidate classes and you're unsure who owns what.
- Two team members disagree about responsibility assignment.
- A class file is starting to feel god-like and you want to split it.
- You're onboarding someone to a domain and need a shared mental model.

For a single class in isolation, just open the editor.

---

## 8. Common newcomer mistakes

**Mistake 1: writing fields on the card.**

```
Responsibilities:
- id
- customerId
- items: List<LineItem>
```

That's a database schema, not responsibilities. Rewrite each entry as a verb phrase: "know which customer placed me", "know what items were ordered".

**Mistake 2: vague responsibilities.**

```
Responsibilities:
- handle orders
- manage state
- process events
```

"Handle", "manage", "process" are placeholder verbs. They mean nothing. Replace each with the actual behavior: "validate items are in stock", "transition from PLACED to PAID on payment receipt".

**Mistake 3: skipping the walk-through.**

You can list cards on a whiteboard and feel productive. But until you *walk through a scenario*, you don't know if the cards are right. The walk-through is the test.

**Mistake 4: turning cards into UML on day one.**

CRC is deliberately less formal than UML. The moment you start drawing arrows with cardinalities, you've stopped designing behavior and started designing storage. Stay on the cards until the model is stable.

---

## 9. Quick rules

- [ ] One card per candidate class. Use a small medium (index card or sticky note).
- [ ] Responsibilities are *verbs*, not data.
- [ ] Collaborators are *other cards*, not "the database" or "the framework".
- [ ] Walk through every important use case at least once, narrating in first person.
- [ ] Tear up cards freely — they're meant to be revised.
- [ ] Stop when the cards stabilize across two consecutive walk-throughs.

---

## 10. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Multi-scenario walk-throughs and how the cards become code       | `middle.md`        |
| Limitations of CRC; alternatives (Event Storming, etc.)          | `senior.md`        |
| Running CRC sessions across teams; remote tooling; templates     | `professional.md`  |
| Hands-on CRC card exercises                                      | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** Class, Responsibility, Collaboration on one small card. Verbs only — no fields, no syntax. Walk through scenarios in first person. The cards are done when they stop changing.
