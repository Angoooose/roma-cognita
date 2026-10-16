# Checking a record

How to check research done by someone else, following
[the research method](README.md). The check only means something if it is
independent, so:

- **Start fresh.** A new session, not the one that did the research, and if you
  can, a different agent or model.
- **Read only the claim and the passage.** For each record, read its fields
  (polity, relation, from, to, …) and its citations. Don't read `note`: it is the
  researcher's argument, and the point is to see whether the passage makes the
  case without it.
- **Fetch the passage yourself.** Download it as the method describes. Don't
  trust the quote as written.

## For each quoted citation

1. **Is the quote there?** Find it in the passage at its locator.
   `npm run data:validate` checks this too, but look anyway: the quote can be
   real and still be lifted out of a sentence that says something else.
2. **Does it state what `supports` claims?** For each field it lists, answer:
   - **yes:** the passage states it;
   - **partly:** it states part of it (the holder but not the year, say);
   - **silent:** it doesn't address it;
   - **no:** it contradicts it.

   A passage that names the larger region (Syria) and not the part the record
   is about (Phoenicia) is **partly**, not **yes**: it backs the part only if
   nothing suggests the part was held differently.

   A source that hedges ("possibly", "probably") is **partly**. So is a quote
   whose `…` cut hides the words the field rests on: read what was cut.

   Judge against the conventions in [data/README.md](../data/README.md) and the
   method: open ends
   need only the state in force at that year, and a year given by consuls or by
   an event counts.

3. **Read around the quote.** A sentence or two either side. Does the context
   change its meaning?

## For each record

- Is every historical field backed by at least one **yes**? A field with none
  is unbacked, whatever the note says.

## What to do with what fails

Once you have judged a record, you may read its note, and fix what failed, one
fix per commit as the method's [Disagreements](README.md#disagreements) says:

- a quote not found: correct it from the text, or remove the citation;
- a field the passage is **silent** on: take it out of `supports`;
- a passage that says **no**: fix the record to what the passage says;
- a field left unbacked: research it, or narrow it to what is backed.

The project's owner reviews the branch before it is merged.
