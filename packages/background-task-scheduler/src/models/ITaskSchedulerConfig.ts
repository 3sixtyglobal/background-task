// Copyright 2024 IOTA Stiftung.
// Copyright 2026 3Sixty Trade Ltd.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Interface for the task scheduler configuration.
 */
export interface ITaskSchedulerConfig {
	/**
	 * The interval in milliseconds between checks for tasks that are due. A task runs at the first check
	 * after its time, so set this no longer than the shortest task interval, such as 1000 for tasks
	 * that repeat every few seconds.
	 * @default 60000
	 */
	intervalMs?: number;

	/**
	 * The time in milliseconds after which a task that is still marked as running is considered stalled and can be run again.
	 * @default 300000
	 */
	stalledTaskTimeoutMs?: number;
}
