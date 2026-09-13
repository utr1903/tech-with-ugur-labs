import type { ReactNode } from "react";
import "./globals.css";
export const metadata = {
	title: "Python chat",
	description: "A local Python chat workspace.",
};
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
