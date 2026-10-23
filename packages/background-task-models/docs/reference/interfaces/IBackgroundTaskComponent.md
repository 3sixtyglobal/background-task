# Interface: IBackgroundTaskComponent

Interface describing a background task component.

## Extends

- `IComponent`

## Methods

### registerHandler() {#registerhandler}

> **registerHandler**\<`T`, `U`\>(`taskType`, `module`, `method`, `stateChangeCallback?`, `options?`): `Promise`\<`void`\>

Register a handler for a task.

#### Type Parameters

##### T {#t}

`T`

##### U {#u}

`U`

#### Parameters

##### taskType

`string`

The type of the task the handler can process.

##### module

`string`

The module the handler is in.

##### method

`string`

The method in the module to execute.

##### stateChangeCallback?

(`task`) => `Promise`\<`void`\>

The callback to execute when the task state is updated.

##### options?

Additional options for the task.

###### maxWorkerCount?

`number`

The maximum number of workers in the pool.

###### idleShutdownTimeout?

`number`

Terminate the worker after it has been idle for the specified timeout in milliseconds, defaults to 0 shutdown immediately, -1 to keep forever.

###### initialiseMethod?

`string`

The initialisation method to call on the module when a worker is started.

###### initialiseMethodParams?

() => `Promise`\<`unknown`[]\>

Callback to provide additional parameters to spread when calling the initialiseMethod.

###### shutdownMethod?

`string`

The shutdown method to call on the module when a worker is stopped.

###### shutdownMethodParams?

() => `Promise`\<`unknown`[]\>

Callback to provide additional parameters to spread when calling the shutdownMethod.

###### executionTimeout?

`number`

Maximum time in milliseconds a task may run before it is marked as failed and the worker terminated. Omit for no limit.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the handler is registered

***

### unregisterHandler() {#unregisterhandler}

> **unregisterHandler**(`taskType`): `Promise`\<`void`\>

Unregister a handler for a task.

#### Parameters

##### taskType

`string`

The type of the task handler to remove.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the handler is removed

***

### create() {#create}

> **create**\<`T`\>(`taskType`, `payload?`, `options?`): `Promise`\<`string`\>

Create a new task.

#### Type Parameters

##### T {#t-1}

`T`

#### Parameters

##### taskType

`string`

The type of the task.

##### payload?

`T`

The payload for the task.

##### options?

Additional options for the task.

###### retryCount?

`number`

The number of times to retry the task if it fails, leave undefined to retry forever.

###### retryInterval?

`number`

The interval in milliseconds to wait between retries, defaults to 5000, leave undefined for default scheduling.

###### retainFor?

`number`

The amount of time in milliseconds to retain the result until removal, defaults to 0 for immediate removal, set to -1 to keep forever.

#### Returns

`Promise`\<`string`\>

The id of the created task.

***

### get() {#get}

> **get**\<`T`, `U`\>(`taskId`): `Promise`\<[`IBackgroundTask`](IBackgroundTask.md)\<`T`, `U`\> \| `undefined`\>

Get the task details.

#### Type Parameters

##### T {#t-2}

`T`

##### U {#u-1}

`U`

#### Parameters

##### taskId

`string`

The id of the task to get the details for.

#### Returns

`Promise`\<[`IBackgroundTask`](IBackgroundTask.md)\<`T`, `U`\> \| `undefined`\>

The details of the task.

***

### retry() {#retry}

> **retry**(`taskId`): `Promise`\<`void`\>

Retry a failed task immediately instead of waiting for it's next scheduled retry time.

#### Parameters

##### taskId

`string`

The id of the task to retry.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the retry request has been applied

***

### remove() {#remove}

> **remove**(`taskId`): `Promise`\<`void`\>

Remove a task ignoring any retain until date.

#### Parameters

##### taskId

`string`

The id of the task to remove.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the task has been removed

***

### cancel() {#cancel}

> **cancel**(`taskId`): `Promise`\<`void`\>

Cancel a task, will only be actioned if the task is currently pending.

#### Parameters

##### taskId

`string`

The id of the task to cancel.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the cancellation has been applied

***

### query() {#query}

> **query**(`taskType?`, `taskStatus?`, `sortProperty?`, `sortDirection?`, `cursor?`, `limit?`): `Promise`\<\{ `entities`: [`IBackgroundTask`](IBackgroundTask.md)\<`any`, `any`\>[]; `cursor?`: `string`; \}\>

Query the list of tasks.

#### Parameters

##### taskType?

`string`

The type of the task to get.

##### taskStatus?

[`TaskStatus`](../type-aliases/TaskStatus.md)

The status of the task to get.

##### sortProperty?

`"dateCreated"` \| `"dateModified"` \| `"dateCompleted"` \| `"status"`

The property to sort by, defaults to dateCreated.

##### sortDirection?

`SortDirection`

The order to sort by, defaults to ascending.

##### cursor?

`string`

The cursor to get the next page of tasks.

##### limit?

`number`

Limit the number of entities to return.

#### Returns

`Promise`\<\{ `entities`: [`IBackgroundTask`](IBackgroundTask.md)\<`any`, `any`\>[]; `cursor?`: `string`; \}\>

The list of tasks.
