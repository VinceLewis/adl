/**
 * Pure string helpers shared across grammar areas.
 */
export function normaliseKeyword(value: string): string {
  return value.replace(/[_\-.]/g, "").toLowerCase();
}

export function lowerCamel(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "";
  }

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function pascalCase(value: string): string {
  const camel = lowerCamel(value);
  return camel.length === 0 ? "" : camel.charAt(0).toUpperCase() + camel.slice(1);
}
