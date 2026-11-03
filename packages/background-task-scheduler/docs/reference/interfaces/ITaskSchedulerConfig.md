# Interface: ITaskSchedulerConfig

Interface for the task scheduler configuration.

## Properties

### intervalMs? {#intervalms}

> `optional` **intervalMs?**: `number`

The interval in milliseconds between checks for tasks that are due. A task runs at the first check
after its time, so set this no longer than the shortest task interval, such as 1000 for tasks
that repeat every few seconds.

#### Default

```ts
60000
```

***

### stalledTaskTimeoutMs? {#stalledtasktimeoutms}

> `optional` **stalledTaskTimeoutMs?**: `number`

The time in milliseconds after which a task that is still marked as running is considered stalled and can be run again.

#### Default

```ts
300000
```
