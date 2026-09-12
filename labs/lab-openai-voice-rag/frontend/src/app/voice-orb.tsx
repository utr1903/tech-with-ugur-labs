import type { CSSProperties } from "react";
export function VoiceOrb({ level }: { level: number }) {
	const radius = 48 - level * 13;
	return (
		<div className="orb-stage" aria-hidden="true">
			<div className="orbit orbit-one" />
			<div className="orbit orbit-two" />
			<div
				className="voice-orb"
				aria-hidden="true"
				data-speaking={level > 0.08}
				style={
					{
						"--voice-scale": 1 + level * 0.22,
						"--voice-contour": `${radius}% ${100 - radius}% ${radius + level * 5}% ${100 - radius}% / ${100 - radius}% ${radius}% ${100 - radius}% ${radius}%`,
					} as CSSProperties
				}
			>
				<div className="robot-face">
					<i />
					<i />
				</div>
				<span className="orb-glint" />
			</div>
			<div className="orb-shadow" />
		</div>
	);
}
