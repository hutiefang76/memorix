import { homedir } from 'node:os';

export function getIntegrationTargetRoot(useGlobalDefaults: boolean, cwd: string): string {
  return useGlobalDefaults ? homedir() : cwd;
}

export function getIntegrationScopeLabel(useGlobalDefaults: boolean): string {
  return useGlobalDefaults
    ? 'global defaults'
    : 'current project';
}
