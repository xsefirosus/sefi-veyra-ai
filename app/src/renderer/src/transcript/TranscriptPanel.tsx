/**
 * TranscriptPanel (plan step 18): presentational rendering of reducer lines.
 *
 * Two variants, same data source (useTranscript):
 *   - 'panel': the settings window's transcript panel -- full committed list
 *     plus any in-flight partials, scrollable. Step 16(b): text is selectable
 *     with a one-click Copy affordance; step 16(d): pinned to bottom on new
 *     lines unless the reader scrolled up.
 *   - 'overlay': the frameless always-on-top overlay -- the live tail
 *     only (partials italic/grey = in-flight revision, finals solid =
 *     committed), clipped to one line each. Step 16(a): the whole surface is
 *     a drag region so the window can be moved.
 *
 * Speaker tags render only when the speaker is known ('me'/'other'); 'unknown'
 * lines show no tag.
 */
import { useEffect, useRef, useState } from 'react'
import type { TranscriptLine } from './transcript-reducer'
import type { SessionStatus } from '../session/session-status'
import { overlayEmptyLabel } from '../session/session-status'
import { transcriptToText, copyTranscript } from './transcript-copy'
import { isNearBottom, scrollToBottom } from './auto-scroll'

interface TranscriptPanelProps {
  lines: TranscriptLine[]
  variant: 'panel' | 'overlay'
  sessionStatus?: SessionStatus
}

/** How many of the most recent lines the overlay shows (fits 120px). */
const OVERLAY_TAIL = 3

function SpeakerTag({ speaker }: { speaker: TranscriptLine['speaker'] }): React.JSX.Element | null {
  if (speaker === 'unknown') return null
  return <span className="transcript-speaker">{speaker}</span>
}

function TranscriptPanel({
  lines,
  variant,
  sessionStatus
}: TranscriptPanelProps): React.JSX.Element {
  if (variant === 'overlay') {
    const tail = lines.slice(-OVERLAY_TAIL)
    const emptyText = sessionStatus
      ? overlayEmptyLabel(sessionStatus)
      : 'Idle \u2014 press Start listening'
    const isError = sessionStatus?.state === 'error'
    return (
      <div className="overlay-screen" role="status" aria-live="polite">
        {tail.length === 0 ? (
          <p className={`overlay-empty ${isError ? 'overlay-empty--error' : ''}`}>{emptyText}</p>
        ) : (
          tail.map((l) => (
            <p key={l.segmentId} className={`overlay-line ${l.kind}`}>
              <SpeakerTag speaker={l.speaker} />
              {l.text}
            </p>
          ))
        )}
      </div>
    )
  }

  return <PanelVariant lines={lines} />
}

/**
 * The settings-window panel variant. Split into its own component so the
 * hooks below are unconditional (the overlay variant returns early).
 */
function PanelVariant({ lines }: { lines: TranscriptLine[] }): React.JSX.Element {
  // Step 16(d): pin-to-bottom unless the user scrolled up.
  const listRef = useRef<HTMLUListElement | null>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom(listRef.current)
  }, [lines])

  // Step 16(b): copy affordance for the committed transcript.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const WINDOW = 200
  const visible = lines.length > WINDOW ? lines.slice(-WINDOW) : lines
  const hasCommitted = visible.some((l) => l.kind === 'final')

  const onCopy = (): void => {
    void copyTranscript(transcriptToText(visible)).then((ok) => {
      setCopyState(ok ? 'copied' : 'failed')
      setTimeout(() => setCopyState('idle'), 2000)
    })
  }

  return (
    <section className="transcript-panel" aria-label="Transcript">
      <div className="transcript-header">
        <h2 className="transcript-heading">Transcript</h2>
        <button type="button" className="transcript-copy" onClick={onCopy} disabled={!hasCommitted}>
          Copy
        </button>
        <span className="transcript-copy-status" role="status">
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : ''}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="transcript-empty">No transcript yet.</p>
      ) : (
        <ul
          ref={listRef}
          className="transcript-lines"
          onScroll={() => {
            const el = listRef.current
            if (!el) return
            pinnedRef.current = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight)
          }}
        >
          {visible.map((l) => (
            <li key={l.segmentId} className={`transcript-line ${l.kind}`}>
              <SpeakerTag speaker={l.speaker} />
              <span className="transcript-text">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default TranscriptPanel
