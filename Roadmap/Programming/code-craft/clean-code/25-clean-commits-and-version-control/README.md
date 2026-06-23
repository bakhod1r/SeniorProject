# Clean Commits & Version-Control Hygiene

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

Clean code includes a clean **history**. This chapter covers the craft of the commit and the branch — atomic changes, messages that explain *why*, and a trail that stays bisectable and reviewable. Distinct from [Code Reviews](../17-code-reviews/README.md) (the etiquette and tempo of *reviewing*): this chapter is about the **shape of the record** you hand the reviewer and every future archaeologist of the codebase.

The positive rules will cover: one logical change per commit, a message that captures intent and context, short-lived branches, never rewriting shared history, and trusting version control instead of commenting out code.

## Anti-Patterns to Cover

- **"WIP", "fix", "stuff"** — commit messages that carry no context
- **Kitchen-sink commits** — one commit mixing formatting, a feature, and a refactor
- **What-not-why messages** — restating the diff the reader can already see, omitting the reason
- **Rewriting public history** — force-pushing a shared branch out from under collaborators
- **Committing generated files, secrets, or large binaries** into the tree
- **Long-lived feature branches** that drift weeks away from `main`
- **Merge noise** — repeated "merge main into branch" commits cluttering the history
- **Commented-out code** committed "just in case" instead of trusting version control to remember it

See the [chapter README](../README.md) for the positive rules.
