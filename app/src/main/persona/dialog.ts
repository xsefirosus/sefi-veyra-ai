import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'path'
import { parseDocument } from './parse-document'

const PICK_CHANNEL = 'dialog:pickFile'

export interface PickFileResult {
  fileName: string
  text: string
}

/**
 * Step 9: resume upload bridge.
 * Renderer calls window.api.pickFile() -> main shows open dialog (pdf/docx/txt/md),
 * reads + parses via parse-document (real extraction, not mocked), returns
 * {fileName, text} or null if cancelled. Parse failures throw with a visible
 * message — never silently return empty text (approach decision: visible failure).
 */
export function registerDialogHandler(): void {
  ipcMain.handle(PICK_CHANNEL, async (): Promise<PickFileResult | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
    const result = await dialog.showOpenDialog(win as unknown as Electron.BrowserWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]!
    // Trust boundary: parseDocument validates filePath + extension
    const text = await parseDocument(filePath)
    return { fileName: basename(filePath), text }
  })
}
