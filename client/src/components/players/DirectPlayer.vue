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
				v-for="track in vttTracks"
				:key="track.url"
				kind="subtitles"
				:src="track.url"
				:srclang="track.srclang"
				:label="track.name"
			/>
		</video>
		<div ref="assContainer" class="ass-container"></div>
	</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, toRefs, watch } from "vue";
import type { CaptionTrack, VideoTrack } from "@/models/media-tracks";
import type {
	CustomMediaManifest,
	CustomMediaTextTrack,
} from "ott-common/models/zod-schemas.js";
import type {
	MediaPlayerWithAudioBoost,
	MediaPlayerWithCaptions,
	MediaPlayerWithPlaybackRate,
	MediaPlayerWithQuality,
} from "../composables";
import { useAssOverlay, useCaptions, useMediaAudioBoost, useQualities } from "../composables";
import { externalSubtitleAsTextTrack } from "ott-common/subtitle";

interface Props {
	service: string;
	videoUrl: string;
	videoMime: string;
	thumbnail?: string;
	defaultSubtitleTrack?: string | null;
}

const props = defineProps<Props>();
const { videoUrl, videoMime, thumbnail, defaultSubtitleTrack } = toRefs(props);
const videoElem = ref<HTMLVideoElement | undefined>();
const captions = useCaptions();
const audioBoost = useMediaAudioBoost(videoElem);
const qualities = useQualities();
const manifest = ref<CustomMediaManifest | null>(null);
const assContainer = ref<HTMLDivElement | undefined>();

const textTracks = computed<CustomMediaTextTrack[]>(() => {
	if (videoMime.value === "application/json") {
		return manifest.value?.textTracks ?? [];
	}
	if (defaultSubtitleTrack.value) {
		return [externalSubtitleAsTextTrack(defaultSubtitleTrack.value)];
	}
	return [];
});
const vttTracks = computed(() =>
	textTracks.value.filter(track => track.contentType === "text/vtt")
);
const assOverlay = useAssOverlay(videoElem, assContainer);
// Index into `textTracks` (which includes ASS tracks), or -1 for none.
const selectedTrack = ref(-1);

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

// Native <track> DOM elements only exist for VTT tracks, so their index space diverges from
// `textTracks` (which includes ASS). Resolve the native TextTrack by URL instead of by index.
function nativeTrackFor(url: string): TextTrack | undefined {
	const el = videoElem.value?.querySelector<HTMLTrackElement>(`track[src="${CSS.escape(url)}"]`);
	return el?.track ?? undefined;
}

function clearRendering(): void {
	if (videoElem.value) {
		for (const native of Array.from(videoElem.value.textTracks)) {
			native.mode = "hidden";
		}
	}
	assOverlay.destroy();
}

function applySelection(idx: number): void {
	clearRendering();
	const track = textTracks.value[idx];
	if (!track) {
		return;
	}
	if (track.contentType === "text/x-ass") {
		assOverlay.load(track.url);
	} else {
		const native = nativeTrackFor(track.url);
		if (native) {
			native.mode = "showing";
		} else {
			console.warn("DirectPlayer: subtitle track element not found:", track.url);
		}
	}
}

// flush: "post" ensures the <track> DOM elements are present before we look them up by URL.
watch(selectedTrack, applySelection, { flush: "post" });

function setCaptionsEnabled(enabled: boolean): void {
	if (enabled) {
		if (selectedTrack.value < 0 && textTracks.value.length > 0) {
			setCaptionsTrack(0);
		}
	} else {
		selectedTrack.value = -1;
		captions.currentTrack.value = -1;
		captions.isCaptionsEnabled.value = false;
	}
}

function isCaptionsEnabled(): boolean {
	return selectedTrack.value >= 0;
}

function getCaptionsTracks(): CaptionTrack[] {
	return textTracks.value.map(track => ({
		kind: "subtitles",
		label: track.name ?? undefined,
		srclang: track.srclang,
		default: track.default,
	}));
}

function setCaptionsTrack(track: number): void {
	selectedTrack.value = track;
	captions.currentTrack.value = track;
	captions.isCaptionsEnabled.value = track >= 0;
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
	// Reset to "no track" so captions from the previous video stop showing, and so the seed below
	// always represents a change (re-rendering even if the new default lands on the same index).
	clearRendering();
	selectedTrack.value = -1;
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
	} else {
		videoElem.value.src = videoUrl.value;

		qualities.videoTracks.value = [];
		qualities.currentVideoTrack.value = -1;
	}

	captions.captionsTracks.value = getCaptionsTracks();
	// Seed the selection from the default track once. The watcher on `selectedTrack` then renders it;
	// after this, the original default no longer matters.
	const defaultTrackIdx = defaultSubtitleTrack.value
		? textTracks.value.findIndex(t => t.url === defaultSubtitleTrack.value)
		: -1;
	setCaptionsTrack(defaultTrackIdx);

	videoElem.value.poster = thumbnail.value ?? "";
	videoElem.value.load();
	// this is needed to get the player to keep playing after the previous video has ended
	videoElem.value.play();

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

watch([videoUrl, defaultSubtitleTrack], () => {
	console.log("DirectPlayer: videoUrl or defaultSubtitleTrack changed");
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
	display: flex;
	align-items: center;
	justify-content: center;
	max-width: 100%;
	max-height: 100%;
	width: 100%;
	height: 100%;
	position: relative;
}

.direct .ass-container {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 1;
	overflow: hidden;
}

.direct video {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: 50% 50%;
}
</style>
