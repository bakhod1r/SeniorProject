# Event-Driven Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Event-Driven Programming
> *In most code, you call the functions. In event-driven code, you write the functions and something else decides when to call them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Handler and the Loop](#core-concept-1--the-handler-and-the-loop)
5. [Core Concept 2 — Events vs Polling](#core-concept-2--events-vs-polling)
6. [Core Concept 3 — Inversion of Control](#core-concept-3--inversion-of-control)
7. [Core Concept 4 — Callbacks](#core-concept-4--callbacks)
8. [Core Concept 5 — The Browser Event Loop (Basics)](#core-concept-5--the-browser-event-loop-basics)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Picture the first program you ever wrote. It probably ran top to bottom: read input, do something, print output, exit. The *program* was in charge of the order. It decided what happened next, line by line, until it ran out of lines.

Now picture a button in an app. The button doesn't run top to bottom and exit. It sits there. Nothing happens — until someone *clicks* it, maybe in two seconds, maybe never. You can't write that as a straight script, because you have no idea *when* the click will come, and while you wait you also need to react to other buttons, keystrokes, and the network. A top-down script has no good way to say "wait for any of a hundred things, and do the right thing for whichever happens first."

**Event-driven programming** is the answer. Instead of writing the steps in order, you write a **handler** for each kind of thing that can happen — a click handler, a keypress handler, a "data arrived" handler — and then you hand control to an **event loop**. The loop waits. When something happens, it packages that something as an **event** and calls the matching handler. Your code is a collection of "when X happens, do Y" rules; the loop is the thing that watches for X and fires Y.

> **The mindset shift:** stop thinking "my program runs and *I* decide what happens next." Start thinking "my program *registers reactions* and waits — the loop decides what happens next, and calls me when it's my turn."

One important boundary up front. There are **two** things people call "event-driven," at two very different scales:

- **Event-driven *programming*** (this topic): inside one program — an event loop, handlers, callbacks reacting to clicks, timers, and I/O.
- **Event-driven *architecture*** (a system-design topic): between many programs — services publishing and consuming events over a message bus.

They share the word "event" and the same instinct ("react, don't poll"), but one is a *programming paradigm* and the other is a *distributed-systems design*. This page is about the first. We'll point at the second so you don't confuse them — see [Event-Driven Architecture](../../../Architecture/system-design/) later.

---

## Prerequisites

- **Required:** You can read and write functions in at least one language. Examples use **JavaScript** (browser + Node), with a little **Python**.
- **Required:** You've called a function and passed it an argument. We're going to pass *functions as arguments*, which is the one new idea you need.
- **Helpful:** You've clicked a button on a web page and wondered "where does the code for that live?" — that's exactly the question this page answers.
- **Not required:** Threads, async/await, or any concurrency theory. We build the intuition from clicks and timers first.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Event** | A thing that happened that your program might want to react to — a click, a keypress, a timer firing, data arriving from the network. |
| **Handler** (event handler, listener, callback) | A function you write that should run *when* a particular event happens. |
| **Register / subscribe** | The act of telling the system "when event X happens, call this handler." |
| **Event loop** | The runtime machinery that waits for events and calls the matching handlers — over and over, for the life of the program. |
| **Event queue** | The line of events waiting to be handled, processed one at a time. |
| **Dispatch** | The loop picking an event off the queue and calling the right handler for it. |
| **Callback** | A function passed to other code to be called *later* — the general name for the function you hand over. |
| **Inversion of control (IoC)** | The pattern where the framework calls your code, instead of your code calling the framework. "Don't call us, we'll call you." |
| **Polling** | Repeatedly *asking* "has it happened yet?" in a loop — the opposite approach to events. |

> The two words to lock in now are **handler** (the function you write) and **event loop** (the thing that calls it). Everything else is detail around those two.

---

## Core Concept 1 — The Handler and the Loop

Event-driven code has two halves, and they're written by two different people (often you and a library author).

1. **You write handlers** — small functions that say what to do *when* something happens.
2. **The loop runs them** — a piece of machinery (in the browser, in Node, in a GUI framework) that waits for events and calls your handlers.

Here's the most basic possible example — a button on a web page:

```javascript
// You REGISTER a handler. You do NOT call it yourself.
const button = document.querySelector("#save");
button.addEventListener("click", function () {
  console.log("Saved!");
});
// ...and your code moves on. The function above has NOT run yet.
```

Read that carefully. You defined a function and handed it to `addEventListener`. You **never called it**. It will run *later*, if and when the user clicks `#save` — maybe many times, maybe never. The handler is a reaction you've armed, not a step you've executed.

The loop that eventually calls it is conceptually this simple:

```text
forever:
    wait until an event is available        ← the program is idle here, using no CPU
    take the next event off the queue
    find the handler(s) registered for it
    call them
```

That loop is already running for you — the browser starts it before your script even loads. Your job is just to *populate it with reactions*. When you write `addEventListener("click", fn)`, you're adding a row to an invisible table the loop consults: "click on #save → run fn."

A GUI framework looks the same in spirit. Here's a desktop button in Python's Tkinter:

```python
import tkinter as tk

def on_click():
    print("Saved!")

root = tk.Tk()
button = tk.Button(root, text="Save", command=on_click)  # register the handler
button.pack()
root.mainloop()   # <-- hand control to the event loop; it runs until the window closes
```

`root.mainloop()` is the event loop, made visible. The line *blocks* — execution stops there and stays there, with the loop spinning, dispatching clicks to `on_click`, until you close the window. Notice you pass `on_click` (no parentheses) — you're handing over the *function itself*, not calling it.

---

## Core Concept 2 — Events vs Polling

Why bother with all this? Because the obvious alternative is wasteful and clumsy. The obvious alternative is **polling**: ask, in a loop, "did it happen yet?"

```python
# POLLING — the bad way. Burns CPU asking the same question forever.
while True:
    if button_is_pressed():
        handle_press()
    # spins as fast as it can, doing nothing useful 99.99% of the time
```

This is a child in the back seat asking "are we there yet? are we there yet?" thousands of times a second. It wastes the entire CPU core spinning, and it can only watch *one* thing well at a time. Watching ten different inputs this way turns into a tangle of `if` checks you have to keep re-running.

The **event-driven** way flips it. You don't ask; you *subscribe* and then *wait*:

```python
# EVENT-DRIVEN — register a reaction, then sleep until something happens.
button.on_press(handle_press)   # "wake me and run this when pressed"
event_loop.run()                # idle (CPU ~0%) until a real event arrives
```

The crucial win: while waiting, the program does **nothing** — it isn't running at all, it's parked by the operating system. The OS wakes it only when a real event arrives. One idle loop can watch a click, a keypress, a network packet, and a timer *all at once*, and spend zero CPU until one of them actually fires.

| | Polling | Event-driven |
|---|---|---|
| How it learns of an event | Keeps asking "yet?" | Gets told "now" |
| CPU while idle | Burns a core spinning | ~0%, parked by the OS |
| Watching many sources | Awkward loop of `if`s | Natural — many handlers, one loop |
| Latency | Limited by how often you ask | As soon as the event arrives |

> **Key insight:** events turn "*keep checking*" into "*notify me*." That single inversion is what makes one program able to wait responsively on hundreds of things without melting a CPU.

---

## Core Concept 3 — Inversion of Control

Look again at the difference between normal code and event-driven code.

In normal, top-down code, **you** are in control. You call `parse()`, then `validate()`, then `save()`. *Your* code is the boss; libraries are tools you reach for, in the order you choose.

```javascript
// Normal control: YOU call the functions, in YOUR order.
const data = parse(input);
const ok = validate(data);
if (ok) save(data);
```

In event-driven code, control is **inverted**. You don't run the show; the loop does. You give the loop a bag of functions and say "call the right one when the time comes." The framework is the boss; *your* functions are the tools *it* reaches for.

```javascript
// Inverted control: you HAND OVER functions; the loop calls them, when IT decides.
input.addEventListener("change", onChange);
form.addEventListener("submit", onSubmit);
// the loop now owns the timeline; your code just waits to be called
```

This pattern has a famous nickname — the **Hollywood Principle**: *"Don't call us, we'll call you."* An aspiring actor doesn't phone the studio every hour; they register their details and the studio calls *them* if there's a part. Your handlers are the actor; the event loop is the studio.

This is the single most important idea in event-driven programming, and the one that trips up newcomers. Your program stops being a *story you narrate top to bottom* and becomes a *set of reactions someone else triggers*. The order your handlers run in is decided by the world (what the user does, when data arrives), not by the order you wrote them in the file. Getting comfortable with "I don't control when my code runs" is the mental leap this whole topic is about.

---

## Core Concept 4 — Callbacks

We keep "handing functions over." The general name for a function you pass to other code, to be called *later*, is a **callback**. An event handler is just a callback that runs when an event fires. But callbacks show up in many places beyond events — anywhere code needs to call *you* back when it's done or ready.

```javascript
// A timer: "after 1000ms, call this function." The function is a callback.
setTimeout(function () {
  console.log("one second later");
}, 1000);

// Reading a file in Node: "when the read finishes, call this back with the result."
const fs = require("fs");
fs.readFile("notes.txt", "utf8", function (err, contents) {
  if (err) {
    console.error("read failed:", err);
    return;
  }
  console.log(contents);
});
console.log("this prints FIRST"); // the readFile callback runs LATER
```

That last line matters. `console.log("this prints FIRST")` runs *before* the file contents print, even though it's written *after* `readFile`. Why? Because `readFile` doesn't sit and wait for the disk — it **registers a callback** and returns immediately, letting your program keep going. When the disk finishes (much later in computer-time), the loop calls your callback. This is **non-blocking**: instead of freezing while the disk works, the program stays free to do other things, and gets called back on completion.

Three things to notice, because they'll recur for the rest of your career:

- **Callbacks run later, not now.** The code *after* a callback registration usually runs *before* the callback's body.
- **Order in the file ≠ order of execution.** This is the most common source of "but I put it first, why did it run second?" confusion.
- **Error-first is a convention.** In old Node code, callbacks take `(err, result)` — check `err` first, *then* use `result`. It's a pattern, not a language rule, but it's everywhere.

---

## Core Concept 5 — The Browser Event Loop (Basics)

The browser is the easiest place to *see* an event loop, because it's always running one for you. You can build a working mental model with three pieces.

1. **The call stack** — where the currently-running function lives. JavaScript runs **one thing at a time**: there's a single stack, and only one function executes at any instant.
2. **The event queue** — a line of "things to do later": click events, timer callbacks, network responses.
3. **The event loop** — a referee that says: *"Is the stack empty? Then take the next item off the queue and run it."*

The rule that ties them together is **run-to-completion**: once a handler starts, it runs *all the way to the end* before the loop will pick up anything else. The loop never interrupts a running handler to start another. It waits for the stack to empty, *then* dispatches the next event.

```javascript
console.log("1");                       // runs now
setTimeout(() => console.log("3"), 0);  // queued — runs after the stack clears
console.log("2");                       // runs now
// Output: 1, 2, 3
```

Even with a `0`ms timer, `3` prints **last**. The `setTimeout` callback can't jump the line — it must wait until the current code (`console.log("1")`, `console.log("2")`) finishes and the stack is empty. *Then* the loop dispatches it. "`0`ms" means "as soon as possible, but still after everything already running," not "right now."

This single-threaded, run-to-completion model has a famous consequence: **one slow handler freezes everything.** If a click handler runs a 5-second loop, the loop can't dispatch *anything* — no other clicks, no scrolling, no rendering — until that handler returns. The page goes unresponsive. (Middle and senior levels dig into this; for now, just file away: *don't do slow work inside a handler.*) See [`middle.md`](middle.md) for the full loop model.

---

## Real-World Examples

| Thing you've used | The events / handlers behind it |
|---|---|
| A button you click in any app | `onClick` handler dispatched by a GUI/browser event loop |
| A web page reacting to typing | `keydown` / `input` handlers on a text field |
| A chat app showing a new message instantly | a "message received" handler firing on a websocket event |
| A game responding to your keyboard | the game loop dispatching key events to handlers |
| A Node.js web server | each incoming request is an event; your route handler is the callback |
| A file download progress bar | `progress` events firing repeatedly with bytes-so-far |
| A spreadsheet recalculating when you edit a cell | a "cell changed" event triggering dependent recalculation |

You've been *using* event-driven systems every day without naming them. Every responsive interface you've ever touched is some event loop dispatching to some handlers.

---

## Mental Models

- **The restaurant buzzer.** You order, get a buzzer, and sit down — you don't stand at the counter asking "ready yet?" (polling). When your food is up, the buzzer goes off (the event) and you go collect it (the handler runs). The buzzer lets you *wait without watching*.
- **Don't call us, we'll call you.** You (a handler) leave your number with the casting office (the event loop). You don't phone them; they phone you when there's a part. Control is theirs, not yours.
- **The receptionist with one desk.** A single receptionist (the single-threaded loop) handles every visitor, but only one at a time, fully, before greeting the next (run-to-completion). If one visitor monopolizes the desk for an hour (a slow handler), everyone else waits in line — no matter how trivial their request.
- **The to-do queue.** Events pile into a queue like sticky notes on a desk. The loop works them one at a time, top of the pile first, never two at once.

---

## Common Mistakes

- **Calling the handler instead of registering it.** `button.addEventListener("click", onClick())` *calls* `onClick` immediately and registers its *return value*. You want `onClick` — the function itself, no parentheses. This is the #1 beginner bug.
- **Expecting code to run in file order.** Code after a callback often runs *before* the callback. The file is the order you *wrote* things, not the order they *happen*.
- **Doing slow work inside a handler.** A long loop or a synchronous blocking call inside one handler freezes the *entire* loop — every other event waits. The page or app "hangs."
- **Confusing the two scales.** "Event-driven" inside one program (this topic) is *not* the same as "event-driven architecture" between services. Same word, different scale. Don't bring message-bus thinking to a button click, or vice versa.
- **Forgetting to unregister handlers.** Handlers you add but never remove keep firing (and keep their captured data alive). In long-lived apps this leaks memory and causes "why did this run twice?" bugs.
- **Assuming events arrive instantly or in a guaranteed order.** They arrive *when they arrive*; two independent async operations can finish in either order.

---

## Test Yourself

1. In your own words: what are the *two halves* of an event-driven program, and who writes each?
2. Why does `setTimeout(fn, 0)` still run `fn` *after* the code that follows it?
3. What's the difference between **polling** and **event-driven**, and why is the second usually better for waiting on many things?
4. Explain "inversion of control" using the casting-office metaphor.
5. Why does `addEventListener("click", onClick())` (with parentheses) not work as intended?
6. What does **run-to-completion** mean, and what's its famous downside?

> Try each before reading on. If #2 or #6 is fuzzy, re-read [The Browser Event Loop](#core-concept-5--the-browser-event-loop-basics).

---

## Cheat Sheet

```text
EVENT-DRIVEN = write reactions, hand control to a loop, get called back.

THE TWO HALVES:
  YOU write   → handlers ("when X happens, do Y")
  LOOP runs   → waits for events, calls the matching handler

THE LOOP (forever):
  wait for an event  →  take next from queue  →  call its handler  →  repeat
  (idle = ~0% CPU; the OS wakes you only when something happens)

KEY IDEAS:
  events vs polling   → "notify me" beats "keep asking"
  inversion of control→ "don't call us, we'll call you" (Hollywood Principle)
  callback            → a function passed to be called LATER
  non-blocking        → register a callback, return now, get called on completion
  run-to-completion   → a handler finishes fully before the next one starts
  single-threaded     → one thing at a time; a slow handler freezes everything

WATCH OUT:
  register the function, don't call it:  on("click", fn)  NOT  on("click", fn())
  file order ≠ run order
  no slow/blocking work inside a handler

TWO SCALES (don't confuse):
  event-driven PROGRAMMING = loop + handlers inside ONE program (this topic)
  event-driven ARCHITECTURE = events between SERVICES (system design)
```

---

## Summary

Event-driven programming flips who's in charge of *when* code runs. Instead of a top-down script where your code calls the shots, you **register handlers** — functions that say "when X happens, do Y" — and hand control to an **event loop** that waits for events and **calls your handlers** for you. This is **inversion of control**: "don't call us, we'll call you." It beats **polling** (endlessly asking "yet?") because a parked program uses no CPU and one loop can watch many sources at once. The functions you hand over are **callbacks**, and they run *later* — so file order is not run order. The browser and Node run on a **single-threaded, run-to-completion** loop: one thing at a time, each handler finishing fully before the next starts, which is why a slow handler freezes everything. Keep clear the boundary between event-driven *programming* (one program's loop and handlers — this topic) and event-driven *architecture* (events between services — a system-design topic).

---

## Further Reading

- Philip Roberts, *"What the heck is the event loop anyway?"* (JSConf EU talk) — the single best visual explanation of the browser loop, stack, and queue.
- MDN Web Docs, *Introduction to events* — the canonical, beginner-friendly reference for browser events and `addEventListener`.
- Node.js docs, *The Node.js Event Loop, Timers, and `process.nextTick()`* — the official walkthrough, useful even at a basic level.
- Martin Fowler, *Event-Driven* (bliki) — a short essay untangling the *many* things people mean by "event-driven," useful for the programming-vs-architecture distinction.

---

## Related Topics

- [`middle.md`](middle.md) — the event loop in depth, Node's loop phases, `EventEmitter`, callbacks → promises → async/await, DOM bubbling.
- [`senior.md`](senior.md) — the trade-offs: callback hell, inverted control flow, the one-slow-handler problem, async error handling.
- [`interview.md`](interview.md) — the questions you'll be asked about event loops, IoC, and "why is Node single-threaded yet concurrent?"
- [05 — Reactive Programming](../05-reactive-programming/) — events as *streams of values over time*, the natural next step.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — another "react to messages" model, built for concurrency.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — where the *mechanics* of the loop and async runtimes live.
- [Event-Driven Architecture](../../../Architecture/system-design/) — the distributed cousin: events *between* services (a system-design topic).
