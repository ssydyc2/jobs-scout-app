export const DEFAULT_MODEL = 'glm-5.3-flash'

export function isFlashModel(model: string): boolean {
  return /^glm-5\.3-flashx?$/i.test(model)
}
