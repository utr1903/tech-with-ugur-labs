import { expect, test } from "@playwright/test";

test("minimal robot remains usable on mobile with reduced motion", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Your documents. A voice." }),
	).toBeVisible();
	const orb = page.locator(".voice-orb");
	await expect(orb).toHaveAttribute("aria-hidden", "true");
	expect(
		await orb.evaluate((element) => getComputedStyle(element).animationName),
	).toBe("none");
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(390);
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	await expect(page.getByLabel("Simulated question")).toBeVisible();
	await page.getByRole("button", { name: "Stop", exact: true }).click();
});
test("incoming remote samples change orb scale and contour, Stop resets both", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const shared = window as unknown as { remoteAmplitude: number };
		shared.remoteAmplitude = 0;
		class SilentContext {
			resume() {
				return Promise.resolve();
			}
			close() {
				return Promise.resolve();
			}
			createMediaStreamSource() {
				return { connect() {}, disconnect() {} };
			}
			createAnalyser() {
				return {
					fftSize: 256,
					disconnect() {},
					getFloatTimeDomainData(data: Float32Array) {
						data.fill(shared.remoteAmplitude);
					},
				};
			}
		}
		Object.defineProperty(window, "AudioContext", { value: SilentContext });
		class Peer {
			ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
			addTrack() {}
			close() {}
			createDataChannel() {
				return Object.assign(new EventTarget(), {
					readyState: "open",
					send() {},
					close() {},
				});
			}
			async createOffer() {
				return { sdp: "test-offer" };
			}
			async setLocalDescription() {}
			async setRemoteDescription() {
				this.ontrack?.({ streams: [new MediaStream()] });
			}
		}
		Object.defineProperty(window, "RTCPeerConnection", { value: Peer });
		HTMLMediaElement.prototype.play = async () => {};
	});
	await page.route("**/api/realtime/token", (route) =>
		route.fulfill({
			json: {
				mode: "live",
				conversationId: "orb-browser",
				clientSecret: "TEST_EPHEMERAL_PLACEHOLDER",
			},
		}),
	);
	await page.route("https://api.openai.com/v1/realtime/calls", (route) =>
		route.fulfill({ body: "test-answer" }),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	const orb = page.locator(".voice-orb");
	const idle = await orb.getAttribute("style");
	await page.evaluate(() => {
		(window as unknown as { remoteAmplitude: number }).remoteAmplitude = 0.15;
	});
	await expect(orb).toHaveAttribute("data-speaking", "true");
	expect(await orb.getAttribute("style")).not.toBe(idle);
	await expect(page.getByText("Agent speaking", { exact: true })).toBeVisible();
	expect(
		await orb.evaluate((node) =>
			Number((node as HTMLElement).style.getPropertyValue("--voice-scale")),
		),
	).toBeGreaterThan(1.05);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(orb).toHaveAttribute("data-speaking", "false");
	expect(
		await orb.evaluate((node) =>
			Number((node as HTMLElement).style.getPropertyValue("--voice-scale")),
		),
	).toBe(1);
});
test("token failure releases the context prepared by Start", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const shared = window as unknown as { closedAudioContexts: number };
		shared.closedAudioContexts = 0;
		class Context {
			resume() {
				return Promise.resolve();
			}
			close() {
				shared.closedAudioContexts++;
				return Promise.resolve();
			}
		}
		Object.defineProperty(window, "AudioContext", { value: Context });
	});
	await page.route("**/api/realtime/token", (route) =>
		route.fulfill({ status: 503, json: { error: "unavailable" } }),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Error");
	expect(
		await page.evaluate(
			() =>
				(window as unknown as { closedAudioContexts: number })
					.closedAudioContexts,
		),
	).toBe(1);
});
test("orb decoration fits a narrow tablet viewport", async ({
	page,
}) => {
	await page.setViewportSize({ width: 653, height: 844 });
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Your documents. A voice." }),
	).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(653);
});
