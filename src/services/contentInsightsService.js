import { isNativePlatform } from '../utils/platform';

const PUBLIC_BASE = process.env.REACT_APP_CONTENT_INSIGHTS_URL
  || 'https://raw.githubusercontent.com/mrubiales1/LaLigaUP/content-data';

const localApiBase = () => {
  const proxyPort = process.env.REACT_APP_PROXY_PORT || '3005';
  if (process.env.NODE_ENV === 'development') {
    return `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:${proxyPort}`;
  }
  return window.location.origin;
};

const readJson = async (url, options) => {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Error HTTP ${response.status}`);
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
};

const getPublished = (type) => readJson(`${PUBLIC_BASE.replace(/\/$/, '')}/${type}.json`);
const getBundled = (type) => readJson(`./content-insights/${type}.json`);

const get = async (type) => {
  if (isNativePlatform()) {
    try { return await getPublished(type); } catch { return getBundled(type); }
  }
  try {
    return await readJson(`${localApiBase()}/api/content-insights/${type}`);
  } catch (localError) {
    try { return await getPublished(type); } catch {
      try { return await getBundled(type); } catch { throw localError; }
    }
  }
};

const refresh = async (type) => {
  if (isNativePlatform()) return { content: await getPublished(type), changed: false, published: true };
  try {
    return await readJson(`${localApiBase()}/api/content-insights/${type}/refresh`, { method: 'POST' });
  } catch (localError) {
    try { return { content: await getPublished(type), changed: false, published: true }; } catch { throw localError; }
  }
};

const contentInsightsService = { get, refresh };
export default contentInsightsService;
