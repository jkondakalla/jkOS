// Deterministically split one lecture's content into short, readable "slices".
// Pure + stable: identical content always yields identical slices, so saved
// reading progress (furthest slice reached) stays valid across sessions.

export interface Slice {
  id: string        // `${lectureId}#${n}` — stable
  n: number         // 1-based index
  total: number
  text: string      // slice body (may contain paragraph breaks as \n\n)
  empty: boolean    // true when the lecture has no real notes
}

const TARGET_WORDS = 150
const MAX_WORDS = 240
const MIN_TAIL_WORDS = 55

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0
}

function splitSentences(text: string): string[] {
  // \x01 is a placeholder for dots that must not trigger sentence splitting.
  // Replace the TRAILING dot of abbreviations (e.g. "Dr." → "Dr\x01", "e.g." → "e.g\x01")
  // and decimal separators, then restore after splitting.
  const protectedText = text
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|vs|etc|e\.g|i\.e|Fig|Eq|No|St)\./gi, m => m.slice(0, -1) + '')
    .replace(/(\d)\.(\d)/g, (_, d1, d2) => d1 + '' + d2)
  const parts = protectedText.split(/(?<=[.!?])["')\]]?\s+(?=[A-Z(0-9"'])/)
  return parts
    .map(p => p.replace(//g, '.').trim())
    .filter(Boolean)
}

export function sliceLecture(lectureId: string, title: string, content: string): Slice[] {
  const clean = (content ?? '').replace(/\r/g, '').trim()

  const hasNotes = clean.length >= 40 && clean.toLowerCase() !== title.trim().toLowerCase()
  if (!hasNotes) {
    return [{ id: `${lectureId}#1`, n: 1, total: 1, text: '', empty: true }]
  }

  const paragraphs = clean.split(/\n{2,}/).map(p => p.replace(/\n+/g, ' ').trim()).filter(Boolean)
  const paragraphMode = paragraphs.length > 1
  const blocks = paragraphMode ? paragraphs : splitSentences(clean)

  const chunks: string[] = []
  let buf: string[] = []
  let count = 0

  const flush = () => {
    if (buf.length) { chunks.push(buf.join(paragraphMode ? '\n\n' : ' ').trim()); buf = []; count = 0 }
  }

  for (const block of blocks) {
    const w = wordCount(block)
    if (w >= MAX_WORDS && buf.length === 0) { chunks.push(block.trim()); continue }
    if (count > 0 && count + w > TARGET_WORDS) flush()
    buf.push(block)
    count += w
    if (count >= MAX_WORDS) flush()
  }
  flush()

  if (chunks.length > 1 && wordCount(chunks[chunks.length - 1]) < MIN_TAIL_WORDS) {
    const tail = chunks.pop()!
    chunks[chunks.length - 1] += '\n\n' + tail
  }

  const total = chunks.length || 1
  return (chunks.length ? chunks : [clean]).map((text, i) => ({
    id: `${lectureId}#${i + 1}`,
    n: i + 1,
    total,
    text,
    empty: false,
  }))
}

export function estimateReadMinutes(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 200))
}
