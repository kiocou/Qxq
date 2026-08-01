import { CopyOutlined } from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Card, Space, Typography } from "antd";
import type React from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { copyText } from "@/utils/clipboard";

const CodeCard: React.FC<{
	props: React.ClassAttributes<HTMLElement> &
		React.HTMLAttributes<HTMLElement> &
		ExtraProps;
	language: string;
	darkMode: boolean;
}> = ({ props, language, darkMode }) => {
	const { children, ...rest } = props;
	return (
		<Card
			title={language}
			size="small"
			styles={{ body: { padding: 0, margin: "-0.5em 0" } }}
			extra={
				<Space>
					<Button
						type="text"
						icon={<CopyOutlined />}
						onClick={() => {
							copyText(String(children).replace(/\n$/, ""));
						}}
					/>
				</Space>
			}
		>
			<SyntaxHighlighter
				{...rest}
				ref={undefined}
				language={language}
				style={darkMode ? oneDark : oneLight}
				wrapLongLines
			>
				{String(children).replace(/\n$/, "")}
			</SyntaxHighlighter>
		</Card>
	);
};

export const MarkdownContent: React.FC<{
	content: string;
	clipboardContent: string;
	darkMode: boolean;
	disableCodeCard?: boolean;
}> = ({ content, darkMode, disableCodeCard }) => {
	return (
		<Typography>
			<div className="markdown-body">
				<Markdown
					components={{
						code(props) {
							const { children, className, ...rest } = props;
							const match = /language-(\w+)/.exec(className || "");
							return match && !disableCodeCard ? (
								<CodeCard
									language={match[1]}
									darkMode={darkMode}
									props={props}
								/>
							) : (
								<code {...rest} className={className}>
									{children}
								</code>
							);
						},
						a: (props) => {
							return (
								<a
									{...props}
									onClick={(e) => {
										e.preventDefault();
										if (props.href) {
											openUrl(props.href);
										}
									}}
								/>
							);
						},
					}}
					remarkPlugins={[remarkMath, remarkGfm]}
					rehypePlugins={[rehypeKatex]}
				>
					{content}
				</Markdown>
			</div>

			<style jsx>{`
                :global(.ant-typography pre) {
                    background-color: transparent;
                    padding: 0;
                }

                :global(.ant-typography pre > div) {
                    margin: 0 !important;
                }

                :global(.markdown-body) {
                    background: transparent !important;
                }
            `}</style>
		</Typography>
	);
};
