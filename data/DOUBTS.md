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

- *Fixed September 2026:* Egypt is independent, a friend of Rome, to 60 and a
  client from 59, when Ptolemy XII was recognised friend and ally.
- *Fixed September 2026:* Cyprus now leaves Cilicia in 48 and is Ptolemaic
  from 47 (Dio 42.35); Judaea is a client from 63 and independent before;
  Galatia's and Emesa's seats are gone, because both are now drawn as
  territory.
- *Fixed September 2026:* Nicomedia is the royal seat of the Nicomedes to 75
  and has no seat status after; Bibracte's royal seat is gone (the Aedui had no
  king), and the oppidum dates from {120–100}.
- *Fixed September 2026:* Cirta's royal seat ends in 47; Arelate is a colony
  from 46; Cicero's Cilicia ends in 44/43; the Cisalpina claim ends in 43 with
  its polity; the Parthian occupation of Syria in 40 is in the data; Noricum's
  Alföldy locator is chs. 4–5.

## Known weak spots

- **Four weak extents:** Gallia Comata, Nabataea, Odrysian Thrace, and
  Ituraea's seat at Chalcis sub Libano, whose site is not securely identified.
- **Not yet checked by the validator:**
  - that atoms.geojson is what `npm run atoms` builds from atoms.yaml;
  - that places still match Pleiades.
  Atom overlap is now checked (September 2026).

## Before extending the window further

The window's edges are written `before 133 BCE` / `after 27 BCE`. Extending it
means replacing each open end with a real date, which re-opens every record
above. The extension from 43 to 27 did this for every open end but one
(Osroene's relation, left open on purpose), and the extension back from 68 to
133 for every one but the Kushite row on Lower Nubia.

## The extension to 27 BCE (September 2026)

How it was done: six research agents, one per region, read the ancient texts
and the open scholarship for 43–27; a second set checked every citation they
made against the text, adversarially, before anything was written. Modern works
that could not be opened are cited without pages, and their claims rest on the
ancient passages cited beside them. Every new row is `draft` or `needs-check`.
What the checks left open:

**Rome, Italy and Greece**
- *Cisalpina's end.* Drawn at the legal decision after Philippi (42; App. BC
  5.3). In practice Pollio held Venetia for Antony into 40 (Vell. 2.76.2);
  Laffi (1992, not read) reportedly argues for late 41.
- *Sextus Pompeius.* Dio 48.2.1 has him "still occupying Sardinia and Sicily"
  in 42, against the seizure of Sardinia in 40 in his own narrative and
  Appian's; read as an anticipation. When he took Corsica is not recorded; 40
  follows Sardinia.
- *Achaea in 27* is its first firm attestation, not its creation (Sulpicius
  Rufus governed it in 46–45). Thessaly in it rests on Bowersock's emended text
  of Strabo 17.3.25, and Strabo's list is Tiberian, not the list of 27; how far
  north its Epirus reached is a convention (the Aous).
- *Which triumvir held which province* is not modelled (BACKLOG.md).
- *The Pharnaces row* (48–47, from before) keeps 47 though Zela was fought in
  August 47; every occupation added since ends the year before the occupier was
  driven out (README decision 17). It wants bringing into line.

**The Balkans and the Black Sea**
- *The Iapydes' atom*: the Colapis and the Una are conventions, and Strabo
  says the Colapis flowed through their country (7.5.2).
- *The Delmatae as a province from 33*: a tributary people under treaty is as
  defensible; they revolted in 16 and 11.
- *Not drawn*: the garrison at Siscia (35), Pannonia, Moesia (tributary only
  under Tiberius, App. Ill. 30), the Dacian and Getic kingdoms after Burebista,
  and Brutus' takeover of Sadalas' bequest in 43/42 (Dio 47.25.1). Two allies of
  Rome with no ground drawn are not polities: Sitas of the Dentheletae, "under
  treaty" (Dio 51.23.4; long-standing allies by Cic. Pis. 84), and the Getic
  king Roles, "friend and ally" c. 29 (Dio 51.24.7).
- *The Sapaean kingdom's Aegean coast* between the Nestus and the Hebrus lies
  inside the macedonia atom, in 68–43 as well.
