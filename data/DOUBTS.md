# Historical doubts, parked

A backlog of historical questions, deliberately left until later (decided
2026-09-22). None of these block engine work. The **authoritative, always-current
list** is what `npm run data:validate` prints under NEEDS CHECK, UNCERTAIN and
NOT CHECKED. This file records what that output cannot: the likely errors
found during migration, and how we plan to resolve the list.

## How they will be resolved

In batches. Claude researches each record and proposes a fix with a citation.
The user signs off on the batch. Each fix moves the record from
`review: needs-check` to `verified`.

## Likely errors carried over from cicero-map

These were migrated unchanged so the migration could be checked year by year
against the old `control.json`. The reasoning is in each record's `note`.

- **Cyprus → Cilicia runs to 43 BCE.** Caesar is generally held to have
  returned Cyprus to the Ptolemies in 47 (Dio 42.35).
- **Egypt is a client from 68.** cicero-map's own note argues for 59 or 55.
- **Judaea is a client from 68.** Its own source dates Roman control from 63.
- **Galatia's seat is Ancyra.** Deiotarus' strongholds were Blucium and Peium.
- **Emesa's seat is Emesa.** Strabo puts Sampsiceramus at Arethusa.
- **"Royal seat" status is wrong in three places:**
  - Nicomedia: Bithynia was a province throughout.
  - Cirta: given to Sittius after 46.
  - Bibracte: the Aedui had no king.

## Known weak spots

- **Four extents flagged `check` in cicero-map:** Gallia Comata, Nabataea,
  Odrysian Thrace, and Ituraea's seat at Chalcis sub Libano.
- **29 records cite only cicero-map.** A reason was recorded but no published
  work. Each needs a real citation (Broughton, CAH, Barrington map numbers).
- **Not yet checked by the validator:**
  - that the atoms tile the land;
  - that the atoms do not overlap;
  - that the seed points still match AWMC;
  - that places still match Pleiades.

## Before extending the window to 133–27 BCE (step B3)

The window's edges are written `before 68 BCE` / `after 43 BCE`. Extending the
window means replacing each open end with a real date, which re-opens every
record above.
