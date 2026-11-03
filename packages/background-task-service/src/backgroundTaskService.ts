// Copyright 2024 IOTA Stiftung.
// Copyright 2026 3Sixty Trade Ltd.
// SPDX-License-Identifier: Apache-2.0.
import os from "node:os";
import { isMainThread, threadId as workerThreadId } from "node:worker_threads";
import {
	HealthCategory,
	HealthStatus,
	type HealthApplicationCallback,
	type IHealth,
	type IHealthProviderComponent
} from "@3sixty/api-models";
import {
	type IBackgroundTask,
	type IBackgroundTaskComponent,
	TaskStatus
} from "@3sixty/background-task-models";
import { ContextIdStore } from "@3sixty/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	DurationConstants,
	Factory,
	GeneralError,
	Guards,
	Is,
	type IValidationFailure,
	ObjectHelper,
	RandomHelper,
	StringHelper,
	Urn,
	Validation
} from "@3sixty/core";
import {
	ComparisonOperator,
	type EntityCondition,
	LogicalOperator,
	SortDirection
} from "@3sixty/entity";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageConnector
} from "@3sixty/entity-storage-models";
import type { ILoggingComponent } from "@3sixty/logging-models";
import { ModuleHelper } from "@3sixty/modules";
import { nameof, nameofCamelCase } from "@3sixty/nameof";
import type { BackgroundTask } from "./entities/backgroundTask.js";
import type { IBackgroundTaskHandler } from "./models/IBackgroundTaskHandler.js";
import type { IBackgroundTaskServiceConstructorOptions } from "./models/IBackgroundTaskServiceConstructorOptions.js";
import type { IBackgroundTaskWorker } from "./models/IBackgroundTaskWorker.js";

/**
 * Class for performing background task operations.
 */
export class BackgroundTaskService implements IBackgroundTaskComponent, IHealthProviderComponent {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<BackgroundTaskService>();

	/**
	 * The namespace supported by the background task.
	 */
	public static readonly NAMESPACE: string = "entity-storage";

	/**
	 * The default task interval in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_TASK_INTERVAL: number = 100;

	/**
	 * The default retry interval in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_RETRY_INTERVAL: number = 5 * DurationConstants.MsPerSecond;

	/**
	 * The default cleanup interval in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_CLEANUP_INTERVAL: number = 2 * DurationConstants.MsPerMinute;

	/**
	 * Default maximum number of dispatches for a single attempt.
	 * @internal
	 */
	private static readonly _DEFAULT_MAX_DISPATCH_COUNT: number = 3;

	/**
	 * The default worker shutdown timeout in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_WORKER_SHUTDOWN_TIMEOUT: number =
		5 * DurationConstants.MsPerSecond;

	/**
	 * Minimum time in milliseconds between maxSystemWorkerCountReached warnings for one type.
	 * @internal
	 */
	private static readonly _CAP_REACHED_LOG_INTERVAL: number = DurationConstants.MsPerMinute;

	/**
	 * Cap on the retry wait for a type blocked by the system worker cap.
	 * @internal
	 */
	private static readonly _MAX_CAP_REACHED_WAIT: number = 5 * DurationConstants.MsPerSecond;

	/**
	 * The timeout in milliseconds for a health-check task to complete.
	 * @internal
	 */
	private static readonly _HEALTH_CHECK_TASK_TIMEOUT: number = 30 * DurationConstants.MsPerSecond;

	/**
	 * Reserved task type key used by the built-in health-check handler.
	 * @internal
	 */
	private static readonly _HEALTH_CHECK_TASK_TYPE: string = "health-check";

	/**
	 * The handlers for tasks.
	 * @internal
	 */
	private readonly _taskHandlers: {
		[taskType: string]: IBackgroundTaskHandler;
	};

	/**
	 * The entity storage for the background tasks keys.
	 * @internal
	 */
	private readonly _backgroundTaskEntityStorageConnector: IEntityStorageConnector<BackgroundTask>;

	/**
	 * The logger component for the background task.
	 * @internal
	 */
	private readonly _logging?: ILoggingComponent;

	/**
	 * The workers for the background tasks.
	 * @internal
	 */
	private readonly _workers: {
		[workerId: string]: {
			taskType: string;
			worker: IBackgroundTaskWorker;
		};
	};

	/**
	 * The ids of tasks this process is currently claiming or processing.
	 * @internal
	 */
	private readonly _inFlightTaskIds: Map<string, Set<string>>;

	/**
	 * The dispatch count and last dispatch time for each task, keyed by task id.
	 * @internal
	 */
	private readonly _dispatchCounts: Map<string, { count: number; ts: number }>;

	/**
	 * The maximum number of concurrent tasks allowed.
	 * @internal
	 */
	private readonly _maxSystemWorkerCount: number;

	/**
	 * Determine if the component has been started.
	 * @internal
	 */
	private _started: boolean;

	/**
	 * The last time the retained tasks were cleaned up
	 * @internal
	 */
	private _lastCleanup: number;

	/**
	 * The default interval to leave between tasks in milliseconds, defaults to 100ms.
	 * @internal
	 */
	private readonly _taskInterval: number;

	/**
	 * The default retry interval to leave between tasks in milliseconds, defaults to 5000ms.
	 * @internal
	 */
	private readonly _retryInterval: number;

	/**
	 * The default cleanup interval for removing retained tasks in milliseconds, defaults to 120000ms.
	 * @internal
	 */
	private readonly _cleanupInterval: number;

	/**
	 * The maximum dispatches of an attempt before it is failed as interrupted, -1 for no limit.
	 * @internal
	 */
	private readonly _maxDispatchCount: number;

	/**
	 * How long in milliseconds stop() waits for workers to finish their shutdownMethod before force-terminating them.
	 * @internal
	 */
	private readonly _workerShutdownTimeout: number;

	/**
	 * The url of the handler to use for health checks. If not provided, the default health check handler will be used.
	 * @internal
	 */
	private readonly _overrideHealthCheckHandler: string;