- *The Bosporus as a client from c. 41* follows Vnukov and Kovalenko's
  chronology of Asander's coins; ps.-Lucian (Macr. 17) says Augustus made him
  king. The free interval of Chersonesus (Pliny 4.85) is not drawn.

**The West**
- *Lusitania, Baetica and the three Gauls*: dated to 27 by Dio, to 16–13 by
  most modern work; not drawn (README decision 21).
- *The name Gallia Narbonensis*: when it became official is unknown; it is a
  non-preferred name only.
- *The Vaccaei c. 29* rests on Dio's undated account of Statilius Taurus; the
  Turmogi and Autrigones, probably Rome's by 26, stay unclaimed.
- *The Salassi*: "subjugated" in 34 (App. Ill. 17) against Strabo 4.6.7 and
  Dio's "revolt" of 25; left unclaimed, with Cottius' realm, whose standing
  before 14 is unknown.
- *The Spains in 41–40*: Octavian's on Dio 48.1.3, Antony's on App. BC 5.51.

**Africa and Egypt**
- *The two Africas' union*: drawn at 27; Fishwick and Shaw (1977) and Fishwick
  (1993, 1994) argue for 36/35.
- *Arabio's lands to Bocchus in 41* is Bridoux's inference (¶103).
- *Mauretania 33–25*: a province on Dio's words and to Mackie, Amandry and
  Amela Valverde; a limbo or protectorate to Gsell, Roller, Coltelloni-Trannoy
  and Hugoniot. Its colonies are not yet places.
- *Cyrenaica under Cleopatra Selene, 34–31*, against a Roman quaestor's coins
  dated only "34–31 (?)" (RPC I 919–923).
- *Not drawn*: the "parts of Crete" given to Cleopatra's children (Dio
  49.32.5), a Juban Numidia in 30–25 (Dio 51.15.6 against 53.26.2), and a
  Ptolemaic Dodecaschoenus before 30, which Burstein's boundary at
  Hierasykaminos (Barrington map 81) would support.
- *The Triacontaschoenus* rests on one inscription, the Philae stele; its
  Latin and Greek differ on Kush (under protection, or a friend). The rulers of
  Meroë in 43–29 are not named: Fontes Historiae Nubiorum was not consulted.

**Anatolia and Cyprus**
- *Cilicia's end in 44/43* follows Syme and Magie; Bickerman (1947) held the
  plain joined Syria only after AD 18. Its plain is Syria's from 43, uncertain to
  38.
- *Labienus' occupation of Asia in 40* is drawn over the whole atom, though the
  islands and Stratonicea held out and he styled himself a Roman imperator.
- *Pontus*: what Darius held inland in 39–37 is unknown; the Zela temple and
  Ateporix's principality lie inside pontus-inner; Amisus (Polemon's?, then a
  tyrant's, free from 31) and the Amnias basin with Pompeiopolis (Paphlagonia's
  by 37/36 at the latest) stay with the coast atom.
- *Lesser Armenia 39–34*: no holder is recorded, and it is unclaimed.
- *Amyntas' kingdom*: Isauria is drawn with Lycaonia from 36 but may be post-
  Actium (Magie I 443); Apollonia, his at his death (Strabo 12.6.4), is inside
  asia-phrygia; Pamphylia and southern Pisidia are unclaimed after 43 (his
  "portions of Pamphylia" may be Side, or his Pisidian lands); Rough Cilicia east
  of Seleucia, in Strabo's grant, stays with Olba, whose own standing under
  Antony and Cleopatra is unknown.
- *Derbe's end*: c. 36 (Robert), the late 30s or early 20s (Mitchell), or
  after Actium (Magie, drawn).
- *Cappadocia*: Ariobarzanes III died in 43 (Appian) or 42 (Dio); whether
  Sisines is Archelaus, and whether he was installed in 41 or 36.
- *Comana*: Dio's Medeius and Strabo's Cleon may be one man.
- *The Amanus 30–20* is unclaimed; Dmitriev suggests Amyntas, then Archelaus.
- *Cyprus 41–37*: Cleopatra's (Schrapel), Antony's (Bicknell), or both
  (Cayla); drawn hers.

