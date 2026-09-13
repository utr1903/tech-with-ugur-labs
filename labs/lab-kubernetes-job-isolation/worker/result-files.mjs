import { constants, openSync, closeSync, fstatSync, lstatSync } from "node:fs";

// Create a fresh single execution result without following pre-existing paths.
export function create(path) {
  const handle = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW |
      constants.O_WRONLY,
    0o600,
  );
  if (!fstatSync(handle).isFile()) {
    closeSync(handle);
    throw new Error("Result is not a regular file");
  }
  return handle;
}

// Compare the current named inode with the held descriptor before publishing it.
export function verifyPath(path, handle, maximum) {
  const held = fstatSync(handle);
  const named = lstatSync(path);
  if (
    !held.isFile() ||
    !named.isFile() ||
    held.dev !== named.dev ||
    held.ino !== named.ino ||
    held.nlink !== 1 ||
    held.size > maximum
  ) {
    throw new Error("Result path was changed");
  }
}
