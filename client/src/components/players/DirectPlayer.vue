<template>
	<div class="direct">
		<video
			ref="videoElem"
			preload="auto"
			crossorigin="anonymous"
			@canplay="onCanPlay"
			@playing="onPlaying"
			@pause="onPaused"
			@play="onWaiting"
			@waiting="onWaiting"
			@stalled="onBuffering"
			@loadstart="onBuffering"
			@progress="onProgress"
			@ended="onEnd"
			@error="onError"
		>
			<track
				v-for="track in vttTextTracks"
				:key="track.url"
				kind="subtitles"
				:src="track.url"
				:srclang="track.srclang"
				:label="track.name"
				:default="track.default"
			/>
			<track
				v-if="subtitleUrl && videoMime !== 'application/json'"
				:src="subtitleUrl"
				kind="subtitles"
				default
			/>
		</video>
		<div ref="assOverlay" class="ass-overlay"></div>
	</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from "vue";
import ASS from "assjs";
import type { CaptionTrack, VideoTrack } from "@/models/media-tracks";
import type { CustomMediaManifest } from "ott-common/models/zod-schemas.js";
import type {
	MediaPlayerWithAudioBoost,
	MediaPlayerWithCaptions,
	MediaPlayerWithPlaybackRate,
	MediaPlayerWithQuality,
} from "../composables";
import { useCaptions, useMediaAudioBoost, useQualities } from "../composables";

interface Props {
	service: string;
	videoUrl: string;
	videoMime: string;
	thumbnail?: string;
	subtitleUrl?: string;
}

const props = defineProps<Props>();
const { videoUrl, videoMime, thumbnail, subtitleUrl } = toRefs(props);
const videoElem = ref<HTMLVideoElement | undefined>();
const assOverlay = ref<HTMLDivElement | undefined>();
const captions = useCaptions();
const audioBoost = useMediaAudioBoost(videoElem);
const qualities = useQualities();
const manifest = ref<CustomMediaManifest | null>(null);
const assInstance = ref<ASS | null>(null);

// Native <track> elements are only rendered for VTT tracks; ASS tracks are
// rendered separately via the assjs overlay. This is the list of VTT tracks.
const vttTextTracks = computed(
	() => manifest.value?.textTracks?.filter(t => t.contentType === "text/vtt") ?? []
);

// Maps a unified caption track index (into manifest.textTracks, which mixes VTT
// and ASS tracks) to the corresponding index in videoElem.textTracks (which only
// contains the native VTT tracks). Returns -1 if the track is not a native one.
function nativeTrackIndex(unifiedIndex: number): number {
	const tracks = manifest.value?.textTracks ?? [];
	if (unifiedIndex < 0 || unifiedIndex >= tracks.length) {
		return -1;
	}
	if (tracks[unifiedIndex].contentType !== "text/vtt") {
		return -1;
	}
	let nativeIdx = -1;
	for (let i = 0; i <= unifiedIndex; i++) {
		if (tracks[i].contentType === "text/vtt") {
			nativeIdx++;
		}
	}
	return nativeIdx;
}

function destroyAss(): void {
	if (assInstance.value) {
		assInstance.value.destroy();
		assInstance.value = null;
	}
}

async function showAssTrack(url: string): Promise<void> {
	destroyAss();
	if (!videoElem.value || !assOverlay.value) {
		return;
	}
	try {
		const response = await fetch(url);
		if (!response.ok) {
			console.error("DirectPlayer: failed to fetch ASS track:", response.status);
			return;
		}
		const content = await response.text();
		assInstance.value = new ASS(content, videoElem.value, {
			container: assOverlay.value,
		});
	} catch (e) {
		console.error("DirectPlayer: failed to load ASS track:", e);
	}
}

function hideAllNativeTracks(): void {
	if (!videoElem.value) {
		return;
	}
	for (let i = 0; i < videoElem.value.textTracks.length; i++) {
		videoElem.value.textTracks[i].mode = "hidden";
	}
}

const emit = defineEmits<{
	"apiready": [];
	"ready": [];
	"playing": [];
	"paused": [];
	"waiting": [];
	"buffering": [];
	"error": [];
	"end": [];
	"buffer-progress": [progress: number];
	"buffer-spans": [spans: TimeRanges];
}>();

function play() {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	return videoElem.value.play();
}

function pause() {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.pause();
}

function setVolume(volume: number) {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.volume = volume / 100;
}

function getPosition() {
	if (!videoElem.value) {
		console.error("player not ready");
		return 0;
	}
	return videoElem.value.currentTime;
}

