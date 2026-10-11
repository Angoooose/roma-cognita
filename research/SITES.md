# Sites

Where open texts can be read, and what to watch for in each. Started October
2026 from the first research runs; add to it whenever you learn something.

| Source | Notes |
| --- | --- |
| ToposText (topostext.org) | Most ancient texts in English. Whole work per page. Its Periochae of Livy start at book 46. Strabo 16 follows Hamilton's paragraphing and Josephus' anchors are Whiston's chapters, with Niese's numbers printed as [§] in the text, so a passage may sit under a different anchor than its standard locator. Strabo 17 is Hamilton's too ("Ethiopians", "Candace"), not the LacusCurtius wording. Appian's translator puts dates inside sentences ("made (B.C. 64 war"): cut around them with `…`. Sallust's Jugurtha has an anchor per chapter only; Cicero's Pro Fonteio is numbered differently from the standard. Diodorus 31.19a sits inside its § 31.22.1, so it can't be quoted at its own locator. |
| LacusCurtius (penelope.uchicago.edu) | Needs a browser User-Agent. Book pages have literal asterisks in the path (`17A1*.html`). |
| Perseus (perseus.tufts.edu) | The passage goes in the address, e.g. `text?doc=Perseus:text:1999.02.0137:book=5:chapter=36`. |
| The Latin Library | Latin only. Livy's Periochae 1–45, Solinus. |
| attalus.org | Translated inscriptions (OGIS, SEG). Latin-1 encoded. |
| archive.org | The advanced-search API with `access-restricted-item:false` finds readable books in seconds; the `_djvu.txt` file is the full text, and is what a citation's `url` should be. Readable there: Broughton's MRR, Magie, Schürer's 1890 English translation (good for Nabataean and Judaean dates). The scans' OCR has flaws: MRR prints "CI L" for CIL, so cut a quote short of such spots. Page numbers are running heads (Magie's come after each page's text; parts of MRR print only the odd pages), so count from them. |
| DPRR (romanrepublic.ac.uk) | The website blocks bots; use the SPARQL endpoint or the local cache. Its `primaryReferences` look misaligned: don't use them to find ancient passages without checking. |
| figshare, OJS journals | Open theses and articles download as PDFs without a gate. The figshare API (`api.figshare.com/v2/articles/<id>`) gives the PDF's `ndownloader` address. Some PDFs (apcz.umk.pl) split words at ligatures ("e ff orts") or turn small capitals into odd glyphs: quote around them. |
| Blocked | PHI Greek Inscriptions, JSTOR, OAPEN, HathiTrust full text, Qatar Digital Library, Chiron (DAI). |
| Not open | Society for Libyan Studies e-books (form), Cambridge Core unless marked open access. |

Any page or PDF that isn't an ancient work we link into: read it with

```bash
npm run quotes:fetch -w pipeline -- <url>
```

which prints the text exactly as the validator will search it (PDFs included),
so a quote copied from it will match. A table's cells may come out in a
different order than they look: quote one cell at a time, or cut between them
with `…`.
