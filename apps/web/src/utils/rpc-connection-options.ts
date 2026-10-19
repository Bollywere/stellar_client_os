const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopbackHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Stellar SDK server options for the web app.
 * Plain HTTP is only enabled in non-production builds against loopback hosts.
 * Optional custom header support for private RPC endpoints.
 */
export function getStellarServerOptions(
  url: string,
  header?: string
): { allowHttp: boolean; headers?: Record<string, string> } {
  const isDev = process.env.NODE_ENV !== 'production';
  const options: { allowHttp: boolean; headers?: Record<string, string> } = {
    allowHttp: isDev && isLoopbackHttpUrl(url),
  };

  const headerStr = header !== undefined ? header : process.env.NEXT_PUBLIC_SOROBAN_RPC_HEADER;
  if (headerStr && headerStr.trim()) {
    try {
      if (headerStr.trim().startsWith('{')) {
        options.headers = JSON.parse(headerStr);
      } else {
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx > -1) {
          const key = headerStr.substring(0, colonIdx).trim();
          const val = headerStr.substring(colonIdx + 1).trim();
          options.headers = { [key]: val };
        } else {
          options.headers = { Authorization: headerStr.trim() };
        }
      }
    } catch {
      options.headers = { Authorization: headerStr.trim() };
    }
  }

  return options;
}
