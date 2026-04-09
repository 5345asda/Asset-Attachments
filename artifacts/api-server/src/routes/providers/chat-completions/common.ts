export async function readJsonOrText(
  upstream: globalThis.Response,
): Promise<unknown> {
  const raw = await upstream.text().catch(() => upstream.statusText);

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
