import { emit } from "@tauri-apps/api/event";
import * as tauriLog from "@tauri-apps/plugin-log";
import { captureFocusedWindow } from "@/commands/screenshot";
import { FOCUS_WINDOW_APP_NAME_ENV_VARIABLE } from "@/constants/components/chat";
import { CAPTURE_SESSION_CHANGE_EMIT_KEY } from "@/constants/eventListener";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import { getCorrectHdrColorAlgorithm } from "@/utils/appSettings";
import { playCameraShutterSound } from "@/utils/audio";
import { getImagePathFromSettings } from "@/utils/file";
import { appError } from "@/utils/log";
import { ScreenshotType } from "@/utils/types";

export interface ExecuteScreenshotPayload {
	sessionId: string;
	sourceWindowLabel?: string;
	type: ScreenshotType;
	/** @deprecated 使用 sourceWindowLabel；保留用于兼容旧绘制窗口的转发逻辑 */
	windowLabel?: string;
	captureHistoryId?: string;
}

export interface CaptureSessionEvent {
	sessionId: string;
	type: ScreenshotType;
	phase: "started" | "finished" | "rejected";
	reason?: string;
}

let screenshotSessionSequence = 0;

export const createScreenshotSessionId = () => {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	screenshotSessionSequence += 1;
	return `${Date.now().toString(36)}-${screenshotSessionSequence.toString(36)}`;
};

/** 广播截图会话状态，供置顶窗口（悬浮工具栏等）自我避让 */
export const emitCaptureSessionChange = async (event: CaptureSessionEvent) => {
	await emit(CAPTURE_SESSION_CHANGE_EMIT_KEY, event);
};

export const executeScreenshot = async (
	type: ScreenshotType = ScreenshotType.Default,
	sourceWindowLabel?: string,
	captureHistoryId?: string,
	sessionId: string = createScreenshotSessionId(),
) => {
	const payload: ExecuteScreenshotPayload = {
		sessionId,
		sourceWindowLabel,
		type,
		// 旧版本绘制窗口读取 windowLabel，升级期间保持负载向后兼容。
		windowLabel: sourceWindowLabel,
		captureHistoryId,
	};
	await emit("execute-screenshot", payload);
};

export const executeScreenshotFocusedWindow = async (
	appSettings: AppSettingsData,
) => {
	const imagePath = await getImagePathFromSettings(
		appSettings,
		"focused-window",
	);
	if (!imagePath) {
		tauriLog.error(
			"[executeScreenshotFocusedWindow] Failed to get image path from settings",
		);

		return;
	}

	try {
		const captureFocusedWindowPromise = captureFocusedWindow(
			imagePath.filePath,
			appSettings[AppSettingsGroup.FunctionScreenshot]
				.focusedWindowCopyToClipboard,
			FOCUS_WINDOW_APP_NAME_ENV_VARIABLE,
			getCorrectHdrColorAlgorithm(appSettings),
		);
		playCameraShutterSound();
		await captureFocusedWindowPromise;
	} catch (error) {
		appError(
			"[executeScreenshotFocusedWindow] Failed to capture focused window",
			error,
		);
	}
};

export const finishScreenshot = async () => {
	await emit("finish-screenshot");
};

export const releaseDrawPage = async (force: boolean = false) => {
	await emit("release-draw-page", {
		force,
	});
};

export const onCaptureHistoryChange = async () => {
	await emit("on-capture-history-change");
};
