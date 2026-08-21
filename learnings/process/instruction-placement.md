# Instruction Placement

`AGENTS.md` and `CLAUDE.md` are read by every session; `learnings/` is read only
when the index routes you to it. So every rule this project adopts has to be
placed, and placing everything inline destroys the files while placing
everything behind a pointer means some rules never arrive. This document is the
test for deciding which.

## The test

> **Does the reader know they are in the situation the rule covers?**

If yes, a pointer works — the task announces itself, the reader follows the
index, and the rule arrives on time. If no, the pointer is useless *precisely
when it matters*, and the rule must be stated inline.

Importance is not the criterion, and neither is length. A critical rule with a
visible trigger is safely referenced; a small rule with an invisible trigger is
not.

### Visible trigger — reference it

The task itself tells you the rule applies:

- "Prove authority/projection/migration behaviour against real PostgreSQL." You
  know when you are touching the server.
- "Run `verify:push` and inspect the screenshots for anything that renders."
- "Compile-check every `.adl`/`.adlj` draft." You know when you wrote ADL.
- "A reference-app constraint change invalidates integration fixtures." You know
  when you edited a constraint.

### Invisible trigger — state it inline

The rule fires against your own confidence, or applies to everything so no
moment stands out:

- "Never assert what the running system does from having read the code." This
  fires exactly when you are certain you already understand. You feel no gap, so
  you never open the drawer the note is in.
- "Every positive test needs a matching negative test." What you are failing to
  notice is an *absence*. Nothing in the task points at it.
- "Never weaken a test to make verification pass." This fires when you are
  frustrated and the shortcut looks defensible.
- "A piped command reports its last stage's exit status." You believe you ran
  the check. You did. You read the wrong number.

Each of these has already gone wrong here with the rule written down and the
instruction to go and read it sitting in the loaded context.

## Two disciplines that keep the inline set small

**State the instruction, not the argument.** One or two lines, imperative. The
incidents, the reasoning and the per-subsystem detail live in `learnings/`, with
a pointer. A rule that needs eight lines inline has had its evidence pasted in
with it; move the evidence.

**Cap the inline set, and mean it.** `CLAUDE.md`'s Testing section holds at most
**five** inline rules. Adding a sixth means arguing one out, in the commit
message. This is the discipline that makes "concise" a design rather than an
aspiration: a file of thirty rules has none, because everything in it reads as
background.

## The tier above both

The best rules are in neither file, because they are **mechanical**. A hook that
refuses a piped test command, a lint, a CI check, or a compile-time diagnostic
needs no compliance from anyone and cannot drift. Phase 93 did exactly this: it
turned "watch out for an unreachable `ROLE` principal" — a learning that had
already failed to prevent a recurrence — into a validation diagnostic, and the
rule stopped needing a reader.

**Before placing a rule in prose, ask whether it can be enforced instead.** Most
cannot, which is why the test above still matters. But the ones that can should
never have been prose in the first place, and a prose rule that keeps being
broken is evidence that it wants to be mechanical.

## Applying it

When a new rule is adopted:

1. Can it be made mechanical? If so, do that instead and record the mechanism.
2. Is its trigger visible from the task? If so: full rule in `learnings/`,
   routed from `learnings/index.md`, stated in `AGENTS.md` only if it is a
   project rule rather than accumulated knowledge. No `CLAUDE.md` entry.
3. If its trigger is invisible: the evidence goes in `learnings/`, the rule is
   stated in `AGENTS.md`, and a one-line imperative goes in `CLAUDE.md` —
   against the cap.

Related: `process/evidence-by-execution.md` and `process/testing-expectations.md`
are both invisible-trigger rules and hold two of the inline slots.
