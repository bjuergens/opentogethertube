import type { CustomMediaTextTrack } from "./models/zod-schemas.js";

export function normalizeSubtitleTrack(value: string | null | undefined): string | null {
	return value || null;
}

function subtitleUrlExtension(url: string): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return undefined;
	}
	const fileName = pathname.split("/").slice(-1)[0].trim();
	if (!fileName.includes(".")) {
		return undefined;
	}
	return fileName.split(".").slice(-1)[0].toLowerCase();
}

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

export function externalSubtitleAsTextTrackOrNull(url: string): CustomMediaTextTrack | null {
	const contentType = inferSubtitleContentTypeOrNull(url);
	if (!contentType) {
		return null;
	}
	return {
		url,
		contentType,
		srclang: "und",
		default: true,
	};
}
