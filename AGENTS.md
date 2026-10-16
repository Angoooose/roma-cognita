# Roma Cognita

An interactive map of the Roman world, 133–27 BCE, that shows only what the
historical record can back up. Start with [README.md](README.md); the data and
its conventions are in [data/README.md](data/README.md), the design in
[DESIGN.md](DESIGN.md).

**Researching or citing a record:** follow [research/README.md](research/README.md).

**Checking research:** follow [research/CHECKING.md](research/CHECKING.md).

Run `npm run data:validate` after any change to `data/`.

**Seeing a visual change:** `npm run shot -- <view…> --out <your scratchpad>`
([scripts/shot.mjs](scripts/shot.mjs)). Take the same views with `--prefix before`
and `--prefix after` to compare them.

Code, comments, data notes and docs describe what is and why, never what
changed or when: no "previously", "now uses", "until October 2026" or dates of
our own edits. That belongs in the commit message.
