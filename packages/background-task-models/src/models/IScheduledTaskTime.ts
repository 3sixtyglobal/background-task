// Copyright 2024 IOTA Stiftung.
// Copyright 2026 3Sixty Trade Ltd.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Interface describing a scheduled task time.
 */
export interface IScheduledTaskTime {
	/**
	 * The date/time to start the task, if not provided defaults to first interval from now.
	 */
	nextTriggerTime?: number;

	/**
	 * The interval in days to repeat the task, if no intervals are set the task will not repeat.
	 */
	intervalDays?: number;

	/**
	 * The interval in hours to repeat the task, if no intervals are set the task will not repeat.
	 */
	intervalHours?: number;

	/**
	 * The interval in minutes to repeat the task, if no intervals are set the task will not repeat.
	 */
	intervalMinutes?: number;

	/**
	 * The interval in seconds to repeat the task, if no intervals are set the task will not repeat.
	 */
	intervalSeconds?: number;
}
