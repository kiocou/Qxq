import { createLazyFileRoute } from "@tanstack/react-router";
import { FloatingToolbarPage } from "@/pages/floatingToolbar/page";

export const Route = createLazyFileRoute("/_noLayout/floatingToolbar")({
	component: RouteComponent,
});

function RouteComponent() {
	return <FloatingToolbarPage />;
}
