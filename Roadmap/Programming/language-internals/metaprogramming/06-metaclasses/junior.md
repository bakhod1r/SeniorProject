# Metaclasses — Junior Level

> **Topic:** [Metaclasses](README.md)
> **Focus:** A class is itself an object. So *something* must have created it. That "something" is a metaclass. What is it, and when do you (almost never) need one?

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **If `dog` is an instance of `Dog`, and `Dog` is itself an object, what is `Dog` an instance of?**

You already know that when you write `dog = Dog()`, the variable `dog` is an **instance** of the class `Dog`. The class `Dog` is the *template* — it knows what methods exist, what attributes to set up, how to build a new dog.

Here is the idea that opens the door to metaclasses: in many languages — Python, Ruby, Smalltalk — **the class `Dog` is itself an object too.** It is a real value that lives in memory. You can assign it to a variable, pass it to a function, print it, ask it questions. And if `Dog` is an object, then by the same logic that says "every object has a class," `Dog` must *also* have a class.

The class of a class is called a **metaclass**.

In Python the answer is almost always one word: `type`.

```python
class Dog:
    pass

dog = Dog()

print(type(dog))   # <class '__main__.Dog'>   — the class of the instance
print(type(Dog))   # <class 'type'>            — the class of the class
```

So `type` is the thing that *creates classes*, the same way `Dog` is the thing that creates dogs. A metaclass is to a class what a class is to an instance. That single sentence is the whole topic. Everything else is detail.

> 🎓 **Why this matters for a junior:** You will read framework code — Django models, SQLAlchemy tables, ORMs, plugin systems — and find a line like `class User(models.Model):` that does *enormous* invisible work: it builds a database table description, registers the class somewhere, validates fields. That magic is often a metaclass. You do not need to *write* metaclasses (you almost never will). But you need to *recognize* one so that when something weird happens at `class` definition time, you know where to look.

This page covers: what "a class is an object" really means, what a metaclass is, how Python's `type` doubles as both "the type-checking function" and "the class factory," and why the famous advice is **"if you have to ask whether you need a metaclass, you don't."** The next level (`middle.md`) shows how to actually write one and what `__new__`/`__init__`/`__call__` do; `senior.md` covers conflicts, ORMs, and the modern replacements; `professional.md` covers the cross-language picture and production trade-offs.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a class and an instance are, in any one language (Python is used most here).
- **Required:** How to define a class with methods and call `SomeClass()` to make an instance.
- **Required:** What `__init__` does in Python — it runs when you make an instance.
- **Helpful but not required:** Basic inheritance (`class B(A)`), and the idea of a base class.
- **Helpful but not required:** That functions and classes can be passed around as values.

You do **not** need to know:

