// Every outbound call goes through this file, so every call has a deadline.
// A hanging provider must surface as a red state with a reason, not a spinner.

export class TimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`${url} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

export class HttpError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export async function request(url, options = {}, timeoutMs = 15_000) {
  const init = { ...options, signal: globalThis.AbortSignal.timeout(timeoutMs) };
  let response;
  try {
    response = await globalThis.fetch(url, init);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new TimeoutError(url, timeoutMs);
    }
    throw error;
  }
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { ok: response.ok, status: response.status, headers: response.headers, text, json };
}

export function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex -- ANSI colour codes start with ESC
  return String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
}

export function truncate(value, length = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
