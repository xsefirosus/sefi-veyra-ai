/**
 * TranscriptPanel (plan step 18): presentational rendering of reducer lines.
 *
 * Two variants, same data source (useTranscript):
 *   - 'panel': the settings window's transcript panel -- full committed list
 *     plus any in-flight partials, scrollable.
 *   - 'overlay': the 640x120 frameless always-on-top overlay -- the live tail
 *     only (partials italic/grey = in-flight revision, finals solid =
 *     committed), clipped to one line each.
 *
 * Speaker tags render only when the speaker is known ('me'/'other'); 'unknown'
 * lines (all of them until plan step 20) show no tag.
 */
import type { TranscriptLine } from './transcript-reducer'

interface TranscriptPanelProps {
  lines: TranscriptLine[]
  variant: 'panel' | 'overlay'
}

/** How many of the most recent lines the overlay shows (fits 120px). */
const OVERLAY_TAIL = 3

function SpeakerTag({ speaker }: { speaker: TranscriptLine['speaker'] }): React.JSX.Element | null {
  if (speaker === 'unknown') return null
  return <span className="transcript-speaker">{speaker}</span>
}

function TranscriptPanel({ lines, variant }: TranscriptPanelProps): React.JSX.Element {
  if (variant === 'overlay') {
    const tail = lines.slice(-OVERLAY_TAIL)
    return (
      <div className="overlay-screen" role="status" aria-live="polite">
        {tail.length === 0 ? (
          <p className="overlay-empty">Listening…</p>
        ) : (
          tail.map((l) => (
            <p key={`${l.kind}-${l.seq}`} className={`overlay-line ${l.kind}`}>
              <SpeakerTag speaker={l.speaker} />
              {l.text}
            </p>
          ))
        )}
      </div>
    )
  }

  return (
    <section className="transcript-panel" aria-label="Transcript">
      <h2 className="transcript-heading">Transcript</h2>
      {lines.length === 0 ? (
        <p className="transcript-empty">No transcript yet.</p>
      ) : (
        <ul className="transcript-lines">
          {lines.map((l, i) => (
            <li key={i} className={`transcript-line ${l.kind}`}>
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
