# Make the brief's shape a documented convention rather than a habit

Labels: P1, good-first-issue, milestone M4

## Scope

Every brief in this folder carries the same three things: a level-one heading that names the task, a
section that states its scope, and a section that states what done means in observable terms. That
shape is what makes a first contribution reviewable — the contributor and the maintainer agree on
done before any code exists — and today it is a habit rather than a documented rule. Your task is to
write it down where a contributor finds it and to make every brief in the folder satisfy it.

You write two things and nothing else.

1. **The convention, in `CONTRIBUTING.md`.** Add it to the contribution path the guide already lays
   out: a brief carries a title, a `Labels:` line naming its priority tier, its `good-first-issue`
   label and its milestone, a scope section stating what to add, where it sits and what must not
   change, and an acceptance section whose every item is observable — a command that exits 0, a
   response that carries a value, a diff that prints nothing. State the two rules that keep an
   acceptance note honest: an item says what to *run* or *read* rather than what to believe, and a
   brief never names a person as the assignee.
2. **The three elements, in every brief under this folder.** A brief that has grown a title and an
   acceptance note but no scope section, or the reverse, gets the missing one written in the folder's
   own voice. Do not rewrite a brief that already carries all three, and do not add a fourth
   convention on top of them.

**What not to add.** A fourth issue template in `.github/ISSUE_TEMPLATE/`: that directory holds
exactly three, one of them for standards proposals, and each maps to an intake route the governance
document describes. The brief's shape belongs in the contributor guide and in the briefs themselves,
not in a new template that a second place would have to keep in step. No new file in this folder
either: this folder's population is the plan's list of tasks, and a brief is added for a task rather
than for the template it follows. Nothing here describes the repository as certified, independently
verified or guaranteed to pass anything, and no brief, comment or example may name a real person,
brand, product, contact detail, credential or private project — no `@` in any string and no run of
five or more consecutive digits.

Read next: `CONTRIBUTING.md` for the contribution path, the pull-request checklist and the three
artefacts a pull request carries; the briefs in this folder for the shape in use, particularly
`docs/starter-tasks/new-standard-version-case-set.md`, which is the most thorough worked example;
`.github/ISSUE_TEMPLATE/` for the three intake routes that are not this one;
`apps/api/test/integration/repository-conventions.test.ts`, which is the suite that asserts the
folder's shape.

## Acceptance

1. `npm run test:integration -- --testNamePattern="repository conventions"` exits 0, which is the
   structural proof: the folder holds at least ten briefs and each of them carries a title, a scope
   and an acceptance note. That suite reads this folder, so a brief missing one of the three turns it
   red, naming the file and the missing element.
2. Every brief in the folder carries all three elements after your change, and the evidence is that
   suite's run rather than a reading: paste its output into the pull-request description.
3. `CONTRIBUTING.md` states the convention, and the statement is checkable rather than aspirational:
   it names the three elements, the `Labels:` line, and the rule that an acceptance item is
   observable. A reader who has only the guide can write a brief that passes the suite above.
4. Each acceptance item you added or rewrote names a command, a response or a diff. No item rests on
   a judgement — no "should look right", no "is clear", no "is documented" without the place to read
   it, because an acceptance item a reviewer cannot run is an item that gets waived.
5. `git diff --stat -- .github/ISSUE_TEMPLATE` prints nothing: the three intake templates are
   untouched and no fourth was added. Paste that empty output into the pull-request description.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