**The Levant, Parthia and the Caucasus**
- *Cleopatra's grants* are drawn from 36 (Plutarch; her new count of years in
  37/36); Josephus tells them with the events of 34, and the double era is
  Porphyry's for Chalcis only. The coast is drawn as her holding, the "parts of
  Arabia" as revenue and not at all.
- *The coast in 30–27* outside Herod's cities is taken to have gone back to
  Syria; Ascalon, free since 104, may never have been hers.
- *Jerusalem's fall in 37*: Josephus' consular date, against his own
  "twenty-seven years" from 63 and Dio's 38. Galilee was Herod's from the
  winter of 39/38 but is drawn with Antigonus' Judaea.
- *Emesa 30–27* is drawn as Syria's, uncertain; no source says who governed
  it before Iamblichus II's restoration in 20.
- *Armenia*: Antony's garrison is drawn 34–32 and Artaxias II from 31; when he
  came back is not recorded (32–30). The part of Armenia given to the Mede in 33
  is not drawn.
- *Osroene's standing* after 43 is unknown and left open; *Commagene*'s
  Antiochus I may have died c. 37–36 or as late as 31; *Colchis* under Polemon
  is undated and not drawn; *Tiridates II* is not drawn.
- *Phraates IV* "came into power shortly before 37" (Debevoise 121); whether
  38 or 37 is open.

**Places**
- Fixed: Cirta's royal seat ends in 47; Arelate is a colony from 46, not
  before 68.
- Not yet added: Nicopolis (31/29), Siscia, Metulum, Promona, the western
  Pontic cities (the `apollonia` id is the Illyrian one), the Mauretanian and
  Gallic colonies of 43–27.

## Floodplains and the Nile branches (September 2026)

All `review: draft`. The derivation prints the live list; the standing ones:

- **Published areas are unchecked.** Butzer 1976 (Egypt), Adams 1981
  (Mesopotamia) and the Ptolemaic Fayum figures are cited as "usually cited";
  nobody has opened the books. Egypt comes out ~35,000 km² against the
  22,000–34,000 range, mostly because the delta polygon includes the northern
  lagoon margins that were marsh in antiquity.
- **Fayum lake level** (−2 m) and the canal-command bound (+26 m) are single
  numbers for a lake that moved during the window.
