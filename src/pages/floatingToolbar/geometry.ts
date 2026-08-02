export type DockSide = "left" | "right";
export type ExpandDirection = "up" | "down";

export const DOCK_ENTER_DISTANCE = 36;
export const DOCK_EXIT_DISTANCE = 56;
export const WORK_AREA_GUTTER = 8;

const LOGO_SIZE = 56;

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rect = { position: Point; size: Size };

export interface ToolbarPlacementInput {
	position: Point;
	size: Size;
	workArea: Rect;
	scaleFactor: number;
	wasDocked: boolean;
	targetWidth: number;
	targetHeight: number;
	/** Current side, used to make exact ties stable and preserve the logo anchor. */
	dockSide?: DockSide;
	/** Current vertical anchor, used to preserve the logo centre while resizing. */
	expandDirection?: ExpandDirection;
}

export interface ToolbarPlacement {
	docked: boolean;
	dockSide: DockSide;
	expandDirection: ExpandDirection;
	x: number;
	y: number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
	if (maximum < minimum) {
		return minimum;
	}
	return Math.min(Math.max(value, minimum), maximum);
}

export function resolveDockState(input: {
	distanceToLeft: number;
	distanceToRight: number;
	scaleFactor: number;
	wasDocked: boolean;
}): boolean {
	const threshold =
		(input.wasDocked ? DOCK_EXIT_DISTANCE : DOCK_ENTER_DISTANCE) *
		input.scaleFactor;
	return Math.min(input.distanceToLeft, input.distanceToRight) <= threshold;
}

export function resolveExpandDirection(input: {
	y: number;
	height: number;
	targetHeight: number;
	workArea: Rect;
	scaleFactor: number;
	previousDirection?: ExpandDirection;
}): ExpandDirection {
	const gutter = WORK_AREA_GUTTER * input.scaleFactor;
	const top = input.workArea.position.y + gutter;
	const bottom =
		input.workArea.position.y + input.workArea.size.height - gutter;
	const logoInset = (WORK_AREA_GUTTER + LOGO_SIZE / 2) * input.scaleFactor;
	const logoCenter =
		input.previousDirection === "up"
			? input.y + input.height - logoInset
			: input.y + logoInset;
	const downY = logoCenter - logoInset;
	const upY = logoCenter + logoInset - input.targetHeight;
	const downFits = downY >= top && downY + input.targetHeight <= bottom;
	const upFits = upY >= top && upY + input.targetHeight <= bottom;

	if (downFits && upFits) {
		return input.previousDirection ?? "down";
	}
	if (downFits) return "down";
	if (upFits) return "up";

	const spaceBelow = bottom - downY;
	const spaceAbove = upY + input.targetHeight - top;
	return spaceBelow >= spaceAbove ? "down" : "up";
}

export function resolveToolbarPlacement(
	input: ToolbarPlacementInput,
): ToolbarPlacement {
	const scale = Math.max(input.scaleFactor, Number.EPSILON);
	const gutter = WORK_AREA_GUTTER * scale;
	const left = input.workArea.position.x;
	const right = left + input.workArea.size.width;
	const top = input.workArea.position.y;
	const bottom = top + input.workArea.size.height;
	const distanceToLeft = Math.abs(input.position.x - left);
	const distanceToRight = Math.abs(
		right - (input.position.x + input.size.width),
	);
	const nearestSide: DockSide =
		distanceToLeft === distanceToRight
			? (input.dockSide ?? "left")
			: distanceToLeft < distanceToRight
				? "left"
				: "right";
	const docked = resolveDockState({
		distanceToLeft,
		distanceToRight,
		scaleFactor: scale,
		wasDocked: input.wasDocked,
	});

	const logoInset = (WORK_AREA_GUTTER + LOGO_SIZE / 2) * scale;
	const currentSide = input.dockSide ?? nearestSide;
	const logoCenterX =
		currentSide === "left"
			? input.position.x + logoInset
			: input.position.x + input.size.width - logoInset;
	const leftCandidate = logoCenterX - logoInset;
	const rightCandidate = logoCenterX + logoInset - input.targetWidth;
	const minX = left + gutter;
	const maxX = right - gutter - input.targetWidth;
	const leftFits = leftCandidate >= minX && leftCandidate <= maxX;
	const rightFits = rightCandidate >= minX && rightCandidate <= maxX;

	let dockSide = nearestSide;
	if (!docked) {
		if (leftFits && rightFits) {
			dockSide =
				Math.abs(leftCandidate - input.position.x) <=
				Math.abs(rightCandidate - input.position.x)
					? "left"
					: "right";
		} else if (leftFits) {
			dockSide = "left";
		} else if (rightFits) {
			dockSide = "right";
		} else {
			const roomRight = right - gutter - logoCenterX;
			const roomLeft = logoCenterX - (left + gutter);
			dockSide = roomRight >= roomLeft ? "left" : "right";
		}
	}

	const expandDirection = resolveExpandDirection({
		y: input.position.y,
		height: input.size.height,
		targetHeight: input.targetHeight,
		workArea: input.workArea,
		scaleFactor: scale,
		previousDirection: input.expandDirection,
	});
	const logoCenterY =
		input.expandDirection === "up"
			? input.position.y + input.size.height - logoInset
			: input.position.y + logoInset;
	const targetY =
		expandDirection === "up"
			? logoCenterY + logoInset - input.targetHeight
			: logoCenterY - logoInset;
	const targetX = docked
		? dockSide === "left"
			? left
			: right - input.targetWidth
		: dockSide === "left"
			? leftCandidate
			: rightCandidate;

	return {
		docked,
		dockSide,
		expandDirection,
		x: docked ? targetX : clamp(targetX, minX, maxX),
		y: clamp(targetY, top + gutter, bottom - gutter - input.targetHeight),
	};
}
