import { describe, expect, it } from "vitest";
import {
	DOCK_ENTER_DISTANCE,
	DOCK_EXIT_DISTANCE,
	resolveToolbarPlacement,
} from "./geometry";

const workArea = {
	position: { x: 0, y: 0 },
	size: { width: 1920, height: 1040 },
};

function place(
	overrides: Partial<Parameters<typeof resolveToolbarPlacement>[0]> = {},
) {
	return resolveToolbarPlacement({
		position: { x: 400, y: 300 },
		size: { width: 72, height: 72 },
		workArea,
		scaleFactor: 1,
		wasDocked: false,
		targetWidth: 264,
		targetHeight: 220,
		dockSide: "left",
		expandDirection: "down",
		...overrides,
	});
}

describe("resolveToolbarPlacement", () => {
	it("docks to the nearest left or right work-area edge", () => {
		expect(place({ position: { x: 20, y: 200 } })).toMatchObject({
			docked: true,
			dockSide: "left",
			x: 0,
		});
		expect(place({ position: { x: 1820, y: 200 } })).toMatchObject({
			docked: true,
			dockSide: "right",
			x: 1656,
		});
	});

	it("uses 36/56 logical-pixel hysteresis", () => {
		expect(place({ position: { x: DOCK_ENTER_DISTANCE, y: 200 } }).docked).toBe(
			true,
		);
		expect(
			place({ position: { x: DOCK_ENTER_DISTANCE + 1, y: 200 } }).docked,
		).toBe(false);
		expect(
			place({ position: { x: DOCK_EXIT_DISTANCE, y: 200 }, wasDocked: true })
				.docked,
		).toBe(true);
		expect(
			place({
				position: { x: DOCK_EXIT_DISTANCE + 1, y: 200 },
				wasDocked: true,
			}).docked,
		).toBe(false);
	});

	it.each([1.25, 1.5])("scales policy distances at %sx", (scaleFactor) => {
		expect(
			place({ position: { x: 36 * scaleFactor, y: 200 }, scaleFactor }).docked,
		).toBe(true);
		expect(
			place({ position: { x: 36 * scaleFactor + 1, y: 200 }, scaleFactor })
				.docked,
		).toBe(false);
	});

	it("supports negative-origin monitors", () => {
		const result = place({
			position: { x: -1590, y: 120 },
			workArea: {
				position: { x: -1600, y: -40 },
				size: { width: 1600, height: 900 },
			},
		});
		expect(result).toMatchObject({ docked: true, dockSide: "left", x: -1600 });
	});

	it("clamps the top-left and bottom-right corners to the work-area gutter", () => {
		expect(place({ position: { x: 100, y: -100 } }).y).toBe(8);
		expect(
			place({
				position: { x: 1700, y: 1000 },
				size: { width: 72, height: 72 },
				dockSide: "right",
			}),
		).toMatchObject({
			dockSide: "right",
			expandDirection: "up",
			y: 812,
		});
	});

	it("expands on either horizontal side while keeping the logo centre", () => {
		const rightward = place({ position: { x: 100, y: 200 }, dockSide: "left" });
		const leftward = place({
			position: { x: 1700, y: 200 },
			dockSide: "right",
		});
		expect(rightward).toMatchObject({
			docked: false,
			dockSide: "left",
			x: 100,
		});
		expect(leftward).toMatchObject({
			docked: false,
			dockSide: "right",
			x: 1508,
		});
	});

	it("chooses upward expansion near the bottom and downward near the top", () => {
		expect(place({ position: { x: 500, y: 20 } }).expandDirection).toBe("down");
		expect(place({ position: { x: 500, y: 950 } }).expandDirection).toBe("up");
	});

	it("returns a deterministic clamped rect when the panel is larger than the work area", () => {
		const result = place({
			position: { x: 10, y: 10 },
			workArea: {
				position: { x: -100, y: -50 },
				size: { width: 180, height: 140 },
			},
			targetWidth: 260,
			targetHeight: 220,
		});
		expect(result.x).toBe(-180);
		expect(result.y).toBe(-42);
		expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
	});

	it("chooses the free-floating side that moves the window least on an edge tie", () => {
		const position = { x: (1920 - 72) / 2, y: 300 };
		expect(place({ position, dockSide: "right" }).dockSide).toBe("left");
	});
});
