import { copyFileSync, existsSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/main/persona/parse-document'

const fixturesDir = resolve('tests/fixtures/persona')

function fixturePath(name: string): string {
  return join(fixturesDir, name)
}

describe('parseDocument — real extraction (no mocks)', () => {
  it('extracts text from .txt fixture via direct read', async () => {
    const text = await parseDocument(fixturePath('hello.txt'))
    expect(text).toContain('Hello VEYRA txt fixture')
    expect(text).toContain('Senior Engineer')
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })

  it('extracts text from .md fixture via direct read', async () => {
    const text = await parseDocument(fixturePath('hello.md'))
    expect(text).toContain('VEYRA Markdown Fixture')
    expect(text).toContain('Staff Engineer at Acme Corp')
    expect(text.length).toBeGreaterThan(0)
  })

  it('extracts text from .pdf fixture via unpdf (real pdfjs-dist)', async () => {
    const text = await parseDocument(fixturePath('hello.pdf'))
    // Real extraction, not mocked: must contain the PDF's embedded text
    expect(text).toContain('Hello VEYRA PDF fixture')
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it('extracts text from .docx fixture via mammoth (real unzip+xml)', async () => {
    const text = await parseDocument(fixturePath('hello.docx'))
    expect(text).toContain('Hello VEYRA DOCX fixture')
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it('handles uppercase extensions (.PDF, .DOCX, .TXT, .MD) case-insensitively', async () => {
    // Create temp copies with uppercase extensions to prove case-insensitive detection
    // works cross-platform (Linux is case-sensitive, so the uppercase file must exist).
    const cases: Array<[string, string, string]> = [
      ['hello.pdf', 'tmp-upper.PDF', 'Hello VEYRA PDF fixture'],
      ['hello.docx', 'tmp-upper.DOCX', 'Hello VEYRA DOCX fixture'],
      ['hello.txt', 'tmp-upper.TXT', 'Hello VEYRA txt fixture'],
      ['hello.md', 'tmp-upper.MD', 'VEYRA Markdown Fixture']
    ]
    for (const [srcName, upperName, expected] of cases) {
      const src = fixturePath(srcName)
      const upper = fixturePath(upperName)
      if (!existsSync(upper)) copyFileSync(src, upper)
      try {
        const text = await parseDocument(upper)
        expect(text).toContain(expected)
      } finally {
        // keep fixture dir clean — remove the temp uppercase copy
        try {
          rmSync(upper, { force: true })
        } catch {
          void 0
        }
      }
    }
  })

  it('throws clear unsupported file type error for unknown extensions', async () => {
    const fakePng = fixturePath('hello.png')
    // Ensure the file exists so the error is about type, not ENOENT
    writeFileSync(fakePng, 'fake', 'utf8')
    try {
      await expect(parseDocument(fakePng)).rejects.toThrow(/unsupported file type/i)
      await expect(parseDocument(fakePng)).rejects.toThrow(/\.png/)
    } finally {
      rmSync(fakePng, { force: true })
    }

    // No extension
    const noExt = fixturePath('hello-noext')
    writeFileSync(noExt, 'fake', 'utf8')
    try {
      await expect(parseDocument(noExt)).rejects.toThrow(/unsupported file type/i)
    } finally {
      rmSync(noExt, { force: true })
    }

    // .exe
    const exe = fixturePath('hello.exe')
    writeFileSync(exe, 'fake', 'utf8')
    try {
      await expect(parseDocument(exe)).rejects.toThrow(/unsupported file type/i)
      await expect(parseDocument(exe)).rejects.toThrow(/\.exe/)
    } finally {
      rmSync(exe, { force: true })
    }
  })

  it('never silently returns empty for unsupported type', async () => {
    const bad = fixturePath('bad.unsupported')
    writeFileSync(bad, '', 'utf8')
    try {
      const result = parseDocument(bad)
      await expect(result).rejects.toThrow()
      // Ensure it does not resolve to empty string
      let resolved = ''
      try {
        resolved = await result
      } catch {
        void 0
      }
      expect(resolved).toBe('')
    } finally {
      rmSync(bad, { force: true })
    }
  })

  it('validates filePath at trust boundary (empty / non-string)', async () => {
    await expect(parseDocument('')).rejects.toThrow(/filePath must be a non-empty string/i)
    await expect(parseDocument('   ')).rejects.toThrow(/filePath must be a non-empty string/i)
    // @ts-expect-error intentional wrong type
    await expect(parseDocument(null as unknown as string)).rejects.toThrow(
      /filePath must be a non-empty string/i
    )
  })

  it('propagates ENOENT for missing file (visible failure, not blank)', async () => {
    const missing = fixturePath('does-not-exist-xyz.pdf')
    await expect(parseDocument(missing)).rejects.toThrow()
    // Error should mention the path or ENOENT, not silently resolve to ''
    try {
      await parseDocument(missing)
    } catch (e) {
      expect((e as Error).message.length).toBeGreaterThan(0)
    }
  })
})
