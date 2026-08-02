"use client";

import {
	ClockCircleOutlined,
	CloseOutlined,
	EllipsisOutlined,
	PushpinOutlined,
	ScissorOutlined,
	SettingOutlined,
} from "@ant-design/icons";
import {
	currentMonitor,
	getCurrentWindow,
	PhysicalPosition,
} from "@tauri-apps/api/window";
import { theme } from "antd";
import { debounce } from "es-toolkit";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useIntl } from "react-intl";
import {
	createFixedContentWindow,
	createFullScreenDrawWindow,
} from "@/commands/core";
import {
	closeFloatingToolbarWindow,
	setFloatingToolbarWindowRect,
} from "@/commands/floatingToolbar";
import { showMainWindow } from "@/commands/videoRecord";
import { EventListenerContext } from "@/components/eventListener";
import {
	FullScreenDrawIcon,
	FullScreenIcon,
	OcrDetectIcon,
	OcrTranslateIcon,
	VideoRecordIcon,
} from "@/components/icons";
import { CAPTURE_SESSION_CHANGE_EMIT_KEY } from "@/constants/eventListener";
import {
	PLUGIN_ID_FFMPEG,
	PLUGIN_ID_RAPID_OCR,
	PLUGIN_ID_TRANSLATE,
} from "@/constants/pluginService";
import { AppSettingsActionContext } from "@/contexts/appSettingsActionContext";
import { usePluginServiceContext } from "@/contexts/pluginServiceContext";
import {
	type CaptureSessionEvent,
	createScreenshotSessionId,
	executeScreenshot,
} from "@/functions/screenshot";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { AppSettingsGroup } from "@/types/appSettings";
import { appWarn } from "@/utils/log";
import { ScreenshotType } from "@/utils/types";
import { zIndexs } from "@/utils/zIndex";
import { type DockSide, resolveToolbarPlacement } from "./geometry";

const ICON_WINDOW_WIDTH = 80;
const TOOLBAR_WIDTH = 264;
const TOOLBAR_HEIGHT = 80;
const PANEL_HEIGHT = 220;
const AUTO_HIDE_DELAY = 900;
const AUTO_HIDE_VISIBLE_SIZE = 28;
const TRANSITION_FALLBACK = 240;
const DRAG_SETTLE_DELAY = 96;
const PROGRAMMATIC_MOVE_GUARD = 240;
/** 请求发出后等待绘制窗口确认开始；超时即恢复，避免事件丢失后永久隐藏 */
const SCREENSHOT_START_TIMEOUT = 2000;

type ToolbarMode = "icon" | "toolbar" | "panel";
type MotionPhase =
	| "icon"
	| "opening"
	| "toolbar"
	| "expanding"
	| "panel"
	| "collapsing";

const ToolButton: React.FC<{
	className: string;
	disabled?: boolean;
	icon: React.ReactNode;
	title: string;
	onClick: () => void;
}> = ({ className, disabled, icon, title, onClick }) => (
	<button
		aria-label={title}
		className={`${className}${disabled ? " ft-btn--disabled" : ""}`}
		disabled={disabled}
		onClick={onClick}
		title={title}
		type="button"
	>
		{icon}
	</button>
);

