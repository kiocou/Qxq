import { removeDir, textFileClear } from "@/commands/file";
import { getConfigDirPath } from "./environment";

export const clearAllConfig = async () => {
	const configDirPath = await getConfigDirPath();
	await Promise.all([
		textFileClear(),
		configDirPath ? removeDir(configDirPath) : Promise.resolve(),
	]);
};
