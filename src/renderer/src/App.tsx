import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, Compass, Copy, Eye, EyeOff, FileJson, FolderOpen, Globe2, LoaderCircle, MapPin, PencilLine, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import type { CompanyLibrary, CompanySort, ConfigDocument, ConfigDraft, DiscoveryMode, JobSearchResult, ScoutConfig, SearchProgress, SearchResult } from '../../shared/types'
import { parseConfig } from '../../shared/validation'
import { DEFAULT_MODEL } from '../../shared/models'
import { formatUsd, sortCompanies } from '../../shared/company-value'
import PreferencesEditor from './PreferencesEditor'
import JobResults from './JobResults'
import { JOB_INTEREST_PRESETS, jobInterestKey } from '../../shared/job-matching'
import { discoveryConfig, DISCOVERY_MODES } from '../../shared/discovery'
import pandaLogo from '../../../build/icon.svg'
import { version } from '../../../package.json'

const api = window.scout
const splitPreferences = (value: string) => [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))]
type PreferenceFields = Partial<Pick<ScoutConfig, 'interests' | 'roles' | 'locations' | 'jobInterests'>>

export default function App() {
  const [view, setView] = useState<'companies' | 'jobs'>('companies')
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('interest_areas')
  const [library, setLibrary] = useState<CompanyLibrary | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [interestsInput, setInterestsInput] = useState('')
  const [preferenceSaving, setPreferenceSaving] = useState(false)
  const [preferenceError, setPreferenceError] = useState<string | null>(null)
  const preferenceSaves = useRef<Promise<boolean>>(Promise.resolve(true))
  const pendingPreferenceSaves = useRef(0)
  const [jobRoles, setJobRoles] = useState('')
  const [jobLocations, setJobLocations] = useState('')
  const [jobInterests, setJobInterests] = useState('')
  const [jobResult, setJobResult] = useState<JobSearchResult | null>(null)
  const [document, setDocument] = useState<ConfigDocument | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [companiesPerCategory, setCompaniesPerCategory] = useState('100')
  const [sort, setSort] = useState<CompanySort>('value_desc')
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [webSearch, setWebSearch] = useState(true)
  const [busy, setBusy] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [progress, setProgress] = useState<SearchProgress | null>(null)
  const [visibleCount, setVisibleCount] = useState(60)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  async function loadConfig(action: 'getConfig' | 'chooseConfig' | 'saveExample' = 'getConfig') {
    if (!api) return
    setConfigBusy(true)
    setError(null)
    try {
      const reply = await api[action]()
      if (!reply.ok) { setError(reply.error); if (action === 'getConfig') setDocument(null); return }
      if (reply.data) {
        setDocument(reply.data)
        setInterestsInput(reply.data.config.interests.join('\n'))
        setPreferenceError(null)
        setJobRoles(reply.data.config.roles.join(', '))
        setJobLocations(reply.data.config.locations.join(', '))
        setJobInterests(reply.data.config.jobInterests.join(', '))
        setCompaniesPerCategory(String(reply.data.config.companiesPerCategory))
        setResult(null)
        setDemo(false)
        setFilter('All')
        setQuery('')
        setNotice(action === 'saveExample' ? 'Example saved and loaded. Click Edit in the preference card to customize it.' : null)
      }
    } catch { setError('Could not connect to the desktop app. Please reopen Jobs Scout.') }
    finally { setConfigBusy(false) }
  }

  useEffect(() => {
    void loadConfig()
    if (api) void api.getLibrary().then((reply) => {
      if (reply.ok) { setLibrary(reply.data); setShowLibrary(reply.data.companies.length > 0) }
      else setError(reply.error)
    }).catch(() => setError('Could not load the local company library.'))
  }, [])
  useEffect(() => api?.onLibraryChanged(setLibrary), [])
  useEffect(() => api?.onJobProgress((next) => setJobResult(next.result)), [])
  useEffect(() => api?.onProgress((next) => {
    setProgress(next)
    if (next.result.companies.length) setResult(next.result)
  }), [])

  async function editConfig() {
    if (!api || busy || configBusy) return
    setConfigBusy(true)
    setError(null)
    try {
      const reply = await api.editConfig()
      if (reply.ok) setDraft(reply.data)
      else setError(reply.error)
    } catch { setError('Could not open the preference editor. Please try again.') }
    finally { setConfigBusy(false) }
  }

  function preferencesSaved(document: ConfigDocument) {
    setDocument(document)
    setInterestsInput(document.config.interests.join('\n'))
    setPreferenceError(null)
    setJobRoles(document.config.roles.join(', '))
    setJobLocations(document.config.locations.join(', '))
    setJobInterests(document.config.jobInterests.join(', '))
    setCompaniesPerCategory(String(document.config.companiesPerCategory))
    setDraft(null)
    setResult(null)
    setDemo(false)
    setFilter('All')
    setQuery('')
    setNotice('Preferences saved. Your next search will use these changes.')
  }

  function savePreferenceFields(fields: PreferenceFields): Promise<boolean> {
    if (!api || !document) return Promise.resolve(false)
    // Unchanged controls must not overwrite edits made in an external file editor.
    if (!pendingPreferenceSaves.current && Object.entries(fields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(document.config[key as keyof PreferenceFields]))) {
      setPreferenceError(null)
      return Promise.resolve(true)
    }
    const expectedPath = document.path
    pendingPreferenceSaves.current++
    setPreferenceSaving(true)
    const save = preferenceSaves.current.then(async () => {
      try {
        const draft = await api.editConfig()
        if (!draft.ok) throw new Error(draft.error)
        if (draft.data.path !== expectedPath) throw new Error('The preference file changed. Reload your preferences before editing.')
        parseConfig(draft.data.content)
        const raw = JSON.parse(draft.data.content.replace(/^\uFEFF/, ''))
        // Keep old files readable, and retire the company-stage field when saving an inline edit.
        delete raw.companyStage
        const cleaned = JSON.stringify({ ...raw, ...fields }, null, 2) + '\n'
        const config = parseConfig(cleaned)
        if (cleaned !== draft.data.content) {
          const reply = await api.saveConfig({ ...draft.data, content: cleaned, originalContent: draft.data.content })
          if (!reply.ok) throw new Error(reply.error)
          setDocument(reply.data)
        } else setDocument((current) => current ? { ...current, config } : current)
        setPreferenceError(null)
        return true
      } catch (error) {
        setPreferenceError(error instanceof Error ? error.message : 'Could not save your preferences.')
        return false
      } finally {
        pendingPreferenceSaves.current--
        setPreferenceSaving(pendingPreferenceSaves.current > 0)
      }
    })
    preferenceSaves.current = save
    return save
  }

  function saveSidebarPreferences() {
    if (busy || !document) return
    void savePreferenceFields(view === 'companies'
      ? { interests: splitPreferences(interestsInput) }
      : { roles: splitPreferences(jobRoles), locations: splitPreferences(jobLocations), jobInterests: splitPreferences(jobInterests) })
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!api || !document || busy || !apiKey.trim()) return
    const count = Number(companiesPerCategory)
    if (!Number.isInteger(count) || count < 1 || count > 100) { setError('Choose between 1 and 100 companies per category.'); return }
    if (discoveryMode === 'interest_areas') {
      try { parseConfig(JSON.stringify({ ...document.config, interests: splitPreferences(interestsInput) })) }
      catch (error) { setPreferenceError(error instanceof Error ? error.message : 'Check your interests.'); return }
    }
    const options = { apiKey: apiKey.trim(), model: model.trim(), webSearch, companiesPerCategory: count, discoveryMode }
    setApiKey('')
    setShowKey(false)
    setBusy(true)
    setCancelling(false)
    setError(null)
    setNotice(null)
    setCopied(false)
    setResult(null)
    setShowLibrary(false)
    setProgress(null)
    setDemo(false)
    setFilter('All')
    setQuery('')
    setVisibleCount(60)
    try {
      if (discoveryMode === 'interest_areas') {
        if (!await savePreferenceFields({ interests: splitPreferences(interestsInput) })) return
      } else await preferenceSaves.current
      const reply = await api.search(options)
      if (!reply.ok) {
        if (reply.cancelled) setNotice('Search cancelled. Collected companies remain available.')
        else setError(reply.error)
        return
      }
      const refreshed = await api.getConfig()
      if (refreshed.ok) { setDocument(refreshed.data); setInterestsInput(refreshed.data.config.interests.join('\n')) }
      setResult(reply.data)
      setDemo(false)
    } catch { setError('Search connection interrupted. Enter your key again and retry.') }
    finally { setBusy(false); setCancelling(false) }
  }

  async function findJobs(event: FormEvent) {
    event.preventDefault()
    if (!api || !document || busy || !apiKey.trim() || !library?.companies.length) return
    const options = { apiKey: apiKey.trim(), model: model.trim(), webSearch: true, roles: splitPreferences(jobRoles), locations: splitPreferences(jobLocations), jobInterests: splitPreferences(jobInterests) }
    try { parseConfig(JSON.stringify({ ...document.config, roles: options.roles, locations: options.locations, jobInterests: options.jobInterests })) }
    catch (error) { setPreferenceError(error instanceof Error ? error.message : 'Check your job preferences.'); return }
    setApiKey('')
    setShowKey(false)
    setBusy(true)
    setCancelling(false)
    setError(null)
    setNotice(null)
    setJobResult(null)
    try {
      if (!await savePreferenceFields({ roles: options.roles, locations: options.locations, jobInterests: options.jobInterests })) return
      const reply = await api.searchJobs(options)
      if (reply.ok) setJobResult(reply.data)
      else if (reply.cancelled) setNotice('Job search cancelled. Collected listings remain available.')
      else setError(reply.error)
    } catch { setError('Job search connection interrupted. Enter your key again and retry.') }
    finally { setBusy(false); setCancelling(false) }
  }

  async function cancel() {
    if (!api) return
    setCancelling(true)
    try {
      const reply = await api.cancelSearch()
      if (!reply.ok) { setError(reply.error); setCancelling(false) }
    } catch { setError('Could not cancel the search. Please try again.'); setCancelling(false) }
  }

  async function openLink(url: string) {
    if (!api) return
    try { const reply = await api.openLink(url); if (!reply.ok) setError(reply.error) }
    catch { setError('Could not open the link. Please try again.') }
  }

  function showExample() {
    if (!document) return
    const interests = document.config.interests
    const exampleCompanies: SearchResult['companies'] = [
        { name: 'Northstar Finance', category: interests[0], categories: [interests[0]], website: null, description: 'Builds AI analytics and automation tools for finance teams.', reason: 'An example of how a company could match your AI and finance interests.', relevantRoles: ['Software Engineer', 'AI Engineer'], location: '', sourceUrls: [], value: { kind: 'valuation', amountUsd: 1200000000, asOf: '2026', sourceUrl: null } },
        { name: 'Helix Health', category: interests[1] || interests[0], categories: [interests[1] || interests[0]], website: null, description: 'Explores AI applications in clinical workflows and healthcare data.', reason: 'An example of how industry interests and preferred roles come together.', relevantRoles: ['AI Engineer'], location: '', sourceUrls: [], value: { kind: 'market_cap', amountUsd: 3400000000, asOf: '2026', sourceUrl: null } },
        { name: 'Ledger Studio', category: interests[0], categories: [interests[0]], website: null, description: 'Uses AI assistants to improve business finance workflows.', reason: 'Another example of a company to explore based on your interests.', relevantRoles: ['Software Engineer'], location: '', sourceUrls: [], value: null }
      ]
    setResult({
      config: document.config,
      categoryCounts: document.config.interests.map((category) => ({ category, count: exampleCompanies.filter((company) => company.categories.includes(category)).length, target: document.config.companiesPerCategory })),
      incomplete: false, sources: [], webSearch: false, webSearchUsed: false, model: '', searchedAt: new Date().toISOString(), warning: null, companies: exampleCompanies
    })
    setDemo(true)
    setShowLibrary(false)
    setFilter('All')
    setQuery('')
    setError(null)
    setNotice(null)
    setCopied(false)
  }

  const config = document?.config
  const sidebarDirty = !!config && (view === 'companies'
    ? discoveryMode === 'interest_areas' && JSON.stringify(splitPreferences(interestsInput)) !== JSON.stringify(config.interests)
    : JSON.stringify(splitPreferences(jobRoles)) !== JSON.stringify(config.roles) || JSON.stringify(splitPreferences(jobLocations)) !== JSON.stringify(config.locations) || JSON.stringify(splitPreferences(jobInterests)) !== JSON.stringify(config.jobInterests))
  const displayingDemo = demo && !showLibrary
  const savedCategories = [...new Set(library?.companies.flatMap((company) => company.categories) || [])]
  const shownResult: SearchResult | null = showLibrary && library?.companies.length && config ? {
    companies: library.companies, sources: [], searchedAt: library.updatedAt || new Date().toISOString(), model: 'Local library', webSearch: false, webSearchUsed: false,
    config: { ...config, interests: savedCategories }, incomplete: false, warning: null,
    categoryCounts: savedCategories.map((category) => ({ category, count: library.companies.filter((company) => company.categories.includes(category)).length, target: 0 }))
  } : result
  const categories = ['All', ...(shownResult?.config.interests || [])]
  const companies = sortCompanies(shownResult?.companies.filter((company) =>
    (filter === 'All' || company.categories.includes(filter)) &&
    `${company.name} ${company.description} ${company.reason}`.toLowerCase().includes(query.toLowerCase())
  ) || [], sort)
  const validCount = Number.isInteger(Number(companiesPerCategory)) && Number(companiesPerCategory) >= 1 && Number(companiesPerCategory) <= 100
  const collectedCount = progress?.result.categoryCounts.reduce((sum, category) => sum + category.count, 0) || 0
  const targetCount = (config ? discoveryConfig(config, discoveryMode).interests.length : 0) * Number(companiesPerCategory)

  async function copyNames() {
    if (!api) return
    try {
      const reply = await api.copyNames(companies.map((company) => company.name))
      if (!reply.ok) { setError(reply.error); return }
      setCopied(true)
    } catch { setError('Could not copy company names. Please select and copy them manually.') }
  }

  return (
    <div className="app-shell">
      <header className="titlebar"><span>Jobs Scout</span><span className="version">Build your company library <span>v{version}</span></span></header>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src={pandaLogo} alt="Panda holding a magnifying glass" /></div><div>Jobs Scout<small>Find your next chapter.</small></div></div>
        <nav aria-label="Main navigation">
          <button className={`nav-item ${view === 'companies' ? 'active' : ''}`} aria-label="Company discovery" aria-current={view === 'companies' ? 'page' : undefined} disabled={busy} onClick={() => { setView('companies'); setError(null); setNotice(null) }}><Compass size={18} />Find companies<ArrowRight className="nav-arrow" size={15} /></button>
          <button className={`nav-item ${view === 'jobs' ? 'active' : ''}`} aria-label="Job search" aria-current={view === 'jobs' ? 'page' : undefined} disabled={busy} onClick={() => { setView('jobs'); setError(null); setNotice(null) }}><BriefcaseBusiness size={18} />Find jobs<ArrowRight className="nav-arrow" size={15} /></button>
        </nav>
        <div className="sidebar-heading"><span>{view === 'companies' ? 'COMPANY DISCOVERY' : 'JOB PREFERENCES'}</span><SlidersHorizontal size={14} /></div>
        {view === 'companies' && <fieldset className="discovery-modes"><legend>Discover by</legend>{DISCOVERY_MODES.map((mode) => <button type="button" key={mode.value} aria-pressed={discoveryMode === mode.value} className={discoveryMode === mode.value ? 'selected' : ''} disabled={busy} onClick={() => { setDiscoveryMode(mode.value); setError(null) }}>{mode.label}{discoveryMode === mode.value && <Check size={13} />}</button>)}</fieldset>}
        <div className="config-card">
          <div className="file-header"><FileJson size={19} /><div><strong>{document ? document.path.split('/').pop() : 'No file loaded'}</strong><span>{document?.isExample ? 'Built-in example' : 'Saved preferences'}</span><b className="file-dot" /></div></div>
          <p className="config-name">{config?.name || 'Import a file to define your direction'}</p>
          {view === 'companies' ? discoveryMode === 'interest_areas' ? <div className="sidebar-field"><label htmlFor="interests">Interests</label><textarea id="interests" value={interestsInput} onChange={(event) => { setInterestsInput(event.target.value); setPreferenceError(null) }} onBlur={saveSidebarPreferences} disabled={busy || configBusy || !document} placeholder={'AI + finance\nAI + healthcare'} rows={3} /><p>One interest per line. Changes save automatically.</p></div> : <p className="preset-description">{discoveryMode === 'top_ai_startups' ? 'Leading AI startups across models, infrastructure, and applications.' : 'Major technology companies across software, cloud, hardware, and internet services.'}</p> : <>
            <div className="sidebar-field"><label htmlFor="job-roles">Job titles / roles</label><textarea id="job-roles" value={jobRoles} onChange={(event) => { setJobRoles(event.target.value); setPreferenceError(null) }} onBlur={saveSidebarPreferences} disabled={busy || configBusy || !document} placeholder="Software Engineer, AI Engineer" rows={2} /></div>
            <div className="sidebar-field"><label htmlFor="job-locations">Locations</label><textarea id="job-locations" value={jobLocations} onChange={(event) => { setJobLocations(event.target.value); setPreferenceError(null) }} onBlur={saveSidebarPreferences} disabled={busy || configBusy || !document} placeholder="San Francisco, Remote" rows={2} /><p>Separate entries with commas or new lines. Blank means any.</p></div>
            <div className="sidebar-field"><label htmlFor="job-interests">Specific interests <span>Optional</span></label><div className="job-interest-presets" aria-label="Interest shortcuts">{JOB_INTEREST_PRESETS.map((interest) => { const selected = splitPreferences(jobInterests).some((value) => jobInterestKey(value) === jobInterestKey(interest)); return <button type="button" key={interest} aria-pressed={selected} disabled={busy || configBusy || !document} onClick={() => {
              const values = splitPreferences(jobInterests).filter((value) => jobInterestKey(value) !== jobInterestKey(interest))
              if (!selected) values.push(interest)
              setJobInterests(values.join(', '))
              void savePreferenceFields({ jobInterests: values, roles: splitPreferences(jobRoles), locations: splitPreferences(jobLocations) })
            }}>{interest}{selected && <Check size={11} />}</button> })}</div><textarea id="job-interests" value={jobInterests} onChange={(event) => { setJobInterests(event.target.value); setPreferenceError(null) }} onBlur={saveSidebarPreferences} disabled={busy || configBusy || !document} placeholder="Post training, Agent, LLM infra, RL" rows={2} /><p>Matching jobs appear first. Add your own interests with commas or new lines.</p></div>
          </>}
          {view === 'companies' && discoveryMode === 'interest_areas' && config?.notes && <p className="config-note">{config.notes}</p>}
          {preferenceError && <div className="alert error preference-error" role="alert">{preferenceError}</div>}
          <div className="config-meta"><span role="status">{preferenceSaving ? 'Saving…' : preferenceError ? 'Changes not saved' : sidebarDirty ? 'Unsaved changes' : 'Saved locally'}</span><div className="config-actions"><button aria-label="Edit preferences" title="Edit preference file" disabled={busy || configBusy || preferenceSaving || !api} onClick={() => void editConfig()}><PencilLine size={13} />Edit file</button><button aria-label="Reload preferences" title="Reload preferences" disabled={busy || configBusy || preferenceSaving} onClick={() => void loadConfig()}><RefreshCw size={14} className={configBusy ? 'spin' : ''} /></button></div></div>
        </div>
        <button className="outline-button import-button" disabled={busy || configBusy || preferenceSaving || !api} onClick={() => void loadConfig('chooseConfig')}><FolderOpen size={16} />Import preferences</button>
        <button className="text-button" disabled={busy || configBusy || preferenceSaving || !api} onClick={() => void loadConfig('saveExample')}><ArrowDownToLine size={14} />Save example copy</button>
        {document && <p className="file-path" title={document.path}>{document.path}</p>}
        <div className="sidebar-footer"><ShieldCheck size={16} /><div>Your preferences stay local<small>Shared with GLM only when you search</small></div></div>
      </aside>
      <main>
        <div className="page-heading"><div><span className="eyebrow"><span className="tiny-dot" />YOUR NEXT CHAPTER</span><h1>{view === 'companies' ? 'Build your company library.' : 'Find jobs at your companies.'}</h1><p className="intro">{view === 'companies' ? 'Keep discovering. Every new company is saved for your next job search.' : 'Search your saved companies by role and location.'}</p></div><span className="mode-badge"><Sparkles size={14} />{view === 'companies' ? 'AI company discovery' : 'Jobs from web sources'}</span></div>
        <div className="library-summary"><div><FileJson size={18} /><span><strong>{library?.companies.length || 0} saved companies</strong><small title={library?.path}>Local company library · Deduplicated automatically</small></span></div>{view === 'companies' && !!library?.companies.length && <button className="outline-button" disabled={busy} onClick={() => { setShowLibrary(!showLibrary); setFilter('All'); setQuery(''); setVisibleCount(60); setCopied(false) }}>{showLibrary ? 'View latest search' : 'View saved companies'}</button>}</div>
        <form className="search-panel" onSubmit={(event) => void (view === 'companies' ? search(event) : findJobs(event))}>
          <div className="search-panel-heading"><div className="small-icon"><Search size={19} /></div><div><h2>{view === 'companies' ? `Discover companies · ${DISCOVERY_MODES.find((mode) => mode.value === discoveryMode)?.label}` : 'Search your company library'}</h2><p>{view === 'companies' ? 'Search broadly. Saved companies are excluded so each search adds new names.' : `Search all ${library?.companies.length || 0} saved companies using your sidebar preferences.`}</p></div></div>
          <div className="input-row">
            <div className="key-field"><label htmlFor="api-key">GLM API key <span>For this search only</span></label><div className="password-input"><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={busy} placeholder="Enter your Zhipu AI API key" autoComplete="off" spellCheck={false} /><button type="button" aria-label={showKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowKey(!showKey)} disabled={busy}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            <div className="model-field"><label htmlFor="model">Model</label><input id="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} /></div>
            {view === 'companies' && <div className="count-field"><label htmlFor="company-count">Per category</label><input id="company-count" type="number" min={1} max={100} step={1} value={companiesPerCategory} onChange={(e) => setCompaniesPerCategory(e.target.value)} disabled={busy} /></div>}
            <button className="primary-button search-button" type="submit" disabled={!api || configBusy || busy || !apiKey.trim() || !model.trim() || (view === 'companies' ? !document || !validCount : !library?.companies.length)}>{busy ? <><LoaderCircle className="spin" size={17} />Searching</> : <><Search size={17} />{view === 'companies' ? 'Find companies' : 'Find jobs'}<ArrowRight size={16} /></>}</button>
          </div>
          <div className="search-bottom">{view === 'companies' ? <label className="toggle-label"><input type="checkbox" checked={webSearch} disabled={busy} onChange={(e) => setWebSearch(e.target.checked)} /><Globe2 size={14} />Web search<span>Include sources &amp; reported values</span></label> : <span className="toggle-label"><Globe2 size={14} />Web search required</span>}<span className="privacy-note"><ShieldCheck size={13} />Key is never saved · API fees may apply</span></div>
        </form>
        {!api && <div className="alert error" role="alert">Launch the desktop app with npm run dev. A browser preview cannot read files or call GLM.</div>}
        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
        {notice && <div className="alert notice" role="status">{notice}</div>}
        {busy && <div className="search-progress" role="status"><img src={pandaLogo} alt="" /><div><h3>{cancelling ? 'Stopping search…' : view === 'jobs' ? 'Searching saved companies' : progress?.phase === 'values' ? 'Checking reported values' : 'Collecting companies'}</h3><p>{view === 'jobs' ? `${jobResult?.companiesChecked || 0} of ${jobResult?.totalCompanies || library?.companies.length || 0} companies checked` : progress?.phase === 'values' ? `${progress.valuesChecked} of ${result?.companies.length || 0} companies checked` : `${collectedCount} of ${targetCount} category matches collected`}</p><progress aria-label="Search progress" value={view === 'jobs' ? jobResult?.companiesChecked || 0 : progress?.phase === 'values' ? progress.valuesChecked : collectedCount} max={view === 'jobs' ? Math.max(1, jobResult?.totalCompanies || library?.companies.length || 0) : progress?.phase === 'values' ? Math.max(1, result?.companies.length || 0) : Math.max(1, targetCount)} /></div><button className="outline-button" disabled={cancelling} onClick={() => void cancel()}>Cancel search</button></div>}
        {view === 'jobs' ? <JobResults key={jobResult?.searchedAt || 'empty'} result={jobResult} busy={busy} onOpen={(url) => void openLink(url)} /> : shownResult ? <section className="results" aria-label="Company results">
          <div className="results-heading"><div><h2>{displayingDemo ? 'A preview of your catalog' : showLibrary ? 'Your saved companies' : 'Companies from this search'}<span>{shownResult.companies.length}</span></h2><p>{displayingDemo ? 'Preview · Fictional companies and values, no AI call' : showLibrary ? 'Saved locally · Available across searches and restarts' : `${new Date(shownResult.searchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${shownResult.model} · ${shownResult.webSearchUsed ? 'Web sources used' : shownResult.webSearch ? 'Web search unavailable · Model recommendations' : 'Model recommendations'}`}</p></div><button className="outline-button" disabled={!companies.length} onClick={() => void copyNames()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy company names'}</button></div>
          {displayingDemo && <div className="alert notice">These companies and values are fictional examples.</div>}
          {shownResult.warning && <div className="alert warning">{shownResult.warning}</div>}
          <div className="results-tools"><div className="filter-chips" aria-label="Filter by interest">{categories.map((category) => { const count = shownResult.categoryCounts.find((item) => item.category === category); return <button key={category} className={filter === category ? 'selected' : ''} onClick={() => { setFilter(category); setVisibleCount(60); setCopied(false) }}>{category}<span>{count ? showLibrary ? count.count : `${count.count}/${count.target}` : shownResult.companies.length}</span></button> })}</div><div className="result-controls"><label className="sort-control">Sort<select aria-label="Sort companies" value={sort} onChange={(e) => { setSort(e.target.value as CompanySort); setVisibleCount(60); setCopied(false) }}><option value="value_desc">Value: high to low</option><option value="value_asc">Value: low to high</option><option value="match">Best match</option></select></label><div className="result-search"><Search size={14} /><input aria-label="Filter companies by name or description" value={query} onChange={(e) => { setQuery(e.target.value); setVisibleCount(60); setCopied(false) }} placeholder="Filter companies…" /></div></div></div>
          <div className="company-grid">{companies.slice(0, visibleCount).map((company, index) => <article className="company-card" key={company.name}>
            <div className="company-top"><div className={`company-avatar tone-${index % 3}`}>{company.name.slice(0, 1).toUpperCase()}</div><div className="chips">{company.categories.map((category) => <span className="chip green" key={category}>{category}</span>)}</div></div>
            <h3>{company.name}</h3><p className="company-description">{company.description}</p>
            <div className={company.value ? 'company-value' : 'company-value unknown'}>{company.value ? <><div><strong>{formatUsd(company.value.amountUsd)}</strong><span>{displayingDemo ? 'Example ' : ''}{company.value.kind === 'market_cap' ? 'Market cap' : 'Valuation'} · {company.value.asOf}</span></div>{company.value.sourceUrl && <button className="inline-link" aria-label={`Value source for ${company.name}`} onClick={() => void openLink(company.value!.sourceUrl!)}>Source<ArrowUpRight size={13} /></button>}</> : <div><strong>Unknown</strong><span>Reported value unavailable</span></div>}</div>
            <div className="match-reason"><Sparkles size={13} /><p>{company.reason}</p></div>
            {company.relevantRoles.length > 0 && <div className="role-tags">{company.relevantRoles.map((role) => <span key={role}>{role}</span>)}</div>}
            <div className="company-bottom"><span>{company.location ? <><MapPin size={12} />{company.location}</> : 'Location unverified'}</span>{company.website && <button className="inline-link" onClick={() => void openLink(company.website!)}>Website<ArrowUpRight size={14} /></button>}</div>
            <div className="source-row">{company.sourceUrls.length > 0 ? <details><summary>Sources: {company.sourceUrls.length}</summary>{company.sourceUrls.map((url) => <button className="source-link" key={url} onClick={() => void openLink(url)}>{new URL(url).hostname}<ArrowUpRight size={12} /></button>)}</details> : <span>AI recommendation · Details unverified</span>}<span>Hiring unverified</span></div>
          </article>)}</div>
          {companies.length > visibleCount && <div className="show-more"><span>Showing {visibleCount} of {companies.length} companies</span><button className="outline-button" onClick={() => setVisibleCount((count) => count + 60)}>Show 60 more</button></div>}
          {!companies.length && <div className="empty-results"><Search size={25} /><h3>{shownResult.companies.length ? 'No companies match your filters' : 'No matching companies this time'}</h3><p>{shownResult.companies.length ? 'Try another keyword or interest.' : 'Try another discovery mode or broader interests. Matching companies may already be saved.'}</p></div>}
          {shownResult.sources.length > 0 && <details className="all-sources"><summary>Search references · {shownResult.sources.length > 100 ? `First 100 of ${shownResult.sources.length}` : shownResult.sources.length}</summary>{shownResult.sources.slice(0, 100).map((source) => <button className="source-link" key={source.url} onClick={() => void openLink(source.url)}>{source.title}<ArrowUpRight size={13} /></button>)}</details>}
          <p className="result-footnote">Reported values in USD · Valuations and market caps may use different dates · Hiring unverified</p>
        </section> : !busy ? <section className="empty-state">
          <div className="discovery-art" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><div className="art-center"><img src={pandaLogo} alt="" /></div><span className="art-spark spark-one"><Sparkles size={17} /></span><span className="art-spark spark-two"><Globe2 size={17} /></span><i className="orbit-dot" /></div>
          <span className="eyebrow">GOOD COMPANIES. BETTER FIT.</span><h2>Your next great company<br />starts here.</h2><p>Define the fields you care about.<br />Let AI find the names worth getting to know.</p><button className="example-button" onClick={showExample} disabled={!document || configBusy}>Preview example results<ArrowRight size={15} /></button>
        </section> : null}
      </main>
      {draft && <PreferencesEditor draft={draft} onSaved={preferencesSaved} onClose={() => setDraft(null)} />}
    </div>
  )
}
