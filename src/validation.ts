/** Narrow optional settings after checking their presence. */
export function hasDefined<T extends object, K extends keyof T>(value: T, key: K): value is T & Required<Pick<T, K>> {
  return Object.hasOwn(value, key) && value[key] !== undefined
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error)
}
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
