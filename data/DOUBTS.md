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
- **"Royal seat" status is wrong in two places:**
  - Nicomedia: Bithynia was a province throughout.
  - Bibracte: the Aedui had no king.
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

The window's edges are written `before 68 BCE` / `after 27 BCE`. Extending it
means replacing each open end with a real date, which re-opens every record
above. The extension from 43 to 27 did this for every open end but one
(Osroene's relation, left open on purpose).

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

