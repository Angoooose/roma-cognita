# data/

Hand-authored records (YAML) and geometry (GeoJSON). The schema is
`packages/schema`; the rules are `pipeline/src/rules.ts`; check everything with

```bash
npm run data:validate
```

which exits non-zero on any error and prints what the data itself is unsure of.

| file                     | what                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `sources.yaml`           | every cited work and dataset, with licences for datasets        |
| `atoms.yaml`             | ground that never subdivides: evidence, how it was built        |
| `geometry/atoms.geojson` | the atoms' outlines, built from atoms.yaml by `npm run atoms -w pipeline`; lon/lat, RFC 7946, keyed by id |
| `polities.yaml`          | political units, with dated names                               |
| `claims.yaml`            | the time series: atom × polity × relation × interval            |
| `relations.yaml`         | polity-to-polity links over time (`province-of`, `client-of`)   |
| `seats.yaml`             | kingdoms drawn as their capital because their extent is unknown |
| `places.yaml`            | settlements, joined to Pleiades, with prominence and status     |
| `places/rome.yaml`       | the places of the model of Rome: monuments, river, streets, hills and quarters (tier 5, `within: roma`), dated from Platner & Ashby (DESIGN §7.7); the Servian Wall's course is SITAR's (`geometry/rome-servian.geojson`, `pipeline/src/rome/servian.ts`), the generated city `pipeline/src/rome/model.ts` |
| `features.yaml`          | physical features: floodplains, the Nile delta branches, seas   |
| `geometry/features.geojson` | their shapes, lon/lat, keyed by id; floodplains derived; for seas, the course their name is lettered along |
| `geometry/rome.geojson`  | those monuments' outlines, lon/lat, keyed by id; fetched from the OpenStreetMap elements each record cites by `npm run rome:fetch -w pipeline`, never edited by hand; baked by `npm run rome -w pipeline` |
| `geometry/rome-grounds.geojson` | the outlines of the gardens, groves and burial ground round Rome (kinds `garden`, `grove`, `cemetery` in places/rome.yaml), lon/lat, RFC 7946, keyed by id; drawn by hand from the bounds their sources give, each saying what it follows in `drawn`; approximate, not surveyed |
| `geometry/rome-sitar.geojson` | the pieces of excavated street in and round the Servian Wall that may have stood in 68–27 BCE, from SITAR (CC BY-SA 4.0), keyed by SITAR's number, with their dates; fetched by `npm run rome:sitar -w pipeline`, never edited by hand |
| `geometry/rome-servian.geojson` | the Servian Wall from SITAR (CC BY-SA 4.0), keyed by SITAR's number: its reconstruction of the whole course (19694), and the pieces of the wall, the agger, its ditch and its gates that were found, with how well each is placed; fetched by `npm run rome:sitar -w pipeline`, never edited by hand |
| `geometry/rome-roads.geojson` | the finds and reconstructions of the consular roads out of Rome that `pipeline/src/rome/roads.ts` cites, from SITAR (CC BY-SA 4.0), keyed by SITAR's number, with their dates and whether each is a survey or a reconstruction (SITAR's courses of the Via Flaminia, 16890; the Appia's first mile, 19681; the Latina, 19682); fetched by `npm run rome:sitar -w pipeline`, never edited by hand |
| `road-corrections.yaml`  | corrections to Itiner-e's dating of its roads: a line the source leaves undated, or dates by a later paving, dated from when the sources show the road in use; applied by `npm run roads -w pipeline` |
| `geometry/rome-levels.geojson` | heights (m above the sea) SITAR records on ground walked on, floors, paving and streets, in a phase between 400 BCE and 150 CE, and those the corrections of Rome's valley floors cite (pipeline/src/rome/ground.ts); CC BY-SA 4.0; fetched by `npm run rome:sitar -w pipeline`, never edited by hand |
| `known-world.yaml`       | how far Roman geography reached, as one coarse ring: where the map's colour stops; baked by `npm run known -w pipeline` |
| `landscape-changes.yaml` | dated corrections to the modern coast, lakes and canals (DESIGN §6.1): where the landscape of 133–27 BCE differed from today's, how, and on whose authority; applied by the coast build |
| `geometry/landscape-changes.geojson` | their shapes, lon/lat, keyed by id; written by the generators in `pipeline/src/landscape` (`npm run derive-coasts -w pipeline`), never edited by hand |
| `dprr-provinces.yaml`    | how DPRR's provinces line up with our polities, so a province can show who governed it; names DPRR's provinces and nothing else of DPRR's (see People) |
| `passages.json`          | the passages each ancient text's English page has an anchor for, so a citation can link to the passage; written by `npm run passages:fetch -w pipeline`, never edited by hand |

Any of these may be split into `<entity>/*.yaml` once it grows; the loader reads both.

