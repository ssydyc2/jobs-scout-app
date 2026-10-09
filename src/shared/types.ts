export interface ScoutConfig {
  name: string
  interests: string[]
  roles: string[]
  locations: string[]
  companyStage: string
  notes: string
  companiesPerCategory: number
}

export interface ConfigDocument {
  path: string
  config: ScoutConfig
  isExample: boolean
}

export interface ConfigDraft {
  path: string
  content: string
}

export interface ConfigSaveRequest extends ConfigDraft {
  originalContent: string
}

export interface Company {
  name: string
  website: string | null
  category: string
  categories: string[]
  description: string
  reason: string
  relevantRoles: string[]
  location: string
  sourceUrls: string[]
  value: CompanyValue | null
}

export interface CompanyValue {
  kind: 'market_cap' | 'valuation'
  amountUsd: number
  asOf: string
  sourceUrl: string | null
}

export type CompanySort = 'value_desc' | 'value_asc' | 'match'

export interface Source {
  title: string
  url: string
}

export interface SearchResult {
  companies: Company[]
  sources: Source[]
  searchedAt: string
  model: string
  webSearch: boolean
  webSearchUsed: boolean
  config: ScoutConfig
  warning: string | null
  categoryCounts: CategoryCount[]
  incomplete: boolean
}

export interface CategoryCount { category: string; count: number; target: number }
export interface SearchProgress { phase: 'discovery' | 'values'; result: SearchResult; valuesChecked: number }

export interface SearchOptions {
  apiKey: string
  model: string
  webSearch: boolean
  companiesPerCategory?: number
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; cancelled?: boolean }

export interface ScoutApi {
  getConfig(): Promise<Reply<ConfigDocument>>
  chooseConfig(): Promise<Reply<ConfigDocument | null>>
  saveExample(): Promise<Reply<ConfigDocument | null>>
  editConfig(): Promise<Reply<ConfigDraft>>
  saveConfig(request: ConfigSaveRequest): Promise<Reply<ConfigDocument>>
  search(options: SearchOptions): Promise<Reply<SearchResult>>
  cancelSearch(): Promise<Reply<null>>
  openLink(url: string): Promise<Reply<null>>
  copyNames(names: string[]): Promise<Reply<null>>
  onProgress(listener: (progress: SearchProgress) => void): () => void
}
