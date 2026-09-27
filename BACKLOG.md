# Backlog

Work that was deliberately deferred, and why. When an item is picked up, delete
it from this list and put its reasoning in DESIGN.md or the code.

Historical questions live separately, in [data/DOUBTS.md](data/DOUBTS.md).

## Deferred

### Modern ponds in HydroLAKES

- Lakes now appear only once they are ~3×3 texels at the current level. That
  removed the overview speckle.
- Up close, thousands of small, largely modern steppe ponds (Ukraine, southern
  Russia) still draw as water.
- Separating natural lakes from modern ponds needs a better source or hand
  curation. It belongs with the `landscape-change` records.

### Aral Sea is drawn at its modern extent

- It is outside the frame (it only shows in the margin), but it is the
  shrunken 21st-century lake.
- Fix it with a `landscape-change` record, or by treating the margin as
  parchment in the paper tier.

### More landscape corrections

- Done: the Suez Canal, the Corinth Canal and Lake Tharthar are `remove-water`
  records (`data/landscape-changes.yaml`), applied by the coast build.
- Next batch: the Latmian Gulf, Ostia and the Tiber mouth, the Po delta, the
  Fucine Lake, Lake Copais, the Pontine Marshes, and the Nile lagoons (Mareotis,
  Manzala).
- A correction that begins or ends inside the window (the Latmian Gulf silting,
  for one) needs per-year variants of the affected mask tiles. v1 bakes one
  landscape for the whole window.

### Smooth modern cuts out of the terrain

- **Decided:** 2026-09-23, deferred.
- The canal corrections remove the _water_, but the elevation data (Copernicus
  GLO-30 via Mapterhorn) still records the dug channel and its embankments. The
  Suez Canal shows as a long straight dip with banks either side, and the
  Corinth Canal as a deep cut through the isthmus: visible in the hillshade, and
  obvious when the camera tilts.
- **Fix:** give `remove-water` records, or a new `fill-terrain` op, a terrain
  effect. Inside the corridor the worker replaces height with a surface
  interpolated from the ground on either side, feathered at the edge so the
  seam does not show. The same mechanism would flatten other modern earthworks
  if they turn out to matter: Tharthar's embankments, dams, motorway and
  railway cuts.
- Needs the corrections to reach the terrain worker, not just the coast build.
  Either bake a small "terrain patch" texture alongside the mask, or send the
  corridor polygons to the worker.

### River courses are modern

- HydroRIVERS traces today's courses from a 15″ DEM.
- The Nile delta gets its seven ancient branches as authored `river` features
  (the floodplain work). The modern Rosetta channel still draws alongside them
  until the delta's modern channels are suppressed.
- Other known differences need `river-course` records: the Po, the Euphrates
  at Babylon, and the Maeander into the Latmian Gulf.

### River precision at regional zoom

- HydroRIVERS is grid-derived (~450 m); smoothing hides the stair-steps but
  not the imprecision.
- For the rivers that matter most at regional zoom (Tiber, Arno, Po, Rhône,
  Nile), OSM waterways would be exact. Worth doing for a curated list, not
  wholesale.
- **At Rome** the drawn river runs ~150 m west of its real course. On the model
  of Rome (DESIGN §7.7) the board draws OSM's outline of the Tiber in its place;
  elsewhere at regional zoom the offset remains.

### Political layer, left for later

- **Built:** fills, borders, glow, the year tables and cross-fade, the timeline
  and the click inspector (DESIGN.md §7.3).
- **Seat markers**: built (§7.4).
- **Occupation** (`relation: occupied`, e.g. Parthia in Syria in 40 BCE). The
  shader draws the holding layer only; occupation wants hatching over it.
- **Picking against relief.** Picking uses the flat plane, so at steep tilt it
  can miss by a few kilometres near a border.
- **Curved territory labels**: built (§7.5).

### After the extension to 27 BCE

- **Who held which province under the triumvirs.** Bononia, Philippi,
  Brundisium, Misenum and Tarentum moved provinces between Antony, Octavian,
  Lepidus and Sextus Pompeius. They are portfolios inside one Roman state, not
  polities, so they want a small dated table of their own (province, commander,
  interval, sources) and a map mode that colours by it. The research for it is
  done; the table is not written.
- **Places of 43–27.** Nicopolis (31/29), Siscia, Metulum, Promona, the western
  Pontic cities (a distinct id for Pontic Apollonia), the Augustan colonies of
  Mauretania and Gaul (Zilil, Banasa, Baeterrae, Arausio, Forum Iulii), and the
  Cilician and Carian free cities. Each needs its Pleiades id checked.
- **Governors of 30–27.** DPRR follows Broughton, whose second volume ends in
  31, so the people layer is nearly empty for 30–27 and the build prints "no
  governor attested" for most provinces. Thomasson's _Laterculi Praesidum_ and
  PIR² would fill it, under their own terms.
