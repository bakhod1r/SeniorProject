# Metaclasses — Interview Questions

> **Topic:** [Metaclasses](README.md)

---

## Introduction

These questions test whether a candidate understands that a class is itself an
object, that its metaclass controls class *creation*, and — crucially — that modern
languages provide simpler tools (`__init_subclass__`, class decorators) for most of
what metaclasses historically did. Strong answers can explain `type` as both "the
metaclass of everything" and "a callable class factory," distinguish
class-creation-time from instance-creation-time code, and reach for the lightest tool
that works.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is a metaclass?**

A metaclass is the class of a class. Since a class is itself an object, it has a type
— and that type (the metaclass) controls how the class is created and behaves. In
Python the default metaclass is `type`; `class Foo:` is essentially
`Foo = type('Foo', bases, namespace)`. A custom metaclass intercepts that creation.

## Question 2

**When does metaclass code run, versus a constructor?**

A metaclass's `__new__`/`__init__` run at **class-creation time** — when the `class`
statement executes (typically at import), once per class. A regular class's
`__init__` runs at **instance-creation time**, once per object. This is the single
most-misunderstood point: metaclass code fires when the class is *defined*, not when
it's instantiated.

## Question 3

**Walk through what `type(name, bases, namespace)` does.**

Called with three arguments, `type` is the class factory: it creates a new class
object named `name`, with the given base classes and a namespace dict of
attributes/methods. `class` syntax is sugar over exactly this call. Called with one
argument, `type(x)` returns the type of `x` — the same builtin doing double duty.

## Question 4

**What is the role of a metaclass's `__call__`?**

The metaclass's `__call__` runs when you *instantiate* the class (`Foo()` invokes
`type(Foo).__call__(Foo, ...)`). It's what normally calls `Foo.__new__` then
`Foo.__init__`. Overriding it lets you control instance creation globally — e.g. a
caching/singleton metaclass — but that's usually better done another way.

## Question 5

**`type` is the metaclass of classes. What is the metaclass of `type`?**

`type` itself — `type(type) is type`. The metaclass tower bottoms out: `type` is its
own type, which stops the infinite regress of "what's the class of the class of the
class...".

---

## Language-Specific

## Question 6

**Python: what do `__init_subclass__` and `__set_name__` give you, and why do they
matter for metaclasses?**

`__init_subclass__` (a hook on the base) runs whenever a subclass is defined, and
`__set_name__` (on a descriptor) tells a field its own attribute name at class
creation. Together (PEP 487) they handle subclass registration, validation, and
descriptor naming — the most common reasons people wrote metaclasses — without one.
The interview-grade point: prefer these; a metaclass is overkill for most of it.

## Question 7

**Python: what is `abc.ABCMeta`?**

It's a metaclass that implements abstract base classes: it makes a class with unimplemented
`@abstractmethod`s un-instantiable, and supports virtual subclassing via `register`
and `__subclasshook__`. It's the most common metaclass an average Python dev actually
uses — usually indirectly through `abc.ABC`.

## Question 8

**Ruby: what is the eigenclass / singleton class?**

Every Ruby object has a hidden per-object class (the eigenclass/singleton class) where
its singleton methods live; for a class object, that's where *class methods* (defined
via `def self.x` or `class << self`) live. It's Ruby's mechanism for per-object
behavior and is the counterpart to Python's metaclass story — classes are objects of
`Class`, and their singleton classes hold class-level methods.

## Question 9

**Ruby: how does `method_missing` relate to class-level magic?**

`method_missing` intercepts calls to undefined methods, letting a class synthesize
behavior dynamically (ActiveRecord's `find_by_name` dynamic finders). Combined with
`define_method`, it powers much of Rails' "magic." It must be paired with
`respond_to_missing?` so reflection (`respond_to?`, `method`) stays honest.

## Question 10

**Where do Smalltalk and Java sit?**

Smalltalk originated the model: every class has exactly one metaclass in a parallel
hierarchy, and classes are first-class objects you message at runtime. Java/C# are
weaker — `Class<?>`/`Type` objects exist and support reflection, but you can't
customize class creation the way Python metaclasses allow; Objective-C does have true
metaclasses holding class methods.

---

## Tricky / Trap

## Question 11

**"I need a singleton, so I'll write a singleton metaclass." Critique.**

It works but it's over-engineering: a metaclass is the heaviest possible tool for a
problem solved by a module-level instance, a factory function, or
`@functools.lru_cache`. The metaclass also makes the class harder to test (you can't
easily get a fresh instance) and composes badly with other metaclasses. Reach for the
simple tool.

## Question 12

**You combine an ABC and an ORM model via multiple inheritance and get
`metaclass conflict`. Why, and how do you fix it?**

Each base has a different metaclass (`ABCMeta` and the ORM's metaclass), and Python
requires the derived class's metaclass to be a (non-strict) subclass of *all* the
bases' metaclasses. There's no single such metaclass, so it errors. Fix: define a
metaclass that inherits from both and use it explicitly — or restructure to avoid
mixing two metaclassed hierarchies.

## Question 13

**Why is overriding `__getattribute__` (or a scanning metaclass) on a hot path
dangerous?**

Both add work to extremely frequent operations — `__getattribute__` runs on *every*
attribute access and is trivial to send into infinite recursion; a metaclass that does
heavy scanning runs at import and inflates startup. The trap is paying a pervasive
cost for a little convenience.

## Question 14

**A `class` statement fails with a traceback inside a metaclass. What does that tell
a junior who expected the error at instantiation?**

That metaclass code runs at *definition* time. The class never finished being created,
so nothing was even instantiated. It's a reminder that `class Foo(Base):` can execute
arbitrary metaclass logic the moment the module imports.

---

## Design

## Question 15

**Design declarative-model support (`class User(Model): name = CharField()`). Metaclass
or not?**

This is one of the rare legitimate metaclass uses *if* you must intercept the class
namespace and build a mapper/registry at creation — but in modern Python you'd lean on
`__init_subclass__` + `__set_name__` (descriptors learn their names, the base
registers subclasses) and only fall back to a metaclass for namespace control via
`__prepare__`. Either way it's framework code written once; application models stay
plain.

## Question 16

**You're reviewing a PR that adds a metaclass to application code. What's your
checklist?**

Ask: could `__init_subclass__`/`__set_name__`/a class decorator do this? Does it call
`super()` so it composes? Does it run expensive code at import? Will the type checker
and IDE still understand the class? Is the class-creation-time behavior documented?
Usually the answer is "replace the metaclass with the lighter tool"; metaclasses earn
their place only in framework internals serving many classes.
