import { describe, expect, it } from "vitest";
import config from "./rsbuild.config";

describe("Rsbuild development chunking", () => {
	it("keeps the Tauri development runtime in one HMR-safe bundle", () => {
		expect(config.performance?.chunkSplit).toMatchObject({
			strategy: "all-in-one",
		});
		expect(config.tools?.rspack).toMatchObject({
			output: {
				asyncChunks: false,
			},
		});
	});
});
