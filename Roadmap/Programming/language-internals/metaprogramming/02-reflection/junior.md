# Reflection — Junior Level

> **Topic:** [Reflection](README.md)
> **Focus:** How a program looks at itself at runtime — asking "what type is this? what fields does it have? what methods can I call?" — and the first tools you'll meet for doing it.

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
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [What You Can Build](#what-you-can-build)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does it mean for a program to inspect its own structure while it is running?** And **why would you ever need that?**

Most of the code you write is *direct*. You have a `User` object, you know it has a `name` field, so you write `user.name`. You know there is a `save()` method, so you write `user.save()`. The names are baked into your source code, and the compiler checks every one of them before the program even starts.

**Reflection** is the ability to do those same things *without knowing the names in advance*. With reflection, you can hand a program some object it has never seen before and ask: *"What type are you? What fields do you have? What are their names and types? Do you have a method called `save`? If so, call it."* The program figures all of this out **at runtime**, by inspecting the object itself rather than by reading hard-coded names from the source.

In one sentence: **reflection is a program reading and using its own structure — its types, fields, and methods — as data, while it runs.**

This sounds abstract, but you use reflection-powered tools every single day, probably without realizing it:

- When you call `json.Marshal(user)` in Go or `objectMapper.writeValueAsString(user)` in Java, the library does not know your `User` type. It *reflects* over it: it walks the fields, reads their names, and builds the JSON.
- When a test framework like JUnit "finds all the `@Test` methods," it is reflecting over your test class to discover them.
- When an ORM like Hibernate maps a database row onto an object, it reflects to find which field corresponds to which column.

> 🎓 **Why this matters for a junior:** You will *use* reflective libraries long before you ever write reflection yourself. Understanding what they do under the hood — and why your struct's field names suddenly matter, or why a `json` tag changes the output — turns a pile of "magic" into something you can reason about and debug. That alone is worth this page.

This page covers: the two halves of reflection (**looking** vs. **doing**), the core vocabulary (type, field, method, runtime), tiny hello-world examples in Python, Go, Java, and C#, why Rust mostly says "no thanks" to runtime reflection, and the first traps to avoid. The deeper machinery — performance costs, `MethodHandle`, settability rules, the module system — lives in `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program with functions and a class/struct in at least one language (Python, Go, Java, or C#).
- **Required:** What a **field** (also called a member or attribute) and a **method** are.
- **Required:** The difference between a **type** (the blueprint, like `User`) and an **instance** (one actual `user` object).
- **Helpful but not required:** Some exposure to JSON, and to a library that turns objects into JSON or back.
- **Helpful but not required:** A vague sense that "compile time" (when your code is checked and built) is different from "runtime" (when it actually runs).

You do **not** need to know:

- How reflection is implemented inside the runtime (type metadata layout — that's `senior.md`).
- Performance numbers, caching, or `invokedynamic` / `MethodHandle` (that's `middle.md` and beyond).
- Anything about code generation as an alternative (touched on in later levels).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Reflection** | A program inspecting and/or manipulating its own structure (types, fields, methods) at runtime. |
| **Introspection** | The *read-only* half of reflection: looking at structure without changing or invoking anything. "What fields does this have?" |
| **Intercession** | The *active* half: actually doing something — reading/writing a field's value, or calling a method — by name, at runtime. Also called dynamic invocation. |
| **Runtime** | While the program is executing, as opposed to **compile time**, when it is being built and type-checked. |
| **Type** | The blueprint or class of a value: `User`, `int`, `string`. Reflection lets you obtain a *value that represents a type*. |
| **Field** | A named piece of data inside an object (`name`, `age`). Sometimes called a member, attribute, or property. |
| **Method** | A named function attached to a type (`save()`, `toString()`). |
| **Metadata** | Data *about* your code — the names, types, and structure the runtime keeps so reflection can answer questions. |
| **`Class` object (Java)** | The runtime handle representing a class. You get it via `obj.getClass()` or `User.class`. |
| **`reflect.Type` / `reflect.Value` (Go)** | The two handles Go's `reflect` package gives you: one describes the type, one wraps an actual value. |
| **`type()` / `getattr` (Python)** | `type(x)` returns an object's type; `getattr(x, "name")` reads a field by its string name. |
| **`setAccessible(true)` (Java)** | A switch that tells the runtime to *ignore* `private` so reflection can touch fields it normally couldn't. Powerful and dangerous. |
| **Struct tag (Go)** | A string literal attached to a struct field (e.g. `json:"user_name"`) that libraries read via reflection to change behavior. |
| **Annotation / Attribute** | Metadata you attach to code: `@Test` in Java, `[Test]` in C#. Frameworks find these by reflection. |
| **Dynamic invocation** | Calling a method whose name you only know as a string at runtime. |

---

## Core Concepts

### 1. Two Halves: Looking vs. Doing

Reflection splits cleanly into two activities, and keeping them apart makes everything clearer:

- **Introspection (looking, read-only).** "What type is this object? List its fields. Does it have a method named `close`?" Nothing changes; you are just reading metadata. This is the safe, common half.
- **Intercession / dynamic invocation (doing).** "Set the field `name` to `'Ada'`. Call the method `save`." Now you are *acting* on the object by name, at runtime. More powerful, more dangerous, slower.

Almost every real use of reflection is *mostly looking, with a little doing at the end*: a JSON library looks at all the fields (introspection) and then reads each one's value (a tiny bit of intercession) to build the output.

### 2. It Happens at Runtime, Not Compile Time

This is the defining property. Normally, your compiler knows every name. If you misspell `user.nme`, it refuses to build. With reflection, the name is often a **string** (`getattr(user, "nme")`) or comes from data, so the compiler cannot check it. The mistake surfaces *while the program runs*, possibly only when that exact code path executes.

That trade is the soul of reflection: **you gain the ability to handle types you didn't know about when you wrote the code, and you lose the compiler's safety net.**

### 3. The Type Object: Your Entry Point

Every reflective journey starts by getting a handle that *represents a type*. It is itself a value you can hold in a variable and ask questions:

- **Java:** `Class<?> c = user.getClass();` then `c.getDeclaredFields()`, `c.getMethods()`.
- **Go:** `t := reflect.TypeOf(user)` then `t.NumField()`, `t.Field(i)`.
- **Python:** `type(user)` (or just `user.__class__`), then `dir(user)` and `user.__dict__`.
- **C#:** `Type t = user.GetType();` then `t.GetProperties()`, `t.GetMethods()`.

From that one handle you can reach everything else: fields, methods, constructors, and any metadata (annotations/tags) attached to them.

### 4. Reading and Writing a Field by Name

Once you have the type and an instance, you can read a field whose name you only have as text:

- **Python:** `getattr(user, "name")` reads it; `setattr(user, "name", "Ada")` writes it; `hasattr(user, "name")` checks existence.
- **Go:** `reflect.ValueOf(&user).Elem().FieldByName("Name")` — but writing has strict rules (see Pitfalls).
- **Java:** `Field f = c.getDeclaredField("name"); f.setAccessible(true); f.get(user);` / `f.set(user, "Ada");`
- **C#:** `t.GetProperty("Name").GetValue(user);` / `.SetValue(user, "Ada");`

### 5. Calling a Method by Name

The active extreme: you have a method name as a string and you invoke it.

- **Python:** `getattr(user, "save")()` — get the method, then call it.
- **Java:** `Method m = c.getMethod("save"); m.invoke(user);`
- **Go:** `reflect.ValueOf(user).MethodByName("Save").Call(nil)`
- **C#:** `t.GetMethod("Save").Invoke(user, null);`

### 6. Languages Sit on a Spectrum

Not all languages reflect equally:

- **Python** makes reflection *trivial and pervasive* — everything is an object, and inspecting objects is just normal Python.
- **Java** and **C#** have full, explicit reflection libraries (`java.lang.reflect`, `System.Reflection`) — powerful but verbose and ceremonious.
- **Go** has `reflect`, but the language *discourages* it: it is slow, unsafe, and verbose by design, used mostly inside libraries.
- **Rust** deliberately has **almost no runtime reflection.** Its philosophy is "zero-cost" — anything that costs runtime work you didn't ask for is suspect. Instead, Rust does the same jobs at *compile time* with macros and `derive` (see below).

---

## Real-World Analogies

**The mystery box with a label.** Direct programming is opening a box you packed yourself — you know exactly what's inside. Reflection is being handed a sealed box from a stranger. You can't assume anything, so you read the shipping label (the type), feel the shape (the fields), and check the included instruction card (the methods) before doing anything. Introspection is reading the label; intercession is following the instructions to actually use the contents.

**A form with blank field names.** Imagine a paper form where the *field labels themselves* are filled in by someone else: one form says "Name / Age," another says "Title / ISBN." A clerk who can read any such form and copy each labeled value into a database is doing reflection — they handle forms they've never seen because they read the labels at the moment, not in advance. A JSON serializer is exactly this clerk.

**A universal remote.** A normal remote has buttons hard-wired to one TV. A universal remote *asks the device* what it can do and adapts. Dynamic invocation is the universal remote: "whatever method this object exposes, I can press it by name."

**The hospital with charts.** Every patient (object) carries a chart (metadata) listing their details and the procedures (methods) they can undergo. A new doctor reflects: instead of knowing each patient personally, they read the chart and act accordingly. The chart is the runtime type information that makes reflection possible.

---

## Mental Models

**Model 1: "Names become data."** In normal code, names like `name` and `save` are *invisible* — they exist only in source and vanish after compilation. Reflection keeps those names *alive as data you can hold in variables, print, loop over, and compare*. The mental shift is: a field name is no longer just syntax; it is a string you can pass around.

**Model 2: "The map of the building."** Your program's types form a building. Normally you walk it by memory — you *know* room 3 is the kitchen. Reflection hands you the building's floor plan as a document. Now you can answer "how many rooms? what's in each?" for *any* building, even one you've never visited.

**Model 3: "Introspection is reading; intercession is editing."** Hold this split in your head constantly. Reading the floor plan is safe and cheap. Knocking down a wall because the plan said you could is where things get risky. Most code should stay on the reading side.

**Model 4: "The runtime kept notes."** Reflection only works because the language's runtime *kept metadata* about your types instead of throwing it away after compiling. Java keeps rich class info; Go keeps type descriptors; Python keeps everything (it's all objects). Rust mostly *throws the notes away* for speed — which is exactly why Rust can't reflect at runtime.

---

## Code Examples

### Example 1: Introspection — listing fields and methods

**Python** (the most natural place to start):

```python
class User:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def greet(self):
        return f"Hi, I'm {self.name}"

u = User("Ada", 36)

print(type(u))            # <class '__main__.User'>
print(type(u).__name__)   # 'User'
print(u.__dict__)         # {'name': 'Ada', 'age': 36}  -- the instance's fields
print(dir(u))             # every attribute & method name, as strings

# Read a field whose name is just a string:
print(getattr(u, "name"))           # 'Ada'
print(hasattr(u, "email"))          # False

# Call a method whose name is just a string:
print(getattr(u, "greet")())        # 'Hi, I'm Ada'
```

Notice how *ordinary* this looks in Python. There is no special "reflection library" ceremony — inspecting objects is just Python.

**Go** (more explicit, via the `reflect` package):

```go
package main

import (
	"fmt"
	"reflect"
)

type User struct {
	Name string
	Age  int
}

func main() {
	u := User{Name: "Ada", Age: 36}

	t := reflect.TypeOf(u)   // describes the *type*
	v := reflect.ValueOf(u)  // wraps the *value*

	fmt.Println(t.Name(), t.Kind()) // User struct

	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)                 // a StructField (name, type, tag)
		fmt.Printf("%s = %v\n", f.Name, v.Field(i))
	}
	// Output:
	// Name = Ada
	// Age = 36
}
```

`reflect.TypeOf` gives you the type handle; `reflect.ValueOf` wraps the actual value. You almost always use them together.

### Example 2: Struct tags — the thing that makes JSON "just work" (Go)

```go
type User struct {
	Name  string `json:"user_name"`
	Email string `json:"email,omitempty"`
}
```

When you call `json.Marshal(u)`, the standard library *reflects* over `User`, reads each field's `json:"..."` **struct tag**, and uses it to decide the output key. That's why the field `Name` becomes `"user_name"` in the JSON — a library read a tag via reflection. You can read tags yourself:

```go
t := reflect.TypeOf(User{})
f, _ := t.FieldByName("Name")
fmt.Println(f.Tag.Get("json")) // "user_name"
```

This single mechanism powers JSON, YAML, database mapping (`db:"..."`), validation (`validate:"required"`), and more.

### Example 3: Dynamic invocation in Java

```java
import java.lang.reflect.*;

class User {
    private String name = "Ada";
    public String greet() { return "Hi, I'm " + name; }
}

public class Demo {
    public static void main(String[] args) throws Exception {
        User u = new User();
        Class<?> c = u.getClass();

        // Introspection: list declared fields
        for (Field f : c.getDeclaredFields()) {
            System.out.println(f.getType() + " " + f.getName());
        }

        // Read a private field by reflecting + breaking access control
        Field nameField = c.getDeclaredField("name");
        nameField.setAccessible(true);            // ignore 'private'
        System.out.println(nameField.get(u));     // "Ada"

        // Call a method by name
        Method m = c.getMethod("greet");
        System.out.println(m.invoke(u));          // "Hi, I'm Ada"
    }
}
```

The `setAccessible(true)` call is doing something significant: it asks the runtime to let you reach into a `private` field. That is convenient for libraries and dangerous for encapsulation — `middle.md` and `senior.md` discuss why.

### Example 4: C# reflection with attributes

```csharp
using System;
using System.Reflection;

class User {
    public string Name { get; set; } = "Ada";
    public string Greet() => $"Hi, I'm {Name}";
}

class Program {
    static void Main() {
        var u = new User();
        Type t = u.GetType();

        foreach (PropertyInfo p in t.GetProperties())
            Console.WriteLine($"{p.PropertyType} {p.Name} = {p.GetValue(u)}");

        MethodInfo m = t.GetMethod("Greet");
        Console.WriteLine(m.Invoke(u, null)); // "Hi, I'm Ada"
    }
}
```

### Example 5: Rust says "no" — and does it at compile time instead

Rust has no general runtime reflection. You cannot, in safe stable Rust, hand it an arbitrary value and ask "list your fields by name." Instead, the same jobs are done at **compile time** with macros. The Serde library is the classic example:

```rust
use serde::Serialize;

#[derive(Serialize)]   // a macro generates the serialization code at compile time
struct User {
    name: String,
    age: u32,
}

fn main() {
    let u = User { name: "Ada".into(), age: 36 };
    println!("{}", serde_json::to_string(&u).unwrap()); // {"name":"Ada","age":36}
}
```

`#[derive(Serialize)]` runs *while compiling* and writes out the exact code to serialize a `User` — no runtime field-walking, no metadata lookup, no cost you didn't ask for. The output is the same as a reflective serializer; the *mechanism* is completely different. Keep this contrast in mind: **reflection (runtime) and code generation (compile time) often solve the same problem.**

---

## Pros & Cons

**Pros**

- **Generality.** One piece of code handles *any* type. A single `toJson(x)` works for `User`, `Order`, and types invented next year.
- **Decoupling.** A serializer, ORM, or test runner needs zero knowledge of your specific classes. You can add new types without touching the framework.
- **Enables whole categories of tools.** Dependency injection, serialization, ORMs, mocking, test discovery — all rely on reflection.
- **Convenience.** `getattr(obj, name)` can replace a giant `if/elif` ladder dispatching on a string.

**Cons**

- **Lost compile-time safety.** Names become strings; typos and type mismatches become *runtime* errors instead of *build* errors.
- **Slower.** Reflective field reads and method calls are far slower than direct ones — the runtime can't optimize or inline them well.
- **Harder to read and debug.** "Where is this method called?" — your IDE often can't tell you, because the call is by string.
- **Breaks tooling.** Refactoring (rename), dead-code elimination, and obfuscation all assume names are used directly; reflection hides usages from them.
- **Security and encapsulation risk.** `setAccessible(true)` bypasses `private`. That's a feature and a foot-gun.

---

## Use Cases

Reflection is the quiet engine behind tools you already use:

- **Serialization / deserialization.** `json.Marshal` (Go), Jackson/Gson (Java), `System.Text.Json` (C#), `pickle`/`dataclasses.asdict` (Python). They reflect over fields to convert objects to/from JSON, XML, etc.
- **ORMs / database mapping.** Hibernate (Java), GORM (Go), Entity Framework (C#), SQLAlchemy (Python) map rows to objects by reflecting on fields and tags/annotations.
- **Dependency injection.** Spring (Java), .NET's DI — they construct objects and fill dependencies by reflecting on constructors and annotations.
- **Test frameworks.** JUnit finds `@Test` methods; pytest discovers `test_*` functions; xUnit finds `[Fact]` — all by reflection.
- **Generic utilities.** A universal `toString()` / `equals()` / "pretty-print any object" routine.
- **Mocking libraries.** Mockito, GoMock, and friends create stand-in objects by reflecting over interfaces/types.

The pattern: **whenever a library must work with types it has never seen, reflection is usually how.**

---

## Coding Patterns

**Pattern 1: Inspect first, act second.** Always do the read-only introspection (list fields, check a method exists) before any intercession. Don't blindly `invoke` a method you haven't confirmed exists.

```python
if hasattr(obj, "close"):
    getattr(obj, "close")()
```

**Pattern 2: Guard with `hasattr` / existence checks.** Because names aren't compiler-checked, defend against missing members explicitly.

**Pattern 3: Tags/annotations as configuration.** Instead of hard-coding behavior, read a struct tag or annotation and let it drive the logic (the JSON-key pattern). This keeps the mapping next to the data.

**Pattern 4: Keep reflection at the edges.** Use reflection in the *library/boundary* layer (parsing input, building output). Keep your core business logic plain, direct, and type-checked.

---

## Best Practices

- **Prefer not to.** If you can solve it with normal code, generics, or an interface, do that. Reflection is a last resort, not a default.
- **Introspect more, intercede less.** Reading structure is far safer than dynamically setting fields and calling methods.
- **Validate names early.** If you reflect on a method/field name, check it exists and fail with a clear message — don't let a cryptic runtime error leak out later.
- **Don't reach into `private` casually.** `setAccessible(true)` (Java) or touching `_internal` attributes (Python) couples you to another type's *secrets*, which can change without warning.
- **Centralize it.** Wrap reflective code in one small, well-tested module rather than scattering `getattr` / `invoke` calls everywhere.
- **Read the library's docs about tags/annotations.** Half of "reflection in practice" for a junior is just knowing which tag (`json:"..."`, `@JsonProperty`, `[JsonPropertyName]`) does what.

---

## Edge Cases & Pitfalls

- **The typo'd name.** `getattr(user, "nme")` doesn't fail at build time — it throws `AttributeError` at runtime, maybe only on a rare path. The compiler can't save you.
- **Go's settability rule.** This trips up *everyone*. `reflect.ValueOf(u).Field(0).Set(...)` **panics** because the value is a copy, not addressable. You must pass a *pointer* and call `.Elem()`: `reflect.ValueOf(&u).Elem().Field(0).Set(...)`. And the field must be exported (capitalized). More in `middle.md`.
- **Unexported / private members.** In Go, reflection can *read* some unexported fields but cannot *set* them. In Java you need `setAccessible(true)` — which may now be blocked by the module system (see `professional.md`).
- **Reflection sees the *runtime* type, not the *declared* type.** If a variable declared as `Animal` actually holds a `Dog`, reflection reports `Dog`. Usually what you want, but surprising the first time.
- **It's slow in a loop.** Reflecting once is fine; reflecting a million times in a hot loop is a performance bug. Cache the type/field/method handles (see `middle.md`).
- **Renaming breaks it silently.** If you rename a field `Name`→`FullName` but a JSON tag or a string somewhere still says `"name"`, nothing complains until data is wrong at runtime.
- **Static analysis goes blind.** Your IDE's "find usages" and dead-code detection can't see reflective calls, so code that *looks* unused may actually be vital.

---

## Common Mistakes

1. **Reaching for reflection too early.** Many "I need reflection" problems are solved more simply by an interface, a generic, or a `switch`/`match`. Try those first.
2. **Forgetting Go's pointer/`Elem()` rule** and getting a panic on `Set`.
3. **Ignoring exported-vs-unexported (Go) / public-vs-private (Java) rules** and being surprised when fields are invisible or unsettable.
4. **Not caching handles**, then wondering why the serializer is slow.
5. **Letting reflective typos become production runtime errors** instead of validating names up front.
6. **Assuming Rust can reflect like Python** — it can't; reach for `derive` macros instead.

---

## Test Yourself

1. In one sentence, what is reflection?
2. What is the difference between **introspection** and **intercession**?
3. Why does a reflective field-name typo escape the compiler but a normal `user.nme` typo does not?
4. In Go, what makes `json.Marshal` know to output `"user_name"` instead of `"Name"`?
5. What does `setAccessible(true)` do in Java, and why is it risky?
6. Name three real tools that rely on reflection.
7. Why does Rust avoid runtime reflection, and what does it use instead?
8. Why is reflection slower than a direct method call?

<details>
<summary>Answers</summary>

1. A program inspecting and/or manipulating its own structure (types, fields, methods) at runtime.
2. Introspection is read-only looking ("what fields are there?"); intercession is acting — reading/writing fields and calling methods by name.
3. With reflection the name is a string the compiler can't verify; `user.nme` is a hard-coded identifier the compiler resolves and rejects at build time.
4. The library reflects over the struct and reads each field's `json:"..."` **struct tag**.
5. It tells the runtime to ignore `private` so reflection can access a field/method it normally couldn't; risky because it bypasses encapsulation and access control.
6. Any three of: JSON/serialization libraries, ORMs, dependency-injection frameworks, test runners (JUnit/pytest), mocking libraries.
7. Rust follows a zero-cost philosophy and throws away most runtime type metadata; it uses compile-time macros / `#[derive(...)]` to generate the equivalent code.
8. The runtime resolves names dynamically and can't inline or optimize the call the way it does direct calls; there's lookup and indirection on every access.

</details>

---

## Cheat Sheet

| Want to… | Python | Go | Java | C# |
|----------|--------|----|----|----|
| Get the type | `type(x)` | `reflect.TypeOf(x)` | `x.getClass()` | `x.GetType()` |
| List fields | `x.__dict__`, `dir(x)` | `t.NumField()/t.Field(i)` | `c.getDeclaredFields()` | `t.GetProperties()` |
| Read a field by name | `getattr(x, "f")` | `v.FieldByName("F")` | `f.get(x)` | `p.GetValue(x)` |
| Write a field by name | `setattr(x, "f", v)` | `v.Elem().FieldByName("F").Set(...)` | `f.set(x, v)` | `p.SetValue(x, v)` |
| Check existence | `hasattr(x, "f")` | (loop / `FieldByName`) | try/catch `getField` | `t.GetProperty("F") != null` |
| Call a method by name | `getattr(x, "m")()` | `v.MethodByName("M").Call(...)` | `m.invoke(x)` | `m.Invoke(x, null)` |
| Read metadata | (decorators/attrs) | `f.Tag.Get("json")` | annotations | attributes |

**Rust:** no general runtime reflection — use `#[derive(...)]` / macros at compile time.

**Golden rules:** introspect before you intercede · reflection trades compile-time safety for runtime flexibility · cache handles in loops · keep it at the edges.

---

## Summary

Reflection is a program reading and manipulating its own structure — types, fields, methods — *at runtime*. It has two halves: **introspection** (read-only looking) and **intercession / dynamic invocation** (reading/writing fields and calling methods by name). You get a type handle (`type(x)`, `reflect.TypeOf`, `getClass`, `GetType`) and from it reach fields, methods, and metadata like Go struct tags or Java annotations.

You already depend on reflection: JSON libraries, ORMs, DI containers, and test frameworks all use it to work with types they've never seen. The price is real — lost compile-time safety, slower calls, harder debugging, and broken tooling — which is why Go uses it sparingly and **Rust avoids it entirely, preferring compile-time `derive` macros.** As a junior, your job is to *understand* the reflective magic in your tools, use reflection sparingly and at the edges, and remember the cardinal rule: introspect freely, intercede carefully.

---

## What You Can Build

- A tiny **object pretty-printer** that takes any value and prints every field name and value (Python `vars()` / Go `reflect`).
- A **simple JSON serializer** for flat structs, reading field names (and Go struct tags) via reflection — then compare your output to the standard library's.
- A **method dispatcher** that takes a command string and calls the matching method by name (`getattr(handler, cmd)()`).
- A **"@test" discoverer**: scan a class for methods whose name starts with `test_` (Python) or carry a `@Test`-style marker, and run them.
- A **field validator** that walks a struct's tags (`validate:"required"`) and checks each field.

---

## Further Reading

- Your language's reflection documentation: Go `reflect` package overview ("The Laws of Reflection"); Java `java.lang.reflect` and the `Class` API; Python `inspect` module and the data model; C# `System.Reflection`.
- The source of your favorite JSON library — read how it walks fields. It demystifies "the magic" fast.
- For the Rust contrast: the Serde book and how `#[derive]` works.
- Continue to `middle.md` for performance, caching, Go settability in depth, and Python's `inspect` module.
