export function asArray(input: string | string[] | undefined): string[] {
  if (input === undefined) {
    return [];
  }

  return Array.isArray(input) ? [...input] : [input];
}
export function uniqueStrings(input: string[]): string[] {
  return [...new Set(input)];
}
