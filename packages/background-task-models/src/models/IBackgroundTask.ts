// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IError } from "@3sixty/core";
import type { TaskStatus } from "./taskStatus.js";

/**
 * Interface describing a background task.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IBackgroundTask<T = any, U = any> {
	/**
	 * The id in URN form e.g. `background-task:&lt;namespace&gt;:&lt;entity-id&gt;`.
	 */
	id: string;

	/**
	 * The type of the task.
	 */
	type: string;

	/**
	 * The thread id for the task.
	 */
	threadId: string;

	/**
	 * The retry interval in milliseconds, undefined if default scheduling.
	 */
	retryInterval?: number;

	/**
	 * The number of retries remaining, undefined if infinite retries.
	 */
	retriesRemaining?: number;

	/**
	 * The date the task was created.
	 */
	dateCreated: string;

	/**
	 * The date the task was last modified.
	 */
	dateModified: string;

	/**
	 * The date the task was complete.
	 */
	dateCompleted?: string;

	/**
	 * The date the task was cancelled.
	 */
	dateCancelled?: string;

	/**
	 * The date until when to retain.
	 */
	dateRetainUntil?: string;

	/**
	 * The status of the task.
	 */
	status: TaskStatus;

	/**
	 * The payload to execute the task with.
	 */
	payload?: T;

	/**
	 * The result of the execution.
	 */
	result?: U;

	/**
	 * The error at last execution.
	 */
	error?: IError;
}
