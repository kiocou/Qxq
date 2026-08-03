import { useLocation } from "@tanstack/react-router";
import { useMemo } from "react";

export const hasAppLayout = (pathname: string) =>
	!(
		pathname === "/draw" ||
		pathname === "/fixedContent" ||
		pathname === "/fullScreenDraw" ||
		pathname === "/fullScreenDrawSwitchMouseThrough" ||
		pathname === "/videoRecord" ||
		pathname === "/videoRecordToolbar" ||
		pathname === "/idle" ||
		pathname === "/floatingToolbar"
	);

export const usePathname = () => {
	const { pathname } = useLocation();
	const hasLayout = useMemo(() => hasAppLayout(pathname), [pathname]);

	return { pathname, hasLayout };
};
