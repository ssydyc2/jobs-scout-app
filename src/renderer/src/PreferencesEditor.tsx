import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FileJson, LoaderCircle, Save, X } from 'lucide-react'
import type { ConfigDocument, ConfigDraft } from '../../shared/types'
import { parseConfig } from '../../shared/validation'

export default function PreferencesEditor({ draft, onSaved, onClose }: {
  draft: ConfigDraft
  onSaved(document: ConfigDocument): void
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [content, setContent] = useState(draft.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = content !== draft.content

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving || !window.scout) return
    setError(null)
    try { parseConfig(content) }
    catch (error) { setError(error instanceof Error ? error.message : 'Invalid JSON preferences.'); return }
    setSaving(true)
    try {
      const reply = await window.scout.saveConfig({ path: draft.path, content, originalContent: draft.content })
      if (!reply.ok) { setError(reply.error); return }
      onSaved(reply.data)
    } catch { setError('Could not save your preferences. Please try again.') }
    finally { setSaving(false) }
  }

  return <dialog ref={dialog} className="preferences-dialog" aria-labelledby="preferences-editor-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}>
    <form onSubmit={(event) => void save(event)}>
      <div className="editor-heading"><div><FileJson size={20} /><h2 id="preferences-editor-title">Edit {draft.path.split('/').pop()}</h2></div><button type="button" aria-label="Close preferences editor" disabled={saving} onClick={onClose}><X size={19} /></button></div>
      <div className="editor-body">
        <p>Edit your JSON preferences below. Save changes updates this file directly.</p>
        <span className="editor-path" title={draft.path}>{draft.path}</span>
        <textarea aria-label="Preferences JSON" value={content} onChange={(event) => { setContent(event.target.value); setError(null) }} autoFocus spellCheck={false} autoCapitalize="off" disabled={saving} />
        {error && <div className="alert error" role="alert">{error}</div>}
      </div>
      <div className="editor-footer"><span>{dirty ? 'Unsaved changes' : 'Saved version'} · API keys stay out of this file</span><div><button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !dirty}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}Save changes</button></div></div>
    </form>
  </dialog>
}
