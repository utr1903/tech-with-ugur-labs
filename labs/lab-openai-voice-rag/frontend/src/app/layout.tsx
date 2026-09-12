import type { ReactNode } from "react";
export const metadata = {
	title: "Markdown voice knowledge assistant",
	description:
		"Local Markdown retrieval with a simulated or live voice transport.",
};
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body
				style={{
					fontFamily: "system-ui",
					maxWidth: 800,
					margin: "2rem auto",
					padding: "0 1rem",
					lineHeight: 1.6,
				}}
			>
				{children}
			</body>
		</html>
	);
}
