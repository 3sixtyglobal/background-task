// Copyright 2024 IOTA Stiftung.
// Copyright 2026 3Sixty Trade Ltd.
// SPDX-License-Identifier: Apache-2.0.
import type {
	IScheduledTaskInfo,
	IScheduledTaskTime,
	ITaskSchedulerComponent
} from "@3sixty/background-task-models";
import {
	BaseError,
	ComponentFactory,
	Duration,
	DurationConstants,
	DurationUnit,
	Is
} from "@3sixty/core";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageConnector
} from "@3sixty/entity-storage-models";
import type { ILoggingComponent } from "@3sixty/logging-models";
import { nameof } from "@3sixty/nameof";
import type { ScheduledTask } from "./entities/scheduledTask.js";
import type { ITaskSchedulerConstructorOptions } from "./models/ITaskSchedulerConstructorOptions.js";

/**
 * Class for scheduling tasks.
 */
export class TaskSchedulerService implements ITaskSchedulerComponent {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<TaskSchedulerService>();

	/**
	 * The logger for the task service.
	 * @internal
	 */
	private readonly _logging?: ILoggingComponent;

	/**
	 * The entity storage for the scheduled tasks.
	 * @internal
	 */
	private readonly _scheduledTaskEntityStorageConnector: IEntityStorageConnector<ScheduledTask>;

	/**
	 * The interval in milliseconds at which the tasks are checked.
	 * @internal
	 */
	private readonly _tickIntervalMs: number;

	/**
	 * The timeout in milliseconds after which an in-progress task is considered stalled.
	 * @internal
	 */
	private readonly _stalledTaskTimeoutMs: number;

	/**
	 * The tasks that are scheduled.
	 * @internal
	 */
	private readonly _tasks: {
		[id: string]: {
			times: IScheduledTaskTime[];
			taskCallback: () => Promise<void>;
		};
	};

	/**
	 * The tasks currently running in this scheduler instance.
	 * @internal
	 */
	private _runningTasks: string[];

	/**
	 * The timer for running scheduled tasks.
	 * @internal
	 */
	private _timer?: ReturnType<typeof setInterval>;

	/**
	 * Whether the scheduler has been started.
	 * @internal
	 */
	private _started: boolean;

	/**
	 * Create a new instance of TaskSchedulerComponent.
	 * @param options The options for the scheduler.
	 */
	constructor(options?: ITaskSchedulerConstructorOptions) {
		this._scheduledTaskEntityStorageConnector = EntityStorageConnectorFactory.get(
			options?.scheduledTaskEntityStorageType ?? "scheduled-task"
		);
		this._logging = ComponentFactory.getIfExists(options?.loggingComponentType);
		this._tasks = {};
		this._runningTasks = [];
		this._started = false;
		this._tickIntervalMs = options?.config?.intervalMs ?? DurationConstants.MsPerMinute;
		this._stalledTaskTimeoutMs =
			options?.config?.stalledTaskTimeoutMs ?? 5 * DurationConstants.MsPerMinute;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return TaskSchedulerService.CLASS_NAME;
	}

