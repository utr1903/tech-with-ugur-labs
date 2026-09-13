export async function withRuntimeRestoration(
	drill: () => Promise<void>,
	remove: () => void,
	restore: () => void,
	restart: () => void,
) {
	const errors: unknown[] = [];
	try {
		await drill();
	} catch (error) {
		errors.push(error);
	}
	for (const action of [remove, restore, restart]) {
		try {
			action();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length)
		throw new AggregateError(errors, "Runtime drill or restoration failed.");
}
