export const LISTEN_KEY_SERVICE_KEY_DOWN_EMIT_KEY =
	"listen-key-service:key-down";
export const LISTEN_KEY_SERVICE_KEY_UP_EMIT_KEY = "listen-key-service:key-up";
export const LISTEN_KEY_SERVICE_STOP_EMIT_KEY = "listen-key-service:stop"; // 停止监听键盘

export const LISTEN_KEY_SERVICE_MOUSE_DOWN_EMIT_KEY =
	"listen-mouse-service:mouse-down";
export const LISTEN_KEY_SERVICE_MOUSE_UP_EMIT_KEY =
	"listen-mouse-service:mouse-up";
export const LISTEN_KEY_SERVICE_MOUSE_STOP_EMIT_KEY =
	"listen-mouse-service:mouse-stop"; // 停止监听鼠标

/**
 * 截图会话开始/结束广播。
 *
 * `release-draw-page` 是"旧窗口可以关闭了"的信号，会在截图遮罩刚激活时触发；
 * `finish-screenshot` 只有聊天/翻译页面会发。两者都不能表示"截图结束"，
 * 所以需要独立事件让悬浮工具栏这类置顶窗口正确避让。
 */
export const CAPTURE_SESSION_CHANGE_EMIT_KEY = "capture-session:change";