export const FloatingToolbarPage: React.FC = () => {
	const { token } = theme.useToken();
	const intl = useIntl();
	const { addListener, removeListener } = useContext(EventListenerContext);
	const { updateAppSettings } = useContext(AppSettingsActionContext);
	const { isReadyStatus } = usePluginServiceContext();
	const [toolbarOpen, setToolbarOpen] = useState(false);
	const [panelExpanded, setPanelExpanded] = useState(false);
	const [docked, setDocked] = useState(true);
	const [dockSide, setDockSide] = useState<DockSide>("right");
	const [openUpward, setOpenUpward] = useState(false);
	const [autoHidden, setAutoHidden] = useState(false);
	const [delaySeconds, setDelaySeconds] = useState(0);
	const [motionPhase, setMotionPhase] = useState<MotionPhase>("icon");
	const appWindowRef = useRef(getCurrentWindow());
	const toolbarOpenRef = useRef(false);
	const panelExpandedRef = useRef(false);
	const dockedRef = useRef(true);
	const dockSideRef = useRef<DockSide>("right");
	const openUpwardRef = useRef(false);
	const autoHiddenRef = useRef(false);
	const autoHideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const moveDebounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const screenshotStartTimerRef =
		useRef<ReturnType<typeof setTimeout>>(undefined);
	const activeScreenshotSessionRef = useRef<
		| {
				sessionId: string;
				type: ScreenshotType;
				started: boolean;
		  }
		| undefined
	>(undefined);
	const programmaticMoveUntilRef = useRef(0);
	const programmaticLayoutRef = useRef(false);
	const programmaticLayoutIdRef = useRef(0);
	const rectRequestRef = useRef<
		| {
				mode: ToolbarMode;
				x: number;
				y: number;
				width: number;
				height: number;
				transitionId: number;
				resolve: (applied: boolean) => void;
		  }
		| undefined
	>(undefined);
	const rectRequestRunningRef = useRef(false);
	const transitionIdRef = useRef(0);
	const motionPhaseRef = useRef<MotionPhase>("icon");
	const quickBarRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const transitionCleanupsRef = useRef(new Set<() => void>());
	/** undefined 表示尚未主动设置过尺寸，首次调用必须真正执行 resize + 定位 */
	const windowModeRef = useRef<ToolbarMode | undefined>(undefined);
	/** 截图/绘制期间挂起工具栏，避免自身出现在结果里并抢占输入 */
	const suspendedRef = useRef(false);
	const restoredPositionRef = useRef(false);
	/** 显示器信息缓存：避免每次展开/收起/吸附都串行调用 currentMonitor IPC */
	const monitorInfoRef = useRef<
		| {
				workArea: {
					position: { x: number; y: number };
					size: { width: number; height: number };
				};
				scaleFactor: number;
		  }
		| undefined
	>(undefined);
	/** 缓存生效时间戳，超时后重新读取（应对显示器变更） */
	const monitorInfoExpireRef = useRef(0);
	const MONITOR_CACHE_TTL = 3000;

	/** ffmpeg 未就绪时录屏不可用，OCR/翻译各自依赖对应插件。
	 * 插件状态尚未加载时（isReadyStatus 为 undefined）按可用处理，避免按钮先禁用再恢复的闪烁。 */
	const capabilities = useMemo(() => {
		if (!isReadyStatus) {
			return { videoRecord: true, ocrDetect: true, ocrTranslate: true };
		}

		return {
			videoRecord: isReadyStatus(PLUGIN_ID_FFMPEG),
			ocrDetect: isReadyStatus(PLUGIN_ID_RAPID_OCR),
			ocrTranslate:
				isReadyStatus(PLUGIN_ID_RAPID_OCR) &&
				isReadyStatus(PLUGIN_ID_TRANSLATE),
		};
	}, [isReadyStatus]);

	const beginTransition = useCallback(() => {
		transitionIdRef.current += 1;
		return transitionIdRef.current;
	}, []);

	const isTransitionCurrent = useCallback(
		(transitionId: number) => transitionIdRef.current === transitionId,
		[],
	);

	const updateMotionPhase = useCallback((phase: MotionPhase) => {
		motionPhaseRef.current = phase;
		setMotionPhase(phase);
	}, []);

	/** 获取显示器信息（带短时效缓存，动画期间避免重复 IPC） */
	const getMonitorInfo = useCallback(async () => {
		const now = Date.now();
		if (monitorInfoRef.current && now < monitorInfoExpireRef.current) {
			return monitorInfoRef.current;
		}

		const monitor = await currentMonitor();
		if (!monitor) {
			return monitorInfoRef.current;
		}

		const info = {
			workArea: {
				position: {
					x: monitor.workArea.position.x,
					y: monitor.workArea.position.y,
				},
				size: {
					width: monitor.workArea.size.width,
					height: monitor.workArea.size.height,
				},
			},
			scaleFactor: monitor.scaleFactor,
		};
		monitorInfoRef.current = info;
		monitorInfoExpireRef.current = now + MONITOR_CACHE_TTL;
		return info;
	}, []);

	/** 原生窗口 resize 后等待一次合成，让浏览器观察到动画起始状态。 */
	const waitForNextFrame = useCallback(
		(transitionId: number) =>
			new Promise<boolean>((resolve) => {
				let settled = false;
				let frame = 0;
				let fallback: ReturnType<typeof setTimeout> | undefined;
				const settle = (result: boolean) => {
					if (settled) {
						return;
					}
					settled = true;
					cancelAnimationFrame(frame);
					if (fallback) clearTimeout(fallback);
					resolve(result);
				};
				frame = requestAnimationFrame(() => {
					if (!isTransitionCurrent(transitionId)) {
						settle(false);
						return;
					}
					settle(true);
				});
				fallback = setTimeout(() => settle(true), TRANSITION_FALLBACK);
			}),
		[isTransitionCurrent],
	);

	const clearAutoHideTimer = useCallback(() => {
		if (autoHideTimerRef.current) {
			clearTimeout(autoHideTimerRef.current);
			autoHideTimerRef.current = undefined;
		}
	}, []);

	/** 位置写入设置文件，防抖避免拖动过程反复落盘 */
	const persistPosition = useMemo(
		() =>
			debounce(
				(state: {
					docked: boolean;
					dockSide: DockSide;
					y: number;
					x: number;
				}) => {
					updateAppSettings(
						AppSettingsGroup.Cache,
						{
							floatingToolbarDocked: state.docked,
							floatingToolbarDockSide: state.dockSide,
							floatingToolbarY: state.y,
							floatingToolbarX: state.x,
						},
						true,
						true,
						// 位置只对本窗口有意义；广播会让所有窗口重读全部设置文件，造成明显卡顿
						false,
						true,
						true,
					);
				},
				600,
			),
		[updateAppSettings],
	);

	const savePosition = useCallback(async () => {
		try {
			const position = await appWindowRef.current.outerPosition();
			persistPosition({
				docked: dockedRef.current,
				dockSide: dockSideRef.current,
				y: position.y,
				x: position.x,
			});
		} catch (error) {
			appWarn(`[FloatingToolbarPage] Failed to save position: ${error}`);
		}
	}, [persistPosition]);

	const moveWindow = useCallback(
		async (position: PhysicalPosition, transitionId: number) => {
			if (!isTransitionCurrent(transitionId)) {
				return false;
			}

			// 位置未变时跳过 IPC，否则会白白触发 onMoved 并再次进入吸附判断
			const current = await appWindowRef.current.outerPosition();
			if (!isTransitionCurrent(transitionId)) {
				return false;
			}
			if (current.x === position.x && current.y === position.y) {
				return true;
			}

			programmaticMoveUntilRef.current = Date.now() + PROGRAMMATIC_MOVE_GUARD;
			await appWindowRef.current.setPosition(position);
			return isTransitionCurrent(transitionId);
		},
		[isTransitionCurrent],
	);

	const getDockedX = useCallback(
		(
			side: DockSide,
			hidden: boolean,
			windowWidth: number,
			workAreaX: number,
			workAreaWidth: number,
			scaleFactor: number,
		) => {
			const workAreaRight = workAreaX + workAreaWidth;
			if (!hidden) {
				return side === "left" ? workAreaX : workAreaRight - windowWidth;
			}

			const visibleSize = Math.round(AUTO_HIDE_VISIBLE_SIZE * scaleFactor);
			return side === "left"
				? workAreaX - windowWidth + visibleSize
				: workAreaRight - visibleSize;
		},
		[],
	);

	const placeWindowAtDock = useCallback(
		async (
			hidden: boolean,
			transitionId: number,
			preferredY?: number,
			preferredX?: number,
		) => {
			const monitorInfo = await getMonitorInfo();
			if (!monitorInfo || !isTransitionCurrent(transitionId)) {
				return false;
			}

			const [position, size] = await Promise.all([
				appWindowRef.current.outerPosition(),
				appWindowRef.current.outerSize(),
			]);
			if (!isTransitionCurrent(transitionId)) {
				return false;
			}
			const workArea = monitorInfo.workArea;
			const placement = resolveToolbarPlacement({
				position: {
					x: preferredX ?? position.x,
					y: preferredY ?? position.y,
				},
				size,
				workArea,
				scaleFactor: monitorInfo.scaleFactor,
				wasDocked: dockedRef.current,
				targetWidth: size.width,
				targetHeight: size.height,
				dockSide: dockSideRef.current,
				expandDirection: openUpwardRef.current ? "up" : "down",
			});
			const nextX = dockedRef.current
				? getDockedX(
						dockSideRef.current,
						hidden,
						size.width,
						workArea.position.x,
						workArea.size.width,
						monitorInfo.scaleFactor,
					)
				: placement.x;

			return moveWindow(new PhysicalPosition(nextX, placement.y), transitionId);
		},
		[getDockedX, getMonitorInfo, isTransitionCurrent, moveWindow],
	);

	const waitForTransformTransition = useCallback(
		(element: HTMLElement | null, transitionId: number, fallbackMs: number) =>
			new Promise<boolean>((resolve) => {
				let settled = false;
				let timeout: ReturnType<typeof setTimeout>;
				const settle = (result: boolean) => {
					if (settled) {
						return;
					}
					settled = true;
					clearTimeout(timeout);
					element?.removeEventListener("transitionend", onTransitionEnd);
					transitionCleanupsRef.current.delete(cancel);
					resolve(result);
				};
				const cancel = () => settle(false);
				const onTransitionEnd = (event: TransitionEvent) => {
					if (event.target === element && event.propertyName === "transform") {
						settle(isTransitionCurrent(transitionId));
					}
				};
				element?.addEventListener("transitionend", onTransitionEnd);
				transitionCleanupsRef.current.add(cancel);
				timeout = setTimeout(
					() => settle(isTransitionCurrent(transitionId)),
					fallbackMs,
				);
			}),
		[isTransitionCurrent],
	);

	const requestWindowRect = useCallback(
		(request: Omit<NonNullable<typeof rectRequestRef.current>, "resolve">) =>
			new Promise<boolean>((resolve) => {
				rectRequestRef.current?.resolve(false);
				rectRequestRef.current = { ...request, resolve };
				if (rectRequestRunningRef.current) return;

				rectRequestRunningRef.current = true;
				void (async () => {
					while (rectRequestRef.current) {
						const next = rectRequestRef.current;
						rectRequestRef.current = undefined;
						const layoutId = ++programmaticLayoutIdRef.current;
						programmaticLayoutRef.current = true;
						programmaticMoveUntilRef.current =
							Date.now() + PROGRAMMATIC_MOVE_GUARD;
						try {
							await setFloatingToolbarWindowRect(
								next.x,
								next.y,
								next.width,
								next.height,
							);
							const current = isTransitionCurrent(next.transitionId);
							if (current && !rectRequestRef.current) {
								windowModeRef.current = next.mode;
							}
							next.resolve(current && !rectRequestRef.current);
						} catch (error) {
							next.resolve(false);
							appWarn(
								`[FloatingToolbarPage] Failed to set window rect: ${error}`,
							);
						} finally {
							requestAnimationFrame(() => {
								if (programmaticLayoutIdRef.current === layoutId) {
									programmaticLayoutRef.current = false;
								}
							});
						}
					}
					rectRequestRunningRef.current = false;
				})();
			}),
		[isTransitionCurrent],
	);

	const resizeToolbar = useCallback(
		async (mode: ToolbarMode, transitionId: number) => {
			try {
				// 尺寸已经是目标模式时不再调 setSize，避免多余的原生 resize 引发闪烁
				if (windowModeRef.current === mode) {
					return isTransitionCurrent(transitionId);
				}

				const [monitorInfo, previousPosition, previousSize] = await Promise.all(
					[
						getMonitorInfo(),
						appWindowRef.current.outerPosition(),
						appWindowRef.current.outerSize(),
					],
				);
				if (!monitorInfo || !isTransitionCurrent(transitionId)) {
					return false;
				}

				const logicalWidth =
					mode === "icon" ? ICON_WINDOW_WIDTH : TOOLBAR_WIDTH;
				const logicalHeight = mode === "panel" ? PANEL_HEIGHT : TOOLBAR_HEIGHT;
				const width = Math.round(logicalWidth * monitorInfo.scaleFactor);
				const height = Math.round(logicalHeight * monitorInfo.scaleFactor);
				const placement = resolveToolbarPlacement({
					position: previousPosition,
					size: previousSize,
					workArea: monitorInfo.workArea,
					scaleFactor: monitorInfo.scaleFactor,
					wasDocked: dockedRef.current,
					targetWidth: width,
					targetHeight: height,
					dockSide: dockSideRef.current,
					expandDirection: openUpwardRef.current ? "up" : "down",
				});
				dockSideRef.current = placement.dockSide;
				openUpwardRef.current = placement.expandDirection === "up";
				setDockSide(placement.dockSide);
				setOpenUpward(placement.expandDirection === "up");
				const x =
					dockedRef.current && autoHiddenRef.current && mode === "icon"
						? getDockedX(
								dockSideRef.current,
								true,
								width,
								monitorInfo.workArea.position.x,
								monitorInfo.workArea.size.width,
								monitorInfo.scaleFactor,
							)
						: placement.x;
				return requestWindowRect({
					mode,
					x,
					y: placement.y,
					width,
					height,
					transitionId,
				});
			} catch (error) {
				appWarn(`[FloatingToolbarPage] Failed to resize toolbar: ${error}`);
				return false;
			}
		},
		[getDockedX, getMonitorInfo, isTransitionCurrent, requestWindowRect],
	);

	const showDockedIcon = useCallback(
		async (transitionId: number) => {
			clearAutoHideTimer();
			if (!autoHiddenRef.current) {
				return isTransitionCurrent(transitionId);
			}

			autoHiddenRef.current = false;
			setAutoHidden(false);
			return placeWindowAtDock(false, transitionId);
		},
		[clearAutoHideTimer, isTransitionCurrent, placeWindowAtDock],
	);

	const openToolbar = useCallback(
		async (activeTransitionId?: number) => {
			const transitionId = activeTransitionId ?? beginTransition();
			clearAutoHideTimer();
			if (!(await showDockedIcon(transitionId))) {
				return false;
			}

			if (toolbarOpenRef.current) {
				if (!panelExpandedRef.current && windowModeRef.current !== "toolbar") {
					return resizeToolbar("toolbar", transitionId);
				}
				return isTransitionCurrent(transitionId);
			}

			if (!(await resizeToolbar("toolbar", transitionId))) {
				return false;
			}

			// 等待原生窗口 resize 触发的重绘/合成稳定后再启动内容动画，
			// 避免动画首帧被 resize 重绘抢占导致掉帧
			if (!(await waitForNextFrame(transitionId))) {
				return false;
			}

			updateMotionPhase("opening");
			toolbarOpenRef.current = true;
			setToolbarOpen(true);
			if (
				await waitForTransformTransition(
					quickBarRef.current,
					transitionId,
					TRANSITION_FALLBACK,
				)
			) {
				updateMotionPhase("toolbar");
			}
			return true;
		},
		[
			beginTransition,
			clearAutoHideTimer,
			isTransitionCurrent,
			resizeToolbar,
			showDockedIcon,
			updateMotionPhase,
			waitForNextFrame,
			waitForTransformTransition,
		],
	);

	const collapsePanel = useCallback(
		async (transitionId: number) => {
			if (!panelExpandedRef.current) {
				return isTransitionCurrent(transitionId);
			}

			panelExpandedRef.current = false;
			updateMotionPhase("collapsing");
			setPanelExpanded(false);
			if (
				!(await waitForTransformTransition(
					panelRef.current,
					transitionId,
					TRANSITION_FALLBACK,
				))
			) {
				return false;
			}
			const resized = await resizeToolbar("toolbar", transitionId);
			if (resized) updateMotionPhase("toolbar");
			return resized;
		},
		[
			isTransitionCurrent,
			resizeToolbar,
			updateMotionPhase,
			waitForTransformTransition,
		],
	);

	const collapseToIcon = useCallback(
		async (activeTransitionId?: number) => {
			const transitionId = activeTransitionId ?? beginTransition();
			if (!(await collapsePanel(transitionId))) {
				return false;
			}
			if (!toolbarOpenRef.current) {
				return resizeToolbar("icon", transitionId);
			}

			toolbarOpenRef.current = false;
			updateMotionPhase("collapsing");
			setToolbarOpen(false);
			if (
				!(await waitForTransformTransition(
					quickBarRef.current,
					transitionId,
					TRANSITION_FALLBACK,
				))
			) {
				return false;
			}
			const resized = await resizeToolbar("icon", transitionId);
			if (resized) updateMotionPhase("icon");
			return resized;
		},
		[
			beginTransition,
			collapsePanel,
			resizeToolbar,
			updateMotionPhase,
			waitForTransformTransition,
		],
	);

	const hideDockedIcon = useCallback(
		async (transitionId: number) => {
			if (
				!dockedRef.current ||
				toolbarOpenRef.current ||
				panelExpandedRef.current ||
				autoHiddenRef.current ||
				!isTransitionCurrent(transitionId)
			) {
				return false;
			}

			autoHiddenRef.current = true;
			setAutoHidden(true);
			return placeWindowAtDock(true, transitionId);
		},
		[isTransitionCurrent, placeWindowAtDock],
	);

	const scheduleAutoHide = useCallback(
		(delay = AUTO_HIDE_DELAY) => {
			clearAutoHideTimer();
			autoHideTimerRef.current = setTimeout(() => {
				const transitionId = beginTransition();
				void collapseToIcon(transitionId).then((collapsed) => {
					if (collapsed) {
						void hideDockedIcon(transitionId);
					}
				});
			}, delay);
		},
		[beginTransition, clearAutoHideTimer, collapseToIcon, hideDockedIcon],
	);

	useEffect(() => {
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";
		const transitionId = beginTransition();
		void resizeToolbar("icon", transitionId).then((resized) => {
			if (resized) {
				scheduleAutoHide(1400);
			}
		});

		return () => {
			transitionIdRef.current += 1;
			for (const cleanup of transitionCleanupsRef.current) cleanup();
			transitionCleanupsRef.current.clear();
			clearAutoHideTimer();
		};
	}, [beginTransition, clearAutoHideTimer, resizeToolbar, scheduleAutoHide]);

	/** 恢复上次停靠状态；延时秒数需要跟随设置变化，因此持续订阅 */
	useAppSettingsLoad(
		useCallback(
			(settings) => {
				const cache = settings[AppSettingsGroup.Cache];
				setDelaySeconds(cache.delayScreenshotSeconds);

				if (restoredPositionRef.current) {
					return;
				}
				restoredPositionRef.current = true;

				dockedRef.current = cache.floatingToolbarDocked;
				dockSideRef.current = cache.floatingToolbarDockSide;
				setDocked(cache.floatingToolbarDocked);
				setDockSide(cache.floatingToolbarDockSide);

				const transitionId = beginTransition();
				void (async () => {
					try {
						const monitor = await currentMonitor();
						if (!monitor) {
							return;
						}
						const workArea = monitor.workArea;
						const hasY = cache.floatingToolbarY !== -1;
						const hasX = cache.floatingToolbarX !== -1;
						const preferredY = hasY
							? cache.floatingToolbarY
							: workArea.position.y + Math.round(workArea.size.height * 0.25);
						const preferredX = hasX ? cache.floatingToolbarX : undefined;
						// 恢复后立即按实际面板尺寸计算展开方向，避免第一次悬停时越界。
						const size = await appWindowRef.current.outerSize();
						const placement = resolveToolbarPlacement({
							position: { x: preferredX ?? workArea.position.x, y: preferredY },
							size,
							workArea,
							scaleFactor: monitor.scaleFactor,
							wasDocked: cache.floatingToolbarDocked,
							targetWidth: Math.round(TOOLBAR_WIDTH * monitor.scaleFactor),
							targetHeight: Math.round(PANEL_HEIGHT * monitor.scaleFactor),
							dockSide: cache.floatingToolbarDockSide,
							expandDirection: "down",
						});
						openUpwardRef.current = placement.expandDirection === "up";
						setOpenUpward(openUpwardRef.current);
						await placeWindowAtDock(
							false,
							transitionId,
							preferredY,
							preferredX,
						);
						// 恢复会作废挂载时的过渡，自动隐藏需在这里重新排程
						scheduleAutoHide(1400);
					} catch (error) {
						appWarn(
							`[FloatingToolbarPage] Failed to restore position: ${error}`,
						);
					}
				})();
			},
			[beginTransition, placeWindowAtDock, scheduleAutoHide],
		),
		true,
	);

	/** 截图/绘制期间彻底隐藏原生窗口，结束后恢复到停靠图标 */
	const suspendForCapture = useCallback(async () => {
		if (suspendedRef.current) {
			return;
		}
		suspendedRef.current = true;
		beginTransition();
		clearAutoHideTimer();
		try {
			await appWindowRef.current.hide();
		} catch (error) {
			appWarn(`[FloatingToolbarPage] Failed to hide for capture: ${error}`);
		}
	}, [beginTransition, clearAutoHideTimer]);

	const clearScreenshotStartTimer = useCallback(() => {
		if (screenshotStartTimerRef.current) {
			clearTimeout(screenshotStartTimerRef.current);
			screenshotStartTimerRef.current = undefined;
		}
	}, []);

	const resumeAfterCapture = useCallback(async () => {
		clearScreenshotStartTimer();
		if (!suspendedRef.current) {
			return;
		}
		suspendedRef.current = false;

		const transitionId = beginTransition();
		toolbarOpenRef.current = false;
		panelExpandedRef.current = false;
		setToolbarOpen(false);
		setPanelExpanded(false);
		try {
			if (!(await resizeToolbar("icon", transitionId))) {
				return;
			}
			await appWindowRef.current.show();
			scheduleAutoHide(600);
		} catch (error) {
			appWarn(`[FloatingToolbarPage] Failed to resume after capture: ${error}`);
		}
	}, [
		beginTransition,
		clearScreenshotStartTimer,
		resizeToolbar,
		scheduleAutoHide,
	]);

	const runScreenshot = useCallback(
		async (type: ScreenshotType) => {
			if (activeScreenshotSessionRef.current) {
				return;
			}

			const sessionId = createScreenshotSessionId();
			activeScreenshotSessionRef.current = {
				sessionId,
				type,
				started: false,
			};
			await suspendForCapture();
			if (activeScreenshotSessionRef.current?.sessionId !== sessionId) {
				return;
			}

			// 只有未收到同一会话 started 时才触发兜底，正常流程由 finished/rejected 恢复。
			screenshotStartTimerRef.current = setTimeout(() => {
				const session = activeScreenshotSessionRef.current;
				if (session?.sessionId !== sessionId || session.started) {
					return;
				}
				activeScreenshotSessionRef.current = undefined;
				appWarn(
					`[FloatingToolbarPage] Screenshot start acknowledgement timed out: ${sessionId}`,
				);
				void resumeAfterCapture();
			}, SCREENSHOT_START_TIMEOUT);
			try {
				await executeScreenshot(
					type,
					appWindowRef.current.label,
					undefined,
					sessionId,
				);
			} catch (error) {
				if (activeScreenshotSessionRef.current?.sessionId === sessionId) {
					activeScreenshotSessionRef.current = undefined;
				}
				clearScreenshotStartTimer();
				appWarn(`[FloatingToolbarPage] Failed to execute screenshot: ${error}`);
				await resumeAfterCapture();
			}
		},
		[clearScreenshotStartTimer, resumeAfterCapture, suspendForCapture],
	);

	const runAction = useCallback(
		async (action: () => void | Promise<void>) => {
			try {
				await collapseToIcon();
				await action();
			} catch (error) {
				appWarn(`[FloatingToolbarPage] Failed to run action: ${error}`);
			} finally {
				scheduleAutoHide(500);
			}
		},
		[collapseToIcon, scheduleAutoHide],
	);

	useEffect(() => {
		const sessionId = addListener(CAPTURE_SESSION_CHANGE_EMIT_KEY, (args) => {
			const payload = (args as { payload?: CaptureSessionEvent }).payload;
			if (!payload?.sessionId || !payload.type || !payload.phase) {
				return;
			}

			const current = activeScreenshotSessionRef.current;
			if (payload.phase === "started") {
				if (current && current.sessionId !== payload.sessionId) {
					return;
				}
				if (!current) {
					activeScreenshotSessionRef.current = {
						sessionId: payload.sessionId,
						type: payload.type,
						started: true,
					};
				} else {
					current.started = true;
				}
				clearScreenshotStartTimer();
				void suspendForCapture();
				return;
			}

			if (!current || current.sessionId !== payload.sessionId) {
				return;
			}
			activeScreenshotSessionRef.current = undefined;
			clearScreenshotStartTimer();
			if (payload.phase === "rejected") {
				appWarn(
					`[FloatingToolbarPage] Screenshot session rejected (${payload.sessionId}): ${payload.reason ?? "unknown"}`,
				);
			}
			void resumeAfterCapture();
		});

		return () => {
			removeListener(sessionId);
			clearScreenshotStartTimer();
		};
	}, [
		addListener,
		clearScreenshotStartTimer,
		removeListener,
		resumeAfterCapture,
		suspendForCapture,
	]);

	const toggleExpanded = useCallback(async () => {
		const transitionId = beginTransition();
		if (!(await openToolbar(transitionId))) {
			return;
		}
		const nextExpanded = !panelExpandedRef.current;
		panelExpandedRef.current = nextExpanded;
		if (nextExpanded) {
			if (!(await resizeToolbar("panel", transitionId))) {
				return;
			}
			updateMotionPhase("expanding");
			setPanelExpanded(true);
			if (
				await waitForTransformTransition(
					panelRef.current,
					transitionId,
					TRANSITION_FALLBACK,
				)
			) {
				updateMotionPhase("panel");
			}
			return;
		}

		updateMotionPhase("collapsing");
		setPanelExpanded(false);
		if (
			!(await waitForTransformTransition(
				panelRef.current,
				transitionId,
				TRANSITION_FALLBACK,
			))
		) {
			return;
		}
		if (!(await resizeToolbar("toolbar", transitionId))) {
			return;
		}
		updateMotionPhase("toolbar");
		scheduleAutoHide();
	}, [
		beginTransition,
		openToolbar,
		resizeToolbar,
		scheduleAutoHide,
		updateMotionPhase,
		waitForTransformTransition,
	]);

	const dockWindow = useCallback(async () => {
		try {
			const transitionId = beginTransition();
			clearAutoHideTimer();
			const monitor = await currentMonitor();
			if (!monitor || !isTransitionCurrent(transitionId)) {
				return;
			}

			const [position, size] = await Promise.all([
				appWindowRef.current.outerPosition(),
				appWindowRef.current.outerSize(),
			]);
			if (!isTransitionCurrent(transitionId)) {
				return;
			}
			const placement = resolveToolbarPlacement({
				position,
				size,
				workArea: monitor.workArea,
				scaleFactor: monitor.scaleFactor,
				wasDocked: dockedRef.current,
				targetWidth: Math.round(ICON_WINDOW_WIDTH * monitor.scaleFactor),
				targetHeight: Math.round(TOOLBAR_HEIGHT * monitor.scaleFactor),
				dockSide: dockSideRef.current,
				expandDirection: openUpwardRef.current ? "up" : "down",
			});
			const nextDocked = placement.docked;
			const nextDockSide = placement.dockSide;
			const nextOpenUpward = placement.expandDirection === "up";

			dockSideRef.current = nextDockSide;
			dockedRef.current = nextDocked;
			openUpwardRef.current = nextOpenUpward;
			autoHiddenRef.current = false;
			setDockSide(nextDockSide);
			setDocked(nextDocked);
			setOpenUpward(nextOpenUpward);
			setAutoHidden(false);
			if (!(await collapseToIcon(transitionId))) {
				return;
			}
			if (!(await placeWindowAtDock(false, transitionId))) {
				return;
			}
			void savePosition();
			scheduleAutoHide();
		} catch (error) {
			appWarn(`[FloatingToolbarPage] Failed to dock toolbar: ${error}`);
		}
	}, [
		beginTransition,
		clearAutoHideTimer,
		collapseToIcon,
		isTransitionCurrent,
		placeWindowAtDock,
		savePosition,
		scheduleAutoHide,
	]);

	useEffect(() => {
		let disposed = false;
		let unlisten: (() => void) | undefined;

		void appWindowRef.current
			.onMoved(() => {
				if (
					disposed ||
					suspendedRef.current ||
					programmaticLayoutRef.current ||
					Date.now() < programmaticMoveUntilRef.current
				) {
					return;
				}

				beginTransition();
				clearAutoHideTimer();
				// 用户拖动可能跨越显示器，立即让显示器缓存失效
				monitorInfoExpireRef.current = 0;
				if (moveDebounceTimerRef.current) {
					clearTimeout(moveDebounceTimerRef.current);
				}
				moveDebounceTimerRef.current = setTimeout(() => {
					void dockWindow();
				}, DRAG_SETTLE_DELAY);
			})
			.then((listener) => {
				if (disposed) {
					listener();
					return;
				}
				unlisten = listener;
			});

		return () => {
			disposed = true;
			unlisten?.();
			if (moveDebounceTimerRef.current) {
				clearTimeout(moveDebounceTimerRef.current);
			}
		};
	}, [beginTransition, clearAutoHideTimer, dockWindow]);

	const onMouseEnter = useCallback(() => {
		if (suspendedRef.current) {
			return;
		}
		void openToolbar();
	}, [openToolbar]);

	const onMouseLeave = useCallback(() => {
		if (suspendedRef.current) {
			return;
		}
		scheduleAutoHide();
	}, [scheduleAutoHide]);

	/** Esc 收起面板/工具栏，与 PixPin 的键盘退出行为一致 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			const transitionId = beginTransition();
			clearAutoHideTimer();
			void collapseToIcon(transitionId).then((collapsed) => {
				if (collapsed) {
					void hideDockedIcon(transitionId);
				}
			});
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [beginTransition, clearAutoHideTimer, collapseToIcon, hideDockedIcon]);

	/** 双击 Logo 恢复自动停靠到最近边缘 */
	const resetToNearestEdge = useCallback(async () => {
		try {
			const transitionId = beginTransition();
			clearAutoHideTimer();
			const monitor = await currentMonitor();
			if (!monitor || !isTransitionCurrent(transitionId)) {
				return;
			}

			const [position, size] = await Promise.all([
				appWindowRef.current.outerPosition(),
				appWindowRef.current.outerSize(),
			]);
			if (!isTransitionCurrent(transitionId)) {
				return;
			}
			const placement = resolveToolbarPlacement({
				position,
				size,
				workArea: monitor.workArea,
				scaleFactor: monitor.scaleFactor,
				wasDocked: true,
				targetWidth: Math.round(ICON_WINDOW_WIDTH * monitor.scaleFactor),
				targetHeight: Math.round(TOOLBAR_HEIGHT * monitor.scaleFactor),
				dockSide: dockSideRef.current,
				expandDirection: openUpwardRef.current ? "up" : "down",
			});
			const nextDockSide = placement.dockSide;

			dockedRef.current = true;
			dockSideRef.current = nextDockSide;
			autoHiddenRef.current = false;
			setDocked(true);
			setDockSide(nextDockSide);
			setAutoHidden(false);
			if (!(await collapseToIcon(transitionId))) {
				return;
			}
			if (!(await placeWindowAtDock(false, transitionId))) {
				return;
			}
			void savePosition();
			scheduleAutoHide();
		} catch (error) {
			appWarn(`[FloatingToolbarPage] Failed to reset dock: ${error}`);
		}
	}, [
		beginTransition,
		clearAutoHideTimer,
		collapseToIcon,
		isTransitionCurrent,
		placeWindowAtDock,
		savePosition,
		scheduleAutoHide,
	]);

	const closeToolbar = useCallback(async () => {
		await closeFloatingToolbarWindow();
	}, []);

	return (
		<div
			className={`ft-wrapper ft-wrapper--dock-${dockSide}${
				toolbarOpen ? " ft-wrapper--toolbar-open" : ""
			}${panelExpanded ? " ft-wrapper--panel-expanded" : ""}${
				openUpward ? " ft-wrapper--open-up" : ""
			}${docked ? "" : " ft-wrapper--floating"}${
				autoHidden ? " ft-wrapper--auto-hidden" : ""
			} ft-wrapper--phase-${motionPhase}`}
			onContextMenu={(event) => event.preventDefault()}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			<div className="ft-top-row">
				<div className="ft-quick-bar" ref={quickBarRef}>
					<ToolButton
						className="ft-quick-btn"
						icon={<ScissorOutlined />}
						title={intl.formatMessage({ id: "home.screenshot" })}
						onClick={() => runScreenshot(ScreenshotType.Default)}
					/>
					<ToolButton
						className="ft-quick-btn"
						icon={<PushpinOutlined />}
						title={intl.formatMessage({ id: "home.fixedContent" })}
						onClick={() => runAction(createFixedContentWindow)}
					/>
					<ToolButton
						className="ft-quick-btn"
						icon={<ClockCircleOutlined />}
						title={intl.formatMessage(
							{ id: "home.screenshotFunction.screenshotDelay" },
							{
								seconds: intl.formatMessage(
									{ id: "home.screenshotFunction.screenshotDelay.seconds" },
									{ seconds: delaySeconds },
								),
							},
						)}
						onClick={() => runScreenshot(ScreenshotType.Delay)}
					/>
					<ToolButton
						className={`ft-quick-btn${panelExpanded ? " ft-quick-btn--active" : ""}`}
						icon={<EllipsisOutlined />}
						title={intl.formatMessage({ id: "floatingToolbar.more" })}
						onClick={toggleExpanded}
					/>
				</div>

				<div
					className="ft-logo"
					data-tauri-drag-region
					onDoubleClick={resetToNearestEdge}
					title={intl.formatMessage({ id: "floatingToolbar.resetPosition" })}
				>
					<img alt="Qxq" draggable={false} src="/images/app-icon.png" />
				</div>
			</div>

			<div
				className={`ft-panel${panelExpanded ? " ft-panel--open" : ""}`}
				ref={panelRef}
			>
				<div className="ft-panel-grid">
					<ToolButton
						className="ft-panel-btn"
						disabled={!capabilities.ocrDetect}
						icon={<OcrDetectIcon />}
						title={intl.formatMessage({ id: "draw.ocrDetectTool" })}
						onClick={() => runScreenshot(ScreenshotType.OcrDetect)}
					/>
					<ToolButton
						className="ft-panel-btn"
						disabled={!capabilities.ocrTranslate}
						icon={<OcrTranslateIcon />}
						title={intl.formatMessage({ id: "draw.ocrTranslateTool" })}
						onClick={() => runScreenshot(ScreenshotType.OcrTranslate)}
					/>
					<ToolButton
						className="ft-panel-btn"
						disabled={!capabilities.videoRecord}
						icon={<VideoRecordIcon />}
						title={intl.formatMessage({ id: "home.videoRecordFunction" })}
						onClick={() => runScreenshot(ScreenshotType.VideoRecord)}
					/>
					<ToolButton
						className="ft-panel-btn"
						icon={<FullScreenIcon />}
						title={intl.formatMessage({
							id: "home.screenshotFunction.screenshotFullScreen",
						})}
						onClick={() => runScreenshot(ScreenshotType.CaptureFullScreen)}
					/>
					<ToolButton
						className="ft-panel-btn"
						icon={<FullScreenDrawIcon />}
						title={intl.formatMessage({ id: "home.fullScreenDraw" })}
						onClick={() => runAction(createFullScreenDrawWindow)}
					/>
					<ToolButton
						className="ft-panel-btn"
						icon={<PushpinOutlined />}
						title={intl.formatMessage({ id: "home.fixedContent" })}
						onClick={() => runAction(createFixedContentWindow)}
					/>
				</div>

				<div className="ft-panel-footer">
					<button
						className="ft-settings-btn"
						onClick={() =>
							runAction(async () => {
								await showMainWindow();
							})
						}
						type="button"
					>
						<SettingOutlined />
						<span>
							{intl.formatMessage({ id: "floatingToolbar.settings" })}
						</span>
					</button>
					<ToolButton
						className="ft-close-btn"
						icon={<CloseOutlined />}
						title={intl.formatMessage({ id: "floatingToolbar.close" })}
						onClick={closeToolbar}
					/>
				</div>
			</div>

			<style jsx>{`
					:global(html),
					:global(body),
					:global(#root),
					:global(.ant-app) {
						background: transparent !important;
					}

			.ft-wrapper {
				--ft-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
				--ft-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
				--ft-duration-fast: 120ms;
				--ft-duration-enter: 180ms;
				--ft-duration-move: 200ms;
				position: fixed;
					inset: 0;
					z-index: ${zIndexs.FloatingToolbar};
					box-sizing: border-box;
						width: 100vw;
						height: ${TOOLBAR_HEIGHT}px;
							padding: 0;
						overflow: hidden;
						background: transparent;
						opacity: 1;
						user-select: none;
						/* 窗口高度由原生 resize 控制，height transition 无意义且会与原生变化不同步；
						 * contain 隔离重布局范围，降低动画期间的重绘成本 */
						contain: layout paint;
				transition: opacity var(--ft-duration-enter) var(--ft-ease-out);
					}

						.ft-wrapper--panel-expanded {
							height: ${PANEL_HEIGHT}px;
					}

					.ft-wrapper--auto-hidden {
						opacity: 0.56;
					}

						.ft-top-row {
							position: absolute;
							top: 8px;
							left: 0;
							width: 100%;
							height: 56px;
						}

						.ft-wrapper--open-up .ft-top-row {
							top: auto;
							bottom: 8px;
						}

				.ft-quick-bar,
				.ft-logo,
				.ft-panel {
					box-sizing: border-box;
					background: ${token.colorBgContainer};
						border: 0;
						box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
				}

					.ft-quick-bar {
						position: absolute;
						top: 0;
						display: flex;
						align-items: center;
						justify-content: space-between;
						width: 184px;
						height: 56px;
						padding: 6px 8px;
							border-radius: 16px;
						opacity: 0;
						pointer-events: none;
				transition: opacity var(--ft-duration-enter) var(--ft-ease-out),
					transform var(--ft-duration-enter) var(--ft-ease-out);
			}

			.ft-wrapper--phase-opening .ft-quick-bar,
			.ft-wrapper--phase-collapsing .ft-quick-bar,
			.ft-wrapper--phase-expanding .ft-panel,
			.ft-wrapper--phase-collapsing .ft-panel {
				will-change: transform, opacity;
			}

					.ft-wrapper--dock-right .ft-quick-bar {
						right: 72px;
				transform: translateX(26px) scale(0.9);
						transform-origin: center right;
					}

					.ft-wrapper--dock-left .ft-quick-bar {
						left: 72px;
				transform: translateX(-26px) scale(0.9);
						transform-origin: center left;
					}

					.ft-wrapper--toolbar-open .ft-quick-bar {
						opacity: 1;
						pointer-events: auto;
						transform: translateX(0) scale(1);
					}

					.ft-logo {
						position: absolute;
						top: 0;
						display: grid;
					place-items: center;
						width: 56px;
						height: 56px;
							border-radius: 16px;
						cursor: grab;
				transition: opacity var(--ft-duration-enter) var(--ft-ease-out),
					transform var(--ft-duration-enter) var(--ft-ease-out),
					box-shadow var(--ft-duration-enter) var(--ft-ease-out);
					}

					.ft-wrapper--dock-right .ft-logo {
						right: 8px;
					}

					.ft-wrapper--dock-left .ft-logo {
						left: 8px;
					}

					.ft-wrapper--toolbar-open .ft-logo {
						transform: scale(1.02);
					}

					.ft-wrapper--auto-hidden .ft-logo {
						transform: scale(0.92);
					}

				.ft-logo:active {
					cursor: grabbing;
				}

				.ft-logo img {
						width: 38px;
						height: 38px;
						border-radius: 11px;
					pointer-events: none;
				}

				:global(.ft-quick-btn),
				:global(.ft-panel-btn),
				:global(.ft-close-btn),
				.ft-settings-btn {
					border: 0;
					color: ${token.colorText};
					background: transparent;
					cursor: pointer;
				}

				:global(.ft-quick-btn) {
					display: grid;
					place-items: center;
						width: 38px;
						height: 40px;
					padding: 0;
						border-radius: 11px;
						font-size: 22px;
				transition: background var(--ft-duration-fast) ease,
					transform var(--ft-duration-fast) var(--ft-ease-out);
			}

			:global(.ft-quick-btn--active),
			.ft-settings-btn:focus-visible {
				background: ${token.colorFillSecondary};
			}

			@media (hover: hover) and (pointer: fine) {
				:global(.ft-quick-btn:hover),
				:global(.ft-panel-btn:hover),
				.ft-settings-btn:hover {
					background: ${token.colorFillSecondary};
				}
			}

				:global(.ft-quick-btn:active),
				:global(.ft-panel-btn:active),
				:global(.ft-close-btn:active),
				.ft-settings-btn:active {
				transform: scale(0.97);
				}

				/* 插件未就绪时保留按钮位置，仅降低可读性并禁用交互 */
				:global(.ft-btn--disabled),
				:global(.ft-btn--disabled:hover),
				:global(.ft-btn--disabled:active) {
					color: ${token.colorTextDisabled};
					background: transparent;
					transform: none;
					cursor: not-allowed;
				}

					.ft-panel {
						position: absolute;
						top: 72px;
						right: 8px;
						width: 188px;
						height: 132px;
						padding: 8px 10px;
						border-radius: 14px;
					opacity: 0;
					pointer-events: none;
					transform: translateY(-8px) scale(0.97);
					transform-origin: top right;
				transition: opacity var(--ft-duration-move) var(--ft-ease-in-out),
					transform var(--ft-duration-move) var(--ft-ease-in-out);
					}

					.ft-wrapper--dock-left .ft-panel {
						right: auto;
						left: 8px;
						transform-origin: top left;
					}

					.ft-wrapper--open-up .ft-panel {
						top: auto;
						bottom: 72px;
						transform: translateY(8px) scale(0.97);
						transform-origin: bottom right;
					}

					.ft-wrapper--dock-left.ft-wrapper--open-up .ft-panel {
						transform-origin: bottom left;
					}

					.ft-panel--open {
						opacity: 1;
						pointer-events: auto;
						transform: translateY(0) scale(1);
				}

				.ft-panel-grid {
					display: grid;
					grid-template-columns: repeat(3, 1fr);
						gap: 4px;
				}

				:global(.ft-panel-btn) {
					display: grid;
					place-items: center;
						width: 52px;
						height: 36px;
					padding: 0;
						border-radius: 10px;
						font-size: 21px;
				transition: background var(--ft-duration-fast) ease,
					transform var(--ft-duration-fast) var(--ft-ease-out);
				}

				.ft-panel-footer {
					display: flex;
					align-items: center;
					justify-content: flex-end;
					gap: 4px;
						margin-top: 4px;
				}

				.ft-settings-btn {
					display: inline-flex;
					align-items: center;
					gap: 6px;
						height: 24px;
					padding: 0 8px;
					border-radius: 9px;
					color: ${token.colorTextSecondary};
						font-size: 12px;
				transition: background var(--ft-duration-fast) ease,
					transform var(--ft-duration-fast) var(--ft-ease-out);
				}

				:global(.ft-close-btn) {
					display: grid;
					place-items: center;
						width: 24px;
						height: 24px;
					padding: 0;
					border-radius: 9px;
					font-size: 13px;
				transition: color var(--ft-duration-fast) ease,
					background var(--ft-duration-fast) ease,
					transform var(--ft-duration-fast) var(--ft-ease-out);
				}

			@media (hover: hover) and (pointer: fine) {
				:global(.ft-close-btn:hover) {
					color: ${token.colorError};
					background: ${token.colorErrorBg};
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.ft-quick-bar,
				.ft-logo,
				.ft-panel {
					transition: opacity var(--ft-duration-fast) ease,
						background-color var(--ft-duration-fast) ease;
					transform: none;
					will-change: auto;
				}

				:global(.ft-quick-btn),
				:global(.ft-panel-btn),
				:global(.ft-close-btn),
				.ft-settings-btn {
					transition: color var(--ft-duration-fast) ease,
						background-color var(--ft-duration-fast) ease;
				}
			}
			`}</style>
		</div>
	);
};