function setPosition(position: number) {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.currentTime = position;
}

function isCaptionsSupported(): boolean {
	return true;
}

function setCaptionsEnabled(enabled: boolean): void {
	if (!videoElem.value || captions.currentTrack.value === null) {
		return;
	}
	const hasTracks =
		(manifest.value?.textTracks?.length ?? 0) > 0 ||
		(videoMime.value !== "application/json" && !!subtitleUrl.value);
	if (!hasTracks) {
		return;
	}
	if (!enabled) {
		hideAllNativeTracks();
		destroyAss();
		return;
	}
	// Re-apply the current track (defaulting to the first one if none selected).
	const track = captions.currentTrack.value === -1 ? 0 : captions.currentTrack.value;
	setCaptionsTrack(track);
}

function isCaptionsEnabled(): boolean {
	if (!videoElem.value) {
		return false;
	}
	if (assInstance.value) {
		return true;
	}
	return Array.from(videoElem.value.textTracks).find(t => t.mode === "showing") !== undefined;
}

function getCaptionsTracks(): CaptionTrack[] {
	if (!videoElem.value) {
		return [];
	}
	if (videoMime.value === "application/json") {
		if (!manifest.value) {
			return [];
		}
	} else {
		return subtitleUrl.value ? [{ kind: "subtitles", default: true }] : [];
	}

	const tracks: CaptionTrack[] = [];
	for (const track of manifest.value.textTracks ?? []) {
		tracks.push({
			kind: "subtitles",
			label: track.name ?? undefined,
			srclang: track.srclang,
			default: track.default,
		});
	}
	return tracks;
}

function setCaptionsTrack(track: number): void {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	console.log("DirectPlayer: setCaptionsTrack:", track);
	destroyAss();
	hideAllNativeTracks();

	const manifestTrack = manifest.value?.textTracks?.[track];
	if (manifestTrack?.contentType === "text/x-ass") {
		// Rendered via the assjs overlay rather than a native text track.
		showAssTrack(manifestTrack.url);
	} else if (manifestTrack) {
		// VTT track from the manifest: map the unified index to the native index.
		const nativeIdx = nativeTrackIndex(track);
		if (nativeIdx >= 0 && nativeIdx < videoElem.value.textTracks.length) {
			videoElem.value.textTracks[nativeIdx].mode = "showing";
		}
	} else if (track >= 0 && track < videoElem.value.textTracks.length) {
		// Non-manifest track (external subtitleUrl), indexed directly.
		videoElem.value.textTracks[track].mode = "showing";
	}
	captions.currentTrack.value = track;
}

function isQualitySupported(): boolean {
	return manifest.value !== null && manifest.value.sources.length > 1;
}

function getVideoTracks(): VideoTrack[] {
	if (!manifest.value) {
		return [];
	}
	return manifest.value.sources.map(s => ({
		label: s.quality,
		width: 0,
		height: s.quality,
	}));
}

function setVideoTrack(idx: number): void {
	if (!manifest.value || !videoElem.value) {
		return;
	}
	const source = manifest.value.sources[idx];
	if (!source) {
		return;
	}
	const currentTime = videoElem.value.currentTime;
	const wasPlaying = !videoElem.value.paused;
	videoElem.value.src = source.url;
	videoElem.value.load();
	videoElem.value.currentTime = currentTime;
	if (wasPlaying) {
		videoElem.value.play().catch(e => {
			console.error("DirectPlayer: error resuming after quality switch:", e);
		});
	}
	qualities.currentVideoTrack.value = idx;
}

function isAutoQualitySupported(): boolean {
	return false;
}

function getCurrentActiveQuality(): number | null {
	if (!videoElem.value || !manifest.value) {
		return null;
	}
	return manifest.value.sources.findIndex(s => s.url === videoElem.value?.src) ?? -1;
}

function getAvailablePlaybackRates(): number[] {
	return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
}

function getPlaybackRate(): number {
	if (!videoElem.value) {
		console.error("player not ready");
		return 1;
	}
	return videoElem.value.playbackRate;
}

async function setPlaybackRate(rate: number): Promise<void> {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.playbackRate = rate;
}

function setAudioBoost(boost: number): void {
	audioBoost.setBoost(boost);
}

