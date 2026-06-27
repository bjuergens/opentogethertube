import { onBeforeUnmount, type Ref, ref } from "vue";
import ASS from "assjs";

export function useAssOverlay(
	videoElement: Ref<HTMLVideoElement | undefined>,
	container: Ref<HTMLElement | undefined>,
) {
	let instance: ASS | null = null;
	let currentUrl: string | null = null;
	let loadSeq = 0;
	const visible = ref(false);
	let cancelWait: (() => void) | null = null;

	function waitForDimensions(video: HTMLVideoElement): Promise<void> {
		if (video.videoWidth > 0 && video.videoHeight > 0) {
			return Promise.resolve();
		}
		return new Promise<void>(resolve => {
			const cleanup = (): void => {
				video.removeEventListener("loadedmetadata", onReady);
				video.removeEventListener("resize", onReady);
				cancelWait = null;
			};
			const onReady = (): void => {
				if (video.videoWidth > 0 && video.videoHeight > 0) {
					cleanup();
					resolve();
				}
			};
			video.addEventListener("loadedmetadata", onReady);
			video.addEventListener("resize", onReady);
			cancelWait = () => {
				cleanup();
				resolve();
			};
		});
	}

	function destroy(): void {
		loadSeq++;
		cancelWait?.();
		instance?.destroy();
		instance = null;
		currentUrl = null;
		visible.value = false;
	}

	async function fetchAndCreate(
		url: string,
		video: HTMLVideoElement,
		box: HTMLElement,
	): Promise<void> {
		const seq = ++loadSeq;
		currentUrl = url;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const content = await response.text();
			if (seq !== loadSeq) {
				console.warn("useAssOverlay: discarding stale ASS load for", url);
				return;
			}
			await waitForDimensions(video);
			if (seq !== loadSeq) {
				console.warn("useAssOverlay: discarding stale ASS load for", url);
				return;
			}
			instance = new ASS(content, video, { container: box });
			visible.value = true;
		} catch (e) {
			if (seq !== loadSeq) {
				console.info("useAssOverlay: ignoring superseded ASS load failure for", url);
				return;
			}
			console.error("useAssOverlay: failed to load ASS subtitles:", e);
			currentUrl = null;
		}
	}

	function load(url: string): Promise<void> {
		const video = videoElement.value;
		const box = container.value;
		if (!video || !box) {
			throw new Error("useAssOverlay.load() called before the video element was mounted");
		}
		if (currentUrl === url) {
			if (instance) {
				console.info("useAssOverlay: track already active, ensuring visible:", url);
				show();
			} else {
				console.info("useAssOverlay: track already loading:", url);
			}
			return Promise.resolve();
		}
		destroy();
		return fetchAndCreate(url, video, box);
	}

	function show(): void {
		if (!instance) {
			console.warn("useAssOverlay: show() called with no active overlay");
			return;
		}
		instance.show();
		visible.value = true;
	}

	function hide(): void {
		instance?.hide();
		visible.value = false;
	}

	onBeforeUnmount(destroy);

	return { load, show, hide, destroy, visible };
}
