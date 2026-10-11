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

   Judge against the conventions in [data/README.md](../data/README.md) and the
   method: open ends
   need only the state in force at that year, and a year given by consuls or by
   an event counts.
3. **Read around the quote.** A sentence or two either side. Does the context
   change its meaning?

## For each record

- Is every historical field backed by at least one **yes**? A field with none
  is unbacked, whatever the note says.

## What to write

Don't edit the record. Add an entry to `data/proposed-corrections.yaml` for
anything that isn't a clean **yes**: a quote not found, a passage that is
**silent** or **no** on a field it supposedly supports, a field left unbacked.
Use the format in the method, with `found by` naming yourself and `field`
naming what fails.

The project's owner decides each entry.
