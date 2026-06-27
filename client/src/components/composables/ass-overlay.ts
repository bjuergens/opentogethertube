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
			// A newer load() or a destroy() superseded this one while we were fetching;
			// silently drop it (this is normal when switching tracks quickly).
			if (seq !== loadSeq) {
				return;
			}
			await waitForDimensions(video);
			if (seq !== loadSeq) {
				return;
			}
			instance = new ASS(content, video, { container: box });
			visible.value = true;
		} catch (e) {
			// A superseded load that happens to fail is not interesting. Only surface the
			// failure of the load that is still current, and let the caller react to it.
			if (seq !== loadSeq) {
				return;
			}
			currentUrl = null;
			throw e;
		}
	}

	function load(url: string): Promise<void> {
		const video = videoElement.value;
		const box = container.value;
		// Reject rather than throw synchronously so every failure mode reaches the caller's
		// async error handling uniformly (callers invoke load() fire-and-forget).
		if (!video || !box) {
			return Promise.reject(
				new Error("useAssOverlay.load() called before the video element was mounted"),
			);
		}
		// Already loaded or still loading this exact track; just make sure it's visible.
		if (currentUrl === url) {
			if (instance) {
				show();
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
