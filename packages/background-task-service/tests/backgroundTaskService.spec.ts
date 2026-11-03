// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import os from "node:os";
import path from "node:path";
import type { IHealth } from "@3sixty/api-models";
import type { IBackgroundTask } from "@3sixty/background-task-models";
import { TaskStatus } from "@3sixty/background-task-models";
import { ContextIdKeys, ContextIdStore, type IContextIds } from "@3sixty/context";
import {
	ComponentFactory,
	Converter,
	DurationConstants,
	Factory,
	Is,
	RandomHelper
} from "@3sixty/core";
import {
	EntitySchemaFactory,
	EntitySchemaHelper,
	SortDirection,
	entity,
	property
} from "@3sixty/entity";
import { MemoryEntityStorageConnector } from "@3sixty/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@3sixty/entity-storage-models";
import type { ILogEntry } from "@3sixty/logging-models";
import { ModuleHelper } from "@3sixty/modules";
import { nameof } from "@3sixty/nameof";
import { BackgroundTaskService } from "../src/backgroundTaskService.js";
import type { BackgroundTask } from "../src/entities/backgroundTask.js";
import { initSchema } from "../src/schema.js";

let backgroundTaskEntityStorageConnector: MemoryEntityStorageConnector<BackgroundTask>;
let partitionedRecordStorage: MemoryEntityStorageConnector<PartitionedRecord>;
let activeServices: BackgroundTaskService[] = [];

@entity()
class PartitionedRecord {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value!: string;
}

interface ICallbackObservation {
	contextIds?: IContextIds;
	recordFound: boolean;
	taskStatus?: string;
}

interface ICallbackObservationHolder {
	current?: ICallbackObservation;
}

/**
 * Wait for status.
 * @param status The status to wait for.
 * @param itemIndex The item index to wait for.
 */
async function waitForStatus(status: string, itemIndex: number = 0): Promise<void> {
	const additionalItems = itemIndex * 2;
	for (let i = 0; i < 50 + additionalItems; i++) {
		if ((await backgroundTaskEntityStorageConnector.getStore())[itemIndex]?.status === status) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	console.debug(
		JSON.stringify((await backgroundTaskEntityStorageConnector.getStore())[itemIndex], null, 2)
	);
	throw new Error("Timeout waiting for status");
}

/**
 * Wait for the task store to reach a length.
 * @param length The store length to wait for.
 */
async function waitForStoreLength(length: number): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await backgroundTaskEntityStorageConnector.getStore()).length === length) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("Timeout waiting for store length");
}

/**
 * Read the in-memory dispatch count the service holds for a task.
 * @param service The service holding the counts.
 * @param taskId The id of the task, defaults to the first stored task.
 * @returns The dispatch count, or 0 when none is held.
 */
async function dispatchCountFor(service: BackgroundTaskService, taskId?: string): Promise<number> {
	const id = taskId ?? (await backgroundTaskEntityStorageConnector.getStore())[0]?.id;
	return dispatchCounts(service).get(id)?.count ?? 0;
}

/**
 * Read the in-memory dispatch count map the service holds.
 * @param service The service holding the counts.
 * @returns The dispatch count map.
 */
function dispatchCounts(
	service: BackgroundTaskService
): Map<string, { count: number; ts: number }> {
	return (
		service as unknown as {
			_dispatchCounts: Map<string, { count: number; ts: number }>;
		}
	)._dispatchCounts;
}

/**
 * Wait for a condition to become true.
 * @param predicate The condition to wait for.
 * @param message The error to throw on timeout.
 */
async function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if (predicate()) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(message);
}

/**
 * Wait for a task to reach a dispatch count.
 * @param service The service holding the counts.
 * @param dispatchCount The dispatch count to wait for.
 */
async function waitForDispatchCount(
	service: BackgroundTaskService,
	dispatchCount: number
): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await dispatchCountFor(service)) >= dispatchCount) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("Timeout waiting for dispatch count");
}

/**
 * Wait for error.
 * @param itemIndex The item index to wait for.
 */
async function waitForError(itemIndex: number = 0): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if ((await backgroundTaskEntityStorageConnector.getStore())[itemIndex]?.error) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("Timeout waiting for error");
}

/**
 * Wait for the state-change callback observation to be recorded.
 * @param observationHolder The mutable observation holder.
 */
async function waitForCallbackObservation(
	observationHolder: ICallbackObservationHolder
): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if (!Is.empty(observationHolder.current)) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("Timeout waiting for state-change callback");
}

interface ISpyCallCounter {
	mock: { calls: unknown[] };
}

interface ISpyCallArgsCounter {
	mock: { calls: unknown[][] };
}

/**
 * Wait for a spy to be called the expected number of times.
 * @param spyCallCounter The spy to wait for.
 * @param callCount The expected call count.
 */
async function waitForSpyCallCount(
	spyCallCounter: ISpyCallCounter,
	callCount: number
): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if (spyCallCounter.mock.calls.length >= callCount) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(
		`Timeout waiting for spy calls: expected ${callCount}, got ${spyCallCounter.mock.calls.length}`
	);
}

function makeService(
	options?: ConstructorParameters<typeof BackgroundTaskService>[0]
): BackgroundTaskService {
	const service = new BackgroundTaskService(options);
	activeServices.push(service);
	return service;
}

