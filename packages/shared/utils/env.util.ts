export const tryGetEnv = (key: string, _default?: string): string => {
  const value = process.env[key];

  if (typeof value === "string") {
    return value.trim();
  }

  if (_default !== undefined) {
    return _default;
  }

  throw new Error(`[tryGetEnv] Environment variable ${key} is required`);
};
