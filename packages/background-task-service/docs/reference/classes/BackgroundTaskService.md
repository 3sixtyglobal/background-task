# Class: BackgroundTaskService

Class for performing background task operations.

## Implements

- `IBackgroundTaskComponent`
- `IHealthProviderComponent`

## Constructors

### Constructor

> **new BackgroundTaskService**(`options?`): `BackgroundTaskService`

Create a new instance of BackgroundTaskService.

#### Parameters

##### options?

[`IBackgroundTaskServiceConstructorOptions`](../interfaces/IBackgroundTaskServiceConstructorOptions.md)

The options for the service.

#### Returns

`BackgroundTaskService`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

***

### NAMESPACE {#namespace}

> `readonly` `static` **NAMESPACE**: `string` = `"entity-storage"`

The namespace supported by the background task.

## Methods

### className() {#classname}

> **className**(): `string`

Returns the class name of the component.

#### Returns

`string`

The class name of the component.

#### Implementation of

`IBackgroundTaskComponent.className`

***

### start() {#start}

> **start**(`nodeLoggingComponentType?`): `Promise`\<`void`\>

The component needs to be started when the node is initialized.

#### Parameters

##### nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the service has started and pending tasks are being processed

#### Implementation of

`IBackgroundTaskComponent.start`

***

### stop() {#stop}

> **stop**(`nodeLoggingComponentType?`): `Promise`\<`void`\>

The component needs to be stopped when the node is closed.

#### Parameters

##### nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`void`\>

A promise that resolves when all workers have been shut down

#### Implementation of

`IBackgroundTaskComponent.stop`

***

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

Terminate the thread after it has been idle for the specified timeout in milliseconds, defaults to 0 shutdown immediately, -1 to keep forever.

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

A promise that resolves when the handler is registered and initial task processing begins

#### Implementation of

`IBackgroundTaskComponent.registerHandler`

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

A promise that resolves when the handler and its workers have been removed

#### Implementation of

`IBackgroundTaskComponent.unregisterHandler`

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

The number of times to retry the task if it fails, leave undefined for no retries.

###### retryInterval?

`number`

The interval in milliseconds to wait between retries, defaults to 5000, leave undefined for default scheduling.

###### retainFor?

`number`

The amount of time in milliseconds to retain the result until removal, defaults to 0 for immediate removal, set to -1 to keep forever.

#### Returns

`Promise`\<`string`\>

The id of the created task.

#### Implementation of

`IBackgroundTaskComponent.create`

***

### get() {#get}

> **get**\<`T`, `U`\>(`taskId`): `Promise`\<`IBackgroundTask`\<`T`, `U`\> \| `undefined`\>

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

`Promise`\<`IBackgroundTask`\<`T`, `U`\> \| `undefined`\>

The details of the task.

#### Implementation of

`IBackgroundTaskComponent.get`

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

A promise that resolves when the retry has been scheduled

#### Implementation of

`IBackgroundTaskComponent.retry`

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

A promise that resolves when the task has been removed from storage

#### Implementation of

`IBackgroundTaskComponent.remove`

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

A promise that resolves when the cancellation has been persisted

#### Implementation of

`IBackgroundTaskComponent.cancel`

***

### query() {#query}

> **query**(`taskType?`, `taskStatus?`, `sortProperty?`, `sortDirection?`, `cursor?`, `limit?`): `Promise`\<\{ `entities`: `IBackgroundTask`\<`any`, `any`\>[]; `cursor?`: `string`; \}\>

Get a list of tasks.

#### Parameters

##### taskType?

`string`

The type of the task to get.

##### taskStatus?

`TaskStatus`

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

`Promise`\<\{ `entities`: `IBackgroundTask`\<`any`, `any`\>[]; `cursor?`: `string`; \}\>

The list of tasks.

#### Implementation of

`IBackgroundTaskComponent.query`

***

### healthApplication() {#healthapplication}

> **healthApplication**(`callback`): `Promise`\<`IHealth`[] \| `undefined`\>

Returns the application health status by running a full task register/create/verify/unregister lifecycle.
Returns undefined as the result will be provided asynchronously via the callback.

#### Parameters

##### callback

`HealthApplicationCallback`

The callback to invoke when the deferred health result is ready.

#### Returns

`Promise`\<`IHealth`[] \| `undefined`\>

undefined as the result is provided via the callback.

#### Implementation of

`IHealthProviderComponent.healthApplication`
