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
| `features.yaml`          | physical features: floodplains, the Nile delta branches, seas   |
| `geometry/features.geojson` | their shapes, lon/lat, keyed by id; floodplains derived; for seas, the course their name is lettered along |
| `known-world.yaml`       | how far Roman geography reached, as one coarse ring: where the map's colour stops; baked by `npm run known -w pipeline` |

Any of these may be split into `<entity>/*.yaml` once it grows; the loader reads both.

## Conventions

**Years are era strings.** `63 BCE`, `14 CE`, `c. 81 BCE`, a range
`{ earliest: 90 BCE, latest: 89 BCE }`, or an open end. Never a sign. The loader
converts to astronomical years (1 BCE = 0). Intervals are inclusive at both ends.

**Open ends.** `from: before 68 BCE` means _in force in 68 BCE, and started no later
than that_; `to: after 43 BCE` means _in force in 43 BCE, and ended no earlier_.
`before` is only ever a start and `after` only ever an end. An open end is a bound,
not a guess: it says strictly less than an exact year would.

**The year of a transition belongs to the successor.** Numidia is the kingdom's to
47 BCE and Africa Nova's from 46.

**Confidence is drawn; review is reported.** `confidence: certain | probable |
uncertain` is how firmly the sources support the record. `review: verified | draft
| needs-check` is the state of our work. Nothing has been re-verified in this
project yet, so nothing is `verified`.

**Every historical record cites at least one source**, by id, with a locator where
there is one. Reasoning that should survive goes in `note`.

**Geometry winding is RFC 7946** (counter-clockwise exteriors). The pipeline rewinds
at ingest and the validator asserts it. A consumer that wants the other convention
(d3-geo does) converts at its own boundary. cicero-map lost an afternoon to this.

## Provenance

Everything here was migrated from `cicero-map/data/*.json` in September 2026. The
judgement-heavy files were migrated by hand, row by row; `places.yaml` and
`geometry/atoms.geojson` by `pipeline/src/migrate/cicero-map.ts`, which is kept as
the record of what was done. The atom outlines were rebuilt from sources later
that month (Decision 6), and the claims changed with them. The migrated claims reproduce cicero-map's time series
exactly for every year 68–43 BCE (checked year by year against `control.json`).
Nothing was added to extend the data beyond that window.

## Decisions

Modelling choices DESIGN.md does not settle, with the reasoning. Each wants
confirming.

1. **Window edges became open ends.** cicero-map's `-68`/`-43` were its 68–43 BCE
   window, not events. Every row that started at −68 now reads `before 68 BCE` and
   every row that ended at −43 reads `after 43 BCE`. Under the "in force at that
   year" reading this is a faithful weakening of what cicero-map asserted, never a
   new claim — which is why it was done throughout rather than only where a note
   happened to support it. Rows starting or ending inside the window keep their
   exact year. A later curator extending to 133–27 BCE should treat every open end
   as a question.

2. **Where the true start is known but the atom is not the polity, the claim stays
   open.** Sicilia the province dates from 241 BCE (on the polity), but the atom is
   the whole island and Syracuse was an allied kingdom until 212/211, so the claim
   reads `before 68 BCE`, not `241 BCE`. Same rule for every province: `since`
   became the polity's `from`, never the claim's.

3. **Client kingdoms are three records, not one `kind`.** cicero-map's
   `kind: client` becomes (a) polity `kind: kingdom` — what the thing was; (b) claim
   `relation: client` on its ground — the register the map draws; (c) a
   `client-of rome` relation — the polity-level fact the "top-level power" mode
   joins on. (b) and (c) overlap by design; the validator warns when a client or
   province claim has no matching relation behind it. `kingdom` also covers the
   Levantine principalities, tetrarchies and phylarchies (Emesa, Ituraea).

4. **`citizen` became citizen territory, and Rome became a polity.** Polity
   `italia` is `kind: citizen-territory`, its claims are
   `relation: citizen-territory`, and it is `citizen-territory-of rome`. A polity
   `rome` (`kind: state`) was added as the other end of every relation; it holds no
   atoms directly. It is the only record with no counterpart in cicero-map.

5. **Claims overlap-check in two layers:** holding (province, citizen territory,
   client, allied, independent) and occupation. The Parthian occupation of Syria in
   40 BCE did not end the province; both rows can stand.

6. **Atom outlines are authored, not migrated** (rebuilt September 2026). The
   migrated outlines were AWMC's 60 BCE shading cut with straight lines, and
   twelve-vertex rings for the kingdoms; neither followed a frontier any source
   names, and AWMC's ODbL would not relicense. Each atom's `construction` is now
   an `outline` — vertices at places or features, joined straight, along a river
   (HydroRIVERS), along a range (the DEM) or by a curve for an unsurveyed zone —
   or a `box` round an island. `npm run atoms -w pipeline` resolves them, clips
   to Natural Earth land and cuts each earlier atom out of the next, so a shared
   frontier is authored once, by whichever atom comes first in atoms.yaml.
   `npm run atoms:preview -w pipeline` draws them over a hillshade for review.
   Evidence: `surveyed` for coasts and islands, `derived` where the line is
   reconstructed from named places, `schematic` where authority faded out.

