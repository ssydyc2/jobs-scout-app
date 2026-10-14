import type { DiscoveryMode, ScoutConfig } from './types'

export const DISCOVERY_MODES: { value: DiscoveryMode; label: string }[] = [
  { value: 'interest_areas', label: 'Interest areas' },
  { value: 'top_ai_startups', label: 'Top AI startups' },
  { value: 'large_it_companies', label: 'Large IT companies' }
]

export function discoveryConfig(config: ScoutConfig, mode: DiscoveryMode = 'interest_areas'): ScoutConfig {
  // Job criteria belong to the second step, so discovery can build a broad company library.
  return {
    ...config, roles: [], locations: [], jobInterests: [],
    ...(mode === 'top_ai_startups' ? { interests: ['Top AI startups'], notes: 'Discover leading private AI startups across foundation models, AI infrastructure, and applied AI. Prioritize notable adoption, funding, and technical impact; cover a broad range of sectors.' } : {}),
    ...(mode === 'large_it_companies' ? { interests: ['Large IT companies'], notes: 'Discover major established technology companies across software, cloud, hardware, semiconductors, and internet services worldwide.' } : {})
  }
}
