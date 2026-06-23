# Seams and Enabling Points — Junior Level

## Table of Contents

- [Why this idea matters](#why-this-idea-matters)
- [The fabric analogy](#the-fabric-analogy)
- [A precise definition](#a-precise-definition)
- [What an enabling point is](#what-an-enabling-point-is)
- [The first concrete example](#the-first-concrete-example)
- [The basic types of seam](#the-basic-types-of-seam)
- [Why seams exist: testing](#why-seams-exist-testing)
- [Seams you already use without knowing](#seams-you-already-use-without-knowing)
- [How this connects to the rest of legacy work](#how-this-connects-to-the-rest-of-legacy-work)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## Why this idea matters

When you join a real team, you will spend more time changing code that already exists than writing code from scratch. Much of that existing code has no tests. To change it safely, you first need to get it under test — and to get it under test, you usually need to *substitute* one of its parts with something fake that you control during the test.

The problem is that the part you want to substitute is buried inside the code. It calls a real database, sends a real email, reads the real system clock. You cannot test the surrounding logic without somehow replacing those parts. The concept of a **seam** is the tool that lets you do exactly this — and the word "seam" comes from Michael Feathers' book *Working Effectively with Legacy Code*, which is the source most of this topic draws on.

> **Key idea:** A seam is a place where you can change what the code *does* without editing the code at that place. Find a seam, and you have found a way to slip a fake in and test the surrounding logic.

This page teaches the idea at the level you need to *recognise* seams. The [middle](./middle.md) page shows how to create them with working code, and the [senior](./senior.md) and [professional](./professional.md) pages cover the trade-offs and the real-system practice.

---

## The fabric analogy

Think about a shirt. The shirt is made of several pieces of cloth — front, back, two sleeves, a collar — held together by **seams**, the stitched lines where two pieces meet.

If you want to replace a sleeve, you do not cut a hole in the middle of the cloth. You unpick the seam, remove the old sleeve, and stitch a new one in. The seam is the *designed-in place* where one piece can be swapped for another without damaging the rest of the garment.

Now look at a piece of code. Most code is one solid sheet of cloth: a long method that creates a database connection, runs a query, formats the result, and writes a file, all in one flow. There is no seam. To change the database part, you would have to "cut into the cloth" — edit the middle of that method, risking the formatting and file-writing logic around it.

A **code seam** is the equivalent of the stitched line: a place where one collaborator can be swapped for another *without editing the code right there*. We are not cutting the cloth. We are choosing the place where pieces join, and using that join to swap a part.

```
  Solid cloth (no seam)              Two pieces joined by a seam
  ┌───────────────────────┐         ┌──────────┐ │ ┌──────────┐
  │  one big method that   │         │ business │ │ │ database │
  │  does everything and   │         │  logic   │ │ │  access  │
  │  cannot be split apart │         │          │ │ │          │
  └───────────────────────┘         └──────────┘ │ └──────────┘
                                                  ▲
                                          the seam — swap the
                                          right piece for a fake
```

---

## A precise definition

Feathers gives two definitions that we will use exactly, because precision matters here.

> **A seam is a place where you can alter behavior in your program without editing in that place.**

Read that twice. There are two parts:

1. **Alter behavior** — you can make the program do something different.
2. **Without editing in that place** — you do *not* change the lines of code at the seam itself. You change which behavior runs from *somewhere else*.

The "somewhere else" is the second concept.

---

## What an enabling point is

> **Every seam has an enabling point, a place where you can make the decision to use one behavior or another.**

The **enabling point** is the spot where you *choose* which behavior the seam will use. The seam is the join; the enabling point is the switch that decides what goes through the join.

A real-world parallel: a power socket in your wall is a seam — you can plug in a lamp, a charger, or a kettle without rewiring the wall. The thing you plug in (your choice of device) is decided at the enabling point: the moment you pick what to plug in. The wall does not change; your choice does.

In code, the most common enabling point is a **constructor parameter** or **method argument** — the place where you pass in the collaborator the code should use. In a test you pass a fake; in production you pass the real thing. The code in between never changes.

| Concept | Question it answers | Wall-socket analogy |
|---|---|---|
| Seam | *Where* can I swap behavior without editing here? | The socket |
| Enabling point | *Where* do I decide which behavior to use? | The plug you choose |

---

## The first concrete example

Here is a small Java class with **no seam**. It is impossible to test the discount logic without sending a real email.

```java
// BEFORE — no seam. The email sending is welded in.
public class Checkout {

    public double finalise(Order order) {
        double total = order.subtotal();
        if (total > 100.0) {
            total = total * 0.9; // 10% discount over 100
        }
        // This line talks to a real mail server.
        new SmtpMailer().send(order.customerEmail(), "Receipt", "You paid " + total);
        return total;
    }
}
```

To test that the discount is applied correctly, we would be forced to send a real email every time the test runs. That is slow, unreliable, and might spam a real customer. The mailer is "welded in" — created with `new` right where it is used.

Now we introduce a seam. We let the mailer be *passed in* instead of created inside:

```java
// AFTER — an object seam. The mailer is passed in (injected).
public class Checkout {

    private final Mailer mailer; // a seam: we can swap what this is

    public Checkout(Mailer mailer) {   // <-- enabling point
        this.mailer = mailer;
    }

    public double finalise(Order order) {
        double total = order.subtotal();
        if (total > 100.0) {
            total = total * 0.9;
        }
        mailer.send(order.customerEmail(), "Receipt", "You paid " + total);
        return total;
    }
}
```

The `Mailer` is an interface (the "join"). The constructor is the **enabling point** — the place where we decide which mailer to use. In production we pass a real `SmtpMailer`; in a test we pass a fake that just records what it was asked to send.

```java
// In a test we plug in a fake at the enabling point.
class FakeMailer implements Mailer {
    String lastBody;
    public void send(String to, String subject, String body) {
        this.lastBody = body; // record instead of really sending
    }
}

@Test
void appliesTenPercentDiscountOverOneHundred() {
    FakeMailer fake = new FakeMailer();
    Checkout checkout = new Checkout(fake);          // plug in the fake
    double total = checkout.finalise(orderOf(200.0));
    assertEquals(180.0, total, 0.001);               // 10% off, no real email sent
}
```

Notice that `finalise` itself did not need to change between test and production. We altered behavior (real email vs. recorded email) *without editing in that place*. That is the seam working as intended.

---

## The basic types of seam

Feathers describes several kinds of seam. You do not need to master all of them yet — just recognise that the same idea (swap behavior without editing here) appears in different forms depending on the language and the build.

| Seam type | You swap behavior by… | Enabling point | Common in |
|---|---|---|---|
| **Object seam** | Replacing a collaborator object (interface, subclass, injection) | Where the object is created or passed in | Java, C#, TypeScript, any OO language |
| **Link seam** | Swapping a library/jar/binary at build or link time | Build script, classpath, linker config | C/C++, JVM classpath |
| **Preprocessor seam** | Conditional compilation (`#ifdef`, macros) | Compiler build flags | C/C++ |
| **Text / configuration seam** | Replacing code or values loaded at runtime (monkeypatching, config) | The config or the patch site | Python, Ruby, JavaScript |

The **object seam** is by far the most important one to learn first, because it is the one you will use almost every day in object-oriented code, and it is the safest. The others matter when the language or the legacy situation forces your hand. The [middle](./middle.md) page shows working code for each type.

> **Key idea:** When you have a choice, prefer the object seam. It is visible in the code, checked by the compiler, and local to the class you are testing. The other seam types live in build files and configuration, where they are easier to forget.

---

## Why seams exist: testing

It is worth being blunt about *why* you go to the trouble of creating a seam. The goal is almost always **testability**.

A unit test is only useful if it can:

1. **Control** the inputs and collaborators of the code under test (give it a fake database, a fake clock, a fake mailer).
2. **Sense** the outcome (check what the code did or returned).

Real collaborators get in the way of both. A real database makes inputs hard to control. A real mailer makes the outcome impossible to sense (the email leaves your machine). A seam lets you slot in a **fake** — a test double you fully control — so you can both control inputs and sense outcomes.

```
   Without a seam                With a seam
   ┌──────────┐                  ┌──────────┐
   │  logic   │──► real DB       │  logic   │──► fake DB (you control it)
   └──────────┘    (slow,        └──────────┘    (fast, predictable,
                    shared,                        sense exactly what
                    unsafe)                        the logic asked for)
```

You will meet the formal versions of "fake," "mock," and "stub" later. For now: a **test double** is any stand-in object you pass in at the enabling point so your test can run in isolation.

---

## Seams you already use without knowing

Seams are not exotic. Many things you have already seen are seams:

- **A function parameter.** Passing a comparator into a sort is an object seam — you alter how the sort behaves without editing the sort.
- **An interface field set in a constructor.** The classic dependency-injection pattern is an object seam.
- **Overriding a method in a subclass.** A subclass changes behavior of one method without editing the parent — a subclass-and-override object seam.
- **Choosing which jar is on the classpath.** Swapping a logging implementation by changing a dependency is a link seam.
- **An environment variable that switches a feature.** A configuration seam.

Recognising these as seams gives you a shared vocabulary with senior engineers. When someone says "is there a seam here?", they are asking: *can I swap this part out for a test without rewriting the method?*

---

## How this connects to the rest of legacy work

Seams are not an isolated trick. They sit at the centre of the workflow for changing untested code:

- **[What is legacy code](../01-what-is-legacy-code/)** defines legacy code as code without tests. Seams are how you start adding those tests.
- **[The legacy change algorithm](../02-the-legacy-change-algorithm/)** is the step-by-step procedure: identify change points, find a place to test (a *test point*), break dependencies, write tests, make the change. Finding seams is the heart of the "find a place to test" and "break dependencies" steps.
- **[Characterization tests](../04-characterization-tests/)** are the tests you write *through* a seam to capture what the code currently does before you change it.
- **[Dependency-breaking techniques](../05-dependency-breaking-techniques/)** is the catalogue of specific moves (Extract Interface, Parameterize Constructor, Subclass and Override Method, and more) that *create* seams in stubborn code.

So the chain is: legacy code (no tests) → find a seam → break the dependency → write a characterization test → change the code safely.

The parent **[design-principles](../../design-principles/)** section explains the underlying design ideas — dependency inversion and inversion of control — that make object seams natural. A class that depends on an interface rather than a concrete type already *has* an object seam by design. Much of legacy work is about *adding* seams to code that was written without them.

---

## Mini Glossary

| Term | Meaning |
|---|---|
| **Seam** | A place where you can alter behavior without editing in that place. |
| **Enabling point** | The place where you decide which behavior a seam uses (often a constructor parameter or method argument). |
| **Object seam** | A seam created by substituting a collaborator object via interface, injection, or subclass override. The preferred kind in OO code. |
| **Link seam** | A seam where behavior is swapped at build/link time by choosing a different library or binary. |
| **Preprocessor seam** | A seam created by conditional compilation (`#ifdef`, macros) in C/C++. |
| **Configuration / text seam** | A seam where code or values are replaced at runtime, e.g. monkeypatching or config files. |
| **Test double** | A stand-in object (fake, stub, mock, spy) passed in at the enabling point so a test can run in isolation. |
| **Testability** | The degree to which code can be placed under test; seams are a primary way to improve it. |
| **Collaborator** | An object that the code under test depends on and calls (a mailer, a repository, a clock). |
| **Characterization test** | A test that records existing behavior so you can refactor without changing it. |

---

## Review questions

1. State Feathers' definition of a seam in one sentence. Why does the phrase "without editing in that place" matter?
2. What is the difference between a *seam* and an *enabling point*? Use the wall-socket analogy to explain.
3. In the `Checkout` example, identify the seam and the enabling point. Which line lets a test plug in a fake mailer?
4. Why is creating a collaborator with `new` inside a method a problem for testing?
5. List the four basic seam types from the table. For each, name where the enabling point lives.
6. Why is the object seam usually preferred over the link or preprocessor seam?
7. A unit test needs to *control* inputs and *sense* outcomes. Explain how a seam helps with each.
8. Give two examples of seams you have probably already used without calling them seams.
9. How do seams connect to characterization tests in the legacy-change workflow?
10. The fabric analogy says we "do not cut the cloth." What does cutting the cloth correspond to in real code, and why do we want to avoid it?
