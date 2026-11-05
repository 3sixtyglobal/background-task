// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Task statuses.
 */
export const TaskStatus = {
	/**
	 * Pending.
	 */
	Pending: "pending",

	/**
	 * Processing.
	 */
	Processing: "processing",

	/**
	 * Success.
	 */
	Success: "success",

	/**
	 * Failed.
	 */
	Failed: "failed",

	/**
	 * Cancelled.
	 */
	Cancelled: "cancelled"
} as const;

/**
 * Task statuses.
 */
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