## Conventions

**Years are era strings.** `63 BCE`, `14 CE`, `c. 81 BCE`, a range
`{ earliest: 90 BCE, latest: 89 BCE }`, or an open end. Never a sign. The loader
converts to astronomical years (1 BCE = 0). Intervals are inclusive at both ends.

**Open ends.** `from: before 68 BCE` means _in force in 68 BCE, and started no later
than that_; `to: after 27 BCE` means _in force in 27 BCE, and ended no earlier_.
`before` is only ever a start and `after` only ever an end. An open end is a bound,
not a guess: it says strictly less than an exact year would.

**The year of a transition belongs to the successor.** Numidia is the kingdom's to
47 BCE and Africa Nova's from 46.

**Confidence is drawn; review is reported.** `confidence: certain | probable |
uncertain` is how firmly the sources support the record. `review: verified | draft
| needs-check` is the state of our work. Nothing has been re-verified in this
project yet, so nothing is `verified`.

**Every historical record cites at least one source**, by id, with a locator where
there is one. Reasoning that should survive goes in `note`. What the record said
before research changed it goes in the commit message, not in `note`: the note is
about the past, and git keeps the history of our work on it.

**A citation that was read carries its quote.** `quote` holds the words relied on,
`supports` the record's fields they state, and `url` the page they were read on
when it isn't the passage the locator links to. The validator finds each quote in
its text and counts how many records are backed; how to research a record is
[research/README.md](../research/README.md).

**An ancient text's locator links to the passage.** Write it the way the text is
normally cited ("16.2.10", "Mithr. 114", "Pompey 34–35", "2.43 M"), and the
inspector opens an English translation at that place, mostly on ToposText.
`pipeline/src/passages/works.ts` says which page holds each work and how it
numbers its passages. `npm run passages:fetch -w pipeline` records the anchors
each page has, and the validator warns about a locator it can't find a place for.
A new ancient source needs an entry in works.ts and a re-fetch.

**Geometry winding is RFC 7946** (counter-clockwise exteriors). The pipeline rewinds
at ingest and the validator asserts it. A consumer that wants the other convention
(d3-geo does) converts at its own boundary.

## Scope

The data covers 133–27 BCE: from Tiberius Gracchus' tribunate and Attalus'
bequest to the settlement of January 27. Every citation was checked against its
text independently of the research that made it; what the checks left open is in
DOUBTS.md. Nothing reaches back before 133 yet.

## Decisions

Modelling choices DESIGN.md does not settle, with the reasoning. Each wants
confirming.

1. **Window edges are open ends.** A row in force at the window's start reads
   `before 133 BCE` and one still in force at its end reads `after 27 BCE`: in force
   at that year, extent beyond it not stated. Rows starting or ending inside the
   window carry their exact year. Anyone extending the window should treat every
   open end as a question. An open end inside the window is one the sources
   bound no further: the Kushite hold on Lower Nubia reads `before 68 BCE`,
   because nothing dates it earlier.

2. **Where the true start is known but the atom is not the polity, the claim stays
   open.** Sicilia the province dates from 241 BCE (on the polity), but the atom is
   the whole island and Syracuse was an allied kingdom until 212/211, so the claim
   reads `before 133 BCE`, not `241 BCE`. Same rule for every province: the date of
   creation is the polity's `from`, never the claim's.

3. **Client kingdoms are three records.** (a) polity `kind: kingdom` — what the
   thing was; (b) claim `relation: client` on its ground — the register the map
   draws; (c) a `client-of rome` relation — the polity-level fact the "top-level
   power" mode joins on. (b) and (c) overlap by design; the validator warns when a
   client or province claim has no matching relation behind it. `kingdom` also
   covers the Levantine principalities, tetrarchies and phylarchies (Emesa,
   Ituraea).

4. **Citizen territory is a polity, and so is Rome.** Polity `italia` is
   `kind: citizen-territory`, its claims are `relation: citizen-territory`, and it
   is `citizen-territory-of rome`. A polity `rome` (`kind: state`) is the other end
   of every relation; it holds no atoms directly.

5. **Claims overlap-check in two layers:** holding (province, citizen territory,
   client, allied, independent) and occupation. The Parthian occupation of Syria in
   40 BCE did not end the province; both rows can stand.

6. **Atom outlines are authored.** A shaded atlas such as AWMC's 60 BCE map
   follows no frontier any source names, and AWMC's ODbL would not relicense, so
   each atom's `construction` is an `outline` — vertices at places or features,
   joined straight, along a river (HydroRIVERS), along a range (the DEM) or by a
   curve for an unsurveyed zone — or a `box` round an island. `npm run atoms -w pipeline` resolves them, clips to Natural Earth land
   and cuts each earlier atom out of the next, so a shared frontier is authored
   once, by whichever atom comes first in atoms.yaml.
   `npm run atoms:preview -w pipeline` draws them over a hillshade for review.
   Evidence: `surveyed` for coasts and islands, `derived` where the line is
   reconstructed from named places, `schematic` where authority faded out.

