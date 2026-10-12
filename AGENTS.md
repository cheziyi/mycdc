# Working in this repository

Thanks for helping out. This file is for anyone changing the code or the docs,
whether you're a person or a coding agent. It covers how things are written
here, so the project keeps reading like one person wrote it.

Two other files are worth knowing about. [README.md](README.md) has everything
you need to run and deploy the project. [DESIGN.md](DESIGN.md) explains the
decisions that took some back-and-forth, so please read the relevant part
before changing the code it covers.

## If you're a coding agent

- **Put a standing instruction in this file, not in agent memory.** This file
  reaches every agent and every contributor. Memory reaches one agent on one
  machine.
- **Only write down rules that bind future work.** An instruction for one task
  gets carried out in that task and isn't recorded here. Neither is the story
  of how a rule came about.

## Before you write code

- **Check what the platform already does.** Read what a library or the Workers
  runtime gives you before writing code to do the same thing.
- **Keep it thin.** KISS and YAGNI both apply.
- **Delete anything you didn't end up using.**
- **Add a dependency only when it earns more than it replaces.**
- **Give every configuration value a reason.** Keep a tool's default unless
  something specific forces a change, and write the reason in a comment beside
  the value. Where the format takes no comment, such as `package.json`, put the
  reason in `DESIGN.md`.
- **Build only what's confirmed.** Call a CDC endpoint or read a reply field
  only when you know its exact request and reply. Please don't ship a guess.

## Identifiers that must keep their value

Each of these is read by something outside the code that holds it, so changing
one has a consequence. Change it only when you mean that consequence.

| Identifier | Where | What changing it does |
| --- | --- | --- |
| `HKDF_INFO`, the blob layout | `src/ecies.ts`, `public/app.js` | Breaks every calendar link already added. The two files must agree |
| The `creds` query parameter, and the `id` and `pw` keys inside the blob | `src/ecies.ts`, `src/index.ts`, `public/app.js` | Breaks every calendar link already added |
| `SALT`, the `#0` suffix and the byte offsets | `src/device.ts` | Gives every learner a different device identity |
| The `@mycdc` suffix of an event `UID` | `src/ical.ts` | Makes every subscribed calendar create each event again |

## Keeping the page and the code in step

`public/index.html` tells visitors what the site does with their password. So
when you change that behaviour, please change the page in the same commit.

- **Name every third-party host and every cookie the page causes** in the FAQ
  answer to "Does this site use cookies?".
- **State every cache and its lifetime** under "How you're protected".
- **Keep the two facts under "Two things to know"**: the server reads the
  password while it signs in, and a link shows the bookings to whoever holds
  it.
- **Keep the FAQ and its JSON-LD copy word for word the same.**
- **Keep the provenance note first on the page, and its repeat in the footer.**
- **Give the page no name, wordmark or logo.** The domain is this site's only
  name, and it appears only as an address. Never reproduce CDC's logotype, and
  load nothing from CDC's domains.

## Comments

- **Comment only the gotchas.** A comment explains behaviour the reader can't
  see from the code. If it restates the line below it, delete it.
- **Write a gotcha on an export as `/** */`, not `//`**, so that it shows up in
  a caller's editor. Write it as prose, without `@param` or `@returns` tags.
- **State an optional option's default in its `/** */`**, as a sentence:
  `Defaults to 60.`
- **There are two markers, each with its own meaning.** Capitalise the marker,
  and write the text after it as a full sentence.
  - `// TechDebt:` marks a shortcut taken because doing it properly isn't worth
    it today. Say what was cut short, why that's fine for now, and what would
    pay it back. That reasoning stays with the marker and never moves to
    `DESIGN.md`.
  - `// TODO:` is work not yet done, due as a next step.

## Names

- **Spell names out.** Write the full descriptive name unless the abbreviation
  is the better-known spelling: `UUID`, not `universallyUniqueIdentifier`, but
  `Configuration`, not `Config`. A name that CDC's API or a wire format defines
  keeps its spelling, such as `SesEndtime`, `device_uid` or `creds`.
- **Name a file for what it exports.** Keep the name singular unless the
  export's own name is plural.
- **A function is its verb plus the bare noun**: `signIn`, `buildCalendar`.
- **A constant holding several values is plural**: `TRANSIENT_CODES`.
- **An options type is its function's name plus `Options`**:
  `BuildCalendarOptions`.
- **A name carrying a unit spells it after `In`.** Milliseconds abbreviates to
  `Ms`: `REQUEST_TIMEOUT_IN_MS`, `FRESH_LIFETIME_IN_SECONDS`, `alarmInMinutes`.

## Writing for people

This applies to the page, the docs, commit messages and pull requests.

- **Write to the reader as "you", and sound like a friendly person.** Use
  contractions and everyday sentences. A short sentence of welcome or context
  is fine where it helps someone find their feet.
- **Keep the technical word when it's the accurate one.** Say "encrypt" and
  "decrypt", not "lock" and "unlock". Readers know these words, and they read
  better.
- **Reassure with facts.** State a limit once, calmly, next to what the reader
  can do about it. Leave out a caution the reader can't act on, and don't ask
  visitors to do checking that takes effort and proves little.
- **Friendly isn't the same as long.** Lead with what the reader can do, prefer
  a table or a code block to a paragraph of detail, and cut any sentence nobody
  would miss.
- **Say who does what, in order.** "CDC answers 206, so `call` asks again", not
  "a 206 is retried".
- **Call a thing what the code calls it.** Name the function, the endpoint or
  the check, so the reader doesn't have to translate a metaphor first.
- **Give a heading the name of what's under it.** "Caching", not "Behaviour
  worth knowing".
- **Describe CDC's API in its own terms.** Code, comments, docs and commit
  messages state what the API accepts and what it returns. Cite no other app or
  tool as the source of a behaviour.
- **Give each fact one home.** Explain it where it's decided, and link to that
  from everywhere else.
- **Record a decision where it'll be read again.** When you built an
  alternative and rejected it, write it up in `DESIGN.md`: what you chose, what
  you tried, and what settled it. The README links to it in one line and
  carries none of the argument.

## Pull requests

- **A person merges, and a person deploys.** A push to `main` deploys the
  Worker, so please don't push to `main` or merge a pull request unless you've
  been asked to.
- **Resolve a review thread once its fix is pushed**, with the GraphQL
  `resolveReviewThread` mutation. Leave a thread open only while it's
  unaddressed or waiting on a person's decision.
