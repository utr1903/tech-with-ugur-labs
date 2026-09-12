import "./styles.css";
import type { ReactNode } from "react";
export const metadata = {
	title: "Markdown voice knowledge assistant",
	description:
		"Local Markdown retrieval with a simulated or live voice transport.",
};
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
