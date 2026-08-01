import { defineConfig } from "@rsbuild/core";
import { pluginNodePolyfill } from "@rsbuild/plugin-node-polyfill";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

export default defineConfig({
	plugins: [pluginReact(), pluginNodePolyfill()],
	resolve: {
		alias: {
			"@": "./src",
		},
	},
	output: {
		cleanDistPath: true,
	},
	performance: {
		chunkSplit: {
			// split-by-module 在 dev 下会给懒加载路由产生未注册 factory 的 chunk，
			// 表现为 "factory is undefined"，直接让 /draw 等页面加载失败。
			// 仅生产构建启用该策略。
			strategy:
				process.env.NODE_ENV === "production"
					? "split-by-module"
					: "split-by-experience",
		},
	},
	html: {
		tags: [
			{
				tag: "script",
				attrs: {
					src:
						import.meta.env.PUBLIC_ONLINE_STATUS === "true"
							? "/scripts/excalidraw.js"
							: "/scripts/excalidraw.offline.js",
				},
			},
			{
				tag: "script",
				attrs: {
					src: "/scripts/markdownItFix.js",
				},
			},
		],
	},
	tools: {
		swc: {
			jsc: {
				experimental: {
					plugins: [["@swc/plugin-styled-jsx", {}]],
				},
			},
		},
		rspack: {
			plugins: [
				tanstackRouter({
					target: "react",
					autoCodeSplitting: true,
				}),
			],
			optimization: {},
		},
	},
});
