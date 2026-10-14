import { describe, expect, it } from 'vitest'
import { matchJobInterests, rankJobs } from '../src/shared/job-matching'
import type { Job } from '../src/shared/types'

describe('specific job interests', () => {
  it.each([
    ['Post training', 'Research Engineer, Post-training'],
    ['Post training', 'Fine-tuning foundation models'],
    ['Agent', 'Build agentic workflows and AI agents'],
    ['LLM infra', 'Model serving and distributed training'],
    ['RL', 'Reinforcement learning from human feedback'],
    ['Multimodal', 'Research Engineer, Multimodal']
  ])('recognizes %s in actual job content', (interest, content) => {
    const match = matchJobInterests('Research Engineer', content, [interest])
    expect(match.interestMatches[0].interest).toBe(interest)
    expect(content).toContain(match.interestMatches[0].evidence)
    expect(match.matchScore).toBeGreaterThan(0)
  })
  it('avoids unrelated abbreviations and generic customer-service agents', () => {
    const match = matchJobInterests('Customer service agent', 'Handle payroll, Ctrl keys, and PPO insurance benefits.', ['RL', 'Agent', 'LLM infra', 'Post training'])
    expect(match.interestMatches).toEqual([])
  })
  it('recognizes an Agents job title when the posting establishes an LLM context', () => {
    const match = matchJobInterests('Research Engineer, Agents', 'Build LLM-powered agents.', ['Agent'])
    expect(match.interestMatches[0].evidence).toBe('Research Engineer, Agents')
  })
  it('supports custom phrases and escapes punctuation in them', () => {
    expect(matchJobInterests('Research Engineer', 'Build GPU-aware retrieval systems (C++).', ['GPU aware', 'C++']).interestMatches.map((match) => match.interest)).toEqual(['GPU aware', 'C++'])
  })
  it('prioritizes explicit job-title matches over a topic appearing only in the source body', () => {
    const explicit = matchJobInterests('RL Engineer', 'Build reinforcement learning systems.', ['RL'])
    const related = matchJobInterests('AI Engineer', 'Experience with reinforcement learning preferred.', ['RL'])
    expect(explicit.matchScore).toBeGreaterThan(related.matchScore)
    expect(explicit.interestMatches[0].evidence).toBe('RL Engineer')
  })
  it('does not double-count synonymous preferences and keeps score ties stable', () => {
    const match = matchJobInterests('RL Engineer', '', ['RL', 'reinforcement learning'])
    expect(match.interestMatches).toHaveLength(1)
    const general = { title: 'General', matchScore: 0 } as Job
    const focused = { title: 'Focused', ...match } as Job
    const tied = { title: 'Another focused role', ...match } as Job
    expect(rankJobs([general, focused, tied]).map((job) => job.title)).toEqual(['Focused', 'Another focused role', 'General'])
  })
})
