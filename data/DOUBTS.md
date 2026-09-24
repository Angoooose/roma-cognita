# Historical doubts, parked

A backlog of historical questions, deliberately left until later (decided
2026-09-22). None of these block engine work. The **authoritative, always-current
list** is what `npm run data:validate` prints under NEEDS CHECK, UNCERTAIN and
NOT CHECKED. This file records what that output cannot: the likely errors
known so far, and how we plan to resolve the list.

## How they will be resolved

In batches. Claude researches each record and proposes a fix with a citation.
The user signs off on the batch. Each fix moves the record from
`review: needs-check` to `verified`.

## Likely errors

The reasoning is in each record's `note`.

- **Egypt is a client from 68.** Client standing is better dated from 59 or 55.
- *Fixed September 2026:* Cyprus now leaves Cilicia in 48 and is Ptolemaic
  from 47 (Dio 42.35); Judaea is a client from 63 and independent before;
  Galatia's and Emesa's seats are gone, because both are now drawn as
  territory.
- **"Royal seat" status is wrong in three places:**
  - Nicomedia: Bithynia was a province throughout.
  - Cirta: given to Sittius after 46.
  - Bibracte: the Aedui had no king.

## Known weak spots

- **Four weak extents:** Gallia Comata, Nabataea, Odrysian Thrace, and
  Ituraea's seat at Chalcis sub Libano, whose site is not securely identified.
- **Not yet checked by the validator:**
  - that atoms.geojson is what `npm run atoms` builds from atoms.yaml;
  - that places still match Pleiades.
  Atom overlap is now checked (September 2026).

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

- *Fixed September 2026:* Illyricum is a province from 59 on a coastal atom;
  the seat-only kingdoms except Osroene are drawn as territory; the
  twelve-vertex rings are gone (see below).
- *Fixed September 2026:* Lycia is drawn as the free Lycian League.

## Territory outlines (September 2026)

Every outline was rebuilt from the frontiers the cited works name
(atoms.yaml; `npm run atoms:preview -w pipeline` for the review plates). The
lines rest on these choices, each of which wants a reader's eye:

- **Conventions, not frontiers.** Numidia's and Mauretania's southern edges,
  Cyrenaica's, Egypt's and Nabataea's desert edges, Galatia's and Cappadocia's
  inner lines, Cilicia's northern edge, the Thracian kingdom and Illyricum's
  inland edge are drawn where authority faded; Bridoux says of the Numidian
  south that it was "probablement pas précisément établie".
- **One scholar's hypothesis.** Mauretania east of Cap Ténès to the Soummam
  (Desanges, accepted by Bridoux ¶102) is `uncertain`; Gsell's line at Cap
  Ténès is the cautious alternative.
- **The fossa regia south of Abthugni** follows Tissot's line along the
  sebkhas; Saumagne's is more westerly (Bridoux ¶133–134). The Tusca is the
  oued Zouara (Bridoux ¶127), not the oued el-Kebir Pleiades puts it at.
- **Citerior/Ulterior north of the Tagus** has an attested direction and no
  course (Richardson).
- **The Rubicon** is the modern Rubicone, whose identification is conventional.
- **Castabala** is both Tarcondimotus' seat and, in Strabo, a gift to
  Ariobarzanes; it is drawn with the Amanus.
- **Left unclaimed on purpose:** the Cottian and Maritime Alps and Raetia;
  Istria; the Cyclades, Lemnos and Imbros; the Tracheia west of Olba; Siwa and
  inner Sinai; the Propontic Greek cities; Gaul beyond the four peoples drawn,
  before 51; Osroene, which stays a seat; the Autrigones, Vascones and their
  neighbours between the Cantabri and Pompaelo; the steppe north of the Crimea.
- **Inside a larger atom:** Issa (Illyricum); the Suebi's third of the Sequani
  (BG 1.31).

## The neighbours of Rome (September 2026)

Added in one batch, each from the works it cites; the review plates are the
same `npm run atoms:preview -w pipeline`. What wants a reader's eye:

- **Extents that are conventions:** Dacia (Burebista's widest reach; Lockyear
  doubts any fixed extent), Noricum, the Garamantes, Kush's valley strip, the
  Caucasian kingdoms, Atropatene, Parthia beyond the frame, the Gallic peoples
  (after the later civitas lines, Fichtl), and the four Iberian peoples (after
  their Augustan conventus; Strabo's Melsus is taken as the Sella).
- **Dates that are conventions:** Dacia from c. 60; the Pontic cities free
  again in 43; Armenia a client from 66 even under Artavasdes II; Iberia and
  Albania clients from 65.
- **Doubtful standing:** the Seleucid claim on all of Syria in 68–65 (Antiochus
  XIII hardly ruled beyond Antioch); Chersonesus under the Bosporus to the end
  of the window (Caesar's grant of freedom c. 46 is argued, not drawn); Olba
  and Derbe as independent.
- **Pharnaces' occupation of 48–47** covers Pontus, Lesser Armenia and
  Deiotarus' Pontic lands; the part of Cappadocia he overran is not drawn.

## Sea names (September 2026)

- **Locators are to Pliny's book only.** The paragraph numbers are unchecked,
  hence `review: needs-check` on every sea.
- **Pliny wrote a century after our window.** The Republic's own usage was
  looser: Caesar has only "the Ocean" for the North Sea. The Barrington
  Atlas's forms are used throughout.
- **The courses are placement, not extent.** Where one sea ends and the next
  begins (Ionium against Siculum, Libycum against Aegyptium) is not claimed.
