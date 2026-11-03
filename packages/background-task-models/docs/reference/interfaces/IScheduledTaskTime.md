# Interface: IScheduledTaskTime

Interface describing a scheduled task time.

## Properties

### nextTriggerTime? {#nexttriggertime}

> `optional` **nextTriggerTime?**: `number`

The date/time to start the task, if not provided defaults to first interval from now.

***

### intervalDays? {#intervaldays}

> `optional` **intervalDays?**: `number`

The interval in days to repeat the task, if no intervals are set the task will not repeat.

***

### intervalHours? {#intervalhours}

> `optional` **intervalHours?**: `number`

The interval in hours to repeat the task, if no intervals are set the task will not repeat.

***

### intervalMinutes? {#intervalminutes}

> `optional` **intervalMinutes?**: `number`

The interval in minutes to repeat the task, if no intervals are set the task will not repeat.

***

### intervalSeconds? {#intervalseconds}

> `optional` **intervalSeconds?**: `number`

The interval in seconds to repeat the task, if no intervals are set the task will not repeat.
