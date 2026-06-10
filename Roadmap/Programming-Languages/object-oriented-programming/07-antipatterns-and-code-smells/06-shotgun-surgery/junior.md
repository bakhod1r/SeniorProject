# Shotgun Surgery — Junior

> **What?** *Shotgun Surgery* is the code smell Martin Fowler named in *Refactoring* for the situation where **one logical change requires many small edits in many different classes**. You want to add a new currency, or rename a column, or tighten a validation rule — and you find yourself opening fifteen files, each one needing a tiny tweak. None of the edits is hard on its own, but you can never be confident you found them all.
> **How?** Treat the smell as a signal: a *single concept* (currency, status code, format string, validation rule) is *physically scattered* across the codebase. The fix is to gather the scattered pieces into one cohesive home — usually a new class or method — so the next change of the same kind happens in exactly one place.

---

## 1. The picture in one paragraph

You join a new team. Your first ticket reads "add support for the Uzbek som (UZS) as a new currency". You expect to add one enum constant. Instead, you find yourself editing: a currency enum, a formatting utility, a tax-rules class, a CSV exporter, three DTO mappers, a JavaScript client, a database migration, an internationalisation properties file, a Swagger spec, and a Confluence page. Each edit is mechanical. Half of them you find only because a test fails or because someone tells you. That feeling — "one change, fifteen places, can't tell if I'm done" — *is* Shotgun Surgery.

Fowler's *Refactoring* puts it succinctly: "every time you make a kind of change, you have to make a lot of little changes to a lot of different classes." The opposite smell, *Divergent Change*, is when one class is touched for many unrelated reasons. The two are mirror images of the same underlying disorder: responsibility is mis-located.

---

## 2. A minimal worked example

A small invoicing service supports two currencies — USD and EUR — and has grown carelessly. Adding a third currency requires touching every place a currency is mentioned.

```java
// File: Currency.java
public enum Currency { USD, EUR }

// File: MoneyFormatter.java
public final class MoneyFormatter {
    public static String format(BigDecimal amount, Currency c) {
        return switch (c) {
            case USD -> "$" + amount;
            case EUR -> amount + " EUR";
        };
    }
}

// File: TaxCalculator.java
public final class TaxCalculator {
    public BigDecimal vat(BigDecimal subtotal, Currency c) {
        return switch (c) {
            case USD -> subtotal.multiply(new BigDecimal("0.00"));
            case EUR -> subtotal.multiply(new BigDecimal("0.20"));
        };
    }
}

// File: ExchangeRateClient.java
public final class ExchangeRateClient {
    public BigDecimal toBase(Currency c) {
        return switch (c) {
            case USD -> BigDecimal.ONE;
            case EUR -> new BigDecimal("1.08");
        };
    }
}
```

Add UZS. You must edit **the enum**, **the formatter**, **the tax calculator**, **the exchange-rate client**, plus probably a CSV exporter, a translation file, and the front end. The compiler helps with the `switch` cases — but only because each switch is exhaustive over the enum. In real codebases the `switch`es are often defaulted, the formatter is in a string concatenation, the tax rule lives in a JSON config, and the only feedback you get is a 500 error in production.

Each `switch (currency)` is a *clone of the same decision*. The currency concept has been *smeared* across the codebase instead of being *contained* in one place.

---

## 3. Why this is bad

The mechanical cost of editing N files is the visible problem. The hidden problems are worse:

- **Incompleteness.** You will miss one. The CSV exporter that nobody runs except at month-end will use the default branch and produce wrong output. You will not know until accounting notices.
- **Tests are noisy.** Every new currency requires fixing N test files. If the team is busy, somebody comments out the broken assertion "for now".
- **PRs balloon.** A "one-line feature" becomes a fifteen-file diff. Reviewers stop reading carefully halfway through.
- **Onboarding is painful.** A junior asked to add a currency cannot finish without grepping the whole repo, because there is no single owner of the concept.
- **Refactoring is risky.** Even renaming `Currency.EUR` to `Currency.EURO` becomes a project, because every clone has to be updated together.

The deeper damage is *cognitive*: developers stop trusting that a concept has a single home. They start grepping defensively before every change. The codebase feels brittle.

---

## 4. Shotgun Surgery vs. Divergent Change

These are easy to confuse. They are opposites, and Fowler treats them together for that reason.

| Smell             | One change touches…    | Reason                                                      |
|-------------------|------------------------|-------------------------------------------------------------|
| Shotgun Surgery   | Many classes           | One concept spread across many places                       |
| Divergent Change  | Many parts of one class| Many concepts crammed into one class                        |

A class with Divergent Change wants to be **split** — see [`../01-god-class/`](../01-god-class/). A concept with Shotgun Surgery wants to be **gathered** — that is what this whole folder is about.

If you find yourself wishing a class would be smaller, that's Divergent Change. If you find yourself wishing a class *existed at all* so that the scattered logic could live in it, that's Shotgun Surgery.

---

## 5. The smallest realistic fix

In the currency example, the fix is to give the *concept* a class. Each currency carries its own behaviour.

