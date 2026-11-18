# Dependency security maintenance

Validated on 2026-11-19: the backend root npm audit reported 0 known vulnerabilities. This does not certify application security.

- Prisma CLI and Client are pinned together at 6.19.3.
- A scoped npm override replaces @prisma/config's deepmerge-ts 7.1.5 with patched 8.0.2 (GHSA-ggr8-5vv4-36mx). This crosses a dependency major version, so rerun the Prisma configuration-loading regression test whenever upgrading Prisma or the override. Remove the override when upstream supports a patched dependency directly.
- SheetJS xlsx 0.20.3 comes from its official CDN, as recommended by https://docs.sheetjs.com/docs/getting-started/installation/nodejs/. The npm registry's xlsx 0.18.5 is outdated. Version 0.20.3 is newer than the fixes for GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9. The lockfile records the download integrity. Registry audit results alone do not establish security of external tarballs.
- Prisma installation scripts are explicitly allowed only for the pinned versions.

## Verification

Run npm ci, npm run test:security-deps and npm audit. The tests cover XLS/XLSX import parsing, Prisma configuration loading and schema validation, plus anonymous/student/admin import-preview permissions against a database stub. They never write to a real database.

Nine existing course XLS files (10,270 courses) were also compared before/after upgrading SheetJS; normalized course, section and schedule data was identical. Those source files are not committed.

Database-backed login, course writes and production import transactions require a separately configured test database and are outside this dependency regression test.

## React frontend

Vite was upgraded from 5.x to pinned 6.4.6 to fix the development-server/esbuild findings while retaining compatibility with the existing React plugin and Node 20 deployment. Production bundling passes. The frontend production-only dependency audit reports 0 vulnerabilities.

The full frontend audit still reports four high-severity dependency nodes (picomatch, fdir, tinyglobby, Vite), all from GHSA-fc5q-39xc-vjpf. GitHub withdrew this advisory on 2026-11-18 and the upstream maintainer rejected it as a vulnerability for trusted glob patterns: https://github.com/advisories/GHSA-fc5q-39xc-vjpf and https://github.com/micromatch/picomatch/pull/235. The registry still returns the withdrawn finding and offers no patched picomatch release. No advisory suppression or unsafe downgrade is applied. Recheck the full frontend audit when the registry updates; a literal zero-warning full frontend audit is not achieved yet.
