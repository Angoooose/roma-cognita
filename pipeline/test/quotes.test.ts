import { describe, expect, it } from 'vitest'
import { htmlText, quoteIn } from '../src/quotes.ts'

const dio =
  'Bithynia with Pontus which adjoined it, Sardinia and Baetica were held to belong to the people and the senate.'

describe('quoteIn', () => {
  it('finds a quote whatever its case and punctuation', () => {
    expect(quoteIn('bithynia with pontus, which adjoined it', dio)).toBe(true)
    expect(quoteIn('“Sardinia and Baetica were held”', dio)).toBe(true)
  })

  it('reads … as a cut, with the pieces in order', () => {
    expect(quoteIn('Bithynia with Pontus … the people and the senate', dio)).toBe(true)
    expect(quoteIn('the people and the senate … Bithynia with Pontus', dio)).toBe(false)
  })

  it('matches whole words only', () => {
    expect(quoteIn('pont', dio)).toBe(false)
  })

  it('ignores accents and section or footnote numbers', () => {
    expect(quoteIn('Pompeius took Amaseia', 'Pompéius 12 took [3] Amáseia')).toBe(true)
  })

  it('requires every number the quote has', () => {
    expect(quoteIn('in 74 Nicomedes died', 'in 74 Nicomedes died')).toBe(true)
    expect(quoteIn('in 75 Nicomedes died', 'in 74 Nicomedes died')).toBe(false)
    expect(quoteIn('in 74 Nicomedes died', 'in 74 [3] Nicomedes 12 died')).toBe(true)
  })

  it('rejoins a word a scan broke at a line end', () => {
    expect(quoteIn('the kingdom of Commagene', 'the king-\ndom of Commagene')).toBe(true)
    expect(quoteIn('the king- dom of Commagene', 'the king-\ndom of Commagene')).toBe(true)
  })

  it("fails a quote the text doesn't have", () => {
    expect(quoteIn('Bithynia was made a province by Pompey', dio)).toBe(false)
  })
})

describe('htmlText', () => {
  it('drops markup and decodes entities', () => {
    expect(htmlText('<p>Caesar&rsquo;s <i>Gallic</i> War &amp; &#8220;more&#8221;</p>')).toMatch(
      /Caesar’s +Gallic +War & “more”/,
    )
  })
})
