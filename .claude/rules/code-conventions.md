---
paths:
  - '**/src/**/*.ts'
  - '**/tests/**/*.ts'
---

# Code Conventions

Rules that ESLint enforces are not repeated here, `pnpm run lint` reports them.

## Changes

- Do not change exported types, method names, payload structures or error contracts unless asked
- Keep backwards compatibility: existing stored data works without manual steps, existing REST paths, payload structures and status codes keep working, adding rather than renaming or removing, and existing configuration keeps its meaning. When a stored schema changes, migrate existing data in the package's `initSchema` if the package can handle it alone, or in `migration.ts` in `node-core` if it spans packages. Handle old data and requests alongside new ones rather than adding flags to switch legacy behaviour on or off, unless there is no other way. If a security fix must change a default, add an option that restores the old behaviour and call it out
- Do not disable lint rules, with comments or otherwise
- Do not add TODO or FIXME markers unless asked

## Code

- TypeScript ES modules only, with `.js` extensions on relative imports
- Classes expose `public static readonly CLASS_NAME: string = nameof<ClassName>();` and use it as the source when throwing errors
- Validate arguments with `Guards` and throw subclasses of `BaseError`, such as `GeneralError`
- In catch blocks, wrap the caught error in a `GeneralError` with the operation's locale key, such as `throw new GeneralError(MyService.CLASS_NAME, "addPolicyFailed", undefined, error)`. Only catch specific error types, such as `NotFoundError`, where the code deliberately handles them, and do not add helpers that pass typed errors through unchanged
- Do not use private static methods in a class with instance members, make them private instance methods called with `this.`. Classes with only static members, such as helpers, may keep private static methods
- In engine component initialisers, use `engineCore.getRegisteredInstanceType(...)` for every dependency the constructed class resolves with `Factory.get`, and `engineCore.getRegisteredInstanceTypeOptional(...)` only for those it resolves with `Factory.getIfExists`, as the optional form hides missing required components
- Resolve every component, connector and entity storage a class depends on with `Factory.get` in the constructor and keep it in a field that is not optional, so a missing dependency fails when the node starts rather than on a later request. Use `Factory.getIfExists` only for a dependency the class works fully without, such as logging, telemetry or the tenant admin component that only multi-tenant nodes register, and never fall back to skipping work, such as removing data or checking a role, because a dependency is missing
- Do not resolve a dependency lazily in a method because it is created later in the engine. Move its entry earlier in `coreTypeInitialisers.json` or `serverTypeInitialisers.json`, which set the order components are constructed in, or initialise the entity storage it needs in the initialiser of the component that uses it
- Create every object a class depends on, such as another service it delegates to, in the constructor and keep it in a `readonly` field. Do not add a private method that creates or looks it up on first use, such as `private accountService(): AccountService { this._accountService ??= new AccountService(); ... }`
- Do not copy a `readonly` field into a local only to use it, such as `const identityComponent = this._identityComponent;`, use the field. A local is only for a value that can change while the method runs, such as a field set in `start()`, or for narrowing an optional field
- Do not pass a class's own fields to its own methods, such as `this.adoptCreated(this._identityComponent, accountId)`, the method reads `this._identityComponent` itself. A parameter is only for a value that differs between calls, such as a template id or which of several entity storages to use, or for the narrowed value of an optional field
- Do not add a method whose body is a single call to another method, such as `private async getRoles(accountId) { return this._authorizationComponent.getRolesForSubject(this._authorizationModelId, accountId); }`, make the call where it is needed. A method that holds logic of its own, such as a loop, a condition or a try block, is not a wrapper
- Take a lock inline, with `const lockKey = ...; await Mutex.lock(lockKey, { throwOnTimeout: true }); try { ... } finally { Mutex.unlock(lockKey); }` in the method that needs it. Build a lock key that is used in more than one place with a static helper method, such as `AccountDataHelper.didLockKey(identity)`, and do not add a method that runs a callback under a lock, such as `withLock(key, method)`
- Compare objects or use them as keys with `JsonHelper.canonicalize(value)`, not `JSON.stringify(value)`, so the same object with its properties in a different order matches
- Give a property that always has a value, such as one with a default, its plain type rather than making it optional
- Use the `DurationConstants` from `@3sixty/core` for common time values, such as `DurationConstants.MsPerSecond` or `DurationConstants.MsPerMinute`, rather than literal numbers or arithmetic such as `1000` or `60 * 1000`
- Declare method parameters and return values with the real types, such as `Promise<IJsonLdNodeObject[]>` or `IOrganizationProfileUpdate`, not with the body of a request or response model, such as `IAccountPublicDataGetResponse["body"]`. Keep the request and response models for typing routes and REST client calls
- Identify the resource a route acts on in its path, such as `DELETE /authentication/account/organization/request/:organization`, not in a query parameter. Keep query parameters for filtering, sorting and paging a list, and remember `organization` in the query selects the tenant on a multi-tenant node
- Write a default factory type name inline where it is used, such as `options?.organizationEntityStorageType ?? "organization"`, rather than defining a constant for it
- Use optional chaining to read a property of a value that is typed as an object or `undefined`, such as `config?.emailLocale ?? "en"` or `user?.accountId === accountId`, rather than `Is.object(user) && user.accountId === accountId`. Keep `Is.object` for narrowing a value typed `unknown`, or where the object itself is used afterwards, such as passing it to a method
- Check for arrays with `Is.array(value)`, or `Is.arrayValue(value)` when it must not be empty, rather than `Array.isArray(value)`
- Build an object with a fixed set of properties as an object literal, quoting names that need it, such as `{ "access_token": session.token, "token_type": "Bearer" }`, rather than with `Object.fromEntries` on a list of entries cast to the type, such as `Object.fromEntries([["access_token", session.token]]) as IOAuthAccessToken`
- When several components share an entity storage and call `initialiseEntityStorageConnector` with the same parameters, extract the call into a shared method so the partition ids and other settings cannot conflict
- Export new public symbols from the package `src/index.ts`
- Keep JSDoc brief, encode `>` as `&gt;` as well as `<`, and do not add JSDoc stating that a property or parameter is unused
- Do not remove unused parameters required by an interface or callback signature
- In database requests, retrieve only the properties needed, and page with a cursor rather than looping through a whole query when partial results will do. Pass the property list to `query`, such as `["id", "accountId"]` when collecting ids to remove, rather than reading whole entities, and do not call a helper that reads and converts whole entities when only a few properties are used
- Rely on the query condition to select the matching entities, do not check the results again with a secondary `.filter`, `.find` or `.some` on the same properties, such as `.filter(request => request.accountId === accountId)` after a query on `accountId`. When only one match is needed, query with a limit of 1 rather than reading pages until a match is found
- Keep REST clients free of logic: each method guards its arguments and makes a single `fetch` to a matching route, without combining calls, building query conditions or throwing errors of its own. Convert values for the request and response with `HttpParameterHelper` and `Coerce`, such as `HttpParameterHelper.objectToString(conditions)` or `Coerce.string(limit)`, and read response headers with `HttpHeaderHelper.extractId` and `HttpHeaderHelper.extractCursor`, rather than by hand. When a component method has no route, add the route and its request model on the server rather than emulating it in the client
