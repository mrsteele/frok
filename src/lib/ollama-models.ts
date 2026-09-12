/** Ollama treats an omitted tag as :latest, including registry-qualified names. */
export const ollamaModelKey = (name: string) => name.split('/').at(-1)!.includes(':') ? name : `${name}:latest`;

export function installedOllamaModels(items: unknown[]): string[] {
  const models = new Map<string,string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as {name?:unknown;model?:unknown;remote_model?:unknown;remote_host?:unknown};
    if(entry.remote_model||entry.remote_host)continue;
    const name = [entry.name,entry.model].find((value): value is string => typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._\/:@-]*$/.test(value));
    if (name) models.set(ollamaModelKey(name),name);
  }
  return [...models.values()].sort((a,b)=>a.localeCompare(b));
}
