// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { DurationConstants } from "@3sixty/core";
import { MemoryEntityStorageConnector } from "@3sixty/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@3sixty/entity-storage-models";
import { nameof } from "@3sixty/nameof";
import type { ScheduledTask } from "../src/entities/scheduledTask.js";
import { initSchema } from "../src/schema.js";
import { TaskSchedulerService } from "../src/taskSchedulerService.js";

let scheduledTaskEntityStorageConnector: MemoryEntityStorageConnector<ScheduledTask>;

const realDateNow = Date.now.bind(Date);

describe("TaskSchedulerService", () => {
	beforeEach(() => {
		const start = realDateNow();
		const mockNow = vi.fn();
		mockNow.mockImplementation(() => {
			const tick = realDateNow();
			return Math.floor((tick - start) / 100) * 100;
		});
		Date.now = mockNow;

		initSchema();

		scheduledTaskEntityStorageConnector = new MemoryEntityStorageConnector<ScheduledTask>({
			entitySchema: nameof<ScheduledTask>(),
			config: { storageKey: "scheduled-task" }
		});

		EntityStorageConnectorFactory.register(
			"scheduled-task",
			() => scheduledTaskEntityStorageConnector
		);
	});

	afterEach(async () => {
		Date.now = realDateNow;
		await scheduledTaskEntityStorageConnector.teardown();
	});

	test("can construct with dependencies", async () => {
		const taskScheduler = new TaskSchedulerService();

		expect(taskScheduler).toBeDefined();
	});

	test("can schedule a one off task to run at a specific time with no interval", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggered = false;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 500 }], async () => {
			triggered = true;
		});

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: 500
				}
			]
		});
		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: undefined
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("can schedule a one off task to run at a specific time with minutes interval", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggered = false;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() + 500, intervalMinutes: 1 }],
			async () => {
				triggered = true;
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: 500
				}
			]
		});
		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, 1500));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: 60500
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("can schedule a one off task to run at a specific time with seconds interval", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggered = false;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() + 500, intervalSeconds: 30 }],
			async () => {
				triggered = true;
			}
		);

		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, 1500));

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalSeconds: 30,
					nextTriggerTime: 30500
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("runs a task at the next check when its run takes longer than the gap to its next time", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		// Due just after each check, so a run of 300ms ends after its next time less a check.
		let triggerCount = 0;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() + 100, intervalSeconds: 1 }],
			async () => {
				triggerCount++;
				await new Promise(resolve => setTimeout(resolve, 300));
			}
		);

		await new Promise(resolve => setTimeout(resolve, 2600));

		expect(triggerCount).toEqual(2);
	});

	test("can schedule a one off task to run at a specific time with hours interval", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggered = false;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() + 500, intervalHours: 1 }],
			async () => {
				triggered = true;
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalHours: 1,
					nextTriggerTime: 500
				}
			]
		});
		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, 1500));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					intervalHours: 1,
					nextTriggerTime: 3600500
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("can schedule a one off task to run at a specific time with days interval", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggered = false;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() + 500, intervalDays: 1 }],
			async () => {
				triggered = true;
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalDays: 1,
					nextTriggerTime: 500
				}
			]
		});
		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, 1500));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					intervalDays: 1,
					nextTriggerTime: 86400500
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("can remove a task", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggerCount = 0;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now(), intervalMinutes: 1 }],
			async () => {
				triggerCount++;
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: DurationConstants.MsPerMinute
				}
			]
		});

		await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));
		expect(triggerCount).toEqual(1);

		await taskScheduler.removeTask("testTask");

		await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({});
		expect(triggerCount).toEqual(1);
	});

	test("can remove a task during a callback", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		let triggerCount = 0;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() - 59000, intervalMinutes: 1 }],
			async () => {
				triggerCount++;
				await taskScheduler.removeTask("testTask");
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({});

		await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));
		expect(triggerCount).toEqual(1);

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({});
		expect(triggerCount).toEqual(1);
	});

	test("skips missed interval slots instead of replaying them back to back", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100
			}
		});
		await taskScheduler.start();

		const threeMinutesMs = 3 * DurationConstants.MsPerMinute;
		let triggerCount = 0;
		await taskScheduler.addTask(
			"testTask",
			[
				{
					nextTriggerTime: Date.now() - threeMinutesMs,
					intervalMinutes: 1
				}
			],
			async () => {
				triggerCount++;
				await new Promise(resolve => setTimeout(resolve, 150));
			}
		);

		// Give the initial overdue run enough time to complete, plus extra ticks that
		// would previously have replayed each missed minute immediately.
		await new Promise(resolve => setTimeout(resolve, 700));

		expect(triggerCount).toEqual(1);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: DurationConstants.MsPerMinute
				}
			]
		});
	});

	test("can throw an error in a task and continue", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 500 }], async () => {
			throw new Error("Test error");
		});

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: 500
				}
			]
		});

		await new Promise(resolve => setTimeout(resolve, DurationConstants.MsPerSecond));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: undefined
				}
			]
		});
	});

	test("does not run a task when it is already in progress", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100
			}
		});
		await taskScheduler.start();

		const lockTime = Date.now();
		await scheduledTaskEntityStorageConnector.set({
			id: "testTask",
			lastRunTime: lockTime
		});

		let triggered = false;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() }], async () => {
			triggered = true;
		});

		await new Promise(resolve => setTimeout(resolve, 200));

		expect(triggered).toEqual(false);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: undefined
				}
			]
		});
	});

	test("skips while in progress and does not run on a later schedule without stalled timeout", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100
			}
		});
		await taskScheduler.start();

		await scheduledTaskEntityStorageConnector.set({
			id: "testTask",
			lastRunTime: Date.now()
		});

		let triggerCount = 0;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 400 }], async () => {
			triggerCount++;
		});

		await new Promise(resolve => setTimeout(resolve, 900));

		expect(triggerCount).toEqual(0);
	});

	test("runs a stalled in-progress task when stalled timeout is exceeded", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100,
				stalledTaskTimeoutMs: 300
			}
		});
		await taskScheduler.start();

		await scheduledTaskEntityStorageConnector.set({
			id: "testTask",
			lastRunTime: Date.now()
		});

		let triggerCount = 0;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 400 }], async () => {
			triggerCount++;
		});

		await new Promise(resolve => setTimeout(resolve, 900));

		expect(triggerCount).toEqual(1);
	});

	test("runs a stalled in-progress task at the exact timeout boundary", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100,
				stalledTaskTimeoutMs: 300
			}
		});
		await taskScheduler.start();

		await scheduledTaskEntityStorageConnector.set({
			id: "testTask",
			lastRunTime: Date.now()
		});

		let triggerCount = 0;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 300 }], async () => {
			triggerCount++;
		});

		await new Promise(resolve => setTimeout(resolve, 700));

		expect(triggerCount).toEqual(1);
	});

	test("runs when stalled timeout is zero", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100,
				stalledTaskTimeoutMs: 0
			}
		});
		await taskScheduler.start();

		const lockTime = Date.now();
		await scheduledTaskEntityStorageConnector.set({
			id: "testTask",
			lastRunTime: lockTime
		});

		let triggerCount = 0;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 300 }], async () => {
			triggerCount++;
		});

		await new Promise(resolve => setTimeout(resolve, 700));

		expect(triggerCount).toEqual(1);
	});

	test("stops triggering tasks after stop is called", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100
			}
		});
		await taskScheduler.start();

		let triggerCount = 0;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 300 }], async () => {
			triggerCount++;
		});

		await taskScheduler.stop();

		await new Promise(resolve => setTimeout(resolve, 700));

		expect(triggerCount).toEqual(0);
	});

	test("does not clear in-progress locks that were not started by this scheduler", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: DurationConstants.MsPerSecond
			}
		});
		await taskScheduler.start();

		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() + DurationConstants.MsPerMinute }],
			async () => {
				// No op
			}
		);

		const lockTime = Date.now();
		await scheduledTaskEntityStorageConnector.set({
			id: "testTask",
			lastRunTime: lockTime
		});

		await taskScheduler.stop();

		const scheduledTask = await scheduledTaskEntityStorageConnector.get("testTask");
		expect(scheduledTask?.lastRunTime).toEqual(lockTime);
	});

	test("clears in-progress locks for tasks started by this scheduler", async () => {
		const taskScheduler = new TaskSchedulerService({
			config: {
				intervalMs: 100
			}
		});
		await taskScheduler.start();

		let releaseTask: (() => void) | undefined;
		let callbackStartedResolve: (() => void) | undefined;
		const callbackStarted = new Promise<void>(resolve => {
			callbackStartedResolve = resolve;
		});

		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 300 }], async () => {
			callbackStartedResolve?.();
			await new Promise<void>(resolve => {
				releaseTask = resolve;
			});
		});

		await callbackStarted;

		await taskScheduler.stop();

		const scheduledTask = await scheduledTaskEntityStorageConnector.get("testTask");
		expect(scheduledTask?.lastRunTime).toEqual(undefined);

		releaseTask?.();
		await new Promise(resolve => setTimeout(resolve, 50));
	});
});
