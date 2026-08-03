import { defineConfig } from "@rsbuild/core";
import { pluginNodePolyfill } from "@rsbuild/plugin-node-polyfill";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

const isProduction = process.env.NODE_ENV === "production";

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
			// Tauri 开发窗口长期驻留且会跨路由接收 HMR。开发模式若保留共享/异步
			// chunk，更新前后的 runtime 可能引用不同模块表，表现为 factory is undefined。
			// 生产构建不使用 HMR，继续按模块拆分以保留缓存收益。
			strategy: isProduction ? "split-by-module" : "all-in-one",
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
			// all-in-one 默认不会合并 dynamic import；开发时一并关闭异步 chunk，
			// 确保 TanStack 懒加载路由与主 runtime 始终来自同一次 HMR 编译。
			output: isProduction ? undefined : { asyncChunks: false },
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
