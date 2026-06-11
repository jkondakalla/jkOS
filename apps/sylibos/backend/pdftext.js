// pdftext.js - extract plain text from PDF buffers (assignment psets/exams
// stored as BLOBs in library.db). Thin wrapper so stems.js can be tested with
// a mock extractor.

import { extractText, getDocumentProxy } from 'unpdf'

export async function extractPdfText(buffer, maxChars = 6000) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return String(text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars)
}