describe("BackgroundTaskService", () => {
	beforeAll(() => {
		initSchema();

		const mockRandom = vi.fn();

		let i = 0;
		mockRandom.mockImplementation(() => Converter.bytesToHex(new Uint8Array(16).fill(i++)));

		RandomHelper.generateUuidV7 = mockRandom;
	});

	beforeEach(() => {
		backgroundTaskEntityStorageConnector = new MemoryEntityStorageConnector<BackgroundTask>({
			entitySchema: nameof<BackgroundTask>(),
			config: { storageKey: "background-task" }
		});

		EntityStorageConnectorFactory.register(
			"background-task",
			() => backgroundTaskEntityStorageConnector
		);
	});

	afterEach(async () => {
		await Promise.all(activeServices.map(async s => s.stop().catch(() => {})));
		activeServices = [];
		await backgroundTaskEntityStorageConnector.teardown();
		await partitionedRecordStorage?.teardown();
	});

	test("can construct with dependencies", async () => {
		const backgroundTaskService = makeService();

		expect(backgroundTaskService).toBeDefined();
	});

	test("can create a task with no handler", async () => {
		const backgroundTaskService = makeService();

		await backgroundTaskService.start();
		const taskId = await backgroundTaskService.create("my-type");
		expect(taskId.split(":")[0]).toEqual("background-task");
		expect(taskId.split(":")[1]).toEqual("entity-storage");

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				retainFor: 0,
				status: "pending",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and no retainment", async () => {
		const backgroundTaskService = makeService();

		await backgroundTaskService.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskService.start();
		await backgroundTaskService.create("my-type", { counter: 0 });

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "01010101010101010101010101010101",
				payload: {
					counter: 0
				},
				retainFor: 0,
				status: "pending",
				threadId: "main",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and retainment", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start();
		await backgroundTaskConnector.create("my-type", { counter: 0 }, { retainFor: 10000 });

		await waitForStatus("success");

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "02020202020202020202020202020202",
				payload: {
					counter: 0
				},
				result: {
					counter: 1
				},
				status: "success",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and retainment with error and no retries", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start();
		await backgroundTaskConnector.create(
			"my-type",
			{ throw: true, counter: 0 },
			{ retainFor: 10000 }
		);

		await waitForStatus("failed");

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				type: "my-type",
				status: "failed",
				payload: {
					counter: 0,
					throw: true
				},
				error: {
					name: "Error",
					message: "error"
				}
			}
		]);
	});

	test("can create a task with handler and retainment with error and single retry", async () => {
		const backgroundTaskConnector = makeService();

		const data = {
			throw: true,
			counter: 0
		};
		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start();
		await backgroundTaskConnector.create("my-type", data, {
			retainFor: 10000,
			retryCount: 1,
			retryInterval: 2000
		});

		await waitForError();

		let store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				type: "my-type",
				retryInterval: 2000,
				status: "pending",
				payload: {
					counter: 0,
					throw: true
				},
				error: {
					name: "Error",
					message: "error"
				}
			}
		]);

		if (store[0]?.payload) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(store[0].payload as any).throw = false;
			await backgroundTaskEntityStorageConnector.set(store[0]);
		}

		const taskUrn = `background-task:entity-storage:${store[0].id}`;
		const task = await backgroundTaskConnector.get(taskUrn);
		expect(task).toBeDefined();
		expect(task?.id).toEqual(taskUrn);

		await waitForStatus("success");

		store = await backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				type: "my-type",
				status: "success",
				payload: {
					counter: 0,
					throw: false
				},
				result: {
					counter: 1,
					throw: false
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start();

		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create("my-type", { id: i, counter: i }, { retainFor: 10000 });
		}

		await waitForStatus("success", 4);

		const store = await backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					id: 0,
					counter: 1
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					id: 1,
					counter: 2
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 2,
					counter: 2
				},
				result: {
					id: 2,
					counter: 3
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 3,
					counter: 3
				},
				result: {
					id: 3,
					counter: 4
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 4,
					counter: 4
				},
				result: {
					id: 4,
					counter: 5
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order, when one item fails and no retry", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start();
		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create(
				"my-type",
				{ id: i, counter: i, throw: i === 2 },
				{ retainFor: 10000 }
			);
		}

		await waitForStatus("success", 4);

		const store = await backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					id: 0,
					counter: 1
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					id: 1,
					counter: 2
				}
			},
			{
				type: "my-type",
				status: "failed",
				payload: {
					id: 2,
					counter: 2
				},
				error: {
					name: "Error",
					message: "error"
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 3,
					counter: 3
				},
				result: {
					id: 3,
					counter: 4
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 4,
					counter: 4
				},
				result: {
					id: 4,
					counter: 5
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order, when one item fails and retry", async () => {
		const backgroundTaskConnector = makeService({
			config: { taskInterval: 500 }
		});

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start();
		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create(
				"my-type",
				{ id: i, counter: 0, throw: i === 2 },
				{ retainFor: 10000, retryCount: 1, retryInterval: 3000 }
			);
		}

		await waitForError(2);
		const store2 = await backgroundTaskEntityStorageConnector.getStore();
		if (store2[2]?.payload) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(store2[2].payload as any).throw = false;
			await backgroundTaskEntityStorageConnector.set(store2[2]);
		}
		await waitForStatus("success", 2);

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					id: 0,
					counter: 1
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 1,
					counter: 0
				},
				result: {
					id: 1,
					counter: 1
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 2,
					counter: 0
				},
				result: {
					id: 2,
					counter: 1
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 3,
					counter: 0
				},
				result: {
					id: 3,
					counter: 1
				}
			},
			{
				type: "my-type",
				status: "success",
				payload: {
					id: 4,
					counter: 0
				},
				result: {
					id: 4,
					counter: 1
				}
			}
		]);

		const completedOrder = await backgroundTaskConnector.query(
			"my-type",
			"success",
			"dateCompleted",
			SortDirection.Ascending
		);
		expect(completedOrder.entities.length).toBe(5);
		expect(completedOrder.entities[0].payload?.id).toBe(0);
		expect(completedOrder.entities[1].payload?.id).toBe(1);
		expect(completedOrder.entities[2].payload?.id).toBe(3);
		expect(completedOrder.entities[3].payload?.id).toBe(4);
		expect(completedOrder.entities[4].payload?.id).toBe(2);
		for (const ent of completedOrder.entities) {
			expect(ent.id).toMatch(/^background-task:entity-storage:/);
		}
	});

	test("can create a task and cancel it", async () => {
		const backgroundTaskConnector = makeService({
			config: { taskInterval: DurationConstants.MsPerSecond }
		});

		await backgroundTaskConnector.start();
		const id = await backgroundTaskConnector.create(
			"my-type",
			{ counter: 0 },
			{ retryCount: 10, retryInterval: 10000, retainFor: 10000 }
		);

		await backgroundTaskConnector.cancel(id);

		const store = await backgroundTaskEntityStorageConnector.getStore();

		expect(store[0].status).toEqual("cancelled");
		expect(store[0].dateCancelled).toBeDefined();
	});

	test("get() and state-change callback both return task id in URN form", async () => {
		const backgroundTaskService = makeService();
		let callbackTaskId: string | undefined;

		await backgroundTaskService.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod",
			async (task: IBackgroundTask) => {
				if (task.status === TaskStatus.Success) {
					callbackTaskId = task.id;
				}
			},
			{ idleShutdownTimeout: -1 }
		);

		await backgroundTaskService.start();
		const taskId = await backgroundTaskService.create(
			"my-type",
			{ counter: 0 },
			{ retainFor: 10000 }
		);

		await waitForStatus("success");
		await new Promise(resolve => setTimeout(resolve, 100));

		const task = await backgroundTaskService.get(taskId);
		expect(task?.id).toEqual(taskId);
		expect(callbackTaskId).toEqual(taskId);
	});

	test("can cleanup retained items when passed their retained date", async () => {
		const backgroundTaskConnector = makeService({
			config: { taskInterval: DurationConstants.MsPerSecond }
		});

		const now = Date.now();
		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			threadId: "main",
			dateCreated: new Date(now - DurationConstants.MsPerSecond).toISOString(),
			dateModified: new Date(now - DurationConstants.MsPerSecond).toISOString(),
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			},
			retainUntil: now - 100
		});

		await backgroundTaskConnector.start();

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(0);
	});

	test("can not cleanup retained items when their retained date has not yet passed", async () => {
		const backgroundTaskConnector = makeService({
			config: { taskInterval: DurationConstants.MsPerSecond }
		});

		const now = Date.now();
		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			threadId: "main",
			dateCreated: new Date(now).toISOString(),
			dateModified: new Date(now).toISOString(),
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			},
			retainUntil: now + 5000
		});

		await backgroundTaskConnector.start();

		await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(1);
	});

	test("can not cleanup retained items when no retained date set", async () => {
		const backgroundTaskConnector = makeService({
			config: { taskInterval: DurationConstants.MsPerSecond }
		});

		const now = Date.now();
		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			threadId: "main",
			dateCreated: new Date(now).toISOString(),
			dateModified: new Date(now).toISOString(),
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			}
		});

		await backgroundTaskConnector.start();

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(1);
	});

	test("can start a clone of the engine in the background task", async () => {
		const backgroundTaskConnector = makeService({
			config: { taskInterval: DurationConstants.MsPerSecond }
		});

		Factory.createFactory<{ getCloneData: () => unknown }>("engine-core").register(
			"engine",
			() => ({ getCloneData: () => ({ foo: "bar" }) })
		);

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodWithEngine"
		);

		await backgroundTaskConnector.create("my-type", { counter: 1 }, { retainFor: 10000 });
		await backgroundTaskConnector.start();

		await waitForStatus("success");

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				payload: {
					counter: 1
				},
				result: {
					counter: 2,
					engineCloneData: { foo: "bar" }
				},
				status: "success",
				type: "my-type"
			}
		]);
	});

	test("can add task to a handler with init and shutdown methods", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod",
			undefined,
			{
				initialiseMethod: "testMethodInitialise",
				shutdownMethod: "testMethodShutdown"
			}
		);

		await backgroundTaskConnector.start();

		await backgroundTaskConnector.create("my-type", { counter: 1 }, { retainFor: 10000 });

		await waitForStatus("success", 0);
	});

	test("can add task to a handler with multiple threads", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodThreading",
			undefined,
			{
				maxWorkerCount: 5
			}
		);

		await backgroundTaskConnector.start();

		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create("my-type", { counter: i }, { retainFor: 10000 });
		}

		await waitForStatus("success", 4);

		const store = await backgroundTaskEntityStorageConnector.getStore();

		const workerThreadIds = new Set();
		for (const item of store) {
			workerThreadIds.add(item.result);
		}
		expect(Array.from(workerThreadIds).length).toEqual(5);
	});

	test("can add task to a handler with no termination on idle", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodNonIdleTerminate",
			undefined,
			{
				idleShutdownTimeout: -1
			}
		);

		await backgroundTaskConnector.start();

		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create("my-type", { counter: i }, { retainFor: 10000 });
		}

		await waitForStatus("success", 4);

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store[4].result).toEqual(5);
	});

	test("dispatches a single task once when multiple workers are idle", async () => {
		const backgroundTaskConnector = makeService();
		const observedTransitions: string[] = [];

		await backgroundTaskConnector.registerHandler(
			"idle-fanout-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodSlow",
			async task => {
				if (task.id === targetTaskId) {
					observedTransitions.push(task.status);
				}
			},
			{
				maxWorkerCount: 2,
				idleShutdownTimeout: -1
			}
		);

		await backgroundTaskConnector.start();

		// Warm up both workers so they exist and are simultaneously idle.
		await backgroundTaskConnector.create("idle-fanout-type", { counter: 0 }, { retainFor: 10000 });
		await backgroundTaskConnector.create("idle-fanout-type", { counter: 0 }, { retainFor: 10000 });
		await waitForStatus("success", 1);

		const serviceInternals = backgroundTaskConnector as unknown as {
			_workers: { [workerId: string]: unknown };
		};
		expect(Object.keys(serviceInternals._workers)).toHaveLength(2);

		const targetTaskId = await backgroundTaskConnector.create(
			"idle-fanout-type",
			{ counter: 0 },
			{ retainFor: 10000 }
		);
		await waitForStatus("success", 2);

		// Allow any erroneous duplicate dispatch to complete before assertions.
		await new Promise(resolve => setTimeout(resolve, 700));

		expect(observedTransitions.filter(status => status === TaskStatus.Processing)).toHaveLength(1);
		expect(observedTransitions.filter(status => status === TaskStatus.Success)).toHaveLength(1);
	});

	test("does not dispatch the same task twice when two processing cycles overlap on the first activity (#177)", async () => {
		const backgroundTaskConnector = makeService();

		// The state-change callback runs on the main thread, so it observes every
		// transition. Counting Success transitions detects a duplicate dispatch even when
		// the duplicate runs on a second worker thread (where a module-level counter would
		// not be shared).
		let successCount = 0;

		await backgroundTaskConnector.start();

		// Reproduce the reporter's first-activity ordering: create() schedules a
		// processTaskType run (via setTimeout), then registerHandler() triggers one
		// immediately. Both target the same pending task; a slow worker method keeps it
		// in-progress so the scheduled run overlaps the just-dispatched one, and
		// maxWorkerCount > 1 lets a second worker be created. Before the fix this
		// dispatched the task twice.
		await backgroundTaskConnector.create("race-type", { counter: 0 }, { retainFor: 10000 });
		await backgroundTaskConnector.registerHandler(
			"race-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodSlow",
			async task => {
				if (task.status === "success") {
					successCount++;
				}
			},
			{
				maxWorkerCount: 2,
				idleShutdownTimeout: -1
			}
		);

		await waitForStatus("success", 0);
		// Settle: allow any erroneous second dispatch (scheduled ~100ms after create) to
		// run to completion before asserting.
		await new Promise(resolve => setTimeout(resolve, 500));

		// The task must have completed exactly once, and there must be a single task row.
		expect(successCount).toEqual(1);
		expect((await backgroundTaskEntityStorageConnector.getStore()).length).toEqual(1);
	});

	test("releases in-flight claim on dispatch error so the task can be retried", async () => {
		// Regression for Bug 1: workerProcessTasks can throw (e.g. storage failure)
		// between _inFlightTaskIds.add and the worker actually starting. Without a
		// try/finally the claim is never released and the task is permanently skipped.
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"retry-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod",
			undefined,
			{ maxWorkerCount: 2, idleShutdownTimeout: -1 }
		);
		await backgroundTaskConnector.start();

		// Create the task first so the storage write from create() completes before
		// the spy is installed - any subsequent set() call comes from workerProcessTasks.
		await backgroundTaskConnector.create("retry-type", { counter: 0 }, { retainFor: 10000 });

		// Throw exactly once on the next set() call (the "set status to Processing"
		// write). Without Fix 1 the task ID leaks into _inFlightTaskIds permanently.
		vi.spyOn(backgroundTaskEntityStorageConnector, "set").mockImplementationOnce(async () => {
			throw new Error("transient storage error");
		});

		// Let the 100ms dispatch timer fire and the single-throw spy be consumed.
		await new Promise(resolve => setTimeout(resolve, 200));

		// Trigger a fresh processTaskType cycle; with Fix 1 the in-flight claim was
		// released in the finally block so the task is picked up and succeeds.
		await backgroundTaskConnector.create("retry-type", { counter: 0 }, { retainFor: 10000 });

		await waitForStatus("success", 0);
		await waitForStatus("success", 1);

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store[0].status).toEqual("success");
		expect(store[1].status).toEqual("success");

		vi.restoreAllMocks();
	});

	test("per-type in-flight tracking does not inflate the candidate query for unrelated task types", async () => {
		// Regression for Bug 3: getNextTask used _inFlightTaskIds.size (global count)
		// as the query limit, so in-flight tasks of type A inflated the fetch for
		// type B. With Fix 3 the limit is per-type, so each query fetches exactly
		// (in-flight-for-type + 1) candidates regardless of other types.
		const backgroundTaskConnector = makeService();

		// Slow type - blocks workers so _inFlightTaskIds grows for "slow-type".
		await backgroundTaskConnector.registerHandler(
			"slow-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodSlow",
			undefined,
			{ maxWorkerCount: 3, idleShutdownTimeout: -1 }
		);
		// Fast type - must be dispatched promptly regardless of slow-type in-flight count.
		await backgroundTaskConnector.registerHandler(
			"fast-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod",
			undefined,
			{ idleShutdownTimeout: -1 }
		);

		await backgroundTaskConnector.start();

		// Fill the slow-type in-flight set with 3 concurrent entries.
		await backgroundTaskConnector.create("slow-type", {}, { retainFor: 10000 });
		await backgroundTaskConnector.create("slow-type", {}, { retainFor: 10000 });
		await backgroundTaskConnector.create("slow-type", {}, { retainFor: 10000 });

		// Allow time for slow tasks to be dispatched and added to _inFlightTaskIds.
		await new Promise(resolve => setTimeout(resolve, 200));

		// Create the fast task; the fast-type in-flight set is empty so the query
		// limit should be 1 (not 4 as the old global-size code would produce).
		// Either way the task must be dispatched and succeed.
		await backgroundTaskConnector.create("fast-type", { counter: 0 }, { retainFor: 10000 });

		// Fast task is store index 3 (three slow tasks were created first).
		await waitForStatus("success", 3);
		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store[3].status).toEqual("success");
	});

	test("can propogate context ids to background task", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodContextIds",
			undefined,
			{
				idleShutdownTimeout: -1
			}
		);

		await backgroundTaskConnector.start();

		await ContextIdStore.run({ testContextId: "12345" }, async () => {
			await backgroundTaskConnector.create("my-type", { counter: 0 }, { retainFor: 10000 });
		});

		await waitForStatus("success", 0);

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store[0].result).toEqual({ testContextId: "12345" });
	});

	test("can handle multiple tasks at the same time", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type-1",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodThreading"
		);
		await backgroundTaskConnector.registerHandler(
			"my-type-2",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodThreading"
		);

		await backgroundTaskConnector.start();

		await backgroundTaskConnector.create("my-type-1", { counter: 0 }, { retainFor: 10000 });
		await backgroundTaskConnector.create("my-type-2", { counter: 0 }, { retainFor: 10000 });

		await waitForStatus("success", 1);

		const store = await backgroundTaskEntityStorageConnector.getStore();
		const workerThreadIds = new Set();
		for (const item of store) {
			workerThreadIds.add(item.result);
		}
		expect(Array.from(workerThreadIds).length).toEqual(2);
	});

	test("can use the maximum number of threads", async () => {
		const backgroundTaskConnector = makeService();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodThreadingSleep",
			undefined,
			{
				maxWorkerCount: -1,
				idleShutdownTimeout: -1
			}
		);

		await backgroundTaskConnector.start();

		const systemWorkerCount = os.cpus().length;
		const numberItems = systemWorkerCount * 2;

		for (let i = 0; i < numberItems; i++) {
			await backgroundTaskConnector.create(
				"my-type",
				{ counter: i },
				{ retainFor: numberItems * DurationConstants.MsPerSecond }
			);
		}

		await waitForStatus("success", numberItems - 1);

		const store = await backgroundTaskEntityStorageConnector.getStore();
		const workerThreadIds = new Set();
		for (const item of store) {
			workerThreadIds.add(item.result);
		}

		expect(Array.from(workerThreadIds).length).toBeGreaterThan(0);
		expect(Array.from(workerThreadIds).length).toBeLessThanOrEqual(systemWorkerCount);
	});

	test("releases worker and reschedules once when task finalisation throws", async () => {
		const backgroundTaskService = makeService();
		const serviceInternals = backgroundTaskService as unknown as {
			_workers: { [workerId: string]: { worker: { task?: unknown } } };
			scheduleNextTaskProcessing(taskType: string): void;
		};

		await backgroundTaskService.registerHandler(
			"finalisation-failure",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod",
			undefined,
			{ idleShutdownTimeout: -1 }
		);

		await backgroundTaskService.start();

		const scheduleSpy = vi.spyOn(serviceInternals, "scheduleNextTaskProcessing");
		const originalSet = backgroundTaskEntityStorageConnector.set.bind(
			backgroundTaskEntityStorageConnector
		);
		const setSpy = vi
			.spyOn(backgroundTaskEntityStorageConnector, "set")
			.mockImplementation(async (taskEntity: BackgroundTask) => {
				if (taskEntity.status === TaskStatus.Success) {
					throw new Error("finalisation storage failed");
				}
				return originalSet(taskEntity);
			});

		await backgroundTaskService.create(
			"finalisation-failure",
			{ counter: 0 },
			{ retainFor: 10_000 }
		);

		await waitForSpyCallCount(scheduleSpy, 1);
		expect(scheduleSpy).toHaveBeenCalledWith("finalisation-failure");

		for (const workerEntry of Object.values(serviceInternals._workers)) {
			expect(workerEntry.worker.task).toBeUndefined();
		}

		setSpy.mockRestore();
		scheduleSpy.mockClear();

		await backgroundTaskService.create(
			"finalisation-failure",
			{ counter: 1 },
			{ retainFor: 10_000 }
		);

		await waitForStatus(TaskStatus.Success, 1);
		await waitForSpyCallCount(scheduleSpy, 1);

		scheduleSpy.mockRestore();
	});

	describe("worker cap retry", () => {
		/**
		 * Wait for at least the given number of scheduleNextTaskProcessing calls for one type.
		 * @param spy The spy on scheduleNextTaskProcessing.
		 * @param taskType The task type to filter calls for.
		 * @param callCount The expected call count for that type.
		 */
		async function waitForFilteredSpyCallCount(
			spy: ISpyCallArgsCounter,
			taskType: string,
			callCount: number
		): Promise<void> {
			for (let i = 0; i < 50; i++) {
				if (spy.mock.calls.filter(call => call[0] === taskType).length >= callCount) {
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			throw new Error(
				`Timeout waiting for ${callCount} scheduleNextTaskProcessing calls for "${taskType}"`
			);
		}

		/**
		 * Wait for at least the given number of system workers to exist.
		 * @param workers The service's internal worker map.
		 * @param count The expected worker count.
		 */
		async function waitForWorkerCount(
			workers: { [workerId: string]: unknown },
			count: number
		): Promise<void> {
			for (let i = 0; i < 50; i++) {
				if (Object.keys(workers).length >= count) {
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			throw new Error(`Timeout waiting for ${count} workers to be created`);
		}

		/**
		 * Build a service with both system worker slots held (one permanently by type A, one by
		 * type B) and a third type C registered but starved for the rest of the test.
		 * @param loggingComponentType The logging component type to pass to the service, if any.
		 * @param bHoldMs How long type B's task runs before its slot frees.
		 * @returns The service and its internals cast for scheduleNextTaskProcessing spying.
		 */
		async function makeStarvedService(
			loggingComponentType?: string,
			bHoldMs = 3000
		): Promise<{
			backgroundTaskService: BackgroundTaskService;
			serviceInternals: {
				_workers: { [workerId: string]: unknown };
				_taskHandlers: {
					[taskType: string]: {
						capReachedCount?: number;
						capReachedLastLoggedMs?: number;
						waitTimerId?: unknown;
						workers: unknown[];
					};
				};
				scheduleNextTaskProcessing(taskType: string, delayMs?: number): void;
			};
		}> {
			const backgroundTaskService = makeService({
				loggingComponentType,
				config: { maxSystemWorkerCount: 2, taskInterval: 100 }
			});
			const serviceInternals = backgroundTaskService as unknown as {
				_workers: { [workerId: string]: unknown };
				_taskHandlers: {
					[taskType: string]: {
						capReachedCount?: number;
						capReachedLastLoggedMs?: number;
						waitTimerId?: unknown;
						workers: unknown[];
					};
				};
				scheduleNextTaskProcessing(taskType: string, delayMs?: number): void;
			};

			await backgroundTaskService.registerHandler(
				"A",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod",
				undefined,
				{ idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create("A", { counter: 0 }, { retainFor: 10_000 });
			await waitForStatus(TaskStatus.Success, 0);

			await backgroundTaskService.registerHandler(
				"B",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethodConfigurableSlow"
			);
			await backgroundTaskService.create("B", { ms: bHoldMs }, { retainFor: 10_000 });

			// Both slots are only actually held once B's worker exists, not merely once its task
			// is queued; waiting on the count itself avoids guessing how long that takes.
			await waitForWorkerCount(serviceInternals._workers, 2);

			await backgroundTaskService.registerHandler(
				"C",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod"
			);

			return { backgroundTaskService, serviceInternals };
		}

		test("backs off the retry wait after repeated cap-reached retries for the same type", async () => {
			const { backgroundTaskService, serviceInternals } = await makeStarvedService();
			const scheduleSpy = vi.spyOn(serviceInternals, "scheduleNextTaskProcessing");

			try {
				await backgroundTaskService.create("C", { counter: 0 }, { retainFor: 10_000 });
				await waitForFilteredSpyCallCount(scheduleSpy, "C", 4);

				const delays = scheduleSpy.mock.calls
					.filter(call => call[0] === "C")
					.slice(0, 4)
					.map(call => call[1]);

				expect(delays).toEqual([100, 200, 400, 800]);
			} finally {
				scheduleSpy.mockRestore();
			}
		});

		test("rate-limits the max system worker count warning while a type stays starved", async () => {
			const logEntries: ILogEntry[] = [];
			ComponentFactory.register("logging", () => ({
				className: () => "MockLoggingComponent",
				log: async (entry: ILogEntry) => {
					logEntries.push(entry);
				}
			}));

			try {
				const { backgroundTaskService, serviceInternals } = await makeStarvedService("logging");
				const scheduleSpy = vi.spyOn(serviceInternals, "scheduleNextTaskProcessing");

				try {
					const stalledEntries = (): ILogEntry[] =>
						logEntries.filter(entry => entry.message === "maxSystemWorkerCountReached");

					await backgroundTaskService.create("C", { counter: 0 }, { retainFor: 10_000 });
					await waitForFilteredSpyCallCount(scheduleSpy, "C", 2);

					expect(stalledEntries()).toHaveLength(1);
					expect(stalledEntries()[0].data).toMatchObject({
						type: "C",
						maxSystemWorkerCount: 2,
						count: 1
					});

					// Backdate the last-logged time as if the rate-limit window had already
					// elapsed, so the next check logs again instead of waiting a real minute;
					// this is what proves the limit is time-based, not "once per type ever".
					serviceInternals._taskHandlers.C.capReachedLastLoggedMs =
						Date.now() - DurationConstants.MsPerMinute;
					await waitForFilteredSpyCallCount(scheduleSpy, "C", 5);

					expect(stalledEntries()).toHaveLength(2);
					expect((stalledEntries()[1].data as { count: number }).count).toBeGreaterThan(1);
				} finally {
					scheduleSpy.mockRestore();
				}
			} finally {
				ComponentFactory.unregister("logging");
			}
		});

		test("cap-reached retry wait never drops below a configured taskInterval larger than the cap", () => {
			const backgroundTaskService = makeService({ config: { taskInterval: 10_000 } });
			const serviceInternals = backgroundTaskService as unknown as {
				capReachedWaitMs(consecutiveCount: number): number;
			};

			// The uncapped backoff (10_000, 20_000, 40_000...) always exceeds
			// _MAX_CAP_REACHED_WAIT, so without the floor these would come back as 5000.
			expect(serviceInternals.capReachedWaitMs(1)).toEqual(10_000);
			expect(serviceInternals.capReachedWaitMs(3)).toEqual(10_000);
		});

		test("claims a freed slot within a task interval instead of waiting out its backoff", async () => {
			// B's hold (4000ms) is deliberately past C's 5th unwaked retry (cumulative 3100ms,
			// the same schedule T1 asserts) so a coincidental alignment between the two can't
			// make this pass without the fix; C's next retry after that is at 6300ms.
			const { backgroundTaskService, serviceInternals } = await makeStarvedService(undefined, 4000);

			await backgroundTaskService.create("C", { counter: 0 }, { retainFor: 10_000 });

			let slotFreedAt: number | undefined;
			let cWorkerAt: number | undefined;
			for (let i = 0; i < 900; i++) {
				if (!slotFreedAt && Object.keys(serviceInternals._workers).length < 2) {
					slotFreedAt = Date.now();
				}
				if (!cWorkerAt && serviceInternals._taskHandlers.C.workers.length >= 1) {
					cWorkerAt = Date.now();
				}
				if (slotFreedAt && cWorkerAt) {
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			if (!slotFreedAt || !cWorkerAt) {
				throw new Error("Timeout waiting for B's slot to free and C to get a worker");
			}

			// One to five taskIntervals: robust to runner jitter, but nowhere near the
			// multi-second backoff C would otherwise still be waiting out.
			expect(cWorkerAt - slotFreedAt).toBeLessThan(500);
		});

		test("does not arm a retry for a starved type while stopping", async () => {
			const { backgroundTaskService, serviceInternals } = await makeStarvedService();
			const scheduleSpy = vi.spyOn(serviceInternals, "scheduleNextTaskProcessing");

			try {
				await backgroundTaskService.create("C", { counter: 0 }, { retainFor: 10_000 });
				await waitForFilteredSpyCallCount(scheduleSpy, "C", 1);
				const callsBeforeStop = scheduleSpy.mock.calls.filter(call => call[0] === "C").length;

				// stop() clears every handler's own timer regardless, including C's, so that
				// alone would pass even without the guard; what the guard actually prevents is
				// A and B's own cleanup (which stop() also triggers) waking C back up, which
				// would show up as an extra call for C here.
				await backgroundTaskService.stop();

				const callsAfterStop = scheduleSpy.mock.calls.filter(call => call[0] === "C").length;
				expect(callsAfterStop).toEqual(callsBeforeStop);
				expect(serviceInternals._taskHandlers.C.waitTimerId).toBeUndefined();
			} finally {
				scheduleSpy.mockRestore();
			}
		});

		test("backs off again when it loses the race for a freed slot", async () => {
			// B holds its slot only briefly, so the race happens on C and D's first or second
			// cap-reached check, before their own backoff has grown large enough to make the
			// loser's next wait slow to observe.
			const { backgroundTaskService, serviceInternals } = await makeStarvedService(undefined, 350);
			const scheduleSpy = vi.spyOn(serviceInternals, "scheduleNextTaskProcessing");

			try {
				// C and D keep whichever worker they win (idleShutdownTimeout: -1): once one
				// wins, its instant task finishing does not free the slot again and start a
				// second race, so there is exactly one winner and one loser to inspect.
				await backgroundTaskService.registerHandler(
					"D",
					`file://${path.join(__dirname, "testModule.js")}`,
					"testMethod",
					undefined,
					{ idleShutdownTimeout: -1 }
				);
				await backgroundTaskService.unregisterHandler("C");
				await backgroundTaskService.registerHandler(
					"C",
					`file://${path.join(__dirname, "testModule.js")}`,
					"testMethod",
					undefined,
					{ idleShutdownTimeout: -1 }
				);
				await backgroundTaskService.create("C", { counter: 0 }, { retainFor: 10_000 });
				await backgroundTaskService.create("D", { counter: 0 }, { retainFor: 10_000 });

				let loser: "C" | "D" | undefined;
				for (let i = 0; i < 400; i++) {
					const cWon = serviceInternals._taskHandlers.C.workers.length >= 1;
					const dWon = serviceInternals._taskHandlers.D.workers.length >= 1;
					if (cWon || dWon) {
						loser = cWon ? "D" : "C";
						break;
					}
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				if (!loser) {
					throw new Error("Timeout waiting for either C or D to get a worker");
				}
				const loserCountAtRelease = serviceInternals._taskHandlers[loser].capReachedCount ?? 0;

				// The loser keeps being woken and keeps losing (the winner holds its slot for
				// the rest of the test), so its count must keep climbing rather than reset.
				let loserCountAfterAnotherLoss: number | undefined;
				for (let i = 0; i < 200; i++) {
					const count = serviceInternals._taskHandlers[loser].capReachedCount;
					if (count !== undefined && count > loserCountAtRelease) {
						loserCountAfterAnotherLoss = count;
						break;
					}
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				if (loserCountAfterAnotherLoss === undefined) {
					throw new Error(`Timeout waiting for "${loser}" to back off again after losing`);
				}

				const loserCalls = scheduleSpy.mock.calls.filter(call => call[0] === loser);
				const lastNumericDelay = loserCalls
					.map(call => call[1])
					.reverse()
					.find(delay => Is.number(delay));
				expect(lastNumericDelay).toBeDefined();
				expect(loserCountAfterAnotherLoss).toBeGreaterThan(loserCountAtRelease);
			} finally {
				scheduleSpy.mockRestore();
			}
		});
	});

	describe("state-change callback context", () => {
		const TENANT_A = "tenant-org-a";
		const TENANT_B = "tenant-org-b";
		const RECORD_ID = "record-under-tenant-a";

		beforeAll(() => {
			EntitySchemaFactory.register(nameof<PartitionedRecord>(), () =>
				EntitySchemaHelper.getSchema(PartitionedRecord)
			);
		});

		beforeEach(() => {
			partitionedRecordStorage = new MemoryEntityStorageConnector<PartitionedRecord>({
				entitySchema: nameof<PartitionedRecord>(),
				partitionContextIds: [ContextIdKeys.Tenant],
				config: { storageKey: "partitioned-record" }
			});
		});

		afterEach(async () => {
			const contextStorage = await ContextIdStore.getStorage();
			contextStorage.enterWith({});
			await partitionedRecordStorage.teardown();
		});

		test("task entity stores creation tenant contextIds", async () => {
			const backgroundTaskService = makeService();

			await backgroundTaskService.start();

			await ContextIdStore.run({ [ContextIdKeys.Tenant]: TENANT_A }, async () => {
				await backgroundTaskService.create("context-capture", { recordId: RECORD_ID });
			});

			const storedTask = (await backgroundTaskEntityStorageConnector.getStore())[0];
			expect(storedTask.contextIds).toEqual({ [ContextIdKeys.Tenant]: TENANT_A });
		});

		test("state-change callback reads context-partitioned storage under task tenant", async () => {
			const backgroundTaskService = makeService();
			const observation: ICallbackObservationHolder = {};

			await backgroundTaskService.registerHandler<{ recordId: string }, { ok: boolean }>(
				"partitioned-finalise",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod",
				async (task: IBackgroundTask<{ recordId: string }, { ok: boolean }>) => {
					if (task.status !== TaskStatus.Success) {
						return;
					}

					const contextIds = await ContextIdStore.getContextIds();
					const record = await partitionedRecordStorage.get(task.payload?.recordId ?? "");
					observation.current = {
						contextIds,
						recordFound: Is.object(record),
						taskStatus: task.status
					};
				},
				{ idleShutdownTimeout: -1 }
			);

			await backgroundTaskService.start();

			await ContextIdStore.run({ [ContextIdKeys.Tenant]: TENANT_A }, async () => {
				await partitionedRecordStorage.set({
					id: RECORD_ID,
					value: "created-under-tenant-a"
				});
				await backgroundTaskService.create(
					"partitioned-finalise",
					{ recordId: RECORD_ID },
					{ retainFor: 10_000 }
				);
			});

			// Simulate a concurrent main-thread request for tenant B while the worker completes.
			const contextStorage = await ContextIdStore.getStorage();
			contextStorage.enterWith({ [ContextIdKeys.Tenant]: TENANT_B });

			await waitForStatus(TaskStatus.Success);
			await waitForCallbackObservation(observation);

			const storedTask = (await backgroundTaskEntityStorageConnector.getStore())[0];
			expect(storedTask.contextIds).toEqual({ [ContextIdKeys.Tenant]: TENANT_A });
			expect(observation.current?.taskStatus).toEqual(TaskStatus.Success);
			expect(observation.current?.contextIds?.[ContextIdKeys.Tenant]).toEqual(TENANT_A);
			expect(observation.current?.recordFound).toBe(true);
		});

		test("state-change callback errors are caught and not unhandled rejections", async () => {
			const backgroundTaskService = makeService();

			const unhandledRejections: unknown[] = [];
			const onUnhandledRejection = (reason: unknown): void => {
				unhandledRejections.push(reason);
			};
			process.on("unhandledRejection", onUnhandledRejection);

			try {
				await backgroundTaskService.registerHandler(
					"throwing-callback",
					`file://${path.join(__dirname, "testModule.js")}`,
					"testMethod",
					async (task: IBackgroundTask) => {
						if (task.status === TaskStatus.Success) {
							throw new Error("state-change callback failed");
						}
					},
					{ idleShutdownTimeout: -1 }
				);

				await backgroundTaskService.start();
				await backgroundTaskService.create(
					"throwing-callback",
					{ counter: 0 },
					{ retainFor: 10_000 }
				);

				await waitForStatus(TaskStatus.Success);
				await new Promise(resolve => setTimeout(resolve, 300));

				expect(unhandledRejections).toHaveLength(0);
			} finally {
				process.off("unhandledRejection", onUnhandledRejection);
			}
		});
	});

	describe("worker thread lifecycle", () => {
		test("terminates worker thread after task completes with idleShutdownTimeout 0", async () => {
			const terminateSpy = vi.fn().mockResolvedValue(0);
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const worker = originalFn(module, completed, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						terminateSpy();
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			await backgroundTaskService.registerHandler(
				"terminate-type",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod"
				// idleShutdownTimeout defaults to 0 - immediate cleanup after each task
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create("terminate-type", { counter: 0 }, { retainFor: 10000 });

			await waitForStatus("success");

			// Bug 1: without the fix, cleanupWorker() never calls terminate()
			expect(terminateSpy).toHaveBeenCalledOnce();

			vi.restoreAllMocks();
			await backgroundTaskService.stop();
		});

		test("terminates worker threads when stop() is called", async () => {
			const terminateSpy = vi.fn().mockResolvedValue(0);
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const worker = originalFn(module, completed, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						terminateSpy();
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			await backgroundTaskService.registerHandler(
				"stop-type",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod",
				undefined,
				{ idleShutdownTimeout: -1 } // keep alive - worker survives the task
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create("stop-type", { counter: 0 }, { retainFor: 10000 });

			await waitForStatus("success");

			// Worker is still alive (idleShutdownTimeout: -1), terminate not yet called
			expect(terminateSpy).not.toHaveBeenCalled();

			// Bug 2: without the fix, stop() never calls terminate()
			await backgroundTaskService.stop();
			expect(terminateSpy).toHaveBeenCalledOnce();

			vi.restoreAllMocks();
		});

		test("stop() invokes shutdownMethod before terminating workers", async () => {
			let shutdownMethodCompleted = false;
			const terminateSpy = vi.fn().mockResolvedValue(0);
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const wrappedCompleted = async (
						operation: string,
						result?: unknown,
						err?: Error
					): Promise<void> => {
						if (operation === "testMethodShutdown") {
							shutdownMethodCompleted = true;
						}
						return completed(operation, result, err);
					};
					const worker = originalFn(module, wrappedCompleted, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						terminateSpy();
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			await backgroundTaskService.registerHandler(
				"graceful-stop-type",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod",
				undefined,
				{
					idleShutdownTimeout: -1,
					shutdownMethod: "testMethodShutdown"
				}
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create(
				"graceful-stop-type",
				{ counter: 0 },
				{ retainFor: 10000 }
			);

			await waitForStatus("success");

			// Worker is still alive (idleShutdownTimeout: -1); shutdownMethod not yet called
			expect(shutdownMethodCompleted).toBe(false);

			// stop() should call shutdownMethod before terminating - currently FAILS (red)
			await backgroundTaskService.stop();
			expect(shutdownMethodCompleted).toBe(true);
			expect(terminateSpy).toHaveBeenCalledOnce();

			vi.restoreAllMocks();
		});

		test("terminates workers and clears pool when handler is unregistered", async () => {
			const terminateSpy = vi.fn().mockResolvedValue(0);
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const worker = originalFn(module, completed, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						terminateSpy();
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			const serviceInternals = backgroundTaskService as unknown as {
				_workers: { [workerId: string]: unknown };
			};

			await backgroundTaskService.registerHandler(
				"unregister-type",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod",
				undefined,
				{ idleShutdownTimeout: -1 } // keep alive - worker stays in pool after task
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create("unregister-type", { counter: 0 }, { retainFor: 10000 });

			await waitForStatus("success");

			// Worker is alive and tracked in the pool
			expect(Object.keys(serviceInternals._workers)).toHaveLength(1);
			expect(terminateSpy).not.toHaveBeenCalled();

			// Bug 3: without the fix, unregisterHandler() never cleans up or terminates workers
			await backgroundTaskService.unregisterHandler("unregister-type");
			expect(terminateSpy).toHaveBeenCalledOnce();
			expect(Object.keys(serviceInternals._workers)).toHaveLength(0);

			vi.restoreAllMocks();
			await backgroundTaskService.stop();
		});

		test("removes crashed worker from pool and releases in-flight claim when worker thread crashes during task execution", async () => {
			const backgroundTaskService = makeService();
			const serviceInternals = backgroundTaskService as unknown as {
				_workers: { [workerId: string]: unknown };
				_inFlightTaskIds: Map<string, Set<string>>;
			};

			await backgroundTaskService.registerHandler(
				"crash-type",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethodCrash",
				undefined,
				{ idleShutdownTimeout: -1 }
			);

			await backgroundTaskService.start();
			await backgroundTaskService.create("crash-type", {}, { retainFor: 10000 });

			// Wait until the task error is written to storage - that proves
			// taskFinishedProcessing ran. Then give cleanupWorker a moment to follow.
			await waitForError();
			await new Promise(resolve => setTimeout(resolve, 50));

			// Bug 4: without the fix, the dead worker stays in _workers
			expect(Object.keys(serviceInternals._workers)).toHaveLength(0);

			// Bug 4: without the fix, the task in-flight claim is never released
			const inFlight = serviceInternals._inFlightTaskIds.get("crash-type");
			expect(inFlight?.size ?? 0).toEqual(0);

			await backgroundTaskService.stop();
		});
	});

	test("marks task as failed and removes worker when executionTimeout expires on a hung handler", async () => {
		const backgroundTaskService = makeService();
		const serviceInternals = backgroundTaskService as unknown as {
			_workers: { [workerId: string]: unknown };
			_inFlightTaskIds: Map<string, Set<string>>;
		};

		await backgroundTaskService.registerHandler(
			"hung-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodHang",
			undefined,
			{ executionTimeout: 300, idleShutdownTimeout: -1 }
		);

		await backgroundTaskService.start();
		await backgroundTaskService.create("hung-type", {}, { retainFor: 10_000 });

		await waitForStatus(TaskStatus.Failed);
		await new Promise(resolve => setTimeout(resolve, 50));

		const store = await backgroundTaskEntityStorageConnector.getStore();
		expect(store[0]?.status).toBe(TaskStatus.Failed);
		expect(store[0]?.error).toBeDefined();

		expect(Object.keys(serviceInternals._workers)).toHaveLength(0);

		const inFlight = serviceInternals._inFlightTaskIds.get("hung-type");
		expect(inFlight?.size ?? 0).toBe(0);

		await backgroundTaskService.stop();
	});

	describe("orphaned task adoption", () => {
		test("adopts a pending task left by a worker thread from a previous session", async () => {
			// Simulate a task created by worker thread "2" in a previous session that
			// never completed before the pod restarted.
			const orphanedTask: BackgroundTask = {
				id: "bb000000000000000000000000000000",
				type: "my-type",
				threadId: "2",
				status: TaskStatus.Pending,
				payload: { counter: 5 },
				retainFor: 10_000,
				dateCreated: new Date(Date.now()).toISOString(),
				dateModified: new Date(Date.now()).toISOString(),
				dateNextProcess: new Date(Date.now()).toISOString()
			};
			await backgroundTaskEntityStorageConnector.set(orphanedTask);

			const backgroundTaskService = makeService();

			await backgroundTaskService.registerHandler(
				"my-type",
				`file://${path.join(__dirname, "testModule.js")}`,
				"testMethod"
			);

			// start() → adoptOrphanedTasks() resets threadId "2" → "main",
			// then processTaskType() picks it up and executes it.
			await backgroundTaskService.start();

			await waitForStatus(TaskStatus.Success);

			const store = await backgroundTaskEntityStorageConnector.getStore();
			expect(store[0].threadId).toEqual("main");
			expect(store[0].status).toEqual(TaskStatus.Success);
			expect(store[0].result).toMatchObject({ counter: 6 });
		});
	});

	describe("health check lifecycle", () => {
		test("healthApplication calls callback with ok and application category on a successful round-trip", async () => {
			const backgroundTaskService = makeService({
				config: {
					overrideHealthCheckHandler: `file://${path.join(__dirname, "..", "dist", "es", "healthCheckHandler.js")}`
				}
			});
			await backgroundTaskService.start();

			let callbackResult: IHealth[] | undefined;
			let callbackResolved: () => void;
			const callbackPromise = new Promise<void>(resolve => {
				callbackResolved = resolve;
			});

			const healthPromise = backgroundTaskService.healthApplication(async result => {
				callbackResult = result;
				callbackResolved();
			});

			await healthPromise;
			await callbackPromise;

			expect(callbackResult).toHaveLength(1);
			expect(callbackResult?.[0].source).toEqual(BackgroundTaskService.CLASS_NAME);
			expect(callbackResult?.[0].category).toEqual("application");
			expect(callbackResult?.[0].status).toEqual("ok");
			expect(callbackResult?.[0].error).toBeUndefined();

			// Allow cleanup (remove + unregisterHandler) to complete after the callback.
			await new Promise(resolve => setTimeout(resolve, 100));
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((backgroundTaskService as any)._taskHandlers["health-check"]).toBeUndefined();
			const store = await backgroundTaskEntityStorageConnector.getStore();
			expect(store.length).toEqual(0);
		});

		test("healthApplication calls callback with error when task creation fails", async () => {
			const backgroundTaskService = makeService({
				config: {
					overrideHealthCheckHandler: `file://${path.join(__dirname, "..", "dist", "es", "healthCheckHandler.js")}`
				}
			});
			await backgroundTaskService.start();

			vi.spyOn(backgroundTaskService, "create").mockRejectedValueOnce(
				new Error("storage unavailable")
			);

			let callbackResult: IHealth[] | undefined;
			let callbackResolved: () => void;
			const callbackPromise = new Promise<void>(resolve => {
				callbackResolved = resolve;
			});

			const healthPromise = backgroundTaskService.healthApplication(async result => {
				callbackResult = result;
				callbackResolved();
			});

			await healthPromise;
			await callbackPromise;
			expect(callbackResult?.[0].status).toEqual("error");
			expect(callbackResult?.[0].error).toBeDefined();
		});
	});

	describe("interrupted and duplicate dispatch (#117)", () => {
		const testModuleUrl = (): string => `file://${path.join(__dirname, "testModule.js")}`;

		test("backs the next process time off at dispatch so an interrupted task stops starving pending work", async () => {
			// An interrupted task goes back to pending so it can be resumed, and previously kept
			// its dateNextProcess too, sorting ahead of every pending task on every cycle.
			const backgroundTaskService = makeService({ config: { taskInterval: 50 } });

			const registerStarvationHandler = async (): Promise<void> =>
				backgroundTaskService.registerHandler(
					"starvation-type",
					testModuleUrl(),
					"testMethodConfigurableSlow",
					undefined,
					{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
				);

			await registerStarvationHandler();
			await backgroundTaskService.start();

			// Long enough that a resumed first task would hold the only worker for the whole test.
			await backgroundTaskService.create(
				"starvation-type",
				{ ms: DurationConstants.MsPerMinute },
				{ retainFor: 10 * DurationConstants.MsPerSecond }
			);
			await waitForStatus("processing", 0);

			await backgroundTaskService.create("starvation-type", { ms: 10 }, { retainFor: 10_000 });

			// Tear the worker down mid-task, as a probe kill or handler re-registration would.
			await backgroundTaskService.unregisterHandler("starvation-type");
			await registerStarvationHandler();

			// The resumed task is backed off, so the pending one sorts first and gets the worker.
			await waitForStatus("success", 1);

			const store = await backgroundTaskEntityStorageConnector.getStore();
			expect(store[0].status).toEqual(TaskStatus.Pending);
			expect(store[1].status).toEqual(TaskStatus.Success);
		});

		test("fails a task as interrupted once its dispatches reach the configured maximum", async () => {
			// Interrupted attempts carry no error, so retriesRemaining never decrements for them.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 100, maxDispatchCount: 2 }
			});

			const registerInterruptedHandler = async (): Promise<void> =>
				backgroundTaskService.registerHandler(
					"interrupted-type",
					testModuleUrl(),
					"testMethodHang",
					undefined,
					{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
				);

			await registerInterruptedHandler();
			await backgroundTaskService.start();

			await backgroundTaskService.create("interrupted-type", {}, { retainFor: 10_000 });
			await waitForStatus("processing", 0);
			expect(await dispatchCountFor(backgroundTaskService)).toEqual(1);

			// Interrupt the first dispatch, which frees the claim but leaves the row in processing.
			await backgroundTaskService.unregisterHandler("interrupted-type");
			await registerInterruptedHandler();

			// Second and final permitted dispatch.
			await waitForDispatchCount(backgroundTaskService, 2);

			// Interrupt again; the next cycle has no dispatches left so it fails the task.
			await backgroundTaskService.unregisterHandler("interrupted-type");
			await registerInterruptedHandler();

			await waitForStatus("failed", 0);

			const task = (await backgroundTaskEntityStorageConnector.getStore())[0];
			expect(task.error?.name).toEqual("GeneralError");
			expect(task.error?.message).toEqual("backgroundTaskService.taskInterrupted");
			expect(task.error?.properties).toMatchObject({ dispatchCount: 2 });
			expect(task.dateCompleted).toBeDefined();
			expect(task.dateNextProcess).toBeUndefined();
			// The count is dropped once the task is resolved, so it cannot leak.
			expect(await dispatchCountFor(backgroundTaskService)).toEqual(0);
		});

		test("resumes an interrupted task indefinitely when the dispatch limit is disabled", async () => {
			// Handlers relying on a permanently resumed task can opt out of the bound.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 100, maxDispatchCount: -1 }
			});

			const dispatches: string[] = [];

			const registerUnboundedHandler = async (): Promise<void> =>
				backgroundTaskService.registerHandler(
					"unbounded-type",
					testModuleUrl(),
					"testMethodHang",
					async task => {
						dispatches.push(task.status);
					},
					{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
				);

			await registerUnboundedHandler();
			await backgroundTaskService.start();

			await backgroundTaskService.create("unbounded-type", {}, { retainFor: 10_000 });
			await waitForStatus("processing", 0);

			// Well past the default maximum of three dispatches.
			for (let round = 0; round < 4; round++) {
				await backgroundTaskService.unregisterHandler("unbounded-type");
				await registerUnboundedHandler();
				await waitForCondition(
					() => dispatches.filter(status => status === TaskStatus.Processing).length >= round + 2,
					"Timeout waiting for re-dispatch"
				);
			}

			const task = (await backgroundTaskEntityStorageConnector.getStore())[0];
			expect(task.status).toEqual(TaskStatus.Processing);
			expect(dispatches.filter(status => status === TaskStatus.Processing).length).toBeGreaterThan(
				3
			);
			expect(task.error).toBeUndefined();
			// Nothing is tracked when the bound is off, so the map cannot grow.
			expect(dispatchCounts(backgroundTaskService).size).toEqual(0);
		});

		test("clears the dispatch count once an attempt produces a result", async () => {
			// Only interrupted dispatches should accumulate, otherwise a task that legitimately
			// retries would be failed as interrupted and the counts would grow for the process life.
			const backgroundTaskService = makeService({ config: { taskInterval: 50 } });

			await backgroundTaskService.registerHandler(
				"dispatch-count-type",
				testModuleUrl(),
				"testMethod",
				undefined,
				{ idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			await backgroundTaskService.create(
				"dispatch-count-type",
				{ counter: 0 },
				{ retainFor: 10_000 }
			);
			await waitForStatus("success", 0);

			expect(await dispatchCountFor(backgroundTaskService)).toEqual(0);
		});

		test("prunes dispatch counts for tasks that are no longer running or awaiting a cycle", async () => {
			// The delete paths cannot reach a task whose handler was unregistered for good or whose
			// row was removed elsewhere, so the periodic sweep is what stops the map growing.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 100 }
			});

			await backgroundTaskService.registerHandler(
				"prune-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			await backgroundTaskService.create("prune-type", {}, { retainFor: 10_000 });
			await waitForStatus("processing", 0);
			expect(dispatchCounts(backgroundTaskService).size).toEqual(1);

			// Interrupt the task and drop the handler, so nothing will ever re-select it.
			await backgroundTaskService.unregisterHandler("prune-type");

			const serviceInternals = backgroundTaskService as unknown as {
				_lastCleanup: number;
				cleanupRetained(): Promise<void>;
			};

			// Still in its window, so the entry must survive.
			serviceInternals._lastCleanup = 0;
			await serviceInternals.cleanupRetained();
			expect(dispatchCounts(backgroundTaskService).size).toEqual(1);

			// Age the entry past the reclamation window.
			const taskId = (await backgroundTaskEntityStorageConnector.getStore())[0].id;
			const dispatch = dispatchCounts(backgroundTaskService).get(taskId);
			expect(dispatch).toBeDefined();
			dispatchCounts(backgroundTaskService).set(taskId, {
				count: dispatch?.count ?? 1,
				ts: Date.now() - 600_000
			});

			serviceInternals._lastCleanup = 0;
			await serviceInternals.cleanupRetained();
			expect(dispatchCounts(backgroundTaskService).size).toEqual(0);
		});

		test("keeps the dispatch count of a task that is still running", async () => {
			// A long task can outlive the reclamation window, but dropping its count while it is in
			// flight would hand it a fresh budget every sweep.
			const backgroundTaskService = makeService({ config: { taskInterval: 50 } });

			await backgroundTaskService.registerHandler(
				"long-running-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			await backgroundTaskService.create("long-running-type", {}, { retainFor: 10_000 });
			await waitForStatus("processing", 0);

			const taskId = (await backgroundTaskEntityStorageConnector.getStore())[0].id;
			dispatchCounts(backgroundTaskService).set(taskId, { count: 1, ts: Date.now() - 600_000 });

			const serviceInternals = backgroundTaskService as unknown as {
				_lastCleanup: number;
				cleanupRetained(): Promise<void>;
			};
			serviceInternals._lastCleanup = 0;
			await serviceInternals.cleanupRetained();

			expect(dispatchCounts(backgroundTaskService).size).toEqual(1);
		});

		test("clears every dispatch count when the service is stopped", async () => {
			const backgroundTaskService = makeService({ config: { taskInterval: 50 } });

			await backgroundTaskService.registerHandler(
				"stop-clears-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			await backgroundTaskService.create("stop-clears-type", {}, { retainFor: 10_000 });
			await waitForStatus("processing", 0);
			expect(dispatchCounts(backgroundTaskService).size).toEqual(1);

			await backgroundTaskService.stop();

			expect(dispatchCounts(backgroundTaskService).size).toEqual(0);
		});

		test("drops the dispatch count when a task is removed or cancelled", async () => {
			const backgroundTaskService = makeService({ config: { taskInterval: 50 } });

			await backgroundTaskService.registerHandler(
				"discard-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			const taskUrn = await backgroundTaskService.create("discard-type", {}, { retainFor: 10_000 });
			await waitForStatus("processing", 0);
			expect(dispatchCounts(backgroundTaskService).size).toEqual(1);

			await backgroundTaskService.remove(taskUrn);

			expect(dispatchCounts(backgroundTaskService).size).toEqual(0);
		});

		test("does not dispatch a task whose row is no longer current when the query returns", async () => {
			// A read starting while a task runs can return after it completed, was removed by
			// retention and released its claim, so the claim check passes for a task already done.
			// Re-reading the row is what stops the dispatch write resurrecting it and running again.
			// The short retry interval keeps the dispatch backoff from masking the stale row.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 100 }
			});

			const transitions: string[] = [];
			let staleRow: BackgroundTask | undefined;

			await backgroundTaskService.registerHandler(
				"stale-read-type",
				testModuleUrl(),
				"testMethod",
				async task => {
					transitions.push(task.status);
				},
				{ idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			// Capture the row exactly as the selection query would have seen it mid-run.
			const originalSet = backgroundTaskEntityStorageConnector.set.bind(
				backgroundTaskEntityStorageConnector
			);
			const setSpy = vi
				.spyOn(backgroundTaskEntityStorageConnector, "set")
				.mockImplementation(async (taskEntity: BackgroundTask) => {
					if (taskEntity.status === TaskStatus.Processing) {
						staleRow = structuredClone(taskEntity);
					}
					return originalSet(taskEntity);
				});

			// retainFor defaults to 0, so the row is removed as soon as the task completes.
			await backgroundTaskService.create("stale-read-type", { counter: 0 });
			await waitForStoreLength(0);
			setSpy.mockRestore();

			expect(staleRow).toBeDefined();
			expect(transitions.filter(status => status === TaskStatus.Processing)).toHaveLength(1);

			// Let the backoff on the captured row expire so it reads as due for processing.
			await new Promise(resolve => setTimeout(resolve, 200));

			// Hand the next selection query the row as it was before the task completed.
			vi.spyOn(backgroundTaskEntityStorageConnector, "query").mockResolvedValueOnce({
				entities: [staleRow as BackgroundTask]
			});

			const serviceInternals = backgroundTaskService as unknown as {
				processTaskType(taskType: string): Promise<void>;
			};
			await serviceInternals.processTaskType("stale-read-type");
			await new Promise(resolve => setTimeout(resolve, 300));

			// The task must not have run again, and the removed row must not have been recreated.
			expect(transitions.filter(status => status === TaskStatus.Processing)).toHaveLength(1);
			expect(await backgroundTaskEntityStorageConnector.getStore()).toHaveLength(0);
		});

		test("holds the in-flight claim when finalisation fails so the task is not run twice", async () => {
			// A finalisation write that throws leaves the row in processing despite the task running,
			// so releasing the claim would let the next cycle execute it again.
			const logEntries: ILogEntry[] = [];
			ComponentFactory.register("logging", () => ({
				className: () => "MockLoggingComponent",
				log: async (entry: ILogEntry) => {
					logEntries.push(entry);
				}
			}));

			// The short retry interval expires inside the test window, so a released claim would
			// really produce a second dispatch.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 100 },
				loggingComponentType: "logging"
			});

			const transitions: string[] = [];

			await backgroundTaskService.registerHandler(
				"held-claim-type",
				testModuleUrl(),
				"testMethod",
				async task => {
					transitions.push(task.status);
				},
				{ idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			const originalSet = backgroundTaskEntityStorageConnector.set.bind(
				backgroundTaskEntityStorageConnector
			);
			vi.spyOn(backgroundTaskEntityStorageConnector, "set").mockImplementation(
				async (taskEntity: BackgroundTask) => {
					if (taskEntity.status === TaskStatus.Success) {
						throw new Error("finalisation storage failed");
					}
					return originalSet(taskEntity);
				}
			);

			await backgroundTaskService.create("held-claim-type", { counter: 0 }, { retainFor: 10_000 });

			// Well past the retry interval, so a re-dispatch would have happened by now.
			await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));

			expect(transitions.filter(status => status === TaskStatus.Processing)).toHaveLength(1);
			expect(logEntries.filter(entry => entry.message === "taskClaimRetained")).toHaveLength(1);

			const serviceInternals = backgroundTaskService as unknown as {
				_inFlightTaskIds: Map<string, Set<string>>;
			};
			expect(serviceInternals._inFlightTaskIds.get("held-claim-type")?.size).toEqual(1);
		});
	});

	describe("interrupted task status (#121)", () => {
		const testModuleUrl = (): string => `file://${path.join(__dirname, "testModule.js")}`;

		test("returns a task to pending when its worker is torn down mid-task", async () => {
			// A row left in processing with no worker on it makes the status meaningless for
			// anything counting in-flight work.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 10_000 }
			});

			const transitions: string[] = [];

			await backgroundTaskService.registerHandler(
				"torn-down-type",
				testModuleUrl(),
				"testMethodHang",
				async task => {
					transitions.push(task.status);
				},
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			await backgroundTaskService.create("torn-down-type", {}, { retainFor: 10_000 });
			await waitForStatus(TaskStatus.Processing);

			// Tear the worker down mid-task, as a stall detector, handler swap or pod stop would.
			await backgroundTaskService.unregisterHandler("torn-down-type");

			const store = await backgroundTaskEntityStorageConnector.getStore();
			expect(store[0].status).toEqual(TaskStatus.Pending);
			// The backoff still decides where it sorts, so it does not starve pending work.
			expect(new Date(store[0].dateNextProcess ?? 0).getTime()).toBeGreaterThan(Date.now());
			expect(transitions).toEqual([TaskStatus.Processing, TaskStatus.Pending]);
		});

		test("allows a task interrupted by a tear-down to be cancelled while it waits", async () => {
			// cancel() only acts on pending rows, so an interrupted task was uncancellable.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 10_000 }
			});

			await backgroundTaskService.registerHandler(
				"cancel-interrupted-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			const taskId = await backgroundTaskService.create(
				"cancel-interrupted-type",
				{},
				{ retainFor: 10_000 }
			);
			await waitForStatus(TaskStatus.Processing);

			await backgroundTaskService.unregisterHandler("cancel-interrupted-type");
			await backgroundTaskService.cancel(taskId);

			const store = await backgroundTaskEntityStorageConnector.getStore();
			expect(store[0].status).toEqual(TaskStatus.Cancelled);
			expect(store[0].dateCancelled).toBeDefined();
		});

		test("does not resurrect a task removed while its worker held it", async () => {
			// The worker's copy of the row is stale once the task is removed, so writing it back
			// would recreate the row as pending.
			const backgroundTaskService = makeService({
				config: { taskInterval: 50, retryInterval: 10_000 }
			});

			await backgroundTaskService.registerHandler(
				"removed-while-held-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{ maxWorkerCount: 1, idleShutdownTimeout: -1 }
			);
			await backgroundTaskService.start();

			const taskId = await backgroundTaskService.create(
				"removed-while-held-type",
				{},
				{ retainFor: 10_000 }
			);
			await waitForStatus(TaskStatus.Processing);

			await backgroundTaskService.remove(taskId);
			await backgroundTaskService.unregisterHandler("removed-while-held-type");

			expect(await backgroundTaskEntityStorageConnector.getStore()).toHaveLength(0);
		});

		test("returns tasks left in processing by a previous run to pending at startup", async () => {
			// Nothing gets to run when a process is killed, so the rows it owned stay in processing
			// with no worker anywhere.
			const stuckTask: BackgroundTask = {
				id: "cc000000000000000000000000000000",
				type: "killed-process-type",
				threadId: "main",
				status: TaskStatus.Processing,
				payload: { counter: 5 },
				retainFor: 10_000,
				dateCreated: new Date(Date.now()).toISOString(),
				dateModified: new Date(Date.now()).toISOString(),
				dateNextProcess: new Date(Date.now() + DurationConstants.MsPerMinute).toISOString()
			};
			await backgroundTaskEntityStorageConnector.set(stuckTask);

			const backgroundTaskService = makeService();
			await backgroundTaskService.start();

			const store = await backgroundTaskEntityStorageConnector.getStore();
			expect(store[0].status).toEqual(TaskStatus.Pending);
			// The backoff it was dispatched with still decides where it sorts.
			expect(store[0].dateNextProcess).toEqual(stuckTask.dateNextProcess);
		});

		test("runs the shutdown method on a stalled worker before terminating it", async () => {
			// A stalled thread is force-terminated, so without this it never releases its resources.
			const shutdownOrder: string[] = [];
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const wrappedCompleted = async (
						operation: string,
						result?: unknown,
						err?: Error
					): Promise<void> => {
						if (operation === "testMethodShutdown") {
							shutdownOrder.push("shutdown");
						}
						return completed(operation, result, err);
					};
					const worker = originalFn(module, wrappedCompleted, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						shutdownOrder.push("terminate");
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			await backgroundTaskService.registerHandler(
				"stalled-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{
					executionTimeout: 300,
					idleShutdownTimeout: -1,
					shutdownMethod: "testMethodShutdown"
				}
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create("stalled-type", {}, { retainFor: 10_000 });

			await waitForStatus(TaskStatus.Failed);
			await waitForCondition(
				() => shutdownOrder.includes("terminate"),
				"Timeout waiting for the worker to be terminated"
			);

			expect(shutdownOrder).toEqual(["shutdown", "terminate"]);

			vi.restoreAllMocks();
		});

		test("asks a stalled worker to shut down only once", async () => {
			// The idle shutdown and the forced tear-down both want the worker gone, but the
			// shutdown method should not run twice.
			const shutdownOrder: string[] = [];
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const wrappedCompleted = async (
						operation: string,
						result?: unknown,
						err?: Error
					): Promise<void> => {
						if (operation === "testMethodShutdown") {
							shutdownOrder.push("shutdown");
						}
						return completed(operation, result, err);
					};
					const worker = originalFn(module, wrappedCompleted, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						shutdownOrder.push("terminate");
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			await backgroundTaskService.registerHandler(
				"stalled-once-type",
				testModuleUrl(),
				"testMethodHang",
				undefined,
				{
					executionTimeout: 300,
					idleShutdownTimeout: 0,
					shutdownMethod: "testMethodShutdown"
				}
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create("stalled-once-type", {}, { retainFor: 10_000 });

			await waitForStatus(TaskStatus.Failed);
			await waitForCondition(
				() => shutdownOrder.includes("terminate"),
				"Timeout waiting for the worker to be terminated"
			);

			expect(shutdownOrder).toEqual(["shutdown", "terminate"]);

			vi.restoreAllMocks();
		});

		test("runs the shutdown method when a handler is unregistered", async () => {
			const shutdownOrder: string[] = [];
			const originalFn = ModuleHelper.execModuleMethodThreadMessage.bind(ModuleHelper);

			vi.spyOn(ModuleHelper, "execModuleMethodThreadMessage").mockImplementation(
				(module, completed, options) => {
					const wrappedCompleted = async (
						operation: string,
						result?: unknown,
						err?: Error
					): Promise<void> => {
						if (operation === "testMethodShutdown") {
							shutdownOrder.push("shutdown");
						}
						return completed(operation, result, err);
					};
					const worker = originalFn(module, wrappedCompleted, options);
					const originalTerminate = worker.terminate.bind(worker);
					worker.terminate = vi.fn().mockImplementation(async () => {
						shutdownOrder.push("terminate");
						return originalTerminate();
					});
					return worker;
				}
			);

			const backgroundTaskService = makeService();
			await backgroundTaskService.registerHandler(
				"unregister-shutdown-type",
				testModuleUrl(),
				"testMethod",
				undefined,
				{
					idleShutdownTimeout: -1,
					shutdownMethod: "testMethodShutdown"
				}
			);
			await backgroundTaskService.start();
			await backgroundTaskService.create(
				"unregister-shutdown-type",
				{ counter: 0 },
				{ retainFor: 10_000 }
			);

			await waitForStatus(TaskStatus.Success);
			expect(shutdownOrder).toEqual([]);

			await backgroundTaskService.unregisterHandler("unregister-shutdown-type");

			expect(shutdownOrder).toEqual(["shutdown", "terminate"]);

			vi.restoreAllMocks();
		});
	});
});
