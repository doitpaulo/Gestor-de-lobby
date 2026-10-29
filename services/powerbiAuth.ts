/** Extract only the existing Power BI API key from a Basic credential. */
export function powerBiBasicKey(authorization: string): string {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return "";
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  return separator > 0 && decoded.slice(0, separator) === "powerbi"
    ? decoded.slice(separator + 1)
    : "";
}
