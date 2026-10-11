# Research

How to find, read and cite the evidence for a record in `data/`. It is written
for whoever does the research, person or coding agent. Checking someone else's
research is [CHECKING.md](CHECKING.md). The data's own conventions (years, open
ends, confidence, review) are in [data/README.md](../data/README.md).

## The rule

**Every historical field of a record is backed by at least one citation whose
words were read in an open text and copied into `quote`.**

- **Open** means anyone can read it online without paying, logging in or filling
  in a form: ToposText, Perseus, LacusCurtius, The Latin Library, open-access
  books and articles, and scans on archive.org that can be read without
  borrowing.
- **Read** means fetched during the research. A quote is never written from
  memory, and never from a summary of the page (some fetch tools summarise:
  download the page itself, see [Reading a text](#reading-a-text)).
- A citation without a quote may stay, as the modern authority or further
  reading, but it backs nothing. A book you could not open is cited this way or
  not at all. There is no need to quote every work a record cites, only enough
  to back each field.

## A citation

One citation is one passage:

```yaml
sources:
  - source: cassius-dio
    locator: '42.35.5–6'
    quote: >-
      …the exact words that do the work, copied from the text…
    supports: [polity, from]
  - source: appian
    locator: 'BC 4.61'
    quote: >-
      …
    supports: [polity]
  - source: cayla-2017          # modern authority, not read: backs nothing
```

- **`locator`** names one passage. A range (`42.35.5–6`) is one passage; a list
  (`Mithr. 64, 101`) is two, so cite the source twice.
- **`quote`** is copied exactly from the text the source's `edition` names
  (for most ancient texts, the English translation on ToposText). Keep it to the
  words that do the work. Mark a cut with `…`; the pieces must appear in that
  order in the passage.
- **`supports`** lists the record's fields this passage states: `polity`,
  `relation`, `from`, `to`, and so on. Only the fields it actually states, not
  the ones it is consistent with. `supports: []` means cited for context (a
  revolt the map does not draw, say).
- **`url`** is the page you read the quote on, when it isn't the passage the
  locator already links to: a scan's full text on archive.org (the `_djvu.txt`
  file, not the book's landing page), an article's PDF, a page on another site.

The historical fields are the ones that say something happened: who held what,
in what relation, from when, to when, where. Ids, display names and styling are
not.

## Which sources

In this order:

1. **Ancient texts and inscriptions,** in an open translation.
2. **Open modern scholarship:** open-access books and articles, readable scans on
   archive.org.
3. **Open databases built from scholarship,** where they state the fact: DPRR
   (from Broughton), Pleiades.

Wikipedia, livius.org, encyclopedias, blogs and anything that reads like
generated text are never backing. Use them to find a source, then read that.

Don't trade a better source for a worse open one. If the authority is a closed
book and the only open alternative is a summary, cite the book without a quote
and treat the field as unbacked.

## Dates

**Consuls and events give the year.** Ancient writers date by consuls ("in the
consulship of Lutatius and Manlius") or by events ("after Syracuse fell"). A
quote that dates something that way backs the BCE year: the step from consuls to
year is the standard list of consuls, not a fact that needs citing each time.
Use DPRR's (cached under `.cache/sources/dprr/`) to make the conversion.
Arithmetic from a quoted date counts the same way: "four years" before a
quoted 26 is 30.

**Dates a translator or website added are not the source's.** Appian's margins
("B.C. 64") are the translator's; ToposText's "[75 BCE]" headings are the
site's. They can point you to the year; they can't back it.

**Open ends need less.** `from: before 133 BCE` only says the state was in force
in 133 (see data/README.md). Back it with a passage showing it in force at
133, or with two that bracket it (in force before 133 and still after) when
nothing between suggests a change. Dio 53.12.4–5, Augustus' division of the
provinces in 27, names many but not all: check the province is in his list.

**A chain of passages backs a field when every link is quoted.** Cicero's
Iamblichus is Emesa's ruler only through Strabo naming him so: quote both.

**A year no readable text states is not kept.** "Province from 146", a client
king's first year, a frontier's date: these are often scholars' inferences,
from coins or inscriptions. A scholar who states one in an open text can be
quoted for it. If no text you can read states it, a closed book doesn't save
it: change the field to what readable texts do support, an open end
(`from: before 51 BCE`, the first year it is attested) or a range, and say in
`note` what it was and why it changed. This narrows the record to its
evidence; it isn't a disagreement. Expect conventional dates to be contradicted
by the texts (Sicily "from 241", Macedonia "from 146"); when they are, that is a
disagreement (below), not something to explain away.

## Disagreements

**When a readable source contradicts the record, fix the record.** A
different year, a different holder, a relation that reads otherwise: change it,
one fix per commit (`fix(claims): …`), with what it said, what it says now and
the quotes in the commit message. Git's history is the record of what research
changed; the project's owner reviews the branch before it is merged.

**When readable sources disagree with each other, don't pick one.** Quote both,
make the field cover both (a range of years) or lower its `confidence`, and say
in `note` who says what.

## Reading a text

Download the whole work once, search it locally, copy the quote from what you
downloaded:

```bash
curl -sL -A 'Mozilla/5.0' https://topostext.org/work/144 -o strabo.html
```

ToposText puts each work on one page with an anchor per passage, so the anchor
gives the locator. `pipeline/src/passages/works.ts` says which page holds each
ancient work the project cites and how its anchors map to standard locators.

Which sites work, which block downloads and how to read each is in
[SITES.md](SITES.md). Add to it when you learn something; the next person
starts from it.

## When you finish

1. Every quoted citation has one passage, a quote and `supports`.
2. Every historical field is backed by a quote, or narrowed to what is.
3. Every fix is its own commit, saying what changed and on what evidence.
4. The texts are downloaded and the quotes found in them:

   ```bash
   npm run passages:fetch -w pipeline   # the ancient works we link into
   npm run quotes:fetch -w pipeline     # every other text a quote cites by url
   npm run data:validate                # fails on a quote not in its text
   ```

   The validator's `evidence:` line counts the records backed by quotes. A quote
   whose text isn't downloaded is listed under NOT CHECKED, not passed.
