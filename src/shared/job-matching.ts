import type { Job, JobInterestMatch } from './types'

export const JOB_INTEREST_PRESETS = ['Post training', 'Agent', 'LLM infra', 'RL']

export function jobInterestKey(value: string): string {
  const key = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '')
  if (['posttraining', 'finetuning', 'finetune'].includes(key)) return 'posttraining'
  if (['agent', 'agents', 'agentic'].includes(key)) return 'agent'
  if (['llminfra', 'llminfrastructure'].includes(key)) return 'llminfra'
  if (['rl', 'reinforcementlearning'].includes(key)) return 'rl'
  return key
}

function interestPattern(interest: string): RegExp {
  switch (jobInterestKey(interest)) {
    case 'posttraining': return /\b(?:post[\s-]?training|fine[\s-]?tun(?:ing|e)|finetuning|(?:llm|model) alignment|rlhf|supervised fine[\s-]?tuning)\b/i
    case 'agent': return /\b(?:ai agents?|llm agents?|agentic|autonomous agents?|multi[\s-]?agents?|agent (?:frameworks?|orchestration|infrastructure|systems?)|tool[\s-]?use|function calling)\b/i
    case 'llminfra': return /\b(?:llm infra(?:structure)?|(?:ai|ml) infra(?:structure)?|model serving|(?:llm|model) inference|inference (?:engineers?|infra(?:structure)?|engines?|systems?|optimization|performance)|distributed training|training infra(?:structure)?|gpu clusters?|vllm|tensorrt)\b/i
    case 'rl': return /\b(?:reinforcement learning|rl|rlhf|rlaif|grpo)\b/i
    default: {
      const phrase = interest.normalize('NFKC').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+')
      return new RegExp(/[\u3400-\u9fff]/.test(interest) ? phrase : `(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, 'iu')
    }
  }
}

export function matchJobInterests(title: string, sourceText: string, interests: string[]): { interestMatches: JobInterestMatch[]; matchScore: number } {
  const interestMatches: JobInterestMatch[] = []
  const seen = new Set<string>()
  let matchScore = 0
  for (const interest of interests) {
    const key = jobInterestKey(interest)
    if (seen.has(key)) continue
    seen.add(key)
    const context = `${title} ${sourceText}`
    const pattern = key === 'agent' && /\b(?:llm|large language models?|ai|language models?|foundation models?)\b/i.test(context)
      ? /\bagents?\b|\bagentic\b|\btool[\s-]?use\b|\bfunction calling\b/i : interestPattern(interest)
    const titleMatch = pattern.exec(title.normalize('NFKC'))
    const text = sourceText.normalize('NFKC').replace(/\s+/g, ' ')
    const sourceMatch = pattern.exec(text)
    if (!titleMatch && !sourceMatch) continue
    const evidence = titleMatch ? title : text.slice(Math.max(0, sourceMatch!.index - 55), sourceMatch!.index + sourceMatch![0].length + 120).trim()
    interestMatches.push({ interest, evidence })
    // Reward coverage first, then explicit focus in the official job title.
    matchScore += titleMatch ? 13 : 10
  }
  return { interestMatches, matchScore }
}

export function rankJobs(jobs: Job[]): Job[] {
  // Stable ties preserve the collected order, including searches with no specific interests.
  return [...jobs].sort((a, b) => b.matchScore - a.matchScore)
}
