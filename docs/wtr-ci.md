# WTR CI

The existing build, typecheck, test and lint gates execute in an isolated fresh Ubuntu
VM with Node 24 and the repository-pinned pnpm. PR/main/manual triggers are retained.
There is no GitHub-hosted fallback. Existing Encore service-test requirements remain:
`pnpm test` reports those tests skipped outside `encore test`; this workflow does not
claim full Encore black-box acceptance. Runtime smoke uses synthetic local fixtures.

Enable only after accepted shared-host policy admits this workflow and automatic events.
The guest cannot use shared host services or private Home Assistant/model endpoints.
WTR CI does not deploy HESTIA. GitHub stores logs/artifacts under its storage allowances.
