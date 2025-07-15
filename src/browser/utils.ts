/**
 * Normalize a URL by adding https:// protocol if needed, while preserving special URLs.
 *
 * This function safely adds https:// to URLs that lack a protocol, but preserves
 * special URLs like "about:blank", "mailto:...", "tel:...", etc. that should not
 * be prefixed with https://.
 *
 * @param url - The URL string to normalize
 * @returns The normalized URL with protocol if needed
 *
 * @example
 * ```typescript
 * normalizeUrl('example.com')          // 'https://example.com'
 * normalizeUrl('about:blank')          // 'about:blank'
 * normalizeUrl('mailto:test@example.com') // 'mailto:test@example.com'
 * normalizeUrl('https://example.com')  // 'https://example.com'
 * ```
 */
export function normalizeUrl(url: string): string {
	const normalizedUrl = url.trim();

	// If URL already has a protocol, return as-is
	if (normalizedUrl.includes("://")) {
		return normalizedUrl;
	}

	// Check for special protocols that should not be prefixed with https://
	const specialProtocols = [
		"about:",
		"mailto:",
		"tel:",
		"ftp:",
		"file:",
		"data:",
		"javascript:",
	];
	for (const protocol of specialProtocols) {
		if (normalizedUrl.startsWith(protocol)) {
			return normalizedUrl;
		}
	}

	// For everything else, add https://
	return `https://${normalizedUrl}`;
}
