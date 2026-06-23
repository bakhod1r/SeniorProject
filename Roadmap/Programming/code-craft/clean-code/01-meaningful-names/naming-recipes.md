# Naming Recipes

Status: ⏳ PENDING

Reusable name templates for common situations. When the rules in this chapter aren't enough on their own, reach for a recipe.

## Planned Recipes

- **Booleans** — `is*`, `has*`, `can*`, `should*`, `was*` — never `flag`, `status`, or `enabled` as standalone names
- **Async functions** — verb-noun (`fetchUser`, `loadConfig`, `saveOrder`) — avoid `getUserAsync`; the return type already tells the reader it is async
- **Collections** — plural noun for the collection (`users`), singular for elements (`user`); for maps name by intent (`usersById`, `priceByCurrency`)
- **Domain types over primitives** — `UserId` not `string`, `Money` not `int`, `Email` not `string` — wrap to prevent mix-ups
- **Test names** — `methodName_should_X_when_Y` or "describe + it" style — never `test1`, `testCase`
- **Test doubles** — match the role: `FakeRepo`, `StubClock`, `SpyEmailGateway`, `MockX` — don't call everything a Mock
- **Error types** — `NotFoundError`, `InvalidInputError`, `UnauthorisedError` — never `MyException`, `BusinessError`
- **Constants** — `SCREAMING_SNAKE_CASE` for module-level, regular casing for function-local; group related constants in an enum/object
- **Builder methods** — chained verbs that read like English (`.withTimeout(30)`, `.usingTLS()`, `.retryOn(5xx)`) — avoid `setX` chained
- **Factory functions** — `createX`, `makeX`, `xFromY` — pick one convention per project and stick with it
- **Event names** — past tense (`UserRegistered`, `OrderShipped`) for facts that happened; imperative (`SendEmail`, `ChargeCard`) for commands to perform
- **Pluralisation traps** — irregular plurals (`children`, `criteria`) and uncountable nouns (`information`, `feedback`) need explicit decisions documented per project

See the [chapter README](../README.md) for the underlying naming rules.
