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
 * Maps a subtitle url to its renderable content type by extension (`.ass`/`.ssa` -> ASS, `.vtt` ->
 * WebVTT), or `null` if the format is unsupported. The server treats a `null` result as "reject
 * this external subtitle url before it reaches the player".
 */
export function inferSubtitleContentTypeOrNull(
	url: string,
): CustomMediaTextTrack["contentType"] | null {
	const ext = subtitleUrlExtension(url);
	if (ext === "ass" || ext === "ssa") {
		return "text/x-ass";
	}
	if (ext === "vtt") {
		return "text/vtt";
	}
	return null;
}

export function externalSubtitleAsTextTrack(url: string): CustomMediaTextTrack {
	const contentType = inferSubtitleContentTypeOrNull(url);
	if (!contentType) {
		// Callers only reach here with a server-validated url, so this is a programming error.
		throw new Error(`Cannot build a text track for unsupported subtitle url: ${url}`);
	}
	return {
		url,
		contentType,
		srclang: "und",
		default: true,
	};
}
