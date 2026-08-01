import { invoke } from "@tauri-apps/api/core";

export const createFloatingToolbarWindow = async (): Promise<void> => {
	await invoke<void>("create_floating_toolbar_window");
};

export const closeFloatingToolbarWindow = async (): Promise<void> => {
	await invoke<void>("close_floating_toolbar_window");
};

export const setFloatingToolbarWindowRect = async (
	x: number,
	y: number,
	width: number,
	height: number,
): Promise<void> => {
	await invoke<void>("set_floating_toolbar_window_rect", {
		x,
		y,
		width,
		height,
	});
};

export const hasFloatingToolbarWindow = async (): Promise<boolean> => {
	return await invoke<boolean>("has_floating_toolbar_window");
};

export const showFloatingToolbarWindow = async (): Promise<void> => {
	await invoke<void>("show_floating_toolbar_window");
};

export const hideFloatingToolbarWindow = async (): Promise<void> => {
	await invoke<void>("hide_floating_toolbar_window");
};

export const toggleFloatingToolbarWindow = async (): Promise<void> => {
	const has = await hasFloatingToolbarWindow();
	if (has) {
		const visible = await invoke<boolean>("is_floating_toolbar_visible");
		if (visible) {
			await hideFloatingToolbarWindow();
			return;
		}
		await showFloatingToolbarWindow();
		return;
	}
	// 首次打开才创建 WebView；后续复用窗口，避免界面切换时重复初始化 React/插件。
	await createFloatingToolbarWindow();
};
