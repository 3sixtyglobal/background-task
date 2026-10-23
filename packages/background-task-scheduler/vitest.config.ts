// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { NameOfPlugin } from "@3sixty/nameof-vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [NameOfPlugin],
	test: {
		include: ["./tests/**/*.spec.ts"],
		globals: true,
		cache: false,
		testTimeout: 300000,
		hookTimeout: 300000,
		bail: 1,
		reporters: ["verbose"],
		disableConsoleIntercept: true,
		coverage: {
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts"],
			exclude: ["**/index.ts", "**/models/**/*.ts"]
		},
		fileParallelism: true,
		maxWorkers: 4,
		fsModuleCache: true,
		fsModuleCachePath: "node_modules/.vitest-cache"
	}
});
