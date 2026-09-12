import type { NextConfig } from "next";

const config: NextConfig = {
	async rewrites() {
		return [
			{
				source: "/api/:path*",
				destination: `${process.env.BACKEND_URL ?? "http://backend:3001"}/api/:path*`,
			},
		];
	},
};
export default config;
