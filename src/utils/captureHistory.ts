import { extname } from "node:path";
import type {
	NonDeletedExcalidrawElement,
	Ordered,
} from "@mg-chao/excalidraw/element/types";
import type { AppState } from "@mg-chao/excalidraw/types";
import { join as joinPath } from "@tauri-apps/api/path";
import { retainDirFiles } from "@/commands/core";
import {
	copyFile,
	createDir,
	getAppConfigBaseDir,
	removeDir,
	removeFile,
	writeFile,
} from "@/commands/file";
import {
	type AppSettingsData,
	AppSettingsGroup,
	HistoryValidDuration,
} from "@/types/appSettings";
import {
	type ElementRect,
	type ImageBuffer,
	ImageEncoder,
} from "@/types/commands/screenshot";
import type { EncodeImageData } from "@/types/utils/captureHistory";
import {
	type CaptureHistoryItem,
	type CaptureHistorySource,
	CaptureHistoryStore,
} from "./appStore";
import { appError, appWarn } from "./log";

const captureHistoryImagesDir = "captureHistoryImages";

const getCaptureImageFilePath = (fileName: string) => {
	return `${captureHistoryImagesDir}/${fileName}`;
};

const getCaptureHistoryImageAbsPathCache = new Map<string, string>();
export const getCaptureHistoryImageAbsPath = async (fileName: string) => {
	const cachePath = getCaptureHistoryImageAbsPathCache.get(fileName);
	if (cachePath !== undefined) {
		return cachePath;
	}

	const path = await joinPath(
		await getAppConfigBaseDir(),
		getCaptureImageFilePath(fileName),
	);
	getCaptureHistoryImageAbsPathCache.set(fileName, path);

	return path;
};

export class CaptureHistory {
	private store: CaptureHistoryStore;

	constructor() {
		this.store = new CaptureHistoryStore();
	}

	async init() {
		await this.store.init();
	}

	async inited() {
		return this.store.inited();
	}

	static generateCaptureHistoryItem(
		imageBuffer:
			| ImageBuffer
			| EncodeImageData
			| CaptureHistoryItem
			| "full-screen",
		excalidrawElements:
			| readonly Ordered<NonDeletedExcalidrawElement>[]
			| undefined,
		excalidrawAppState: Readonly<AppState> | undefined,
		selectedRect: ElementRect | undefined,
		captureResult?: ArrayBuffer,
		source?: CaptureHistorySource,
	): CaptureHistoryItem {
		let fileExtension = ".webp";
		if (imageBuffer === "full-screen") {
			fileExtension = ".png";
		} else if ("encoder" in imageBuffer) {
			switch (imageBuffer.encoder) {
				case ImageEncoder.WebP:
					fileExtension = ".webp";
					break;
				case ImageEncoder.Png:
					fileExtension = ".png";
					break;
			}
		} else if ("encodeData" in imageBuffer) {
			fileExtension = ".png";
		} else {
			fileExtension = extname(imageBuffer.file_name);
		}

		const timestamp = Date.now();
		const fileName = `${timestamp}${fileExtension}`;

		return {
			id: timestamp.toString(),
			selected_rect: selectedRect ?? {
				min_x: 0,
				min_y: 0,
				max_x: 0,
				max_y: 0,
			},
			file_name: fileName,
			create_ts: timestamp,
			excalidraw_elements: excalidrawElements,
			excalidraw_app_state: excalidrawAppState
				? ({
						zoom: excalidrawAppState.zoom,
						scrollX: excalidrawAppState.scrollX,
						scrollY: excalidrawAppState.scrollY,
					} as CaptureHistoryItem["excalidraw_app_state"])
				: undefined,
			capture_result_file_name: captureResult
				? `${timestamp}_capture_result.png`
				: undefined,
			source,
		};
	}

