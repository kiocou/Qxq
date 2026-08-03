import { describe, expect, it } from "vitest";
import { hasAppLayout } from "./usePathname";

describe("hasAppLayout", () => {
	it.each([
		"/draw",
		"/fixedContent",
		"/fullScreenDraw",
		"/fullScreenDrawSwitchMouseThrough",
		"/videoRecord",
		"/videoRecordToolbar",
		"/idle",
		"/floatingToolbar",
	])("classifies %s as a no-layout window", (pathname) => {
		expect(hasAppLayout(pathname)).toBe(false);
	});

	it("keeps regular application pages in the main layout", () => {
		expect(hasAppLayout("/tools/translation")).toBe(true);
	});
});