- **Gulf coast**: Mesopotamia and Susiana stop at the head of the Gulf as
  persian-gulf-head draws it, a middle line in a debate that runs from the
  modern coast to Charax; ±15–25 km.
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
  Istria; the Cyclades, Lemnos and Imbros; the Tracheia west of Olba (until 37/36;
  Cleopatra's from 36, an atom since September 2026); Siwa and
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

## The extension to 133 BCE (September 2026)

How it was done: six research agents, one per region, read the ancient texts
and the open scholarship for 133–68 and wrote the records; a second set checked
every citation against the text, adversarially, and corrected what failed
before the regions were merged. Modern works that could not be opened are cited
without pages, and their claims rest on the ancient passages cited beside them.
Every new row is `draft` or `needs-check`. What the checks left open:

**Italy and the islands**
- *How Italy is split before the Social War* (README decision 22). The frontier
  between the citizen land and the allies is a zone, drawn as a line: it follows
  Beloch's inferences from colonies, prefectures and the later voting tribes
  (1880, ch. III). Beloch puts Tarquinii, Vulci and Falerii in the Roman land to
  the Umbro and Monte Amiata (others keep Tarquinii and Vulci allied), and the
  strip along the Via Flaminia past Asisium. The Frentani and Caraceni, the
  Samnite, Hirpine and Apulian lines, and the Laus–Crathis frontier are
  conventions. All eleven new atoms (ten from Italy, Cispadana from Cisalpina) are schematic, uncertain and needs-check.
- *The allies are one polity*, `socii`, not a dozen peoples: Rome's treaties were
  with some 150 communities (Beloch ch. VIII), and no source draws the peoples'
  frontiers. "SOCII" is therefore lettered once, on the largest piece.
- *Enclaves not drawn*: the Latin colonies (a place status, `colonia latina`),
  Tibur and Praeneste, Neapolis and Capri, Ancona, Teanum Sidicinum, Camerinum,
  Ravenna; Nola, which held out until 80 (Per. 89); Volaterrae (to c. 80 or 79).
- *The dates of the Social War*: Etruria, the heel and the toe enfranchised in 90;
  the Marsic peoples, Asculum, the Nucerine cities and the Hirpini in 89 (the
  Marsi may have held into 88); Apulia in 88; Samnium and Lucania in 87 (App. BC
  1.68, Per. 80), though Gabinius took many Lucanian towns in 89. The Samnites at
  the Colline Gate in 82 are not drawn. Beloch has most of Tiber-valley Umbria
  (Tuder, Iguvium, Arna, Ameria) join the rising in 90–89 (Per. 74); it is drawn
  loyal, as no source dates its submission. Calabria is drawn loyal because no
  source puts it in the revolt; Bruttium is drawn allied though much of it was
  Roman public land.
- *Cisalpina*: Cispadana is drawn as citizen land before 91, a mixture drawn as
  its larger part, which sweeps in allied Faesulae, the Veleiates and Sarsina;
  Beloch (p. 67) has most of the Ligurian plain west of the Trebia already Roman,
  though it is drawn allied inside cisalpina. Transpadana has Latin rights from 89
  (Asconius, Pis. 3 C) and is allied to 82. The province of c. 81 is disputed
  (the 90s, 89).
- *The Sicilian slave kingdoms* are seats (Enna, Triocala), since nothing records
  how far their power reached inside a province Rome still governed; the Triocala
  site is Pleiades' doubtful identification. Spartacus (73–71) is not drawn.
- *Places*: Mariana's founding ({103–86}) and Pompeii's colony (c. 80) are not
  dated by any source; Tarentum's municipium from 90 rests on App. BC 1.49, and
  when Neptunia was joined to the city is Beloch's "Sulla or Augustus";
  Hydruntum's status rests on a general page of Beloch (p. 175). Víteliú on the
  insurgents' coins is not cited from a coin catalogue.
- *Not drawn*: the civil war of 88–82 and any Sullan command in Italy; the
  Cimbri in Transpadana (102–101).

**The West**
- *The Province's date.* Transalpina is drawn from 121 by convention; the regular
  province is now often put down to Marius in the Cimbric wars or to Pompey in
  the 70s (Amela Valverde 2019, 39), and Ebel (1976, not read) has the ground west
  of the Rhône governed from Hither Spain until then. The Salluvian country,
  beaten in 124–122 and garrisoned at Aquae Sextiae, is not drawn apart. Before
  121 the land is unclaimed but for Massalia: the Arvernian hegemony (Strabo
  4.2.3) has no extent anyone can draw. Rome's first war beyond the Alps was
  Opimius' for Massalia in 154 (Per. 47).
- *The Tolosates' alliance* is undated and drawn from {121–118}; their revolt of
  107 sits inside it; Caepio's sack is drawn in his consulship, 106 (Orosius'
  "proconsul" would make it 105).
- *The Ruteni provinciales* are inside the Province from 121, though BG 1.45
  says they were not made provincial then; the 70s are argued (Amela 24, 28).
