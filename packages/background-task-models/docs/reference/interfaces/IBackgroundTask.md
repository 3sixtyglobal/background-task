# Interface: IBackgroundTask\<T, U\>

Interface describing a background task.

## Type Parameters

### T {#t}

`T` = `any`

### U {#u}

`U` = `any`

## Properties

### id {#id}

> **id**: `string`

The id in URN form e.g. `background-task:<namespace>:<entity-id>`.

***

### type {#type}

> **type**: `string`

The type of the task.

***

### threadId {#threadid}

> **threadId**: `string`

The thread id for the task.

***

### retryInterval? {#retryinterval}

> `optional` **retryInterval?**: `number`

The retry interval in milliseconds, undefined if default scheduling.

***

### retriesRemaining? {#retriesremaining}

> `optional` **retriesRemaining?**: `number`

The number of retries remaining, undefined if infinite retries.

***

### dateCreated {#datecreated}

> **dateCreated**: `string`

The date the task was created.

***

### dateModified {#datemodified}

> **dateModified**: `string`

The date the task was last modified.

***

### dateCompleted? {#datecompleted}

> `optional` **dateCompleted?**: `string`

The date the task was complete.

***

### dateCancelled? {#datecancelled}

> `optional` **dateCancelled?**: `string`

The date the task was cancelled.

***

### dateRetainUntil? {#dateretainuntil}

> `optional` **dateRetainUntil?**: `string`

The date until when to retain.

***

### status {#status}

> **status**: [`TaskStatus`](../type-aliases/TaskStatus.md)

The status of the task.

***

### payload? {#payload}

> `optional` **payload?**: `T`

The payload to execute the task with.

***

### result? {#result}

> `optional` **result?**: `U`

The result of the execution.

***

### error? {#error}

> `optional` **error?**: `IError`

The error at last execution.