	async save(
		imageData:
			| ImageBuffer
			| EncodeImageData
			| CaptureHistoryItem
			| {
					type: "full-screen";
					captureHistoryItem: CaptureHistoryItem;
			  },
		excalidrawElements:
			| readonly Ordered<NonDeletedExcalidrawElement>[]
			| undefined,
		excalidrawAppState: Readonly<AppState> | undefined,
		selectedRect: ElementRect,
		captureResult?: ArrayBuffer,
		source?: CaptureHistorySource,
	): Promise<CaptureHistoryItem> {
		const captureHistoryItem =
			"type" in imageData
				? imageData.captureHistoryItem
				: CaptureHistory.generateCaptureHistoryItem(
						imageData,
						excalidrawElements,
						excalidrawAppState,
						selectedRect,
						captureResult,
						source,
					);

		try {
			await createDir(await getCaptureHistoryImageAbsPath(""));

			let writeActionPromise = Promise.resolve();
			if ("encoder" in imageData) {
				writeActionPromise = writeFile(
					await getCaptureHistoryImageAbsPath(captureHistoryItem.file_name),
					imageData.buffer,
				);
			} else if ("encodeData" in imageData) {
				writeActionPromise = writeFile(
					await getCaptureHistoryImageAbsPath(captureHistoryItem.file_name),
					imageData.encodeData,
				);
			} else if ("type" in imageData) {
			} else {
				writeActionPromise = copyFile(
					await getCaptureHistoryImageAbsPath(imageData.file_name),
					await getCaptureHistoryImageAbsPath(captureHistoryItem.file_name),
				);
			}

			await Promise.all([
				writeActionPromise,
				captureHistoryItem.capture_result_file_name && captureResult
					? writeFile(
							await getCaptureHistoryImageAbsPath(
								captureHistoryItem.capture_result_file_name,
							),
							captureResult,
						)
					: Promise.resolve(),
			]);

			await this.store.set(captureHistoryItem.id, captureHistoryItem);
		} catch (error) {
			appError("[CaptureHistory] save captureHistoryItem failed", error);
		}

		return captureHistoryItem;
	}

	async getList(appSettings: AppSettingsData): Promise<CaptureHistoryItem[]> {
		const now = Date.now();
		const validTime =
			appSettings[AppSettingsGroup.SystemScreenshot].historyValidDuration ===
			HistoryValidDuration.Forever
				? 0
				: now -
					appSettings[AppSettingsGroup.SystemScreenshot].historyValidDuration;

		const historyList = await this.store.entries().then((entries) => {
			return entries.filter(([, item]) => {
				return item.create_ts > validTime;
			});
		});
		return historyList
			.map(([, item]) => {
				return item;
			})
			.sort((a, b) => {
				// 按创建时间正序
				return a.create_ts - b.create_ts;
			});
	}

	async clearExpired(appSettings: AppSettingsData) {
		if (
			appSettings[AppSettingsGroup.SystemScreenshot].historyValidDuration ===
			HistoryValidDuration.Forever
		) {
			return;
		}

		const historyList = await this.store.entries();

		const now = Date.now();
		const validTime =
			now - appSettings[AppSettingsGroup.SystemScreenshot].historyValidDuration;

		const retainedFileNames = new Set<string>();

		await Promise.all(
			historyList.map(async ([id, item]) => {
				if (item.create_ts > validTime) {
					retainedFileNames.add(item.file_name);
					if (item.capture_result_file_name) {
						retainedFileNames.add(item.capture_result_file_name);
					}
					return;
				}

				if (!(await this.delete(id, item))) {
					retainedFileNames.add(item.file_name);
					if (item.capture_result_file_name) {
						retainedFileNames.add(item.capture_result_file_name);
					}
				}
			}),
		);

		try {
			await retainDirFiles(await getCaptureHistoryImageAbsPath(""), [
				...retainedFileNames,
			]);
		} catch (error) {
			appWarn("[CaptureHistory] retain captureHistoryImagesDir failed", error);
		}
	}

	async delete(id: string, item?: CaptureHistoryItem): Promise<boolean> {
		if (!item) {
			item = await this.store.get(id);
		}

		if (!item) {
			return true;
		}

		try {
			await this.store.delete(id);
		} catch (error) {
			appWarn("[CaptureHistory] delete captureHistoryItem failed", error);
			return false;
		}

		await Promise.all([
			(async () => {
				try {
					await removeFile(await getCaptureHistoryImageAbsPath(item.file_name));
				} catch (error) {
					appWarn(
						"[CaptureHistory] remove captureHistoryItem image failed",
						error,
					);
				}
			})(),
			(async () => {
				if (!item.capture_result_file_name) {
					return;
				}

				try {
					await removeFile(
						await getCaptureHistoryImageAbsPath(item.capture_result_file_name),
					);
				} catch (error) {
					appWarn(
						"[CaptureHistory] remove captureHistoryItem captureResult image failed",
						error,
					);
				}
			})(),
		]);

		return true;
	}

	async clearAll() {
		await this.store.clear();
		try {
			await removeDir(await getCaptureHistoryImageAbsPath(""));
		} catch (error) {
			appWarn("[CaptureHistory] remove captureHistoryImagesDir failed", error);
		}
	}
}