- *Sertorius* (a `command`, README decision 18) is drawn over Hither Spain and
  the Arevaci from c. 77 (Plut. Sert. 16.1) to 73, uncertain: the coast towns
  stayed with the government (Pompey's letter, Sall. Hist. 2.98 M), and Strabo has
  him driven from Celtiberia before his death. His years in Lusitania and Further
  Spain (80–78) draw no ground; his death is 73 or 72.
- *Lusitania between the Tagus and the Durius* stays unclaimed in 133–61,
  despite Brutus' surrender of 138–136 and its ten commissioners (App. Hisp. 99).
- *The Aedui 133–123* are independent, uncertain: their alliance is first
  attested in 122 (Per. 61), though Strabo 4.3.2 suggests it is older.
- *Not drawn*: the Cimbri and Teutones (109–102), who crossed the land without
  holding it; Pompey's grants of Volcan and Helvian land to Massalia (BC 1.35);
  Pompey's trophy at the Col de Panissars (no place kind fits a monument).
- *The Gallic oppida* start before 133 only on Pleiades' period attestation;
  Bibracte ({120–100}) and Gergovia ({70–60}) show how wrong that can be.

**Africa and Egypt**
- *The division of c. 116* (Bridoux has c. 117): Adherbal's western limit is
  unknown (Bridoux ¶141), so the three atoms between the Ampsaga and the Chelif
  are unclaimed in c. 116–113.
- *The Jugurthine War* is the kingdom's independence, 111–106; the Roman
  garrisons (Vaga, Thala, Cirta) and Capsa's destruction are not drawn.
- *Bocchus I's gain of 105* is taken to Cap Ténès (Gsell; Bridoux ¶75, ¶145);
  Desanges carried it at least to the mouth of the Chelif; Sallust's "a third of
  Numidia" is a promise.
- *Mauretania to the Soummam* from c. 80 rests on Desanges and Bridoux ¶97,
  ¶102, and could be as late as the 50s; unclaimed c. 88–81. Masteabar's standing
  to Rome (c. 88–82) is inferred from his father's.
- *Not drawn*: Hiarbas (82/81), the Marian hold on Africa in 82–81, Sertorius
  at Tingi in 81, Iunonia (122–121), Marius' Gaetulian settlements.
- *Cyrenaica*: the crown's to 108/107, a king of Cyrene by 101/100 (Justin puts
  Apion's accession at 116); 107–106 is unclaimed. The free cities of 96–75 are
  drawn `allied` for want of a closer standing; Sallust's quaestor "to the new
  province" (Hist. 2.43 M) falls in 75, against the province's c. 74.
- *Egypt a client from 59*, at the recognition, not the garrison of 55; its
  civil wars and the Theban revolt of c. 88–86 are not drawn.
- *Cyprus*: Ptolemy X's kingdom from 114/113 and Ptolemy IX's from 105 rest on
  Bennett's reading of Mitford and Mørkholm; Bennett doubts the usual view that
  Ptolemy X went first as its general; Ptolemy of Cyprus from 80 is inferred
  from Trogus' Prologue 40.
- *Lower Nubia* keeps its `before 68 BCE` open end on purpose: Eller (2025) has
  Ptolemy VI re-establish control to the Second Cataract and the first century
  "difficult to determine", and questions the Kushite row even for 68–30.
- *Unread*: the law of 101/100 (Crawford, Roman Statutes 12), SEG IX 5, OGIS 166,
  known only through Bennett; Braund 1984 and Török 1997.

**The Balkans and the Black Sea**
- *The Caenic land.* Pliny puts Caenica inland near Bizye and Apros (4.47),
  beyond the drawn Chersonese; the Knidos copy's "which Didius took" may govern
  only the Caenic land. The Chersonese was the Attalids' in 133 and Rome's hold on
  it before c. 100 is unrecorded, so it is unclaimed. Sumner dates the law late
  100 or early 99.
- *Mithridates in Greece*: Achaea occupied 88–86, to the Delium terms of winter
  86/85, when Archelaus withdrew his garrisons (Mithr. 55); Macedonia and the
  Chersonese only 87 (Arcathias' army came down to Thermopylae in 86). Sentius and
  the Denseletae held out. Sparta keeps its free status through 88–86 though it
  sided with Mithridates (Mithr. 29); Athens under Aristion has none.
- *The Crimean Scythians* are Pontus' client from c. 110 to 64, on the decree
  and Strabo 7.4.3, and Appian's "princes of the Scythian tribes" among the king's
  allies at the end (Mithr. 119); in 70–66, while the king was a refugee, this is
  doubtful. The old data had them independent in 68–64.
- *Chersonesus* is Mithridates' c. 110–81, under the Bosporus in c. 80–66
  (Strabo 7.4.3), and his again in 65–64.
- *The Bosporus*: c. 110–107 for the decree is the usual reckoning, the stone
  being dated only by a local eponym; when its peoples revolted is not recorded,
  so the Pontic row ends in 86. Machares' friendship with Rome is dated 70. The
  Maeotic shore under the Spartocids is unclaimed, though Plutarch's "ancient
  realm as far as the deserts beyond Lake Maeotis" cuts against that.
- *A Pontic protectorate over the west Pontic cities* before 72 is argued in the
  scholarship but not drawn: Mithr. 15's "Greeks bordering on the Euxine" is too
  vague to draw from.
- *Thrace before c. 80 and Noricum before 113* are unclaimed: those years are
  first attestations (Verr. 2.1.63; App. Celt. 13), not beginnings.
- *Not drawn*: the Illyrian coast before 59 ("Roman Illyria", App. Ill. 10–11,
  with no governor recorded); Tuditanus' Iapydes (129) and Metellus' Segestani
  (119); the Scordisci's raids to Delphi; Curio's and M. Lucullus' wars; Getic
  Dacia before Burebista.

**Anatolia**
- *Asia from 133.* Strabo has the province proclaimed at the bequest (13.4.2);
  129 is the usual date for its organisation, and at first the tribute-paying
  ground was "a patchwork … chiefly in Mysia and Lydia" (Kallet-Marx 112–115).
  The whole atom is drawn from 133 as a convention.
- *Aristonicus* is a seat at Stratonicea on the Caicus, not an occupation: he held
  towns and forts, not a territory. Coarelli argues for the Carian Stratonicea.
- *Greater Phrygia*: Aquillius' grant to Pontus may fall anywhere in 129–126, and
  its return to Asia is drawn {119–116}, uncertain; Kallet-Marx (240–242) has it
  freed, not annexed, and taken in only after c. 95.
- *Lycaonia's* return to Asia is placed at the law of 101/100 and its passage to
  Cilicia at Servilius' Isaurian war (75), an inference.
- *Cilicia before 80*: whether a territory or only a command against the pirates
  is argued (Sherwin-White, n. 18, for a base in Pamphylia; Borgia 299–300 for a
  sphere of competence); drawn uncertain from {102–100}. Zenicetus' Lycian
  strongholds are not drawn.
- *The Cilician plain* is Armenian from 83 on Appian's fourteen years; Justin has
  eighteen and some modern work later dates. Unclaimed from 69 until Pompey.
- *Pontus*: c. 120 and c. 113 are modern reckonings. Paphlagonia's partition of
  c. 108 is told in a note, not drawn: which king held what is unknown, and the
  senate took Paphlagonia from Nicomedes (Justin 38.2). Pontus is drawn `allied`
  to 90 on Appian's "friend and ally". Lucullus' hold of 72/71–69 is a Roman
  occupation, not a province: the commissioners came only in 67. Heraclea's
  Pontic garrison of 73–71/70 and Mytilene's holding out to 81/80 are not drawn.
- *Cappadocia*: Tigranes' first expulsion of Ariobarzanes (Sherwin-White's, c.
  95–93) is not drawn; Justin's "first approach of Tigranes" is read as the
  expulsion of 90 (Kallet-Marx 356–359). The 81–79 occupation covers only "a
  greater part" of the kingdom but is drawn whole; Tigranes' raid of 78 or 77 and
  the overrunning of 67–66 are not drawn.
- *Galatia* is a client, uncertain (its standing is nowhere stated), occupied by
  Mithridates only in 86, when Eumachus was sent after the massacre (Mithr. 46).
- *Cibyra's tyranny* ends c. 83 (Kallet-Marx 114) or c. 82 (Sherwin-White n. 6).
- *Unread*: Robinson (NC 1954) on Aristonicus' cistophori; the Cnidus text itself;
  Sallust's fragment on Marcius Rex in Lycaonia; Posidonius' "strategos of
  Pamphylia"; McGing 1986.

**The Levant, Armenia and the East**
- *Tigranes' Syria* is 83–70 on Appian's fourteen years (Syr. 48); Justin has
  eighteen (40.1), and some modern work c. 74. Selene held Ptolemais to c. 70/69
  until Tigranes took it (AJ 13.419–421) and Aretas held Damascus c. 85–72 (no
  passage opened), but the Syria and Phoenicia atoms are Armenian throughout.
  Tyre and Sidon stay free through his years: no source says he took them.
- *The Seleucid division* from 113 (Grypus against Cyzicenus, and their sons),
  and the Nabataean and Armenian Damascus, are not drawn: no line for them.
  Antiochus VII's Babylonia (130–129) and Tigranes' northern Mesopotamia (Nisibis,
  to 68) have no grain in the parthia atom; nor have Characene and Adiabene.
- *The Hasmonean conquests* are dated per atom: Idumaea {129–111} (Josephus puts
  it straight after 129, the archaeology of Marisa and Gerizim c. 112–111, not
  opened here); Samaria {111–107}; Scythopolis 107, though Pella, Dion, Gerasa and
  the Gaulanitis fell in the 80s, hence {107–83}; Galilee 104, on the usual reading
  of AJ 13.318 (some put it under Hyrcanus I); Peraea c. 100, when Jannaeus took
  Theodorus' Amathus (AJ 13.356); Strato's Tower and Dora {103–96} (Zoilus'
  tyranny is not drawn); Gaza 96. By 103 Iamnia and Azotus were already Jewish (AJ
  13.324), so the southern coast is drawn too late; Ascalon, never Hasmonean, lies
  inside that Judaean atom, its freedom only a place status; the gaza atom's
  eastern corner is Marisa's lowland, drawn Seleucid to 97 against AJ 13.257.
  Gaza is drawn standing though Jannaeus destroyed it (AJ 13.364) and Gabinius
  rebuilt it (14.87–88).
- *Moab* is Judaean c. 93–88, Nabataean c. 87–84 (given back in the civil war, AJ
  13.382) and Judaean again from {83–80}.
- *Nabataea* is independent until Scaurus (62; AJ 14.80–81), which changes 68–63
  of the old data; the king who killed Antiochus XII is unnamed in the Greek (AJ
  13.391).
- *The city eras* of Tyre (126/125), Sidon (111) and Ascalon (104/103) rest on a
  dealer's catalogue entry, Livius.org and an abstract respectively; BMC
  Phoenicia was not opened.
- *Emesa* from 69 is a convention: Diodorus 40.1b, the first mention of
  Sampsigeramus, is undated (c. 67–64). *The Amanus* from 64 is a convention too.
- *Armenia before 95* is independent, uncertain: Mithridates II fought Artavasdes
  (Justin 42.2) and held Tigranes hostage (38.3), but a Parthian overlordship is
  recorded nowhere. Gordyene, a kingdom of its own until Tigranes took it (Strabo
  11.14.15), lies inside the armenia atom and is drawn Armenian throughout.
  Sophene from 66 is uncertain: Tigranes' (Pompey), his son's (Dio 36.53) or
  Cappadocia's (App. Mithr. 105). Tigranes' conquests of Sophene (c. 94) and
  Atropatene (c. 87–85) have no ancient year; Parthian overlordship of Atropatene
  before 85 is inferred.
- *Osroene* from c. 132 rests on the Chronicle of Edessa's first entry (Seleucid
  year 180); the name Aryu is Segal's, not opened. Tigranocerta's founding c. 80
  is a convention.

## Sea names (September 2026)

- **Locators are to Pliny's book only.** The paragraph numbers are unchecked,
  hence `review: needs-check` on every sea.
- **Pliny wrote a century after our window.** The Republic's own usage was
  looser: Caesar has only "the Ocean" for the North Sea. The Barrington
  Atlas's forms are used throughout.
- **The courses are placement, not extent.** Where one sea ends and the next
  begins (Ionium against Siculum, Libycum against Aegyptium) is not claimed.

## The ancient ground of Rome (September 2026)

- **Only six valley floors are set from excavated levels** (pipeline/src/rome/
  ground.ts). The Subura, the Circus' valley, the Velabrum and the valleys of the
  north keep today's terrain, though they too filled up: a published map of the
  depth of the fill in Rome's centre, or more dated levels, would let them be set.
- **Two of the six are ceilings.** The Forum's square and the valley of the
  Colosseum are set from levels of the early empire; the Republican ground lay at
  or a little below them.
- **The Velia and the saddle between the Capitol and the Quirinal stood higher**
  than today (cut in 1932 and by Trajan). Neither is raised: SITAR's levels on the
  Velia are measured against a terrain model too uncertain there, and no height
  for the saddle is recorded with a source yet.

