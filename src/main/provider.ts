import type { SearchOptions } from '../shared/types'
import { record } from '../shared/validation'
import { isFlashModel } from '../shared/models'

export const GLM_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
export const GLM_SEARCH_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/web_search'
export const SEARCH_TIMEOUT_MS = 20 * 60_000
export const WEB_REQUEST_TIMEOUT_MS = 10_000

export class ScoutError extends Error {
  constructor(message: string, readonly cancelled = false) { super(message) }
}

export function modelRequest(options: SearchOptions, messages: { role: string; content: string }[]) {
  const flash = isFlashModel(options.model)
  return {
    model: options.model, stream: false, temperature: flash ? 1 : 0.3, max_tokens: flash ? 16000 : 6000,
    ...(flash ? { top_p: 0.95, thinking: { type: 'enabled', clear_thinking: false }, reasoning_effort: 'low' } : { response_format: { type: 'json_object' } }), messages
  }
}

export function providerClient(options: SearchOptions, requestSignal: AbortSignal, fetcher: typeof fetch) {
  return async (endpoint: string, body: unknown, stageSignal?: AbortSignal): Promise<Record<string, unknown>> => {
    const activeSignal = stageSignal ? AbortSignal.any([requestSignal, stageSignal]) : requestSignal
    if (activeSignal.aborted) throw new ScoutError('Search timed out or was cancelled.')
    const label = endpoint === GLM_SEARCH_ENDPOINT ? 'Web search' : 'GLM'
    try {
      const response = await fetcher(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(body), signal: activeSignal, redirect: 'error'
      })
      if (activeSignal.aborted) throw new Error('aborted')
      let payload: Record<string, unknown> | null = null
      try { payload = record(await response.json()) } catch { /* Never expose provider text. */ }
      if (activeSignal.aborted) throw new Error('aborted')
      const rawCode = payload && payload.error && typeof payload.error === 'object' ? (payload.error as Record<string, unknown>).code : undefined
      const code = String(rawCode ?? '')
      const safeCode = /^[a-zA-Z0-9_-]{1,24}$/.test(code) && !code.includes(options.apiKey) ? `, code ${code}` : ''
      const detail = `(HTTP ${response.status}${safeCode})`
      if (!response.ok || payload?.error) {
        if (response.status === 401) throw new ScoutError(`Your API key is invalid or expired. Please enter it again. ${label} ${detail}`)
        if (response.status === 403) throw new ScoutError(`${label} access denied ${detail}. Check API permissions in your Zhipu AI account.`)
        if (response.status === 429) throw new ScoutError(`${label} rate limit or insufficient credit ${detail}. Check your balance and try again later.`)
        if (response.status === 400) throw new ScoutError(`${label} rejected the request ${detail}. Check API access and model settings.`)
        throw new ScoutError(`${label} request failed ${detail}. Please try again later.`)
      }
      if (!payload) throw new ScoutError(`${label} returned an invalid response.`)
      return payload
    } catch (error) {
      if (activeSignal.aborted) throw new ScoutError(`${label} timed out or was cancelled.`)
      if (error instanceof ScoutError) throw error
      throw new ScoutError(`Could not connect to ${label} or read its response. Check your network.`)
    }
  }
}

export function modelJson(payload: unknown): Record<string, unknown> {
  const choices = record(payload).choices
  if (!Array.isArray(choices) || !choices.length) throw new ScoutError('GLM returned no content. Check model access or try again later.')
  const choice = record(choices[0])
  if (choice.finish_reason === 'length') throw new ScoutError('The response was cut short. Request fewer results and search again.')
  if (choice.finish_reason === 'sensitive') throw new ScoutError('GLM could not process these preferences. Edit them and try again.')
  const content = record(choice.message).content
  if (typeof content !== 'string' || !content.trim()) throw new ScoutError('GLM returned an empty response. Please try again.')
  try { return record(JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))) }
  catch { throw new ScoutError('The AI response is not valid JSON. Retry or choose another model.') }
}

export function queryText(value: string): string { return Array.from(value.replace(/\s*\+\s*/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 70).join('') }
