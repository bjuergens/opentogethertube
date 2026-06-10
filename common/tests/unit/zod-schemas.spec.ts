import { describe, it, expect } from "vitest";
import { CustomMediaManifestSchema } from "../../models/zod-schemas.js";

function manifestWithTracks(tracks: unknown[]) {
	return {
		title: "Test",
		duration: 120,
		sources: [
			{
				url: "https://example.com/video.mp4",
				contentType: "video/mp4",
				quality: 1080,
			},
		],
		textTracks: tracks,
	};
}

describe("CustomMediaManifestSchema textTracks contentType", () => {
	it("accepts a VTT text track", () => {
		const result = CustomMediaManifestSchema.safeParse(
			manifestWithTracks([
				{
					url: "https://example.com/subs.vtt",
					contentType: "text/vtt",
					srclang: "en",
				},
			])
		);
		expect(result.success).toBe(true);
	});

	it("accepts an ASS text track", () => {
		const result = CustomMediaManifestSchema.safeParse(
			manifestWithTracks([
				{
					url: "https://example.com/subs.ass",
					contentType: "text/x-ass",
					srclang: "ja",
				},
			])
		);
		expect(result.success).toBe(true);
	});

	it("accepts a mix of VTT and ASS text tracks", () => {
		const result = CustomMediaManifestSchema.safeParse(
			manifestWithTracks([
				{ url: "https://example.com/subs.vtt", contentType: "text/vtt", srclang: "en" },
				{ url: "https://example.com/subs.ass", contentType: "text/x-ass", srclang: "ja" },
			])
		);
		expect(result.success).toBe(true);
	});

	it("rejects an unsupported text track contentType", () => {
		const result = CustomMediaManifestSchema.safeParse(
			manifestWithTracks([
				{
					url: "https://example.com/subs.srt",
					contentType: "text/srt",
					srclang: "en",
				},
			])
		);
		expect(result.success).toBe(false);
	});
});
