import assert from "node:assert/strict";
export function verifyCanaries(
	expected: Record<string, string>,
	before: Record<string, string>,
	after: Record<string, string>,
	output: string,
) {
	assert.deepEqual(Object.keys(expected).sort(), [
		"app",
		"database",
		"host",
		"secret",
	]);
	assert(output.includes("EXECUTED"));
	return Object.entries(expected).map(([boundary, value]) => {
		assert(value.startsWith("FAKE-"));
		assert.equal(before[boundary], value, `${boundary}: positive read missing`);
		assert.equal(after[boundary], value, `${boundary}: fake data changed`);
		assert(!output.includes(value), `${boundary}: fake value leaked`);
		assert(
			!output.includes(Buffer.from(value).toString("base64")),
			`${boundary}: encoded fake value leaked`,
		);
		return {
			boundary,
			before: before[boundary],
			after: after[boundary],
			unchanged: true,
			absentFromOutput: true,
		};
	});
}