```java
public interface Currency {
    String code();
    String format(BigDecimal amount);
    BigDecimal vatRate();
    BigDecimal exchangeRateToBase();
}

public final class USD implements Currency {
    public String code() { return "USD"; }
    public String format(BigDecimal a) { return "$" + a; }
    public BigDecimal vatRate() { return new BigDecimal("0.00"); }
    public BigDecimal exchangeRateToBase() { return BigDecimal.ONE; }
}

public final class EUR implements Currency {
    public String code() { return "EUR"; }
    public String format(BigDecimal a) { return a + " EUR"; }
    public BigDecimal vatRate() { return new BigDecimal("0.20"); }
    public BigDecimal exchangeRateToBase() { return new BigDecimal("1.08"); }
}
```

Now adding UZS is `public final class UZS implements Currency { ... }` — **one new file**, no `switch` to edit, no `case` to add elsewhere. The formatter, tax calculator, and exchange-rate client become one-liners that delegate:

```java
public final class MoneyFormatter {
    public static String format(BigDecimal amount, Currency c) { return c.format(amount); }
}
```

Or — more honestly — they go away entirely. The concept now owns its own behaviour.

This is the *core move* against Shotgun Surgery: **gather the scattered pieces around the concept they describe**. Fowler's name for it is *Move Method* followed by *Inline Class* — move each piece of behaviour onto the data it operates on, and dissolve the helper classes that no longer add anything.

---

## 6. Where Shotgun Surgery typically lives

Some recurring spots — keep them in mind as warning signs in your own work:

- **Enums with many `switch`es.** Every `switch (someEnum)` outside the enum itself is a clone of the same decision. Move the behaviour into the enum (Java enums can hold methods and per-constant overrides).
- **Status codes.** `if (order.status == 'X')` repeated across services. Each new status forces the same edit everywhere.
- **Format strings.** `"%d points"` repeated in a dozen places. Pluralisation rules cannot evolve.
- **Validation rules.** Same regex copy-pasted into controller, service, repository, and integration test. Changing the rule requires a treasure hunt.
- **Cross-cutting fields.** Adding `tenantId` to every entity, every DTO, every SQL statement, every cache key.
- **Mappers.** Each DTO mapper hand-codes the same translation pattern. Adding a field means editing N mappers.

If any of these patterns describe code you maintain, you have Shotgun Surgery — even if it has never been named.

---

## 7. A tiny detection trick

You don't need fancy tools yet. Just run:

```
git log --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20
```

That shows the files changed most often together with the most-touched file in your repo. If the same five files show up at the top *and* they're touched in the same commits over and over — you're looking at a Shotgun Surgery cluster. Senior-level tools (CodeScene, gitqualia, custom temporal-coupling scripts) formalise this; the smell shows up in plain `git log` first.

---

## 8. Common newcomer mistakes

**Mistake 1: confusing it with normal change.**

Every change touches more than one file sometimes. That alone is not Shotgun Surgery. The signature is *repeated patterns* — adding a third currency feels like adding the second, which felt like adding the first. If each new variant of the same kind drags in the same N files, you have the smell.

**Mistake 2: trying to fix it by adding a comment.**

```java
// IMPORTANT: when adding a new currency, also update MoneyFormatter,
// TaxCalculator, ExchangeRateClient, CsvExporter, i18n.properties.
```

A comment that lists five files you have to remember is *itself* a Shotgun Surgery report. The right answer is to remove the need for the comment by gathering the behaviour.

**Mistake 3: collapsing too aggressively.**

The opposite over-correction is to mash everything currency-related into one `Currency` god-class with thirty methods. That trades Shotgun Surgery for [`../01-god-class/`](../01-god-class/) — Divergent Change. Gather *what changes together*, not *everything that mentions the same word*.

**Mistake 4: thinking it's only about classes.**

Shotgun Surgery applies anywhere a concept is scattered: tests, configuration files, Terraform, Kubernetes manifests, OpenAPI specs. Anywhere "to add X you must edit Y, Z, W" describes a workflow, the same gathering refactor applies.

---

## 9. Quick rules

- [ ] If one ticket forces edits in more than a handful of files for the *same kind of reason*, name the smell.
- [ ] Look for repeated `switch (enum)`, repeated regex, repeated format string — each clone is a vote.
- [ ] Gather first, generalise later: move behaviour onto the data, then see what helpers dissolve.
- [ ] Treat comments that list "also edit X, Y, Z" as a confession of Shotgun Surgery.

---

## 10. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Why it emerges; Move/Inline/Extract refactor walkthroughs        | `middle.md`        |
| Git churn analysis, temporal coupling, Strategy/Visitor cures    | `senior.md`        |
| Architectural amplifiers (events, microservices), versioning     | `professional.md`  |
| Change-coupling metrics, CodeScene, mining co-changes            | `specification.md` |
| Ten numbered scattered-change scenarios with diagnosis + fix     | `find-bug.md`      |
| Build/CI/test impact of shotgun changes across services          | `optimize.md`      |
| Eight hands-on exercises with acceptance criteria                | `tasks.md`         |
| Twenty interview questions, definitions, judgement calls         | `interview.md`     |

---

**Memorize this:** Shotgun Surgery means **one logical change, many physical edits**. The cure is always the same — find the scattered concept, give it a single home, and let the helpers dissolve. If you ever write a comment that begins "also update…", you've already lost; refactor instead.
