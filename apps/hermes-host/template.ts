/**
 * E2B template definition for the HomeHub Hermes sandbox.
 *
 * Uses fromDockerfile() pointing at ./Dockerfile. The programmatic
 * Template API surface hit build-environment restrictions on git clone
 * (exit 128) even with aptInstall of git; the Dockerfile path gives
 * us a proven build that mirrors the local `docker build` result
 * we already validated (2.46 GB image, hermes v0.10.0 callable).
 *
 * Build + publish:
 *   E2B_API_KEY=<key> pnpm --filter @homehub/hermes-host template:build
 *
 * Tag: `homehub-hermes`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Template } from 'e2b';

// Read the Dockerfile content at template-construction time. This lets
// E2B receive the fully-resolved bytes rather than a filesystem path
// that might not resolve correctly in its build context.
const dockerfilePath = join(import.meta.dirname, 'Dockerfile');
const dockerfile = readFileSync(dockerfilePath, 'utf8');

export const template = Template().fromDockerfile(dockerfile);