7. **Atom confidence** is how far the outline can be trusted as the extent of
   what its claims say. Islands are `certain`; frontiers the sources name are
   `probable`; reconstructions resting on one scholar's hypothesis (Mauretania
   to the Soummam) or a convention (the Galatian and Cappadocian edges) are
   `uncertain`.

8. **cicero-map's `check` was split by what was in doubt.** For a polity whose
   existence is not in question but whose extent or standing is (Nabataea, Thrace,
   Ituraea, Emesa, Osroene, Cilicia Tracheia), the polity is `probable` and the
   relation, claim and atom are `uncertain`. Mauretania's doubt was only its internal
   arrangement, so it stays `probable` throughout. Gallia Comata, whose doubt is the
   date itself, is `uncertain` everywhere. All are `needs-check`.

9. **Free-text `source` fields were split.** Where cicero-map named a work (Broughton,
   CAH, Braund, Sullivan, Caesar, Barrington, Cicero, Dio …) it became a source
   reference with its locator. Where it gave a reason instead ("Pompey's
   annexation", "lex Clodia") the reason went into `note` and the record cites
   `cicero-map` itself. The validator lists all 29 such records: they want a real
   citation.

10. **Place prominence and status are dated values.** `prominence: 2` is shorthand
    for the place's whole interval; a dated list
    (`[{ value, from, to }]`) is there for a colony founded half way through. The
    loader always expands to the list. Tiers keep cicero-map's 1–4 meaning.

11. **Names are written inline** on polities, places and features and flattened by
    the loader into the §5.1 `name` entity, inheriting dates and sources from their
    target. Polity names are tagged `la`; place names are left untagged because
    cicero-map never recorded the language. cicero-map's `also` spellings are kept
    as non-preferred names.

12. **Rulers stay free text** (`ruler: Juba I, c. 60–46`) until they are records of
    their own; parsing them now would turn a label into dated claims nobody checked.

13. **Seats cite their polity's source** (cicero-map's seats had none) and take their
    position from their place, which is Pleiades' where joined. Two seat places
    (Hierapolis-Castabala, Chalcis sub Libano) had no place row and no Pleiades id;
    they were added with cicero-map's coordinates and `needs-check`.

14. **Places are `certain`** where cicero-map's Pleiades join landed within 28 km of
    the curated position — all 222 did. That is cicero-map's bargain (Pleiades'
    coordinate and id as truth), recorded rather than re-made.

15. **Floodplains are derived, not drawn** (September 2026). `kind: floodplain`
    records own names, dates and sources; their outlines are made from terrain by
    `npm run derive-floodplains -w pipeline` and committed. Per region: an authored
    loose hull (ours, over a DEM preview, never traced from the Barrington Atlas),
    channels, a threshold. The measure is height above the *floodplain surface
    beside* the nearest channel (the median of the DEM within ~1.3 km of it),
    not above its water: a modern river's water sits metres below its banks and an
    ancient dry branch has none, so a water datum made the delta lopsided again.
    Thresholds: Nile valley 8 m; delta 4 m (from the seven branches); Mesopotamia
    6 m plus a flatness test (≤ 0.06 %, closed by 3 km) because the Southern Desert
    rises too gently for height alone; Susiana 12 m; middle Euphrates 8 m; the
    Fayum an elevation band −2…+26 m (Ptolemaic lake level to canal command). The
    tool prints each area beside published figures — none of which has yet been
    checked against the work cited — and the check sites. Previews it renders are
    the review surface. Floodplain shapes are modern-coast: ancient coasts and
    lagoons are landscape-change work.

16. **The Nile delta branches are authored lines** (`kind: river`), waypoints in
    `pipeline/src/features/delta-branches.ts` with each coordinate's provenance
    (Pleiades id, modern channel point, or our routing point with a reason). Legs
    follow the modern Rosetta (HydroRIVERS), trace the modern Damietta in the DEM,
    or are splines through the sites. `properties.discharge` (m³/s) apportions the
    pre-dam mean ~2,800 m³/s among the mouths for line width only.

## Migration review: things that look wrong

Migrated as cicero-map had them, flagged `needs-check` with the reason in the note:

- **Cyprus → Cilicia runs to 43 BCE**, but Caesar is generally held to have returned
  Cyprus to the Ptolemies in 47 (Dio 42.35).
- **Egypt is a client from 68**, though cicero-map's own note argues for 59 or 55.
- **Judaea is a client from 68**, though its own source dates Roman control from 63.
- **Galatia's seat at Ancyra**: Deiotarus' strongholds were Blucium and Peium.
- **Emesa's seat at Emesa**: Strabo puts Sampsiceramus at Arethusa.
- **"Royal seat" status** on Nicomedia (Bithynia was a province throughout), Cirta
  (given to Sittius after 46) and Bibracte (the Aedui had no king).
