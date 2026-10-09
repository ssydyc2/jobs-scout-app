import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, Compass, Copy, Eye, EyeOff, FileJson, FolderOpen, Globe2, LoaderCircle, MapPin, PencilLine, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import type { CompanySort, ConfigDocument, ConfigDraft, SearchProgress, SearchResult } from '../../shared/types'
import { DEFAULT_MODEL } from '../../shared/models'
import { formatUsd, sortCompanies } from '../../shared/company-value'
import PreferencesEditor from './PreferencesEditor'
import pandaLogo from '../../../build/icon.svg'

const api = window.scout

export default function App() {
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

  useEffect(() => { void loadConfig() }, [])
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
    setCompaniesPerCategory(String(document.config.companiesPerCategory))
    setDraft(null)
    setResult(null)
    setDemo(false)
    setFilter('All')
    setQuery('')
    setNotice('Preferences saved. Your next search will use these changes.')
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!api || !document || busy || !apiKey.trim()) return
    const count = Number(companiesPerCategory)
    if (!Number.isInteger(count) || count < 1 || count > 100) { setError('Choose between 1 and 100 companies per category.'); return }
    const options = { apiKey: apiKey.trim(), model: model.trim(), webSearch, companiesPerCategory: count }
    setApiKey('')
    setShowKey(false)
    setBusy(true)
    setCancelling(false)
    setError(null)
    setNotice(null)
    setCopied(false)
    setResult(null)
    setProgress(null)
    setDemo(false)
    setFilter('All')
    setQuery('')
    setVisibleCount(60)
    try {
      const reply = await api.search(options)
      if (!reply.ok) {
        if (reply.cancelled) setNotice('Search cancelled. Collected companies remain available.')
        else setError(reply.error)
        return
      }
      setDocument((current) => current ? { ...current, config: { ...reply.data.config, companiesPerCategory: current.config.companiesPerCategory } } : current)
      setResult(reply.data)
      setDemo(false)
    } catch { setError('Search connection interrupted. Enter your key again and retry.') }
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
    setFilter('All')
    setQuery('')
    setError(null)
    setNotice(null)
    setCopied(false)
  }

  const config = document?.config
  const categories = ['All', ...(result?.config.interests || [])]
  const companies = sortCompanies(result?.companies.filter((company) =>
    (filter === 'All' || company.categories.includes(filter)) &&
    `${company.name} ${company.description} ${company.reason}`.toLowerCase().includes(query.toLowerCase())
  ) || [], sort)
  const validCount = Number.isInteger(Number(companiesPerCategory)) && Number(companiesPerCategory) >= 1 && Number(companiesPerCategory) <= 100
  useEffect(() => { setCopied(false); setVisibleCount(60) }, [sort, filter, query])
  const collectedCount = progress?.result.categoryCounts.reduce((sum, category) => sum + category.count, 0) || 0
  const targetCount = (config?.interests.length || 0) * Number(companiesPerCategory)

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
      <header className="titlebar"><span>Jobs Scout</span><span className="version">Your personal company radar <span>v0.1</span></span></header>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src={pandaLogo} alt="Panda holding a magnifying glass" /></div><div>Jobs Scout<small>Find your next chapter.</small></div></div>
        <nav aria-label="Main navigation">
          <div className="nav-item active" aria-current="page"><Compass size={18} />Find companies<ArrowRight className="nav-arrow" size={15} /></div>
        </nav>
        <div className="sidebar-heading"><span>MY PREFERENCES</span><SlidersHorizontal size={14} /></div>
        <div className="config-card">
          <div className="file-header"><FileJson size={19} /><div><strong>{document ? document.path.split('/').pop() : 'No file loaded'}</strong><span>{document?.isExample ? 'Built-in example' : 'JSON preferences'}</span><b className="file-dot" /></div></div>
          <p className="config-name">{config?.name || 'Import a file to define your direction'}</p>
          <div className="config-section"><span className="field-label">Interests</span><div className="chips">{config?.interests.map((interest) => <span className="chip green" key={interest}>{interest}</span>) || <span className="muted">Waiting for preferences</span>}</div></div>
          <div className="config-section"><span className="field-label">Preferred roles</span><div className="chips">{config?.roles.length ? config.roles.map((role) => <span className="chip" key={role}>{role}</span>) : <span className="muted">Any role</span>}</div></div>
          <div className="config-section"><span className="field-label">Location · Company stage</span><p className="preference-text">{config?.locations.length ? config.locations.join(' / ') : 'Any location'}<br />{config?.companyStage || 'Any stage'}</p></div>
          {config?.notes && <p className="config-note">{config.notes}</p>}
          <div className="config-meta"><span>Up to {config?.companiesPerCategory || '—'}/category</span><div className="config-actions"><button aria-label="Edit preferences" title="Edit preferences" disabled={busy || configBusy || !api} onClick={() => void editConfig()}><PencilLine size={13} />Edit</button><button aria-label="Reload preferences" title="Reload preferences" disabled={busy || configBusy} onClick={() => void loadConfig()}><RefreshCw size={14} className={configBusy ? 'spin' : ''} /></button></div></div>
        </div>
        <button className="outline-button import-button" disabled={busy || configBusy || !api} onClick={() => void loadConfig('chooseConfig')}><FolderOpen size={16} />Import preferences</button>
        <button className="text-button" disabled={busy || configBusy || !api} onClick={() => void loadConfig('saveExample')}><ArrowDownToLine size={14} />Save example copy</button>
        {document && <p className="file-path" title={document.path}>{document.path}</p>}
        <div className="sidebar-footer"><ShieldCheck size={16} /><div>Your preferences stay local<small>Shared with GLM only when you search</small></div></div>
      </aside>
      <main>
        <div className="page-heading"><div><span className="eyebrow"><span className="tiny-dot" />YOUR NEXT CHAPTER</span><h1>Give your next chapter direction.</h1><p className="intro">Follow your interests. Discover companies worth your attention.</p></div><span className="mode-badge"><Sparkles size={14} />AI company discovery</span></div>
        <form className="search-panel" onSubmit={(event) => void search(event)}>
          <div className="search-panel-heading"><div className="small-icon"><Search size={19} /></div><div><h2>Start a new search</h2><p>Each search uses the latest version of your preference file.</p></div></div>
          <div className="input-row">
            <div className="key-field"><label htmlFor="api-key">GLM API key <span>For this search only</span></label><div className="password-input"><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={busy} placeholder="Enter your Zhipu AI API key" autoComplete="off" spellCheck={false} /><button type="button" aria-label={showKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowKey(!showKey)} disabled={busy}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            <div className="model-field"><label htmlFor="model">Model</label><input id="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} /></div>
            <div className="count-field"><label htmlFor="company-count">Per category</label><input id="company-count" type="number" min={1} max={100} step={1} value={companiesPerCategory} onChange={(e) => setCompaniesPerCategory(e.target.value)} disabled={busy} /></div>
            <button className="primary-button search-button" type="submit" disabled={!api || !document || configBusy || busy || !apiKey.trim() || !model.trim() || !validCount}>{busy ? <><LoaderCircle className="spin" size={17} />Searching</> : <><Search size={17} />Find companies<ArrowRight size={16} /></>}</button>
          </div>
          <div className="search-bottom"><label className="toggle-label"><input type="checkbox" checked={webSearch} disabled={busy} onChange={(e) => setWebSearch(e.target.checked)} /><Globe2 size={14} />Web search<span>Include sources &amp; reported values</span></label><span className="privacy-note"><ShieldCheck size={13} />Key is never saved · API fees may apply</span></div>
        </form>
        {!api && <div className="alert error" role="alert">Launch the desktop app with npm run dev. A browser preview cannot read files or call GLM.</div>}
        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
        {notice && <div className="alert notice" role="status">{notice}</div>}
        {busy && <div className="search-progress" role="status"><img src={pandaLogo} alt="" /><div><h3>{cancelling ? 'Stopping search…' : progress?.phase === 'values' ? 'Checking reported values' : 'Collecting companies'}</h3><p>{progress?.phase === 'values' ? `${progress.valuesChecked} of ${result?.companies.length || 0} companies checked` : `${collectedCount} of ${targetCount} category matches collected`}</p><progress aria-label="Search progress" value={progress?.phase === 'values' ? progress.valuesChecked : collectedCount} max={progress?.phase === 'values' ? Math.max(1, result?.companies.length || 0) : Math.max(1, targetCount)} /></div><button className="outline-button" disabled={cancelling} onClick={() => void cancel()}>Cancel search</button></div>}
        {result ? <section className="results" aria-label="Company results">
          <div className="results-heading"><div><h2>{demo ? 'A preview of your catalog' : 'Your company catalog'}<span>{result.companies.length}</span></h2><p>{demo ? 'Preview · Fictional companies and values, no AI call' : `${new Date(result.searchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${result.model} · ${result.webSearchUsed ? 'Web sources used' : result.webSearch ? 'Web search unavailable · Model recommendations' : 'Model recommendations'}`}</p></div><button className="outline-button" disabled={!companies.length} onClick={() => void copyNames()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy company names'}</button></div>
          {demo && <div className="alert notice">These companies and values are fictional examples.</div>}
          {result.warning && <div className="alert warning">{result.warning}</div>}
          <div className="results-tools"><div className="filter-chips" aria-label="Filter by interest">{categories.map((category) => { const count = result.categoryCounts.find((item) => item.category === category); return <button key={category} className={filter === category ? 'selected' : ''} onClick={() => setFilter(category)}>{category}<span>{count ? `${count.count}/${count.target}` : result.companies.length}</span></button> })}</div><div className="result-controls"><label className="sort-control">Sort<select aria-label="Sort companies" value={sort} onChange={(e) => setSort(e.target.value as CompanySort)}><option value="value_desc">Value: high to low</option><option value="value_asc">Value: low to high</option><option value="match">Best match</option></select></label><div className="result-search"><Search size={14} /><input aria-label="Filter companies by name or description" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter companies…" /></div></div></div>
          <div className="company-grid">{companies.slice(0, visibleCount).map((company, index) => <article className="company-card" key={company.name}>
            <div className="company-top"><div className={`company-avatar tone-${index % 3}`}>{company.name.slice(0, 1).toUpperCase()}</div><div className="chips">{company.categories.map((category) => <span className="chip green" key={category}>{category}</span>)}</div></div>
            <h3>{company.name}</h3><p className="company-description">{company.description}</p>
            <div className={company.value ? 'company-value' : 'company-value unknown'}>{company.value ? <><div><strong>{formatUsd(company.value.amountUsd)}</strong><span>{demo ? 'Example ' : ''}{company.value.kind === 'market_cap' ? 'Market cap' : 'Valuation'} · {company.value.asOf}</span></div>{company.value.sourceUrl && <button className="inline-link" aria-label={`Value source for ${company.name}`} onClick={() => void openLink(company.value!.sourceUrl!)}>Source<ArrowUpRight size={13} /></button>}</> : <div><strong>Unknown</strong><span>Reported value unavailable</span></div>}</div>
            <div className="match-reason"><Sparkles size={13} /><p>{company.reason}</p></div>
            {company.relevantRoles.length > 0 && <div className="role-tags">{company.relevantRoles.map((role) => <span key={role}>{role}</span>)}</div>}
            <div className="company-bottom"><span>{company.location ? <><MapPin size={12} />{company.location}</> : 'Location unverified'}</span>{company.website && <button className="inline-link" onClick={() => void openLink(company.website!)}>Website<ArrowUpRight size={14} /></button>}</div>
            <div className="source-row">{company.sourceUrls.length > 0 ? <details><summary>Sources: {company.sourceUrls.length}</summary>{company.sourceUrls.map((url) => <button className="source-link" key={url} onClick={() => void openLink(url)}>{new URL(url).hostname}<ArrowUpRight size={12} /></button>)}</details> : <span>AI recommendation · Details unverified</span>}<span>Hiring unverified</span></div>
          </article>)}</div>
          {companies.length > visibleCount && <div className="show-more"><span>Showing {visibleCount} of {companies.length} companies</span><button className="outline-button" onClick={() => setVisibleCount((count) => count + 60)}>Show 60 more</button></div>}
          {!companies.length && <div className="empty-results"><Search size={25} /><h3>{result.companies.length ? 'No companies match your filters' : 'No matching companies this time'}</h3><p>{result.companies.length ? 'Try another keyword or interest.' : 'Try broader locations, roles, or interests, then search again.'}</p></div>}
          {result.sources.length > 0 && <details className="all-sources"><summary>Search references · {result.sources.length > 100 ? `First 100 of ${result.sources.length}` : result.sources.length}</summary>{result.sources.slice(0, 100).map((source) => <button className="source-link" key={source.url} onClick={() => void openLink(source.url)}>{source.title}<ArrowUpRight size={13} /></button>)}</details>}
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
