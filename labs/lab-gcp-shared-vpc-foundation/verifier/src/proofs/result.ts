export type ProofResult = {
	proof: string;
	expectation: string;
	passed: boolean;
	detail: string;
};

export function summarize(results: ProofResult[]): {
	passedCount: number;
	failedCount: number;
	exitCode: number;
} {
	const passedCount = results.filter((r) => r.passed).length;
	const failedCount = results.length - passedCount;
	const exitCode = results.length > 0 && failedCount === 0 ? 0 : 1;
	return { passedCount, failedCount, exitCode };
}
