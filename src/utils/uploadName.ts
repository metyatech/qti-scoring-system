const decodePercentEncoded = (value: string): string => {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeUploadPath = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const decoded = decodePercentEncoded(normalized);
  return decoded.replace(/\\/g, '/').replace(/^\/+/, '').trim();
};