- **Occupation is drawn nowhere.** The extension added Sextus Pompeius in the
  islands, Labienus and Pacorus in 40, and Antony in Armenia; the hatching in
  "Political layer, left for later" would show them.
- **Pharnaces' 48–47** keeps 47 against the successor rule (DOUBTS.md).

### After the extension to 133 BCE

- **Occupation matters more now.** Mithridates in Asia, Greece, Macedonia,
  Bithynia, Cappadocia and Galatia (88–85 and after), Sertorius in Spain (77–73)
  and Lucullus in Pontus (72–69) are all `occupied` rows, and none is drawn: the
  hatching in "Political layer, left for later" would show them.
- **Decisions the checks left for a human** (each is in DOUBTS.md, "The extension
  to 133 BCE"): whether Liguria south of the Po and Tiber-valley Umbria should
  move with Beloch; splitting the Palestinian coast so Ascalon is not Judaean, and
  giving Marisa's corner to Idumaea; a Gordyene atom; who held Sophene from 66;
  Armenia as Parthia's client before 95; Kallet-Marx's later Phrygia; Noricum and
  Thrace before their first attestations; the Scythians of the Crimea in 70–66.
- **Places of 133–68.** Numantia (destroyed 133), Iunonia (122–121), Pompey's
  trophy at the Pyrenees (no place kind for a monument), Corent, Metellinum and
  Castra Caecilia, Stratonicea's Carian twin, Marius' Gaetulian settlements.
- **Governors before 68.** DPRR covers the years, so the inspector shows them, but
  its joins in `dprr-provinces.yaml` were only touched where the ground changed;
  a pass over every join for 133–68 (Asia before 129, Cilicia as a command, the
  "Gallia" of the 120s) is still to do.

### Labels, left for later

- **Settlement names**: built (DESIGN §7.4). Left for later:
  - true small caps, with harfbuzz;
  - preferring the land side for coastal names; a paper halo makes them legible
    over water for now.
- **Greek.** Polytonic atlases and harfbuzz shaping, for names only attested in
  Greek.
- **Tilt parallax.** Labels are drawn at sea level with no depth test, so they
  are never hidden by relief. When the camera tilts, a name over high ground
  drifts off it by the relief's height. The fix is to lift each name to the
  ground height under it.
- **Two-line names** for compact territories with long names (Sardinia et
  Corsica, Bithynia et Pontus).
- **Heavier Cinzel.** The atlas is the variable font's default instance
  (Regular); the hairlines are thickened in the shader. A 600-weight instance
  would read better at small sizes.

### Roads, left for later

- **Built:** dated Itiner-e roads on the timeline (DESIGN §7.4).
- **Iberia and Africa are nearly roadless on the map.** That is a gap in
  Itiner-e's attributions, not in history: Republican Hispania had the coastal
  corridor and roads round Corduba, and Africa had a network around Carthage
  from 146. The legend must say so. Dating them means research per road.
- **Road names in the inspector.** `build/roads/roads.json` already carries each
  line's name, builder and source, in the order of `roads.bin`. It needs picking
  against the lines.
- **Roads under Rome's knockout.** Glyph knockouts apply to lettering only;
  roads cross names freely, as on a printed map.
- **The map's roads break into dashes close in.** Where the model of Rome's roads
  hand over to the map's at the edge of the country round the city, the map's line
  is the thin atlas symbol, and at 1–2 m/px its distance field is too coarse to
  hold it: it draws as faint dashes. A finer road field near Rome, or the board's
  roads carried further, would close it.
- **The consular roads out of Rome** (built September 2026, DESIGN §7.7), left for
  later:
  - the Nomentana's winding, 63 m off the modern road at the Viale Regina
    Margherita (Ashby 1906, pp. 39–41), is not drawn; it follows Itiner-e;
  - the Aurelia's line up the Janiculum is not known and is drawn over the easiest
    ground; the Campana's through Trastevere is not surveyed;
  - the road through the Salarian burial ground ("Salaria Vetus", named only in
    335–336 CE) and its gravel carriageways in SITAR (18198, 17763, 18402) could be
    drawn as an unnamed road, uncertain;
  - the tombs along the roads are generated. SITAR's copy of the Carta dell'Agro
    Romano (`cartografia_storica:carta_agro_punti`) places 521 tombs and 48 funerary
    monuments outside the Aurelian Wall, and its `carta_agro_lin_b` the ancient
    road lines there; SITAR's services are CC BY-SA 4.0, but that layer's own
    licence wants confirming before any of it is used;
  - Itiner-e's own Aurelia comes in through the Vatican plain (a later road); on
    the map it and its line into the Forum still draw zoomed out.

### The model of Rome, left for later

- **Built:** the museum model (DESIGN §7.7): every known building built as itself
  from its sourced design (about 100 of them, through 27 BCE), ~15,500 generated
  houses, the Servian Wall on SITAR's course with its gates and the agger, trees, baked shadows, and the smoothed board with the
  Tiber and paved streets.
- **Researched and left out** (September 2026), so the next pass need not repeat
  the search:
  - the Pantheon: begun in 27 BCE, finished in 25; at most a building site in the
    window, facing north (La Rocca), its first plan disputed;
  - the Amphitheatre of Statilius Taurus (30/29 BCE), the Porticus Octavia of Cn.
    Octavius (168 BCE, restored in 33), the Villa Publica and the Navalia: their
    sites are not known;
  - the Actian arch of 29 BCE beside the Divus Iulius: its existence is doubted
    (Nedergaard; Gurval) and no dimensions are published;
  - Janus Geminus (closed in 29 BCE), the Puteal Libonis, Felicitas: sites or forms
    unknown; Jupiter Feretrius (restored c. 31 BCE): under 5 m long, its site in
    the Area Capitolina unknown; Mens, Venus Erycina and Ops on the Capitol: sites
    unknown;
  - the Basilica Opimia: its site is disputed (north or south of Concord);
  - the Porticus Minucia Vetus: its site is disputed (round the Largo Argentina,
    or east of it);
  - the Porticus Philippi round Hercules of the Muses (c. 33–29 BCE): its size is
    not published; the temple on its podium is drawn;
  - optional and of low confidence: Victoria Virgo's aedicula, Neptune, Mars and
    Castor in circo, the Lares Permarini, the lost round temple of Hercules north of
    S. Maria in Cosmedin, the Temple of Sol in the Circus's seats, the Horti
    Maecenatis (by c. 35 BCE, extent conjectural).
- **Forms that are typical, not known.** Most temples on the Aventine, the Quirinal
  and the Esquiline are the typical temple (DESIGN §7.7), and some sizes are
  conjectural (each design's note says which). The Marble Plan's fragments, read in
  the Stanford edition, could give several of them.
- **Where some sites are disputed**, the model follows one reading and the record
  gives the others: Juno Moneta (Arata's site), Tellus (Palombi's), Victoria
  (Pensabene's, on an unnamed OpenStreetMap outline to be checked against his plan),
  Spes and Juno Sospita (which is which), the Theatre of Marcellus's orchestra.
- **The generated city is uniform elsewhere.** The Palatine now has its great
  houses (DESIGN §7.7); the Subura crowded with tall blocks and the Aventine more
  open could follow.
- **The Servian Wall in 27 BCE.** The houses built against it that Livy saw
  (1.44) and Maecenas's gardens over the agger's cemetery (from about 35 BCE, Horace
  walking "on the sunny agger") are not drawn; nor the gates whose site is unknown
  or disputed (Ratumena, Flumentana, Lavernalis, Querquetulana), nor the 87 BCE
  artillery arches on the Aventine (Via di Sant'Anselmo). On a brow its inner face
  stands 5–7 m over the hill behind it, where the wall there was more a facing
  against the hill, its top a parapet's height over the ground inside.
- **The Capitol's summits.** Smoothed less, the Capitolium stands at ~43 m, but
  the Arx at only ~27–33 m: the Mapterhorn surface there carries the Vittoriano's
  terraces and the Aracoeli's stair, and no ancient level of the summit is in
  SITAR to restore it by.
- **Where the board meets the map.** The Tiber on the board and the HydroRIVERS
  line do not meet at its edge, and the Itiner-e roads stop there.
- **More roads.** The Salaria and Nomentana (Itiner-e dates them from 30 BCE),
  the Aurelia (a tangle of lines), and the Ostiensis, Praenestina, Labicana and
  Latina (no Itiner-e line) are not drawn.
- **The legend** has no entry for the model.
- **The country round the city** (DESIGN §7.7), left for later:
  - The plots and the tombs follow only the roads the plan has. With the Latina,
    Ostiensis, Portuensis, Praenestina, Labicana and Nomentana drawn, their tombs
    and roadside plots would follow; until then the land between the Appia and
    the Tiburtina faces those two.
  - The Grove of Libitina, the undertakers' grove, is not drawn: no source locates
    it (Richardson p. 235). Pompey's gardens are a point for the same reason.
  - The outlines of the gardens and groves are drawn from their sources' bounds by
    hand; a reading of Lanciani's plan and the excavation reports could firm them
    up. Maecenas' follow Richardson (south of the Porta Esquilina); Platner &
    Ashby put them north of it, over the burial ground.
  - Vines are painted rows only; low 3D rows of vines on their stakes could come
    close in. The farmsteads' side ranges face the plot, not the yard.
  - ~33,000 trees now stand in the model, about twice the groves' count, though
    the olives and fruit trees are a few faces each. Worth measuring on a slow GPU
    (the explorer-perf work).