7. **Atom confidence** is how far the outline can be trusted as the extent of
   what its claims say. Islands are `certain`; frontiers the sources name are
   `probable`; reconstructions resting on one scholar's hypothesis (Mauretania
   to the Soummam) or a convention (the Galatian and Cappadocian edges) are
   `uncertain`.

8. **Doubt is split by what is in doubt.** For a polity whose existence is not in
   question but whose extent or standing is (Nabataea, Thrace, Ituraea, Emesa,
   Osroene, the Amanus), the polity is `probable` and the relation, claim and atom
   are `uncertain`. Mauretania's doubt is only its internal arrangement, so it
   stays `probable` throughout. Gallia Comata, whose doubt is the date itself, is
   `uncertain` everywhere. All are `needs-check`.

9. **Every citation is to a work.** A record whose date rests on an event
   ("Pompey's annexation", "the lex Clodia") cites the ancient text that reports
   it, with its locator, and keeps the event in `note`.

10. **Place prominence and status are dated values.** `prominence: 2` is shorthand
    for the place's whole interval; a dated list
    (`[{ value, from, to }]`) is there for a colony founded half way through. The
    loader always expands to the list. Tiers run 1–4 for settlements (see
    places.yaml) and 5 for a city plan's monuments. A monument's `condition`
    (`under construction`, `being finished`, `burnt`, `standing`) is a dated value
    the same way; `being finished` is for work a source puts on a building after its
    dedication, and a works span may say what of the old building it `kept`
    (`footings`, `podium`, `walls`).

11. **Names are written inline** on polities, places and features and flattened by
    the loader into the §5.1 `name` entity, inheriting dates and sources from their
    target. Polity names are tagged `la`; place names are left untagged until
    their language is recorded. Other spellings are kept as non-preferred names.

12. **Rulers stay free text** (`ruler: Juba I, c. 60–46`) until they are records of
    their own; parsing them now would turn a label into dated claims nobody checked.

13. **Seats cite their polity's source** and take their position from their place,
    which is Pleiades'.

14. **Places are `certain`** where matched to their Pleiades entry, taking
    Pleiades' coordinate and id as truth.

15. **Floodplains are derived, not drawn.** `kind: floodplain`
    records own names, dates and sources; their outlines are made from terrain by
    `npm run derive-floodplains -w pipeline` and committed. Per region: an authored
    loose hull (ours, over a DEM preview, never traced from the Barrington Atlas),
    channels, a threshold. The measure is height above the *floodplain surface
    beside* the nearest channel (the median of the DEM within ~1.3 km of it),
    not above its water: a modern river's water sits metres below its banks and an
    ancient dry branch has none, so a water datum would make the delta lopsided.
    Thresholds: Nile valley 8 m; delta 4 m (from the seven branches); Mesopotamia
    6 m plus a flatness test (≤ 0.06 %, closed by 3 km) because the Southern Desert
    rises too gently for height alone; Susiana 12 m; middle Euphrates 8 m; the
    Fayum an elevation band up to +26 m (canal command), below which Lake Moeris cuts it. The
    tool prints each area beside published figures — none of which has yet been
    checked against the work cited — and the check sites. Previews it renders are
    the review surface. Floodplain shapes stop at the coast the map draws: the
    modern one with the landscape corrections applied (the ancient coasts, lakes
    and lagoons of landscape-changes.yaml, derived by
    `npm run derive-coasts -w pipeline`), so they are rederived after a shore changes.
    After a shore changes the order is: derive-coasts, derive-floodplains, then
    the coast mask (npm run water) and what reads it (politics, labels).

16. **The Nile delta branches are authored lines** (`kind: river`), waypoints in
    `pipeline/src/features/delta-branches.ts` with each coordinate's provenance
    (Pleiades id, modern channel point, or our routing point with a reason). Legs
    follow the modern Rosetta (HydroRIVERS), trace the modern Damietta in the DEM,
    or are splines through the sites. `properties.discharge` (m³/s) apportions the
    pre-dam mean ~2,800 m³/s among the mouths for line width only.

17. **Occupation follows the successor rule too.** A row in the occupation layer
    ends the year before the occupier was driven out: Labienus' occupation of
    Asia and Pacorus' of Syria are 40–40, because Ventidius recovered both in 39.
    Pharnaces' 48–47 is the one row that does not (DOUBTS.md).

