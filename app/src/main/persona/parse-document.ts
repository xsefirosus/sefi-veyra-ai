import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { extractText } from 'unpdf'
import mammoth from 'mammoth'

/**
 * Step 8: file parsing pipeline.
 *
 * Given an absolute file path, detect type by extension and extract plain text:
 * - .pdf  -> unpdf@1.8.1 (wraps pdfjs-dist) via extractText()
 * - .docx -> mammoth@1.12.1 via extractRawText()
 * - .txt/.md -> direct utf8 read
 * - otherwise -> throw clear "unsupported file type" error (never silently return empty)
 *
 * Pure-JS, no native rebuild (approach decision 2 / step 1 research).
 */
export async function parseDocument(filePath: string): Promise<string> {
  // Trust-boundary validation: filePath is external input from dialog/Ipc
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('parseDocument: filePath must be a non-empty string')
  }

  const ext = extname(filePath).toLowerCase()

  switch (ext) {
    case '.pdf': {
      const buf = await readFile(filePath)
      // unpdf requires Uint8Array, not Buffer (throws if Buffer passed)
      const data = new Uint8Array(buf)
      const result = await extractText(data, { mergePages: true })
      const text = Array.isArray(result.text) ? result.text.join('\n') : result.text
      return text
    }
    case '.docx': {
      const buf = await readFile(filePath)
      const result = await mammoth.extractRawText({ buffer: buf })
      return result.value
    }
    case '.txt':
    case '.md': {
      const text = await readFile(filePath, 'utf8')
      return text
    }
    default:
      throw new Error(
        `unsupported file type: ${ext || '(no extension)'} — supported: .pdf, .docx, .txt, .md`
      )
  }
}
