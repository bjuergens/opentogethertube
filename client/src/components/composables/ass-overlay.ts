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

	// Resolves to whether the overlay ended up active for this url. Failures are logged here
	// and reported as `false` rather than thrown, matching the rest of the player code.
	async function fetchAndCreate(
		url: string,
		video: HTMLVideoElement,
		box: HTMLElement,
	): Promise<boolean> {
		const seq = ++loadSeq;
		currentUrl = url;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const content = await response.text();
			// Superseded by a newer load()/destroy() while fetching; dropping it is normal.
			if (seq !== loadSeq) {
				return false;
			}
			await waitForDimensions(video);
			if (seq !== loadSeq) {
				return false;
			}
			instance = new ASS(content, video, { container: box });
			visible.value = true;
			return true;
		} catch (e) {
			// Only report the failure if this load is still the current one.
			if (seq !== loadSeq) {
				return false;
			}
			console.error("useAssOverlay: failed to load ASS subtitles:", e);
			currentUrl = null;
			return false;
		}
	}

	function load(url: string): Promise<boolean> {
		const video = videoElement.value;
		const box = container.value;
		if (!video || !box) {
			console.error("useAssOverlay: load() called before the video element was mounted");
			return Promise.resolve(false);
		}
		if (currentUrl === url) {
			if (instance) {
				show();
			}
			return Promise.resolve(true);
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
