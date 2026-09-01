# Platform service boundary

VOLK-ML keeps the educational editor and local workflow independent from any future hosted product. The public application defaults to `createLocalPlatformServices()` in `src/platform/services.js`. A hosted shell may inject an implementation through `globalThis.__VOLK_ML_PLATFORM_SERVICES__` before the application starts.

The separately versioned `globalThis.__VOLK_ML_AGENT__` bridge controls a workspace that is already mounted in the browser. It is not a platform service, does not listen on the network, and grants no account or cloud authority. A hosted shell may connect a trusted external agent to that bridge, but must enforce authentication, authorization, origin isolation, and user consent outside the open editor.

## Contract

Platform API version 1 exposes four service groups:

| Service | Public local behavior | Future hosted behavior |
| --- | --- | --- |
| `account` | Anonymous local user and local entitlements | Authentication and server-issued entitlements |
| `projects` | IndexedDB auto-save/restore plus JSON and File System Access export | Cloud project CRUD, versions, and access control |
| `collaboration` | Unavailable | Realtime sessions, presence, and permissions |
| `compute` | Browser CPU capability check | Browser CPU plus submitted local/remote jobs |

The editor must not contain billing-provider checks or trust a client-side `isPro` flag. A hosted implementation should obtain entitlements from its server and enforce project, collaboration, and compute permissions again on every protected server request.

The optional HTTP health boundary in `src/services/volkCloud/` is separate
from the injected platform-services implementation. It only reports whether
the configured development Cloud endpoint answers `GET /health`; it does not
provide account, storage, compute, Agent, or Evidence authority. A failed
health check must leave the local editor and deterministic learning runtime
fully usable.

## Injection

```js
globalThis.__VOLK_ML_PLATFORM_SERVICES__ = {
  apiVersion: 1,
  id: 'hosted',
  account: {
    getCurrentUser,
    getEntitlements,
  },
  projects: {
    mode: 'cloud',
    list,
    load,
    save,
    remove,
  },
  collaboration: {
    available: true,
    connect,
  },
  compute: {
    targets: ['browser-cpu', 'remote-gpu'],
    canExecuteInBrowser,
    submit,
    getJob,
    cancelJob,
  },
};
```

Call `validatePlatformServices()` during hosted application startup. Keep provider-specific SDKs, credentials, billing webhooks, databases, job queues, and authorization logic outside the open editor core.

## Stable data boundaries

- Cloud projects should store the versioned VOLK-ML project JSON rather than React component state.
- Remote compute should accept versioned VOLK IR plus explicit dataset references.
- Collaboration should synchronize the graph and workspace document without embedding account or billing state into project JSON.
- Users must retain JSON import/export so hosted storage never becomes a lock-in boundary.
- The local implementation stores one current auto-save in IndexedDB. The application uses the same `projects.load/save/remove` methods that a hosted provider replaces.
- File handles and model API keys are session-only capabilities and must not be serialized into project JSON.
- Canvas agents receive serializable project and execution snapshots only. They do not receive platform credentials, cloud provider objects, or local file handles.

Changing a required method or its semantics requires a new `PLATFORM_API_VERSION` and a migration note.