18. **A Roman commander holding ground against Rome is a `command`.** Sextus
    Pompeius in Sicily, Sardinia and Corsica (43–37) is polity `kind: command`, and
    his rows are `occupied`: the provinces under him never stopped being
    provinces. The Liberators and the triumvirs are not polities; which triumvir
    held which province is not modelled.

19. **When a province is first attested, not founded, the claim moves at the
    attestation.** Achaea and Creta et Cyrenae are both first firmly attested in the
    settlement of 27, though each may be older; the polity carries a fuzzy start,
    and the ground passes to it at 27. A fuzzy end on a polity would push its
    claims inside its earliest bound (the validator reads the earliest year), so
    where the end is disputed (Africa Nova, 36–28) the polity and its claims keep
    the latest date and the note carries the rest.

20. **An atom is split only where a source dates a change of hands at that
    grain.** Atoms cut from a larger one — such as Thessaly and southern Epirus, the Iapydes, inner Pontus, Lycaonia, northern Pisidia, Rough
    Cilicia, Lower Nubia (the Triacontaschoenus), Tyre, Sidon, the Phoenician and
    Palestinian coasts, Strato's Tower, Gaza, Samaria, Gadara with Hippos, and
    Jericho — carry copies of their parent's earlier claims, so the years
    before the split draw as the parent. A child that leaves its parent standing
    does not use `splitFrom`, which means the parent is gone.

21. **Disputed creations of 27 are not drawn.** Lusitania and Baetica, and the
    three Gauls, are dated by Dio to 27 and by most modern work to 16–13; the two
    Spains and Gallia Comata are kept whole to 27, and the dispute is in their notes.
    Mauretania after Bocchus (33) is drawn as a province, uncertain, because Dio's "enrolled among the provinces" (49.43.7) is the one
    explicit statement.

22. **Italy before the Social War is three polities.** Before
    90 the single `italia` atom could not stand: its ground was Roman citizen land
    and allied land, which the Social War enfranchised piece by piece in 90–87.
    Ten atoms are cut from `italia`, and Cispadana from `cisalpina`, at the grain
    the war and its laws date (Beloch 1880; DOUBTS.md), each carrying `italia` from its own year on, so from 87 the map
    reads ITALIA whole. Before that: `ager-romanus` (citizen territory of
    Rome, to 91); `socii`, one league for every allied community, `subject-of
    rome`, so it draws as a washed shade of Rome (the allies had no right of war
    and peace and owed troops under the formula togatorum; one polity, because
    Rome's treaties were with some 150 communities and no source draws the
    peoples' frontiers); and `italici`, the insurgents of 91–88, `independent`,
    in a colour of their own. Their own name, Italia, is kept as a non-preferred
    name so the map never letters two ITALIAs at once. A Latin colony is a place
    status, `colonia latina`, not ground; the old Latin colonies' people became
    citizens under the lex Iulia of 90, Cremona and Aquileia beyond the Po
    included (Beloch 27). The Transpadane communities are the exception: Latins
    by the lex Pompeia of 89 (Asconius, Pis. 3 C; Beloch 26–27), still not
    citizens in 65 (Dio 37.9.3), and enfranchised by Caesar in 49 (Dio
    41.36.3). The "municipium from 89" of towns such as Pompeii or Asculum
    rests on the general laws of 90–89, not on a text naming the town.

23. **A rising that held towns but no territory is a seat.** Aristonicus
    (133–130) and the slave kings of Sicily (Eunus at Enna, Tryphon at Triocala)
    are drawn at their strongholds (`seats.yaml`): their power inside a province
    is not recorded at any grain that could be drawn, and the province under them
    went on being one.

24. **A king who was Rome's friend and ally but no client is `allied`** — Pontus to
    90 (Appian's "friendship and alliance") — and **a Roman general's hold on
    conquered ground before any settlement is Rome's occupation**: Lucullus' of
    Pontus in 72/71–69, which no commission organised until 67, is a row in the
    occupation layer by polity `rome`, over the kingdom's own.

## People

The people on the map, and who governed each province, come from the Digital
Prosopography of the Roman Republic (DPRR, King's College London), which is
CC BY-NC 4.0. That licence cannot be merged with this directory's CC BY-SA:
share-alike would relicense DPRR's material on terms that allow commercial use,
which NC forbids. So the two are kept apart:

- DPRR's data is fetched and built locally into `build/people/`, with DPRR's
  licence beside it (`pipeline/src/people/`). **No DPRR fact is written into
  `data/`.**
- What we author about DPRR is ours and lives here. `dprr-provinces.yaml`, which
  lines up DPRR's provinces with our polities, refers to DPRR only by its province
  names, and every judgement in it rests on the sources it cites.
- Every person panel credits DPRR, links the person's DPRR page and its licence,
  and says the data was normalised.

## Open doubts

What looks wrong or rests on weak ground is listed in DOUBTS.md.
