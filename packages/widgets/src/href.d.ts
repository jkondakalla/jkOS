/** http(s), mailto and relative hrefs pass (trimmed); anything else is undefined — no link. */
export function safeHref(v: unknown): string | undefined;
