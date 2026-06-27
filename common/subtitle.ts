import type { CustomMediaTextTrack } from "./models/zod-schemas.js";

export function normalizeSubtitleTrack(value: string | null | undefined): string | null {
	return value || null;
}

/** Lower-cased file extension of a subtitle url, ignoring any query string or hash fragment. */
function subtitleUrlExtension(url: string): string | undefined {
	const path = url.split("?")[0].split("#")[0];
	return path.split(".").pop()?.toLowerCase();
}

/**
 * Whether `url` points at a subtitle format we support. The server uses this to reject external
 * subtitle urls before they reach the player; only these extensions are mapped to a renderable
 * content type by `inferSubtitleContentType`.
 */
export function isSupportedSubtitleUrl(url: string): boolean {
	const ext = subtitleUrlExtension(url);
	return ext === "vtt" || ext === "ass" || ext === "ssa";
}

/**
 * Guesses the content type from the URL extension, mapping `.ass`/`.ssa` to ASS and everything
 * else to WebVTT. Only meaningful for urls that passed `isSupportedSubtitleUrl`.
 */
export function inferSubtitleContentType(url: string): CustomMediaTextTrack["contentType"] {
	const ext = subtitleUrlExtension(url);
	return ext === "ass" || ext === "ssa" ? "text/x-ass" : "text/vtt";
}

export function externalSubtitleAsTextTrack(url: string): CustomMediaTextTrack {
	return {
		url,
		contentType: inferSubtitleContentType(url),
		srclang: "und",
		default: true,
	};
}
