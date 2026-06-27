import { describe, it, expect } from "vitest";
import {
	normalizeSubtitleTrack,
	inferSubtitleContentType,
	externalSubtitleAsTextTrack,
} from "../../subtitle.js";

describe("normalizeSubtitleTrack", () => {
	it("collapses empty/absent values to null", () => {
		expect(normalizeSubtitleTrack(undefined)).toBeNull();
		expect(normalizeSubtitleTrack(null)).toBeNull();
		expect(normalizeSubtitleTrack("")).toBeNull();
	});

	it("passes real URLs through unchanged", () => {
		expect(normalizeSubtitleTrack("https://example.com/a.vtt")).toEqual(
			"https://example.com/a.vtt",
		);
	});
});

describe("inferSubtitleContentType", () => {
	it("recognizes .ass and .ssa as ASS", () => {
		expect(inferSubtitleContentType("https://example.com/a.ass")).toEqual("text/x-ass");
		expect(inferSubtitleContentType("https://example.com/a.ssa")).toEqual("text/x-ass");
	});

	it("treats .vtt as WebVTT", () => {
		expect(inferSubtitleContentType("https://example.com/a.vtt")).toEqual("text/vtt");
	});

	it("ignores query strings and hash fragments when reading the extension", () => {
		expect(inferSubtitleContentType("https://example.com/a.ass?token=1")).toEqual("text/x-ass");
		expect(inferSubtitleContentType("https://example.com/a.vtt#t=10")).toEqual("text/vtt");
	});

	it("is case-insensitive", () => {
		expect(inferSubtitleContentType("https://example.com/A.ASS")).toEqual("text/x-ass");
	});

	it("falls back to WebVTT for unknown extensions", () => {
		expect(inferSubtitleContentType("https://example.com/a.srt")).toEqual("text/vtt");
		expect(inferSubtitleContentType("https://example.com/no-extension")).toEqual("text/vtt");
	});
});

describe("externalSubtitleAsTextTrack", () => {
	it("builds a default, unknown-language track with inferred content type", () => {
		expect(externalSubtitleAsTextTrack("https://example.com/a.ass")).toEqual({
			url: "https://example.com/a.ass",
			contentType: "text/x-ass",
			srclang: "und",
			default: true,
		});
	});
});