async function loadVideoSource() {
	console.log("DirectPlayer: loading video source:", videoUrl.value, videoMime.value);
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	// Fix for captions from previous video still showing after source change
	hideAllNativeTracks();
	destroyAss();
	audioBoost.resetFailedSetup();
	manifest.value = null;

	if (videoMime.value === "application/json") {
		try {
			const response = await fetch(videoUrl.value);
			if (!response.ok) {
				console.error("DirectPlayer: failed to fetch manifest:", response.status);
				emit("error");
				return;
			}
			manifest.value = (await response.json()) as CustomMediaManifest;
		} catch (e) {
			console.error("DirectPlayer: failed to fetch manifest:", e);
			emit("error");
			return;
		}
		const firstSource = manifest.value.sources[0];
		if (!firstSource) {
			console.error("DirectPlayer: manifest has no sources");
			emit("error");
			return;
		}
		videoElem.value.src = firstSource.url;

		qualities.videoTracks.value = getVideoTracks();
		qualities.currentVideoTrack.value = 0;

		captions.captionsTracks.value = getCaptionsTracks();
		// The browser adds newly inserted <track> elements in "disabled" mode initially,
		// the default attribute causes them to become "showing" asynchronously.
		// To reflect this in the UI correctly, now the default track index is read directly
		// from the manifest data, and we explicitly set its mode to "showing"
		const defaultTrackIdx = manifest.value.textTracks?.findIndex(t => t.default) ?? -1;
		captions.currentTrack.value = defaultTrackIdx;
		captions.isCaptionsEnabled.value = defaultTrackIdx !== -1;
		if (defaultTrackIdx !== -1) {
			await nextTick();
			setCaptionsTrack(defaultTrackIdx);
		}
	} else {
		videoElem.value.src = videoUrl.value;

		qualities.videoTracks.value = [];
		qualities.currentVideoTrack.value = -1;

		if (subtitleUrl.value) {
			captions.captionsTracks.value = [{ kind: "subtitles", default: true }];
			captions.currentTrack.value = 0;
			captions.isCaptionsEnabled.value = true;
		} else {
			captions.captionsTracks.value = [];
			captions.currentTrack.value = -1;
			captions.isCaptionsEnabled.value = false;
		}
	}

	videoElem.value.poster = thumbnail.value ?? "";
	videoElem.value.load();
	// this is needed to get the player to keep playing after the previous video has ended
	videoElem.value.play();

	console.log("DirectPlayer: current subtitle track:", captions.currentTrack.value);
	console.log("DirectPlayer: current video track:", qualities.currentVideoTrack.value);

	emit("apiready");
}

function onCanPlay() {
	emit("ready");
}

function onPlaying() {
	emit("playing");
}

function onPaused() {
	emit("paused");
}

function onWaiting() {
	emit("waiting");
}

function onBuffering() {
	emit("buffering");
}

function onProgress() {
	if (videoElem.value) {
		const buffered = videoElem.value.buffered;
		emit("buffer-spans", buffered);
		const duration = videoElem.value.duration;
		let bufferedTotal = 0;
		for (let i = 0; i < buffered.length; i++) {
			bufferedTotal += buffered.end(i) - buffered.start(i);
		}
		const bufferedPercentage = duration > 0 ? bufferedTotal / duration : 0;
		emit("buffer-progress", bufferedPercentage);
	}
}

function onEnd() {
	emit("end");
}

function onError(err: Event) {
	emit("error");
	console.error("DirectPlayer: error:", err);
}

onMounted(() => {
	loadVideoSource();
});

onUnmounted(() => {
	destroyAss();
});

watch([videoUrl, subtitleUrl], () => {
	console.log("DirectPlayer: videoUrl or subtitleUrl changed");
	loadVideoSource();
});

defineExpose({
	play,
	pause,
	setVolume,
	getPosition,
	setPosition,
	isCaptionsSupported,
	setCaptionsEnabled,
	isCaptionsEnabled,
	getCaptionsTracks,
	setCaptionsTrack,
	isQualitySupported,
	getVideoTracks,
	setVideoTrack,
	isAutoQualitySupported,
	getCurrentActiveQuality,
	getAvailablePlaybackRates,
	getPlaybackRate,
	setPlaybackRate,
	setAudioBoost,
} satisfies MediaPlayerWithCaptions & MediaPlayerWithPlaybackRate & MediaPlayerWithAudioBoost & MediaPlayerWithQuality);
</script>

<!-- biome-ignore lint/nursery/useScopedStyles: biome migration -->
<style lang="scss">
.direct {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	max-width: 100%;
	max-height: 100%;
	width: 100%;
	height: 100%;
}

.direct video {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: 50% 50%;
}

/* Overlay that hosts ASS subtitles rendered by assjs. It must never intercept
   pointer events so clicks pass through to the video underneath. */
.ass-overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: hidden;
}
</style>