- How to *write* a metaclass (that's `middle.md`).
- `__new__`, `__prepare__`, `__set_name__`, MRO, or metaclass conflicts (later levels).
- Ruby eigenclasses or Smalltalk's metaclass hierarchy (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Instance** | A concrete object built from a class. `dog = Dog()` makes an instance. |
| **Class** | A template that describes how to build instances and what methods they have. |
| **Object** | A value that lives in memory and has a type. In Python, *everything* — including classes — is an object. |
| **Type** | The "kind" of a value. `type(x)` answers "what is `x`?" |
| **Metaclass** | The class *of a class*. The thing that creates classes, just as a class creates instances. |
| **`type`** | In Python, the default metaclass. Also the built-in function `type(x)` that tells you an object's class. Same name, two jobs. |
| **`object`** | In Python, the root base class — every class inherits from it (the top of the *inheritance* tree). |
| **Class creation** | The moment the `class` statement runs and the class object is built. Happens once, when the module loads — not when you make instances. |
| **Class body** | The indented code under `class Foo:` — method defs, attributes. It runs once, at class-creation time. |
| **Factory** | Something that produces objects. A class is a factory for instances; a metaclass is a factory for classes. |
| **`__init__`** | The method that runs to initialize a *new instance*. |
| **Declarative class** | A class you write that mostly *declares* fields/structure, and a framework turns that declaration into behavior (e.g. an ORM model). Often powered by a metaclass. |

---

## Core Concepts

### 1. "Everything Is an Object" — Including Classes

In Python, integers are objects, strings are objects, functions are objects, and **classes are objects**. This is not a figure of speech. You can do everything to a class that you can do to any other value:

```python
class Dog:
    def bark(self):
        return "woof"

x = Dog            # assign the class to a variable — no parentheses, no instance
print(x)           # <class '__main__.Dog'>
animals = [Dog]    # put it in a list
print(x().bark())  # call x like a class, get an instance, call its method -> "woof"
```

`Dog` (no parentheses) is the class object itself. `Dog()` (with parentheses) *calls* that object to produce an instance. The class is a value; the instance is another value; calling the first gives you the second.

### 2. Every Object Has a Class — So What Is the Class of a Class?

The function `type(x)` tells you the class of any object:

```python
type(42)        # <class 'int'>
type("hi")      # <class 'str'>
type(Dog())     # <class '__main__.Dog'>
```

Apply the same rule to the class object `Dog` itself:

```python
type(Dog)       # <class 'type'>
```

The class of `Dog` is `type`. The class of `int` is `type`. The class of `str` is `type`. **`type` is the metaclass of almost every class in Python.** It is the factory that builds classes.

```text
   instance  ----type()-->   class   ----type()-->   metaclass
     dog                      Dog                       type
   "hello"                    str                       type
      42                      int                       type
```

### 3. `type` Has Two Jobs (and Two Call Shapes)

This trips up everyone at first. `type` is *one* built-in, but you call it two different ways:

**Call shape A — with one argument:** "tell me the class of this object."

```python
type(42)        # <class 'int'>
```

**Call shape B — with three arguments:** "*build a brand-new class* for me."

```python
Dog = type("Dog", (), {"bark": lambda self: "woof"})
#          name    bases  namespace (methods/attributes)

d = Dog()
print(d.bark())   # "woof"
```

Those two lines build a class *exactly* equivalent to writing `class Dog:` with a `bark` method. The three arguments are:

1. **name** — the class's name as a string (`"Dog"`).
2. **bases** — a tuple of parent classes (`()` means just inherit from `object`).
3. **namespace** — a dict of the class's contents: methods, class attributes.

The lesson: **the `class` statement is syntax sugar.** Under the hood, Python collects the name, the bases, and the body into a namespace dict, and calls the metaclass (`type`) to manufacture the class. A metaclass is "the thing Python calls to turn a `class` block into a class object."

### 4. Class Creation Happens Once, Early

When does a class get *built*? Not when you make instances. It is built **the moment the `class` statement runs**, which is usually when the module is first imported.

```python
print("before")

class Dog:
    print("class body running!")   # this prints during import, immediately

print("after")
```

Output:

```text
before
class body running!
after
```

The class body executes *once*, top to bottom, at import time. This is the moment a metaclass gets to intervene — it is the "construction time" of the class itself. Compare:

- `__init__` runs every time you make an **instance**.
- A metaclass's work runs once, when you make the **class**.

### 5. You Rarely Need to Write One

Here is the most important practical point at this level, and it comes from Tim Peters (author of much of Python's standard library):

> "Metaclasses are deeper magic than 99% of users should ever worry about. If you wonder whether you need them, you don't (the people who actually need them know with certainty that they need them, and don't need an explanation about why)."

You will *use* metaclasses indirectly all the time (every Django model, every `abc.ABC`). You will *write* one almost never. Modern Python (since version 3.6) added simpler tools — `__init_subclass__` and `__set_name__` — that cover most of what people used to reach for metaclasses to do. Recognizing a metaclass is a junior skill. Writing one is a "you'll know when" skill.

---

## Real-World Analogies

**The cookie cutter and the cookie-cutter machine.** An instance is a cookie. A class is the cookie cutter — it stamps out cookies of a fixed shape. A metaclass is the *machine in the factory that manufactures cookie cutters*. Most bakers only ever touch cookies and cutters. The machine that makes cutters is real, it exists, and you almost never need to operate it yourself — but when you want to mass-produce a hundred *new shapes of cutter* with consistent handles, that machine is where you'd go.

**Rubber stamp and stamp-maker.** A class is a rubber stamp; pressing it makes identical instances. The metaclass is the workshop that *engraves new stamps*. You can tell the workshop, "every stamp you make should also engrave a serial number on the back" — that's what writing a metaclass does: it customizes how *all classes of a certain kind* get built.

**The forms office.** Filling out a tax form is making an instance. The blank form template is the class. The bureaucrat who *designs and registers new form templates* — who says "every new form must have a barcode and be logged in the registry" — is the metaclass. They act once, when a new template is created, not every time someone fills one out.

> ⚠️ Analogies break down quickly here. The honest one-liner is: **metaclass : class :: class : instance.** Hold onto that ratio; it is exact, where the cookie/stamp stories are only suggestive.

---

## Mental Models

### Model 1: The Two-Step Ladder

Picture a ladder with three rungs:

```text
   metaclass   (type)          "what builds classes"
       |  type()
     class     (Dog)           "what builds instances"
       |  type()
   instance    (dog)           "the concrete thing"
```

Going *down* a rung is "calling": call `type` → get a class; call the class → get an instance. Going *up* a rung is `type()`: `type(dog)` → `Dog`; `type(Dog)` → `type`. The ladder has a top: `type(type)` is `type` itself. We stop there. (Why it stops is a `senior.md` detail; for now: the ladder is finite.)

### Model 2: `class` Is a Function Call in Disguise

When you write:

```python
class Dog(Animal):
    legs = 4
    def bark(self): return "woof"
```

mentally rewrite it as:

```python
Dog = type("Dog", (Animal,), {"legs": 4, "bark": <the bark function>})
```

Both produce the same class. The `class` keyword is friendly syntax over "call the metaclass with name, bases, namespace." Once you see `class` as a *call to a factory*, the question "can I customize that factory?" answers itself — yes, by supplying a different metaclass. That's all a metaclass is.

### Model 3: Construction Time vs. Use Time

There are two distinct clocks:

- **Class-construction time** — when the `class` block runs (import time). Metaclass code fires here.
- **Instance-construction time** — when you call `Dog()`. `__init__` fires here.

Keeping these clocks separate prevents 90% of metaclass confusion. A metaclass acts at the *first* clock, shaping the class. By the time you're making instances, the metaclass has long since finished its job.

---

## Code Examples

### Example 1: Proving a class is an object

```python
class Dog:
    pass

# It's a value: assign, store, inspect.
ref = Dog
print(ref is Dog)        # True — same object
print(Dog.__name__)      # "Dog"
print(isinstance(Dog, object))  # True — classes are objects
print(isinstance(Dog, type))    # True — and their type is `type`
```

### Example 2: The class of common things is `type`

```python
print(type(int))      # <class 'type'>
print(type(str))      # <class 'type'>
print(type(list))     # <class 'type'>
print(type(object))   # <class 'type'>
print(type(type))     # <class 'type'>   <- type is its own type; the ladder ends here
```

### Example 3: Building a class without the `class` keyword

```python
def greet(self):
    return f"Hi, I'm {self.name}"

# Same as: class Person: ...
Person = type(
    "Person",                 # name
    (),                       # bases
    {"species": "human",      # class attribute
     "greet": greet},         # method
)

p = Person()
p.name = "Ada"
print(p.greet())     # "Hi, I'm Ada"
print(p.species)     # "human"
print(type(p))       # <class '__main__.Person'>
```

This is the single most clarifying exercise in the topic. The `class` statement and this `type(...)` call are interchangeable. The metaclass *is* the function being called.

### Example 4: Seeing class-creation time fire

```python
class Loud:
    print(">>> Loud is being built right now")
    x = 1
    print(">>> still building, x is set")

print(">>> Loud is finished")
# Notice: we never made an instance, yet two lines already printed.
```

### Example 5: Recognizing a metaclass in framework code (read-only)

You will see code like this and should now *recognize the shape* even if you can't yet write it:

```python
# Conceptually how an ORM's base looks (simplified):
class Model(metaclass=SomeMetaclass):
    ...

class User(Model):
    name = CharField()
    email = CharField()
```

The `metaclass=SomeMetaclass` part (or a base class that itself uses one) means: *something custom runs when `User` is defined* — it scans `name` and `email`, builds a table description, and registers `User`. You don't see `__init__` doing this because it happens at **class**-creation time, courtesy of the metaclass.

---

## Pros & Cons

**Pros (why the mechanism exists):**

- **Lets frameworks do magic at `class` time.** ORMs turn a plain-looking class into a database table; plugin systems auto-register subclasses. This is genuinely useful and powers tools you rely on daily.
- **Centralizes class-wide policy.** "Every model must have a `created_at` field" can be enforced in one place for all subclasses.
- **It's the truthful model of the language.** Understanding that classes are objects makes Python's whole object model click — `isinstance`, `type`, descriptors, decorators all become coherent.

**Cons (why you avoid writing them):**

- **Deepest magic in the language.** Code that runs at class-creation time is hard to follow, hard to debug, and surprising to teammates.
- **Almost always overkill.** A class decorator or `__init_subclass__` usually does the same job with far less mystery.
- **They compose badly.** Two libraries each using a metaclass can collide (a "metaclass conflict") — a real, confusing error you'll meet later.
- **Steep learning cliff.** A junior reading metaclass-heavy code can lose hours just figuring out *when* the code even runs.

> Rule of thumb at this level: **read** metaclasses to understand frameworks; **don't write** them. If you think you need one, you almost certainly want a class decorator or `__init_subclass__` instead.

---

## Use Cases

You will *encounter* (not author) metaclasses behind:

- **ORMs / declarative models.** Django `models.Model`, SQLAlchemy declarative base, Pydantic v1 — a metaclass reads your declared fields and wires up persistence/validation when the class is defined.
- **Automatic subclass registration.** Plugin systems where merely *defining* a subclass adds it to a registry, no manual `register()` call needed.
- **Abstract base classes.** Python's `abc.ABCMeta` (the metaclass behind `abc.ABC`) makes `@abstractmethod` work and blocks instantiation of incomplete subclasses.
- **Enums.** Python's `enum.Enum` uses a metaclass (`EnumMeta`) to give you the unique-member, iterable behavior.
- **Singletons / interface enforcement.** Niche cases where every class of a family must obey a rule checked at definition time.

In your own code, the right answer is usually one of the *simpler* tools you'll meet in `middle.md`: a class decorator, or `__init_subclass__`.

---

## Coding Patterns

At junior level the only "pattern" is **recognition**, not authorship.

**Pattern: spot the construction-time work.** When you see a base class with declared fields and surprising behavior, ask: *what runs when the subclass is defined?* Look for `metaclass=` in a base class, or an `__init_subclass__` method, or a class decorator above the class. One of those is doing the magic.

**Pattern: read with the ladder in mind.** When confused, write down the three rungs for the objects involved:

```python
type(obj)          # instance -> class
type(type(obj))    # class -> metaclass
```

Knowing *which rung* a piece of code operates on usually dissolves the confusion.

**Anti-pattern (avoid): reaching for `type(...)`-as-factory in normal code.** If you find yourself building classes dynamically with `type("Foo", ...)`, stop and ask whether a plain function, a closure, or a `dataclass` would do. It almost always would.

---

## Best Practices

- **Default to *not* writing one.** Prefer a normal class, then a class decorator, then `__init_subclass__`, and only then a metaclass — in that order of preference.
- **Recognize the construction-time clock.** When debugging "why did this happen at import?", remember the class body and any metaclass run *once, early*.
- **Trust frameworks.** When `class User(models.Model)` does magic, that's intended; you don't need to fight or fully decode it to use it.
- **When you must read metaclass code, find `__new__`/`__init__` on the metaclass.** Those are where class-creation customization lives (details in `middle.md`).
- **Keep the ratio in your head:** *metaclass : class :: class : instance.* It is the one fact that never lets you down.

---

## Edge Cases & Pitfalls

- **Confusing the metaclass with the base class.** `object` is the root of the *inheritance* tree (what you subclass). `type` is the root of the *metaclass* tree (what creates classes). They are different axes. `class Dog(Animal)` sets the base; `class Dog(metaclass=Meta)` sets the metaclass. (More in `middle.md`.)
- **Thinking the metaclass runs per-instance.** It doesn't. It runs once, when the class is created. `Dog()` does not re-run the metaclass.
- **`type(x)` vs `x.__class__`.** They usually agree, but `__class__` can be reassigned and lied to; `type(x)` is the honest answer. As a junior, just use `type(x)`.
- **Assuming every language works like Python.** Java and C# have class *objects* (reflection), but classes aren't created by a user-overridable metaclass at runtime the way Python's are. Ruby and Smalltalk have rich metaclass models that differ from Python's (covered in `professional.md`).
- **Editing the namespace dict by hand.** Beginners sometimes try to mutate a class's `__dict__` directly. It's a `mappingproxy` (read-only view) — you can't just assign into it. Set attributes on the class instead.
- **The infinite-ladder worry.** "If every object has a class, doesn't the metaclass need a metaclass forever?" No — the ladder terminates because `type(type)` is `type`. It is its own metaclass. The recursion stops; you don't need to chase it.

---

## Cheat Sheet

```text
INSTANCE  : a thing            dog = Dog()
CLASS     : makes instances    class Dog: ...
METACLASS : makes classes      type, or class Meta(type): ...

type(dog)   -> Dog       (class of an instance)
type(Dog)   -> type      (metaclass of a class)
type(type)  -> type      (the ladder ends; type is its own type)

THE CLASS STATEMENT IS A FACTORY CALL:
  class Dog(Base): body
  == Dog = type("Dog", (Base,), {namespace from body})

TWO CLOCKS:
  class-creation time  -> runs once at import; metaclass acts here
  instance-creation    -> runs on Dog(); __init__ acts here

THE RATIO (memorize):  metaclass : class :: class : instance

YOU SHOULD: recognize metaclasses in frameworks (ORMs, ABCs, enums).
YOU SHOULD NOT: write one. Prefer a decorator or __init_subclass__.
TIM PETERS: "If you wonder whether you need metaclasses, you don't."
```

---

## Summary

A **metaclass is the class of a class.** In Python, classes are real objects, so they too have a type, and that type — the factory that builds classes — is `type`. The `class` statement is sugar for calling that factory with a name, a tuple of bases, and a namespace dict; you can even do it by hand with `type(name, bases, namespace)`. Metaclass code runs at **class-creation time** (once, at import), which is a different clock from `__init__`'s instance-creation time.

You will meet metaclasses constantly in *framework* code — ORMs, abstract base classes, enums, plugin registries — and almost never need to *write* one. The guidance to internalize: recognize the mechanism, keep the ratio *metaclass : class :: class : instance* in your head, and reach for simpler tools first. The next level teaches you how to actually build one, and exactly which simpler tools (class decorators, `__init_subclass__`) usually make that unnecessary.

---

## Further Reading

- The Python Language Reference, "Data model" — sections on classes, `type`, and metaclasses.
- The Python `abc` module documentation (`ABCMeta`) — a metaclass you already use.
- The Python `enum` module documentation — another everyday metaclass.
- PEP 3115 — "Metaclasses in Python 3000" (introduces `__prepare__`; skim now, read later).
- PEP 487 — "Simpler customization of class creation" (`__init_subclass__`, `__set_name__`); the modern alternative you'll reach for instead of metaclasses.
