export const OPERATIONAL_READ_TIMEOUT_MS = 20_000;

export function createRequestTimeoutSignal(timeoutMs = OPERATIONAL_READ_TIMEOUT_MS): AbortSignal {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('O timeout precisa ser um inteiro positivo.');
  }

  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Tempo limite excedido.', 'TimeoutError')), timeoutMs);
  return controller.signal;
}

export function operationalRequestError(error: unknown): string {
  if (
    error instanceof DOMException
    && (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'O servidor demorou para responder. Os dados já carregados foram mantidos.';
  }
  return error instanceof Error ? error.message : 'Não foi possível sincronizar a operação.';
}
