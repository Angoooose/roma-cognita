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

## Floodplains and the Nile branches (September 2026)

All `review: draft`. The derivation prints the live list; the standing ones:

- **Published areas are unchecked.** Butzer 1976 (Egypt), Adams 1981
  (Mesopotamia) and the Ptolemaic Fayum figures are cited as "usually cited";
  nobody has opened the books. Egypt comes out ~35,000 km² against the
  22,000–34,000 range, mostly because the delta polygon includes the northern
  lagoon margins that were marsh in antiquity.
- **Fayum lake level** (−2 m) and the canal-command bound (+26 m) are single
  numbers for a lake that moved during the window.
- **Gulf coast**: Mesopotamia and Susiana stop at the modern coast.
- **Branch courses** between sites are splines; Sebennytic lower course,
  Mendesian and Tanitic are `uncertain`. Where the Canopic leaves the Rosetta is
  our choice.
- **Hull edges that are boundaries, not terrain**: valley/delta at Memphis,
  Fayum/valley at Hawara, Mesopotamia/Susiana, Susiana's south-east.

## Seen on the political map (September 2026)

Drawing the data exposed these. None is a drawing bug.

- **Illyricum is unclaimed.** The Dalmatian coast is plain land in every year,
  but it went with Gallia Cisalpina under Caesar. It needs an atom and claims.
- **The seat-only kingdoms draw nothing.** Galatia, Cappadocia, Commagene,
  Judaea, Emesa, Osroene, Ituraea and Cilicia Tracheia are `seats.yaml`
  records. Seat markers are not drawn yet, so central Anatolia reads as empty.
- **The schematic outlines are placeholders.** Mauretania, Numidia, Egypt,
  Nabataea, Bosporus and Thrace are the twelve-vertex rings drawn in
  cicero-map. The soft schematic styling helps, but they still read as
  polygons. Phase 2 replaces them.
- **Lycia is unclaimed** (the gap in south-west Anatolia). In this period it
  was a free league, so that may be right, but nobody has decided it.

## Sea names (September 2026)

- **Locators are to Pliny's book only.** The paragraph numbers are unchecked,
  hence `review: needs-check` on every sea.
- **Pliny wrote a century after our window.** The Republic's own usage was
  looser: Caesar has only "the Ocean" for the North Sea. The Barrington
  Atlas's forms are used throughout.
- **The courses are placement, not extent.** Where one sea ends and the next
  begins (Ionium against Siculum, Libycum against Aegyptium) is not claimed.