	/**
	 * The component needs to be started when the node is initialized.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns A promise that resolves when the service has started and pending tasks are being processed
	 */
	public async start(nodeLoggingComponentType?: string): Promise<void> {
		if (!this._started) {
			this._started = true;
			if (Object.keys(this._tasks).length > 0) {
				await this.startTimer();
			}
		}
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns A promise that resolves when the scheduler has stopped and in-flight tasks have been reset
	 */
	public async stop(nodeLoggingComponentType?: string): Promise<void> {
		if (this._started) {
			this._started = false;
			this.stopTimer();

			// If we had any running tasks, we reset their last run time to allow them to be
			// triggered by other components
			for (const taskId of this._runningTasks) {
				await this._scheduledTaskEntityStorageConnector.set({
					id: taskId,
					lastRunTime: undefined
				});
			}
			this._runningTasks = [];
		}
	}

	/**
	 * Add a task to the scheduler.
	 * @param taskId The id of the task to add.
	 * @param times The times at which the task should be scheduled.
	 * @param taskCallback The callback to execute when the task is scheduled.
	 * @returns A promise that resolves when the task has been registered and the scheduler timer started
	 */
	public async addTask(
		taskId: string,
		times: IScheduledTaskTime[],
		taskCallback: () => Promise<void>
	): Promise<void> {
		this._tasks[taskId] = {
			times: times.map(time => ({
				...time,
				nextTriggerTime: Is.empty(time.nextTriggerTime)
					? this.calculateNextTriggerTime(time, Date.now())
					: time.nextTriggerTime
			})),
			taskCallback
		};

		await this._logging?.log({
			level: "info",
			source: TaskSchedulerService.CLASS_NAME,
			ts: Date.now(),
			message: "taskAdded",
			data: {
				id: taskId
			}
		});

		await this.startTimer();
	}

	/**
	 * Remove a task from the scheduler.
	 * @param taskId The id of the task to remove.
	 * @returns A promise that resolves when the task has been removed
	 */
	public async removeTask(taskId: string): Promise<void> {
		if (!Is.empty(this._tasks[taskId])) {
			await this._logging?.log({
				level: "info",
				source: TaskSchedulerService.CLASS_NAME,
				ts: Date.now(),
				message: "taskRemoved",
				data: {
					id: taskId
				}
			});

			delete this._tasks[taskId];

			if (Object.keys(this._tasks).length === 0) {
				this.stopTimer();
			}
		}
	}

	/**
	 * Get the information about the tasks.
	 * @returns The tasks information.
	 */
	public async tasksInfo(): Promise<IScheduledTaskInfo> {
		const tasksInfo: IScheduledTaskInfo = {
			tasks: {}
		};
		for (const taskId in this._tasks) {
			tasksInfo.tasks[taskId] = this._tasks[taskId].times;
		}
		return tasksInfo;
	}

	/**
	 * Calculate the next run time for a task based on its scheduled times.
	 * @param time The times at which the task should be scheduled.
	 * @param now The time to schedule from, the start of the check for a task that has just run, so
	 * the time the run took does not push the next run past the following check.
	 * @returns The update time with the next run.
	 * @internal
	 */
	private calculateNextTriggerTime(time: IScheduledTaskTime, now: number): number {
		let nextTriggerTime = time.nextTriggerTime;

		if (Is.empty(nextTriggerTime)) {
			nextTriggerTime = now;
		}

		const intervalMs = Duration.toNumber(
			{
				years: 0,
				months: 0,
				weeks: 0,
				days: time.intervalDays ?? 0,
				hours: time.intervalHours ?? 0,
				minutes: time.intervalMinutes ?? 0,
				seconds: time.intervalSeconds ?? 0
			},
			DurationUnit.Milliseconds
		);

		if (intervalMs > 0) {
			// Move to the next regular slot and, if that slot is already in the past,
			// skip missed slots so the next trigger is strictly in the future.
			nextTriggerTime += intervalMs;
			if (nextTriggerTime <= now) {
				const intervalsToAdvance = Math.floor((now - nextTriggerTime) / intervalMs) + 1;
				nextTriggerTime += intervalsToAdvance * intervalMs;
			}
		}

		return nextTriggerTime;
	}

	/**
	 * Start the timer for running scheduled tasks.
	 * @returns A promise that resolves when the timer has been started and any immediately due tasks triggered
	 * @internal
	 */
	private async startTimer(): Promise<void> {
		if (Is.empty(this._timer) && this._started) {
			// Trigger immediately to catch up on any missed tasks
			await this.triggerScheduledTasks();
			// Re-check after the await: stop() may have been called while triggerScheduledTasks() was running.
			// At that point _timer was still undefined so stopTimer() was a no-op - without this guard,
			// setInterval would create a timer that is never cleaned up.
			if (this._started) {
				this._timer = globalThis.setInterval(async () => {
					if (this._started) {
						await this.triggerScheduledTasks();
					}
				}, this._tickIntervalMs);
			}
		}
	}

	/**
	 * Stop the timer for running scheduled tasks.
	 * @internal
	 */
	private stopTimer(): void {
		if (!Is.empty(this._timer)) {
			globalThis.clearInterval(this._timer);
			this._timer = undefined;
		}
	}

	/**
	 * Trigger scheduled tasks based on their next run times.
	 * @returns A promise that resolves when all due tasks have been triggered and their next trigger times updated
	 * @internal
	 */
	private async triggerScheduledTasks(): Promise<void> {
		const now = Date.now();

		for (const taskId in this._tasks) {
			const task = this._tasks[taskId];

			for (const taskTime of task.times) {
				if (!Is.empty(taskTime.nextTriggerTime) && taskTime.nextTriggerTime <= now) {
					let taskStarted = false;
					let taskStartTime = 0;

					try {
						const scheduledTask = await this._scheduledTaskEntityStorageConnector.get(taskId);
						const lastRunTime = scheduledTask?.lastRunTime;
						const taskInProgress = !Is.empty(lastRunTime);
						const taskStalled = taskInProgress && now - lastRunTime >= this._stalledTaskTimeoutMs;

						if (taskStalled) {
							await this._logging?.log({
								level: "warn",
								source: TaskSchedulerService.CLASS_NAME,
								ts: Date.now(),
								message: "taskStalled",
								data: {
									id: taskId,
									lastRunTime,
									stalledForMs: now - (lastRunTime ?? now),
									stalledTaskTimeoutMs: this._stalledTaskTimeoutMs
								}
							});
						}

						if (!taskInProgress || taskStalled) {
							await this._logging?.log({
								level: "info",
								source: TaskSchedulerService.CLASS_NAME,
								ts: Date.now(),
								message: "taskTriggered",
								data: {
									id: taskId,
									time: new Date(taskTime.nextTriggerTime).toISOString()
								}
							});

							// Update the last run time of the task to prevent multiple triggers in case of long running tasks
							await this._scheduledTaskEntityStorageConnector.set({
								id: taskId,
								lastRunTime: Date.now()
							});

							if (!this._runningTasks.includes(taskId)) {
								this._runningTasks.push(taskId);
							}

							taskStarted = true;
							taskStartTime = Date.now();
							await task.taskCallback();
						}
					} catch (error) {
						await this._logging?.log({
							level: "error",
							source: TaskSchedulerService.CLASS_NAME,
							ts: Date.now(),
							message: "taskFailed",
							data: {
								id: taskId,
								duration: taskStarted ? Date.now() - taskStartTime : 0
							},
							error: BaseError.fromError(error)
						});
					} finally {
						if (taskStarted) {
							await this._logging?.log({
								level: "info",
								source: TaskSchedulerService.CLASS_NAME,
								ts: Date.now(),
								message: "taskCompleted",
								data: {
									id: taskId,
									duration: Date.now() - taskStartTime
								}
							});

							// Reset the last run time to allow future triggers, even if the task callback fails
							await this._scheduledTaskEntityStorageConnector.set({
								id: taskId,
								lastRunTime: undefined
							});

							// Remove the task from the running tasks list
							const index = this._runningTasks.indexOf(taskId);
							if (index >= 0) {
								this._runningTasks.splice(index, 1);
							}
						}
					}

					// If the intervals are empty, we do not recalculate a next run time
					if (
						Is.empty(taskTime.intervalDays) &&
						Is.empty(taskTime.intervalHours) &&
						Is.empty(taskTime.intervalMinutes) &&
						Is.empty(taskTime.intervalSeconds)
					) {
						taskTime.nextTriggerTime = undefined;
					} else {
						// Recalculate the next run time based on the start of this check and the intervals
						taskTime.nextTriggerTime = this.calculateNextTriggerTime(taskTime, now);
					}
				}
			}
		}
	}
}
