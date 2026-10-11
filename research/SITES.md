# Sites

Where open texts can be read, and what to watch for in each. Started October
2026 from the first research runs; add to it whenever you learn something.

| Source | Notes |
| --- | --- |
| ToposText (topostext.org) | Most ancient texts in English. Whole work per page. Its Periochae of Livy start at book 46. Strabo 16 follows Hamilton's paragraphing and Josephus' anchors are Whiston's chapters, with Niese's numbers printed as [§] in the text, so a passage may sit under a different anchor than its standard locator. |
| LacusCurtius (penelope.uchicago.edu) | Needs a browser User-Agent. Book pages have literal asterisks in the path (`17A1*.html`). |
| Perseus (perseus.tufts.edu) | The passage goes in the address, e.g. `text?doc=Perseus:text:1999.02.0137:book=5:chapter=36`. |
| The Latin Library | Latin only. Livy's Periochae 1–45, Solinus. |
| attalus.org | Translated inscriptions (OGIS, SEG). Latin-1 encoded. |
| archive.org | The advanced-search API with `access-restricted-item:false` finds readable books in seconds; the `_djvu.txt` file is the full text. Broughton's MRR and Magie are readable there. |
| DPRR (romanrepublic.ac.uk) | The website blocks bots; use the SPARQL endpoint or the local cache. Its `primaryReferences` look misaligned: don't use them to find ancient passages without checking. |
| figshare, OJS journals | Open theses and articles download as PDFs without a gate. |
| Blocked | PHI Greek Inscriptions, JSTOR, OAPEN, HathiTrust full text, Qatar Digital Library, Chiron (DAI). |
| Not open | Society for Libyan Studies e-books (form), Cambridge Core unless marked open access. |

PDFs need converting to text before searching (`pypdf`, `pdftotext`).