	/**
	 * Create a new instance of BackgroundTaskService.
	 * @param options The options for the service.
	 */
	constructor(options?: IBackgroundTaskServiceConstructorOptions) {
		this._backgroundTaskEntityStorageConnector = EntityStorageConnectorFactory.get(
			options?.backgroundTaskEntityStorageType ?? "background-task"
		);
		this._logging = ComponentFactory.getIfExists(options?.loggingComponentType);

		const cpuCount = os.cpus().length;
		// Determine the maximum system worker count, either custom or based on CPU cores
		let maxSystemWorkerCount = Coerce.integer(options?.config?.maxSystemWorkerCount) ?? cpuCount;
		if (maxSystemWorkerCount <= 0) {
			// A negative worker count implies unlimited workers, so we set it to the number of CPU cores
			maxSystemWorkerCount = cpuCount;
		}

		this._maxSystemWorkerCount = maxSystemWorkerCount;
		this._taskHandlers = {};
		this._workers = {};
		this._inFlightTaskIds = new Map<string, Set<string>>();
		this._dispatchCounts = new Map<string, { count: number; ts: number }>();
		this._started = false;
		this._lastCleanup = 0;
		const validationErrors: IValidationFailure[] = [];
		if (!Is.undefined(options?.config?.taskInterval)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.config.taskInterval),
				options.config.taskInterval
			);
			Validation.integer(
				nameof(options.config.taskInterval),
				options.config.taskInterval,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.config?.retryInterval)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.config.retryInterval),
				options.config.retryInterval
			);
			Validation.integer(
				nameof(options.config.retryInterval),
				options.config.retryInterval,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.config?.cleanupInterval)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.config.cleanupInterval),
				options.config.cleanupInterval
			);
			Validation.integer(
				nameof(options.config.cleanupInterval),
				options.config.cleanupInterval,
				validationErrors,
				undefined,
				{ minValue: 5 * DurationConstants.MsPerSecond }
			);
		}
		if (!Is.undefined(options?.config?.maxDispatchCount)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.config.maxDispatchCount),
				options.config.maxDispatchCount
			);
			Validation.integer(
				nameof(options.config.maxDispatchCount),
				options.config.maxDispatchCount,
				validationErrors,
				undefined,
				{ minValue: -1 }
			);
		}
		Validation.asValidationError(
			BackgroundTaskService.CLASS_NAME,
			nameof(options?.config),
			validationErrors
		);

		this._taskInterval =
			options?.config?.taskInterval ?? BackgroundTaskService._DEFAULT_TASK_INTERVAL;
		this._retryInterval =
			options?.config?.retryInterval ?? BackgroundTaskService._DEFAULT_RETRY_INTERVAL;
		this._cleanupInterval =
			options?.config?.cleanupInterval ?? BackgroundTaskService._DEFAULT_CLEANUP_INTERVAL;
		this._maxDispatchCount =
			options?.config?.maxDispatchCount ?? BackgroundTaskService._DEFAULT_MAX_DISPATCH_COUNT;
		this._workerShutdownTimeout =
			options?.config?.workerShutdownTimeout ??
			BackgroundTaskService._DEFAULT_WORKER_SHUTDOWN_TIMEOUT;
		this._overrideHealthCheckHandler =
			options?.config?.overrideHealthCheckHandler ??
			new URL("./healthCheckHandler.js", import.meta.url).href;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return BackgroundTaskService.CLASS_NAME;
	}

	/**
	 * The component needs to be started when the node is initialized.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns A promise that resolves when the service has started and pending tasks are being processed
	 */
	public async start(nodeLoggingComponentType?: string): Promise<void> {
		if (!this._started) {
			this._started = true;

			await this.cleanupRetained();
			await this.adoptOrphanedTasks();
			await this.requeueStaleProcessingTasks();

			for (const taskType of Object.keys(this._taskHandlers)) {
				await this.processTaskType(taskType);
			}
		}
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns A promise that resolves when all workers have been shut down
	 */
	public async stop(nodeLoggingComponentType?: string): Promise<void> {
		if (this._started) {
			this._started = false;
			this._dispatchCounts.clear();

			for (const [taskType, taskHandler] of Object.entries(this._taskHandlers)) {
				// Clear the wait timer so no new tasks are dispatched.
				if (!Is.undefined(taskHandler.waitTimerId)) {
					clearTimeout(taskHandler.waitTimerId);
					delete taskHandler.waitTimerId;
				}

				await this.terminateWorkers(taskHandler, taskType, [...taskHandler.workers]);
			}
		}
	}

	/**
	 * Register a handler for a task.
	 * @param taskType The type of the task the handler can process.
	 * @param module The module the handler is in.
	 * @param method The method in the module to execute.
	 * @param stateChangeCallback The callback to execute when the task state is updated.
	 * @param options Additional options for the task.
	 * @param options.maxWorkerCount The maximum number of workers in the pool.
	 * @param options.idleShutdownTimeout Terminate the thread after it has been idle for the specified timeout in milliseconds, defaults to 0 shutdown immediately, -1 to keep forever.
	 * @param options.initialiseMethod The initialisation method to call on the module when a worker is started.
	 * @param options.initialiseMethodParams Callback to provide additional parameters to spread when calling the initialiseMethod.
	 * @param options.shutdownMethod The shutdown method to call on the module when a worker is stopped.
	 * @param options.shutdownMethodParams Callback to provide additional parameters to spread when calling the shutdownMethod.
	 * @param options.executionTimeout Maximum time in milliseconds a task may run before it is marked as failed and the worker terminated. Omit for no limit.
	 * @returns A promise that resolves when the handler is registered and initial task processing begins
	 */
	public async registerHandler<T, U>(
		taskType: string,
		module: string,
		method: string,
		stateChangeCallback?: (task: IBackgroundTask<T, U>) => Promise<void>,
		options?: {
			maxWorkerCount?: number;
			idleShutdownTimeout?: number;
			initialiseMethod?: string;
			initialiseMethodParams?: () => Promise<unknown[]>;
			shutdownMethod?: string;
			shutdownMethodParams?: () => Promise<unknown[]>;
			executionTimeout?: number;
		}
	): Promise<void> {
		Guards.stringValue(BackgroundTaskService.CLASS_NAME, nameof(taskType), taskType);
		Guards.stringValue(BackgroundTaskService.CLASS_NAME, nameof(module), module);
		Guards.stringValue(BackgroundTaskService.CLASS_NAME, nameof(method), method);

		let maxWorkerCount = Coerce.integer(options?.maxWorkerCount) ?? 1;
		const idleShutdownTimeout = Coerce.integer(options?.idleShutdownTimeout) ?? 0;

		if (maxWorkerCount < 0) {
			// A negative worker count implies unlimited workers, so we set it to the system max
			maxWorkerCount = this._maxSystemWorkerCount;
		} else {
			// A non-negative worker count implies a limited number of workers
			// but we limit it to the system max
			maxWorkerCount = Math.min(maxWorkerCount, this._maxSystemWorkerCount);
		}

		this._taskHandlers[taskType] = {
			module,
			processingMethod: method,
			stateChangeCallback,
			initialiseMethod: options?.initialiseMethod,
			initialiseMethodParams: options?.initialiseMethodParams,
			shutdownMethod: options?.shutdownMethod,
			shutdownMethodParams: options?.shutdownMethodParams,
			maxWorkerCount,
			idleShutdownTimeout,
			executionTimeout: Coerce.integer(options?.executionTimeout) ?? undefined,
			workers: []
		};

		await this.processTaskType(taskType);
	}

	/**
	 * Unregister a handler for a task.
	 * @param taskType The type of the task handler to remove.
	 * @returns A promise that resolves when the handler and its workers have been removed
	 */
	public async unregisterHandler(taskType: string): Promise<void> {
		Guards.stringValue(BackgroundTaskService.CLASS_NAME, nameof(taskType), taskType);
		const taskHandler = this._taskHandlers[taskType];
		if (!Is.empty(taskHandler)) {
			if (!Is.undefined(taskHandler.waitTimerId)) {
				clearTimeout(taskHandler.waitTimerId);
				delete taskHandler.waitTimerId;
			}

			await this.terminateWorkers(taskHandler, taskType, [...taskHandler.workers]);
		}
		delete this._taskHandlers[taskType];
	}

	/**
	 * Create a new task.
	 * @param taskType The type of the task.
	 * @param payload The payload for the task.
	 * @param options Additional options for the task.
	 * @param options.retryCount The number of times to retry the task if it fails, leave undefined for no retries.
	 * @param options.retryInterval The interval in milliseconds to wait between retries, defaults to 5000, leave undefined for default scheduling.
	 * @param options.retainFor The amount of time in milliseconds to retain the result until removal, defaults to 0 for immediate removal, set to -1 to keep forever.
	 * @returns The id of the created task.
	 */
	public async create<T>(
		taskType: string,
		payload?: T,
		options?: {
			retryCount?: number;
			retryInterval?: number;
			retainFor?: number;
		}
	): Promise<string> {
		Guards.stringValue(BackgroundTaskService.CLASS_NAME, nameof(taskType), taskType);

		const validationErrors: IValidationFailure[] = [];
		if (!Is.undefined(options?.retryCount)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.retryCount),
				options.retryCount
			);
			Validation.integer(
				nameof(options.retryCount),
				options.retryCount,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.retryInterval)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.retryInterval),
				options.retryInterval
			);
			Validation.integer(
				nameof(options.retryInterval),
				options.retryInterval,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.retainFor)) {
			Guards.integer(
				BackgroundTaskService.CLASS_NAME,
				nameof(options.retainFor),
				options.retainFor
			);
			Validation.integer(
				nameof(options.retainFor),
				options.retainFor,
				validationErrors,
				undefined,
				{ minValue: -1 }
			);
		}

		Validation.asValidationError(
			BackgroundTaskService.CLASS_NAME,
			nameof(options),
			validationErrors
		);

		const id = RandomHelper.generateUuidV7("compact");

		const now = new Date(Date.now()).toISOString();

		const backgroundTask: BackgroundTask = {
			id,
			type: taskType,
			threadId: this.getThreadId(),
			dateCreated: now,
			dateModified: now,
			dateNextProcess: now,
			retryInterval: options?.retryInterval,
			retainFor: options?.retainFor ?? 0,
			status: TaskStatus.Pending,
			retriesRemaining: options?.retryCount,
			payload: ObjectHelper.clone(payload),
			contextIds: await ContextIdStore.getContextIds()
		};

		await this._backgroundTaskEntityStorageConnector.set(backgroundTask);

		// Give this method a chance to return before processing tasks.
		setTimeout(async () => {
			await this.processTaskType(taskType);
		}, 100);

		return `background-task:${BackgroundTaskService.NAMESPACE}:${id}`;
	}

	/**
	 * Get the task details.
	 * @param taskId The id of the task to get the details for.
	 * @returns The details of the task.
	 */
	public async get<T, U>(taskId: string): Promise<IBackgroundTask<T, U> | undefined> {
		Urn.guard(BackgroundTaskService.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== BackgroundTaskService.NAMESPACE) {
			throw new GeneralError(BackgroundTaskService.CLASS_NAME, "namespaceMismatch", {
				namespace: BackgroundTaskService.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (Is.object(task)) {
			return this.mapEntityToModel(task);
		}
	}

	/**
	 * Retry a failed task immediately instead of waiting for it's next scheduled retry time.
	 * @param taskId The id of the task to retry.
	 * @returns A promise that resolves when the retry has been scheduled
	 */
	public async retry(taskId: string): Promise<void> {
		Urn.guard(BackgroundTaskService.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== BackgroundTaskService.NAMESPACE) {
			throw new GeneralError(BackgroundTaskService.CLASS_NAME, "namespaceMismatch", {
				namespace: BackgroundTaskService.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (
			Is.object(task) &&
			Is.stringValue(task.dateNextProcess) &&
			task.status === TaskStatus.Pending
		) {
			task.dateNextProcess = new Date(Date.now()).toISOString();
			await this._backgroundTaskEntityStorageConnector.set(task);

			await this.processTaskType(task.type);
		}
	}

	/**
	 * Remove a task ignoring any retain until date.
	 * @param taskId The id of the task to remove.
	 * @returns A promise that resolves when the task has been removed from storage
	 */
	public async remove(taskId: string): Promise<void> {
		Urn.guard(BackgroundTaskService.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== BackgroundTaskService.NAMESPACE) {
			throw new GeneralError(BackgroundTaskService.CLASS_NAME, "namespaceMismatch", {
				namespace: BackgroundTaskService.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (Is.object(task)) {
			await this._backgroundTaskEntityStorageConnector.remove(urnParsed.namespaceSpecific(1));
			this._dispatchCounts.delete(task.id);
		}
	}

	/**
	 * Cancel a task, will only be actioned if the task is currently pending.
	 * @param taskId The id of the task to cancel.
	 * @returns A promise that resolves when the cancellation has been persisted
	 */
	public async cancel(taskId: string): Promise<void> {
		Urn.guard(BackgroundTaskService.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== BackgroundTaskService.NAMESPACE) {
			throw new GeneralError(BackgroundTaskService.CLASS_NAME, "namespaceMismatch", {
				namespace: BackgroundTaskService.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (Is.object(task) && task.status === TaskStatus.Pending) {
			this._dispatchCounts.delete(task.id);
			task.status = TaskStatus.Cancelled;
			task.dateCancelled = new Date(Date.now()).toISOString();
			task.dateNextProcess = undefined;
			task.retainUntil = this.calculateRetainTimestamp(task);
			await this._backgroundTaskEntityStorageConnector.set(task);

			await this.fireStateChanged(task);
		}
	}

	/**
	 * Get a list of tasks.
	 * @param taskType The type of the task to get.
	 * @param taskStatus The status of the task to get.
	 * @param sortProperty The property to sort by, defaults to dateCreated.
	 * @param sortDirection The order to sort by, defaults to ascending.
	 * @param cursor The cursor to get the next page of tasks.
	 * @param limit Limit the number of entities to return.
	 * @returns The list of tasks.
	 */
	public async query(
		taskType?: string,
		taskStatus?: TaskStatus,
		sortProperty?: "dateCreated" | "dateModified" | "dateCompleted" | "status",
		sortDirection?: SortDirection,
		cursor?: string,
		limit?: number
	): Promise<{
		entities: IBackgroundTask[];
		cursor?: string;
	}> {
		const result = await this.internalQuery(
			taskType,
			taskStatus ? [taskStatus] : undefined,
			undefined,
			sortProperty,
			sortDirection,
			cursor,
			limit
		);

		return {
			entities: result.entities.map(t => this.mapEntityToModel(t)),
			cursor: result.cursor
		};
	}

	/**
	 * Returns the application health status by running a full task register/create/verify/unregister lifecycle.
	 * Returns undefined as the result will be provided asynchronously via the callback.
	 * @param callback The callback to invoke when the deferred health result is ready.
	 * @returns undefined as the result is provided via the callback.
	 */
	public async healthApplication(
		callback: HealthApplicationCallback
	): Promise<IHealth[] | undefined> {
		const nonce = RandomHelper.generateUuidV7("compact");
		let taskId: string | undefined;

		const finalize = async (healthStatus: HealthStatus, error?: unknown): Promise<void> => {
			clearTimeout(timeoutId);
			await this.unregisterHandler(BackgroundTaskService._HEALTH_CHECK_TASK_TYPE);
			if (Is.stringValue(taskId)) {
				try {
					await this.remove(taskId);
				} catch {
					// Best-effort cleanup; the task will be removed on the next retained cleanup sweep.
				}
			}
			await callback([
				{
					source: BackgroundTaskService.CLASS_NAME,
					category: HealthCategory.Application,
					status: healthStatus,
					error: !Is.undefined(error) ? BaseError.fromError(error) : undefined
				}
			]);
		};

		const timeoutId = setTimeout(async () => {
			await finalize(
				HealthStatus.Error,
				new GeneralError(BackgroundTaskService.CLASS_NAME, "healthCheckTimeout", {
					timeout: BackgroundTaskService._HEALTH_CHECK_TASK_TIMEOUT
				})
			);
		}, BackgroundTaskService._HEALTH_CHECK_TASK_TIMEOUT);

		try {
			await this.registerHandler(
				BackgroundTaskService._HEALTH_CHECK_TASK_TYPE,
				this._overrideHealthCheckHandler,
				"execute",
				async (task: IBackgroundTask) => {
					if (
						task.status === TaskStatus.Success ||
						task.status === TaskStatus.Failed ||
						task.status === TaskStatus.Cancelled
					) {
						await finalize(
							task.result === nonce ? HealthStatus.Ok : HealthStatus.Error,
							task.error
						);
					}
				}
			);

			taskId = await this.create(BackgroundTaskService._HEALTH_CHECK_TASK_TYPE, nonce, {
				retainFor: -1
			});
		} catch (err) {
			await finalize(HealthStatus.Error, err);
		}

		return undefined;
	}

	/**
	 * Process the tasks of the specified type.
	 * @param taskType The type of the task to process.
	 * @returns A promise that resolves when the processing cycle for this task type is complete
	 * @internal
	 */
	private async processTaskType(taskType: string): Promise<void> {
		const taskHandler = this._taskHandlers[taskType];

		if (this._started && !Is.empty(taskHandler)) {
			// If there is an existing wait timer for this task type, clear it before setting a new one
			// If there is a wait time for this task type then clear it up
			const waitTimerId = taskHandler.waitTimerId;
			if (!Is.undefined(waitTimerId)) {
				clearTimeout(waitTimerId);
				delete taskHandler.waitTimerId;
			}

			// Now try and get the next task to process
			const nextTask = await this.getNextTask(taskType);

			// If there is a next task to process, try and process it
			if (Is.stringValue(nextTask?.dateNextProcess)) {
				// Check that we have reached the processing time for the next task
				// if not then we need to wait until it is ready to be processed
				const now = Date.now();
				const nextProcess = new Date(nextTask.dateNextProcess).getTime();

				// We haven't reached the next process time yet, so just set a timer
				// to try again when we reach it
				if (nextProcess > now) {
					taskHandler.waitTimerId = setTimeout(
						async () => this.processTaskType(taskType),
						nextProcess - now
					);
				} else {
					// Next process time has been reached so we can prepare to process the task

					// Claim the task for this process before dispatching. The check and add are
					// kept together and synchronous, so an interleaved processTaskType run for
					// the same task type cannot dispatch it twice. Released in the finally block
					// if we end up not dispatching (no worker capacity or dispatch threw),
					// otherwise in taskFinishedProcessing / cleanupWorker once the task completes.
					let inFlightForType = this._inFlightTaskIds.get(taskType);
					if (Is.empty(inFlightForType)) {
						inFlightForType = new Set<string>();
						this._inFlightTaskIds.set(taskType, inFlightForType);
					} else if (inFlightForType.has(nextTask.id)) {
						return;
					}

					inFlightForType.add(nextTask.id);

					// First check if any of the current workers are idle
					let activeWorkerCount = 0;
					let usedIdle = false;
					let dispatched = false;
					try {
						// The row from getNextTask can be stale, as a slow read can resolve after the task
						// completed and released its claim. Re-read it now the claim is held, so the
						// dispatch below cannot resurrect a finished row.
						const currentTask = await this.revalidateTask(nextTask);
						if (Is.empty(currentTask)) {
							this.scheduleNextTaskProcessing(taskType);
							return;
						}

						// Bound an attempt that keeps ending without a result. The count is only raised
						// on dispatch and cleared as soon as an attempt produces a result or an error,
						// so a non-zero count always means a previous dispatch was interrupted. It is
						// read rather than the row status, as an interrupted task is put back to pending.
						if (
							this._maxDispatchCount > 0 &&
							(this._dispatchCounts.get(currentTask.id)?.count ?? 0) >= this._maxDispatchCount
						) {
							await this.failInterruptedTask(currentTask);
							this.scheduleNextTaskProcessing(taskType);
							return;
						}

						for (const worker of taskHandler.workers) {
							if (Is.empty(worker.task)) {
								// Found an idle worker, no need for a new worker
								// we can just process the task on this one
								// If there is an idle timer for the worker, clear it now
								if (Is.object(worker.idleTimerId)) {
									clearTimeout(worker.idleTimerId);
									delete worker.idleTimerId;
								}
								await this.workerProcessTasks(taskHandler, worker, taskType, currentTask);
								usedIdle = true;
								dispatched = true;
								break;
							} else {
								activeWorkerCount++;
							}
						}

						if (!usedIdle) {
							// If we didn't use an idle worker, and the active worker count
							// is less than the maximum allowed for the task type, create a new worker
							if (activeWorkerCount < taskHandler.maxWorkerCount) {
								if (Object.keys(this._workers).length >= this._maxSystemWorkerCount) {
									// If there are no available system workers, we cannot create
									// any more workers right now, we log a warning and schedule
									// a retry for later
									if (activeWorkerCount === 0) {
										// Rate-limited to once per _CAP_REACHED_LOG_INTERVAL so a sustained
										// shortage doesn't flood the log every taskInterval.
										taskHandler.capReachedCount = (taskHandler.capReachedCount ?? 0) + 1;

										const capReachedNow = Date.now();
										if (
											capReachedNow - (taskHandler.capReachedLastLoggedMs ?? 0) >=
											BackgroundTaskService._CAP_REACHED_LOG_INTERVAL
										) {
											taskHandler.capReachedLastLoggedMs = capReachedNow;
											await this._logging?.log({
												level: "warn",
												source: BackgroundTaskService.CLASS_NAME,
												ts: capReachedNow,
												message: "maxSystemWorkerCountReached",
												data: {
													maxSystemWorkerCount: this._maxSystemWorkerCount,
													type: taskType,
													count: taskHandler.capReachedCount
												}
											});
										}

										// Backs off so a type with no worker at all isn't retried every
										// single taskInterval.
										this.scheduleNextTaskProcessing(
											taskType,
											this.capReachedWaitMs(taskHandler.capReachedCount)
										);
									} else {
										// There is no capacity to process this task right now, but the
										// task type has active workers, so we just wait for the next processing
										// cycle to pick it up, which will be triggered when a current task
										// finishes processing
									}
								} else {
									const workerId = RandomHelper.generateUuidV7("compact");
									const newWorker: IBackgroundTaskWorker = {
										workerId
									};
									taskHandler.workers.push(newWorker);
									this._workers[workerId] = {
										taskType,
										worker: newWorker
									};
									await this.workerProcessTasks(taskHandler, newWorker, taskType, currentTask);
									dispatched = true;
								}
							} else {
								// There is no capacity to process this task right now, so we just wait
								// for the next processing cycle to pick it up, which will be triggered
								// when a current task finishes processing
							}
						}
					} catch (err) {
						// workerProcessTasks can throw (e.g. a storage failure); log the error so
						// it doesn't surface as an unhandled rejection from the fire-and-forget
						// setTimeout callbacks that drive this method.
						await this._logging?.log({
							level: "error",
							source: BackgroundTaskService.CLASS_NAME,
							ts: Date.now(),
							message: "dispatchFailed",
							data: { taskId: nextTask.id, taskType },
							error: BaseError.fromError(err)
						});
					} finally {
						if (dispatched) {
							// Backoff restarts next time it's blocked; capReachedLastLoggedMs is
							// left alone so the warning stays rate-limited across episodes too.
							taskHandler.capReachedCount = undefined;
						} else {
							// Claimed above but not dispatched (no worker capacity or dispatch threw);
							// release the claim so the next processing cycle can pick the task up again.
							this._inFlightTaskIds.get(taskType)?.delete(nextTask.id);
						}
					}

					await this.cleanupRetained();
				}
			}
		}
	}

	/**
	 * Get the next task of the type to process.
	 * @param taskType The type of the task to get.
	 * @returns The next task to process or undefined if there are no tasks to process.
	 * @internal
	 */
	private async getNextTask(taskType: string): Promise<BackgroundTask | undefined> {
		// If there is a processing task from a previous run, we need to finish up handling that first.
		// we sort by dateNextProcess so that anything that failed or is in a retry state will get processed
		// in the correct order.
		// We include pending tasks when requested, this allows us to pick up any tasks that were pending
		// but never started due to the service stopping.
		// Returning a task in processing state allows us to continue processing tasks that were interrupted, but
		// any tasks should internally decide if they need to be retried or not based on their own state.
		// Fetch enough candidates to skip any tasks this process is already handling,
		// so concurrent processTaskType cycles fan out to different tasks (preserving
		// multi-worker parallelism) instead of re-selecting an in-flight one.
		const inFlightForType = this._inFlightTaskIds.get(taskType);
		const nextTasks = await this.internalQuery(
			taskType,
			[TaskStatus.Processing, TaskStatus.Pending],
			this.getThreadId(),
			"dateNextProcess",
			SortDirection.Ascending,
			undefined,
			(inFlightForType?.size ?? 0) + 1
		);

		// Return the earliest task that is not already being processed by this process.
		const nextTask = nextTasks.entities.find(task => !inFlightForType?.has(task.id));

		// All tasks with processing or pending status should have next process set
		if (!Is.empty(nextTask) && Is.stringValue(nextTask.dateNextProcess)) {
			return nextTask;
		}
	}

	/**
	 * Re-read a candidate task so a stale row from a slow query is never dispatched.
	 * @param candidate The task returned by the selection query.
	 * @returns The current task if it is still due to be processed, otherwise undefined.
	 * @internal
	 */
	private async revalidateTask(candidate: BackgroundTask): Promise<BackgroundTask | undefined> {
		const current = await this._backgroundTaskEntityStorageConnector.get(candidate.id);

		// Rejects a task removed, finished, cancelled or rescheduled while the query was in flight.
		if (
			Is.object(current) &&
			(current.status === TaskStatus.Pending || current.status === TaskStatus.Processing) &&
			Is.stringValue(current.dateNextProcess) &&
			new Date(current.dateNextProcess).getTime() <= Date.now()
		) {
			return current;
		}
	}

	/**
	 * Fail a task whose attempts have repeatedly been interrupted without producing a result.
	 * @param task The task to fail.
	 * @returns A promise that resolves when the failure has been persisted and callbacks fired.
	 * @internal
	 */
	private async failInterruptedTask(task: BackgroundTask): Promise<void> {
		const dispatchCount = this._dispatchCounts.get(task.id)?.count ?? 0;
		const error = new GeneralError(BackgroundTaskService.CLASS_NAME, "taskInterrupted", {
			id: task.id,
			type: task.type,
			dispatchCount
		});

		const now = new Date(Date.now()).toISOString();
		task.status = TaskStatus.Failed;
		task.error = BaseError.fromError(error).toJsonObject(true);
		task.dateModified = now;
		task.dateCompleted = now;
		task.dateNextProcess = undefined;
		this._dispatchCounts.delete(task.id);

		await this.processRetention(task);

		await this._logging?.log({
			level: "error",
			source: BackgroundTaskService.CLASS_NAME,
			ts: Date.now(),
			message: "taskInterrupted",
			data: {
				id: task.id,
				type: task.type,
				dispatchCount
			},
			error: BaseError.fromError(error)
		});

		await this.fireStateChanged(task);
	}

	/**
	 * Drop dispatch counts for tasks that are neither running nor awaiting a re-dispatch.
	 * @internal
	 */
	private pruneDispatchCounts(): void {
		if (this._dispatchCounts.size === 0) {
			return;
		}

		const inFlight = new Set<string>();
		for (const taskIds of this._inFlightTaskIds.values()) {
			for (const taskId of taskIds) {
				inFlight.add(taskId);
			}
		}

		// An interrupted task is re-selected within its retry interval, so an entry left untouched
		// for far longer has no cycle coming for it, usually because its handler was unregistered or
		// its row was removed elsewhere. The worst case of dropping one too early is a fresh budget.
		const expiry =
			Date.now() -
			Math.max(this._cleanupInterval, this._retryInterval * (this._maxDispatchCount + 1));

		for (const [taskId, dispatch] of this._dispatchCounts) {
			if (!inFlight.has(taskId) && dispatch.ts < expiry) {
				this._dispatchCounts.delete(taskId);
			}
		}
	}

	/**
	 * Process tasks on a worker.
	 * @param taskHandler The background task handler.
	 * @param worker The background task worker.
	 * @param taskType The type of the task to process.
	 * @param nextTask The next background task to process.
	 * @returns A promise that resolves when the task has been dispatched to the worker thread
	 * @internal
	 */
	private async workerProcessTasks(
		taskHandler: IBackgroundTaskHandler,
		worker: IBackgroundTaskWorker,
		taskType: string,
		nextTask: BackgroundTask
	): Promise<void> {
		if (Is.empty(worker.module)) {
			// No module worker is set, so this must be a new worker,
			// initialise it now
			worker.module = ModuleHelper.execModuleMethodThreadMessage(
				taskHandler.module,
				async (operation, result, err) => {
					if (operation === taskHandler.processingMethod) {
						// The result of the process task is just the worker id
						// which we can use to lookup the thread and the task running on it
						await this.taskFinishedProcessing(taskHandler, worker.workerId, result, err);
					} else if (
						Is.stringValue(taskHandler.shutdownMethod) &&
						operation === taskHandler.shutdownMethod
					) {
						// The runner has stopped, so we need to remove the worker from the pool
						await this.cleanupWorker(taskHandler, worker);
					} else if (operation === "error") {
						// The worker thread crashed with an uncaught exception. Record the
						// task failure so retry logic runs, then force-clean the pool slot.
						// We bypass shutdownIdleThread() because the thread is already dead;
						// postMessage would be silently dropped, leaving cleanupWorker unreachable.
						await this.taskFinishedProcessing(taskHandler, worker.workerId, undefined, err);
						await this.cleanupWorker(taskHandler, worker);
					}
				},
				{
					threadName: `thread-${StringHelper.kebabCase(taskType)}`
				}
			);

			if (Is.stringValue(taskHandler.initialiseMethod)) {
				await this._logging?.log({
					level: "info",
					source: BackgroundTaskService.CLASS_NAME,
					ts: Date.now(),
					message: "initialisingWorker",
					data: {
						type: taskType
					}
				});

				// Use a replica of the IEngineCore interface to avoid a circular dependency on the engine-core package.
				const engineCloneData = Factory.getFactory("engine-core")
					?.getIfExists<{ getCloneData: () => unknown }>("engine")
					?.getCloneData();

				const currentContextIds = await ContextIdStore.getContextIds();
				const initialiseParams = Is.function(taskHandler.initialiseMethodParams)
					? await taskHandler.initialiseMethodParams()
					: [];
				worker.module.executeMethod(
					taskHandler.initialiseMethod,
					[engineCloneData, ...initialiseParams],
					currentContextIds
				);
			}
		}

		// Assign the task to the worker
		worker.task = nextTask;

		// Immediately set the task to processing to prevent multiple instances of the same task running.
		const dispatchedAt = Date.now();
		nextTask.status = TaskStatus.Processing;
		nextTask.dateModified = new Date(dispatchedAt).toISOString();
		// Count the dispatch so repeated interruptions can be bounded, and push the next process time
		// out so a task left in processing stops sorting ahead of pending work. Nothing is recorded
		// when the bound is disabled, as the count would never be read or reclaimed.
		if (this._maxDispatchCount > 0) {
			this._dispatchCounts.set(nextTask.id, {
				count: (this._dispatchCounts.get(nextTask.id)?.count ?? 0) + 1,
				ts: dispatchedAt
			});
		}
		nextTask.dateNextProcess = new Date(
			dispatchedAt + (nextTask.retryInterval ?? this._retryInterval)
		).toISOString();
		await this._backgroundTaskEntityStorageConnector.set(nextTask);

		await this.fireStateChanged(nextTask);

		await this._logging?.log({
			level: "info",
			source: BackgroundTaskService.CLASS_NAME,
			ts: Date.now(),
			message: "start",
			data: {
				id: nextTask.id,
				type: nextTask.type
			}
		});

		// Use a replica of the IEngineCore interface to avoid a circular dependency on the engine-core package.
		const engineCloneData = Factory.getFactory("engine-core")
			?.getIfExists<{ getCloneData: () => unknown }>("engine")
			?.getCloneData();
		worker.module.executeMethod(
			taskHandler.processingMethod,
			[engineCloneData, nextTask.payload],
			nextTask.contextIds
		);

		if (Is.integer(taskHandler.executionTimeout) && taskHandler.executionTimeout > 0) {
			worker.executionTimerId = setTimeout(async () => {
				delete worker.executionTimerId;
				// Guard: task may have already completed normally before the timeout fired.
				if (!Is.object(worker.task)) {
					return;
				}
				await this._logging?.log({
					level: "error",
					source: BackgroundTaskService.CLASS_NAME,
					ts: Date.now(),
					message: "executionTimeout",
					data: {
						id: worker.task.id,
						type: taskType,
						timeout: taskHandler.executionTimeout
					}
				});
				const timeoutError = new GeneralError(
					BackgroundTaskService.CLASS_NAME,
					"executionTimeout",
					{ id: worker.task.id, type: taskType, timeout: taskHandler.executionTimeout }
				);
				await this.taskFinishedProcessing(taskHandler, worker.workerId, undefined, timeoutError);
				// Give the stalled worker the chance to run its shutdown method so it can release
				// any resources it holds, then force-terminate it if it does not respond in time.
				await this.terminateWorkers(taskHandler, taskType, [worker]);
			}, taskHandler.executionTimeout);
		}
	}

	/**
	 * Cleanup a worker from the pool, and give any task type backed off by the system worker cap
	 * an immediate retry now a slot is free.
	 * @param taskHandler The background task handler.
	 * @param thread The background task thread.
	 * @returns A promise that resolves when the worker has been terminated and removed from the pool.
	 * @internal
	 */
	private async cleanupWorker(
		taskHandler: IBackgroundTaskHandler,
		thread: IBackgroundTaskWorker
	): Promise<void> {
		const worker = this._workers[thread.workerId];
		if (!Is.empty(worker)) {
			// If the worker is torn down while still holding a task, release its in-flight claim
			// so the task can be picked up again, and put the row back to pending so that
			// processing always means a worker is running it.
			if (!Is.empty(thread.task)) {
				const taskId = thread.task.id;
				this._inFlightTaskIds.get(worker.taskType)?.delete(taskId);

				if (thread.task.status === TaskStatus.Processing) {
					try {
						// Re-read the row, so a task removed or finalised elsewhere while the worker
						// held it is not resurrected as pending.
						const current = await this._backgroundTaskEntityStorageConnector.get(taskId);
						if (Is.object(current) && current.status === TaskStatus.Processing) {
							await this.requeueTask(current);
						}
					} catch (err) {
						await this._logging?.log({
							level: "warn",
							source: BackgroundTaskService.CLASS_NAME,
							ts: Date.now(),
							message: "taskRequeueFailed",
							data: {
								id: taskId,
								type: worker.taskType
							},
							error: BaseError.fromError(err)
						});
					}
				}
			}
			// Remove the thread from the pool
			if (!Is.empty(taskHandler)) {
				taskHandler.workers = taskHandler.workers.filter(t => t.workerId !== thread.workerId);
			}
			// Remove the worker from the worker list
			delete this._workers[thread.workerId];
			this.wakeStarvedTaskTypes(taskHandler);
			await thread.module?.terminate();
		}
	}

	/**
	 * Shutdown the supplied workers, giving each one the chance to run its shutdown method and
	 * release any resources it holds, before force-terminating the ones that do not respond in time.
	 * @param taskHandler The background task handler.
	 * @param taskType The type of the task the workers belong to.
	 * @param threads The background task threads to terminate.
	 * @returns A promise that resolves when all the workers have been removed from the pool.
	 * @internal
	 */
	private async terminateWorkers(
		taskHandler: IBackgroundTaskHandler,
		taskType: string,
		threads: IBackgroundTaskWorker[]
	): Promise<void> {
		// Cancel the timers and send a graceful shutdown message to each worker.
		// shutdownIdleThread falls through to cleanupWorker immediately when no
		// shutdownMethod is registered.
		for (const thread of threads) {
			// The worker may already have cleaned itself up, in which case there is nothing
			// left to ask it to do.
			if (!Is.empty(this._workers[thread.workerId])) {
				if (!Is.undefined(thread.idleTimerId)) {
					clearTimeout(thread.idleTimerId);
					delete thread.idleTimerId;
				}
				if (!Is.undefined(thread.executionTimerId)) {
					clearTimeout(thread.executionTimerId);
					delete thread.executionTimerId;
				}
				await this.shutdownIdleThread(taskHandler, taskType, thread);
			}
		}

		// Poll until all the workers have self-cleaned via their shutdown completed callback,
		// or until the timeout elapses.
		const deadline = Date.now() + this._workerShutdownTimeout;
		while (
			threads.some(thread => !Is.empty(this._workers[thread.workerId])) &&
			Date.now() < deadline
		) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		// Force-terminate any workers that did not finish in time.
		for (const thread of threads) {
			await this.cleanupWorker(taskHandler, thread);
		}
	}

	/**
	 * Put a task back to pending, so its row shows that it is waiting instead of running.
	 * @param task The task to requeue.
	 * @returns A promise that resolves when the task has been persisted and callbacks fired.
	 * @internal
	 */
	private async requeueTask(task: BackgroundTask): Promise<void> {
		const now = new Date(Date.now()).toISOString();
		task.status = TaskStatus.Pending;
		task.dateModified = now;
		// A dispatched task always has a next process time, which is its backoff and decides where
		// it sorts; without one it would never be selected again, so process it immediately.
		task.dateNextProcess ??= now;
		await this._backgroundTaskEntityStorageConnector.set(task);

		await this._logging?.log({
			level: "info",
			source: BackgroundTaskService.CLASS_NAME,
			ts: Date.now(),
			message: "taskRequeued",
			data: {
				id: task.id,
				type: task.type
			}
		});

		await this.fireStateChanged(task);
	}

	/**
	 * Give every task type backed off by the system worker cap an immediate retry, as a slot has
	 * just been released; the backoff stays as the safety net for the ones that lose the race.
	 * @param releasedFrom The handler whose worker was released, which reschedules itself.
	 * @internal
	 */
	private wakeStarvedTaskTypes(releasedFrom?: IBackgroundTaskHandler): void {
		if (!this._started) {
			return;
		}
		for (const [taskType, handler] of Object.entries(this._taskHandlers)) {
			if (handler !== releasedFrom && !Is.undefined(handler.capReachedCount)) {
				this.scheduleNextTaskProcessing(taskType);
			}
		}
	}

	/**
	 * Handle when a task has finished processing.
	 * @param taskHandler The background task handler.
	 * @param workerId The id of the worker that processed the task.
	 * @param result The result of the task processing.
	 * @param err Any error that occurred during processing.
	 * @returns A promise that resolves when the task state has been persisted and callbacks fired
	 * @internal
	 */
	private async taskFinishedProcessing(
		taskHandler: IBackgroundTaskHandler,
		workerId: string,
		result: unknown,
		err?: Error
	): Promise<void> {
		const worker = this._workers[workerId];
		if (Is.empty(worker)) {
			return;
		}

		const task = worker.worker.task;

		// The task should always be set here, but just in case we check
		if (!Is.object(task)) {
			return;
		}

		const taskType = task.type;
		let finalised = false;

		try {
			// The attempt produced a result, an error included, so it was not interrupted.
			this._dispatchCounts.delete(task.id);

			if (Is.empty(err)) {
				// No error so set the task state to success and clear
				// any retry information
				task.result = result;
				task.status = TaskStatus.Success;
				task.dateNextProcess = undefined;
				task.dateCompleted = new Date(Date.now()).toISOString();
				delete task.retriesRemaining;
				delete task.retryInterval;
				delete task.error;
			} else {
				// There was an error from the task processing, so set the error information
				let taskError = BaseError.fromError(err).toJsonObject(true);
				if (
					taskError.message === `${nameofCamelCase(ModuleHelper)}.resultError` &&
					!Is.empty(taskError.cause)
				) {
					taskError = BaseError.fromError(taskError.cause).toJsonObject(true);
				}

				task.error = taskError;

				// If there are retries remaining, set the task to pending and schedule the next retry.
				if (Is.integer(task.retriesRemaining) && task.retriesRemaining > 0) {
					task.status = TaskStatus.Pending;
					task.retriesRemaining--;
					const nextRetryMs: number = task.retryInterval ?? this._retryInterval;
					const now: number = new Date(task.dateModified).getTime();
					task.dateNextProcess = new Date(now + nextRetryMs).toISOString();
				} else {
					// Otherwise set the task to failed.
					task.status = TaskStatus.Failed;
					task.dateCompleted = new Date(Date.now()).toISOString();
					task.dateNextProcess = undefined;
				}
			}

			if (task.status === TaskStatus.Pending) {
				// If it's pending, just update the task for the next retry
				await this._backgroundTaskEntityStorageConnector.set(task);
			} else {
				await this.processRetention(task);
			}

			// The stored row now reflects the outcome, so the claim is safe to release.
			finalised = true;

			const duration = Date.now() - new Date(task.dateModified).getTime();

			if (task.status === TaskStatus.Failed) {
				await this._logging?.log({
					level: "error",
					source: BackgroundTaskService.CLASS_NAME,
					ts: Date.now(),
					message: "completeFailed",
					data: {
						id: task.id,
						type: task.type,
						status: task.status,
						duration
					},
					error: BaseError.fromError(err)
				});
			} else {
				await this._logging?.log({
					level: "info",
					source: BackgroundTaskService.CLASS_NAME,
					ts: Date.now(),
					message: "complete",
					data: {
						id: task.id,
						type: task.type,
						status: task.status,
						duration
					}
				});
			}

			await this.fireStateChanged(task);

			// If the terminate when idle option is set for the pool, we need to terminate the worker
			// and remove it from the pool
			if (taskHandler.idleShutdownTimeout >= 0 && task.status !== TaskStatus.Pending) {
				if (taskHandler.idleShutdownTimeout > 0) {
					worker.worker.idleTimerId = setTimeout(
						async () => this.shutdownIdleThread(taskHandler, task.type, worker.worker),
						taskHandler.idleShutdownTimeout
					);
				} else {
					await this.shutdownIdleThread(taskHandler, task.type, worker.worker);
				}
			}
		} catch (error) {
			await this._logging?.log({
				level: "error",
				source: BackgroundTaskService.CLASS_NAME,
				ts: Date.now(),
				message: "taskFinishedProcessingFailed",
				data: {
					id: task.id,
					type: taskHandler.processingMethod
				},
				error: BaseError.fromError(error)
			});
		} finally {
			// Cancel any pending execution timeout so it does not fire after the task is done.
			if (!Is.undefined(worker.worker.executionTimerId)) {
				clearTimeout(worker.worker.executionTimerId);
				delete worker.worker.executionTimerId;
			}
			// Clear the task from the worker so that it can be re-used for the next task
			worker.worker.task = undefined;
			if (finalised) {
				// Release the in-flight claim so the task can be re-selected by the next
				// processing cycle (e.g. a scheduled retry when its status is Pending).
				this._inFlightTaskIds.get(taskType)?.delete(task.id);
			} else {
				// The write failed so the row is still in processing despite the task having run.
				// Releasing the claim would let the next cycle run it again, so hold it until restart.
				await this._logging?.log({
					level: "warn",
					source: BackgroundTaskService.CLASS_NAME,
					ts: Date.now(),
					message: "taskClaimRetained",
					data: {
						id: task.id,
						type: taskType
					}
				});
			}
			this.scheduleNextTaskProcessing(taskType);
		}
	}

	/**
	 * Schedule the next processing cycle for a task type.
	 * @param taskType The type of the task to schedule.
	 * @param delayMs The delay in milliseconds before the next cycle, defaults to the configured
	 * taskInterval.
	 * @internal
	 */
	private scheduleNextTaskProcessing(taskType: string, delayMs?: number): void {
		const taskHandler = this._taskHandlers[taskType];
		if (Is.empty(taskHandler)) {
			return;
		}
		if (!Is.undefined(taskHandler.waitTimerId)) {
			clearTimeout(taskHandler.waitTimerId);
			delete taskHandler.waitTimerId;
		}
		taskHandler.waitTimerId = setTimeout(
			async () => this.processTaskType(taskType),
			delayMs ?? this._taskInterval
		);
	}

	/**
	 * The retry wait for a type blocked by the system worker cap, doubling per consecutive block
	 * and clamped between taskInterval and _MAX_CAP_REACHED_WAIT.
	 * @param consecutiveCount How many consecutive times this type has been blocked.
	 * @returns The delay in milliseconds.
	 * @internal
	 */
	private capReachedWaitMs(consecutiveCount: number): number {
		const multiplier = 2 ** Math.max(consecutiveCount - 1, 0);
		const backedOff = Math.min(
			this._taskInterval * multiplier,
			BackgroundTaskService._MAX_CAP_REACHED_WAIT
		);
		return Math.max(backedOff, this._taskInterval);
	}

	/**
	 * Shutdown an idle thread.
	 * @param taskHandler The background task handler.
	 * @param taskType The task type being shut down.
	 * @param thread The background task thread.
	 * @returns A promise that resolves when the shutdown method has been invoked or the worker cleaned up immediately
	 * @internal
	 */
	private async shutdownIdleThread(
		taskHandler: IBackgroundTaskHandler,
		taskType: string,
		thread: IBackgroundTaskWorker
	): Promise<void> {
		if (Is.stringValue(taskHandler.shutdownMethod)) {
			// The shutdown can be requested from the idle timer, a tear-down and stop, but the
			// worker should only be asked to release its resources once.
			if (thread.shuttingDown === true) {
				return;
			}
			thread.shuttingDown = true;

			// Call the shutdown method on the worker before terminating
			// this will trigger the cleanupWorker method when complete
			await this._logging?.log({
				level: "info",
				source: BackgroundTaskService.CLASS_NAME,
				ts: Date.now(),
				message: "shutdownWorker",
				data: {
					type: taskType
				}
			});
			const boundMethod = thread.module?.executeMethod.bind(thread.module);
			if (Is.function(boundMethod)) {
				const shutdownParams = Is.function(taskHandler.shutdownMethodParams)
					? await taskHandler.shutdownMethodParams()
					: [];
				boundMethod(taskHandler.shutdownMethod, shutdownParams);
			}
		} else {
			// No shutdown method, so just cleanup the worker immediately
			await this.cleanupWorker(taskHandler, thread);
		}
	}

	/**
	 * Fire the state changed callback for a task.
	 * @param task The task that changed state.
	 * @returns A promise that resolves when the state change callback has completed
	 * @internal
	 */
	private async fireStateChanged(task: BackgroundTask): Promise<void> {
		const taskHandler = this._taskHandlers[task.type];
		if (!Is.empty(taskHandler)) {
			const stateChangeCallback = taskHandler.stateChangeCallback;
			if (Is.function(stateChangeCallback)) {
				const contextIds = task.contextIds ?? {};
				try {
					await ContextIdStore.run(contextIds, async () => {
						await stateChangeCallback(this.mapEntityToModel(task));
					});
				} catch (error) {
					await this._logging?.log({
						level: "error",
						source: BackgroundTaskService.CLASS_NAME,
						ts: Date.now(),
						message: "stateChangeCallbackFailed",
						data: {
							id: task.id,
							type: task.type,
							status: task.status
						},
						error: BaseError.fromError(error)
					});
				}
			}
		}
	}

	/**
	 * Process the retention of a task.
	 * @param task The task to process retention for.
	 * @returns A promise that resolves when the task has been removed or its retain timestamp updated
	 * @internal
	 */
	private async processRetention(task: BackgroundTask): Promise<void> {
		// Depending on the retainFor value, either remove the task or set the retainUntil date.
		// If the retainFor is 0, the default, it should be removed immediately.
		// If the retainFor is -1, it should be retained forever.
		// If it has a value in milliseconds, it should be retained until the retainUntil date.
		if (task.retainFor === 0) {
			await this._backgroundTaskEntityStorageConnector.remove(task.id);
		} else {
			task.retainUntil = this.calculateRetainTimestamp(task);
			if (Is.integer(task.retainUntil)) {
				delete task.retainFor;
			}
			await this._backgroundTaskEntityStorageConnector.set(task);
		}
	}

	/**
	 * Get a list of tasks.
	 * @param taskType The type of the task to get.
	 * @param taskStatuses The status of the task to get.
	 * @param threadId The thread id to get tasks for, defaults to all threads.
	 * @param sortProperty The property to sort by, defaults to dateCreated.
	 * @param sortDirection The order to sort by, defaults to ascending.
	 * @param cursor The cursor to get the next page of tasks.
	 * @param limit Limit the number of entities to return.
	 * @returns The list of tasks.
	 * @internal
	 */
	private async internalQuery(
		taskType?: string,
		taskStatuses?: TaskStatus[],
		threadId?: string,
		sortProperty?: "dateCreated" | "dateModified" | "dateCompleted" | "dateNextProcess" | "status",
		sortDirection?: SortDirection,
		cursor?: string,
		limit?: number
	): Promise<{
		entities: BackgroundTask[];
		cursor?: string;
	}> {
		const condition: EntityCondition<BackgroundTask> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		if (Is.stringValue(taskType)) {
			condition.conditions.push({
				property: "type",
				comparison: ComparisonOperator.Equals,
				value: taskType
			});
		}

		if (Is.arrayValue(taskStatuses)) {
			const statusCondition: EntityCondition<BackgroundTask> = {
				conditions: [],
				logicalOperator: LogicalOperator.Or
			};
			for (const taskStatus of taskStatuses) {
				if (Is.arrayOneOf(taskStatus, Object.values(TaskStatus))) {
					statusCondition.conditions.push({
						property: "status",
						comparison: ComparisonOperator.Equals,
						value: taskStatus
					});
				}
			}
			condition.conditions.push(statusCondition);
		}

		if (Is.stringValue(threadId)) {
			condition.conditions.push({
				property: "threadId",
				comparison: ComparisonOperator.Equals,
				value: threadId
			});
		}

		const result = await this._backgroundTaskEntityStorageConnector.query(
			condition,
			[
				{
					property: sortProperty ?? "dateCreated",
					sortDirection: sortDirection ?? SortDirection.Descending
				}
			],
			undefined,
			cursor,
			limit
		);

		return {
			entities: result.entities as BackgroundTask[],
			cursor: result.cursor
		};
	}

	/**
	 * Map the entity to a model.
	 * @param task The task to map to the model.
	 * @returns The task model.
	 * @internal
	 */
	private mapEntityToModel<T, U>(task: BackgroundTask): IBackgroundTask<T, U> {
		return {
			id: `background-task:${BackgroundTaskService.NAMESPACE}:${task.id}`,
			type: task.type,
			threadId: task.threadId,
			dateCreated: task.dateCreated,
			dateModified: task.dateModified,
			dateCompleted: task.dateCompleted,
			dateCancelled: task.dateCancelled,
			dateRetainUntil: Is.integer(task.retainUntil)
				? new Date(task.retainUntil).toISOString()
				: undefined,
			retryInterval: task.retryInterval,
			retriesRemaining: task.retriesRemaining,
			status: task.status,
			payload: task.payload as T,
			result: task.result as U,
			error: task.error
		};
	}

	/**
	 * Calculate the retain timestamp for the task.
	 * @param task The task to calculate the retain timestamp.
	 * @returns The retain timestamp or undefined if not is calculated.
	 * @internal
	 */
	private calculateRetainTimestamp(task: BackgroundTask): number | undefined {
		let retainTimestamp: number | undefined;

		// We only calculate a retain timestamp if the task is in a completion state
		// and has a length of time set for how long to retain it
		// If the retain time is -1 that means retain forever, these tasks can
		// still be removed with a manual remove call
		if (
			(task.status === TaskStatus.Success ||
				task.status === TaskStatus.Cancelled ||
				task.status === TaskStatus.Failed) &&
			Is.integer(task.retainFor)
		) {
			if (task.retainFor > 0) {
				retainTimestamp = new Date(task.dateModified).getTime() + task.retainFor;
			} else if (task.retainFor === -1) {
				retainTimestamp = -1;
			}
		}

		return retainTimestamp;
	}

	/**
	 * Adopt tasks left in pending or processing state by worker threads from a previous session.
	 * Worker thread IDs are ephemeral integers that recycle on each process restart, so any task
	 * with a non-"main" threadId that survived a pod restart is definitionally orphaned.
	 * @returns A promise that resolves when all orphaned tasks have been re-assigned to the main thread
	 * @internal
	 */
	private async adoptOrphanedTasks(): Promise<void> {
		if (!isMainThread) {
			return;
		}

		try {
			let cursor: string | undefined;

			do {
				const result = await this._backgroundTaskEntityStorageConnector.query(
					{
						conditions: [
							{
								property: "threadId",
								value: "main",
								comparison: ComparisonOperator.NotEquals
							},
							{
								conditions: [
									{
										property: "status",
										value: TaskStatus.Pending,
										comparison: ComparisonOperator.Equals
									},
									{
										property: "status",
										value: TaskStatus.Processing,
										comparison: ComparisonOperator.Equals
									}
								],
								logicalOperator: LogicalOperator.Or
							}
						],
						logicalOperator: LogicalOperator.And
					},
					undefined,
					undefined,
					cursor
				);

				cursor = result.cursor;

				for (const task of result.entities as BackgroundTask[]) {
					task.threadId = "main";
					task.dateModified = new Date(Date.now()).toISOString();
					await this._backgroundTaskEntityStorageConnector.set(task);
				}
			} while (Is.stringValue(cursor));
		} catch {
			// Best-effort startup recovery; failures here are not fatal.
		}
	}

	/**
	 * Put the tasks this node left in processing back to pending. No worker survives a restart, so
	 * a row still marked as processing at startup has nothing running it, which would otherwise
	 * leave it showing as in-flight and block it from being cancelled.
	 * @returns A promise that resolves when the stale tasks have been requeued
	 * @internal
	 */
	private async requeueStaleProcessingTasks(): Promise<void> {
		try {
			const staleTasks: BackgroundTask[] = [];
			let cursor: string | undefined;

			// Collect the rows before writing any of them, as updating the status they are being
			// selected on would move the cursor while paging through the results.
			do {
				const result = await this.internalQuery(
					undefined,
					[TaskStatus.Processing],
					this.getThreadId(),
					undefined,
					undefined,
					cursor
				);

				cursor = result.cursor;
				staleTasks.push(...result.entities);
			} while (Is.stringValue(cursor));

			for (const task of staleTasks) {
				await this.requeueTask(task);
			}
		} catch {
			// Best-effort startup recovery; failures here are not fatal.
		}
	}

	/**
	 * Cleanup the retained tasks.
	 * @returns A promise that resolves when expired retained tasks have been removed
	 * @internal
	 */
	private async cleanupRetained(): Promise<void> {
		if (!isMainThread) {
			return;
		}

		try {
			const now = Date.now();

			// Cleanup every minute
			if (now - this._lastCleanup < this._cleanupInterval) {
				return;
			}

			this._lastCleanup = now;

			this.pruneDispatchCounts();

			let cursor: string | undefined;

			do {
				const result = await this._backgroundTaskEntityStorageConnector.query({
					conditions: [
						{
							property: "retainUntil",
							value: 0,
							comparison: ComparisonOperator.GreaterThan
						},
						{
							property: "retainUntil",
							value: now,
							comparison: ComparisonOperator.LessThan
						},
						{
							conditions: [
								{
									property: "status",
									value: TaskStatus.Success,
									comparison: ComparisonOperator.Equals
								},
								{
									property: "status",
									value: TaskStatus.Failed,
									comparison: ComparisonOperator.Equals
								},
								{
									property: "status",
									value: TaskStatus.Cancelled,
									comparison: ComparisonOperator.Equals
								}
							],
							logicalOperator: LogicalOperator.Or
						}
					],
					logicalOperator: LogicalOperator.And
				});
				cursor = result.cursor;

				for (const entity of result.entities) {
					await this._backgroundTaskEntityStorageConnector.remove(entity.id as string);
				}
			} while (Is.stringValue(cursor));
		} catch {
			// If cleaning up the retained items fail we don't really care, they will get cleaned up on the next sweep.
		}
	}

	/**
	 * Get the thread id for the current thread.
	 * @returns The thread id.
	 * @internal
	 */
	private getThreadId(): string {
		return isMainThread ? "main" : workerThreadId.toString();
	}
}
