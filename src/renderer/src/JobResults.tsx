import { ArrowUpRight, BriefcaseBusiness, MapPin } from 'lucide-react'
import { useState } from 'react'
import type { JobSearchResult } from '../../shared/types'

export default function JobResults({ result, busy, onOpen }: { result: JobSearchResult | null; busy: boolean; onOpen: (url: string) => void }) {
  const [visibleCount, setVisibleCount] = useState(60)
  if (!result) return <section className="empty-results"><BriefcaseBusiness size={30} /><h3>Turn your company library into opportunities.</h3><p>Choose roles and locations, then search your saved companies.</p></section>
  return <section className="results" aria-label="Job results">
    <div className="results-heading"><div><h2>Job listings<span>{result.jobs.length}</span></h2><p>{result.companiesChecked} of {result.totalCompanies} companies checked · {result.model}{result.criteria.jobInterests.length ? ' · Best interest match first' : ''}</p></div></div>
    {result.warning && <div className="alert warning">{result.warning}</div>}
    <p className="job-criteria-summary">{result.criteria.roles.join(' / ') || 'Any role'} · {result.criteria.locations.join(' / ') || 'Any location'}</p>
    {result.criteria.jobInterests.length > 0 && <p className="job-criteria-summary">Prioritize: {result.criteria.jobInterests.join(' / ')}</p>}
    <div className="company-grid">{result.jobs.slice(0, visibleCount).map((job) => <article className="company-card job-card" key={`${job.company}:${job.url}`}>
      <div className="company-top"><span className="chip green">{job.company}</span><BriefcaseBusiness size={16} /></div>
      <h3>{job.title}</h3><p className="company-description">{job.description}</p>
      {job.interestMatches.length > 0 && <div className="job-interest-matches"><div className="chips">{job.interestMatches.map((match) => <span className="chip green" key={match.interest}>{match.interest}</span>)}</div><details><summary>Why this matches</summary>{job.interestMatches.map((match) => <p key={match.interest}><strong>{match.interest}</strong> · {match.evidence}</p>)}</details></div>}
      <div className="company-bottom"><span><MapPin size={12} />{job.location || 'Location not stated'}</span><button className="inline-link" onClick={() => onOpen(job.url)}>View job<ArrowUpRight size={14} /></button></div>
      <div className="source-row"><span>{new URL(job.url).hostname}</span><span>Retrieved listing</span></div>
    </article>)}</div>
    {result.jobs.length > visibleCount && <div className="show-more"><button className="outline-button" onClick={() => setVisibleCount((count) => count + 60)}>Show 60 more jobs</button></div>}
    {!busy && !result.jobs.length && <div className="empty-results"><BriefcaseBusiness size={25} /><h3>{result.incomplete ? 'The job search could not finish' : 'No sourced job listings found'}</h3><p>{result.incomplete ? 'Review the search notice and try again.' : 'Try broader roles or locations, or add more companies.'}</p></div>}
    <p className="result-footnote">Listings are extracted from web sources · Open the job page to confirm availability and requirements</p>
  </section>
}
